import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as Domain from '@deepseek-ai/dsh-storage-domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Service from '../src/host/service.ts';
import type { NativeRuntime, NativeSessionLog, NativeEvent, NativeFileReference } from '../src/host/native-runtime.ts';
import type { Execution, Workflow, WorkflowQuestionAnswer, WorkflowQuestionItem, WorkflowPendingQuestion, WorkflowModelIdentity } from '../src/shared/model.ts';

type Pending=Omit<WorkflowPendingQuestion,'workflowId'|'runId'|'nodeId'>;
/** Session/tool events and foreground question authority are separate surfaces:
 * an old logged tool call alone never gives this fixture an answerable waiter. */
class QuestionNative implements NativeRuntime {
  next=0;
  readonly logs=new Map<string,NativeSessionLog>();
  readonly active=new Set<string>();
  readonly pending=new Map<string,Pending[]>();
  readonly heldReplies=new Map<string,string[]>();
  readonly submissions:Array<{sessionId:string;requestId:string;text:string}>=[];
  readonly received:Array<{sessionId:string;callId:string;answers:WorkflowQuestionAnswer[]}>=[];
  defaultModel={provider:'controlled',model:'questions'};
  supportsSubagents(){return true;}
  async models(){return {models:[{...this.defaultModel,label:'Controlled questions'}],defaultModel:this.defaultModel};}
  async resolveModel(selected?:WorkflowModelIdentity){return selected??this.defaultModel;}
  protectPlanning(_sessionId:string){}
  async resolveUploadedFile(_sessionId:string,_receiptId:string):Promise<NativeFileReference>{throw new Error('Unused native question upload');}
  async catalog(){return [...this.logs.values()].map(log=>({sessionId:log.sessionId,title:log.sessionId,updatedAt:1,running:this.active.has(log.sessionId),blank:!log.events.length,parentSessionId:log.header.parentSession}));}
  async read(id:string){const log=this.logs.get(id);if(!log)throw new Error('Missing isolated question Session');return structuredClone(log);}
  async create(options:{sessionId?:string;cwd?:string;agentPreset?:string}={}){const sessionId=options.sessionId??`question-session-${++this.next}`;this.logs.set(sessionId,{sessionId,header:{id:sessionId,createdAt:1,isSeeded:false,cwd:options.cwd},inheritedEventCount:0,events:[]});return {sessionId};}
  async fork(request:{sessionId:string;atSeq:number}){const source=await this.read(request.sessionId),sessionId=`question-session-${++this.next}`;this.copy(source,sessionId,request.atSeq);return {sessionId,inheritedEventCount:request.atSeq+1};}
  private copy(source:NativeSessionLog,sessionId:string,boundary:number){this.logs.set(sessionId,{...structuredClone(source),sessionId,header:{...source.header,id:sessionId,parentSession:source.sessionId,isSeeded:boundary>=0},inheritedEventCount:boundary+1,events:structuredClone(source.events.filter(event=>event.seq<=boundary))});}
  append(sessionId:string,type:string,data:Record<string,unknown>){const log=this.logs.get(sessionId)!;log.events.push({type,data,seq:log.events.length,time:1000+log.events.length});}
  turn(sessionId:string){return Number(this.logs.get(sessionId)!.events.findLast(event=>event.type==='turn/start')?.data.turn??0);}
  begin(sessionId:string,id:string,source:Record<string,unknown>,text:string){const turn=this.turn(sessionId)+1;this.active.add(sessionId);this.append(sessionId,'turn/start',{turn});this.append(sessionId,'user/message',{id,source,content:[{type:'text',text}]});this.append(sessionId,'request/header',{turn,step:1,header:{tools:[{name:'ask_user_question',parameters:{type:'object',properties:{timeout:{type:'integer'},questions:{type:'array'}}}}]}});this.append(sessionId,'step/start',{turn,step:1});}
  async submit(request:{sessionId:string;requestId:string;text:string}){this.submissions.push(request);this.begin(request.sessionId,request.requestId,{kind:'user',rpcId:request.requestId},request.text);}
  async startSubagent(request:{parentSessionId:string;childSessionId:string;label:string;text:string;files?:readonly NativeFileReference[];model?:WorkflowModelIdentity}){const source=await this.read(request.parentSessionId),boundary=source.events.findLast(event=>event.type==='turn/end')?.seq??-1;this.copy(source,request.childSessionId,boundary);const messageId=`question-child-message-${++this.next}`;this.begin(request.childSessionId,messageId,{kind:'user'},request.text);return {messageId};}
  async cancelSubagent(sessionId:string){this.close(sessionId,'aborted');}
  async cancel(sessionId:string,_requestId?:string){if(this.active.has(sessionId)){this.close(sessionId,'aborted');return 'active' as const;}return 'none' as const;}
  async flush(_sessionId:string){}
  isRunning(sessionId:string){return this.active.has(sessionId)||this.pendingQuestionReplies(sessionId).length>0;}
  pendingQuestionReplies(sessionId:string){return this.heldReplies.get(sessionId)??[];}
  async waitForIdle(_sessionId:string){}
  subscribe(_listener:(sessionId:string,event:NativeEvent)=>void){return ()=>{};}
  async questions(sessionId:string){return structuredClone(this.pending.get(sessionId)??[]);}
  ask(sessionId:string,callId:string,questions:WorkflowQuestionItem[],state:'open'|'continued'='open',actionable=true){
    this.append(sessionId,'tool/call',{turn:this.turn(sessionId),step:1,callId,name:'ask_user_question',arguments:JSON.stringify({questions:questions.map(({multiSelect,...question})=>({...question,...(multiSelect===undefined?{}:{multi_select:multiSelect})}))})});
    const item:Pending={sessionId,callId,questions:structuredClone(questions),state,actionable,createdAt:1000+this.logs.get(sessionId)!.events.length};this.pending.set(sessionId,[...(this.pending.get(sessionId)??[]),item]);return item;
  }
  close(sessionId:string,reason='completed'){const turn=this.turn(sessionId);this.append(sessionId,'assistant/message',{turn,step:1,message:{content:[{type:'text',text:'Observable native result'}]}});this.append(sessionId,'step/end',{turn,step:1});this.append(sessionId,'turn/end',{turn,reason:{kind:reason}});this.active.delete(sessionId);}
  continuePending(sessionId:string,callId:string){const question=this.pending.get(sessionId)!.find(item=>item.callId===callId)!;question.state='continued';this.append(sessionId,'tool/result',{turn:this.turn(sessionId),step:1,message:{toolCallId:callId,content:[{type:'text',text:JSON.stringify({pending:true})}]}});this.close(sessionId);}
  async answerQuestion(sessionId:string,callId:string,answers:WorkflowQuestionAnswer[]){const item=this.pending.get(sessionId)?.find(question=>question.callId===callId&&question.actionable);if(!item)return false;this.pending.set(sessionId,this.pending.get(sessionId)!.filter(question=>question!==item));this.received.push({sessionId,callId,answers:structuredClone(answers)});if(item.state==='continued')this.begin(sessionId,`late-reply-${++this.next}`,{kind:'user-question-reply',callId,outcome:'answered'},JSON.stringify({answers}));else this.append(sessionId,'tool/result',{turn:this.turn(sessionId),step:1,message:{toolCallId:callId,content:[{type:'text',text:JSON.stringify({answers})}]}});return true;}
}
const contexts:Context[]=[],roots:string[]=[];
afterEach(async()=>{for(const ctx of contexts.splice(0).reverse())await ctx.fiber.dispose();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function open(root?:string,native=new QuestionNative()){root??=await mkdtemp(join(tmpdir(),'workflow-question-owner-'));if(!roots.includes(root))roots.push(root);const ctx=new Context();contexts.push(ctx);await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root});await ctx.plugin(Domain,{backend:'json'});await ctx.plugin(Service);const service=ctx.visualWorkflow;Reflect.set(service,'native',native);return {service,native,ctx,root};}
async function edit(service:Service,id:string,transform:(workflow:Workflow)=>Workflow){for(let attempt=0;attempt<4;attempt++){const current=(await service.get({id})).workflow!,saved=await service.save({workflow:transform(current),expectedRevision:current.revision});if(saved.ok)return saved.workflow;if(saved.code!=='conflict')throw new Error(saved.code);}throw new Error('Repeated isolated question metadata conflict');}
async function task(service:Service,child=false){const created=(await service.create({name:'Native question ownership'})).workflow;const workflow=await edit(service,created.id,current=>({...current,settings:{...current.settings!,generation:'manual',...(child?{subagents:'on' as const}:{})},nodes:[{id:'task',title:'Question task',instruction:'Ask controlled questions',source:'user',status:'draft',revision:1,position:{x:100,y:100}}]}));const request=await service.run({workflowId:workflow.id,nodeId:'task',operationId:`question-run-${workflow.id}`});return {workflow:request.workflow,run:request.workflow.executions!.find(run=>run.runId===request.runId)!};}
async function reconcile(service:Service,sessionId:string){await (Reflect.get(service,'reconcileSession') as (id:string)=>Promise<void>).call(service,sessionId);}
const one:WorkflowQuestionItem[]=[{id:'choice',question:'Choose the supported path',options:[{label:'Alpha',description:'First route'},{label:'Beta'}]}];
const several:WorkflowQuestionItem[]=[...one,{id:'features',question:'Choose features',multiSelect:true,options:[{label:'One'},{label:'Two'}]},{id:'notes',question:'Optional details',detail:'Reviewed detail'}];
const answer=(run:Execution,workflowId:string,callId:string,answers:WorkflowQuestionAnswer[])=>({workflowId,runId:run.runId,sessionId:run.sessionId,callId,answers});

describe('native user question ownership at Workflow boundaries',()=>{
  it('projects each native call with exact workflow/run/node/Session ownership without persisting question bodies',async()=>{
    const {service,native,root}=await open(),{workflow,run}=await task(service);const first=native.ask(run.sessionId,'ask-one',one),second=native.ask(run.sessionId,'ask-several',several);
    const pending=(await service.questions({workflowId:workflow.id})).questions;expect(pending).toEqual([first,second].map(question=>({...question,workflowId:workflow.id,runId:run.runId,nodeId:run.nodeId})));
    const metadata=await readFile(join(root,'visual_workflow.json'),'utf8');expect(metadata).not.toContain('Choose the supported path');expect(metadata).not.toContain('Reviewed detail');
  });
  it('rejects cross-workflow, wrong-run and wrong-Session answers before invoking the native adapter',async()=>{
    const {service,native}=await open(),first=await task(service),second=await task(service);native.ask(first.run.sessionId,'same-call-id',one);native.ask(second.run.sessionId,'same-call-id',one);const answers=[{id:'choice',selected:['Alpha']}];
    await expect(service.answerQuestion(answer(first.run,second.workflow.id,'same-call-id',answers))).rejects.toThrow(/belong/);
    await expect(service.answerQuestion({...answer(first.run,first.workflow.id,'same-call-id',answers),runId:second.run.runId})).rejects.toThrow(/belong/);
    await expect(service.answerQuestion({...answer(first.run,first.workflow.id,'same-call-id',answers),sessionId:second.run.sessionId})).rejects.toThrow(/belong/);
    expect(native.received).toHaveLength(0);expect((await service.questions({workflowId:first.workflow.id})).questions.map(question=>question.sessionId)).toEqual([first.run.sessionId]);
  });
  it('validates complete answer IDs, native option labels and single/multiple selection then submits at most once',async()=>{
    const {service,native}=await open(),{workflow,run}=await task(service);native.ask(run.sessionId,'complete-batch',several);const valid:WorkflowQuestionAnswer[]=[{id:'choice',selected:['Beta']},{id:'features',selected:['One','Two']},{id:'notes',selected:[],custom:'Human-provided note'}];
    for(const invalid of [valid.slice(1),[valid[0]!,valid[0]!,valid[2]!],valid.map(item=>item.id==='choice'?{...item,selected:['Invented label']}:item),valid.map(item=>item.id==='choice'?{...item,selected:['Alpha','Beta']}:item),valid.map(item=>item.id==='features'?{...item,selected:['One','One']}:item),valid.map(item=>item.id==='notes'?{...item,selected:['not an option']}:item)])await expect(service.answerQuestion(answer(run,workflow.id,'complete-batch',invalid))).rejects.toThrow();
    expect(native.received).toHaveLength(0);
    const duplicate=await Promise.all([service.answerQuestion(answer(run,workflow.id,'complete-batch',valid)),service.answerQuestion(answer(run,workflow.id,'complete-batch',valid))]);expect(duplicate.map(result=>result.accepted).sort()).toEqual([false,true]);expect(native.received).toEqual([{sessionId:run.sessionId,callId:'complete-batch',answers:valid}]);
    expect(await service.answerQuestion(answer(run,workflow.id,'complete-batch',valid))).toEqual({accepted:false});
  });
  it('rejects stale/non-actionable native state and unowned tool calls without creating a replacement prompt',async()=>{
    const {service,native}=await open(),{workflow,run}=await task(service);native.ask(run.sessionId,'expired',one);native.pending.set(run.sessionId,[]);const count=native.submissions.length;expect(await service.answerQuestion(answer(run,workflow.id,'expired',[{id:'choice',selected:[]}]))).toEqual({accepted:false});
    const denied=native.ask(run.sessionId,'not-actionable',one,'open',false);expect(await service.answerQuestion(answer(run,workflow.id,denied.callId,[{id:'choice',selected:[]}]))).toEqual({accepted:false});native.pending.set(run.sessionId,[{...denied,callId:'no-native-tool-occurrence',actionable:true}]);expect((await service.questions({workflowId:workflow.id})).questions).toEqual([]);expect(native.received).toHaveLength(0);expect(native.submissions).toHaveLength(count);
  });
  it('keeps timed continued questions answerable after native control snapshots from the same execution',async()=>{
    const {service,native}=await open(),{workflow,run}=await task(service);native.ask(run.sessionId,'continued-controls',one);native.continuePending(run.sessionId,'continued-controls');await reconcile(service,run.sessionId);
    for(const kind of ['model-selection','runtime-context','tool-registry','skill-catalog','time-context'])native.append(run.sessionId,'user/message',{id:`notice-${kind}`,source:{kind},content:[{type:'text',text:'Native control notice'}]});
    expect((await service.questions({workflowId:workflow.id})).questions).toHaveLength(1);expect(await service.answerQuestion(answer(run,workflow.id,'continued-controls',[{id:'choice',selected:['Alpha']}]))).toEqual({accepted:true});
  });
  it('does not steer a late answer into a later unrelated native user turn in the same Session',async()=>{
    const {service,native}=await open(),{workflow,run}=await task(service);native.ask(run.sessionId,'old-question',one);native.continuePending(run.sessionId,'old-question');await reconcile(service,run.sessionId);native.begin(run.sessionId,'unrelated-rpc',{kind:'user',rpcId:'unrelated-rpc'},'Unrelated native chat');const count=native.submissions.length;
    expect((await service.questions({workflowId:workflow.id})).questions).toEqual([]);expect(await service.answerQuestion(answer(run,workflow.id,'old-question',[{id:'choice',selected:['Alpha']}]))).toEqual({accepted:false});expect(native.received).toHaveLength(0);expect(native.submissions).toHaveLength(count);
  });
  it('retains exact question ownership when a later linear Workflow execution reuses the Session',async()=>{
    const {service,native}=await open(),{workflow,run}=await task(service);native.ask(run.sessionId,'old-run-question',one);native.continuePending(run.sessionId,'old-run-question');await reconcile(service,run.sessionId);
    await edit(service,workflow.id,current=>({...current,nodes:[...current.nodes,{id:'next',title:'Next task',instruction:'Ask the next task question',source:'user',status:'draft',revision:1,position:{x:500,y:100}}],edges:[...current.edges,{id:'task-next',source:'task',target:'next',type:'dependency'}]}));
    const nextRequest=await service.run({workflowId:workflow.id,nodeId:'next',operationId:'same-session-next-task'}),next=nextRequest.workflow.executions!.find(item=>item.runId===nextRequest.runId)!;expect(next.sessionId).toBe(run.sessionId);native.ask(next.sessionId,'next-run-question',one);
    expect((await service.questions({workflowId:workflow.id})).questions).toMatchObject([{runId:next.runId,nodeId:'next',sessionId:next.sessionId,callId:'next-run-question'}]);
    const count=native.submissions.length;expect(await service.answerQuestion(answer(run,workflow.id,'old-run-question',[{id:'choice',selected:['Alpha']}]))).toEqual({accepted:false});expect(native.received).toHaveLength(0);expect(native.submissions).toHaveLength(count);
    expect(await service.answerQuestion(answer(next,workflow.id,'next-run-question',[{id:'choice',selected:['Beta']}]))).toEqual({accepted:true});expect(native.received).toEqual([{sessionId:next.sessionId,callId:'next-run-question',answers:[{id:'choice',selected:['Beta']}]}]);
  });
  it('does not steer a continued old-run answer into a newer task admitted to the native inbox before claim',async()=>{
    const {service,native}=await open(),{workflow,run}=await task(service);native.ask(run.sessionId,'old-before-claim',one);native.continuePending(run.sessionId,'old-before-claim');await reconcile(service,run.sessionId);
    await edit(service,workflow.id,current=>({...current,nodes:[...current.nodes,{id:'next',title:'Queued next task',instruction:'New task awaiting inbox claim',source:'user',status:'draft',revision:1,position:{x:500,y:100}}],edges:[...current.edges,{id:'task-next',source:'task',target:'next',type:'dependency'}]}));
    vi.spyOn(native,'submit').mockImplementationOnce(async request=>{native.submissions.push(request);native.append(request.sessionId,'agent/inbox/spliced',{target:'next-turn',start:0,removedCount:0,inserted:[{id:request.requestId,source:{kind:'user',rpcId:request.requestId},content:[{type:'text',text:request.text}]}]});});
    const submitted=await service.run({workflowId:workflow.id,nodeId:'next',operationId:'queue-before-native-claim'}),next=submitted.workflow.executions!.find(item=>item.runId===submitted.runId)!;expect(next).toMatchObject({sessionId:run.sessionId,status:'ready'});expect((await native.read(run.sessionId)).events.some(event=>event.type==='user/message'&&event.data.id===next.requestId)).toBe(false);
    expect(await service.answerQuestion(answer(run,workflow.id,'old-before-claim',[{id:'choice',selected:['Alpha']}]))).toEqual({accepted:false});expect(native.received).toHaveLength(0);
  });
  it('keeps an open foreground question answerable while its downstream task waits for completion',async()=>{
    const {service,native}=await open(),{workflow,run}=await task(service);native.ask(run.sessionId,'open-with-waiting-successor',one);
    await edit(service,workflow.id,current=>({...current,nodes:[...current.nodes,{id:'next',title:'Waiting next task',instruction:'Run after the current native question finishes',source:'user',status:'draft',revision:1,position:{x:500,y:100}}],edges:[...current.edges,{id:'task-next',source:'task',target:'next',type:'dependency'}]}));
    const requested=await service.run({workflowId:workflow.id,nodeId:'next',operationId:'open-question-waiting-next'});expect(requested.workflow.executions!.find(item=>item.runId===requested.runId)).toMatchObject({sessionId:run.sessionId,status:'waiting'});expect((await service.questions({workflowId:workflow.id})).questions).toMatchObject([{runId:run.runId,callId:'open-with-waiting-successor',state:'open',actionable:true}]);
    expect(await service.answerQuestion(answer(run,workflow.id,'open-with-waiting-successor',[{id:'choice',selected:['Alpha']}]))).toEqual({accepted:true});expect(native.received).toHaveLength(1);expect(native.submissions).toHaveLength(1);native.close(run.sessionId);await reconcile(service,run.sessionId);
    await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.executions!.find(item=>item.runId===requested.runId)?.status).toBe('running'));expect(native.submissions).toHaveLength(2);
  });
  it('marks a late answer held in the native inbox as active before claim and waits to admit its successor until that continuation completes',async()=>{
    const {service,native}=await open(),{workflow,run}=await task(service);native.ask(run.sessionId,'held-late-reply',one);native.continuePending(run.sessionId,'held-late-reply');await reconcile(service,run.sessionId);const originalEnd=(await service.get({id:workflow.id})).workflow!.executions!.find(item=>item.runId===run.runId)!.endSeq!;
    await edit(service,workflow.id,current=>({...current,nodes:[...current.nodes,{id:'next',title:'After the answer',instruction:'Use the complete predecessor including its native answer continuation',source:'user',status:'draft',revision:1,position:{x:500,y:100}}],edges:[...current.edges,{id:'task-next',source:'task',target:'next',type:'dependency'}]}));
    vi.spyOn(native,'answerQuestion').mockImplementationOnce(async(sessionId,callId,answers)=>{native.pending.set(sessionId,[]);native.received.push({sessionId,callId,answers:structuredClone(answers)});native.heldReplies.set(sessionId,[callId]);native.append(sessionId,'agent/inbox/spliced',{target:'next-step',start:0,removedCount:0,inserted:[{id:'held-reply-message',source:{kind:'user-question-reply',callId,outcome:'answered'},content:[{type:'text',text:JSON.stringify({answers})}]}]});return true;});
    expect(await service.answerQuestion(answer(run,workflow.id,'held-late-reply',[{id:'choice',selected:['Beta']}]))).toEqual({accepted:true});const ready=(await service.get({id:workflow.id})).workflow!.executions!.find(item=>item.runId===run.runId)!;expect(ready.status).toBe('ready');expect(ready.endSeq).toBeUndefined();expect(ready.terminalReason).toBeUndefined();expect((await service.trace({workflowId:workflow.id,runId:run.runId})).trace.status).toBe('ready');
    const requested=await service.run({workflowId:workflow.id,nodeId:'next',operationId:'after-held-native-reply'});expect(requested.workflow.executions!.find(item=>item.runId===requested.runId)?.status).toBe('waiting');await (Reflect.get(service,'dispatchQueue') as(id:string)=>Promise<void>).call(service,workflow.id);expect(native.submissions).toHaveLength(1);
    native.heldReplies.delete(run.sessionId);native.append(run.sessionId,'agent/inbox/spliced',{target:'next-step',start:0,removedCount:1,inserted:[]});native.begin(run.sessionId,'held-reply-message',{kind:'user-question-reply',callId:'held-late-reply',outcome:'answered'},'Human answer claimed');await reconcile(service,run.sessionId);expect((await service.get({id:workflow.id})).workflow!.executions!.find(item=>item.runId===run.runId)?.status).toBe('running');expect(native.submissions).toHaveLength(1);
    native.close(run.sessionId);await reconcile(service,run.sessionId);expect((await service.get({id:workflow.id})).workflow!.executions!.find(item=>item.runId===run.runId)!.endSeq).toBeGreaterThan(originalEnd);
    await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.executions!.find(item=>item.runId===requested.runId)?.status).toBe('running'));expect(native.submissions).toHaveLength(2);
  });
  it('refuses a predecessor prefix containing an answer to an unowned question instead of treating every native reply as harmless',async()=>{
    const {service,native}=await open(),{workflow,run}=await task(service);native.append(run.sessionId,'user/message',{id:'foreign-native-question-answer',source:{kind:'user-question-reply',callId:'foreign-call-not-owned-by-this-execution',outcome:'answered'},content:[{type:'text',text:'FOREIGN_QUESTION_CONTEXT'}]});native.close(run.sessionId);await reconcile(service,run.sessionId);
    await edit(service,workflow.id,current=>({...current,nodes:[...current.nodes,{id:'next',title:'Unsafe predecessor',instruction:'Must not inherit another task answer',source:'user',status:'draft',revision:1,position:{x:500,y:100}}],edges:[...current.edges,{id:'task-next',source:'task',target:'next',type:'dependency'}]}));
    const requested=await service.run({workflowId:workflow.id,nodeId:'next',operationId:'reject-foreign-reply-prefix'});expect(requested.workflow.executions!.find(item=>item.runId===requested.runId)).toMatchObject({status:'failed',terminalReason:'context-isolation-required'});expect(native.submissions).toHaveLength(1);
  });
  it('continues an explicit historical fork whose inherited prefix includes the predecessor own native question answer',async()=>{
    const {service,native}=await open(),{workflow,run}=await task(service);native.ask(run.sessionId,'answer-in-inherited-prefix',one);native.continuePending(run.sessionId,'answer-in-inherited-prefix');await reconcile(service,run.sessionId);expect(await service.answerQuestion(answer(run,workflow.id,'answer-in-inherited-prefix',[{id:'choice',selected:['Alpha']}]))).toEqual({accepted:true});native.close(run.sessionId);await reconcile(service,run.sessionId);const sourceBefore=await native.read(run.sessionId);
    const fork=await service.fork({workflowId:workflow.id,runId:run.runId,operationId:'historical-owned-question-answer',label:'Answered history'}),branch=fork.workflow.branches!.find(item=>item.id===fork.branchId)!;expect(branch.sessionId).not.toBe(run.sessionId);expect((await native.read(branch.sessionId)).inheritedEventCount).toBe(sourceBefore.events.length);
    await edit(service,workflow.id,current=>({...current,nodes:[...current.nodes,{id:'next',title:'Continue answered history',instruction:'Use the inherited answer context',source:'user',status:'draft',revision:1,position:{x:500,y:100}}],edges:[...current.edges,{id:'task-next',source:'task',target:'next',type:'dependency'}]}));
    const requested=await service.run({workflowId:workflow.id,nodeId:'next',branchId:branch.id,operationId:'run-from-inherited-answer'});expect(requested.workflow.executions!.find(item=>item.runId===requested.runId)).toMatchObject({sessionId:branch.sessionId,status:'running'});expect(native.submissions).toHaveLength(2);expect(await native.read(run.sessionId)).toEqual(sourceBefore);
  });
  it('propagates a question expiring at the native answer boundary without submitting another task',async()=>{
    const {service,native}=await open(),{workflow,run}=await task(service);native.ask(run.sessionId,'expires-on-answer',one);const count=native.submissions.length;
    const adapter=vi.spyOn(native,'answerQuestion').mockImplementationOnce(async(sessionId)=>{native.pending.set(sessionId,[]);return false;});
    expect(await service.answerQuestion(answer(run,workflow.id,'expires-on-answer',[{id:'choice',selected:['Alpha']}]))).toEqual({accepted:false});expect(adapter).toHaveBeenCalledOnce();expect(native.received).toHaveLength(0);expect(native.submissions).toHaveLength(count);expect((await service.questions({workflowId:workflow.id})).questions).toEqual([]);
  });
  it('restores a native continued question after restart without resubmitting the task and includes its answer continuation in the original trace',async()=>{
    const first=await open(),{workflow,run}=await task(first.service);first.native.ask(run.sessionId,'restart-question',one);first.native.continuePending(run.sessionId,'restart-question');await reconcile(first.service,run.sessionId);const originalEnd=(await first.service.get({id:workflow.id})).workflow!.executions![0]!.endSeq!;await first.ctx.fiber.dispose();
    const second=await open(first.root,first.native);await (Reflect.get(second.service,'recover') as ()=>Promise<void>).call(second.service);const restored=(await second.service.questions({workflowId:workflow.id})).questions;expect(restored).toHaveLength(1);expect(restored[0]).toMatchObject({runId:run.runId,sessionId:run.sessionId,callId:'restart-question',state:'continued'});expect(second.native.submissions).toHaveLength(1);
    expect(await second.service.answerQuestion(answer(run,workflow.id,'restart-question',[{id:'choice',selected:['Beta']}]))).toEqual({accepted:true});await reconcile(second.service,run.sessionId);const openTrace=(await second.service.trace({workflowId:workflow.id,runId:run.runId})).trace;expect(openTrace.status).toBe('running');expect(openTrace.endSeq).toBeUndefined();second.native.close(run.sessionId);await reconcile(second.service,run.sessionId);const trace=(await second.service.trace({workflowId:workflow.id,runId:run.runId})).trace;expect(trace.status).toBe('completed');expect(trace.endSeq).toBeGreaterThan(originalEnd);expect((await second.service.questions({workflowId:workflow.id})).questions).toEqual([]);expect(second.native.submissions).toHaveLength(1);
  });
  it('uses the actual child Session/messageId for question provenance and never answers through its coordinator',async()=>{
    const {service,native}=await open(),{workflow,run}=await task(service,true);expect(run.subagent?.messageId).toBeTruthy();native.ask(run.sessionId,'child-question',one,'open',false);const pending=(await service.questions({workflowId:workflow.id})).questions;expect(pending).toHaveLength(1);expect(pending[0]).toMatchObject({runId:run.runId,sessionId:run.sessionId,actionable:false});
    await expect(service.answerQuestion({...answer(run,workflow.id,'child-question',[{id:'choice',selected:[]}]),sessionId:run.subagent!.parentSessionId})).rejects.toThrow(/belong/);expect(await service.answerQuestion(answer(run,workflow.id,'child-question',[{id:'choice',selected:[]}]))).toEqual({accepted:false});expect(native.received).toHaveLength(0);
  });
});
