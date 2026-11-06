import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as Domain from '@deepseek-ai/dsh-storage-domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Service from '../src/host/service.ts';
import type { NativeRuntime, NativeSessionLog, NativeEvent, NativeFileReference } from '../src/host/native-runtime.ts';
import type { Workflow, WorkflowNode, WorkflowModelIdentity } from '../src/shared/model.ts';

type Mode='off'|'on'|'auto';
interface StartedTask {
  kind:'normal'|'subagent';sessionId:string;requestId?:string;messageId:string;parentSessionId?:string;text:string;
  files?:readonly NativeFileReference[];model?:WorkflowModelIdentity;context:NativeEvent[];
}
/** Real plugin/storage orchestration, deterministic native-provider boundary.
 * Starts remain open until the test explicitly finishes them, so simultaneous
 * start assertions cannot pass through fast sequential task completion. */
class GatedNative implements NativeRuntime {
  next=0;available=true;loseSubagentResponseOnce=false;
  readonly logs=new Map<string,NativeSessionLog>();
  readonly started:StartedTask[]=[];
  readonly active=new Set<string>();
  readonly cancellations:Array<{kind:'normal'|'subagent';sessionId:string;requestId?:string}>=[];
  readonly forks:Array<{sessionId:string;atSeq:number}>=[];
  readonly uploadReceipts=new Map<string,NativeFileReference>();
  readonly listeners=new Set<(sessionId:string,event:NativeEvent)=>void>();
  readonly defaultModel={provider:'controlled',model:'default'};
  supportsSubagents(){return this.available;}
  async models(){return {models:[{...this.defaultModel,label:'Controlled default'},{provider:'controlled',model:'override',label:'Controlled override'}],defaultModel:this.defaultModel};}
  async resolveModel(selected?:WorkflowModelIdentity){return selected??this.defaultModel;}
  protectPlanning(_sessionId:string){}
  async resolveUploadedFile(sessionId:string,receiptId:string):Promise<NativeFileReference>{const file=this.uploadReceipts.get(`${sessionId}:${receiptId}`);if(!file)throw new Error('Receipt does not belong to this isolated Session');return structuredClone(file);}
  async catalog(){return [...this.logs.values()].map(log=>({sessionId:log.sessionId,title:log.sessionId,updatedAt:1,running:this.active.has(log.sessionId),blank:!log.events.length,parentSessionId:log.header.parentSession}));}
  async read(id:string){const log=this.logs.get(id);if(!log)throw new Error(`Missing isolated Session ${id}`);return structuredClone(log);}
  async create(options:{sessionId?:string;cwd?:string;agentPreset?:string}={}){const sessionId=options.sessionId??`gated-${++this.next}`;if(this.logs.has(sessionId))throw new Error('Existing source cannot be reused');this.logs.set(sessionId,{sessionId,header:{id:sessionId,createdAt:1,isSeeded:false,cwd:options.cwd,agentPreset:options.agentPreset},inheritedEventCount:0,events:[]});return {sessionId};}
  async fork(request:{sessionId:string;atSeq:number}){this.forks.push(request);const source=await this.read(request.sessionId);const boundary=source.events.find(event=>event.seq===request.atSeq);if(boundary?.type!=='turn/end'||(boundary.data.reason as {kind?:string})?.kind!=='completed')throw new Error('Unsafe fixture Fork boundary');const sessionId=`gated-${++this.next}`;this.copy(source,sessionId,request.atSeq);return {sessionId,inheritedEventCount:request.atSeq+1};}
  private copy(source:NativeSessionLog,sessionId:string,boundary:number){if(this.logs.has(sessionId))throw new Error('Child Session must be new');this.logs.set(sessionId,{...structuredClone(source),sessionId,header:{...source.header,id:sessionId,parentSession:source.sessionId,isSeeded:boundary>=0},inheritedEventCount:boundary+1,events:structuredClone(source.events.filter(event=>event.seq<=boundary))});}
  private append(sessionId:string,type:string,data:Record<string,unknown>){const log=this.logs.get(sessionId)!;const event={type,data,seq:log.events.length,time:log.events.length+1};log.events.push(event);for(const listener of this.listeners)listener(sessionId,event);}
  private begin(task:Omit<StartedTask,'context'>){if(this.active.has(task.sessionId))throw new Error('A native Session already has an open task');const log=this.logs.get(task.sessionId)!,turn=log.events.filter(event=>event.type==='turn/start').length+1;this.started.push({...task,context:structuredClone(log.events)});this.active.add(task.sessionId);this.append(task.sessionId,'turn/start',{turn});this.append(task.sessionId,'user/message',{id:task.messageId,source:task.kind==='subagent'?{kind:'user'}:{kind:'user',rpcId:task.requestId},content:[{type:'text',text:task.text}]});this.append(task.sessionId,'step/start',{turn,step:1});}
  async submit(request:{sessionId:string;requestId:string;text:string;files?:readonly NativeFileReference[];model?:WorkflowModelIdentity}){if(this.started.some(task=>task.requestId===request.requestId))return;this.begin({kind:'normal',sessionId:request.sessionId,requestId:request.requestId,messageId:request.requestId,text:request.text,files:request.files,model:request.model});}
  async startSubagent(request:{parentSessionId:string;childSessionId:string;label:string;text:string;files?:readonly NativeFileReference[];model?:WorkflowModelIdentity}){
    if(!this.available)throw new Error('No native subagent provider');
    const source=await this.read(request.parentSessionId);if(this.active.has(source.sessionId))throw new Error('Coordinator must be idle');
    const boundary=source.events.findLast(event=>event.type==='turn/end'&&(event.data.reason as {kind?:string})?.kind==='completed')?.seq??-1;
    this.copy(source,request.childSessionId,boundary);
    const messageId=`native-child-message-${++this.next}`;
    this.begin({kind:'subagent',sessionId:request.childSessionId,parentSessionId:request.parentSessionId,messageId,text:request.text,files:request.files,model:request.model});
    // Native catalog metadata belongs to the private coordinator, never to a
    // source task's already completed Session or the imported original.
    this.append(request.parentSessionId,'subagent/catalog',{childSessionId:request.childSessionId});
    if(this.loseSubagentResponseOnce){this.loseSubagentResponseOnce=false;throw new Error('Child started but native response was lost');}
    return {messageId};
  }
  finish(sessionId:string,reason='completed') {if(!this.active.has(sessionId))throw new Error('Cannot finish an idle fixture task');const log=this.logs.get(sessionId)!,turn=log.events.findLast(event=>event.type==='turn/start')!.data.turn;this.append(sessionId,'assistant/message',{turn,step:1,message:{content:[{type:'text',text:`Controlled result for ${sessionId}`} ]}});this.append(sessionId,'step/end',{turn,step:1});this.append(sessionId,'turn/end',{turn,reason:{kind:reason}});this.active.delete(sessionId);}
  async cancel(sessionId:string,requestId?:string){this.cancellations.push({kind:'normal',sessionId,requestId});if(this.active.has(sessionId)){this.finish(sessionId,'aborted');return 'active' as const;}return 'none' as const;}
  async cancelSubagent(sessionId:string){this.cancellations.push({kind:'subagent',sessionId});if(this.active.has(sessionId))this.finish(sessionId,'aborted');}
  async flush(_sessionId:string){}
  isRunning(sessionId:string){return this.active.has(sessionId);}
  async waitForIdle(_sessionId:string){}
  subscribe(listener:(sessionId:string,event:NativeEvent)=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
}
const contexts:Context[]=[],roots:string[]=[];
afterEach(async()=>{for(const ctx of contexts.splice(0).reverse())await ctx.fiber.dispose();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function open(root?:string,native=new GatedNative()){
  root??=await mkdtemp(join(tmpdir(),'workflow-subagent-'));if(!roots.includes(root))roots.push(root);
  const ctx=new Context();contexts.push(ctx);await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root});await ctx.plugin(Domain,{backend:'json'});await ctx.plugin(Service);const service=ctx.visualWorkflow;Reflect.set(service,'native',native);return {ctx,service,native,root};
}
const node=(id:string):WorkflowNode=>({id,title:id,instruction:`SCHEDULER_TOKEN_${id}`,source:'user',status:'draft',revision:1,position:{x:100,y:100}});
async function edit(service:Service,id:string,transform:(workflow:Workflow)=>Workflow){for(let attempt=0;attempt<4;attempt++){const current=(await service.get({id})).workflow!,result=await service.save({workflow:transform(current),expectedRevision:current.revision});if(result.ok)return result.workflow;if(result.code!=='conflict')throw new Error(result.code);}throw new Error('Repeated isolated metadata conflict');}
async function graph(service:Service,mode:Mode|undefined,ids:string[],pairs:string[][]=[]){const created=(await service.create({name:'Gated child scheduler'})).workflow;return edit(service,created.id,current=>({...current,settings:{...current.settings!,generation:'manual',...(mode?{subagents:mode}:{})},nodes:ids.map(node),edges:pairs.map(([source,target],index)=>({id:`edge-${index}`,source:source!,target:target!,type:'dependency'}))}));}
async function batch(service:Service,id:string,ids:string[],operationId:string){const current=(await service.get({id})).workflow!;return service.batchRun({workflowId:id,nodeIds:ids,nodeRevisions:Object.fromEntries(ids.map(nodeId=>[nodeId,current.nodes.find(node=>node.id===nodeId)!.revision])),operationId});}
const taskFor=(native:GatedNative,id:string)=>native.started.find(task=>task.text===`Task: ${id}\n\nSCHEDULER_TOKEN_${id}`);
const children=(native:GatedNative)=>native.started.filter(task=>task.kind==='subagent');
async function finish(service:Service,native:GatedNative,sessionId:string){native.finish(sessionId);await (Reflect.get(service,'reconcileSession') as (id:string)=>Promise<void>).call(service,sessionId);}
async function recover(service:Service){await (Reflect.get(service,'recover') as ()=>Promise<void>).call(service);}
async function settled(service:Service,workflowId:string,runId:string,status='completed'){await vi.waitFor(async()=>expect((await service.get({id:workflowId})).workflow!.executions!.find(run=>run.runId===runId)?.status).toBe(status));}

describe('native subagent scheduler admission and isolation',()=>{
  it.each([undefined,'off'] as const)('keeps legacy native submission and creates no subagent when mode is %s',async mode=>{
    const {service,native}=await open(),workflow=await graph(service,mode,['a']);
    const requested=await service.run({workflowId:workflow.id,nodeId:'a',operationId:`normal-${mode??'absent'}`});
    expect(native.started).toHaveLength(1);expect(native.started[0]!.kind).toBe('normal');expect(children(native)).toHaveLength(0);expect(requested.workflow.executions!.find(run=>run.runId===requested.runId)!.subagent).toBeUndefined();
    await finish(service,native,native.started[0]!.sessionId);await settled(service,workflow.id,requested.runId!);
  });
  it('starts two clicked independent child Sessions before either finishes and keeps their model and input routes separate',async()=>{
    const {service,native}=await open(),workflow=await graph(service,'on',['a','b']);
    const configured=await edit(service,workflow.id,current=>({...current,nodes:current.nodes.map(item=>item.id==='b'?{...item,model:{provider:'controlled',model:'override'}}:item)}));
    const fileA={attachmentId:'native-file-a',name:'a.txt',bytes:11},fileB={attachmentId:'native-file-b',name:'b.txt',bytes:22};
    const upload=await service.prepareAttachment({workflowId:workflow.id,nodeId:'a',nodeRevision:1,operationId:'prepare-child-files'});
    native.uploadReceipts.set(`${upload.sessionId}:receipt-a`,fileA);native.uploadReceipts.set(`${upload.sessionId}:receipt-b`,fileB);
    await service.attachFiles({workflowId:workflow.id,nodeId:'a',nodeRevision:1,sessionId:upload.sessionId,receiptIds:['receipt-a'],operationId:'file-for-child-a'});
    const nodeB=(await service.get({id:workflow.id})).workflow!.nodes.find(item=>item.id==='b')!;
    await service.attachFiles({workflowId:workflow.id,nodeId:'b',nodeRevision:nodeB.revision,sessionId:upload.sessionId,receiptIds:['receipt-b'],operationId:'file-for-child-b'});
    const requested=await batch(service,workflow.id,['a','b'],'parallel-child-wave');
    await vi.waitFor(()=>expect(children(native)).toHaveLength(2));
    const a=taskFor(native,'a')!,b=taskFor(native,'b')!;
    expect(a.kind).toBe('subagent');expect(b.kind).toBe('subagent');expect(a.sessionId).not.toBe(b.sessionId);expect(a.parentSessionId).not.toBe(b.parentSessionId);expect(native.active.has(a.sessionId)&&native.active.has(b.sessionId)).toBe(true);
    expect(a.model).toEqual(native.defaultModel);expect(b.model).toEqual(configured.nodes.find(item=>item.id==='b')!.model);expect(a.files).toEqual([fileA]);expect(b.files).toEqual([fileB]);expect(JSON.stringify(a.context)).not.toContain('SCHEDULER_TOKEN_b');expect(JSON.stringify(b.context)).not.toContain('SCHEDULER_TOKEN_a');
    const current=(await service.get({id:workflow.id})).workflow!;
    for(const run of current.executions!){const task=native.started.find(item=>item.sessionId===run.sessionId)!;expect(run.subagent).toMatchObject({parentSessionId:task.parentSessionId,messageId:task.messageId,provider:'fork'});expect(run.status).not.toBe('completed');const event=native.logs.get(run.sessionId)!.events.find(item=>item.type==='user/message'&&item.data.id===task.messageId)!;expect((event.data.source as {rpcId?:string}).rpcId).toBeUndefined();}
    await finish(service,native,a.sessionId);await finish(service,native,b.sessionId);for(const runId of requested.runIds)await settled(service,workflow.id,runId);
    for(const run of (await service.get({id:workflow.id})).workflow!.executions!){const trace=(await service.trace({workflowId:workflow.id,runId:run.runId})).trace;expect(trace.status).toBe('completed');expect(trace.steps.length).toBeGreaterThan(0);}
  });
  it('keeps the imported source and completed common task immutable while each child inherits its exact prefix',async()=>{
    const {service,native}=await open(),source=await native.create({cwd:'C:/isolated-subagent-fixture'});
    await native.submit({sessionId:source.sessionId,requestId:'immutable-source',text:'IMMUTABLE_SOURCE_CONTEXT'});native.finish(source.sessionId);
    const original=JSON.stringify(await native.read(source.sessionId)),imported=(await service.importSession({sessionId:source.sessionId})).workflow;
    const workflow=await edit(service,imported.id,current=>({...current,settings:{...current.settings!,generation:'manual',subagents:'on'},nodes:[...current.nodes,...['a','b','c'].map(node)],edges:[{id:'a-b',source:'a',target:'b',type:'dependency'},{id:'a-c',source:'a',target:'c',type:'dependency'}]}));
    const aRequest=await service.run({workflowId:workflow.id,nodeId:'a',operationId:'common-child-prefix'});await vi.waitFor(()=>expect(taskFor(native,'a')).toBeDefined());const a=taskFor(native,'a')!;await finish(service,native,a.sessionId);await settled(service,workflow.id,aRequest.runId!);
    const common=JSON.stringify(await native.read(a.sessionId));await batch(service,workflow.id,['b','c'],'children-from-common-prefix');await vi.waitFor(()=>expect(taskFor(native,'b')&&taskFor(native,'c')).toBeTruthy());
    for(const id of ['b','c']){const child=taskFor(native,id)!;expect(child.kind).toBe('subagent');expect(JSON.stringify(child.context)).toContain('IMMUTABLE_SOURCE_CONTEXT');expect(JSON.stringify(child.context)).toContain('SCHEDULER_TOKEN_a');expect(JSON.stringify(child.context)).not.toContain(`SCHEDULER_TOKEN_${id==='b'?'c':'b'}`);await finish(service,native,child.sessionId);}
    expect(JSON.stringify(await native.read(source.sessionId))).toBe(original);expect(JSON.stringify(await native.read(a.sessionId))).toBe(common);
  });
  it('never spawns an unclicked prerequisite and waits for its durable completion before the clicked successor starts',async()=>{
    const {service,native}=await open(),workflow=await graph(service,'on',['a','b','unselected'],[['a','b']]);
    const waiting=await service.run({workflowId:workflow.id,nodeId:'b',operationId:'clicked-only-b'});expect(native.started).toHaveLength(0);expect(waiting.workflow.executions!.find(run=>run.runId===waiting.runId)!.status).toBe('waiting');
    const parent=await service.run({workflowId:workflow.id,nodeId:'a',operationId:'click-prerequisite-a'});await vi.waitFor(()=>expect(taskFor(native,'a')).toBeDefined());expect(taskFor(native,'b')).toBeUndefined();
    const a=taskFor(native,'a')!;await finish(service,native,a.sessionId);await settled(service,workflow.id,parent.runId!);await vi.waitFor(()=>expect(taskFor(native,'b')).toBeDefined());const b=taskFor(native,'b')!;
    expect(b.kind).toBe('subagent');expect(JSON.stringify(b.context)).toContain('SCHEDULER_TOKEN_a');expect(taskFor(native,'unselected')).toBeUndefined();expect(native.logs.get(a.sessionId)!.events.at(-1)?.type).toBe('turn/end');
    await finish(service,native,b.sessionId);await settled(service,workflow.id,waiting.runId!);
  });
  it('does not let subagent mode bypass stale transitive inputs and resumes only after the intermediate task is refreshed',async()=>{
    const {service,native}=await open(),workflow=await graph(service,'on',['a','b','c'],[['a','b'],['b','c']]);
    const firstA=await service.run({workflowId:workflow.id,nodeId:'a',operationId:'stale-first-a'});await finish(service,native,taskFor(native,'a')!.sessionId);await settled(service,workflow.id,firstA.runId!);
    const firstB=await service.run({workflowId:workflow.id,nodeId:'b',operationId:'stale-first-b'});await finish(service,native,taskFor(native,'b')!.sessionId);await settled(service,workflow.id,firstB.runId!);
    const newA=await service.run({workflowId:workflow.id,nodeId:'a',operationId:'stale-new-a'});const a2=native.started.findLast(task=>task.text==='Task: a\n\nSCHEDULER_TOKEN_a')!;await finish(service,native,a2.sessionId);await settled(service,workflow.id,newA.runId!);
    const waiting=await service.run({workflowId:workflow.id,nodeId:'c',operationId:'stale-waiting-c'});expect(taskFor(native,'c')).toBeUndefined();expect(waiting.workflow.executions!.find(run=>run.runId===waiting.runId)).toMatchObject({status:'waiting',waitingReason:'stale_prerequisites'});
    const refreshed=await service.run({workflowId:workflow.id,nodeId:'b',operationId:'stale-refresh-b'});const b2=native.started.findLast(task=>task.text==='Task: b\n\nSCHEDULER_TOKEN_b')!;await finish(service,native,b2.sessionId);await settled(service,workflow.id,refreshed.runId!);await vi.waitFor(()=>expect(taskFor(native,'c')).toBeDefined());const c=taskFor(native,'c')!;expect(JSON.stringify(c.context)).toContain(a2.messageId);expect(JSON.stringify(c.context)).toContain(b2.messageId);expect(JSON.stringify(c.context)).not.toContain(taskFor(native,'a')!.messageId);expect(JSON.stringify(c.context)).not.toContain(taskFor(native,'b')!.messageId);await finish(service,native,c.sessionId);await settled(service,workflow.id,waiting.runId!);
  });
  it('retains the existing cross-Session merge rejection instead of silently combining parallel children',async()=>{
    const {service,native}=await open(),workflow=await graph(service,'on',['a','b','c','d'],[['a','b'],['a','c'],['b','d'],['c','d']]);const requested=await batch(service,workflow.id,['d','c','b','a'],'merge-parallel-children');await vi.waitFor(()=>expect(taskFor(native,'a')).toBeDefined());expect(taskFor(native,'b')).toBeUndefined();expect(taskFor(native,'c')).toBeUndefined();await finish(service,native,taskFor(native,'a')!.sessionId);await vi.waitFor(()=>expect(taskFor(native,'b')&&taskFor(native,'c')).toBeTruthy());await finish(service,native,taskFor(native,'b')!.sessionId);expect(taskFor(native,'d')).toBeUndefined();await finish(service,native,taskFor(native,'c')!.sessionId);await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.executions!.find(run=>run.nodeId==='d')).toMatchObject({status:'failed',terminalReason:'context-isolation-required'}));expect(taskFor(native,'d')).toBeUndefined();expect(requested.runIds).toHaveLength(4);
  });
  it('caps an on wave at three active children and admits the fourth only after a slot settles',async()=>{
    const {service,native}=await open(),workflow=await graph(service,'on',['a','b','c','d']);const requested=await batch(service,workflow.id,['a','b','c','d'],'bounded-wave');
    await vi.waitFor(()=>expect(children(native)).toHaveLength(3));expect(native.active.size).toBe(3);expect(taskFor(native,'d')).toBeUndefined();const first=children(native)[0]!;await finish(service,native,first.sessionId);await vi.waitFor(()=>expect(children(native)).toHaveLength(4));expect(native.active.size).toBe(3);
    for(const task of children(native))if(native.active.has(task.sessionId))await finish(service,native,task.sessionId);for(const runId of requested.runIds)await settled(service,workflow.id,runId);
  });
  it('counts an uncertain but still running native child against the three-child limit',async()=>{
    const {service,native}=await open(),workflow=await graph(service,'on',['a','b','c','d']);native.loseSubagentResponseOnce=true;
    await service.run({workflowId:workflow.id,nodeId:'a',operationId:'uncertain-active-child'}).catch(()=>undefined);
    await vi.waitFor(()=>expect(children(native)).toHaveLength(1));expect(native.active.has(children(native)[0]!.sessionId)).toBe(true);
    await batch(service,workflow.id,['b','c','d'],'after-uncertain-child');
    expect(children(native)).toHaveLength(3);expect(native.active.size).toBe(3);expect(taskFor(native,'d')).toBeUndefined();
    const current=(await service.get({id:workflow.id})).workflow!;expect(current.executions!.find(run=>run.nodeId==='d')).toMatchObject({status:'waiting',waitingReason:'subagent_capacity'});
  });
  it('keeps active children on their admitted policy while changing mode invalidates waiting work and permits a fresh off request',async()=>{
    const {service,native}=await open(),workflow=await graph(service,'on',['a','b','c','d']);await batch(service,workflow.id,['a','b','c','d'],'policy-wave');await vi.waitFor(()=>expect(children(native)).toHaveLength(3));
    const before=(await service.get({id:workflow.id})).workflow!,active=before.executions!.filter(run=>run.subagent&&run.status!=='waiting');
    const changed=await edit(service,workflow.id,current=>({...current,settings:{...current.settings!,subagents:'off'}}));
    for(const run of active)expect(changed.executions!.find(item=>item.runId===run.runId)).toMatchObject({subagent:run.subagent,admissionPolicies:run.admissionPolicies});
    expect(changed.executions!.find(run=>run.nodeId==='d')).toMatchObject({status:'cancelled',terminalReason:'authorization-invalidated'});expect(native.cancellations).toHaveLength(0);
    for(const task of children(native))if(native.active.has(task.sessionId))await finish(service,native,task.sessionId);
    const fresh=await service.run({workflowId:workflow.id,nodeId:'d',operationId:'fresh-off-task'});expect(taskFor(native,'d')!.kind).toBe('normal');expect(children(native)).toHaveLength(3);await finish(service,native,taskFor(native,'d')!.sessionId);await settled(service,workflow.id,fresh.runId!);
  });
  it('continues a completed child result through the ordinary runner after the mode is turned off',async()=>{
    const {service,native}=await open(),workflow=await graph(service,'on',['a','b'],[['a','b']]);const first=await service.run({workflowId:workflow.id,nodeId:'a',operationId:'child-before-off'});const a=taskFor(native,'a')!;await finish(service,native,a.sessionId);await settled(service,workflow.id,first.runId!);await edit(service,workflow.id,current=>({...current,settings:{...current.settings!,subagents:'off'}}));const next=await service.run({workflowId:workflow.id,nodeId:'b',operationId:'normal-after-child'});const b=taskFor(native,'b')!;expect(b.kind).toBe('normal');expect(JSON.stringify(b.context)).toContain(a.messageId);await finish(service,native,b.sessionId);await settled(service,workflow.id,next.runId!);
  });
  it('uses graph-based auto only beside a busy independent clicked path and keeps a linear successor on the legacy route',async()=>{
    const first=await open(),workflow=await graph(first.service,'auto',['a','b'],[['a','b']]);const requested=await batch(first.service,workflow.id,['b','a'],'auto-linear');await vi.waitFor(()=>expect(taskFor(first.native,'a')).toBeDefined());expect(taskFor(first.native,'a')!.kind).toBe('normal');expect(children(first.native)).toHaveLength(0);expect(taskFor(first.native,'b')).toBeUndefined();await finish(first.service,first.native,taskFor(first.native,'a')!.sessionId);await vi.waitFor(()=>expect(taskFor(first.native,'b')).toBeDefined());expect(taskFor(first.native,'b')!.kind).toBe('normal');await finish(first.service,first.native,taskFor(first.native,'b')!.sessionId);for(const runId of requested.runIds)await settled(first.service,workflow.id,runId);
    const second=await open(),parallel=await graph(second.service,'auto',['x','y']);await batch(second.service,parallel.id,['x','y'],'auto-independent');await vi.waitFor(()=>expect(second.native.started).toHaveLength(2));expect(taskFor(second.native,'x')!.kind).toBe('normal');expect(taskFor(second.native,'y')!.kind).toBe('subagent');expect(second.native.active.size).toBe(2);
  });
  it('cancels the exact child without cancelling its coordinator or sibling',async()=>{
    const {service,native}=await open(),workflow=await graph(service,'on',['a','b']);const requested=await batch(service,workflow.id,['a','b'],'cancel-child-wave');await vi.waitFor(()=>expect(children(native)).toHaveLength(2));const current=(await service.get({id:workflow.id})).workflow!,a=current.executions!.find(run=>run.nodeId==='a')!,b=current.executions!.find(run=>run.nodeId==='b')!;await service.cancel({workflowId:workflow.id,runId:a.runId});expect(native.cancellations).toEqual([{kind:'subagent',sessionId:a.sessionId}]);expect(native.active.has(b.sessionId)).toBe(true);await settled(service,workflow.id,a.runId,'cancelled');await finish(service,native,b.sessionId);await settled(service,workflow.id,b.runId);expect(requested.runIds).toHaveLength(2);
  });
  it('does not leave a reserved but nonexistent child waiting forever after a preparation-stage crash',async()=>{
    const first=await open(),workflow=await graph(first.service,'on',['a']);
    const prepare=Reflect.get(first.service,'prepareSubagent') as (current:Workflow,run:NonNullable<Workflow['executions']>[number])=>Promise<NonNullable<Workflow['executions']>[number]>;
    Reflect.set(first.service,'prepareSubagent',async(current:Workflow,run:NonNullable<Workflow['executions']>[number])=>{await prepare.call(first.service,current,run);throw new Error('Simulated crash after durable virtual child preparation');});
    const request={workflowId:workflow.id,nodeId:'a',operationId:'prepared-child-crash'};await first.service.run(request).catch(()=>undefined);const prepared=(await first.service.get({id:workflow.id})).workflow!.executions![0]!;
    expect(prepared.subagent).toBeDefined();expect(children(first.native)).toHaveLength(0);expect(first.native.logs.has(prepared.sessionId)).toBe(false);await first.ctx.fiber.dispose();
    const second=await open(first.root,first.native);await recover(second.service);
    await vi.waitFor(async()=>expect((await second.service.get({id:workflow.id})).workflow!.executions![0]!.status).not.toBe('waiting'));
    expect(children(second.native).length).toBeLessThanOrEqual(1);
  });
  it('does not respawn a child after its receipt was returned but the metadata write failed',async()=>{
    const first=await open(),workflow=await graph(first.service,'on',['a']);const write=Reflect.get(first.service,'write') as (id:string,transform:(current:Workflow)=>Workflow)=>Promise<Workflow>;let failNext=false,failed=false;
    const start=first.native.startSubagent.bind(first.native);first.native.startSubagent=async request=>{const receipt=await start(request);failNext=true;return receipt;};
    Reflect.set(first.service,'write',async(id:string,transform:(current:Workflow)=>Workflow)=>{if(failNext&&!failed){failed=true;throw new Error('Receipt metadata commit failed after native admission');}return write.call(first.service,id,transform);});
    const request={workflowId:workflow.id,nodeId:'a',operationId:'lost-receipt-metadata'};await first.service.run(request).catch(()=>undefined);expect(failed).toBe(true);expect(children(first.native)).toHaveLength(1);
    const pending=(await first.service.get({id:workflow.id})).workflow!.executions![0]!;expect(pending.subagent?.messageId).toBeUndefined();expect(pending.durability).toBe('needs-reconcile');
    await first.ctx.fiber.dispose();const second=await open(first.root,first.native);await recover(second.service);await second.service.run(request);expect(children(second.native)).toHaveLength(1);expect((await second.service.get({id:workflow.id})).workflow!.executions![0]!.status).not.toBe('waiting');
  });
  it('restores active child identity without native respawn and keeps a lost response uncertain',async()=>{
    const first=await open(),workflow=await graph(first.service,'on',['a']);const request={workflowId:workflow.id,nodeId:'a',operationId:'restart-child'};const running=await first.service.run(request);await vi.waitFor(()=>expect(children(first.native)).toHaveLength(1));const task=children(first.native)[0]!,metadata=(await first.service.get({id:workflow.id})).workflow!.executions!.find(run=>run.runId===running.runId)!;await first.ctx.fiber.dispose();const second=await open(first.root,first.native);await recover(second.service);expect((await second.service.get({id:workflow.id})).workflow!.executions!.find(run=>run.runId===running.runId)).toMatchObject({sessionId:metadata.sessionId,subagent:metadata.subagent});await second.service.run(request);expect(children(second.native)).toHaveLength(1);await finish(second.service,second.native,task.sessionId);await settled(second.service,workflow.id,running.runId!);
    const third=await open(),uncertain=await graph(third.service,'on',['x']);third.native.loseSubagentResponseOnce=true;const lost={workflowId:uncertain.id,nodeId:'x',operationId:'lost-child-response'};await third.service.run(lost).catch(()=>undefined);await vi.waitFor(()=>expect(children(third.native)).toHaveLength(1));await third.ctx.fiber.dispose();const fourth=await open(third.root,third.native);await recover(fourth.service);await fourth.service.run(lost);expect(children(fourth.native)).toHaveLength(1);expect((await fourth.service.get({id:uncertain.id})).workflow!.executions![0]!.status).not.toBe('waiting');
  });
});
