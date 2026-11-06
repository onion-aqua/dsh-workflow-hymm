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

// This suite uses real plugin/storage coordination with a deterministic native
// boundary fixture. All records belong to an isolated temporary test directory.
class Native implements NativeRuntime {
  next=0;
  logs=new Map<string,NativeSessionLog>();
  prompts:Array<{sessionId:string;requestId:string;text:string}>=[];
  forks:Array<{sessionId:string;atSeq:number}>=[];
  defaultModel={provider:'test',model:'controlled'};
  async models(){return {models:[{...this.defaultModel,label:'Controlled'}],defaultModel:this.defaultModel};}
  async resolveModel(selection?:WorkflowModelIdentity){return selection??this.defaultModel;}
  protectPlanning(_sessionId:string){}
  async resolveUploadedFile(_sessionId:string,_receiptId:string):Promise<NativeFileReference>{throw new Error('Unused');}
  async catalog(){return [...this.logs.values()].map(log=>({sessionId:log.sessionId,title:log.sessionId,updatedAt:1,running:false,blank:!log.events.length,parentSessionId:log.header.parentSession}));}
  async read(id:string){const log=this.logs.get(id);if(!log)throw new Error('Missing test Session');return structuredClone(log);}
  async create(options:{sessionId?:string;cwd?:string;agentPreset?:string}={}){const sessionId=options.sessionId??`test-${++this.next}`;this.logs.set(sessionId,{sessionId,header:{id:sessionId,createdAt:1,isSeeded:false,cwd:options.cwd},inheritedEventCount:0,events:[]});return {sessionId};}
  async fork(request:{sessionId:string;atSeq:number}){this.forks.push(request);const source=await this.read(request.sessionId);const sessionId=`test-${++this.next}`;this.logs.set(sessionId,{...source,sessionId,header:{...source.header,id:sessionId,parentSession:source.sessionId,isSeeded:true},inheritedEventCount:request.atSeq+1,events:source.events.filter(e=>e.seq<=request.atSeq)});return {sessionId,inheritedEventCount:request.atSeq+1};}
  async submit(request:{sessionId:string;requestId:string;text:string}){this.prompts.push(request);const log=this.logs.get(request.sessionId)!;const turn=log.events.filter(e=>e.type==='turn/start').length+1;for(const [type,data] of [['turn/start',{turn}],['user/message',{id:request.requestId,source:{kind:'user',rpcId:request.requestId},content:[{type:'text',text:request.text}]}],['assistant/message',{turn,step:1,message:{content:[{type:'text',text:`Result ${request.text}`} ]}}],['turn/end',{turn,reason:{kind:'completed'}}]] as Array<[string,Record<string,unknown>]>)log.events.push({type,data,seq:log.events.length,time:log.events.length+1});}
  async cancel(){return 'none' as const;}
  async flush(_sessionId:string){}
  isRunning(_sessionId:string){return false;}
  async waitForIdle(_sessionId:string){}
  subscribe(_listener:(sessionId:string,event:NativeEvent)=>void){return ()=>{};}
}
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
async function open(){const root=await mkdtemp(join(tmpdir(),'branch-adversarial-')),ctx=new Context();cleanups.push(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root});await ctx.plugin(Domain,{backend:'json'});await ctx.plugin(Service);const service=ctx.visualWorkflow,native=new Native();Reflect.set(service,'native',native);return {service,native};}
const node=(id:string):WorkflowNode=>({id,title:id,instruction:`UNIQUE_${id}_V1`,source:'user',status:'draft',revision:1,position:{x:100,y:100}});
async function edit(service:Service,id:string,transform:(w:Workflow)=>Workflow){for(let i=0;i<4;i++){const current=(await service.get({id})).workflow!;const result=await service.save({workflow:transform(current),expectedRevision:current.revision});if(result.ok)return result.workflow;if(result.code!=='conflict')throw new Error(result.code);}throw new Error('Persistent metadata conflict');}
async function graph(service:Service,ids:string[],pairs:string[][]){const w=(await service.create({name:'Adversarial branches'})).workflow;return edit(service,w.id,current=>({...current,nodes:ids.map(node),edges:pairs.map(([source,target],i)=>({id:`edge-${i}`,source:source!,target:target!,type:'dependency'}))}));}
async function batch(service:Service,id:string,ids:string[],operationId:string){const current=(await service.get({id})).workflow!;const result=await service.batchRun({workflowId:id,nodeIds:ids,nodeRevisions:Object.fromEntries(ids.map(id=>[id,current.nodes.find(n=>n.id===id)!.revision])),operationId});await vi.waitFor(async()=>expect((await service.get({id})).workflow!.executions!.filter(e=>result.runIds.includes(e.runId)).every(e=>e.status==='completed')).toBe(true));return (await service.get({id})).workflow!;}
const text=(native:Native,id:string)=>JSON.stringify(native.logs.get(id)!.events);

describe('adversarial branch and context semantics',()=>{
  it('keeps disconnected roots and each linear continuation isolated within the same manual overview',async()=>{
    const {service,native}=await open(),w=await graph(service,['a','b','x','y'],[['a','b'],['x','y']]);const done=await batch(service,w.id,['y','b','x','a'],'disconnected-batch');const runs=Object.fromEntries(done.executions!.map(r=>[r.nodeId,r]));expect(runs.a!.sessionId).toBe(runs.b!.sessionId);expect(runs.x!.sessionId).toBe(runs.y!.sessionId);expect(runs.a!.sessionId).not.toBe(runs.x!.sessionId);expect(text(native,runs.b!.sessionId)).not.toContain('UNIQUE_x_V1');expect(text(native,runs.y!.sessionId)).not.toContain('UNIQUE_a_V1');
  });
  it('keeps all nested fan-out paths independent while reusing linear tails',async()=>{
    const {service,native}=await open(),w=await graph(service,['a','b','c','d','e','f'],[['a','b'],['a','c'],['b','d'],['b','e'],['d','f']]);const done=await batch(service,w.id,['f','e','d','c','b','a'],'nested-batch');const runs=Object.fromEntries(done.executions!.map(r=>[r.nodeId,r]));expect(runs.d!.sessionId).toBe(runs.f!.sessionId);expect(new Set(['a','b','c','d','e'].map(id=>runs[id]!.sessionId)).size).toBe(5);for(const [id,excluded] of [['c',['b','d','e','f']],['e',['c','d','f']],['f',['c','e']]] as const)for(const other of excluded)expect(text(native,runs[id]!.sessionId)).not.toContain(`UNIQUE_${other}_V1`);
  });
  it('does not retarget a waiting execution when the user selects another manual branch',async()=>{
    const {service,native}=await open(),w=await graph(service,['seed','a','b'],[['a','b']]);
    await batch(service,w.id,['seed'],'make-completed-source');
    const waiting=await service.run({workflowId:w.id,nodeId:'b',operationId:'queue-original-b'}),main=waiting.workflow.activeBranchId!;
    const seedRun=waiting.workflow.executions!.find(r=>r.nodeId==='seed')!;
    const other=await service.fork({workflowId:w.id,runId:seedRun.runId,label:'Other manual',operationId:'other-manual'});
    const elsewhere=await batch(service,w.id,['a'],'run-a-in-other');
    const otherA=elsewhere.executions!.findLast(r=>r.nodeId==='a')!;
    expect(otherA.branchId).toBe(other.branchId);
    const pending=(await service.get({id:w.id})).workflow!.executions!.find(r=>r.runId===waiting.runId)!;
    expect(pending).toMatchObject({status:'waiting',branchId:main});
    const originalA=await service.run({workflowId:w.id,nodeId:'a',branchId:main,operationId:'run-a-in-original'});
    await vi.waitFor(async()=>expect((await service.get({id:w.id})).workflow!.executions!.find(r=>r.runId===waiting.runId)!.status).toBe('completed'));
    const completed=(await service.get({id:w.id})).workflow!,b=completed.executions!.find(r=>r.runId===waiting.runId)!;
    expect(text(native,b.sessionId)).not.toContain(otherA.requestId);
    expect(text(native,b.sessionId)).toContain(completed.executions!.find(r=>r.runId===originalA.runId)!.requestId);
  });
  it('refreshes every selected stage during a reverse-ordered batch rerun without inheriting previous outputs',async()=>{
    const {service,native}=await open(),w=await graph(service,['a','b','c'],[['a','b'],['b','c']]);
    const first=await batch(service,w.id,['c','b','a'],'first-line');const old=first.executions!;
    const second=await batch(service,w.id,['c','b','a'],'rerun-line');const fresh=second.executions!.filter(r=>!old.some(e=>e.runId===r.runId));
    expect(fresh).toHaveLength(3);const c=fresh.find(r=>r.nodeId==='c')!;
    for(const run of fresh)expect(text(native,c.sessionId)).toContain(run.requestId);
    for(const run of old)expect(text(native,c.sessionId)).not.toContain(run.requestId);
  });
  it('allows a new downstream model without invalidating completed upstream task results',async()=>{
    const {service,native}=await open(),w=await graph(service,['a','b','c'],[['a','b'],['b','c']]);
    const prefix=await batch(service,w.id,['a','b'],'completed-before-model-change'),b=prefix.executions!.find(r=>r.nodeId==='b')!;
    await edit(service,w.id,current=>({...current,settings:{...current.settings!,model:{provider:'test',model:'second-controlled'}}}));
    const done=await batch(service,w.id,['c'],'new-model-c'),c=done.executions!.findLast(r=>r.nodeId==='c')!;
    expect(c.sessionId).toBe(b.sessionId);expect(c.resolvedModel).toEqual({provider:'test',model:'second-controlled'});expect(text(native,c.sessionId)).toContain(b.requestId);
  });
  it('waits for a fresh intermediate result after an ancestor is rerun at the same task revision',async()=>{
    const {service,native}=await open(),w=await graph(service,['a','b','c'],[['a','b'],['b','c']]);
    await batch(service,w.id,['a','b'],'old-linear-prefix');const freshA=await batch(service,w.id,['a'],'rerun-ancestor');
    const a=freshA.executions!.findLast(r=>r.nodeId==='a')!,before=native.prompts.length;
    const requested=await service.run({workflowId:w.id,nodeId:'c',operationId:'requires-refreshed-b'});
    expect(native.prompts).toHaveLength(before);
    expect(requested.workflow.executions!.find(r=>r.runId===requested.runId)).toMatchObject({status:'waiting',waitingReason:'stale_prerequisites'});
    await batch(service,w.id,['b'],'refresh-intermediate');
    await vi.waitFor(async()=>expect((await service.get({id:w.id})).workflow!.executions!.find(r=>r.runId===requested.runId)!.status).toBe('completed'));
    const done=(await service.get({id:w.id})).workflow!,c=done.executions!.find(r=>r.runId===requested.runId)!;
    expect(text(native,c.sessionId)).toContain(a.requestId);
    expect(text(native,c.sessionId)).toContain(done.executions!.findLast(r=>r.nodeId==='b')!.requestId);
  });
  it('preserves an explicitly selected historical prefix even after an ancestor reruns in the manual overview',async()=>{
    const {service,native}=await open(),w=await graph(service,['a','b','c'],[['a','b'],['b','c']]);
    const prefix=await batch(service,w.id,['a','b'],'old-prefix');const oldA=prefix.executions!.find(r=>r.nodeId==='a')!,oldB=prefix.executions!.find(r=>r.nodeId==='b')!;
    const fresh=await batch(service,w.id,['a'],'new-a-in-overview'),newA=fresh.executions!.findLast(r=>r.nodeId==='a')!;
    const historical=await service.fork({workflowId:w.id,runId:oldB.runId,label:'Chosen old prefix',operationId:'select-historical-b'});
    const done=await batch(service,w.id,['c'],'continue-historical-prefix'),c=done.executions!.findLast(r=>r.nodeId==='c')!;
    expect(c.branchId).toBe(historical.branchId);
    expect(text(native,c.sessionId)).toContain(oldA.requestId);expect(text(native,c.sessionId)).toContain(oldB.requestId);expect(text(native,c.sessionId)).not.toContain(newA.requestId);
  });
  it('invalidates an already queued authorization when a transitive prerequisite changes revision',async()=>{
    const {service,native}=await open(),w=await graph(service,['a','b','c'],[['a','b'],['b','c']]);
    const prefix=await batch(service,w.id,['a','b'],'queue-before-upstream-edit');
    const running=new Set([prefix.executions!.find(r=>r.nodeId==='b')!.sessionId]);
    native.isRunning=sessionId=>running.has(sessionId);
    const requested=await service.run({workflowId:w.id,nodeId:'c',operationId:'authorize-c-before-a-edit'});
    expect(requested.workflow.executions!.find(r=>r.runId===requested.runId)!.status).toBe('waiting');
    const edited=await edit(service,w.id,current=>({...current,nodes:current.nodes.map(n=>n.id==='a'?{...n,instruction:'UNIQUE_a_V2'}:n)}));
    expect(edited.executions!.find(r=>r.runId===requested.runId)).toMatchObject({status:'cancelled',terminalReason:'authorization-invalidated'});
    expect(native.prompts).toHaveLength(2);
  });
  it('does not execute a descendant with an obsolete transitive prerequisite revision',async()=>{
    const {service,native}=await open(),w=await graph(service,['a','b','c'],[['a','b'],['b','c']]);await batch(service,w.id,['a','b'],'complete-old-prefix');await edit(service,w.id,current=>({...current,nodes:current.nodes.map(n=>n.id==='a'?{...n,instruction:'UNIQUE_a_V2'}:n)}));const before=native.prompts.length;const result=await service.run({workflowId:w.id,nodeId:'c',operationId:'must-not-use-obsolete-prefix'});const run=result.workflow.executions!.find(r=>r.runId===result.runId)!;expect(native.prompts).toHaveLength(before);expect(run).toMatchObject({status:'waiting',waitingReason:'stale_prerequisites'});
    await batch(service,w.id,['b','a'],'refresh-revised-chain');
    await vi.waitFor(async()=>expect((await service.get({id:w.id})).workflow!.executions!.find(r=>r.runId===result.runId)!.status).toBe('completed'));const latest=(await service.get({id:w.id})).workflow!.executions!.find(r=>r.runId===result.runId)!;expect(text(native,latest.sessionId)).toContain('UNIQUE_a_V2');expect(text(native,latest.sessionId)).not.toContain('UNIQUE_a_V1');
  });
});
