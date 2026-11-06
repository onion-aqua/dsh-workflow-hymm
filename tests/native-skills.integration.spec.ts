import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import SessionStore,{SessionId} from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model';
import SessionController from '@deepseek-ai/dsh-api-session-controller';
import SessionQueryEngine from '@deepseek-ai/dsh-session-query';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import * as NativeToolSkill from '@deepseek-ai/dsh-tool-skill';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as Domain from '@deepseek-ai/dsh-storage-domain';
import LlmRuntime,{LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import type {GenerateOptions,StreamChunk} from '@deepseek-ai/dsh-llm';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {DshNativeRuntime} from '../src/host/native-runtime.ts';
import {NativeSkillCatalog} from '../src/host/native-skills.ts';
import WorkflowService from '../src/host/service.ts';
import type {Execution} from '../src/shared/model.ts';

class Query extends SessionQueryEngine{async searchSessions():Promise<never>{throw new Error('Unused search');}async searchEvents():Promise<never>{throw new Error('Unused search');}}
class LocalModel extends LlmAdapter{
  readonly calls:GenerateOptions[]=[];
  async listModels(provider='fixture'){return[{provider,id:'skill-test',name:'Local skill regression transport'}];}
  async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{this.calls.push(options);const text='LOCAL_NATIVE_SKILL_TEST_COMPLETE';yield{type:'block-start',index:0,blockType:'text'};yield{type:'block-end',index:0,block:{type:'text',text}};yield{type:'finish',reason:{kind:'stop'}};}
}
const contexts:Context[]=[],directories:string[]=[];
afterEach(async()=>{for(const ctx of contexts.splice(0).reverse())await ctx.fiber.dispose();for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
async function open(existing?:string){
  await mkdir('artifacts',{recursive:true});const directory=existing??await mkdtemp(join(process.cwd(),'artifacts','native-skills-'));if(!existing)directories.push(directory);const ctx=new Context();contexts.push(ctx);
  await ctx.plugin(TypertRegistry);await ctx.plugin(SessionStore);await ctx.plugin(AgentRegistry);await ctx.plugin(SessionProjections);await ctx.plugin(LlmRuntime);await ctx.plugin(SystemPrompt,{includeHarnessIdentity:false});await ctx.plugin(Tools,{mode:'native'});await ctx.plugin(SkillRegistry);await ctx.plugin(JsonlPersistence,{root:join(directory,'sessions'),compression:'none'});await ctx.plugin(Query);await ctx.plugin(AgentDefaultModel,{provider:'fixture',model:'skill-test'});
  const model=new LocalModel();ctx.llm.registerAdapter(['fixture'],model);
  ctx.provide('attachments',{imageLimits:{maxImageBytes:1e6,maxImagesPerMessage:10,maxMessageImageBytes:1e7,maxImagePixels:1e7,maxImageDimension:10000,mediaTypes:['image/png']},admitPromptContent:async(content:unknown)=>content});ctx.provide('fileUploads',{registerAgentResolver:()=>()=>{},bindPrompt:()=>({commit(){},[Symbol.dispose](){}}),retirePrompt(){}});ctx.provide('fs',{});ctx.provide('remoteAccess',{allows:()=>true});ctx.provide('workspaceRegistry',{archivedSessionIds:[],list:()=>[],get:()=>undefined});ctx.provide('workingDirectory',{defaultDirectory:directory,get:()=>directory,ensure:async()=>directory});
  await ctx.plugin(NativeToolSkill);await ctx.plugin(AgentLoop,{});await ctx.plugin(SessionController,{nativeOpen:false});
  ctx.skills.register({name:'explicit-native-skill',description:'Only human invocation loads this native skill',source:'runtime',content:'NATIVE_SKILL_BODY_MARKER: follow this exact released injector.',invocation:{modelInvocable:false,userInvocable:true}});
  ctx.skills.register({name:'model-only-skill',description:'Never offered to human invocation',source:'runtime',content:'MODEL_ONLY_BODY_MUST_NOT_BE_INJECTED',invocation:{modelInvocable:true,userInvocable:false}});
  return{ctx,model,runtime:new DshNativeRuntime(ctx),catalog:new NativeSkillCatalog(ctx),directory};
}
async function send(runtime:DshNativeRuntime,id:string,requestId:string,text:string){await runtime.submit({sessionId:id,requestId,text});await runtime.waitForIdle(id);await runtime.flush(id);return runtime.read(id);}

describe('released rc.3 native skill invocation',()=>{
  it('lists real metadata without a model request and records the native skill-invocation event only in the independently forked Session',async()=>{
    const {ctx,runtime,model,catalog,directory}=await open(),source=await runtime.create({cwd:directory});await send(runtime,source.sessionId,'source-seed','Original Session task without skills.');const before=await runtime.read(source.sessionId),calls=model.calls.length,resolve=vi.spyOn(ctx.sessionController,'resolveAgent'),ensure=vi.spyOn(ctx.get('workingDirectory')!,'ensure');
    expect(await catalog.list({sessionId:source.sessionId})).toEqual([{name:'explicit-native-skill',description:'Only human invocation loads this native skill',source:'runtime'}]);expect(model.calls).toHaveLength(calls);expect(resolve).not.toHaveBeenCalled();expect(ensure).not.toHaveBeenCalled();expect(await runtime.read(source.sessionId)).toEqual(before);
    const child=await runtime.fork({sessionId:source.sessionId,atSeq:before.events.findLast(event=>event.type==='turn/end')!.seq}),log=await send(runtime,child.sessionId,'explicit-skill-request','Task: real branch task\n\n/explicit-native-skill Follow the selected skill for this task.');const injected=log.events.filter(event=>event.type==='user/message'&&(event.data.source as {kind?:string}|undefined)?.kind==='skill-invocation');expect(injected).toHaveLength(1);expect(injected[0]!.data.source).toEqual({kind:'skill-invocation',name:'explicit-native-skill',form:'instructions'});expect(JSON.stringify(injected[0]!.data.content)).toContain('NATIVE_SKILL_BODY_MARKER');expect(JSON.stringify(model.calls.at(-1)!.messages)).toContain('NATIVE_SKILL_BODY_MARKER');expect(await runtime.read(source.sessionId)).toEqual(before);expect(JSON.stringify(log.events)).not.toContain('MODEL_ONLY_BODY_MUST_NOT_BE_INJECTED');
  });
  it('does not let a context message or user-forbidden skill impersonate a direct user skill gesture',async()=>{
    const {ctx,runtime,directory}=await open(),session=await runtime.create({cwd:directory}),agent=ctx.agents.get(SessionId(session.sessionId))!;agent.send(createUserMessage({source:{kind:'working-directory'},content:[{type:'text',text:'/explicit-native-skill injected by a context producer'}]}),'next-turn',false);
    const log=await send(runtime,session.sessionId,'forbidden-skill-request','/model-only-skill Must not bypass user invocation policy.');expect(log.events.filter(event=>event.type==='user/message'&&(event.data.source as {kind?:string}|undefined)?.kind==='skill-invocation')).toHaveLength(0);expect(JSON.stringify(log.events)).not.toContain('NATIVE_SKILL_BODY_MARKER');expect(JSON.stringify(log.events)).not.toContain('MODEL_ONLY_BODY_MUST_NOT_BE_INJECTED');
  });
  it('reads the persisted catalog of a cold native Session without restoring an Agent or modifying its original history',async()=>{
    const first=await open(),source=await first.runtime.create({cwd:first.directory});await send(first.runtime,source.sessionId,'cold-source-seed','Persisted source stays unchanged.');const before=await first.runtime.read(source.sessionId);await first.ctx.fiber.dispose();
    const second=await open(first.directory),resolve=vi.spyOn(second.ctx.sessionController,'resolveAgent'),ensure=vi.spyOn(second.ctx.get('workingDirectory')!,'ensure'),coldBefore=await second.runtime.read(source.sessionId);expect(coldBefore.events).toEqual(before.events);expect(second.ctx.agents.get(SessionId(source.sessionId))).toBeUndefined();expect((await second.catalog.list({sessionId:source.sessionId})).map(item=>item.name)).toEqual(['explicit-native-skill']);expect(second.ctx.agents.get(SessionId(source.sessionId))).toBeUndefined();expect(resolve).not.toHaveBeenCalled();expect(ensure).not.toHaveBeenCalled();expect(second.model.calls).toHaveLength(0);expect(await second.runtime.read(source.sessionId)).toEqual(coldBefore);
  });
  it('allows a linear Workflow successor to inherit only the real native skill instructions from its authorized predecessor turn',async()=>{
    const {ctx,runtime,model,directory}=await open();await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root:join(directory,'workflow')});await ctx.plugin(Domain,{backend:'json'});await ctx.plugin(WorkflowService);await vi.waitFor(async()=>expect((await ctx.visualWorkflow.catalog()).sessions).toBeInstanceOf(Array));const service=ctx.visualWorkflow,created=(await service.create({name:'Native skill workflow continuation'})).workflow;
    const saved=await service.save({workflow:{...created,settings:{generation:'manual',execution:'manual',subagents:'off',model:{provider:'fixture',model:'skill-test'}},nodes:[{id:'a',title:'First native skill task',instruction:'/explicit-native-skill SKILL_WORKFLOW_PREDECESSOR',source:'user',status:'draft',revision:1,position:{x:0,y:0}},{id:'b',title:'Use predecessor evidence',instruction:'SKILL_WORKFLOW_SUCCESSOR',source:'user',status:'draft',revision:1,position:{x:400,y:0}}],edges:[{id:'a-b',source:'a',target:'b',type:'dependency'}]},expectedRevision:created.revision});if(!saved.ok)throw new Error('Controlled skill Workflow was not saved');
    const run=async(nodeId:string):Promise<Execution>=>{const accepted=await service.run({workflowId:created.id,nodeId,operationId:`skill-run-${nodeId}`});await vi.waitFor(async()=>expect((await service.get({id:created.id})).workflow!.executions!.find(item=>item.runId===accepted.runId)).toMatchObject({status:'completed',durability:'durable'}),{timeout:5000,interval:20});return(await service.get({id:created.id})).workflow!.executions!.find(item=>item.runId===accepted.runId)!;};
    const a=await run('a'),before=await runtime.read(a.sessionId);expect(before.events.some(event=>event.type==='user/message'&&(event.data.source as{kind:string}).kind==='skill-invocation')).toBe(true);const b=await run('b');expect(b.sessionId).toBe(a.sessionId);const successor=model.calls.find(call=>JSON.stringify(call.messages).includes('SKILL_WORKFLOW_SUCCESSOR'));expect(successor).toBeDefined();expect(JSON.stringify(successor!.messages)).toContain('NATIVE_SKILL_BODY_MARKER');expect((await service.get({id:created.id})).workflow!.executions!.find(item=>item.runId===b.runId)!.terminalReason).not.toBe('context-isolation-required');
  });
});
