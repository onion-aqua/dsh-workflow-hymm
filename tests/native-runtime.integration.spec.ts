import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model';
import SessionController from '@deepseek-ai/dsh-api-session-controller';
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types';
import SessionQueryEngine from '@deepseek-ai/dsh-session-query';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local';
import FileUploads from '@deepseek-ai/dsh-client-file-upload';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import * as FileTools from '@deepseek-ai/dsh-tool-fs';
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import LlmRuntime, { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { completedBoundary, DshNativeRuntime } from '../src/host/native-runtime.ts';
import { projectExecution, readTraceStepDetails } from '../src/host/trace-projector.ts';
import VisualWorkflowService from '../src/host/service.ts';
import type { Workflow } from '../src/shared/model.ts';

// Only the external model transport and unused attachment/desktop boundaries
// are fixtures. Agent driving, Controller admission, Session/Fork, event feed,
// replay validation and JSONL persistence below are the released rc.3 code.
class ExactReadQuery extends SessionQueryEngine {
  async searchSessions(): Promise<never> { throw new Error('Search is not used by this integration fixture'); }
  async searchEvents(): Promise<never> { throw new Error('Search is not used by this integration fixture'); }
}
class FixtureModel extends LlmAdapter {
  readonly calls: GenerateOptions[] = [];
  catalogEnabled=true;
  defaultTokens?:number;
  catalogHold?:{started:()=>void;wait:Promise<void>};
  hold?: { started: () => void; wait: Promise<void> };
  async listModels(provider='fixture') {if(this.catalogHold){this.catalogHold.started();await this.catalogHold.wait;}return this.catalogEnabled?[{ provider, id: 'test-model', name: 'Controlled integration model' },{provider,id:'test-model-special',name:'Alternate controlled model'}]:[]; }
  async resolveModel(provider:string,model:string){const info=await super.resolveModel(provider,model);return {...info,...this.defaultTokens===undefined?{}:{defaultMaxTokens:this.defaultTokens}};}
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted();
    this.calls.push(options);
    const prompt = options.messages.findLast(message => message.role === 'user' && 'source' in message && message.source?.kind === 'user')?.content
      .filter(block => block.type === 'text').map(block => block.text).join('') ?? '';
    const last = options.messages.at(-1);
    if(prompt.includes('READ_NATIVE_FILES')&&last?.role!=='tool'){
      const paths=[...prompt.matchAll(/verbatim read-only copy saved at ("(?:\\.|[^"\\])*")/g)].map(match=>JSON.parse(match[1]!) as string);
      if(!paths.length)throw new Error('Expected real native file handle paths in the model request');
      for(const [index,path] of paths.entries()){
        const block={type:'tool-call' as const,id:ToolCallId(`fixture-read-${this.calls.length}-${index}`),name:'read',arguments:JSON.stringify({file_path:path})};
        yield {type:'block-start',index,blockType:'tool-call'};yield {type:'block-end',index,block};
      }
      yield {type:'finish',reason:{kind:'tool-calls'}};return;
    }
    if (prompt.includes('HOLD_ACTIVE') && this.hold) {
      this.hold.started();
      await Promise.race([this.hold.wait, new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
      })]);
    }
    if (prompt.includes('CALL_TOOL') && last?.role !== 'tool') {
      const block = { type: 'tool-call' as const, id: ToolCallId(`fixture-call-${this.calls.length}`), name: 'fixture_write', arguments: '{}' };
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'block-end', index: 0, block };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    const text = prompt.startsWith('You are drafting') ? JSON.stringify({ tasks: [
      { id: 'inspect', title: 'Inspect', instruction: 'Inspect current APIs', dependsOn: [] },
      { id: 'report', title: 'Report', instruction: 'Report recorded evidence', dependsOn: ['inspect'] },
    ] }) : `Native answer: ${prompt}`;
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

const contexts: Context[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function open(root?: string,nativeFiles=false,toolMode:'native'|'ptc'='native') {
  const directory = root ?? await mkdtemp(join(tmpdir(), 'dsh-native-workflow-'));
  if (!root) directories.push(directory);
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(TypertRegistry);
  await ctx.plugin(SessionStore);
  await ctx.plugin(AgentRegistry);
  await ctx.plugin(SessionProjections);
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false });
  await ctx.plugin(Tools, { mode: toolMode });
  await ctx.plugin(JsonlPersistence, { root: join(directory, 'sessions'), compression: 'none' });
  await ctx.plugin(ExactReadQuery);
  await ctx.plugin(AgentDefaultModel, { provider: 'fixture', model: 'test-model' });
  const model = new FixtureModel();
  ctx.llm.registerAdapter(['fixture'], model);
  if(nativeFiles){
    await ctx.plugin(LocalAttachmentStore,{dshHome:directory});
    await ctx.plugin(LocalFileSystem,{cwd:directory});
    await ctx.plugin(WorkingDirectoryService,{defaultDirectory:directory});
    await ctx.plugin(FileTools,{read:true,write:false,edit:false,readImage:false});
    // Unused HTTP route/command registration boundaries are fixtures. File
    // upload staging, admission, stored bytes and the `read` tool are native.
    ctx.provide('connection',{fetch:{register:()=>()=>{}}});
    ctx.provide('commands',{registerFileReceiptResolver:()=>()=>{}});
    await ctx.plugin(FileUploads);
  }else{
    ctx.provide('attachments', {
    imageLimits: { maxImageBytes: 1_000_000, maxImagesPerMessage: 10, maxMessageImageBytes: 10_000_000,
      maxImagePixels: 10_000_000, maxImageDimension: 10000, mediaTypes: ['image/png'] },
    admitPromptContent: async (content: unknown) => content,
  });
  ctx.provide('fileUploads', {
    registerAgentResolver: () => () => {},
    bindPrompt: () => ({ commit() {}, [Symbol.dispose]() {} }),
    retirePrompt() {},
  });
    ctx.provide('fs', {});
  }
  ctx.provide('remoteAccess', { allows: () => true });
  ctx.provide('workspaceRegistry', { archivedSessionIds: [], list: () => [], get: () => undefined });
  await ctx.plugin(AgentLoop, {});
  await ctx.plugin(SessionController, { nativeOpen: false });
  return { ctx, runtime: new DshNativeRuntime(ctx), directory, model };
}

async function execute(runtime: DshNativeRuntime, sessionId: string, requestId: string, text: string, planning = false) {
  await runtime.submit({ sessionId, requestId, text, planning });
  await runtime.waitForIdle(sessionId);
  await runtime.flush(sessionId);
  return runtime.read(sessionId);
}

async function mountWorkflow(ctx: Context, directory: string) {
  await ctx.plugin(Storage);
  await ctx.plugin(JsonStorage, { root: join(directory, 'workflow-storage') });
  await ctx.plugin(StorageDomain, { backend: 'json' });
  await ctx.plugin(VisualWorkflowService);
  // Cordis inject callbacks activate asynchronously when all native services
  // exist. Verify public capability availability rather than replacing runtime.
  await vi.waitFor(async () => expect((await ctx.visualWorkflow.catalog()).sessions).toBeInstanceOf(Array));
  return ctx.visualWorkflow;
}

async function physicalLog(directory: string, sessionId: string): Promise<Buffer> {
  const entries = await readdir(join(directory, 'sessions'), { recursive: true, withFileTypes: true });
  const file = entries.find(entry => entry.isFile() && entry.parentPath.endsWith(sessionId) && entry.name.endsWith('.jsonl'));
  if (!file) throw new Error('Expected a materialized native JSONL generation');
  return readFile(join(file.parentPath, file.name));
}

/** Inspect the actual native model input, rather than only Session identities. */
function modelContextFor(model: FixtureModel, token: string): string {
  const calls = model.calls.filter(call => call.messages.findLast(message => message.role === 'user' && 'source' in message && message.source?.kind === 'user')?.content
    .some(block => block.type === 'text' && block.text.includes(token)));
  expect(calls).toHaveLength(1);
  return JSON.stringify(calls[0]!.messages);
}

/** Native terminal projections may commit between an assertion and a graph edit. */
async function updateNativeTestGraph(service: Awaited<ReturnType<typeof mountWorkflow>>, workflowId: string, update: (current: Workflow) => Workflow): Promise<Workflow> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = (await service.get({ id: workflowId })).workflow;
    if (!current) throw new Error('Expected the native test workflow to exist');
    const saved = await service.save({ expectedRevision: current.revision, workflow: update(current) });
    if (saved.ok) return saved.workflow;
    if (saved.code !== 'conflict') throw new Error(`Native graph edit failed: ${saved.code}`);
  }
  throw new Error('Native graph edit still conflicts after three fresh revision attempts');
}

describe('released rc.3 Agent / Controller / Session / JSONL integration', () => {
  it('reads only real uploaded planning files under a native Agent scope, produces a plan from tool results and restores its guard after restart',async()=>{
    const first=await open(undefined,true,'ptc'),service=await mountWorkflow(first.ctx,first.directory),created=(await service.create({name:'Planning with native requirements'})).workflow;
    const configured=await service.save({workflow:{...created,settings:{generation:'manual',execution:'manual',model:{provider:'fixture',model:'test-model-special'}}},expectedRevision:created.revision});if(!configured.ok)throw new Error('save');
    const prepared=await service.preparePlanAttachments({workflowId:created.id,operationId:'prepare-native-planning-uploads'}),inputs=[{name:'requirements.txt',bytes:Buffer.from('NATIVE PLAN EVIDENCE ALPHA: the required output is a source audit.','utf8')},{name:'constraints.md',bytes:Buffer.from('NATIVE PLAN EVIDENCE BETA: changes need explicit human approval.','utf8')}];
    const receipts=[];for(const input of inputs)receipts.push(await first.ctx.fileUploads.uploadStream({sessionId:SessionId(prepared.sessionId),name:input.name,data:(async function*(){yield input.bytes;})()}));
    const attached=(await service.attachPlanFiles({workflowId:created.id,sessionId:prepared.sessionId,receiptIds:receipts.map(receipt=>receipt.receiptId),operationId:'attach-native-planning-uploads'})).workflow,files=attached.planningAttachments!;
    await first.ctx.fiber.dispose();const second=await open(first.directory,true,'ptc'),resumed=await mountWorkflow(second.ctx,first.directory);expect((await resumed.get({id:created.id})).workflow!.planningAttachments).toEqual(files);
    const requested=await resumed.generatePlan({workflowId:created.id,goal:'READ_NATIVE_FILES and derive a task plan from their exact evidence.',attachmentIds:files.map(file=>file.id),operationId:'plan-real-native-evidence'});
    await vi.waitFor(async()=>expect((await resumed.get({id:created.id})).workflow!.plans![0]!.status).toBe('proposed'),{timeout:5000,interval:20});const current=(await resumed.get({id:created.id})).workflow!,plan=current.plans![0]!;
    expect(plan.attachments).toEqual(files);expect(current.planningAttachments).toEqual([]);expect(plan.tasks).toHaveLength(2);expect(second.model.calls).toHaveLength(2);expect(second.model.calls.every(call=>call.model==='test-model-special')).toBe(true);
    const log=await second.runtime.read(plan.sessionId),projection=projectExecution(log,{runId:plan.id,requestId:plan.requestId}),readSteps=projection.steps.filter(step=>step.toolName==='read');expect(readSteps).toHaveLength(2);
    for(const [index,step] of readSteps.entries()){expect(step.status).toBe('completed');expect(readTraceStepDetails(log,projection,step.stepId).output).toContain(index===0?'NATIVE PLAN EVIDENCE ALPHA':'NATIVE PLAN EVIDENCE BETA');}
    const toolResults=second.model.calls[1]!.messages.filter(message=>message.role==='tool').flatMap(message=>message.content).filter(block=>block.type==='text').map(block=>block.text).join('\n');expect(toolResults).toContain('NATIVE PLAN EVIDENCE ALPHA');expect(toolResults).toContain('NATIVE PLAN EVIDENCE BETA');
    const message=log.events.find(event=>event.type==='user/message'&&(event.data.source as {rpcId?:string}).rpcId===plan.requestId)!;expect((message.data.content as {type:string;attachment?:unknown}[]).filter(part=>part.type==='file').map(part=>part.attachment)).toEqual(files.map(file=>file.file));
    const agent=second.ctx.agents.get(SessionId(plan.sessionId))!;let bodies=0;agent.ctx.tools.register({name:'fixture_write',description:'Must remain blocked during attachment-aware planning',parameters:{type:'object'},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:String(value)}]},execute:async()=>{bodies++;return 'forbidden';}});
    const refused=await agent.ctx.tools.execute({name:'fixture_write',callId:ToolCallId('plan-write-must-stay-blocked'),arguments:{},agent,signal:new AbortController().signal});expect(refused.isError).toBe(true);expect(bodies).toBe(0);
    const foreign=await agent.ctx.tools.execute({name:'read',callId:ToolCallId('plan-read-foreign-must-stay-blocked'),arguments:{file_path:join(second.directory,'unrelated-private-file.txt')},agent,signal:new AbortController().signal});expect(foreign.isError).toBe(true);
    const accepted=(await resumed.applyPlan({workflowId:created.id,planId:plan.id,accept:true})).workflow;expect(accepted.executions).toEqual([]);expect(accepted.nodes.every(node=>node.status==='draft')).toBe(true);
    const metadata=await readFile(join(first.directory,'workflow-storage','visual_workflow.json'),'utf8');for(const input of inputs){expect(metadata).not.toContain(input.bytes.toString());expect(metadata).not.toContain(input.bytes.toString('base64'));}for(const receipt of receipts)expect(metadata).not.toContain(receipt.receiptId);
    await second.ctx.fiber.dispose();const third=await open(first.directory,true,'ptc'),recovered=await mountWorkflow(third.ctx,first.directory);await vi.waitFor(()=>expect(Reflect.get(Reflect.get(recovered,'native'),'planningSessions').has(plan.sessionId)).toBe(true));
    await third.runtime.submit({sessionId:plan.sessionId,requestId:'read-planning-files-after-restart',text:'READ_NATIVE_FILES only the previously uploaded planning evidence.',files:files.map(file=>file.file),model:plan.resolvedModel});await third.runtime.waitForIdle(plan.sessionId);await third.runtime.flush(plan.sessionId);
    const restoredLog=await third.runtime.read(plan.sessionId),restoredReads=projectExecution(restoredLog,{runId:'restored-file-plan',requestId:'read-planning-files-after-restart'}).steps.filter(step=>step.toolName==='read');expect(restoredReads).toHaveLength(2);expect(restoredReads.every(step=>step.status==='completed')).toBe(true);
  },15000);
  it('routes independently selected models into native request headers and planning without changing the DSH default or source Session',async()=>{
    const {ctx,runtime,directory,model}=await open();const source=await runtime.create({cwd:directory});const sourceLog=await execute(runtime,source.sessionId,'model-source','Original default route');const sourceBytes=await physicalLog(directory,source.sessionId);const configuredDefault=ctx.agentDefaultModel.currentSelection();
    expect(await runtime.models()).toMatchObject({models:[{provider:'fixture',model:'test-model'},{provider:'fixture',model:'test-model-special'}],defaultModel:{provider:'fixture',model:'test-model'}});
    expect(await runtime.getDefaultModel()).toEqual({provider:'fixture',model:'test-model'});expect(await runtime.resolveModel()).toEqual({provider:'fixture',model:'test-model'});
    const left=await runtime.fork({sessionId:source.sessionId,atSeq:completedBoundary(sourceLog)!});const right=await runtime.fork({sessionId:source.sessionId,atSeq:completedBoundary(sourceLog)!});
    for(const [sessionId,selected,requestId] of [[left.sessionId,'test-model-special','model-left-special'],[right.sessionId,'test-model','model-right-default'],[left.sessionId,'test-model','model-left-back']] as const){
      await runtime.submit({sessionId,requestId,text:'Use the explicitly chosen route.',model:{provider:'fixture',model:selected}});await runtime.waitForIdle(sessionId);await runtime.flush(sessionId);
      expect(model.calls.at(-1)).toMatchObject({provider:'fixture',model:selected});const log=await runtime.read(sessionId);expect((log.events.findLast(event=>event.type==='request/header')!.data.header as {config:unknown}).config).toMatchObject({provider:'fixture',model:selected});
    }
    expect(ctx.agentDefaultModel.currentSelection()).toEqual(configuredDefault);expect(await physicalLog(directory,source.sessionId)).toEqual(sourceBytes);
    const count=model.calls.length;const before=await runtime.read(left.sessionId);await expect(runtime.submit({sessionId:left.sessionId,requestId:'model-invalid',text:'Do not dispatch an unavailable model.',model:{provider:'fixture',model:'missing-model'}})).rejects.toThrow(/not currently available/);expect(model.calls).toHaveLength(count);expect(await runtime.read(left.sessionId)).toEqual(before);
    const service=await mountWorkflow(ctx,directory);const imported=(await service.importSession({sessionId:source.sessionId})).workflow;const saved=await service.save({expectedRevision:imported.revision,workflow:{...imported,settings:{...imported.settings!,model:{provider:'fixture',model:'test-model-special'}}}});if(!saved.ok)throw new Error('Expected native planning model configuration');
    const requested=await service.generatePlan({workflowId:imported.id,goal:'Produce a controlled valid task plan.',operationId:'planning-selected-native-model'});await vi.waitFor(async()=>expect((await service.get({id:imported.id})).workflow!.plans!.find(plan=>plan.id===requested.planId)?.status).toBe('proposed'));
    const planned=(await service.get({id:imported.id})).workflow!.plans!.find(plan=>plan.id===requested.planId)!;expect(planned.tasks).toHaveLength(2);expect(planned.resolvedModel).toEqual({provider:'fixture',model:'test-model-special'});expect(model.calls.at(-1)?.model).toBe('test-model-special');expect(ctx.agentDefaultModel.currentSelection()).toEqual(configuredDefault);expect(await physicalLog(directory,source.sessionId)).toEqual(sourceBytes);
    const accepted=(await service.applyPlan({workflowId:imported.id,planId:planned.id,accept:true,taskIds:planned.tasks.map(task=>task.id)})).workflow;expect(accepted.nodes.filter(node=>node.kind!=='session')).toHaveLength(2);expect(accepted.executions).toEqual([]);expect(accepted.nodes.filter(node=>node.kind!=='session').every(node=>node.status==='draft')).toBe(true);
    model.catalogEnabled=false;expect(await runtime.models()).toEqual({models:[]});expect(await runtime.getDefaultModel()).toBeUndefined();await expect(runtime.resolveModel()).rejects.toThrow(/No available default model/);expect(ctx.agentDefaultModel.currentSelection()).toEqual(configuredDefault);
  });
  it('pins Workflow-global and node-specific models for queued and batch executions and restores each exact native route after restart',async()=>{
    const first=await open();const source=await first.runtime.create({cwd:first.directory});await execute(first.runtime,source.sessionId,'queued-model-source','Immutable model selection source');const sourceBytes=await physicalLog(first.directory,source.sessionId);
    const service=await mountWorkflow(first.ctx,first.directory);const imported=(await service.importSession({sessionId:source.sessionId})).workflow;const saved=await service.save({expectedRevision:imported.revision,workflow:{...imported,settings:{...imported.settings!,model:{provider:'fixture',model:'test-model-special'}},nodes:[...imported.nodes,{id:'global-model-task',title:'Workflow model',instruction:'Reply using the workflow model.',source:'user',status:'draft',revision:1,position:{x:400,y:100}},{id:'node-model-task',title:'Node override',instruction:'Reply using the node model override.',model:{provider:'fixture',model:'test-model'},source:'user',status:'draft',revision:1,position:{x:800,y:100}}],edges:[{id:'model-order',source:'global-model-task',target:'node-model-task',type:'dependency'}]}});if(!saved.ok)throw new Error('Expected model queue graph');
    const waiting=await service.run({workflowId:imported.id,nodeId:'node-model-task',operationId:'persist-node-model-queue'});expect(waiting.workflow.executions!.find(run=>run.runId===waiting.runId)).toMatchObject({status:'waiting',resolvedModel:{provider:'fixture',model:'test-model'}});await first.ctx.fiber.dispose();
    const second=await open(first.directory);const resumed=await mountWorkflow(second.ctx,first.directory);const nativeDefault=second.ctx.agentDefaultModel.currentSelection();expect(second.model.calls).toHaveLength(0);
    await resumed.run({workflowId:imported.id,nodeId:'global-model-task',operationId:'run-global-model-after-restart'});await vi.waitFor(async()=>expect((await resumed.get({id:imported.id})).workflow!.executions!.every(run=>run.status==='completed'&&run.durability==='durable')).toBe(true),{timeout:5000,interval:20});
    const completed=(await resumed.get({id:imported.id})).workflow!;expect(second.model.calls.map(call=>call.model)).toEqual(['test-model-special','test-model']);
    for(const run of completed.executions!){const log=await second.runtime.read(run.sessionId);const headers=log.events.filter(event=>event.type==='request/header'&&event.seq>=run.startSeq!&&event.seq<=run.endSeq!);expect(headers.length).toBeGreaterThan(0);for(const header of headers)expect((header.data.header as {config:unknown}).config).toMatchObject(run.resolvedModel!);}
    const batch=await resumed.batchRun({workflowId:imported.id,nodeIds:['node-model-task','global-model-task'],nodeRevisions:{'node-model-task':1,'global-model-task':1},operationId:'batch-current-models'});await vi.waitFor(async()=>expect((await resumed.get({id:imported.id})).workflow!.executions!.filter(run=>batch.runIds.includes(run.runId)).every(run=>run.status==='completed')).toBe(true),{timeout:5000,interval:20});
    const after=(await resumed.get({id:imported.id})).workflow!;expect(after.executions!.find(run=>run.runId===batch.runIds[0])!.resolvedModel).toEqual({provider:'fixture',model:'test-model'});expect(after.executions!.find(run=>run.runId===batch.runIds[1])!.resolvedModel).toEqual({provider:'fixture',model:'test-model-special'});expect(second.ctx.agentDefaultModel.currentSelection()).toEqual(nativeDefault);expect(await physicalLog(first.directory,source.sessionId)).toEqual(sourceBytes);
  },10000);
  it('applies a selected route only to its claimed request and returns control to native model selection after completion',async()=>{
    const {ctx,runtime,directory,model}=await open();const target=await runtime.create({cwd:directory});
    ctx.tools.register({name:'fixture_write',description:'Controlled native request tool',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:String(value)}]},execute:async()=> 'Native step remains on its own model.'});
    let catalogStarted!:()=>void,releaseCatalog!:()=>void;const catalogBegan=new Promise<void>(resolve=>{catalogStarted=resolve;});model.catalogHold={started:catalogStarted,wait:new Promise<void>(resolve=>{releaseCatalog=resolve;})};
    const workflowSubmit=runtime.submit({sessionId:target.sessionId,requestId:'workflow-model-after-native',text:'Reply from the selected Workflow request.',model:{provider:'fixture',model:'test-model-special'}});await catalogBegan;
    let nativeStarted!:()=>void,releaseNative!:()=>void;const nativeBegan=new Promise<void>(resolve=>{nativeStarted=resolve;});model.hold={started:nativeStarted,wait:new Promise<void>(resolve=>{releaseNative=resolve;})};
    await ctx.sessionController.prompt({sessionId:SessionId(target.sessionId),requestId:'native-request-before-workflow' as SessionRequestId,mode:'queue',content:[{type:'text',text:'HOLD_ACTIVE CALL_TOOL native request before Workflow model admission.'}]},new AbortController().signal);await nativeBegan;
    model.catalogHold=undefined;releaseCatalog();await workflowSubmit;
    const beforeClaim=await runtime.read(target.sessionId);expect(beforeClaim.events.filter(event=>event.type==='model/selection')).toEqual([]);
    model.hold=undefined;releaseNative();await runtime.waitForIdle(target.sessionId);await runtime.flush(target.sessionId);
    expect(model.calls.map(call=>call.model)).toEqual(['test-model','test-model','test-model-special']);expect(ctx.agentDefaultModel.currentSelection().model).toBe('test-model');
    const settled=await runtime.read(target.sessionId);const selectedEvent=settled.events.find(event=>event.type==='model/selection')!;const selectedTurn=settled.events.findLast(event=>event.type==='turn/start')!;expect(selectedEvent.seq).toBeGreaterThan(selectedTurn.seq);expect(selectedEvent.seq).toBeLessThan(settled.events.findLast(event=>event.type==='request/header')!.seq);
    const calls=model.calls.length;await runtime.submit({sessionId:target.sessionId,requestId:'workflow-model-after-native',text:'A duplicate accepted request must stay idempotent.',model:{provider:'fixture',model:'test-model-special'}});expect(model.calls).toHaveLength(calls);expect(await runtime.read(target.sessionId)).toEqual(settled);
    await ctx.sessionController.selectModel({sessionId:SessionId(target.sessionId),provider:'fixture',model:'test-model'});await execute(runtime,target.sessionId,'native-model-after-workflow','Native model selection owns this later conversation prompt.');expect(model.calls.at(-1)?.model).toBe('test-model');
  });
  it('switches actual provider adapters and resolves the new route defaults instead of carrying the old adapter defaults',async()=>{
    const {ctx,runtime,directory,model}=await open();model.defaultTokens=111;const alternate=new FixtureModel();alternate.defaultTokens=37;ctx.llm.registerAdapter(['fixture-alt'],alternate);
    const source=await runtime.create({cwd:directory});const sourceLog=await execute(runtime,source.sessionId,'provider-source','Original provider default.');const sourceBytes=await physicalLog(directory,source.sessionId);expect(model.calls.at(-1)?.maxTokens).toBe(111);const configured=ctx.agentDefaultModel.currentSelection();
    const child=await runtime.fork({sessionId:source.sessionId,atSeq:completedBoundary(sourceLog)!});await runtime.submit({sessionId:child.sessionId,requestId:'alternate-provider-run',text:'Use the alternate provider.',model:{provider:'fixture-alt',model:'test-model-special'}});await runtime.waitForIdle(child.sessionId);await runtime.flush(child.sessionId);
    expect(alternate.calls).toHaveLength(1);expect(alternate.calls[0]).toMatchObject({provider:'fixture-alt',model:'test-model-special',maxTokens:37});expect(alternate.calls[0]?.reasoningEffort).toBeUndefined();const routed=await runtime.read(child.sessionId);expect((routed.events.findLast(event=>event.type==='request/header')!.data.header as {config:unknown}).config).toEqual({provider:'fixture-alt',model:'test-model-special',maxTokens:37});
    await runtime.submit({sessionId:child.sessionId,requestId:'original-provider-restored',text:'Use the configured provider again.',model:{provider:'fixture',model:'test-model'}});await runtime.waitForIdle(child.sessionId);await runtime.flush(child.sessionId);expect(model.calls.at(-1)).toMatchObject({provider:'fixture',model:'test-model',maxTokens:111});expect(alternate.calls).toHaveLength(1);expect(ctx.agentDefaultModel.currentSelection()).toEqual(configured);expect(await physicalLog(directory,source.sessionId)).toEqual(sourceBytes);
  });
  it('admits multiple real uploaded files, reads their bytes through the native tool, isolates forks and restages after restart',async()=>{
    const first=await open(undefined,true);const source=await first.runtime.create({cwd:first.directory});
    const sourceLog=await execute(first.runtime,source.sessionId,'native-files-source','IMMUTABLE ATTACHMENT SOURCE');const sourceBytes=await physicalLog(first.directory,source.sessionId);
    const stage=await first.runtime.create({cwd:first.directory});
    const inputs=[{name:'需求说明.txt',bytes:Buffer.from('NATIVE FILE ONE: 真正上传的需求内容\nOnly native stored bytes.','utf8')},{name:'evidence.md',bytes:Buffer.from('# NATIVE FILE TWO\nIndependent attachment evidence.','utf8')}];
    const receipts=[];
    for(const input of inputs)receipts.push(await first.ctx.fileUploads.uploadStream({sessionId:SessionId(stage.sessionId),name:input.name,data:(async function*(){yield input.bytes.subarray(0,3);yield input.bytes.subarray(3);})()}));
    const files=await Promise.all(receipts.map(receipt=>first.runtime.resolveUploadedFile(stage.sessionId,receipt.receiptId)));
    await first.runtime.flush(stage.sessionId);
    expect(files.map(file=>file.name)).toEqual(inputs.map(input=>input.name));expect(files.map(file=>file.bytes)).toEqual(inputs.map(input=>input.bytes.length));
    await expect(first.runtime.resolveUploadedFile(source.sessionId,receipts[0]!.receiptId)).rejects.toThrow(/not uploaded/);
    await expect(first.runtime.resolveUploadedFile(stage.sessionId,'fabricated-receipt')).rejects.toThrow(/not uploaded/);
    const branches=await Promise.all([first.runtime.fork({sessionId:source.sessionId,atSeq:completedBoundary(sourceLog)!}),first.runtime.fork({sessionId:source.sessionId,atSeq:completedBoundary(sourceLog)!})]);
    expect(new Set([source.sessionId,...branches.map(branch=>branch.sessionId)]).size).toBe(3);
    for(const [index,branch] of branches.entries()){
      const requestId=`native-files-${index}`;await first.runtime.submit({sessionId:branch.sessionId,requestId,text:'READ_NATIVE_FILES using the real native read tool.',files});await first.runtime.waitForIdle(branch.sessionId);await first.runtime.flush(branch.sessionId);
      const log=await first.runtime.read(branch.sessionId);const projection=projectExecution(log,{runId:`files-run-${index}`,requestId});expect(projection.status).toBe('completed');
      const message=log.events.find(event=>event.type==='user/message'&&(event.data.source as {rpcId?:string}).rpcId===requestId)!;
      expect((message.data.content as {type:string;attachment?:unknown}[]).filter(part=>part.type==='file').map(part=>part.attachment)).toEqual(files);
      const readSteps=projection.steps.filter(step=>step.toolName==='read');expect(readSteps).toHaveLength(2);
      for(const [fileIndex,step] of readSteps.entries()){expect(step.status).toBe('completed');expect(readTraceStepDetails(log,projection,step.stepId).output).toContain(fileIndex===0?'真正上传的需求内容':'Independent attachment evidence.');}
      const serialized=JSON.stringify(log);for(const receipt of receipts)expect(serialized).not.toContain(receipt.receiptId);expect(serialized).not.toContain(inputs[0]!.bytes.toString('base64'));
    }
    expect(await physicalLog(first.directory,source.sessionId)).toEqual(sourceBytes);await first.ctx.fiber.dispose();
    const second=await open(first.directory,true);await expect(second.runtime.resolveUploadedFile(stage.sessionId,receipts[0]!.receiptId)).rejects.toThrow(/not uploaded/);
    const target=branches[0]!.sessionId;await second.runtime.submit({sessionId:target,requestId:'files-after-restart',text:'READ_NATIVE_FILES after restart.',files});await second.runtime.waitForIdle(target);await second.runtime.flush(target);
    const restored=await second.runtime.read(target);const projection=projectExecution(restored,{runId:'files-restored',requestId:'files-after-restart'});expect(projection.status).toBe('completed');expect(projection.steps.filter(step=>step.toolName==='read')).toHaveLength(2);
    expect(await physicalLog(first.directory,source.sessionId)).toEqual(sourceBytes);
  },10000);

  it('rejects a corrupt durable attachment before any native prompt or model call',async()=>{
    const {ctx,runtime,directory,model}=await open(undefined,true);const stage=await runtime.create({cwd:directory});
    const uploaded=await ctx.fileUploads.uploadStream({sessionId:SessionId(stage.sessionId),name:'integrity.txt',data:(async function*(){yield Buffer.from('verified original bytes');})()});const file=await runtime.resolveUploadedFile(stage.sessionId,uploaded.receiptId);
    const target=await runtime.create({cwd:directory});const before=await runtime.read(target.sessionId);const calls=model.calls.length;
    await expect(runtime.submit({sessionId:target.sessionId,requestId:'corrupt-file',text:'READ_NATIVE_FILES',files:[{...file,bytes:file.bytes+1}]})).rejects.toMatchObject({code:'session/attachment-invalid',details:{reason:'ATTACHMENT_CORRUPT'}});
    expect(model.calls).toHaveLength(calls);expect(await runtime.read(target.sessionId)).toEqual(before);
    const path=ctx.attachments.fileHostPath(uploaded.file as FileAttachmentRef)!;expect(await readFile(path,'utf8')).toBe('verified original bytes');
  });

  it('registers real uploads through the Host, restores a queued attachment Run after restart, and preserves the original Session',async()=>{
    const first=await open(undefined,true);const source=await first.runtime.create({cwd:first.directory});await execute(first.runtime,source.sessionId,'host-file-source','Original Host attachment source');const sourceBytes=await physicalLog(first.directory,source.sessionId);
    const service=await mountWorkflow(first.ctx,first.directory);const imported=(await service.importSession({sessionId:source.sessionId})).workflow;
    const saved=await service.save({expectedRevision:imported.revision,workflow:{...imported,nodes:[...imported.nodes,{id:'file-gate',title:'Prerequisite',instruction:'Complete this prerequisite.',source:'user',status:'draft',revision:1,position:{x:400,y:100}},{id:'file-target',title:'Read uploaded evidence',instruction:'READ_NATIVE_FILES after the prerequisite.',source:'user',status:'draft',revision:1,position:{x:800,y:100}}],edges:[{id:'file-dependency',source:'file-gate',target:'file-target',type:'dependency'}]}});if(!saved.ok)throw new Error('Expected native attachment graph');
    const prepared=await service.prepareAttachment({workflowId:imported.id,nodeId:'file-target',nodeRevision:1,operationId:'prepare-native-file'});expect(prepared.sessionId).not.toBe(source.sessionId);expect((await service.catalog()).sessions.some(session=>session.sessionId===prepared.sessionId)).toBe(false);
    const data=Buffer.from('NATIVE HOST ATTACHMENT: workflow file bytes stay outside metadata.','utf8');const receipt=await first.ctx.fileUploads.uploadStream({sessionId:SessionId(prepared.sessionId),name:'host-evidence.txt',data:(async function*(){yield data;})()});
    await expect(service.attachFiles({workflowId:imported.id,nodeId:'file-target',nodeRevision:1,operationId:'invalid-real-upload-batch',sessionId:prepared.sessionId,receiptIds:[receipt.receiptId,'fabricated-native-file-receipt']})).rejects.toThrow(/not uploaded/);
    expect((await service.get({id:imported.id})).workflow).toEqual(prepared.workflow);
    const attached=(await service.attachFiles({workflowId:imported.id,nodeId:'file-target',nodeRevision:1,operationId:'attach-native-file',sessionId:prepared.sessionId,receiptIds:[receipt.receiptId]})).workflow;expect(attached.nodes.find(node=>node.id==='file-target')).toMatchObject({revision:2,attachments:[{file:{name:'host-evidence.txt',bytes:data.length}}]});
    const waiting=await service.run({workflowId:imported.id,nodeId:'file-target',nodeRevision:2,operationId:'queued-native-file-run'});expect(waiting.workflow.executions!.find(run=>run.runId===waiting.runId)).toMatchObject({status:'waiting',turns:[]});const modelCalls=first.model.calls.length;expect(modelCalls).toBe(1);
    expect(await physicalLog(first.directory,source.sessionId)).toEqual(sourceBytes);await first.ctx.fiber.dispose();
    const second=await open(first.directory,true);const resumed=await mountWorkflow(second.ctx,first.directory);expect(second.model.calls).toHaveLength(0);expect((await resumed.catalog()).sessions.some(session=>session.sessionId===prepared.sessionId)).toBe(false);
    await resumed.run({workflowId:imported.id,nodeId:'file-gate',operationId:'release-native-file-gate'});await vi.waitFor(async()=>expect((await resumed.get({id:imported.id})).workflow!.executions!.every(run=>run.status==='completed'&&run.durability==='durable')).toBe(true),{timeout:5000,interval:20});
    const completed=(await resumed.get({id:imported.id})).workflow!;const execution=completed.executions!.find(run=>run.runId===waiting.runId)!;expect(execution.sessionId).not.toBe(source.sessionId);expect(execution.sessionId).not.toBe(prepared.sessionId);expect(second.model.calls).toHaveLength(3);
    const trace=(await resumed.trace({workflowId:imported.id,runId:execution.runId})).trace;const read=trace.steps.find(step=>step.toolName==='read')!;expect(read.status).toBe('completed');expect((await resumed.details({workflowId:imported.id,runId:execution.runId,stepId:read.stepId})).details.output).toContain(data.toString());
    const metadata=await readFile(join(first.directory,'workflow-storage','visual_workflow.json'),'utf8');expect(metadata).not.toContain(data.toString());expect(metadata).not.toContain(data.toString('base64'));expect(await physicalLog(first.directory,source.sessionId)).toEqual(sourceBytes);
    // Trace reads and native reconciliation can advance metadata after the
    // completion snapshot. Retry optimistic conflicts using a fresh revision.
    await vi.waitFor(async()=>{const current=(await resumed.get({id:imported.id})).workflow!;expect(await resumed.delete({workflowId:imported.id,expectedRevision:current.revision})).toEqual({ok:true,workflowId:imported.id});});expect((await resumed.catalog()).sessions.some(session=>session.sessionId===prepared.sessionId)).toBe(false);expect(await physicalLog(first.directory,source.sessionId)).toEqual(sourceBytes);
  },10000);

  it('atomically authorizes a selected batch, runs its prerequisite first, and archives only metadata after completion', async () => {
    const { ctx, runtime, directory, model } = await open();
    const source = await runtime.create({ cwd: directory });
    await execute(runtime, source.sessionId, 'batch-source', 'Original native batch source');
    const sourceBytes = await physicalLog(directory, source.sessionId);
    const service = await mountWorkflow(ctx, directory);
    const imported = (await service.importSession({ sessionId: source.sessionId })).workflow;
    const saved = await service.save({ expectedRevision: imported.revision, workflow: { ...imported,
      nodes: [...imported.nodes,
        { id: 'batch-first', title: 'Batch first', instruction: 'HOLD_ACTIVE batch prerequisite', source: 'user', status: 'draft', revision: 1, position: { x: 450, y: 100 } },
        { id: 'batch-later', title: 'Batch later', instruction: 'Use the completed batch prerequisite', source: 'user', status: 'draft', revision: 1, position: { x: 850, y: 100 } },
        { id: 'batch-unselected', title: 'Unselected', instruction: 'Never authorize through another selection', source: 'user', status: 'draft', revision: 1, position: { x: 1250, y: 100 } },
      ], edges: [{ id: 'batch-order', source: 'batch-first', target: 'batch-later', type: 'dependency' }],
    } });
    if (!saved.ok) throw new Error('Expected native batch graph');
    const sourceNode = saved.workflow.nodes.find(node => node.kind === 'session')!;
    const beforeInvalid = model.calls.length;
    for (const args of [
      { nodeIds: ['batch-first', 'batch-later'], nodeRevisions: { 'batch-first': 1, 'batch-later': 99 } },
      { nodeIds: ['batch-first', sourceNode.id], nodeRevisions: { 'batch-first': 1, [sourceNode.id]: 1 } },
    ]) await expect(service.batchRun({ workflowId: imported.id, ...args, operationId: `invalid-native-${args.nodeIds[1]}` })).rejects.toThrow();
    expect((await service.get({ id: imported.id })).workflow).toEqual(saved.workflow);expect(model.calls).toHaveLength(beforeInvalid);
    let started = false; let release!: () => void;
    model.hold = { started: () => { started = true; }, wait: new Promise<void>(resolve => { release = resolve; }) };
    const request = { workflowId: imported.id, nodeIds: ['batch-later', 'batch-first'], nodeRevisions: { 'batch-first': 1, 'batch-later': 1 }, operationId: 'one-native-batch' };
    const batch = await service.batchRun(request);
    await vi.waitFor(() => expect(started).toBe(true));
    const during = (await service.get({ id: imported.id })).workflow!;
    expect(during.executions).toHaveLength(2);expect(during.executions!.find(run => run.nodeId === 'batch-later')).toMatchObject({ status: 'waiting', turns: [] });
    expect(during.executions!.find(run => run.nodeId === 'batch-later')!.startSeq).toBeUndefined();
    release(); model.hold = undefined;
    await vi.waitFor(async () => expect((await service.get({ id: imported.id })).workflow!.executions!.every(run => run.status === 'completed' && run.durability === 'durable')).toBe(true), { timeout: 5000, interval: 20 });
    const done = (await service.get({ id: imported.id })).workflow!;const first = done.executions!.find(run => run.nodeId === 'batch-first')!;const later = done.executions!.find(run => run.nodeId === 'batch-later')!;
    expect(batch.runIds).toEqual([later.runId, first.runId]);expect(first.endSeq).toBeLessThan(later.startSeq!);expect(first.sessionId).toBe(later.sessionId);expect(first.sessionId).not.toBe(source.sessionId);
    expect(done.executions!.some(run => run.nodeId === 'batch-unselected')).toBe(false);
    const calls = model.calls.length;await service.batchRun(request);expect(model.calls).toHaveLength(calls);
    const childBytes = await physicalLog(directory, first.sessionId);
    expect(await service.delete({ workflowId: imported.id, expectedRevision: done.revision })).toEqual({ ok: true, workflowId: imported.id });
    expect((await service.list()).workflows).toEqual([]);expect(await service.get({ id: imported.id })).toEqual({ workflow: null });
    expect(await physicalLog(directory, source.sessionId)).toEqual(sourceBytes);expect(await physicalLog(directory, first.sessionId)).toEqual(childBytes);
    const durable = JSON.parse(await readFile(join(directory, 'workflow-storage', 'visual_workflow.json'), 'utf8')).tables.workflows[imported.id];
    expect(durable.archivedAt).toBeTypeOf('number');expect(durable.executions).toEqual(done.executions);
  }, 10000);

  it('forks queued canvas siblings at their common native boundary after restart without leaking actual model context', async () => {
    const first = await open();
    const source = await first.runtime.create({ cwd: first.directory });
    await execute(first.runtime, source.sessionId, 'canvas-source', 'CANVAS_SOURCE_CONTEXT_TOKEN');
    const sourceBytes = await physicalLog(first.directory, source.sessionId);
    const service = await mountWorkflow(first.ctx, first.directory);
    const imported = (await service.importSession({ sessionId: source.sessionId })).workflow;
    const saved = await service.save({ expectedRevision: imported.revision, workflow: { ...imported,
      nodes: [...imported.nodes,
        { id: 'common-a', title: 'Common A', instruction: 'CANVAS_COMMON_A_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 450, y: 100 } },
        { id: 'left-b', title: 'Left B', instruction: 'CANVAS_LEFT_B_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 850, y: 0 } },
        { id: 'right-c', title: 'Right C', instruction: 'CANVAS_RIGHT_C_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 850, y: 250 } },
      ], edges: [
        { id: 'a-b', source: 'common-a', target: 'left-b', type: 'dependency' },
        { id: 'a-c', source: 'common-a', target: 'right-c', type: 'dependency' },
      ],
    } });
    if (!saved.ok) throw new Error('Expected native canvas fan-out graph');
    const queued = await service.batchRun({ workflowId: imported.id, nodeIds: ['left-b', 'right-c'], nodeRevisions: { 'left-b': 1, 'right-c': 1 }, operationId: 'queue-canvas-siblings' });
    expect(queued.workflow.executions).toHaveLength(2);
    expect(queued.workflow.executions!.every(run => run.status === 'waiting' && run.startSeq === undefined)).toBe(true);
    const queuedRequests = queued.workflow.executions!.map(run => run.requestId);
    expect(first.model.calls).toHaveLength(1); // Only the source, before any workflow authorization can execute.
    await first.ctx.fiber.dispose();

    const second = await open(first.directory);
    const resumed = await mountWorkflow(second.ctx, first.directory);
    expect(second.model.calls).toHaveLength(0);
    await resumed.run({ workflowId: imported.id, nodeId: 'common-a', operationId: 'run-canvas-common' });
    await vi.waitFor(async () => expect((await resumed.get({ id: imported.id })).workflow!.executions!.every(run => run.status === 'completed' && run.durability === 'durable')).toBe(true), { timeout: 5000, interval: 20 });
    const done = (await resumed.get({ id: imported.id })).workflow!;
    const common = done.executions!.find(run => run.nodeId === 'common-a')!;
    const left = done.executions!.find(run => run.nodeId === 'left-b')!;
    const right = done.executions!.find(run => run.nodeId === 'right-c')!;
    expect(second.model.calls).toHaveLength(3);
    expect(new Set([common.sessionId, left.sessionId, right.sessionId]).size).toBe(3);
    for (const run of [left, right]) {
      const branch = done.branches!.find(item => item.id === run.branchId)!;
      expect(branch).toMatchObject({ automatic: true, sourceSessionId: common.sessionId, forkFromNodeId: common.nodeId, forkBoundarySeq: common.endSeq });
      const log = await second.runtime.read(run.sessionId);
      expect(log.header.parentSession).toBe(common.sessionId);
      expect(log.inheritedEventCount).toBe(common.endSeq! + 1);
      expect(log.events.filter(event => event.type === 'user/message' && (event.data.source as { rpcId?: string }).rpcId === run.requestId)).toHaveLength(1);
    }
    expect([left.requestId, right.requestId].sort()).toEqual([...queuedRequests].sort());
    const leftContext = modelContextFor(second.model, 'CANVAS_LEFT_B_TOKEN');
    const rightContext = modelContextFor(second.model, 'CANVAS_RIGHT_C_TOKEN');
    for (const context of [leftContext, rightContext]) {
      expect(context).toContain('CANVAS_SOURCE_CONTEXT_TOKEN');
      expect(context).toContain('CANVAS_COMMON_A_TOKEN');
    }
    expect(leftContext).not.toContain('CANVAS_RIGHT_C_TOKEN');
    expect(rightContext).not.toContain('CANVAS_LEFT_B_TOKEN');
    expect(done.activeBranchId).toBe(common.branchId); // Automatic paths keep the manual overview selected.
    expect(await physicalLog(first.directory, source.sessionId)).toEqual(sourceBytes);
    const sessionBytes = new Map(await Promise.all([common, left, right].map(async run => [run.sessionId, await physicalLog(first.directory, run.sessionId)] as const)));
    const mapping = done.executions!.map(run => ({ runId: run.runId, sessionId: run.sessionId, branchId: run.branchId, requestId: run.requestId }));
    await second.ctx.fiber.dispose();

    const third = await open(first.directory);
    const recovered = await mountWorkflow(third.ctx, first.directory);
    expect((await recovered.get({ id: imported.id })).workflow!.executions!.map(run => ({ runId: run.runId, sessionId: run.sessionId, branchId: run.branchId, requestId: run.requestId }))).toEqual(mapping);
    const duplicate = await recovered.batchRun({ workflowId: imported.id, nodeIds: ['left-b', 'right-c'], nodeRevisions: { 'left-b': 1, 'right-c': 1 }, operationId: 'queue-canvas-siblings' });
    expect(duplicate.runIds).toEqual(queued.runIds);
    expect((await recovered.run({ workflowId: imported.id, nodeId: 'common-a', operationId: 'run-canvas-common' })).runId).toBe(common.runId);
    expect(third.model.calls).toHaveLength(0);
    for (const [sessionId, bytes] of sessionBytes) expect(await physicalLog(first.directory, sessionId)).toEqual(bytes);
    expect(await physicalLog(first.directory, source.sessionId)).toEqual(sourceBytes);

    // Each later linear child must resume its own sibling Session, including
    // after a cold restart while the manual overview remains selected.
    await updateNativeTestGraph(recovered, imported.id, current => ({ ...current,
      nodes: [...current.nodes,
        { id: 'left-next', title: 'Left next', instruction: 'CANVAS_LEFT_CONTINUATION_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 1250, y: 0 } },
        { id: 'right-next', title: 'Right next', instruction: 'CANVAS_RIGHT_CONTINUATION_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 1250, y: 250 } },
      ], edges: [...current.edges,
        { id: 'b-next', source: 'left-b', target: 'left-next', type: 'dependency' },
        { id: 'c-next', source: 'right-c', target: 'right-next', type: 'dependency' },
      ],
    }));
    await recovered.batchRun({ workflowId: imported.id, nodeIds: ['left-next', 'right-next'], nodeRevisions: { 'left-next': 1, 'right-next': 1 }, operationId: 'continue-both-canvas-siblings' });
    await vi.waitFor(async () => expect((await recovered.get({ id: imported.id })).workflow!.executions!.every(run => run.status === 'completed' && run.durability === 'durable')).toBe(true), { timeout: 5000, interval: 20 });
    const continued = (await recovered.get({ id: imported.id })).workflow!;
    expect(continued.executions!.find(run => run.nodeId === 'left-next')).toMatchObject({ sessionId: left.sessionId, branchId: left.branchId });
    expect(continued.executions!.find(run => run.nodeId === 'right-next')).toMatchObject({ sessionId: right.sessionId, branchId: right.branchId });
    const leftNextContext = modelContextFor(third.model, 'CANVAS_LEFT_CONTINUATION_TOKEN');
    const rightNextContext = modelContextFor(third.model, 'CANVAS_RIGHT_CONTINUATION_TOKEN');
    expect(leftNextContext).toContain('CANVAS_LEFT_B_TOKEN');
    expect(leftNextContext).not.toContain('CANVAS_RIGHT_C_TOKEN');
    expect(leftNextContext).not.toContain('CANVAS_RIGHT_CONTINUATION_TOKEN');
    expect(rightNextContext).toContain('CANVAS_RIGHT_C_TOKEN');
    expect(rightNextContext).not.toContain('CANVAS_LEFT_B_TOKEN');
    expect(rightNextContext).not.toContain('CANVAS_LEFT_CONTINUATION_TOKEN');
    expect(third.model.calls).toHaveLength(2);
    expect(await physicalLog(first.directory, common.sessionId)).toEqual(sessionBytes.get(common.sessionId));
    expect(await physicalLog(first.directory, source.sessionId)).toEqual(sourceBytes);
  }, 15000);

  it('forks a new historical canvas path before future context and preserves the original linear continuation', async () => {
    const { ctx, runtime, directory, model } = await open();
    const source = await runtime.create({ cwd: directory });
    await execute(runtime, source.sessionId, 'history-source', 'HISTORY_SOURCE_CONTEXT_TOKEN');
    const sourceBytes = await physicalLog(directory, source.sessionId);
    const service = await mountWorkflow(ctx, directory);
    const imported = (await service.importSession({ sessionId: source.sessionId })).workflow;
    const saved = await service.save({ expectedRevision: imported.revision, workflow: { ...imported,
      nodes: [...imported.nodes,
        { id: 'history-a', title: 'History A', instruction: 'HISTORY_COMMON_A_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 450, y: 100 } },
        { id: 'history-b', title: 'History B', instruction: 'HISTORY_COMMON_B_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 850, y: 100 } },
        { id: 'history-c', title: 'History C', instruction: 'HISTORY_FUTURE_C_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 1250, y: 100 } },
      ], edges: [
        { id: 'history-a-b', source: 'history-a', target: 'history-b', type: 'dependency' },
        { id: 'history-b-c', source: 'history-b', target: 'history-c', type: 'dependency' },
      ],
    } });
    if (!saved.ok) throw new Error('Expected native historical linear graph');
    await service.batchRun({ workflowId: imported.id, nodeIds: ['history-c', 'history-b', 'history-a'], nodeRevisions: { 'history-a': 1, 'history-b': 1, 'history-c': 1 }, operationId: 'run-original-history-line' });
    await vi.waitFor(async () => expect((await service.get({ id: imported.id })).workflow!.executions!.every(run => run.status === 'completed' && run.durability === 'durable')).toBe(true), { timeout: 5000, interval: 20 });
    const linear = (await service.get({ id: imported.id })).workflow!;
    const a = linear.executions!.find(run => run.nodeId === 'history-a')!;
    const b = linear.executions!.find(run => run.nodeId === 'history-b')!;
    const c = linear.executions!.find(run => run.nodeId === 'history-c')!;
    expect(new Set([a.sessionId, b.sessionId, c.sessionId]).size).toBe(1);
    const linearBytes = await physicalLog(directory, c.sessionId);
    await updateNativeTestGraph(service, imported.id, current => ({ ...current,
      nodes: [...current.nodes, { id: 'history-d', title: 'History D', instruction: 'HISTORY_SIBLING_D_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 1250, y: 350 } }],
      edges: [...current.edges, { id: 'history-b-d', source: 'history-b', target: 'history-d', type: 'dependency' }],
    }));
    const admitted = await service.run({ workflowId: imported.id, nodeId: 'history-d', operationId: 'run-historical-sibling' });
    await vi.waitFor(async () => expect((await service.get({ id: imported.id })).workflow!.executions!.find(run => run.runId === admitted.runId)).toMatchObject({ status: 'completed', durability: 'durable' }), { timeout: 5000, interval: 20 });
    const branched = (await service.get({ id: imported.id })).workflow!;
    const d = branched.executions!.find(run => run.runId === admitted.runId)!;
    expect(d.sessionId).not.toBe(c.sessionId);
    expect(branched.branches!.find(branch => branch.id === d.branchId)).toMatchObject({ automatic: true, sourceSessionId: b.sessionId, forkFromNodeId: b.nodeId, forkBoundarySeq: b.endSeq });
    const dLog = await runtime.read(d.sessionId);
    expect(dLog.header.parentSession).toBe(b.sessionId);
    expect(dLog.inheritedEventCount).toBe(b.endSeq! + 1);
    const dContext = modelContextFor(model, 'HISTORY_SIBLING_D_TOKEN');
    expect(dContext).toContain('HISTORY_SOURCE_CONTEXT_TOKEN');
    expect(dContext).toContain('HISTORY_COMMON_A_TOKEN');
    expect(dContext).toContain('HISTORY_COMMON_B_TOKEN');
    expect(dContext).not.toContain('HISTORY_FUTURE_C_TOKEN');
    expect(await physicalLog(directory, c.sessionId)).toEqual(linearBytes);
    expect(await physicalLog(directory, source.sessionId)).toEqual(sourceBytes);
    const dBytes = await physicalLog(directory, d.sessionId);

    await updateNativeTestGraph(service, imported.id, current => ({ ...current,
      nodes: [...current.nodes, { id: 'history-e', title: 'History E', instruction: 'HISTORY_CONTINUE_E_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 1650, y: 100 } }],
      edges: [...current.edges, { id: 'history-c-e', source: 'history-c', target: 'history-e', type: 'dependency' }],
    }));
    const continued = await service.run({ workflowId: imported.id, nodeId: 'history-e', operationId: 'continue-original-history-line' });
    await vi.waitFor(async () => expect((await service.get({ id: imported.id })).workflow!.executions!.find(run => run.runId === continued.runId)).toMatchObject({ status: 'completed', durability: 'durable' }), { timeout: 5000, interval: 20 });
    const e = (await service.get({ id: imported.id })).workflow!.executions!.find(run => run.runId === continued.runId)!;
    expect(e.sessionId).toBe(c.sessionId);
    const eContext = modelContextFor(model, 'HISTORY_CONTINUE_E_TOKEN');
    for (const token of ['HISTORY_SOURCE_CONTEXT_TOKEN', 'HISTORY_COMMON_A_TOKEN', 'HISTORY_COMMON_B_TOKEN', 'HISTORY_FUTURE_C_TOKEN']) expect(eContext).toContain(token);
    expect(eContext).not.toContain('HISTORY_SIBLING_D_TOKEN');
    expect(await physicalLog(directory, d.sessionId)).toEqual(dBytes);
    expect(await physicalLog(directory, source.sessionId)).toEqual(sourceBytes);
  }, 15000);

  it('fails a cross-Session canvas merge before native admission and preserves that explicit empty trace after restart', async () => {
    const first = await open();
    const source = await first.runtime.create({ cwd: first.directory });
    await execute(first.runtime, source.sessionId, 'merge-source', 'MERGE_SOURCE_CONTEXT_TOKEN');
    const service = await mountWorkflow(first.ctx, first.directory);
    const imported = (await service.importSession({ sessionId: source.sessionId })).workflow;
    const saved = await service.save({ expectedRevision: imported.revision, workflow: { ...imported,
      nodes: [...imported.nodes,
        { id: 'merge-a', title: 'Merge common A', instruction: 'MERGE_COMMON_A_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 450, y: 100 } },
        { id: 'merge-b', title: 'Merge left B', instruction: 'MERGE_LEFT_B_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 850, y: 0 } },
        { id: 'merge-c', title: 'Merge right C', instruction: 'MERGE_RIGHT_C_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 850, y: 250 } },
        { id: 'merge-d', title: 'Merge D', instruction: 'MERGE_MUST_NOT_DISPATCH_D_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 1250, y: 100 } },
      ], edges: [
        { id: 'merge-a-b', source: 'merge-a', target: 'merge-b', type: 'dependency' },
        { id: 'merge-a-c', source: 'merge-a', target: 'merge-c', type: 'dependency' },
        { id: 'merge-b-d', source: 'merge-b', target: 'merge-d', type: 'dependency' },
        { id: 'merge-c-d', source: 'merge-c', target: 'merge-d', type: 'dependency' },
      ],
    } });
    if (!saved.ok) throw new Error('Expected native cross-Session merge graph');
    await service.batchRun({ workflowId: imported.id, nodeIds: ['merge-a', 'merge-b', 'merge-c'], nodeRevisions: { 'merge-a': 1, 'merge-b': 1, 'merge-c': 1 }, operationId: 'run-independent-merge-prefixes' });
    await vi.waitFor(async () => expect((await service.get({ id: imported.id })).workflow!.executions!.every(run => run.status === 'completed' && run.durability === 'durable')).toBe(true), { timeout: 5000, interval: 20 });
    const beforeMerge = (await service.get({ id: imported.id })).workflow!;
    const left = beforeMerge.executions!.find(run => run.nodeId === 'merge-b')!;
    const right = beforeMerge.executions!.find(run => run.nodeId === 'merge-c')!;
    expect(left.sessionId).not.toBe(right.sessionId);
    expect(modelContextFor(first.model, 'MERGE_LEFT_B_TOKEN')).not.toContain('MERGE_RIGHT_C_TOKEN');
    expect(modelContextFor(first.model, 'MERGE_RIGHT_C_TOKEN')).not.toContain('MERGE_LEFT_B_TOKEN');
    const sessionIds = [...new Set([source.sessionId, ...beforeMerge.branches!.map(branch => branch.sessionId)])];
    const beforeBytes = new Map(await Promise.all(sessionIds.map(async sessionId => [sessionId, await physicalLog(first.directory, sessionId)] as const)));
    const count = first.model.calls.length;
    const rejected = await service.run({ workflowId: imported.id, nodeId: 'merge-d', operationId: 'reject-cross-session-merge' });
    await vi.waitFor(async () => expect((await service.get({ id: imported.id })).workflow!.executions!.find(run => run.runId === rejected.runId)).toMatchObject({ status: 'failed', durability: 'durable', terminalReason: 'context-isolation-required' }), { timeout: 5000, interval: 20 });
    const failed = (await service.get({ id: imported.id })).workflow!.executions!.find(run => run.runId === rejected.runId)!;
    expect(failed.startSeq).toBeUndefined();
    expect(failed.endSeq).toBeUndefined();
    expect(failed.error).toBeTruthy();
    expect(first.model.calls).toHaveLength(count);
    expect(first.model.calls.some(call => JSON.stringify(call.messages).includes('MERGE_MUST_NOT_DISPATCH_D_TOKEN'))).toBe(false);
    const trace = (await service.trace({ workflowId: imported.id, runId: failed.runId })).trace;
    expect(trace).toMatchObject({ status: 'failed', terminalReason: 'context-isolation-required', steps: [] });
    for (const [sessionId, bytes] of beforeBytes) expect(await physicalLog(first.directory, sessionId)).toEqual(bytes);
    expect((await service.get({ id: imported.id })).workflow!.branches!.map(branch => ({ id: branch.id, sessionId: branch.sessionId }))).toEqual(beforeMerge.branches!.map(branch => ({ id: branch.id, sessionId: branch.sessionId })));
    await first.ctx.fiber.dispose();

    const second = await open(first.directory);
    const recovered = await mountWorkflow(second.ctx, first.directory);
    expect((await recovered.get({ id: imported.id })).workflow!.executions!.find(run => run.runId === failed.runId)).toMatchObject({ status: 'failed', durability: 'durable', terminalReason: 'context-isolation-required' });
    expect((await recovered.trace({ workflowId: imported.id, runId: failed.runId })).trace).toEqual(trace);
    expect((await recovered.run({ workflowId: imported.id, nodeId: 'merge-d', operationId: 'reject-cross-session-merge' })).runId).toBe(failed.runId);
    expect(second.model.calls).toHaveLength(0);
    for (const [sessionId, bytes] of beforeBytes) expect(await physicalLog(first.directory, sessionId)).toEqual(bytes);
  }, 15000);

  it.each(['ancestor-edit', 'ancestor-rerun'] as const)('waits for fresh native intermediate inputs after %s and records the exact execution lineage', async change => {
    const { ctx, runtime, directory, model } = await open();
    const source = await runtime.create({ cwd: directory });
    await execute(runtime, source.sessionId, 'freshness-source', 'FRESHNESS_IMMUTABLE_SOURCE_TOKEN');
    const sourceBytes = await physicalLog(directory, source.sessionId);
    const service = await mountWorkflow(ctx, directory);
    const imported = (await service.importSession({ sessionId: source.sessionId })).workflow;
    await updateNativeTestGraph(service, imported.id, current => ({ ...current,
      nodes: [...current.nodes,
        { id: 'fresh-a', title: 'Fresh A', instruction: 'FRESHNESS_A_VERSION_ONE_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 450, y: 100 } },
        { id: 'fresh-b', title: 'Fresh B', instruction: 'FRESHNESS_INTERMEDIATE_B_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 850, y: 100 } },
        { id: 'fresh-c', title: 'Fresh C', instruction: 'FRESHNESS_DESCENDANT_C_TOKEN', source: 'user', status: 'draft', revision: 1, position: { x: 1250, y: 100 } },
      ], edges: [
        { id: 'fresh-a-b', source: 'fresh-a', target: 'fresh-b', type: 'dependency' },
        { id: 'fresh-b-c', source: 'fresh-b', target: 'fresh-c', type: 'dependency' },
      ],
    }));
    const prefix = await service.batchRun({ workflowId: imported.id, nodeIds: ['fresh-b', 'fresh-a'], nodeRevisions: { 'fresh-a': 1, 'fresh-b': 1 }, operationId: 'complete-initial-native-prefix' });
    await vi.waitFor(async () => expect((await service.get({ id: imported.id })).workflow!.executions!.filter(run => prefix.runIds.includes(run.runId)).every(run => run.status === 'completed' && run.durability === 'durable')).toBe(true), { timeout: 5000, interval: 20 });
    const original = (await service.get({ id: imported.id })).workflow!;
    const oldA = original.executions!.find(run => run.nodeId === 'fresh-a')!;
    const oldB = original.executions!.find(run => run.nodeId === 'fresh-b')!;
    const originalBytes = await physicalLog(directory, oldB.sessionId);
    expect(oldB.inputRunIds).toEqual([oldA.runId]);

    if (change === 'ancestor-edit') {
      await updateNativeTestGraph(service, imported.id, current => ({ ...current,
        nodes: current.nodes.map(node => node.id === 'fresh-a' ? { ...node, instruction: 'FRESHNESS_A_VERSION_TWO_TOKEN' } : node),
      }));
    } else {
      const rerun = await service.run({ workflowId: imported.id, nodeId: 'fresh-a', operationId: 'rerun-same-revision-native-ancestor' });
      await vi.waitFor(async () => expect((await service.get({ id: imported.id })).workflow!.executions!.find(run => run.runId === rerun.runId)).toMatchObject({ status: 'completed', durability: 'durable' }), { timeout: 5000, interval: 20 });
    }
    const before = model.calls.length;
    const queued = await service.run({ workflowId: imported.id, nodeId: 'fresh-c', operationId: 'queue-native-descendant-with-obsolete-intermediate' });
    expect(queued.workflow.executions!.find(run => run.runId === queued.runId)).toMatchObject({ status: 'waiting', waitingReason: 'stale_prerequisites' });
    expect(model.calls).toHaveLength(before);
    expect(model.calls.some(call => JSON.stringify(call.messages).includes('FRESHNESS_DESCENDANT_C_TOKEN'))).toBe(false);
    expect(await physicalLog(directory, oldB.sessionId)).toEqual(originalBytes);

    if (change === 'ancestor-edit') {
      await service.batchRun({ workflowId: imported.id, nodeIds: ['fresh-b', 'fresh-a'], nodeRevisions: { 'fresh-a': 2, 'fresh-b': 1 }, operationId: 'refresh-edited-native-prefix' });
    } else {
      await service.run({ workflowId: imported.id, nodeId: 'fresh-b', operationId: 'refresh-intermediate-for-rerun-ancestor' });
    }
    await vi.waitFor(async () => expect((await service.get({ id: imported.id })).workflow!.executions!.find(run => run.runId === queued.runId)).toMatchObject({ status: 'completed', durability: 'durable' }), { timeout: 5000, interval: 20 });
    const done = (await service.get({ id: imported.id })).workflow!;
    const freshA = done.executions!.findLast(run => run.nodeId === 'fresh-a')!;
    const freshB = done.executions!.findLast(run => run.nodeId === 'fresh-b')!;
    const c = done.executions!.find(run => run.runId === queued.runId)!;
    expect(freshA.runId).not.toBe(oldA.runId);
    expect(freshB.runId).not.toBe(oldB.runId);
    expect(freshA.inputRunIds).toEqual([]);
    expect(freshB.inputRunIds).toEqual([freshA.runId]);
    expect(c.inputRunIds).toEqual([freshB.runId]);
    expect(new Set([freshA.sessionId, freshB.sessionId, c.sessionId]).size).toBe(1);
    expect(c.sessionId).not.toBe(oldB.sessionId);
    const context = modelContextFor(model, 'FRESHNESS_DESCENDANT_C_TOKEN');
    expect(context).toContain('FRESHNESS_IMMUTABLE_SOURCE_TOKEN');
    expect(context).toContain(freshA.requestId);
    expect(context).toContain(freshB.requestId);
    expect(context).not.toContain(oldA.requestId);
    expect(context).not.toContain(oldB.requestId);
    if (change === 'ancestor-edit') {
      expect(context).toContain('FRESHNESS_A_VERSION_TWO_TOKEN');
      expect(context).not.toContain('FRESHNESS_A_VERSION_ONE_TOKEN');
    } else expect(freshA.nodeRevision).toBe(oldA.nodeRevision);
    expect(await physicalLog(directory, oldB.sessionId)).toEqual(originalBytes);
    expect(await physicalLog(directory, source.sessionId)).toEqual(sourceBytes);
    const durable = JSON.parse(await readFile(join(directory, 'workflow-storage', 'visual_workflow.json'), 'utf8')).tables.workflows[imported.id];
    expect(durable.executions.find((run: { runId: string }) => run.runId === c.runId).inputRunIds).toEqual([freshB.runId]);
  }, 15000);

  it('forks two independent native Sessions without changing the source and restores trace after restart', async () => {
    const first = await open();
    const source = await first.runtime.create({ cwd: first.directory });
    const seen: string[] = [];
    const unsubscribe = first.runtime.subscribe((id, event) => seen.push(`${id}:${event.type}`));
    const sourceLog = await execute(first.runtime, source.sessionId, 'source-request', 'ORIGINAL');
    expect(projectExecution(sourceLog, { runId: 'source', requestId: 'source-request' })).toMatchObject({ status: 'completed', assistantText: 'Native answer: ORIGINAL' });
    const sourceBefore = JSON.stringify(sourceLog);
    const sourceBytes = await physicalLog(first.directory, source.sessionId);
    const atSeq = completedBoundary(sourceLog)!;
    const left = await first.runtime.fork({ sessionId: source.sessionId, atSeq });
    const right = await first.runtime.fork({ sessionId: source.sessionId, atSeq });
    expect(new Set([source.sessionId, left.sessionId, right.sessionId]).size).toBe(3);
    const [leftLog, rightLog] = await Promise.all([
      execute(first.runtime, left.sessionId, 'left-request', 'LEFT'),
      execute(first.runtime, right.sessionId, 'right-request', 'RIGHT'),
    ]);
    expect(leftLog.header).toMatchObject({ parentSession: source.sessionId, isSeeded: true });
    expect(leftLog.inheritedEventCount).toBe(atSeq + 1);
    expect(leftLog.events.slice(0, atSeq + 1)).toEqual(sourceLog.events.slice(0, atSeq + 1));
    const leftProjection = projectExecution(leftLog, { runId: 'left-run', requestId: 'left-request' });
    expect(leftProjection).toMatchObject({ status: 'completed', assistantText: 'Native answer: LEFT' });
    expect(projectExecution(rightLog, { runId: 'right-run', requestId: 'right-request' })).toMatchObject({ status: 'completed', assistantText: 'Native answer: RIGHT' });
    expect(JSON.stringify(leftLog)).not.toContain('right-request');
    expect(JSON.stringify(rightLog)).not.toContain('left-request');
    expect(JSON.stringify(await first.runtime.read(source.sessionId))).toBe(sourceBefore);
    expect(await physicalLog(first.directory, source.sessionId)).toEqual(sourceBytes);
    expect(seen).toContain(`${left.sessionId}:user/message`);
    expect(seen).toContain(`${left.sessionId}:turn/end`);
    unsubscribe();
    await first.ctx.fiber.dispose();

    const second = await open(first.directory);
    expect(second.ctx.agents.get(SessionId(source.sessionId))).toBeUndefined();
    const restored = await second.runtime.read(left.sessionId);
    expect(projectExecution(restored, { runId: 'left-run', requestId: 'left-request' })).toEqual(leftProjection);
    expect(second.ctx.agents.get(SessionId(left.sessionId))).toBeUndefined(); // Cold read did not resume/write.
    expect((await second.runtime.read(source.sessionId)).events).toEqual(sourceLog.events);
    expect(await physicalLog(first.directory, source.sessionId)).toEqual(sourceBytes);
    expect((await second.runtime.catalog()).map(item => item.sessionId)).toEqual(expect.arrayContaining([source.sessionId, left.sessionId, right.sessionId]));
  });

  it('uses native tool events and a monotonic planning guard before tool bodies', async () => {
    const { ctx, runtime, directory } = await open();
    let bodies = 0;
    ctx.tools.register({ name: 'fixture_write', description: 'Controlled side-effect counter', parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async () => { bodies++; return 'recorded output'; } });
    const ordinary = await runtime.create({ cwd: directory });
    const logged = await execute(runtime, ordinary.sessionId, 'ordinary-request', 'CALL_TOOL');
    expect(bodies).toBe(1);
    const projected = projectExecution(logged, { runId: 'ordinary-run', requestId: 'ordinary-request' });
    const tool = projected.steps.find(step => step.type === 'tool_call')!;
    expect(tool).toMatchObject({ status: 'completed', toolName: 'fixture_write' });
    expect(readTraceStepDetails(logged, projected, tool.stepId)).toMatchObject({ input: '{}', output: 'recorded output' });

    const planner = await runtime.fork({ sessionId: ordinary.sessionId, atSeq: completedBoundary(logged)! });
    const planned = await execute(runtime, planner.sessionId, 'planning-request', 'CALL_TOOL planning', true);
    expect(bodies).toBe(1); // Attempted native tool call was denied before the body.
    expect(projectExecution(planned, { runId: 'planner', requestId: 'planning-request' }).steps.some(step => step.status === 'failed')).toBe(true);
    expect(JSON.stringify(planned)).toContain('Workflow plan generation cannot execute tools before plan approval');
    expect(JSON.stringify(await runtime.read(ordinary.sessionId))).toBe(JSON.stringify(logged));
    await ctx.fiber.dispose();

    const resumed = await open(directory);
    resumed.ctx.tools.register({ name: 'fixture_write', description: 'Counter after native resume', parameters: { type: 'object' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async () => { bodies++; return 'must not execute after planning resume'; } });
    resumed.runtime.protectPlanning(planner.sessionId); // Recovered durable plan identity.
    // No planning flag on this admission: the native agent/created hook must
    // already reapply the guard before the resumed Agent can drive any inbox.
    const afterRestart = await execute(resumed.runtime, planner.sessionId, 'planning-after-restart', 'CALL_TOOL resumed planning');
    expect(bodies).toBe(1);
    expect(JSON.stringify(afterRestart)).toContain('Workflow plan generation cannot execute tools before plan approval');
  });

  it('removes only the queued rpcId occurrence and leaves the active and unrelated queued requests intact', async () => {
    const { runtime, directory, model } = await open();
    let release!: () => void;
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    model.hold = { started, wait: new Promise<void>(resolve => { release = resolve; }) };
    const { sessionId } = await runtime.create({ cwd: directory });
    await runtime.submit({ sessionId, requestId: 'active-request', text: 'HOLD_ACTIVE' });
    await began;
    expect(runtime.isRunning(sessionId)).toBe(true);
    await runtime.submit({ sessionId, requestId: 'remove-request', text: 'REMOVE_ME' });
    await runtime.submit({ sessionId, requestId: 'other-request', text: 'KEEP_ME' });
    expect(await runtime.cancel(sessionId, 'remove-request')).toBe('queued');
    expect(await runtime.cancel(sessionId, 'not-present')).toBe('none');
    expect(runtime.isRunning(sessionId)).toBe(true);
    release();
    await runtime.waitForIdle(sessionId);
    await runtime.flush(sessionId);
    const log = await runtime.read(sessionId);
    expect(projectExecution(log, { runId: 'active', requestId: 'active-request' }).status).toBe('completed');
    expect(projectExecution(log, { runId: 'other', requestId: 'other-request' })).toMatchObject({ status: 'completed', assistantText: 'Native answer: KEEP_ME' });
    expect(log.events.filter(event => event.type === 'user/message').map(event => event.data.source)).not.toContainEqual({ kind: 'user', rpcId: 'remove-request' });
    expect(model.calls.some(call => JSON.stringify(call.messages).includes('REMOVE_ME'))).toBe(false);
  });

  it('integrates plan approval, Execution projection, historical branches and durable Workflow restart', async () => {
    const first = await open();
    const source = await first.runtime.create({ cwd: first.directory });
    await execute(first.runtime, source.sessionId, 'source', 'Original conversation');
    const originalBytes = await physicalLog(first.directory, source.sessionId);
    const service = await mountWorkflow(first.ctx, first.directory);
    const imported = (await service.importSession({ sessionId: source.sessionId })).workflow;
    const requested = await service.generatePlan({ workflowId: imported.id, goal: 'Inspect and report', operationId: 'make-native-plan' });
    await vi.waitFor(async () => expect((await service.get({ id: imported.id })).workflow!.plans![0]!.status).toBe('proposed'));
    const proposed = (await service.get({ id: imported.id })).workflow!.plans![0]!;
    expect(proposed.sessionId).not.toBe(source.sessionId);
    expect(proposed.tasks).toHaveLength(2);
    await expect(service.applyPlan({ workflowId: imported.id, planId: requested.planId!, accept: true, taskIds: ['report'] })).rejects.toThrow(/prerequisite/);
    const accepted = (await service.applyPlan({ workflowId: imported.id, planId: requested.planId!, accept: true })).workflow;
    const task = accepted.nodes.find(node => node.title === 'Inspect')!;
    expect(task.status).toBe('draft');
    // A Run click is the authorization for this exact task revision. No
    // separate per-task approval step is required after accepting a plan.
    const admitted = await service.run({ workflowId: imported.id, nodeId: task.id, operationId: 'native-run' });
    await vi.waitFor(async () => expect((await service.get({ id: imported.id })).workflow!.executions![0]!).toMatchObject({ status: 'completed', durability: 'durable' }));
    const done = (await service.get({ id: imported.id })).workflow!;
    const run = done.executions![0]!;
    expect(run.sessionId).not.toBe(source.sessionId);
    expect(run.runId).toBe(admitted.runId);
    const trace = (await service.trace({ workflowId: imported.id, runId: run.runId })).trace;
    expect(trace).toMatchObject({ status: 'completed', summary: 'Native answer: Task: Inspect\n\nInspect current APIs' });
    expect(trace.steps.length).toBeGreaterThan(0);
    const left = await service.fork({ workflowId: imported.id, runId: run.runId, label: 'Left', operationId: 'left-native' });
    const right = await service.fork({ workflowId: imported.id, runId: run.runId, label: 'Right', operationId: 'right-native' });
    const leftBranch = right.workflow.branches!.find(branch => branch.id === left.branchId)!;
    const rightBranch = right.workflow.branches!.find(branch => branch.id === right.branchId)!;
    expect(new Set([run.sessionId, leftBranch.sessionId, rightBranch.sessionId]).size).toBe(3);
    expect(leftBranch.forkBoundarySeq).toBe(run.endSeq);
    expect(rightBranch.nodeIds).toContain(task.id);
    expect(right.workflow.nodes.filter(node => node.id === task.id)).toHaveLength(1);
    expect(right.workflow.executions!.filter(item => item.runId === run.runId)).toHaveLength(1);
    expect(await physicalLog(first.directory, source.sessionId)).toEqual(originalBytes);
    const persisted = await readFile(join(first.directory, 'workflow-storage', 'visual_workflow.json'), 'utf8');
    expect(persisted).not.toContain('"stream"');
    expect(persisted).not.toContain('"arguments"');
    await first.ctx.fiber.dispose();

    const second = await open(first.directory);
    const restoredService = await mountWorkflow(second.ctx, first.directory);
    const restored = (await restoredService.get({ id: imported.id })).workflow!;
    expect(restored.branches!.map(branch => branch.sessionId)).toEqual(right.workflow.branches!.map(branch => branch.sessionId));
    expect((await restoredService.trace({ workflowId: imported.id, runId: run.runId })).trace).toEqual(trace);
    expect(second.ctx.agents.list()).toEqual([]); // Recovery uses cold native reads.
    expect(await physicalLog(first.directory, source.sessionId)).toEqual(originalBytes);
  });

  it('projects actual pending native approvals and records the exact decision', async () => {
    const { ctx, runtime, directory } = await open();
    await ctx.plugin(ApprovalService, { policy: 'ask' });
    let decide!: (value: 'allowed-once') => void;
    ctx.on('approval/request', () => new Promise(resolve => { decide = resolve; }));
    ctx.on('tools/pre-execute', async (exec, next) => exec.name === 'fixture_write' ? { kind: 'ask', reason: 'Fixture permission question' } : next());
    let bodies = 0;
    ctx.tools.register({ name: 'fixture_write', description: 'Counter behind actual native approval', parameters: { type: 'object' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async () => { bodies++; return 'approved output'; } });
    const { sessionId } = await runtime.create({ cwd: directory });
    await runtime.submit({ sessionId, requestId: 'approval-request', text: 'CALL_TOOL approval' });
    await vi.waitFor(() => expect(decide).toBeTypeOf('function'));
    const pending = await runtime.read(sessionId);
    expect(projectExecution(pending, { runId: 'approval-run', requestId: 'approval-request', running: true }).status).toBe('waiting_approval');
    expect(bodies).toBe(0);
    decide('allowed-once');
    await runtime.waitForIdle(sessionId);
    await runtime.flush(sessionId);
    const settled = await runtime.read(sessionId);
    const projection = projectExecution(settled, { runId: 'approval-run', requestId: 'approval-request' });
    expect(projection.status).toBe('completed');
    expect(projection.steps.find(step => step.type === 'approval')).toMatchObject({ status: 'completed' });
    expect(bodies).toBe(1);
  });

  it('persists explicit Run clicks, waits for dependencies without native admission, then produces dynamic proposals', async () => {
    const { ctx, runtime, directory, model } = await open();
    const source = await runtime.create({ cwd: directory });
    await execute(runtime, source.sessionId, 'auto-source', 'Immutable source conversation');
    const sourceBytes = await physicalLog(directory, source.sessionId);
    const service = await mountWorkflow(ctx, directory);
    const imported = (await service.importSession({ sessionId: source.sessionId })).workflow;
    const saved = await service.save({ expectedRevision: imported.revision, workflow: {
      ...imported, settings: { generation: 'dynamic', execution: 'auto' },
      nodes: [...imported.nodes,
        { id: 'auto-first', title: 'Auto first', instruction: 'HOLD_ACTIVE first approved task', source: 'user', status: 'draft', revision: 1, position: { x: 450, y: 100 } },
        { id: 'auto-second', title: 'Auto second', instruction: 'Report after first task completes', source: 'user', status: 'draft', revision: 1, position: { x: 850, y: 100 } },
      ],
      edges: [{ id: 'auto-order', source: 'auto-first', target: 'auto-second', type: 'dependency' }],
    } });
    expect(saved.ok).toBe(true);
    let firstStarted = false;
    let release!: () => void;
    model.hold = { started: () => { firstStarted = true; }, wait: new Promise<void>(resolve => { release = resolve; }) };
    const queued = await service.run({ workflowId: imported.id, nodeId: 'auto-second', operationId: 'click-downstream' });
    const waiting = queued.workflow.executions!.find(run => run.runId === queued.runId)!;
    expect(waiting).toMatchObject({ nodeId: 'auto-second', status: 'waiting', turns: [] });
    expect(waiting.startSeq).toBeUndefined();
    expect((await service.trace({ workflowId: imported.id, runId: waiting.runId })).trace).toMatchObject({ status: 'waiting', steps: [] });
    expect(model.calls).toHaveLength(1); // The original source turn is the only model request so far.
    await service.run({ workflowId: imported.id, nodeId: 'auto-first', operationId: 'click-prerequisite' });
    await vi.waitFor(() => expect(firstStarted).toBe(true), { timeout: 5000, interval: 20 });
    const duringFirst = (await service.get({ id: imported.id })).workflow!;
    expect(duringFirst.executions).toHaveLength(2);
    expect(duringFirst.executions!.find(run => run.nodeId === 'auto-second')!.status).toBe('waiting');
    expect(model.calls.some(call => call.messages.some(message => message.role === 'user' &&
      'source' in message && message.source?.kind === 'user' && message.content.some(block => block.type === 'text' && block.text.startsWith('Task: Auto second'))))).toBe(false);
    release();
    model.hold = undefined;
    await vi.waitFor(async () => {
      const workflow = (await service.get({ id: imported.id })).workflow!;
      expect(workflow.executions).toHaveLength(2);
      expect(workflow.executions!.every(run => run.status === 'completed' && run.durability === 'durable')).toBe(true);
      expect(workflow.plans!.filter(plan => plan.status === 'proposed')).toHaveLength(2);
    }, { timeout: 5000, interval: 20 });
    const workflow = (await service.get({ id: imported.id })).workflow!;
    const first = workflow.executions!.find(run => run.nodeId === 'auto-first')!;
    const second = workflow.executions!.find(run => run.nodeId === 'auto-second')!;
    expect(first.sessionId).toBe(second.sessionId);
    expect(first.sessionId).not.toBe(source.sessionId);
    expect(first.endSeq).toBeLessThan(second.startSeq!);
    expect(first.admissionPolicies).toEqual({ generation: 'dynamic', execution: 'auto' });
    expect(second.admissionPolicies).toEqual({ generation: 'dynamic', execution: 'auto' });
    expect(workflow.plans!.some(plan => plan.triggerRunId === second.runId && plan.status === 'proposed')).toBe(true);
    expect(new Set(workflow.plans!.map(plan => plan.triggerRunId)).size).toBe(2);
    expect(workflow.nodes).toHaveLength(3); // Proposed follow-ups were never accepted into the graph.
    expect(workflow.plans!.every(plan => plan.sessionId !== source.sessionId && plan.sessionId !== first.sessionId)).toBe(true);
    const events = (await runtime.read(first.sessionId)).events;
    const actualRequestOrder = events.filter(event => event.type === 'user/message').map(event => (event.data.source as { rpcId?: string }).rpcId);
    expect(actualRequestOrder.indexOf(first.requestId)).toBeLessThan(actualRequestOrder.indexOf(second.requestId));
    expect(await physicalLog(directory, source.sessionId)).toEqual(sourceBytes);
  }, 10000);

  it('cancels or invalidates waiting revisions before any native prompt is submitted', async () => {
    const { ctx, runtime, directory, model } = await open();
    const service = await mountWorkflow(ctx, directory);
    const initial = (await service.create({ name: 'Queued cancellation' })).workflow;
    const saved = await service.save({ expectedRevision: initial.revision, workflow: { ...initial,
      nodes: [
        { id: 'gate', title: 'Prerequisite', instruction: 'Complete prerequisite', source: 'user', status: 'draft', revision: 1, position: { x: 100, y: 100 } },
        { id: 'cancelled', title: 'Cancel waiting', instruction: 'Must never be admitted', source: 'user', status: 'draft', revision: 1, position: { x: 500, y: 100 } },
        { id: 'edited', title: 'Edit waiting', instruction: 'Old revision must never be admitted', source: 'user', status: 'draft', revision: 1, position: { x: 900, y: 100 } },
      ], edges: [{ id: 'gate-cancelled', source: 'gate', target: 'cancelled', type: 'dependency' }, { id: 'gate-edited', source: 'gate', target: 'edited', type: 'dependency' }],
    } });
    expect(saved.ok).toBe(true);
    const cancelled = await service.run({ workflowId: initial.id, nodeId: 'cancelled', operationId: 'queued-cancel' });
    const revised = await service.run({ workflowId: initial.id, nodeId: 'edited', operationId: 'queued-edit' });
    expect(model.calls).toHaveLength(0);
    expect(revised.workflow.executions!.every(run => run.status === 'waiting')).toBe(true);
    await service.cancel({ workflowId: initial.id, runId: cancelled.runId! });
    const beforeEdit = (await service.get({ id: initial.id })).workflow!;
    const edit = await service.save({ expectedRevision: beforeEdit.revision, workflow: { ...beforeEdit,
      nodes: beforeEdit.nodes.map(node => node.id === 'edited' ? { ...node, instruction: 'New revision requires a new Run click' } : node),
    } });
    expect(edit.ok).toBe(true);
    await service.run({ workflowId: initial.id, nodeId: 'gate', operationId: 'run-gate' });
    await vi.waitFor(async () => expect((await service.get({ id: initial.id })).workflow!.executions!.find(run => run.nodeId === 'gate')!.status).toBe('completed'));
    const workflow = (await service.get({ id: initial.id })).workflow!;
    expect(workflow.executions!.find(run => run.runId === cancelled.runId)!.status).toBe('cancelled');
    expect(workflow.executions!.find(run => run.runId === revised.runId)!.status).toBe('cancelled');
    expect(workflow.nodes.find(node => node.id === 'edited')!.revision).toBe(2);
    expect(model.calls).toHaveLength(1);
    const sessionId = workflow.executions!.find(run => run.nodeId === 'gate')!.sessionId;
    const log = await runtime.read(sessionId);
    const requestIds = log.events.filter(event => event.type === 'user/message').map(event => (event.data.source as { rpcId?: string }).rpcId);
    expect(requestIds).not.toContain(workflow.executions!.find(run => run.runId === cancelled.runId)!.requestId);
    expect(requestIds).not.toContain(workflow.executions!.find(run => run.runId === revised.runId)!.requestId);
  });

  it('restores a waiting Run intent across Host restart and never resubmits a completed native request', async () => {
    const first = await open();
    const source = await first.runtime.create({ cwd: first.directory });
    await execute(first.runtime, source.sessionId, 'restart-source', 'Immutable restart source');
    const sourceBytes = await physicalLog(first.directory, source.sessionId);
    const service = await mountWorkflow(first.ctx, first.directory);
    const imported = (await service.importSession({ sessionId: source.sessionId })).workflow;
    const saved = await service.save({ expectedRevision: imported.revision, workflow: { ...imported,
      nodes: [...imported.nodes,
        { id: 'first', title: 'First', instruction: 'Run first after restart', source: 'user', status: 'draft', revision: 1, position: { x: 450, y: 100 } },
        { id: 'later', title: 'Later', instruction: 'Wait across restart', source: 'user', status: 'draft', revision: 1, position: { x: 850, y: 100 } },
      ], edges: [{ id: 'first-later', source: 'first', target: 'later', type: 'dependency' }],
    } });
    expect(saved.ok).toBe(true);
    const waiting = await service.run({ workflowId: imported.id, nodeId: 'later', operationId: 'durable-waiting' });
    expect(waiting.workflow.executions![0]!.status).toBe('waiting');
    const waitingRequest = waiting.workflow.executions![0]!.requestId;
    await first.ctx.fiber.dispose();

    const second = await open(first.directory);
    const restoredService = await mountWorkflow(second.ctx, first.directory);
    expect(second.model.calls).toHaveLength(0);
    expect((await restoredService.get({ id: imported.id })).workflow!.executions![0]).toMatchObject({ runId: waiting.runId, status: 'waiting', requestId: waitingRequest });
    const duplicate = await restoredService.run({ workflowId: imported.id, nodeId: 'later', operationId: 'durable-waiting' });
    expect(duplicate.runId).toBe(waiting.runId);
    await restoredService.run({ workflowId: imported.id, nodeId: 'first', operationId: 'after-restart' });
    await vi.waitFor(async () => expect((await restoredService.get({ id: imported.id })).workflow!.executions!.every(run => run.status === 'completed')).toBe(true), { timeout: 5000 });
    const completed = (await restoredService.get({ id: imported.id })).workflow!;
    expect(second.model.calls).toHaveLength(2);
    const branchSession = completed.executions![0]!.sessionId;
    const native = await second.runtime.read(branchSession);
    expect(native.events.filter(event => event.type === 'user/message' && (event.data.source as { rpcId?: string }).rpcId === waitingRequest)).toHaveLength(1);
    await second.ctx.fiber.dispose();

    const third = await open(first.directory);
    const recoveredService = await mountWorkflow(third.ctx, first.directory);
    expect((await recoveredService.get({ id: imported.id })).workflow!.executions!.every(run => run.status === 'completed')).toBe(true);
    expect(third.model.calls).toHaveLength(0);
    expect(await physicalLog(first.directory, source.sessionId)).toEqual(sourceBytes);
  }, 10000);
});
