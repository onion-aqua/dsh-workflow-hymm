import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory';
import SubagentRuntime from '@deepseek-ai/dsh-subagent';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DshNativeRuntime } from '../src/host/native-runtime.ts';
import type { WorkflowQuestionAnswer } from '../src/shared/model.ts';

const archive='C:/Users/cheny/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
function installedFile(relative:string):Buffer{
  const fd=openSync(archive,'r');
  try{
    const first=Buffer.alloc(16);readSync(fd,first,0,16,0);const header=Buffer.alloc(first.readUInt32LE(12));readSync(fd,header,0,header.length,16);
    type Entry={files?:Record<string,Entry>;size:number;offset:string;unpacked?:boolean};let entry=JSON.parse(header.toString()) as Entry;for(const part of relative.split('/'))entry=entry.files![part]!;
    if(entry.unpacked)return readFileSync(`${archive}.unpacked/${relative}`);const bytes=Buffer.alloc(entry.size);readSync(fd,bytes,0,bytes.length,8+first.readUInt32LE(4)+Number(entry.offset));return bytes;
  }finally{closeSync(fd);}
}
class ExactReadQuery extends SessionQueryEngine{
  async searchSessions():Promise<never>{throw new Error('Search is unused');}
  async searchEvents():Promise<never>{throw new Error('Search is unused');}
}
class QuestionModel extends LlmAdapter{
  readonly calls:GenerateOptions[]=[];
  constructor(private readonly timed:boolean,private readonly ptc=false){super();}
  async listModels(provider='fixture'){return ['default','model-b'].map(id=>({provider,id,name:`Controlled ${id}`}));}
  async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{
    options.signal?.throwIfAborted();this.calls.push(options);
    const latest=options.messages.findLast(message=>message.role==='user'&&'source' in message&&['user','user-question-reply'].includes(message.source?.kind??'')),source=latest&&'source' in latest?latest.source:undefined;
    const prompt=latest?.content.filter(block=>block.type==='text').map(block=>block.text).join('')??'';
    if(prompt.includes('ASK_')&&source?.kind==='user'&&options.messages.at(-1)?.role!=='tool'){
      const argumentsValue={questions:[{id:'choice',question:'Which result should be selected?',header:'Result',options:[{label:'A',description:'First result'},{label:'B',description:'Second result'}]},{id:'details',question:'What details should be included?'},{id:'optional',question:'Which optional categories apply?',options:[{label:'X'},{label:'Y'}],multi_select:true}],...(this.timed?{timeout:prompt.includes('WAIT_FOREVER')?-1:prompt.includes('TIMEOUT')?1:20}:{})};
      const block={type:'tool-call' as const,id:ToolCallId(`question-call-${this.calls.length}`),name:this.ptc?'run_code':'ask_user_question',arguments:JSON.stringify(this.ptc?{code:`const answer = await tools.ask_user_question(${JSON.stringify(argumentsValue)}); console.log(JSON.stringify(answer));`,description:'Ask the required native user questions through the released PTC bridge'}:argumentsValue)};
      yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};return;
    }
    const text=(source as {kind?:string}|undefined)?.kind==='user-question-reply'?'LATE_REPLY_RECEIVED':`QUESTION_STEP_FINISHED ${prompt}`;
    yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
  }
}
const opened:Array<{ctx:Context;runtime:DshNativeRuntime;directory:string}>=[];
afterEach(async()=>{for(const {ctx,runtime,directory} of opened.splice(0).reverse()){await runtime.disposeSubagents();await ctx.fiber.dispose();await rm(directory,{recursive:true,force:true});}});
async function copyInstalledPackage(directory:string,name:string,seen=new Set<string>()){
  if(seen.has(name))return;seen.add(name);
  const prefix=`dsh/node_modules/${name}/`,root=join(directory,'node_modules',name),metadata=JSON.parse(installedFile(`${prefix}package.json`).toString());
  const fd=openSync(archive,'r');
  try{
    const first=Buffer.alloc(16);readSync(fd,first,0,16,0);const header=Buffer.alloc(first.readUInt32LE(12));readSync(fd,header,0,header.length,16);
    type Entry={files?:Record<string,Entry>;size:number;offset:string;unpacked?:boolean};let entry=JSON.parse(header.toString()) as Entry;for(const part of prefix.slice(0,-1).split('/'))entry=entry.files![part]!;
    async function visit(node:Entry,relative=''){for(const [leaf,value] of Object.entries(node.files??{})){const next=relative?`${relative}/${leaf}`:leaf;if(value.files)await visit(value,next);else if(!next.endsWith('.d.ts')){const target=join(root,next);await mkdir(dirname(target),{recursive:true});await writeFile(target,installedFile(prefix+next));}}}
    await visit(entry);
  }finally{closeSync(fd);}
  for(const dependency of Object.keys({...metadata.dependencies,...metadata.peerDependencies}))if(!existsSync(join(process.cwd(),'node_modules',dependency)))await copyInstalledPackage(directory,dependency,seen);
  return pathToFileURL(join(root,metadata.main??'index.js')).href;
}
async function open(mode:'legacy'|'timed'='timed',existingDirectory?:string,child=false,ptc=false){
  const directory=existingDirectory??await mkdtemp(join(process.cwd(),'artifacts','native-question-')),ctx=new Context();
  await ctx.plugin(TypertRegistry);await ctx.plugin(SessionStore);await ctx.plugin(AgentRegistry);await ctx.plugin(SessionProjections);await ctx.plugin(LlmRuntime);await ctx.plugin(SystemPrompt,{includeHarnessIdentity:false});await ctx.plugin(Tools,{mode:ptc?'ptc':'native'});await ctx.plugin(JsonlPersistence,{root:join(directory,'sessions'),compression:'none'});await ctx.plugin(ExactReadQuery);await ctx.plugin(AgentDefaultModel,{provider:'fixture',model:'default'});
  const model=new QuestionModel(mode==='timed',ptc);ctx.llm.registerAdapter(['fixture'],model);await ctx.plugin(LocalAttachmentStore,{dshHome:directory});await ctx.plugin(LocalFileSystem,{cwd:directory});await ctx.plugin(WorkingDirectoryService,{defaultDirectory:directory});
  if(ptc){
    await ctx.plugin(SandboxPolicy,{mode:'danger-full-access',workspaceRoot:directory});
    const copied=new Set<string>(),subprocessUrl=await copyInstalledPackage(directory,'@deepseek-ai/dsh-subprocess-local',copied),sandboxUrl=await copyInstalledPackage(directory,'@deepseek-ai/dsh-sandbox-local',copied),ptcUrl=await copyInstalledPackage(directory,'@deepseek-ai/dsh-ptc-runtime-node',copied);
    const subprocess=await import(/* @vite-ignore */ subprocessUrl!),sandbox=await import(/* @vite-ignore */ sandboxUrl!),runtime=await import(/* @vite-ignore */ ptcUrl!);
    await ctx.plugin(subprocess.default);await ctx.plugin(sandbox.default,{});await ctx.plugin(runtime.default,{launch:{kind:'node-script',executable:process.execPath},timeoutMs:20000,maxTimeoutMs:30000});
  }
  ctx.provide('connection',{fetch:{register:()=>()=>{}}});ctx.provide('commands',{registerFileReceiptResolver:()=>()=>{}});await ctx.plugin(FileUploads);ctx.provide('remoteAccess',{allows:()=>true});ctx.provide('workspaceRegistry',{archivedSessionIds:[],list:()=>[],get:()=>undefined});await ctx.plugin(AgentLoop,{});await ctx.plugin(SessionController,{nativeOpen:false});
  const questionPackage=join(directory,'node_modules','@deepseek-ai','dsh-user-questions');await mkdir(join(questionPackage,'lib'),{recursive:true});
  const prefix='dsh/node_modules/@deepseek-ai/';expect(JSON.parse(installedFile(`${prefix}dsh-user-questions/package.json`).toString()).version).toBe('0.2.1-rc.3');
  await writeFile(join(questionPackage,'package.json'),installedFile(`${prefix}dsh-user-questions/package.json`));await writeFile(join(questionPackage,'lib','index.js'),installedFile(`${prefix}dsh-user-questions/lib/index.js`));
  const questions=await import(/* @vite-ignore */ pathToFileURL(join(questionPackage,'lib','index.js')).href);await ctx.plugin(questions.default,{});
  const toolPath=join(directory,'released-ask-user.mjs');await writeFile(toolPath,installedFile(`${prefix}dsh-tool-ask-user/lib/index.js`));const tool=await import(/* @vite-ignore */ pathToFileURL(toolPath).href);await ctx.plugin(tool,{mode,timeout:20});
  if(child){const providerPath=join(directory,'released-fork-provider.mjs');await writeFile(providerPath,installedFile(`${prefix}dsh-subagent-fork-in-process/lib/index.js`));const provider=await import(/* @vite-ignore */ pathToFileURL(providerPath).href);await ctx.plugin(SubagentRuntime,{});await ctx.plugin(provider,{providerName:'fork'});}
  const runtime=new DshNativeRuntime(ctx);opened.push({ctx,runtime,directory});return {ctx,runtime,directory,model};
}
const skipped:WorkflowQuestionAnswer[]=[{id:'choice',selected:[]},{id:'details',selected:[]},{id:'optional',selected:[]}];
async function pending(runtime:DshNativeRuntime,sessionId:string,state:'open'|'continued'){
  await vi.waitFor(async()=>expect(await runtime.questions(sessionId)).toEqual([expect.objectContaining({state})]),{timeout:5000,interval:20});return (await runtime.questions(sessionId))[0]!;
}
describe('released rc.3 native user question adapter',()=>{
  it('answers legacy native foreground questions with choices, free text and explicit skip through their original waterfall',async()=>{
    const {runtime,directory}=await open('legacy'),session=await runtime.create({cwd:directory});runtime.setQuestionOwner(async sessionId=>sessionId===session.sessionId);
    const notifications:string[]=[];const stop=runtime.subscribe((_id,event)=>{if(event.type==='workflow/question-state')notifications.push(event.type);});
    await runtime.submit({sessionId:session.sessionId,requestId:'legacy-native-question',text:'ASK_LEGACY'});const question=await pending(runtime,session.sessionId,'open');expect(question.actionable).toBe(true);expect(question.questions.map(item=>item.id)).toEqual(['choice','details','optional']);
    await expect(runtime.answerQuestion(session.sessionId,question.callId,[skipped[0]!,skipped[0]!,skipped[2]!])).rejects.toThrow(/each question exactly once/);
    expect(await runtime.answerQuestion(session.sessionId,'foreign-call',skipped)).toBe(false);
    const answers=[{id:'choice',selected:['B']},{id:'details',selected:[],custom:'Only verified native evidence'},{id:'optional',selected:[]}];expect(await runtime.answerQuestion(session.sessionId,question.callId,answers)).toBe(true);await runtime.waitForIdle(session.sessionId);await runtime.flush(session.sessionId);
    const log=await runtime.read(session.sessionId),result=log.events.find(event=>event.type==='tool/result'&&(event.data.message as {toolCallId:string}).toolCallId===question.callId)!;expect(JSON.stringify(result.data)).toContain('Only verified native evidence');const message=result.data.message as {content:Array<{type:string;text:string}>};expect(JSON.parse(message.content[0]!.text).answers).toEqual(answers);expect(await runtime.questions(session.sessionId)).toEqual([]);expect(await runtime.answerQuestion(session.sessionId,question.callId,answers)).toBe(false);expect(notifications.length).toBeGreaterThanOrEqual(2);expect(log.events.some(event=>event.type==='workflow/question-state')).toBe(false);stop();
  });
  it('answers a real timed foreground question before timeout and removes it from the native projection',async()=>{
    const {runtime,directory}=await open(),session=await runtime.create({cwd:directory});runtime.setQuestionOwner(async id=>id===session.sessionId);await runtime.submit({sessionId:session.sessionId,requestId:'timed-in-window',text:'ASK_TIMED'});
    const question=await pending(runtime,session.sessionId,'open');expect(question.actionable).toBe(true);expect(await runtime.answerQuestion(session.sessionId,question.callId,skipped)).toBe(true);await runtime.waitForIdle(session.sessionId);await runtime.flush(session.sessionId);expect(await runtime.questions(session.sessionId)).toEqual([]);
    const log=await runtime.read(session.sessionId);expect(log.events.some(event=>event.type==='user/message'&&(event.data.source as {kind:string}).kind==='user-question-reply')).toBe(false);
  });
  it('keeps a timed-out question answerable and pins its late reply turn to the original execution model',async()=>{
    const {ctx,runtime,directory,model}=await open(),session=await runtime.create({cwd:directory});runtime.setQuestionOwner(async id=>id===session.sessionId);const requestId='timed-late-original-model';await runtime.submit({sessionId:session.sessionId,requestId,text:'ASK_TIMEOUT',model:{provider:'fixture',model:'model-b'}});
    const question=await pending(runtime,session.sessionId,'continued');await runtime.waitForIdle(session.sessionId);expect(question.actionable).toBe(true);expect(model.calls.every(call=>call.model==='model-b')).toBe(true);
    expect(await runtime.answerQuestion(session.sessionId,question.callId,skipped,{requestId,model:{provider:'fixture',model:'model-b'}})).toBe(true);await runtime.waitForIdle(session.sessionId);await runtime.flush(session.sessionId);
    const log=await runtime.read(session.sessionId),reply=log.events.find(event=>event.type==='user/message'&&(event.data.source as {kind:string}).kind==='user-question-reply')!;expect(reply.data.source).toMatchObject({kind:'user-question-reply',callId:question.callId,outcome:'answered'});expect(JSON.stringify(reply.data.content)).toContain('answer_to_pending_question');expect(model.calls.at(-1)?.model).toBe('model-b');expect(await runtime.questions(session.sessionId)).toEqual([]);
    await ctx.sessionController.selectModel({sessionId:SessionId(session.sessionId),provider:'fixture',model:'default'});await runtime.submit({sessionId:session.sessionId,requestId:'later-unrelated-native',text:'Native default owns this unrelated prompt'});await runtime.waitForIdle(session.sessionId);expect(model.calls.at(-1)?.model).toBe('default');
  });
  it('restores continued questions from native Session persistence without inventing a foreground wait',async()=>{
    const first=await open(),session=await first.runtime.create({cwd:first.directory});first.runtime.setQuestionOwner(async id=>id===session.sessionId);await first.runtime.submit({sessionId:session.sessionId,requestId:'persisted-pending-question',text:'ASK_TIMEOUT'});const original=await pending(first.runtime,session.sessionId,'continued');await first.runtime.waitForIdle(session.sessionId);await first.runtime.flush(session.sessionId);await first.ctx.fiber.dispose();
    const second=await open('timed',first.directory);second.runtime.setQuestionOwner(async id=>id===session.sessionId);expect(second.ctx.agents.get(SessionId(session.sessionId))).toBeUndefined();const restored=await pending(second.runtime,session.sessionId,'continued');expect(restored).toEqual(original);expect(second.ctx.agents.get(SessionId(session.sessionId))).toBeUndefined();expect(await second.runtime.answerQuestion(session.sessionId,restored.callId,skipped)).toBe(true);await second.runtime.waitForIdle(session.sessionId);await second.runtime.flush(session.sessionId);expect(await second.runtime.questions(session.sessionId)).toEqual([]);expect(second.model.calls).toHaveLength(1);
  });
  it('does not claim unrelated questions, marks open projections without live resolvers unavailable, and rejects expired answers',async()=>{
    const {runtime,directory}=await open(),session=await runtime.create({cwd:directory});runtime.setQuestionOwner(async()=>false);await runtime.submit({sessionId:session.sessionId,requestId:'not-owned-question',text:'ASK_TIMED'});const nativeOpen=await pending(runtime,session.sessionId,'open');expect(nativeOpen.actionable).toBe(false);expect(await runtime.answerQuestion(session.sessionId,nativeOpen.callId,skipped)).toBe(false);
    await runtime.cancel(session.sessionId,'not-owned-question');await runtime.waitForIdle(session.sessionId);await runtime.flush(session.sessionId);runtime.setQuestionOwner(async()=>true);const before=await runtime.read(session.sessionId);expect(await runtime.questions(session.sessionId)).toEqual([]);expect(await runtime.answerQuestion(session.sessionId,nativeOpen.callId,skipped)).toBe(false);expect(await runtime.read(session.sessionId)).toEqual(before);
    await runtime.submit({sessionId:session.sessionId,requestId:'owned-cancelled-question',text:'ASK_TIMED'});const owned=await pending(runtime,session.sessionId,'open');expect(owned.actionable).toBe(true);await runtime.cancel(session.sessionId,'owned-cancelled-question');await runtime.waitForIdle(session.sessionId);expect(await runtime.questions(session.sessionId)).toEqual([]);expect(await runtime.answerQuestion(session.sessionId,owned.callId,skipped)).toBe(false);
  });
  it('preserves the native prohibition on owned child Agent questions and never bridges them to an unrelated parent',async()=>{
    const {ctx,runtime,directory}=await open('timed',undefined,true),parent=await runtime.create({cwd:directory}),ended=new Set<string>();runtime.setQuestionOwner(async()=>true);ctx.on('subagent/end',info=>{ended.add(info.id);});
    await runtime.startSubagent({parentSessionId:parent.sessionId,childSessionId:'question-native-owned-child',label:'TEST owned child question',text:'ASK_CHILD'});await vi.waitFor(()=>expect(ended.has('question-native-owned-child')).toBe(true),{timeout:5000,interval:20});
    const log=await runtime.read('question-native-owned-child');expect(JSON.stringify(log.events)).toMatch(/DELEGATED_CALLER|owned by another live agent/);expect(await runtime.questions('question-native-owned-child')).toEqual([]);expect(await runtime.questions(parent.sessionId)).toEqual([]);expect(await runtime.answerQuestion('question-native-owned-child','any-call',skipped)).toBe(false);expect((await runtime.read(parent.sessionId)).events.some(event=>event.type==='turn/start')).toBe(false);
  });
  it('answers a legacy native question inside the released run_code PTC subprocess through its exact sub-call identity',async()=>{
    const {runtime,directory,model}=await open('legacy',undefined,false,true),session=await runtime.create({cwd:directory});runtime.setQuestionOwner(async id=>id===session.sessionId);
    await runtime.submit({sessionId:session.sessionId,requestId:'legacy-real-ptc-question',text:'ASK_LEGACY_PTC'});const question=await pending(runtime,session.sessionId,'open');expect(question.callId).toMatch(/^question-call-\d+:ptc:\d+$/);expect(question.actionable).toBe(true);
    const before=await runtime.read(session.sessionId);expect(before.events.some(event=>event.type==='tool/ptc-dispatch-start'&&event.data.subCallId===question.callId&&event.data.name==='ask_user_question')).toBe(true);expect(before.events.some(event=>event.type==='tool/call'&&event.data.name==='ask_user_question')).toBe(false);
    expect(await runtime.answerQuestion(session.sessionId,question.callId,skipped)).toBe(true);await runtime.waitForIdle(session.sessionId);await runtime.flush(session.sessionId);const after=await runtime.read(session.sessionId),dispatch=after.events.find(event=>event.type==='tool/ptc-dispatch'&&event.data.subCallId===question.callId)!;expect(dispatch.data.isError).toBe(false);expect(JSON.stringify(dispatch.data.content)).toContain('answers');expect(await runtime.questions(session.sessionId)).toEqual([]);expect(model.calls).toHaveLength(2);expect(model.calls[0]!.tools?.map(tool=>tool.name)).toEqual(['run_code']);
  });
  it('refuses old answers while a new external prompt is queued but not claimed, including the final admission race',async()=>{
    const {ctx,runtime,directory,model}=await open(),session=await runtime.create({cwd:directory});runtime.setQuestionOwner(async()=>true);await runtime.submit({sessionId:session.sessionId,requestId:'old-before-unclaimed-external',text:'ASK_TIMEOUT'});const question=await pending(runtime,session.sessionId,'continued');await runtime.waitForIdle(session.sessionId);
    const agent=ctx.agents.get(SessionId(session.sessionId))!,external=createUserMessage({source:{kind:'user'},content:[{type:'text',text:'EXTERNAL_UNCLAIMED_NEW_TASK'}]});agent.send(external,'next-turn',false);
    const before=await runtime.read(session.sessionId),calls=model.calls.length;expect(agent.status).toBe('idle');expect(agent.inbox.nextTurn.some(message=>message.id===external.id)).toBe(true);expect((await runtime.questions(session.sessionId))[0]?.actionable).toBe(false);expect(await runtime.answerQuestion(session.sessionId,question.callId,skipped)).toBe(false);expect(await runtime.read(session.sessionId)).toEqual(before);expect(model.calls).toHaveLength(calls);expect([...agent.inbox.nextStep,...agent.inbox.nextTurn].some(message=>(message.source as {kind:string}).kind==='user-question-reply')).toBe(false);
    await ctx.sessionController.updateQueue({sessionId:SessionId(session.sessionId),itemId:external.id,action:{kind:'remove'}});expect((await runtime.questions(session.sessionId))[0]?.actionable).toBe(true);
    let checks=0;runtime.setQuestionOwner(async()=>{if(++checks===2)agent.send(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'EXTERNAL_ARRIVED_DURING_OWNER_RECHECK'}]}),'next-turn',false);return true;});expect(await runtime.answerQuestion(session.sessionId,question.callId,skipped)).toBe(false);expect(checks).toBe(2);expect(model.calls).toHaveLength(calls);expect([...agent.inbox.nextStep,...agent.inbox.nextTurn].some(message=>(message.source as {kind:string}).kind==='user-question-reply')).toBe(false);
  });
  it('keeps native control inbox messages compatible but disables an open foreground question when new user work is queued',async()=>{
    const {ctx,runtime,directory}=await open(),session=await runtime.create({cwd:directory});runtime.setQuestionOwner(async()=>true);await runtime.submit({sessionId:session.sessionId,requestId:'open-before-unclaimed-external',text:'ASK_TIMED'});const question=await pending(runtime,session.sessionId,'open'),agent=ctx.agents.get(SessionId(session.sessionId))!;
    const control=createUserMessage({source:{kind:'working-directory'},content:[{type:'text',text:'Native working directory control snapshot'}]});agent.send(control,'next-turn',false);expect((await runtime.questions(session.sessionId))[0]?.actionable).toBe(true);await ctx.sessionController.updateQueue({sessionId:SessionId(session.sessionId),itemId:control.id,action:{kind:'remove'}});
    agent.send(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'NEW_USER_WORK_WHILE_OLD_TOOL_WAITS'}]}),'next-turn',false);expect((await runtime.questions(session.sessionId))[0]?.actionable).toBe(false);expect(await runtime.answerQuestion(session.sessionId,question.callId,skipped)).toBe(false);await runtime.cancel(session.sessionId,'open-before-unclaimed-external');await runtime.waitForIdle(session.sessionId);
  });
});
