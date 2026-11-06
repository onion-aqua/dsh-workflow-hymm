import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { openSync, readSync, closeSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model';
import SessionController from '@deepseek-ai/dsh-api-session-controller';
import SessionQueryEngine from '@deepseek-ai/dsh-session-query';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local';
import FileUploads from '@deepseek-ai/dsh-client-file-upload';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import * as FileTools from '@deepseek-ai/dsh-tool-fs';
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory';
import SubagentRuntime from '@deepseek-ai/dsh-subagent';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import LlmRuntime, { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { completedBoundary, DshNativeRuntime } from '../src/host/native-runtime.ts';
import type { NativeFileReference } from '../src/host/native-runtime.ts';
import VisualWorkflowService from '../src/host/service.ts';
import type { Workflow } from '../src/shared/model.ts';

const installedArchive='C:/Users/cheny/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
/** Read the installed rc.3 provider verbatim; no archive or installed files are changed. */
function installedFile(relative:string):Buffer{
  const fd=openSync(installedArchive,'r');
  try{
    const first=Buffer.alloc(16);readSync(fd,first,0,16,0);
    const header=Buffer.alloc(first.readUInt32LE(12));readSync(fd,header,0,header.length,16);
    type Entry={files?:Record<string,Entry>;size:number;offset:string;unpacked?:boolean};
    let entry=JSON.parse(header.toString()) as Entry;
    for(const part of relative.split('/'))entry=entry.files![part]!;
    if(entry.unpacked)return readFileSync(`${installedArchive}.unpacked/${relative}`);
    const bytes=Buffer.alloc(entry.size);readSync(fd,bytes,0,bytes.length,8+first.readUInt32LE(4)+Number(entry.offset));return bytes;
  }finally{closeSync(fd);}
}
class ExactReadQuery extends SessionQueryEngine{
  async searchSessions():Promise<never>{throw new Error('Search is unused by the native subagent fixture');}
  async searchEvents():Promise<never>{throw new Error('Search is unused by the native subagent fixture');}
}
class ControlledModel extends LlmAdapter{
  readonly calls:GenerateOptions[]=[];
  readonly taskAnswers=new Map<string,string>();
  async listModels(provider='fixture'){return ['default','model-a','model-b'].map(id=>({provider,id,name:`Controlled ${id}`}));}
  async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{
    options.signal?.throwIfAborted();this.calls.push(options);
    const prompt=options.messages.findLast(message=>message.role==='user'&&'source' in message&&message.source?.kind==='user')?.content.filter(block=>block.type==='text').map(block=>block.text).join('')??'';
    if(prompt.includes('HOLD_CHILD'))await new Promise<void>((_resolve,reject)=>{if(options.signal?.aborted)reject(options.signal.reason);else options.signal?.addEventListener('abort',()=>reject(options.signal!.reason),{once:true});});
    if(prompt.includes('READ_FILE')&&options.messages.at(-1)?.role!=='tool'){
      const path=prompt.match(/verbatim read-only copy saved at ("(?:\\.|[^"\\])*")/)?.[1];
      if(!path)throw new Error('Expected the real native attachment read path');
      const block={type:'tool-call' as const,id:ToolCallId(`native-child-read-${this.calls.length}`),name:'read',arguments:JSON.stringify({file_path:JSON.parse(path)})};
      yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};return;
    }
    const title=/^Task: ([^\n]+)/.exec(prompt)?.[1];
    const text=this.taskAnswers.get(title??'')??`Native child answer: ${prompt}`;
    yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
  }
}
const opened:Array<{ctx:Context;runtime:DshNativeRuntime;directory:string}>=[];
afterEach(async()=>{
  for(const {ctx,runtime,directory} of opened.splice(0).reverse()){
    await runtime.disposeSubagents();await ctx.fiber.dispose();await rm(directory,{recursive:true,force:true});
  }
});
async function open(native=true,existingDirectory?:string){
  // Keeping the copied released provider below this project lets its ordinary
  // package import resolve the same rc.3 dependencies as the integration host.
  const directory=existingDirectory??await mkdtemp(join(process.cwd(),'artifacts','native-subagent-'));
  const ctx=new Context();
  await ctx.plugin(TypertRegistry);await ctx.plugin(SessionStore);await ctx.plugin(AgentRegistry);await ctx.plugin(SessionProjections);await ctx.plugin(LlmRuntime);
  await ctx.plugin(SystemPrompt,{includeHarnessIdentity:false});await ctx.plugin(Tools,{mode:'native'});await ctx.plugin(JsonlPersistence,{root:join(directory,'sessions'),compression:'none'});await ctx.plugin(ExactReadQuery);await ctx.plugin(AgentDefaultModel,{provider:'fixture',model:'default'});
  const model=new ControlledModel();ctx.llm.registerAdapter(['fixture'],model);
  await ctx.plugin(LocalAttachmentStore,{dshHome:directory});await ctx.plugin(LocalFileSystem,{cwd:directory});await ctx.plugin(WorkingDirectoryService,{defaultDirectory:directory});await ctx.plugin(FileTools,{read:true,write:false,edit:false,readImage:false});
  ctx.provide('connection',{fetch:{register:()=>()=>{}}});ctx.provide('commands',{registerFileReceiptResolver:()=>()=>{}});await ctx.plugin(FileUploads);
  ctx.provide('remoteAccess',{allows:()=>true});ctx.provide('workspaceRegistry',{archivedSessionIds:[],list:()=>[],get:()=>undefined});await ctx.plugin(AgentLoop,{});await ctx.plugin(SessionController,{nativeOpen:false});
  if(native){
    const prefix='dsh/node_modules/@deepseek-ai/dsh-subagent-fork-in-process/';
    expect(JSON.parse(installedFile(`${prefix}package.json`).toString()).version).toBe('0.2.1-rc.3');
    const providerPath=join(directory,'released-fork-provider.mjs');await writeFile(providerPath,installedFile(`${prefix}lib/index.js`));
    const provider=await import(/* @vite-ignore */ pathToFileURL(providerPath).href);
    await ctx.plugin(SubagentRuntime,{});await ctx.plugin(provider,{providerName:'fork'});
  }
  const runtime=new DshNativeRuntime(ctx);opened.push({ctx,runtime,directory});return {ctx,runtime,directory,model};
}
async function sourceAndCoordinators(runtime:DshNativeRuntime,directory:string,count=2){
  const source=await runtime.create({cwd:directory});
  await runtime.submit({sessionId:source.sessionId,requestId:'native-source-baseline',text:'BASELINE_ONLY immutable original conversation',model:{provider:'fixture',model:'default'}});await runtime.waitForIdle(source.sessionId);await runtime.flush(source.sessionId);
  const log=await runtime.read(source.sessionId),boundary=completedBoundary(log)!;
  const coordinators=[];for(let i=0;i<count;i++)coordinators.push(await runtime.fork({sessionId:source.sessionId,atSeq:boundary}));
  return {source:source.sessionId,boundary,coordinators};
}
async function physical(directory:string,sessionId:string){
  const rows=await readdir(join(directory,'sessions'),{recursive:true,withFileTypes:true});const file=rows.find(row=>row.isFile()&&row.parentPath.endsWith(sessionId)&&row.name.endsWith('.jsonl'));
  if(!file)throw new Error('Expected released native JSONL persistence');return readFile(join(file.parentPath,file.name));
}
async function mountWorkflow(ctx:Context,directory:string){
  await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root:join(directory,'workflow-storage')});await ctx.plugin(StorageDomain,{backend:'json'});await ctx.plugin(VisualWorkflowService);
  await vi.waitFor(async()=>expect((await ctx.visualWorkflow.catalog()).sessions).toBeInstanceOf(Array));return ctx.visualWorkflow;
}
async function editWorkflow(service:VisualWorkflowService,id:string,transform:(workflow:Workflow)=>Workflow){
  for(let attempt=0;attempt<5;attempt++){
    const current=(await service.get({id})).workflow!;const saved=await service.save({workflow:transform(current),expectedRevision:current.revision});if(saved.ok)return saved.workflow;
  }
  throw new Error('Native test graph edit repeatedly raced execution projection');
}
describe('released rc.3 native subagent adapter',()=>{
  it('starts real fork children with pinned models, verified files and caller delivery without modifying their immutable source',async()=>{
    const {ctx,runtime,directory,model}=await open(),{source,boundary,coordinators}=await sourceAndCoordinators(runtime,directory);
    expect(runtime.supportsSubagents()).toBe(true);const before=await physical(directory,source),sourceLog=await runtime.read(source);
    const children=['native-workflow-child-left','native-workflow-child-right'],ended=new Set<string>();ctx.on('subagent/end',info=>{ended.add(info.id);});
    const stage=await runtime.create({cwd:directory});const files:NativeFileReference[]=[];
    for(const [index,text] of ['FILE_ALPHA_LEFT','FILE_BETA_RIGHT'].entries()){
      const uploaded=await ctx.fileUploads.uploadStream({sessionId:SessionId(stage.sessionId),name:`fixture-${index}.txt`,data:(async function*(){yield Buffer.from(text);})()});files.push(await runtime.resolveUploadedFile(stage.sessionId,uploaded.receiptId));
    }
    const receipts=await Promise.all(children.map((childSessionId,index)=>runtime.startSubagent({parentSessionId:coordinators[index]!.sessionId,childSessionId,label:`TEST native ${index}`,text:`READ_FILE ${index?'RIGHT_ONLY':'LEFT_ONLY'}`,files:[files[index]!],model:{provider:'fixture',model:index?'model-b':'model-a'}})));
    await vi.waitFor(()=>expect(ended.size).toBe(2),{timeout:5000,interval:20});
    for(const [index,id] of children.entries()){
      const log=await runtime.read(id);expect(log.header).toMatchObject({parentSession:coordinators[index]!.sessionId,isSeeded:true});expect((log.header as unknown as {origin:string}).origin).toBe('subagent');expect(log.inheritedEventCount).toBe(boundary+1);
      expect(log.events.slice(0,log.inheritedEventCount)).toEqual(sourceLog.events.slice(0,boundary+1));
      const own=log.events.filter(event=>event.seq>=log.inheritedEventCount),prompt=own.find(event=>event.type==='user/message')!;
      expect(prompt.data.id).toBe(receipts[index]!.messageId);expect(prompt.data.source).toEqual({kind:'user'});
      expect(own.some(event=>event.type==='subagent/descriptor')).toBe(true);expect(own.some(event=>event.type==='turn/end'&&(event.data.reason as {kind:string}).kind==='completed')).toBe(true);
      expect(own.filter(event=>event.type==='tool/result').every(event=>(event.data.result as {isError?:boolean}|undefined)?.isError!==true)).toBe(true);
      const calls=model.calls.filter(call=>JSON.stringify(call.messages).includes(index?'RIGHT_ONLY':'LEFT_ONLY'));expect(calls.length).toBeGreaterThanOrEqual(2);expect(calls.every(call=>call.model===(index?'model-b':'model-a'))).toBe(true);
      const context=JSON.stringify(calls.at(-1)!.messages);expect(context).toContain(index?'FILE_BETA_RIGHT':'FILE_ALPHA_LEFT');expect(context).not.toContain(index?'LEFT_ONLY':'RIGHT_ONLY');expect(context).not.toContain(index?'FILE_ALPHA_LEFT':'FILE_BETA_RIGHT');
      const parentLog=await runtime.read(coordinators[index]!.sessionId);expect(parentLog.events.filter(event=>event.seq>=parentLog.inheritedEventCount&&event.type==='subagent/catalog')).toHaveLength(1);expect(parentLog.events.some(event=>event.seq>=parentLog.inheritedEventCount&&event.type==='turn/start')).toBe(false);
      expect((await ctx.subagents.listChildren(SessionId(coordinators[index]!.sessionId))).map(child=>child.id)).toEqual([id]);
      const restored=await physical(directory,id);expect(restored.byteLength).toBeGreaterThan(0);
    }
    expect(model.calls.filter(call=>!JSON.stringify(call.messages).includes('LEFT_ONLY')&&!JSON.stringify(call.messages).includes('RIGHT_ONLY'))).toHaveLength(1);
    expect(await physical(directory,source)).toEqual(before);expect(await runtime.read(source)).toEqual(sourceLog);
  });
  it('cancels only its exact activation and never resumes a cold child',async()=>{
    const {ctx,runtime,directory}=await open(),{coordinators}=await sourceAndCoordinators(runtime,directory);
    const ended=new Map<string,string>();ctx.on('subagent/end',info=>{ended.set(info.id,info.stopReason);});
    await runtime.startSubagent({parentSessionId:coordinators[0]!.sessionId,childSessionId:'native-held-left',label:'TEST held',text:'HOLD_CHILD LEFT_ONLY',model:{provider:'fixture',model:'model-a'}});
    await vi.waitFor(()=>expect(runtime.isRunning('native-held-left')).toBe(true));
    await runtime.startSubagent({parentSessionId:coordinators[1]!.sessionId,childSessionId:'native-finished-right',label:'TEST sibling',text:'RIGHT_ONLY completes independently',model:{provider:'fixture',model:'model-b'}});
    await runtime.cancelSubagent('native-held-left');await vi.waitFor(()=>expect(ended.size).toBe(2));
    expect(ended.get('native-held-left')).toBe('aborted');expect(ended.get('native-finished-right')).toBe('completed');
    const before=await runtime.read('native-finished-right');expect(ctx.agents.get(SessionId('native-finished-right'))).toBeUndefined();
    await expect(runtime.cancelSubagent('native-finished-right')).rejects.toThrow(/no Session was resumed/i);expect(await runtime.read('native-finished-right')).toEqual(before);expect(ctx.agents.get(SessionId('native-finished-right'))).toBeUndefined();
  });
  it('keeps ordinary execution available without the optional capability and rejects corrupt files before native admission',async()=>{
    const off=await open(false);expect(off.runtime.supportsSubagents()).toBe(false);await sourceAndCoordinators(off.runtime,off.directory,1);
    await expect(off.runtime.startSubagent({parentSessionId:'unused',childSessionId:'unused-child',label:'TEST unavailable',text:'Never submit'})).rejects.toThrow(/unavailable/);
    const {ctx,runtime,directory,model}=await open(),{coordinators}=await sourceAndCoordinators(runtime,directory,1),stage=await runtime.create({cwd:directory});
    const uploaded=await ctx.fileUploads.uploadStream({sessionId:SessionId(stage.sessionId),name:'integrity.txt',data:(async function*(){yield Buffer.from('verified native bytes');})()}),file=await runtime.resolveUploadedFile(stage.sessionId,uploaded.receiptId),before=await runtime.read(coordinators[0]!.sessionId),calls=model.calls.length;
    await expect(runtime.startSubagent({parentSessionId:coordinators[0]!.sessionId,childSessionId:'must-not-start-corrupt-child',label:'TEST corrupt',text:'Never see a corrupt file',files:[{...file,bytes:file.bytes+1}]})).rejects.toThrow();
    expect(model.calls).toHaveLength(calls);expect(await runtime.read(coordinators[0]!.sessionId)).toEqual(before);expect(ctx.agents.get(SessionId('must-not-start-corrupt-child'))).toBeUndefined();
  });
  it('restores the physical child history after a host restart and forks it into an independent ordinary continuation',async()=>{
    const first=await open(),{source,coordinators}=await sourceAndCoordinators(first.runtime,first.directory,1),child='native-persisted-child',ended=new Set<string>();first.ctx.on('subagent/end',info=>{ended.add(info.id);});
    const receipt=await first.runtime.startSubagent({parentSessionId:coordinators[0]!.sessionId,childSessionId:child,label:'TEST durable child',text:'PERSISTED_CHILD_ONLY completed native work',model:{provider:'fixture',model:'model-b'}});
    await vi.waitFor(()=>expect(ended.has(child)).toBe(true));const saved=await first.runtime.read(child),childBytes=await physical(first.directory,child),sourceBytes=await physical(first.directory,source);
    await first.runtime.disposeSubagents();await first.ctx.fiber.dispose();const second=await open(true,first.directory);
    const restored=await second.runtime.read(child);expect(restored).toEqual(saved);expect(restored.events.find(event=>event.type==='user/message'&&event.data.id===receipt.messageId)).toBeDefined();expect(second.ctx.agents.get(SessionId(child))).toBeUndefined();
    const continuation=await second.runtime.fork({sessionId:child,atSeq:completedBoundary(restored)!});await second.runtime.submit({sessionId:continuation.sessionId,requestId:'ordinary-after-native-child',text:'CONTINUE_AFTER_CHILD',model:{provider:'fixture',model:'model-a'}});await second.runtime.waitForIdle(continuation.sessionId);await second.runtime.flush(continuation.sessionId);
    expect(JSON.stringify(second.model.calls.at(-1)!.messages)).toContain('PERSISTED_CHILD_ONLY');expect(second.model.calls.at(-1)?.model).toBe('model-a');expect(continuation.sessionId).not.toBe(child);expect((await second.runtime.read(continuation.sessionId)).header.parentSession).toBe(child);
    expect(await physical(first.directory,child)).toEqual(childBytes);expect(await physical(first.directory,source)).toEqual(sourceBytes);
  });
  it('releases all owned native activations at adapter teardown and closes further admission',async()=>{
    const {ctx,runtime,directory}=await open(),{coordinators}=await sourceAndCoordinators(runtime,directory),ended=new Set<string>();ctx.on('subagent/end',info=>{ended.add(info.id);});
    await Promise.all(coordinators.map((coordinator,index)=>runtime.startSubagent({parentSessionId:coordinator.sessionId,childSessionId:`native-teardown-${index}`,label:'TEST teardown',text:`HOLD_CHILD TEARDOWN_${index}`})));
    await vi.waitFor(()=>expect(coordinators.every((_coordinator,index)=>runtime.isRunning(`native-teardown-${index}`))).toBe(true));
    await runtime.disposeSubagents();expect(ended.size).toBe(2);expect(coordinators.every((_coordinator,index)=>ctx.agents.get(SessionId(`native-teardown-${index}`))===undefined)).toBe(true);
    await expect(runtime.startSubagent({parentSessionId:coordinators[0]!.sessionId,childSessionId:'native-after-teardown',label:'TEST late',text:'Must stay stopped'})).rejects.toThrow(/stopping/);
  });
  it('runs two real Service child tasks concurrently, projects their initial messages, and cancels only the selected branch',async()=>{
    const {ctx,directory,model}=await open(),service=await mountWorkflow(ctx,directory),created=(await service.create({name:'TEST native Service parallel'})).workflow;
    const workflow=await editWorkflow(service,created.id,current=>({...current,settings:{generation:'manual',execution:'manual',subagents:'on',model:{provider:'fixture',model:'model-a'}},nodes:['left','right'].map((id,index)=>({id,title:`TEST ${id}`,instruction:`HOLD_CHILD ${id.toUpperCase()}_ONLY`,source:'user',status:'draft',revision:1,position:{x:index*400,y:0},...(index?{model:{provider:'fixture',model:'model-b'}}:{})}))}));
    const requested=await service.batchRun({workflowId:workflow.id,nodeIds:['left','right'],nodeRevisions:{left:1,right:1},operationId:'native-service-parallel'});
    await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.executions!.filter(run=>run.status==='running')).toHaveLength(2),{timeout:5000,interval:20});
    const active=(await service.get({id:workflow.id})).workflow!,runs=active.executions!;expect(runs.map(run=>run.runId)).toEqual(requested.runIds);expect(new Set(runs.map(run=>run.sessionId)).size).toBe(2);expect(new Set(runs.map(run=>run.subagent!.parentSessionId)).size).toBe(2);
    for(const run of runs){
      expect(run.subagent?.messageId).toBeTruthy();const log=await ctx.sessionQuery.readSession(SessionId(run.sessionId));expect(log.session.origin).toBe('subagent');expect(log.events.find(event=>event.type==='user/message'&&event.data.id===run.subagent!.messageId)).toBeDefined();
      const trace=(await service.trace({workflowId:workflow.id,runId:run.runId})).trace;expect(trace.status).toBe('running');expect(trace.steps.length).toBeGreaterThan(0);expect(trace.startSeq).toBeDefined();
      const parent=await ctx.sessionQuery.readSession(SessionId(run.subagent!.parentSessionId));expect(parent.events.some(event=>event.seq>=parent.inheritedEventCount&&event.type==='turn/start')).toBe(false);
    }
    expect(model.calls).toHaveLength(2);expect(new Set(model.calls.map(call=>call.model))).toEqual(new Set(['model-a','model-b']));
    const left=runs.find(run=>run.nodeId==='left')!,right=runs.find(run=>run.nodeId==='right')!;await service.cancel({workflowId:workflow.id,runId:left.runId});
    await vi.waitFor(async()=>{const snapshot=(await service.get({id:workflow.id})).workflow!;expect(snapshot.executions!.find(run=>run.runId===left.runId)?.status).toBe('cancelled');expect(snapshot.executions!.find(run=>run.runId===right.runId)?.status).toBe('running');});
    expect(ctx.agents.get(SessionId(right.sessionId))?.status).toBe('running');expect((await service.trace({workflowId:workflow.id,runId:left.runId})).trace.status).toBe('cancelled');expect(model.calls).toHaveLength(2);
    await service.cancel({workflowId:workflow.id,runId:right.runId});
  });
  it('continues a completed Service child through a fresh ordinary Fork when delegation is switched off',async()=>{
    const {ctx,runtime,directory,model}=await open(),{source}=await sourceAndCoordinators(runtime,directory,0),sourceBytes=await physical(directory,source),service=await mountWorkflow(ctx,directory),imported=(await service.importSession({sessionId:source})).workflow;
    const workflow=await editWorkflow(service,imported.id,current=>({...current,settings:{generation:'manual',execution:'manual',subagents:'on',model:{provider:'fixture',model:'model-b'}},nodes:[...current.nodes,{id:'a',title:'TEST A',instruction:'SERVICE_CHILD_A_ONLY complete the prerequisite',source:'user',status:'draft',revision:1,position:{x:400,y:0}},{id:'b',title:'TEST B',instruction:'SERVICE_ORDINARY_B_ONLY continue after prerequisite',source:'user',status:'draft',revision:1,position:{x:800,y:0},model:{provider:'fixture',model:'model-a'}}],edges:[{id:'requires-a',source:'a',target:'b',type:'dependency'}]}));
    const first=await service.run({workflowId:workflow.id,nodeId:'a',operationId:'native-service-child-a'});await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.executions!.find(run=>run.runId===first.runId)).toMatchObject({status:'completed',durability:'durable'}),{timeout:5000,interval:20});
    const afterA=(await service.get({id:workflow.id})).workflow!,a=afterA.executions!.find(run=>run.runId===first.runId)!;expect(a.subagent?.messageId).toBeTruthy();const childBytes=await physical(directory,a.sessionId);
    await editWorkflow(service,workflow.id,current=>({...current,settings:{...current.settings!,subagents:'off'}}));
    const second=await service.run({workflowId:workflow.id,nodeId:'b',operationId:'native-service-normal-b'});await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.executions!.find(run=>run.runId===second.runId)).toMatchObject({status:'completed',durability:'durable'}),{timeout:5000,interval:20});
    const done=(await service.get({id:workflow.id})).workflow!,b=done.executions!.find(run=>run.runId===second.runId)!;expect(b.subagent).toBeUndefined();expect(b.sessionId).not.toBe(a.sessionId);expect(b.inputRunIds).toEqual([a.runId]);expect(done.nodes.filter(node=>['a','b'].includes(node.id)).every(node=>!node.resultStale)).toBe(true);
    const log=await runtime.read(b.sessionId);expect(log.header.parentSession).toBe(a.sessionId);expect((log.header as unknown as {origin?:string}).origin).toBeUndefined();expect(log.inheritedEventCount).toBe(a.endSeq!+1);
    for(const run of [a,b]){const trace=(await service.trace({workflowId:workflow.id,runId:run.runId})).trace;expect(trace.status).toBe('completed');expect(trace.steps.length).toBeGreaterThan(0);expect(trace.error).toBeUndefined();}
    const ordinary=model.calls.findLast(call=>JSON.stringify(call.messages).includes('SERVICE_ORDINARY_B_ONLY'))!;expect(ordinary.model).toBe('model-a');expect(JSON.stringify(ordinary.messages)).toContain('SERVICE_CHILD_A_ONLY');expect(await physical(directory,a.sessionId)).toEqual(childBytes);expect(await physical(directory,source)).toEqual(sourceBytes);
  });
  for(const mode of ['off','on'] as const)it(`joins a real native diamond and continues it with subagents ${mode} while preserving both sibling Sessions`,async()=>{
    const {ctx,runtime,directory,model}=await open(),{source}=await sourceAndCoordinators(runtime,directory,0);
    const sourceBytes=await physical(directory,source),service=await mountWorkflow(ctx,directory),imported=(await service.importSession({sessionId:source})).workflow;
    const titles=Object.fromEntries(['a','b','c','d','e'].map(id=>[id,`NATIVE_JOIN_${mode}_${id.toUpperCase()}`]));
    const leftText=`LEFT_PUBLIC_RESULT_BEGIN_${mode} ${'L'.repeat(8000)} LEFT_PUBLIC_RESULT_TAIL_${mode}`;
    const results={a:`SHARED_PUBLIC_RESULT_${mode}`,b:leftText,c:`RIGHT_PUBLIC_RESULT_${mode}`,d:`JOINED_PUBLIC_RESULT_${mode}`,e:`CONTINUED_PUBLIC_RESULT_${mode}`};
    for(const id of ['a','b','c','d','e'] as const)model.taskAnswers.set(titles[id]!,results[id]);
    const pairs=[['a','b'],['a','c'],['b','d'],['c','d'],['d','e']];
    const workflow=await editWorkflow(service,imported.id,current=>({...current,settings:{generation:'manual',execution:'manual',subagents:mode,model:{provider:'fixture',model:'model-a'}},nodes:[...current.nodes,...['a','b','c','d','e'].map((id,index)=>({id,title:titles[id]!,instruction:`Execute the ${id} task using only its declared prerequisite results.`,source:'user' as const,status:'draft' as const,revision:1,position:{x:400+index*300,y:index%2*250}}))],edges:pairs.map(([from,to],index)=>({id:`native-join-edge-${index}`,source:from!,target:to!,type:'dependency' as const}))}));
    const completed=async(nodeId:string)=>{
      const requested=await service.run({workflowId:workflow.id,nodeId,operationId:`native-join-${mode}-${nodeId}`});
      await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.executions!.find(run=>run.runId===requested.runId)).toMatchObject({status:'completed',durability:'durable'}),{timeout:8000,interval:20});
      return (await service.get({id:workflow.id})).workflow!.executions!.find(run=>run.runId===requested.runId)!;
    };
    const a=await completed('a'),b=await completed('b'),bBytes=await physical(directory,b.sessionId),c=await completed('c'),cBytes=await physical(directory,c.sessionId);
    expect(b.sessionId).not.toBe(c.sessionId);expect(b.sessionId).not.toBe(a.sessionId);expect(c.sessionId).not.toBe(a.sessionId);
    expect(await physical(directory,b.sessionId)).toEqual(bBytes);
    const d=await completed('d');expect([source,a.sessionId,b.sessionId,c.sessionId]).not.toContain(d.sessionId);
    expect(new Set(d.inputRunIds)).toEqual(new Set([b.runId,c.runId]));
    expect(d.resultInputs?.map(input=>input.runId)).toEqual([a.runId,b.runId,c.runId]);
    expect(d.resultInputBranchId).toBeTruthy();
    const userText=(call:GenerateOptions)=>call.messages.findLast(message=>message.role==='user'&&'source' in message&&message.source?.kind==='user')?.content.filter(block=>block.type==='text').map(block=>block.text).join('')??'';
    const joinCall=model.calls.findLast(call=>userText(call).startsWith(`Task: ${titles.d}\n`))!;
    expect(joinCall).toBeDefined();const prompt=userText(joinCall),start=prompt.lastIndexOf('\n[');
    expect(start).toBeGreaterThan(0);
    const records=JSON.parse(prompt.slice(start+1)) as Array<{source:{runId:string;nodeId:string};result:string}>;
    expect(records.map(input=>input.source.nodeId)).toEqual(['a','b','c']);
    expect(records.find(input=>input.source.nodeId==='b')?.result).toBe(leftText);expect(records.find(input=>input.source.nodeId==='c')?.result).toBe(results.c);
    const e=await completed('e'),done=(await service.get({id:workflow.id})).workflow!;
    expect(done.nodes.filter(node=>['a','b','c','d','e'].includes(node.id)).every(node=>node.status==='completed'&&!node.resultStale)).toBe(true);
    const afterCall=model.calls.findLast(call=>userText(call).startsWith(`Task: ${titles.e}\n`))!;
    expect(afterCall).toBeDefined();const afterContext=JSON.stringify(afterCall.messages);expect(afterContext).toContain(`LEFT_PUBLIC_RESULT_TAIL_${mode}`);expect(afterContext).toContain(results.c);expect(afterContext).toContain(results.d);
    for(const run of [d,e]){expect(Boolean(run.subagent)).toBe(mode==='on');const trace=(await service.trace({workflowId:workflow.id,runId:run.runId})).trace;expect(trace.status).toBe('completed');expect(trace.error).toBeUndefined();}
    expect(await physical(directory,b.sessionId)).toEqual(bBytes);expect(await physical(directory,c.sessionId)).toEqual(cBytes);expect(await physical(directory,source)).toEqual(sourceBytes);
    const metadata=await readFile(join(directory,'workflow-storage','visual_workflow.json'),'utf8');expect(metadata).not.toContain('Workflow dependency results:');expect(metadata).not.toContain(leftText);expect(metadata).not.toContain(`LEFT_PUBLIC_RESULT_TAIL_${mode}`);
    for(const input of d.resultInputs!)expect(Object.keys(input).sort()).toEqual(['endSeq','requestId','runId','sessionId','sha256','startSeq']);
  });
});
