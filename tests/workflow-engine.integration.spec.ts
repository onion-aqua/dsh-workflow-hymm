import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as Domain from '@deepseek-ai/dsh-storage-domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Service from '../src/host/service.ts';
import { workflowSchema } from '../src/host/validation.ts';
import type { NativeEvent, NativeRuntime, NativeSessionLog, NativeFileReference } from '../src/host/native-runtime.ts';
import { WORKFLOW_API_VERSION, WORKFLOW_PLUGIN_VERSION, type Workflow, type WorkflowModelIdentity } from '../src/shared/model.ts';

const contexts:Context[]=[]; const roots:string[]=[];
class NativeFixture implements NativeRuntime {
  readonly logs=new Map<string,NativeSessionLog>(); readonly prompts:Array<{sessionId:string;requestId:string;text:string;files?:readonly NativeFileReference[];model?:WorkflowModelIdentity}>=[];
  readonly uploadedFiles=new Map<string,NativeFileReference>();
  readonly forks:Array<{sessionId:string;atSeq:number}>=[]; listeners=new Set<(sessionId:string,event:NativeEvent)=>void>();
  readonly protectedPlanning=new Set<string>();
  failAfterAdmission=false; next=0; planTerminalReason='completed'; taskTerminalReason='completed';
  planResponse:unknown=undefined;
  defaultModel:WorkflowModelIdentity={provider:'fixture-provider',model:'fixture-default'};
  readonly availableModels:WorkflowModelIdentity[]=[this.defaultModel,{provider:'fixture-provider',model:'global-model'},{provider:'fixture-provider',model:'node-model'},{provider:'other-provider',model:'node-model'}];
  async models(){return {models:this.availableModels.map(item=>({...item,label:`${item.provider}/${item.model}`})),defaultModel:structuredClone(this.defaultModel)};}
  async resolveModel(selection?:WorkflowModelIdentity){const model=selection??this.defaultModel;if(!this.availableModels.some(item=>item.provider===model.provider&&item.model===model.model))throw new Error('Selected native model is unavailable');return structuredClone(model);}
  protectPlanning(sessionId:string){this.protectedPlanning.add(sessionId);}
  async resolveUploadedFile(sessionId:string,receiptId:string){const file=this.uploadedFiles.get(`${sessionId}:${receiptId}`);if(!file)throw new Error('Receipt does not belong to this Session or has expired');return structuredClone(file);}
  constructor(){this.logs.set('source',{sessionId:'source',header:{id:'source',createdAt:1,isSeeded:false,cwd:'C:/fixture'},inheritedEventCount:0,events:[
    {type:'turn/start',seq:0,time:1,data:{turn:1}}, {type:'user/message',seq:1,time:2,data:{id:'original',source:{kind:'user',rpcId:'original'},content:[{type:'text',text:'Source user'}]}},
    {type:'assistant/message',seq:2,time:3,data:{turn:1,step:1,message:{content:[{type:'text',text:'Source answer'}]}}}, {type:'turn/end',seq:3,time:4,data:{turn:1,reason:{kind:'completed'}}},
  ]});}
  async catalog(){return [...this.logs].map(([sessionId,log])=>({sessionId,title:sessionId,updatedAt:1,running:false,blank:!log.events.length,parentSessionId:log.header.parentSession,cwd:log.header.cwd}));}
  async read(id:string){const log=this.logs.get(id);if(!log)throw new Error('missing session');return structuredClone(log);}
  async create(options:{sessionId?:string;cwd?:string;agentPreset?:string}={}){const sessionId=options.sessionId??`child-${++this.next}`;if(this.logs.has(sessionId))throw new Error('duplicate');this.logs.set(sessionId,{sessionId,header:{id:sessionId,createdAt:1,isSeeded:false,cwd:options.cwd,agentPreset:options.agentPreset},inheritedEventCount:0,events:[]});return {sessionId};}
  async fork(request:{sessionId:string;atSeq:number}){this.forks.push(request);const source=await this.read(request.sessionId);const sessionId=`child-${++this.next}`;this.logs.set(sessionId,{...source,sessionId,header:{...source.header,id:sessionId,parentSession:source.sessionId,isSeeded:true},inheritedEventCount:request.atSeq+1,events:source.events.filter(event=>event.seq<=request.atSeq)});return {sessionId,inheritedEventCount:request.atSeq+1};}
  async submit(request:{sessionId:string;requestId:string;text:string;files?:readonly NativeFileReference[];model?:WorkflowModelIdentity}){
    this.prompts.push(request);const log=this.logs.get(request.sessionId)!;const turn=log.events.filter(event=>event.type==='turn/start').length+1;
    const isPlan=request.text.startsWith('You are drafting');
    const text=isPlan?JSON.stringify(this.planResponse??{tasks:[{id:'a',title:'Inspect',instruction:'Inspect without writes',dependsOn:[]},{id:'b',title:'Report',instruction:'Report evidence',dependsOn:['a']}]}):'Observable completion';
    for(const [type,data] of [
      ['turn/start',{turn}], ['user/message',{id:request.requestId,source:{kind:'user',rpcId:request.requestId},content:[{type:'text',text:request.text}]}],
      ['step/start',{turn,step:1}], ['tool/call',{turn,step:1,callId:`call-${turn}`,name:'pwsh',arguments:'{"command":"Get-Location"}'}],
      ['tool/result',{turn,step:1,message:{toolCallId:`call-${turn}`,content:[{type:'text',text:'Recorded command output'}]}}],
      ['assistant/message',{turn,step:1,message:{content:[{type:'reasoning',text:'DO_NOT_PERSIST_REASONING'},{type:'text',text}]}}],
      ['step/end',{turn,step:1}], ['turn/end',{turn,reason:{kind:isPlan?this.planTerminalReason:this.taskTerminalReason}}],
    ] as Array<[string,Record<string,unknown>]>){const event={type,data,seq:log.events.length,time:log.events.length+10};log.events.push(event);for(const listener of this.listeners)listener(log.sessionId,event);}
    if(this.failAfterAdmission)throw new Error('Response lost after native admission');
  }
  async cancel(){return 'none' as const;} async flush(){} isRunning(_sessionId:string){return false;} async waitForIdle(){}
  subscribe(listener:(sessionId:string,event:NativeEvent)=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
}
async function open(root?:string,native=new NativeFixture()){
  root??=await mkdtemp(join(tmpdir(),'workflow-engine-')); if(!roots.includes(root))roots.push(root);
  const ctx=new Context();contexts.push(ctx);await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root});await ctx.plugin(Domain,{backend:'json'});await ctx.plugin(Service);
  const service=ctx.visualWorkflow;Reflect.set(service,'native',native);return {ctx,service,native,root};
}
async function oneTask(service:Service,source=false){
  let workflow=source?(await service.importSession({sessionId:'source'})).workflow:(await service.create({name:'Tasks'})).workflow;
  const result=await service.save({workflow:{...workflow,nodes:[...workflow.nodes,{id:'task',title:'Task',instruction:'Read and report',source:'user',status:'draft',revision:1,position:{x:200,y:100}}]},expectedRevision:workflow.revision});
  if(!result.ok)throw new Error('save conflict');return result.workflow;
}
async function twoTasks(service:Service){
  const workflow=await oneTask(service,true);
  const result=await service.save({workflow:{...workflow,nodes:[...workflow.nodes,{id:'downstream',title:'Downstream',instruction:'Use the latest completed task',source:'user',status:'draft',revision:1,position:{x:600,y:100}},{id:'unselected',title:'Unselected',instruction:'Do not run automatically',source:'user',status:'draft',revision:1,position:{x:1000,y:100}}],edges:[{id:'requires',source:'task',target:'downstream',type:'dependency'}]},expectedRevision:workflow.revision});
  if(!result.ok)throw new Error('save conflict');return result.workflow;
}
/** The screenshot's diamond: two isolated sibling paths feed one real join. */
async function diamondTasks(service:Service,source=true){
  const workflow=await oneTask(service,source);
  const nodes=['left','right','joined','after'].map((id,index)=>({id,title:id,instruction:`Execute ${id} using its prerequisite results`,source:'user' as const,status:'draft' as const,revision:1,position:{x:600+index*300,y:index%2*250}}));
  const pairs=[['task','left'],['task','right'],['left','joined'],['right','joined'],['joined','after']];
  const saved=await service.save({workflow:{...workflow,nodes:[...workflow.nodes,...nodes],edges:pairs.map(([source,target],index)=>({id:`diamond-${index}`,source:source!,target:target!,type:'dependency' as const}))},expectedRevision:workflow.revision});
  if(!saved.ok)throw new Error('save conflict');return saved.workflow;
}
function installDiamondResults(native:NativeFixture){
  const output:Record<string,string>={Task:'SHARED_ANCESTOR_RESULT',left:`LEFT_RESULT_BEGIN ${'L'.repeat(8000)} FULL_LEFT_RESULT_TAIL`,right:'RIGHT_PUBLIC_RESULT',joined:'JOIN_PUBLIC_RESULT',after:'AFTER_PUBLIC_RESULT',nested:'NESTED_PUBLIC_RESULT'};
  const submit=native.submit.bind(native);
  native.submit=async request=>{
    await submit(request);
    const title=/^Task: ([^\n]+)/.exec(request.text)?.[1],text=title?output[title]:undefined;
    if(text===undefined)return;
    const event=native.logs.get(request.sessionId)!.events.findLast(event=>event.type==='assistant/message')!;
    event.data.message={content:[{type:'reasoning',text:'PRIVATE_REASONING_MUST_NOT_ENTER_JOIN'},{type:'text',text}]};
  };
  return output;
}
function resultRecords(text:string):Array<{source:{runId:string;nodeId:string};result:string}>{
  const start=text.lastIndexOf('\n[');expect(start).toBeGreaterThan(0);return JSON.parse(text.slice(start+1));
}
async function runDiamondPrerequisites(service:Service,workflowId:string){
  for(const nodeId of ['task','left','right'])await service.run({workflowId,nodeId,operationId:`diamond-prerequisite-${nodeId}`});
  return (await service.get({id:workflowId})).workflow!;
}
const legacyOmittedDependencyError='Invalid workflow data: tasks.0.dependsOn: Invalid input: expected array, received undefined';
/** Seed historical parser metadata only, in this test's private storage folder. */
async function seedLegacyPlanFailure(root:string,workflowId:string,planId:string,options:{preserveDecision?:boolean;unconfirmed?:boolean}={}){
  const path=join(root,'visual_workflow.json'),document=JSON.parse(await readFile(path,'utf8')),workflow=document.tables.workflows[workflowId] as Workflow,plan=workflow.plans!.find(item=>item.id===planId)!;
  if(!options.preserveDecision){plan.status='failed';plan.tasks=[];}plan.error=legacyOmittedDependencyError;
  if(options.unconfirmed)for(const operation of workflow.operations!)if(operation.kind==='plan'&&operation.runId===plan.requestId)operation.status='needs-reconcile';
  await writeFile(path,JSON.stringify(document));return structuredClone(workflow);
}
afterEach(async()=>{for(const ctx of contexts.splice(0).reverse())await ctx.fiber.dispose();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});

describe('native-backed workflow aggregate coordination',()=>{
  it('normalizes omitted planning dependencies to independent tasks without guessing order and persists the normalized plan',async()=>{
    const first=await open(),workflow=await oneTask(first.service,true),source=JSON.stringify(await first.native.read('source'));
    first.native.planResponse={tasks:[
      {id:'later-listed',title:'Independent first',instruction:'An independently runnable first task'},
      {id:'earlier-listed',title:'Independent second',instruction:'An independently runnable second task'},
      {id:'explicit-empty',title:'Independent third',instruction:'An explicit independent task',dependsOn:[]},
    ]};
    const requested=await first.service.generatePlan({workflowId:workflow.id,goal:'Produce three independent draft tasks without executing them',operationId:'plan-omitted-dependencies'});
    await vi.waitFor(async()=>expect((await first.service.get({id:workflow.id})).workflow!.plans!.find(plan=>plan.id===requested.planId)?.status).toBe('proposed'));
    const proposed=(await first.service.get({id:workflow.id})).workflow!,plan=proposed.plans!.find(plan=>plan.id===requested.planId)!;
    expect(plan.tasks.map(task=>({id:task.id,dependsOn:task.dependsOn}))).toEqual([{id:'later-listed',dependsOn:[]},{id:'earlier-listed',dependsOn:[]},{id:'explicit-empty',dependsOn:[]}]);expect(proposed.nodes).toEqual(workflow.nodes);expect(proposed.edges).toEqual(workflow.edges);expect(proposed.executions).toEqual([]);
    expect(plan.tasks.map(task=>task.dependencyUnspecified)).toEqual([true,true,undefined]);
    await first.ctx.fiber.dispose();const second=await open(first.root,first.native);
    const reloaded=(await second.service.get({id:workflow.id})).workflow!;expect(reloaded.plans!.find(item=>item.id===plan.id)).toEqual(plan);
    const accepted=await second.service.applyPlan({workflowId:workflow.id,planId:plan.id,accept:true});
    expect(accepted.workflow.nodes.filter(node=>node.originPlanId===plan.id)).toHaveLength(3);expect(accepted.workflow.edges).toEqual(workflow.edges);expect(accepted.workflow.executions).toEqual([]);expect(first.native.prompts).toHaveLength(1);expect(JSON.stringify(await first.native.read('source'))).toBe(source);
  });
  it('preserves explicit planning dependencies alongside omitted roots even when tasks are listed out of dependency order',async()=>{
    const {service,native}=await open(),workflow=await oneTask(service,true),source=JSON.stringify(await native.read('source'));
    native.planResponse={tasks:[
      {id:'report',title:'Report',instruction:'Report the observed result',dependsOn:['inspect']},
      {id:'inspect',title:'Inspect',instruction:'Inspect without writes'},
      {id:'independent',title:'Independent',instruction:'Separate independent task'},
      {id:'join',title:'Join',instruction:'Summarize both prerequisites',dependsOn:['report','independent']},
    ]};
    const requested=await service.generatePlan({workflowId:workflow.id,goal:'Preserve only the explicit dependency graph',operationId:'plan-mixed-dependencies'});
    await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.plans!.find(plan=>plan.id===requested.planId)?.status).toBe('proposed'));
    const proposed=(await service.get({id:workflow.id})).workflow!,plan=proposed.plans!.find(plan=>plan.id===requested.planId)!;
    expect(plan.tasks.map(task=>({id:task.id,dependsOn:task.dependsOn}))).toEqual([{id:'report',dependsOn:['inspect']},{id:'inspect',dependsOn:[]},{id:'independent',dependsOn:[]},{id:'join',dependsOn:['report','independent']}]);
    expect(plan.tasks.filter(task=>task.dependencyUnspecified).map(task=>task.id)).toEqual(['inspect','independent']);
    await expect(service.applyPlan({workflowId:workflow.id,planId:plan.id,accept:true,taskIds:['report']})).rejects.toThrow(/prerequisite/);expect((await service.get({id:workflow.id})).workflow).toEqual(proposed);
    const accepted=await service.applyPlan({workflowId:workflow.id,planId:plan.id,accept:true}),nodes=accepted.workflow.nodes.filter(node=>node.originPlanId===plan.id),titles=new Map(nodes.map(node=>[node.id,node.title]));
    expect(accepted.workflow.edges.filter(edge=>titles.has(edge.source)&&titles.has(edge.target)).map(edge=>`${titles.get(edge.source)} -> ${titles.get(edge.target)}`).sort()).toEqual(['Independent -> Join','Inspect -> Report','Report -> Join']);expect(accepted.workflow.executions).toEqual([]);expect(native.prompts).toHaveLength(1);expect(JSON.stringify(await native.read('source'))).toBe(source);
  });
  it.each([
    {name:'unknown reference',tasks:[{id:'a',title:'A',instruction:'A',dependsOn:['missing']},{id:'b',title:'B',instruction:'B'}],message:'missing-endpoint'},
    {name:'dependency cycle',tasks:[{id:'a',title:'A',instruction:'A',dependsOn:['b']},{id:'b',title:'B',instruction:'B',dependsOn:['a']},{id:'c',title:'C',instruction:'C'}],message:'dependency-cycle'},
    {name:'null dependencies',tasks:[{id:'a',title:'A',instruction:'A',dependsOn:null}],message:'dependsOn'},
    {name:'string dependencies',tasks:[{id:'a',title:'A',instruction:'A',dependsOn:'other'}],message:'dependsOn'},
  ])('rejects planning $name instead of inventing or deleting dependencies',async({tasks,message})=>{
    const {service,native}=await open(),workflow=await oneTask(service,true),source=JSON.stringify(await native.read('source'));native.planResponse={tasks};
    const requested=await service.generatePlan({workflowId:workflow.id,goal:'Validate the proposed dependency graph',operationId:'plan-invalid-dependency-output'});
    await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.plans!.find(plan=>plan.id===requested.planId)?.status).toBe('failed'));
    const rejected=(await service.get({id:workflow.id})).workflow!,plan=rejected.plans!.find(plan=>plan.id===requested.planId)!;
    expect(plan.error).toContain(message);expect(plan.tasks).toEqual([]);expect(rejected.nodes).toEqual(workflow.nodes);expect(rejected.edges).toEqual(workflow.edges);expect(rejected.executions).toEqual([]);await expect(service.applyPlan({workflowId:workflow.id,planId:plan.id,accept:true})).rejects.toThrow(/No proposed plan/);expect(native.prompts).toHaveLength(1);expect(JSON.stringify(await native.read('source'))).toBe(source);
  });
  it('recovers only the old omitted-dependency parser failure from completed native output after restart without resubmitting',async()=>{
    const first=await open(),workflow=await oneTask(first.service,true),source=JSON.stringify(await first.native.read('source'));first.native.planResponse={tasks:[{id:'root',title:'Independent root',instruction:'Review this independent task'},{id:'next',title:'Explicit child',instruction:'Review the dependent task',dependsOn:['root']},{id:'empty',title:'Explicit independent root',instruction:'Review the explicit root',dependsOn:[]}]};
    const requested=await first.service.generatePlan({workflowId:workflow.id,goal:'Recover an existing native planning result',operationId:'legacy-recover-plan'});
    await vi.waitFor(async()=>expect((await first.service.get({id:workflow.id})).workflow!.plans!.find(plan=>plan.id===requested.planId)?.status).toBe('proposed'));
    const before=(await first.service.get({id:workflow.id})).workflow!,originalPlan=before.plans!.find(plan=>plan.id===requested.planId)!,nativeLog=JSON.stringify(await first.native.read(originalPlan.sessionId)),forks=first.native.forks.length;
    await first.ctx.fiber.dispose();await seedLegacyPlanFailure(first.root,workflow.id,originalPlan.id);const second=await open(first.root,first.native);
    const recover=Reflect.get(second.service,'recover') as ()=>Promise<void>;await recover.call(second.service);
    await vi.waitFor(async()=>expect((await second.service.get({id:workflow.id})).workflow!.plans!.find(plan=>plan.id===originalPlan.id)?.status).toBe('proposed'));
    const recovered=(await second.service.get({id:workflow.id})).workflow!,plan=recovered.plans!.find(plan=>plan.id===originalPlan.id)!;
    expect(plan).toEqual(originalPlan);expect(plan.error).toBeUndefined();expect(plan.tasks[0]).toMatchObject({dependsOn:[],dependencyUnspecified:true});expect(plan.tasks[1]).toMatchObject({dependsOn:['root']});expect(plan.tasks[1]!.dependencyUnspecified).toBeUndefined();expect(recovered.nodes).toEqual(before.nodes);expect(recovered.edges).toEqual(before.edges);expect(recovered.executions).toEqual([]);expect(first.native.prompts).toHaveLength(1);expect(first.native.forks).toHaveLength(forks);expect(JSON.stringify(await first.native.read(originalPlan.sessionId))).toBe(nativeLog);expect(JSON.stringify(await first.native.read('source'))).toBe(source);
    expect(plan.tasks[2]).toMatchObject({dependsOn:[]});expect(plan.tasks[2]!.dependencyUnspecified).toBeUndefined();
    const invalidDurable=structuredClone(recovered);Reflect.deleteProperty(invalidDurable.plans!.find(item=>item.id===plan.id)!.tasks[0]!,'dependsOn');const validation=workflowSchema.safeParse(invalidDurable);expect(validation.success).toBe(false);if(!validation.success)expect(validation.error.issues.some(issue=>issue.path.at(-1)==='dependsOn')).toBe(true);
  });
  it('does not revive a cancelled, invalid, or unconfirmed native plan while recovering an old dependency parser failure',async()=>{
    for(const scenario of ['cancelled','invalid-graph','unconfirmed'] as const){
      const first=await open(),workflow=await oneTask(first.service,true);first.native.planResponse={tasks:[{id:'root',title:'Root',instruction:'Review only',...(scenario==='invalid-graph'?{dependsOn:['missing']}:{})}]};if(scenario==='cancelled')first.native.planTerminalReason='aborted';
      const requested=await first.service.generatePlan({workflowId:workflow.id,goal:'An existing result must satisfy recovery safeguards',operationId:`legacy-guard-${scenario}`});
      await vi.waitFor(async()=>expect((await first.service.get({id:workflow.id})).workflow!.plans!.find(plan=>plan.id===requested.planId)?.status).toBe(scenario==='unconfirmed'?'proposed':'failed'));
      const before=(await first.service.get({id:workflow.id})).workflow!,plan=before.plans!.find(plan=>plan.id===requested.planId)!,nativeLog=JSON.stringify(await first.native.read(plan.sessionId)),source=JSON.stringify(await first.native.read('source')),forks=first.native.forks.length;
      await first.ctx.fiber.dispose();const seeded=await seedLegacyPlanFailure(first.root,workflow.id,plan.id,{unconfirmed:scenario==='unconfirmed'});const second=await open(first.root,first.native);
      const recover=Reflect.get(second.service,'recover') as ()=>Promise<void>;await recover.call(second.service);
      if(scenario!=='unconfirmed')await vi.waitFor(async()=>expect((await second.service.get({id:workflow.id})).workflow!.plans!.find(item=>item.id===plan.id)?.error).toContain(scenario==='cancelled'?'did not complete successfully (cancelled)':'missing-endpoint'));
      const recovered=(await second.service.get({id:workflow.id})).workflow!,recoveredPlan=recovered.plans!.find(item=>item.id===plan.id)!;
      expect(recoveredPlan.status).toBe('failed');expect(recoveredPlan.tasks).toEqual([]);if(scenario==='unconfirmed')expect(recovered).toEqual(seeded);expect(recovered.nodes).toEqual(before.nodes);expect(recovered.edges).toEqual(before.edges);expect(recovered.executions).toEqual([]);await expect(second.service.applyPlan({workflowId:workflow.id,planId:plan.id,accept:true})).rejects.toThrow(/No proposed plan/);expect(first.native.prompts).toHaveLength(1);expect(first.native.forks).toHaveLength(forks);expect(JSON.stringify(await first.native.read(plan.sessionId))).toBe(nativeLog);expect(JSON.stringify(await first.native.read('source'))).toBe(source);
    }
  });
  it('preserves accepted and rejected plan decisions with stale dependency errors across recovery',async()=>{
    for(const accept of [true,false]){
      const first=await open(),workflow=await oneTask(first.service,true);first.native.planResponse={tasks:[{id:'root',title:'Preserved decision',instruction:'Review without executing'}]};
      const requested=await first.service.generatePlan({workflowId:workflow.id,goal:'Keep the user decision during recovery',operationId:`legacy-decided-${accept}`});await vi.waitFor(async()=>expect((await first.service.get({id:workflow.id})).workflow!.plans!.find(plan=>plan.id===requested.planId)?.status).toBe('proposed'));
      await first.service.applyPlan({workflowId:workflow.id,planId:requested.planId!,accept});await first.ctx.fiber.dispose();const seeded=await seedLegacyPlanFailure(first.root,workflow.id,requested.planId!,{preserveDecision:true}),second=await open(first.root,first.native);
      const read=vi.spyOn(first.native,'read'),recover=Reflect.get(second.service,'recover') as ()=>Promise<void>;await recover.call(second.service);
      expect((await second.service.get({id:workflow.id})).workflow).toEqual(seeded);expect(seeded.plans!.find(plan=>plan.id===requested.planId)?.status).toBe(accept?'accepted':'rejected');expect(read).not.toHaveBeenCalled();expect(first.native.prompts).toHaveLength(1);expect(seeded.executions).toEqual([]);read.mockRestore();
    }
  });
  it('verifies an atomic planning file batch, reuses private upload staging and restores the draft after restart',async()=>{
    const first=await open(),workflow=await oneTask(first.service,true),source=JSON.stringify(await first.native.read('source'));
    const prepared=await first.service.preparePlanAttachments({workflowId:workflow.id,operationId:'prepare-plan-file-batch'});expect(prepared.sessionId).not.toBe('source');
    expect((await first.service.prepareAttachment({workflowId:workflow.id,nodeId:'task',nodeRevision:1,operationId:'task-reuse-planning-stage'})).sessionId).toBe(prepared.sessionId);
    first.native.uploadedFiles.set(`${prepared.sessionId}:plan-receipt-a`,{attachmentId:'native-plan-a',name:'requirements.txt',bytes:31});first.native.uploadedFiles.set(`${prepared.sessionId}:plan-receipt-b`,{attachmentId:'native-plan-b',name:'evidence.md',bytes:12});
    const before=(await first.service.get({id:workflow.id})).workflow!;
    await expect(first.service.attachPlanFiles({workflowId:workflow.id,sessionId:'source',receiptIds:['plan-receipt-a'],operationId:'foreign-plan-stage'})).rejects.toThrow(/private attachment Session/);
    await expect(first.service.attachPlanFiles({workflowId:workflow.id,sessionId:prepared.sessionId,receiptIds:['plan-receipt-a','expired'],operationId:'atomic-invalid-plan-file'})).rejects.toThrow(/expired/);expect((await first.service.get({id:workflow.id})).workflow).toEqual(before);
    const args={workflowId:workflow.id,sessionId:prepared.sessionId,receiptIds:['plan-receipt-a','plan-receipt-b'],operationId:'register-planning-file-batch'},attached=(await first.service.attachPlanFiles(args)).workflow;
    expect(attached.planningAttachments).toHaveLength(2);expect(attached.attachmentReferences).toEqual(attached.planningAttachments);expect(attached.nodes).toEqual(before.nodes);expect((await first.service.attachPlanFiles(args)).workflow).toEqual(attached);
    await first.ctx.fiber.dispose();const second=await open(first.root,first.native);expect((await second.service.get({id:workflow.id})).workflow!.planningAttachments).toEqual(attached.planningAttachments);expect((await second.service.catalog()).sessions.map(session=>session.sessionId)).toEqual(['source']);expect(JSON.stringify(await first.native.read('source'))).toBe(source);expect(first.native.prompts).toHaveLength(0);
  });
  it('allows only Host-verified planning draft references and retains their registry when removed or consumed',async()=>{
    const {service,native}=await open(),workflow=await oneTask(service),prepared=await service.preparePlanAttachments({workflowId:workflow.id,operationId:'prepare-planning-reference'});
    native.uploadedFiles.set(`${prepared.sessionId}:verified-plan-file`,{attachmentId:'native-verified-plan',name:'verified.txt',bytes:14});const attached=(await service.attachPlanFiles({workflowId:workflow.id,sessionId:prepared.sessionId,receiptIds:['verified-plan-file'],operationId:'attach-planning-reference'})).workflow,reference=attached.planningAttachments![0]!;
    await expect(service.save({workflow:{...attached,planningAttachments:[{...reference,file:{...reference.file,bytes:999}}]},expectedRevision:attached.revision})).rejects.toThrow(/exact native-verified/);
    const other=(await service.create({name:'Other planning draft'})).workflow;await expect(service.save({workflow:{...other,attachmentReferences:[reference],planningAttachments:[reference]},expectedRevision:other.revision})).rejects.toThrow(/exact native-verified/);
    const legacy={...attached};delete legacy.planningAttachments;const preserved=await service.save({workflow:legacy,expectedRevision:attached.revision});if(!preserved.ok)throw new Error('save');expect(preserved.workflow.planningAttachments).toEqual([reference]);
    const removed=await service.save({workflow:{...preserved.workflow,planningAttachments:[]},expectedRevision:preserved.workflow.revision});if(!removed.ok)throw new Error('save');expect(removed.workflow.planningAttachments).toEqual([]);expect(removed.workflow.attachmentReferences).toEqual([reference]);
    const restored=await service.save({workflow:{...removed.workflow,planningAttachments:[reference]},expectedRevision:removed.workflow.revision});if(!restored.ok)throw new Error('save');expect(restored.workflow.planningAttachments).toEqual([reference]);
  });
  it('pins only selected planning files, submits the native references once and clears only acknowledged draft files',async()=>{
    const {service,native,root}=await open(),workflow=await oneTask(service,true),prepared=await service.preparePlanAttachments({workflowId:workflow.id,operationId:'prepare-selected-plan-files'});
    for(const [receiptId,name] of [['plan-file-one','one.txt'],['plan-file-two','two.txt']])native.uploadedFiles.set(`${prepared.sessionId}:${receiptId}`,{attachmentId:`native-${receiptId}`,name,bytes:23});
    const attached=(await service.attachPlanFiles({workflowId:workflow.id,sessionId:prepared.sessionId,receiptIds:['plan-file-one','plan-file-two'],operationId:'attach-selected-plan-files'})).workflow,selected=attached.planningAttachments![0]!,remaining=attached.planningAttachments![1]!;
    await expect(service.generatePlan({workflowId:workflow.id,goal:'Never submit forged planning file references',attachmentIds:['unknown-planning-file'],operationId:'invalid-planning-file'})).rejects.toThrow(/no longer in this draft/);expect(native.forks).toHaveLength(0);expect(native.prompts).toHaveLength(0);
    const args={workflowId:workflow.id,goal:'Use the selected requirements attachment',attachmentIds:[selected.id],operationId:'selected-files-plan'},requested=await service.generatePlan(args);await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.plans![0]!.status).toBe('proposed'));
    const current=(await service.get({id:workflow.id})).workflow!,plan=current.plans![0]!;expect(plan.attachments).toEqual([selected]);expect(plan.goal).toBe(args.goal);expect(current.planningAttachments).toEqual([remaining]);expect(current.attachmentReferences).toEqual(attached.attachmentReferences);expect(native.prompts[0]!.files).toEqual([selected.file]);expect(native.prompts[0]!.sessionId).toBe(plan.sessionId);
    expect((await service.generatePlan(args)).planId).toBe(requested.planId);expect(native.prompts).toHaveLength(1);expect(JSON.stringify(JSON.parse(await readFile(join(root,'visual_workflow.json'),'utf8')))).not.toContain('"receiptIds"');
  });
  it('retains the planning goal and files when native admission fails and never resubmits an uncertain Plan operation',async()=>{
    for(const acknowledgementLost of [false,true]){
      const {service,native}=await open(),workflow=await oneTask(service),prepared=await service.preparePlanAttachments({workflowId:workflow.id,operationId:`prepare-failed-plan-${acknowledgementLost}`});
      native.uploadedFiles.set(`${prepared.sessionId}:failed-plan-file`,{attachmentId:'native-retained-plan-file',name:'keep.txt',bytes:18});const attached=(await service.attachPlanFiles({workflowId:workflow.id,sessionId:prepared.sessionId,receiptIds:['failed-plan-file'],operationId:'attach-retained-plan-file'})).workflow;
      const submit=native.submit.bind(native);let calls=0;native.submit=async request=>{calls++;if(acknowledgementLost)await submit(request);throw new Error(acknowledgementLost?'Plan acknowledgement lost':'Native plan admission rejected');};
      const args={workflowId:workflow.id,goal:'Keep this goal and its file selection on failure.',operationId:'uncertain-plan-with-files'};await expect(service.generatePlan(args)).rejects.toThrow(/Plan acknowledgement lost|Native plan admission rejected/);
      const failed=(await service.get({id:workflow.id})).workflow!;expect(failed.planningAttachments).toEqual(attached.planningAttachments);expect(failed.plans![0]).toMatchObject({status:'needs-reconcile',goal:args.goal,attachments:attached.planningAttachments});expect(failed.operations!.find(operation=>operation.kind==='plan')!.status).toBe('needs-reconcile');
      const repeated=await service.generatePlan(args);expect(repeated.planId).toBe(failed.plans![0]!.id);expect(calls).toBe(1);
    }
  });
  it('soft hides completed task identities without changing content revisions, execution history or native Sessions',async()=>{
    const first=await open(),workflow=await oneTask(first.service,true),source=JSON.stringify(await first.native.read('source'));await first.service.run({workflowId:workflow.id,nodeId:'task',operationId:'before-visual-cut'});
    const done=(await first.service.get({id:workflow.id})).workflow!,before=done.nodes.find(node=>node.id==='task')!;
    const cut=await first.service.save({workflow:{...done,nodes:done.nodes.map(node=>node.id==='task'?{...node,hidden:true}:node)},expectedRevision:done.revision});if(!cut.ok)throw new Error('save');
    expect(cut.workflow.nodes.find(node=>node.id==='task')).toMatchObject({hidden:true,revision:before.revision});expect(cut.workflow.executions).toEqual(done.executions);expect(cut.workflow.branches).toEqual(done.branches);expect(cut.workflow.approvals).toEqual(done.approvals);
    await expect(first.service.run({workflowId:workflow.id,nodeId:'task',operationId:'must-not-run-hidden'})).rejects.toThrow(/Restore hidden/);await expect(first.service.batchRun({workflowId:workflow.id,nodeIds:['task'],nodeRevisions:{task:before.revision},operationId:'must-not-batch-hidden'})).rejects.toThrow(/Restore hidden/);
    const legacy={...cut.workflow,nodes:cut.workflow.nodes.map(node=>{const copy={...node};delete copy.hidden;return copy;})},preserved=await first.service.save({workflow:legacy,expectedRevision:cut.workflow.revision});if(!preserved.ok)throw new Error('save');expect(preserved.workflow.nodes.find(node=>node.id==='task')!.hidden).toBe(true);
    await first.ctx.fiber.dispose();const second=await open(first.root,first.native),restored=(await second.service.get({id:workflow.id})).workflow!;expect(restored.nodes.find(node=>node.id==='task')!.hidden).toBe(true);
    const pasted=await second.service.save({workflow:{...restored,nodes:restored.nodes.map(node=>node.id==='task'?{...node,hidden:false,position:{x:850,y:400}}:node)},expectedRevision:restored.revision});if(!pasted.ok)throw new Error('save');expect(pasted.workflow.nodes.find(node=>node.id==='task')).toMatchObject({id:'task',hidden:false,revision:before.revision,position:{x:850,y:400}});expect(pasted.workflow.executions).toEqual(done.executions);expect(JSON.stringify(await second.native.read('source'))).toBe(source);expect(second.native.prompts).toHaveLength(1);
  });
  it('refuses a visual cut of waiting or currently active tasks before changing their history',async()=>{
    const {service}=await open(),workflow=await twoTasks(service),queued=await service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'visible-waiting-task'});
    await expect(service.save({workflow:{...queued.workflow,nodes:queued.workflow.nodes.map(node=>node.id==='downstream'?{...node,hidden:true}:node)},expectedRevision:queued.workflow.revision})).rejects.toThrow(/Stop waiting or active/);expect((await service.get({id:workflow.id})).workflow).toEqual(queued.workflow);
  });
  it('recovers a known planning upload Session after response loss without creating another native Session',async()=>{
    const {service,native}=await open(),workflow=await oneTask(service),create=native.create.bind(native);let calls=0;
    native.create=async options=>{calls++;await create(options);throw new Error('Native planning upload response lost');};
    const args={workflowId:workflow.id,operationId:'lost-planning-upload-create'};await expect(service.preparePlanAttachments(args)).rejects.toThrow(/response lost/);
    const uncertain=(await service.get({id:workflow.id})).workflow!,operation=uncertain.operations!.find(operation=>operation.kind==='prepare-plan-attachments')!;expect(operation.status).toBe('needs-reconcile');expect((await service.catalog()).sessions.map(session=>session.sessionId)).toEqual(['source']);
    native.create=create;const recovered=await service.preparePlanAttachments(args);expect(recovered.sessionId).toBe(operation.childSessionId);expect(recovered.workflow.uploadSessionId).toBe(operation.childSessionId);expect(calls).toBe(1);expect(native.prompts).toHaveLength(0);
  });
  it('never consumes unsubmitted planning draft files through Dynamic follow-up generation',async()=>{
    const {service,native}=await open(),workflow=await oneTask(service),saved=await service.save({workflow:{...workflow,settings:{...workflow.settings!,generation:'dynamic'}},expectedRevision:workflow.revision});if(!saved.ok)throw new Error('save');
    const prepared=await service.preparePlanAttachments({workflowId:workflow.id,operationId:'dynamic-user-draft-stage'});native.uploadedFiles.set(`${prepared.sessionId}:draft-not-yet-submitted`,{attachmentId:'native-unsubmitted-user-plan-file',name:'unsubmitted.txt',bytes:12});
    const attached=(await service.attachPlanFiles({workflowId:workflow.id,sessionId:prepared.sessionId,receiptIds:['draft-not-yet-submitted'],operationId:'dynamic-user-draft-register'})).workflow;
    await service.run({workflowId:workflow.id,nodeId:'task',operationId:'dynamic-task-completion'});await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.plans!.some(plan=>plan.triggerRunId&&plan.status==='proposed')).toBe(true));
    const current=(await service.get({id:workflow.id})).workflow!;expect(current.planningAttachments).toEqual(attached.planningAttachments);expect(current.plans!.every(plan=>!plan.attachments?.length)).toBe(true);expect(native.prompts.filter(prompt=>prompt.text.startsWith('You are drafting')).every(prompt=>!prompt.files?.length)).toBe(true);
  });
  it.runIf(process.platform==='win32')('retries only an uncommitted planning metadata rename while submitting one native plan',async()=>{
    const {service,native,root}=await open();const workflow=await oneTask(service,true);
    const table=Reflect.get(service,'records'),unit=Reflect.get(Reflect.get(table,'host'),'unit') as {publish():Promise<void>};const publish=unit.publish.bind(unit);
    const failure=Object.assign(new Error('Injected native JSON pre-commit rename contention'),{code:'EPERM',syscall:'rename',path:join(root,'.b4c346ef-2bbf-472a-91d3-b21d894a48e1.tmp'),dest:join(root,'visual_workflow.json')});
    let failed=false;const attempts=vi.fn(async()=>{if(!failed){failed=true;throw failure;}return publish();});unit.publish=attempts;
    const requested=await service.generatePlan({workflowId:workflow.id,goal:'Keep this goal while the metadata file is temporarily locked.',operationId:'one-plan-through-metadata-lock'});
    await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.plans!.find(plan=>plan.id===requested.planId)?.status).toBe('proposed'));
    const saved=(await service.get({id:workflow.id})).workflow!,durable=JSON.parse(await readFile(join(root,'visual_workflow.json'),'utf8')).tables.workflows[workflow.id];
    expect(saved.plans).toHaveLength(1);expect(saved.operations!.filter(operation=>operation.kind==='plan')).toHaveLength(1);expect(saved.operations!.find(operation=>operation.kind==='plan')!.status).toBe('completed');expect(native.prompts).toHaveLength(1);expect(native.forks).toHaveLength(1);expect(durable).toEqual(saved);expect(attempts.mock.calls.length).toBeGreaterThan(1);
  });
  it('advertises a versioned capability handshake and exposes model identities without provider secrets',async()=>{
    const {service,native}=await open();expect(await service.capabilities()).toMatchObject({pluginVersion:WORKFLOW_PLUGIN_VERSION,apiVersion:WORKFLOW_API_VERSION,features:expect.arrayContaining(['model-selection','batch-run','delete','attachments','planning','planning-attachments','visual-node-hide'])});
    native.models=async()=>({models:[{provider:'fixture-provider',model:'global-model',label:'Global model',apiKey:'SECRET_PROVIDER_KEY'}],defaultModel:{provider:'fixture-provider',model:'global-model'}});
    expect(await service.models()).toEqual({models:[{provider:'fixture-provider',model:'global-model',label:'Global model'}],defaultModel:{provider:'fixture-provider',model:'global-model'}});
    const workflow=await oneTask(service);const before=structuredClone(workflow);
    for(const invalid of [{provider:'fixture-provider',model:'global-model',apiKey:'SECRET_PROVIDER_KEY'},{provider:' ',model:'global-model'},{provider:'fixture-provider',model:''}]){
      await expect(service.save({workflow:{...workflow,settings:{...workflow.settings!,model:invalid}},expectedRevision:workflow.revision})).rejects.toThrow(/Invalid workflow/);
      await expect(service.save({workflow:{...workflow,nodes:workflow.nodes.map(node=>({...node,model:invalid}))},expectedRevision:workflow.revision})).rejects.toThrow(/Invalid workflow/);
    }
    expect((await service.get({id:workflow.id})).workflow).toEqual(before);
  });
  it('pins global and node override models independently for a dependency-ordered batch without changing its source Session',async()=>{
    const {service,native,root}=await open();const workflow=await twoTasks(service),source=JSON.stringify(await native.read('source'));
    const global={provider:'fixture-provider',model:'global-model'},override={provider:'other-provider',model:'node-model'};
    const configured=await service.save({workflow:{...workflow,settings:{...workflow.settings!,model:global},nodes:workflow.nodes.map(node=>node.id==='downstream'?{...node,model:override}:node)},expectedRevision:workflow.revision});if(!configured.ok)throw new Error('save');
    expect(configured.workflow.nodes.find(node=>node.id==='downstream')).toMatchObject({revision:2,model:override,revisions:[expect.objectContaining({revision:1}),expect.objectContaining({revision:2,model:override})]});
    const args={workflowId:workflow.id,nodeIds:['downstream','task'],nodeRevisions:{downstream:2,task:1},operationId:'models-selected-batch'};
    const batch=await service.batchRun(args);await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.executions!.every(run=>run.status==='completed')).toBe(true));
    const done=(await service.get({id:workflow.id})).workflow!;expect(native.prompts.map(prompt=>prompt.model)).toEqual([global,override]);
    expect(done.executions!.find(run=>run.nodeId==='task')!.resolvedModel).toEqual(global);expect(done.executions!.find(run=>run.nodeId==='downstream')!.resolvedModel).toEqual(override);
    expect(done.approvals!.every(approval=>approval.resolvedModel&&done.executions!.some(run=>run.authorizationFingerprint===approval.fingerprint&&JSON.stringify(run.resolvedModel)===JSON.stringify(approval.resolvedModel)))).toBe(true);
    expect((await service.batchRun(args)).runIds).toEqual(batch.runIds);expect(native.prompts).toHaveLength(2);expect(JSON.stringify(await native.read('source'))).toBe(source);
    const metadata=await readFile(join(root,'visual_workflow.json'),'utf8');expect(metadata).toContain('global-model');expect(metadata).not.toContain('apiKey');
  });
  it('restores a waiting Run with its original resolved default model even after DSH default changes',async()=>{
    const first=await open();const workflow=await twoTasks(first.service),original=structuredClone(first.native.defaultModel);
    const queued=await first.service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'pinned-before-restart'});expect(queued.workflow.executions![0]).toMatchObject({status:'waiting',resolvedModel:original});
    first.native.defaultModel={provider:'fixture-provider',model:'global-model'};await first.ctx.fiber.dispose();
    const second=await open(first.root,first.native);expect(second.native.prompts).toHaveLength(0);await second.service.run({workflowId:workflow.id,nodeId:'task',operationId:'new-default-prerequisite'});
    await vi.waitFor(async()=>expect((await second.service.get({id:workflow.id})).workflow!.executions!.every(run=>run.status==='completed')).toBe(true));
    expect(second.native.prompts.map(prompt=>prompt.model)).toEqual([second.native.defaultModel,original]);
  });
  it('invalidates old waiting model authorization and records override clearing as a content revision',async()=>{
    for(const scope of ['global','node'] as const){
      const {service,native}=await open();const workflow=await twoTasks(service),override={provider:'fixture-provider',model:'node-model'};
      const queued=await service.run({workflowId:workflow.id,nodeId:'downstream',operationId:`waiting-model-${scope}`});const prior=queued.workflow.executions![0]!;
      const changed=await service.save({workflow:{...queued.workflow,...(scope==='global'?{settings:{...queued.workflow.settings!,model:override}}:{nodes:queued.workflow.nodes.map(node=>node.id==='downstream'?{...node,model:override}:node)})},expectedRevision:queued.workflow.revision});if(!changed.ok)throw new Error('save');
      expect(changed.workflow.executions![0]).toMatchObject({status:'cancelled',terminalReason:'authorization-invalidated',resolvedModel:prior.resolvedModel});expect(native.prompts).toHaveLength(0);
      if(scope==='node'){
        const node=changed.workflow.nodes.find(node=>node.id==='downstream')!;expect(node).toMatchObject({revision:2,model:override});
        const cleared=await service.save({workflow:{...changed.workflow,nodes:changed.workflow.nodes.map(node=>node.id==='downstream'?{...node,model:undefined}:node)},expectedRevision:changed.workflow.revision});if(!cleared.ok)throw new Error('save');
        const inherited=cleared.workflow.nodes.find(node=>node.id==='downstream')!;expect(inherited.revision).toBe(3);expect(inherited.model).toBeUndefined();expect(inherited.revisions!.at(-1)!.model).toBeUndefined();expect(inherited.revisions![1]!.model).toEqual(override);
      }
    }
  });
  it('prevalidates every selected native model before a batch write or Fork and rejects unavailable planning models',async()=>{
    const {service,native}=await open();const workflow=await twoTasks(service),unavailable={provider:'unconfigured-provider',model:'missing-model'};
    const saved=await service.save({workflow:{...workflow,nodes:workflow.nodes.map(node=>node.id==='downstream'?{...node,model:unavailable}:node)},expectedRevision:workflow.revision});if(!saved.ok)throw new Error('save');
    await expect(service.batchRun({workflowId:workflow.id,nodeIds:['task','downstream'],nodeRevisions:{task:1,downstream:2},operationId:'invalid-model-batch'})).rejects.toThrow(/unavailable/);
    await expect(service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'invalid-model-run'})).rejects.toThrow(/unavailable/);
    expect((await service.get({id:workflow.id})).workflow).toEqual(saved.workflow);expect(native.forks).toHaveLength(0);expect(native.prompts).toHaveLength(0);
    const configured=await service.save({workflow:{...saved.workflow,settings:{...saved.workflow.settings!,model:unavailable}},expectedRevision:saved.workflow.revision});if(!configured.ok)throw new Error('save');
    await expect(service.generatePlan({workflowId:workflow.id,goal:'Inspect safely',operationId:'invalid-plan-model'})).rejects.toThrow(/unavailable/);expect((await service.get({id:workflow.id})).workflow).toEqual(configured.workflow);
  });
  it('generates a guarded plan with the global model and only creates inheriting Draft tasks after explicit approval',async()=>{
    const {service,native}=await open();const workflow=await oneTask(service,true),global={provider:'fixture-provider',model:'global-model'},override={provider:'other-provider',model:'node-model'};
    const configured=await service.save({workflow:{...workflow,settings:{...workflow.settings!,model:global},nodes:workflow.nodes.map(node=>node.kind==='session'?node:{...node,model:override})},expectedRevision:workflow.revision});if(!configured.ok)throw new Error('save');
    const planned=await service.generatePlan({workflowId:workflow.id,goal:'Inspect and report with the selected global model',operationId:'plan-selected-model'});await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.plans![0]!.status).toBe('proposed'));
    expect(native.prompts).toHaveLength(1);expect(native.prompts[0]!.model).toEqual(global);expect(native.protectedPlanning.has(native.prompts[0]!.sessionId)).toBe(true);
    const before=(await service.get({id:workflow.id})).workflow!;expect(before.plans![0]!.resolvedModel).toEqual(global);expect(before.nodes).toHaveLength(configured.workflow.nodes.length);
    const accepted=await service.applyPlan({workflowId:workflow.id,planId:planned.planId!,accept:true});const drafts=accepted.workflow.nodes.filter(node=>node.originPlanId===planned.planId);
    expect(drafts).toHaveLength(2);expect(drafts.every(node=>node.status==='draft'&&node.model===undefined)).toBe(true);expect(accepted.workflow.executions).toHaveLength(0);expect(native.prompts).toHaveLength(1);
  });
  it('allows an explicit user plan in Manual generation mode while keeping automatic planning disabled',async()=>{
    const {service,native}=await open();const workflow=await oneTask(service),model={provider:'fixture-provider',model:'global-model'};
    const saved=await service.save({workflow:{...workflow,settings:{generation:'manual',execution:'manual',model}},expectedRevision:workflow.revision});if(!saved.ok)throw new Error('save');
    const planned=await service.generatePlan({workflowId:workflow.id,goal:'An explicit planning request in Manual mode',operationId:'manual-explicit-plan'});
    await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.plans![0]!.status).toBe('proposed'));
    expect(native.prompts).toHaveLength(1);expect(native.prompts[0]!.model).toEqual(model);expect(native.protectedPlanning.has(native.prompts[0]!.sessionId)).toBe(true);
    const accepted=await service.applyPlan({workflowId:workflow.id,planId:planned.planId!,accept:true});expect(accepted.workflow.nodes.filter(node=>node.originPlanId===planned.planId)).toHaveLength(2);
    const advance=Reflect.get(service,'advancePolicies') as (id:string)=>Promise<void>;await advance.call(service,workflow.id);expect(native.prompts).toHaveLength(1);expect(accepted.workflow.executions).toEqual([]);
  });
  it('preserves the admitted model while the global selection changes and rejects active node override edits',async()=>{
    const {service,native}=await open();const workflow=await oneTask(service,true);let running=false;
    native.isRunning=()=>running;native.submit=async request=>{running=true;native.prompts.push(request);const log=native.logs.get(request.sessionId)!;for(const [type,data] of [['turn/start',{turn:2}],['user/message',{turn:2,id:request.requestId,source:{kind:'user',rpcId:request.requestId},content:[{type:'text',text:request.text}]}]] as Array<[string,Record<string,unknown>]>)log.events.push({type,data,seq:log.events.length,time:Date.now()});};
    const run=await service.run({workflowId:workflow.id,nodeId:'task',operationId:'active-pinned-model'}),model={provider:'fixture-provider',model:'node-model'};
    await expect(service.save({workflow:{...run.workflow,nodes:run.workflow.nodes.map(node=>node.id==='task'?{...node,hidden:true}:node)},expectedRevision:run.workflow.revision})).rejects.toThrow(/Stop waiting or active/);
    await expect(service.save({workflow:{...run.workflow,nodes:run.workflow.nodes.map(node=>node.id==='task'?{...node,model}:node)},expectedRevision:run.workflow.revision})).rejects.toThrow(/Cancel the active/);
    const changed=await service.save({workflow:{...run.workflow,settings:{...run.workflow.settings!,model}},expectedRevision:run.workflow.revision});if(!changed.ok)throw new Error('save');
    expect(changed.workflow.executions![0]!.resolvedModel).toEqual(native.defaultModel);expect(native.prompts[0]!.model).toEqual(native.defaultModel);expect(changed.workflow.settings!.model).toEqual(model);
  });
  it('does not automatically submit a legacy waiting record whose resolved native model is unknown',async()=>{
    const first=await open();const workflow=await twoTasks(first.service),queued=await first.service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'legacy-unpinned-run'});await first.ctx.fiber.dispose();
    const path=join(first.root,'visual_workflow.json'),json=JSON.parse(await readFile(path,'utf8'));for(const run of json.tables.workflows[workflow.id].executions)delete run.resolvedModel;for(const approval of json.tables.workflows[workflow.id].approvals)delete approval.resolvedModel;await writeFile(path,JSON.stringify(json));
    const second=await open(first.root,first.native),recover=Reflect.get(second.service,'recover') as ()=>Promise<void>;await recover.call(second.service);
    await vi.waitFor(async()=>expect((await second.service.get({id:workflow.id})).workflow!.executions!.find(run=>run.runId===queued.runId)).toMatchObject({status:'cancelled',terminalReason:'authorization-invalidated'}));expect(first.native.prompts).toHaveLength(0);
  });
  it('rejects a Run before creating a branch if model resolution races a global selection edit',async()=>{
    const {service,native}=await open();const workflow=await oneTask(service,true);let entered!:()=>void,release!:()=>void;const entering=new Promise<void>(done=>{entered=done;}),gate=new Promise<void>(done=>{release=done;});
    const resolve=native.resolveModel.bind(native);native.resolveModel=async selection=>{entered();await gate;return resolve(selection);};
    const clicked=service.run({workflowId:workflow.id,nodeId:'task',operationId:'model-resolve-race'});await entering;
    const saved=await service.save({workflow:{...workflow,settings:{...workflow.settings!,model:{provider:'fixture-provider',model:'global-model'}}},expectedRevision:workflow.revision});if(!saved.ok)throw new Error('save');release();
    await expect(clicked).rejects.toThrow(/changed while resolving/);expect(native.forks).toHaveLength(0);expect(native.prompts).toHaveLength(0);expect((await service.get({id:workflow.id})).workflow).toEqual(saved.workflow);
  });
  it('creates one durable private upload Session and hides it from catalog even after workflow archival',async()=>{
    const first=await open();const workflow=await oneTask(first.service,true);const original=JSON.stringify(await first.native.read('source'));const flush=vi.spyOn(first.native,'flush');
    const prepared=await first.service.prepareAttachment({workflowId:workflow.id,nodeId:'task',nodeRevision:1,operationId:'prepare-upload'});
    expect(prepared.sessionId).not.toBe('source');expect(prepared.workflow.uploadSessionId).toBe(prepared.sessionId);expect(flush).toHaveBeenCalledWith(prepared.sessionId);expect(first.native.prompts).toHaveLength(0);expect(first.native.forks).toHaveLength(0);
    expect((await first.service.catalog()).sessions.map(session=>session.sessionId)).toEqual(['source']);
    const reuse=await first.service.prepareAttachment({workflowId:workflow.id,nodeId:'task',nodeRevision:1,operationId:'reuse-upload'});expect(reuse.sessionId).toBe(prepared.sessionId);expect(first.native.logs.size).toBe(2);
    const sourceId=prepared.workflow.nodes.find(node=>node.kind==='session')!.id;await expect(first.service.prepareAttachment({workflowId:workflow.id,nodeId:sourceId,nodeRevision:1,operationId:'source-must-stay-readonly'})).rejects.toThrow(/editable task/);
    await first.ctx.fiber.dispose();const second=await open(first.root,first.native);expect((await second.service.get({id:workflow.id})).workflow!.uploadSessionId).toBe(prepared.sessionId);
    const deleted=await second.service.delete({workflowId:workflow.id,expectedRevision:prepared.workflow.revision});expect(deleted.ok).toBe(true);expect((await second.service.catalog()).sessions.map(session=>session.sessionId)).toEqual(['source']);expect(JSON.stringify(await first.native.read('source'))).toBe(original);
  });
  it('atomically attaches only native-verified receipt references and invalidates the exact waiting Run authorization',async()=>{
    const {service,native,root}=await open();const workflow=await twoTasks(service);const original=JSON.stringify(await native.read('source'));
    const queued=await service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'queued-before-file-upload'});
    const prepared=await service.prepareAttachment({workflowId:workflow.id,nodeId:'downstream',nodeRevision:1,operationId:'prepare-files'});
    const fileA={attachmentId:'native-file-a',name:'first.txt',bytes:13};const fileB={attachmentId:'native-file-b',name:'second.pdf',bytes:27};
    native.uploadedFiles.set(`${prepared.sessionId}:receipt-one`,fileA);native.uploadedFiles.set(`${prepared.sessionId}:receipt-two`,fileB);
    await expect(service.attachFiles({workflowId:workflow.id,nodeId:'downstream',nodeRevision:1,sessionId:'source',receiptIds:['receipt-one'],operationId:'wrong-upload-session'})).rejects.toThrow(/private attachment Session/);
    await expect(service.attachFiles({workflowId:workflow.id,nodeId:'downstream',nodeRevision:1,sessionId:prepared.sessionId,receiptIds:['receipt-one','expired-receipt'],operationId:'atomic-invalid-file'})).rejects.toThrow(/expired/);
    expect((await service.get({id:workflow.id})).workflow).toEqual(prepared.workflow);
    const args={workflowId:workflow.id,nodeId:'downstream',nodeRevision:1,sessionId:prepared.sessionId,receiptIds:['receipt-one','receipt-two'],operationId:'attach-native-files'};
    const attached=await service.attachFiles(args);const node=attached.workflow.nodes.find(node=>node.id==='downstream')!;
    expect(node.revision).toBe(2);expect(node.attachments!.map(item=>item.file)).toEqual([fileA,fileB]);expect(node.revisions!.at(-1)!.attachments).toEqual(node.attachments);expect(attached.workflow.attachmentReferences).toEqual(node.attachments);
    expect(attached.workflow.executions!.find(run=>run.runId===queued.runId)).toMatchObject({status:'cancelled',terminalReason:'authorization-invalidated'});expect(attached.workflow.approvals!.some(approval=>approval.nodeId===node.id)).toBe(false);
    expect((await service.attachFiles(args)).workflow.nodes.find(item=>item.id===node.id)!.revision).toBe(2);
    const clicked=await service.run({workflowId:workflow.id,nodeId:'downstream',nodeRevision:2,operationId:'run-with-native-files'});await service.run({workflowId:workflow.id,nodeId:'task',nodeRevision:1,operationId:'complete-file-prerequisite'});
    await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.executions!.find(run=>run.runId===clicked.runId)!.status).toBe('completed'));
    expect(native.prompts.find(prompt=>prompt.text.startsWith('Task: Downstream'))!.files).toEqual([fileA,fileB]);expect(JSON.stringify(await native.read('source'))).toBe(original);
    const raw=await readFile(join(root,'visual_workflow.json'),'utf8');expect(raw).not.toContain('receipt-one');expect(raw).not.toContain('receipt-two');expect(raw).not.toContain('expired-receipt');
  });
  it('retains verified references for same-workflow copy, cut and undo while rejecting forged or cross-workflow references',async()=>{
    const {service,native}=await open();const workflow=await oneTask(service,true);const prepared=await service.prepareAttachment({workflowId:workflow.id,nodeId:'task',nodeRevision:1,operationId:'prepare-clipboard-file'});
    native.uploadedFiles.set(`${prepared.sessionId}:clipboard-receipt`,{attachmentId:'native-clipboard-file',name:'document.txt',bytes:42});
    const attached=await service.attach({workflowId:workflow.id,nodeId:'task',nodeRevision:1,sessionId:prepared.sessionId,receiptId:'clipboard-receipt',operationId:'attach-clipboard-file'});const reference=attached.workflow.nodes.find(node=>node.id==='task')!.attachments![0]!;
    const cut=await service.save({workflow:{...attached.workflow,nodes:attached.workflow.nodes.filter(node=>node.id!=='task')},expectedRevision:attached.workflow.revision});if(!cut.ok)throw new Error('save');expect(cut.workflow.attachmentReferences).toEqual([reference]);
    const pasted=await service.save({workflow:{...cut.workflow,nodes:[...cut.workflow.nodes,{id:'pasted-task',title:'Pasted task',instruction:'Read the same authorized file',position:{x:500,y:100},status:'draft',revision:1,source:'user',attachments:[reference]}]},expectedRevision:cut.workflow.revision});if(!pasted.ok)throw new Error('save');
    expect(pasted.workflow.nodes.find(node=>node.id==='pasted-task')).toMatchObject({revision:1,attachments:[reference]});expect(pasted.workflow.nodes.find(node=>node.id==='pasted-task')!.revisions![0]!.attachments).toEqual([reference]);expect(pasted.workflow.executions).toEqual([]);
    const removed=await service.save({workflow:{...pasted.workflow,nodes:pasted.workflow.nodes.map(node=>node.id==='pasted-task'?{...node,attachments:[]}:node)},expectedRevision:pasted.workflow.revision});if(!removed.ok)throw new Error('save');
    const undone=await service.save({workflow:{...removed.workflow,nodes:removed.workflow.nodes.map(node=>node.id==='pasted-task'?{...node,attachments:[reference]}:node)},expectedRevision:removed.workflow.revision});if(!undone.ok)throw new Error('save');expect(undone.workflow.nodes.find(node=>node.id==='pasted-task')).toMatchObject({revision:3,attachments:[reference]});
    await expect(service.save({workflow:{...undone.workflow,nodes:undone.workflow.nodes.map(node=>node.id==='pasted-task'?{...node,attachments:[{...reference,file:{...reference.file,bytes:999}}]}:node)},expectedRevision:undone.workflow.revision})).rejects.toThrow(/exact native-verified/);
    const other=(await service.create({name:'Other workflow'})).workflow;
    await expect(service.save({workflow:{...other,attachmentReferences:[reference],nodes:[{id:'foreign-task',title:'Foreign file',instruction:'Not uploaded here',position:{x:0,y:0},status:'draft',revision:1,source:'user',attachments:[reference]}]},expectedRevision:other.revision})).rejects.toThrow(/exact native-verified/);
    const spoofed=await service.save({workflow:{...undone.workflow,uploadSessionId:'client-controlled-session',attachmentReferences:[]},expectedRevision:undone.workflow.revision});if(!spoofed.ok)throw new Error('save');expect(spoofed.workflow.uploadSessionId).toBe(prepared.sessionId);expect(spoofed.workflow.attachmentReferences).toEqual([reference]);
  });
  it('refuses attachment changes to an actually running task and never modifies source nodes',async()=>{
    const {service,native}=await open();const workflow=await oneTask(service,true);const prepared=await service.prepareAttachment({workflowId:workflow.id,nodeId:'task',nodeRevision:1,operationId:'prepare-active-file'});
    native.uploadedFiles.set(`${prepared.sessionId}:active-file`,{attachmentId:'native-active-file',name:'active.txt',bytes:3});
    const attached=await service.attach({workflowId:workflow.id,nodeId:'task',nodeRevision:1,sessionId:prepared.sessionId,receiptId:'active-file',operationId:'attach-active-file'});
    let running=false;native.isRunning=()=>running;
    native.submit=async request=>{running=true;native.prompts.push(request);const log=native.logs.get(request.sessionId)!;const turn=2;for(const [type,data] of [['turn/start',{turn}],['user/message',{turn,id:request.requestId,source:{kind:'user',rpcId:request.requestId},content:[{type:'text',text:request.text}]}]] as Array<[string,Record<string,unknown>]>)log.events.push({type,data,seq:log.events.length,time:Date.now()});};
    const active=await service.run({workflowId:workflow.id,nodeId:'task',nodeRevision:2,operationId:'run-active-file'});expect(active.workflow.executions![0]!.status).toBe('running');
    await expect(service.attachFiles({workflowId:workflow.id,nodeId:'task',nodeRevision:2,sessionId:prepared.sessionId,receiptIds:['active-file'],operationId:'must-not-change-active'})).rejects.toThrow(/Stop the active task/);
    await expect(service.save({workflow:{...active.workflow,nodes:active.workflow.nodes.map(node=>node.id==='task'?{...node,attachments:[]}:node)},expectedRevision:active.workflow.revision})).rejects.toThrow(/active execution/);
    const source=active.workflow.nodes.find(node=>node.kind==='session')!;await expect(service.attach({workflowId:workflow.id,nodeId:source.id,nodeRevision:1,sessionId:prepared.sessionId,receiptId:'active-file',operationId:'must-not-attach-source'})).rejects.toThrow(/editable task/);
  });
  it('recovers a known upload Session identity after response loss without creating another Session',async()=>{
    const {service,native}=await open();const workflow=await oneTask(service,true);const create=native.create.bind(native);let calls=0;
    native.create=async options=>{calls++;await create(options);throw new Error('Upload Session creation response lost');};
    const args={workflowId:workflow.id,nodeId:'task',nodeRevision:1,operationId:'unknown-upload-creation'};await expect(service.prepareAttachment(args)).rejects.toThrow(/response lost/);
    const uncertain=(await service.get({id:workflow.id})).workflow!;expect(uncertain.operations![0]).toMatchObject({kind:'prepare-attachment',status:'needs-reconcile'});expect((await service.catalog()).sessions.map(item=>item.sessionId)).toEqual(['source']);
    native.create=create;const restored=await service.prepareAttachment(args);expect(restored.workflow.uploadSessionId).toBe(uncertain.operations![0]!.childSessionId);expect(restored.workflow.operations![0]!.status).toBe('completed');expect(calls).toBe(1);expect(native.prompts).toHaveLength(0);
  });
  it('treats grouping and group layout as visual edits without invalidating queued authorization or native source protections',async()=>{
    const first=await open();const workflow=await twoTasks(first.service);const original=JSON.stringify(await first.native.read('source'));
    const queued=await first.service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'queue-before-visual-group'});const before=queued.workflow.executions![0]!;const approvals=structuredClone(queued.workflow.approvals);const source=queued.workflow.nodes.find(node=>node.kind==='session')!;
    const grouped=await first.service.save({workflow:{...queued.workflow,groups:[{id:'visual-source-and-task',title:'Visual context',nodeIds:[source.id,'downstream']},{id:'visual-gate',title:'Single member is allowed',nodeIds:['task']}],nodes:queued.workflow.nodes.map(node=>({...node,position:{x:node.position.x+200,y:node.position.y+100}}))},expectedRevision:queued.workflow.revision});if(!grouped.ok)throw new Error('save');
    expect(grouped.workflow.nodes.every(node=>node.revision===1)).toBe(true);expect(grouped.workflow.approvals).toEqual(approvals);expect(grouped.workflow.executions![0]).toMatchObject({status:'waiting',authorizationFingerprint:before.authorizationFingerprint,requestId:before.requestId});expect(JSON.stringify(await first.native.read('source'))).toBe(original);
    await expect(first.service.save({workflow:{...grouped.workflow,groups:[],nodes:grouped.workflow.nodes.filter(node=>node.id!=='downstream'),edges:[]},expectedRevision:grouped.workflow.revision})).rejects.toMatchObject({code:'gateway/bad-request'});
    await expect(first.service.save({workflow:{...grouped.workflow,groups:[],nodes:grouped.workflow.nodes.filter(node=>node.id!==source.id)},expectedRevision:grouped.workflow.revision})).rejects.toMatchObject({code:'gateway/bad-request'});
    const ungrouped=await first.service.save({workflow:{...grouped.workflow,groups:[]},expectedRevision:grouped.workflow.revision});if(!ungrouped.ok)throw new Error('save');expect(ungrouped.workflow.nodes).toEqual(grouped.workflow.nodes);expect(ungrouped.workflow.executions![0]).toMatchObject({status:'waiting',authorizationFingerprint:before.authorizationFingerprint});
    await first.ctx.fiber.dispose();const second=await open(first.root,first.native);expect((await second.service.get({id:workflow.id})).workflow).toEqual(ungrouped.workflow);expect(first.native.prompts).toHaveLength(0);expect(JSON.stringify(await first.native.read('source'))).toBe(original);
  });
  it('atomically queues one batch before native submission and follows dependencies instead of selection order',async()=>{
    const {service,native,root}=await open();const workflow=await twoTasks(service);const original=JSON.stringify(await native.read('source'));
    const submit=native.submit.bind(native);let seenFirst=false;
    native.submit=async request=>{
      if(!seenFirst){seenFirst=true;const snapshot=(await service.get({id:workflow.id})).workflow!;expect(snapshot.executions).toHaveLength(2);expect(snapshot.executions!.map(run=>run.nodeId)).toEqual(['downstream','task']);expect(snapshot.executions!.map(run=>run.status)).toEqual(['waiting','ready']);expect(snapshot.approvals).toHaveLength(2);}
      return submit(request);
    };
    const result=await service.batchRun({workflowId:workflow.id,nodeIds:['downstream','task'],nodeRevisions:{downstream:1,task:1},operationId:'batch-selected-downstream-first'});
    await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.executions!.every(run=>run.status==='completed')).toBe(true));
    const done=(await service.get({id:workflow.id})).workflow!;
    expect(result.runIds).toEqual(done.executions!.map(run=>run.runId));expect(native.prompts.map(prompt=>prompt.text.split('\n')[0])).toEqual(['Task: Task','Task: Downstream']);expect(done.executions!.some(run=>run.nodeId==='unselected')).toBe(false);
    expect(new Set(done.executions!.map(run=>run.sessionId)).size).toBe(1);expect(done.executions![0]!.sessionId).not.toBe('source');expect(JSON.stringify(await native.read('source'))).toBe(original);
    expect(done.operations!.find(operation=>operation.id==='batch-selected-downstream-first')).toMatchObject({kind:'batch-run',status:'completed',runIds:result.runIds,nodeIds:['downstream','task']});
    await service.batchRun({workflowId:workflow.id,nodeIds:['downstream','task'],nodeRevisions:{downstream:1,task:1},operationId:'batch-selected-downstream-first'});expect(native.prompts).toHaveLength(2);
    const persisted=JSON.parse(await readFile(join(root,'visual_workflow.json'),'utf8'));expect(persisted.tables.workflows[workflow.id].executions).toHaveLength(2);
  });
  it('rejects an invalid selected task atomically before any batch intent, authorization or native side effect',async()=>{
    const {service,native}=await open();const workflow=await twoTasks(service);const sourceId=workflow.nodes.find(node=>node.kind==='session')!.id;
    const cases:Array<{nodeIds:string[];nodeRevisions:Record<string,number>;branchId?:string}>=[{nodeIds:['task','missing'],nodeRevisions:{task:1,missing:1}},{nodeIds:['task','downstream'],nodeRevisions:{task:1,downstream:99}},{nodeIds:['task',sourceId],nodeRevisions:{task:1,[sourceId]:1}},{nodeIds:['task','task'],nodeRevisions:{task:1}},{nodeIds:['task','downstream'],nodeRevisions:{task:1}},{nodeIds:['task'],nodeRevisions:{task:1},branchId:'absent-branch'}];
    for(const [index,args] of cases.entries())await expect(service.batchRun({workflowId:workflow.id,...args,operationId:`invalid-batch-${index}`})).rejects.toMatchObject({code:'gateway/bad-request'});
    expect((await service.get({id:workflow.id})).workflow).toEqual(workflow);expect(native.prompts).toHaveLength(0);expect(native.forks).toHaveLength(0);expect(native.logs.size).toBe(1);
    const blank=await service.save({workflow:{...workflow,nodes:workflow.nodes.map(node=>node.id==='downstream'?{...node,instruction:'  '}:node)},expectedRevision:workflow.revision});if(!blank.ok)throw new Error('save');
    await expect(service.batchRun({workflowId:workflow.id,nodeIds:['task','downstream'],nodeRevisions:{task:1,downstream:2},operationId:'empty-instruction-batch'})).rejects.toThrow(/instructions are empty/);
    expect((await service.get({id:workflow.id})).workflow).toEqual(blank.workflow);expect(native.prompts).toHaveLength(0);expect(native.forks).toHaveLength(0);
  });
  it('deduplicates selected waiting requests in their own branch and does not run unselected prerequisites',async()=>{
    const {service,native}=await open();const workflow=await twoTasks(service);
    const first=await service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'first-downstream-click'});
    const repeated=await service.batchRun({workflowId:workflow.id,nodeIds:['downstream'],nodeRevisions:{downstream:1},operationId:'batch-existing-downstream'});
    expect(repeated.runIds).toEqual([first.runId]);expect(repeated.workflow.executions).toHaveLength(1);expect(native.prompts).toHaveLength(0);
    const branch=await service.fork({workflowId:workflow.id,sessionId:'source',label:'Other independent branch',operationId:'other-branch'});
    const independent=await service.batchRun({workflowId:workflow.id,nodeIds:['downstream'],nodeRevisions:{downstream:1},branchId:branch.branchId,operationId:'batch-other-branch'});
    expect(independent.runIds[0]).not.toBe(first.runId);expect(independent.workflow.executions).toHaveLength(2);expect(new Set(independent.workflow.executions!.map(run=>run.sessionId)).size).toBe(2);expect(native.prompts).toHaveLength(0);
  });
  it('keeps a failed batch Session preparation outcome and never creates another child when retried',async()=>{
    const {service,native}=await open();const workflow=await twoTasks(service);const fork=native.fork.bind(native);
    native.fork=async request=>{await fork(request);throw new Error('Child exists but native response was lost');};
    const args={workflowId:workflow.id,nodeIds:['downstream','task'],nodeRevisions:{downstream:1,task:1},operationId:'unknown-batch-child'};
    await expect(service.batchRun(args)).rejects.toThrow(/response was lost/);
    const saved=(await service.get({id:workflow.id})).workflow!;expect(saved.operations![0]).toMatchObject({kind:'batch-run',status:'needs-reconcile'});expect(saved.executions).toEqual([]);expect(saved.approvals).toEqual([]);expect(native.forks).toHaveLength(1);expect(native.prompts).toHaveLength(0);
    const retried=await service.batchRun(args);expect(retried.runIds).toHaveLength(2);expect(native.forks).toHaveLength(1);expect(native.prompts).toHaveLength(0);
  });
  it('archives a complete workflow with CAS while retaining original Sessions and its recoverable Execution history',async()=>{
    const first=await open();const workflow=await oneTask(first.service,true);const original=JSON.stringify(await first.native.read('source'));
    const ran=await first.service.run({workflowId:workflow.id,nodeId:'task',operationId:'complete-before-archive'});const sessionId=ran.workflow.executions![0]!.sessionId;const child=JSON.stringify(await first.native.read(sessionId));
    expect(await first.service.delete({workflowId:workflow.id,expectedRevision:workflow.revision})).toMatchObject({ok:false,code:'conflict',workflow:{revision:ran.workflow.revision}});
    expect(await first.service.delete({workflowId:workflow.id,expectedRevision:ran.workflow.revision})).toEqual({ok:true,workflowId:workflow.id});
    expect(await first.service.get({id:workflow.id})).toEqual({workflow:null});expect((await first.service.list()).workflows).toEqual([]);expect(await first.service.delete({workflowId:workflow.id,expectedRevision:ran.workflow.revision})).toMatchObject({ok:false,code:'not-found'});
    expect(await first.service.save({workflow:ran.workflow,expectedRevision:ran.workflow.revision})).toMatchObject({ok:false,code:'not-found'});await expect(first.service.run({workflowId:workflow.id,nodeId:'task',operationId:'cannot-resurrect'})).rejects.toThrow(/no longer exists/);
    const persisted=JSON.parse(await readFile(join(first.root,'visual_workflow.json'),'utf8')).tables.workflows[workflow.id];expect(persisted.archivedAt).toBeTypeOf('number');expect(persisted.executions).toEqual(ran.workflow.executions);expect(persisted.nodes).toEqual(ran.workflow.nodes);
    await first.ctx.fiber.dispose();const second=await open(first.root,first.native);const recover=Reflect.get(second.service,'recover') as ()=>Promise<void>;await recover.call(second.service);
    expect((await second.service.list()).workflows).toEqual([]);expect(JSON.stringify(await first.native.read('source'))).toBe(original);expect(JSON.stringify(await first.native.read(sessionId))).toBe(child);
    const reimported=await second.service.importSession({sessionId:'source'});expect(reimported.workflow.id).not.toBe(workflow.id);expect(first.native.prompts).toHaveLength(1);
  });
  it('automatically stops waiting, active, uncertain executions, pending operations and running plans before archive',async()=>{
    const states=['waiting','ready','running','approval','unknown','durability','operation','plan'] as const;
    for(const state of states){
      if(state==='waiting'){
        const {service}=await open();const workflow=await twoTasks(service);const queued=await service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'waiting-before-delete'});
        expect(await service.delete({workflowId:workflow.id,expectedRevision:queued.workflow.revision})).toEqual({ok:true,workflowId:workflow.id});continue;
      }
      const {service,native}=await open();let workflow=await oneTask(service,true);const forked=await service.fork({workflowId:workflow.id,sessionId:'source',label:'For archive guard',operationId:'archive-guard-branch'});workflow=forked.workflow;const branch=workflow.branches![0]!;
      const write=Reflect.get(service,'write') as (id:string,transform:(workflow:Workflow)=>Workflow)=>Promise<Workflow>;
      workflow=await write.call(service,workflow.id,current=>({...current,executions:['operation','plan'].includes(state)?[]:[{runId:'guard-run',nodeId:'task',nodeRevision:1,branchId:branch.id,sessionId:branch.sessionId,requestId:'guard-request',status:state==='approval'?'blocked':state==='durability'?'completed':state as 'waiting'|'ready'|'running'|'unknown',turns:[],createdAt:1,updatedAt:1,durability:state==='durability'?'needs-reconcile':'pending'}],operations:state==='operation'?[{id:'pending-side-effect',kind:'fork',status:'pending',createdAt:1}]:current.operations,plans:state==='plan'?[{id:'running-plan',goal:'Still generating',sessionId:branch.sessionId,requestId:'plan-request',status:'running',tasks:[],createdAt:1}]:[]}));
      const before=JSON.stringify(await native.read('source'));expect(await service.delete({workflowId:workflow.id,expectedRevision:workflow.revision})).toEqual({ok:true,workflowId:workflow.id});expect((await service.get({id:workflow.id})).workflow).toBeNull();expect(JSON.stringify(await native.read('source'))).toBe(before);
    }
  });
  it('cancels the durable queue first and keeps the workflow when native cancellation fails',async()=>{
    const {service,native}=await open(),workflow=await twoTasks(service),queued=await service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'delete-failure-wait'});
    const branch=queued.workflow.branches![0]!,write=Reflect.get(service,'write') as (id:string,transform:(workflow:Workflow)=>Workflow)=>Promise<Workflow>;
    const current=await write.call(service,workflow.id,item=>({...item,executions:[...item.executions!,{runId:'native-active',nodeId:'task',nodeRevision:1,branchId:branch.id,sessionId:branch.sessionId,requestId:'native-request',status:'running',turns:[],createdAt:1,updatedAt:1,durability:'pending'}]}));
    const cancel=vi.spyOn(native,'cancel').mockImplementation(async()=>{expect((await service.get({id:workflow.id})).workflow!.executions!.find(run=>run.nodeId==='downstream')!.status).toBe('cancelled');throw new Error('Native cancellation failed');});
    await expect(service.delete({workflowId:workflow.id,expectedRevision:current.revision})).rejects.toThrow(/workflow was kept/);
    const kept=(await service.get({id:workflow.id})).workflow!;expect(kept.archivedAt).toBeUndefined();expect(kept.executions!.find(run=>run.nodeId==='downstream')!.status).toBe('cancelled');expect(cancel).toHaveBeenCalledOnce();expect(native.prompts).toHaveLength(0);
    cancel.mockResolvedValue('none');expect(await service.delete({workflowId:workflow.id,expectedRevision:kept.revision})).toEqual({ok:true,workflowId:workflow.id});
  });
  it('pauses all owned runs and plans without deleting the workflow or dispatching its queued successor',async()=>{
    const {service,native}=await open(),workflow=await twoTasks(service),queued=await service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'pause-wait'});
    const branch=queued.workflow.branches![0]!,planSession=(await native.create()).sessionId,write=Reflect.get(service,'write') as (id:string,transform:(workflow:Workflow)=>Workflow)=>Promise<Workflow>;
    await write.call(service,workflow.id,item=>({...item,executions:[...item.executions!,{runId:'pause-active',nodeId:'task',nodeRevision:1,branchId:branch.id,sessionId:branch.sessionId,requestId:'pause-request',status:'running',turns:[],createdAt:1,updatedAt:1,durability:'pending'}],plans:[{id:'pause-plan',goal:'Draft',sessionId:planSession,requestId:'pause-plan-request',status:'running',tasks:[],createdAt:1}]}));
    const before=JSON.stringify(await native.read('source')),cancel=vi.spyOn(native,'cancel');
    const paused=await service.pauseAll({workflowId:workflow.id});expect(paused.workflow.archivedAt).toBeUndefined();expect(paused.workflow.nodes).toHaveLength(workflow.nodes.length);expect(paused.workflow.executions!.every(run=>run.status==='cancelled')).toBe(true);expect((paused.workflow.plans??[]).map(plan=>plan.status)).toEqual(['failed']);expect(cancel).toHaveBeenCalledTimes(2);
    const reconcile=Reflect.get(service,'reconcileSession') as (sessionId:string)=>Promise<void>;await reconcile.call(service,branch.sessionId);expect((await service.get({id:workflow.id})).workflow!.executions!.every(run=>run.status==='cancelled')).toBe(true);expect(native.prompts).toHaveLength(0);expect(JSON.stringify(await native.read('source'))).toBe(before);
    const restarted=await service.run({workflowId:workflow.id,nodeId:'task',operationId:'explicit-after-pause'});expect(restarted.workflow.executions!.find(run=>run.runId===restarted.runId)!.status).toBe('completed');expect(native.prompts).toHaveLength(1);
  });
  it('does not cancel sources or dispatch new work while deletion waits for native idle',async()=>{
    const {service,native}=await open(),workflow=await oneTask(service,true),forked=await service.fork({workflowId:workflow.id,sessionId:'source',operationId:'delete-race-fork',label:'Owned'}),branch=forked.workflow.branches![0]!;
    const write=Reflect.get(service,'write') as (id:string,transform:(workflow:Workflow)=>Workflow)=>Promise<Workflow>;
    const current=await write.call(service,workflow.id,item=>({...item,executions:[{runId:'delete-race-run',nodeId:'task',nodeRevision:1,branchId:branch.id,sessionId:branch.sessionId,requestId:'delete-race-request',status:'running',turns:[],createdAt:1,updatedAt:1,durability:'pending'}]}));
    let running=true,release!:()=>void,entered!:()=>void;const enteredPromise=new Promise<void>(resolve=>entered=resolve),idle=new Promise<void>(resolve=>release=()=>{running=false;resolve();});
    vi.spyOn(native,'isRunning').mockImplementation(id=>id===branch.sessionId&&running);vi.spyOn(native,'cancel').mockResolvedValue('none');vi.spyOn(native,'waitForIdle').mockImplementation(async()=>{entered();await idle;});
    const deletion=service.delete({workflowId:workflow.id,expectedRevision:current.revision});await enteredPromise;
    await expect(service.save({workflow:current,expectedRevision:current.revision})).rejects.toThrow(/stopping native work/);
    const rerun=service.run({workflowId:workflow.id,nodeId:'task',operationId:'racing-run'});const noRerun=expect(rerun).rejects.toThrow(/no longer exists/);release();expect(await deletion).toEqual({ok:true,workflowId:workflow.id});await noRerun;expect(native.prompts).toHaveLength(0);expect(native.cancel).not.toHaveBeenCalledWith('source',expect.anything());
  });
  it('does not revive a paused plan when its already-completed native result arrives late',async()=>{
    const {service,native}=await open(),workflow=await oneTask(service,true),read=native.read.bind(native);
    let release!:()=>void,entered!:()=>void;const held=new Promise<void>(resolve=>release=resolve),atRead=new Promise<void>(resolve=>entered=resolve);
    vi.spyOn(native,'read').mockImplementation(async id=>{const log=await read(id);if(native.protectedPlanning.has(id)){entered();await held;}return log;});
    const request=await service.generatePlan({workflowId:workflow.id,goal:'A completed native result must not undo Pause all',operationId:'late-plan-result'});await atRead;
    const paused=await service.pauseAll({workflowId:workflow.id});expect(paused.workflow.plans!.find(plan=>plan.id===request.planId)).toMatchObject({status:'failed',error:'Stopped by Pause all'});
    release();await new Promise(resolve=>setTimeout(resolve,25));expect((await service.get({id:workflow.id})).workflow).toEqual(paused.workflow);
  });
  it('persists suppression of old dynamic suggestions across restart without changing execution settings',async()=>{
    const first=await open(),workflow=await oneTask(first.service,true);Reflect.set(first.service,'recovering',true);
    const save=await first.service.save({workflow:{...workflow,settings:{generation:'dynamic',execution:'approval'}},expectedRevision:workflow.revision});if(!save.ok)throw new Error('setup conflict');
    Reflect.set(first.service,'recovering',false);const run=await first.service.run({workflowId:workflow.id,nodeId:'task',operationId:'dynamic-before-pause'});
    const paused=await first.service.pauseAll({workflowId:workflow.id});expect(paused.workflow.settings).toEqual(save.workflow.settings);expect(paused.workflow.operations!.some(operation=>operation.kind==='plan'&&operation.triggerRunId===run.runId&&operation.status==='failed')).toBe(true);
    await first.ctx.fiber.dispose();const second=await open(first.root,first.native),recover=Reflect.get(second.service,'recover') as ()=>Promise<void>;await recover.call(second.service);
    const advance=Reflect.get(second.service,'advancePolicies') as (id:string)=>Promise<void>;await advance.call(second.service,workflow.id);
    expect((await second.service.get({id:workflow.id})).workflow!.plans).toEqual([]);expect(first.native.prompts).toHaveLength(1);
  });
  it('resolves a stopped uncertain admission so a new explicit run can use the branch',async()=>{
    const {service,native}=await open(),workflow=await oneTask(service,true),fork=await service.fork({workflowId:workflow.id,sessionId:'source',operationId:'unknown-stop-fork',label:'Owned'}),branch=fork.workflow.branches![0]!,write=Reflect.get(service,'write') as (id:string,transform:(workflow:Workflow)=>Workflow)=>Promise<Workflow>;
    await write.call(service,workflow.id,item=>({...item,executions:[{runId:'uncertain-stop',nodeId:'task',nodeRevision:1,branchId:branch.id,sessionId:branch.sessionId,requestId:'uncertain-request',status:'unknown',durability:'needs-reconcile',turns:[],createdAt:1,updatedAt:1}],operations:[...item.operations!,{id:'unknown-intent',kind:'run',runId:'uncertain-stop',sourceSessionId:branch.sessionId,status:'needs-reconcile',error:'Admission response was lost',createdAt:1}]}));
    const paused=await service.pauseAll({workflowId:workflow.id});expect(paused.workflow.executions![0]).toMatchObject({status:'cancelled',durability:'durable',terminalReason:'workflow-paused'});expect(paused.workflow.operations!.find(operation=>operation.id==='unknown-intent')).toMatchObject({status:'failed'});expect(paused.workflow.operations!.find(operation=>operation.id==='unknown-intent')!.error).toContain('Admission response was lost');
    const rerun=await service.run({workflowId:workflow.id,nodeId:'task',operationId:'new-after-uncertain-stop'});expect(rerun.workflow.executions!.find(item=>item.runId===rerun.runId)!.status).toBe('completed');expect(native.prompts).toHaveLength(1);
  });
  it('backs up and upgrades a Phase 1 record before the first converted write',async()=>{
    const root=await mkdtemp(join(tmpdir(),'workflow-upgrade-'));roots.push(root);
    const legacy:Workflow={id:'workflow-legacy',name:'Legacy',schemaVersion:1,revision:4,nodes:[],edges:[],viewport:{x:12,y:34,zoom:.8},createdAt:1,updatedAt:2};
    await writeFile(join(root,'visual_workflow.json'),JSON.stringify({unit:{name:'visual_workflow',version:1},global:null,tables:{workflows:{[legacy.id]:legacy}}}));
    const {service}=await open(root);expect((await service.get({id:legacy.id})).workflow).toMatchObject({...legacy,schemaVersion:2});
    const persisted=JSON.parse(await readFile(join(root,'visual_workflow.json'),'utf8'));expect(persisted.tables.legacy_backup[legacy.id]).toEqual(legacy);expect(persisted.tables.workflows[legacy.id].schemaVersion).toBe(2);
  });
  it('uses an explicit Run click to authorize the exact current revision on native children',async()=>{
    const {service,native,root}=await open();const original=JSON.stringify(await native.read('source'));let workflow=await oneTask(service,true);
    await expect(service.run({workflowId:workflow.id,nodeId:'task',nodeRevision:99,operationId:'stale-click'})).rejects.toThrow(/revision changed/);
    const result=await service.run({workflowId:workflow.id,nodeId:'task',nodeRevision:1,operationId:'run-once'});const run=result.workflow.executions![0]!;
    expect(run).toMatchObject({nodeId:'task',nodeRevision:1,status:'completed',durability:'durable',summary:'Observable completion'});expect(run.sessionId).not.toBe('source');
    expect(native.forks).toEqual([{sessionId:'source',atSeq:3}]);expect(JSON.stringify(await native.read('source'))).toBe(original);
    const trace=(await service.trace({workflowId:workflow.id,runId:run.runId})).trace;expect(trace.steps.some(step=>step.type==='command')).toBe(true);
    const step=trace.steps.find(step=>step.type==='command')!;expect((await service.details({workflowId:workflow.id,runId:run.runId,stepId:step.stepId})).details).toMatchObject({command:'Get-Location',output:'Recorded command output'});
    const raw=await readFile(join(root,'visual_workflow.json'),'utf8');expect(raw).not.toContain('Recorded command output');expect(raw).not.toContain('DO_NOT_PERSIST_REASONING');expect(raw).not.toContain('arguments');
    await service.run({workflowId:workflow.id,nodeId:'task',operationId:'run-once'});expect(native.prompts).toHaveLength(1);
    const edited=await service.save({workflow:{...result.workflow,nodes:result.workflow.nodes.map(node=>node.id==='task'?{...node,instruction:'New task revision'}:node)},expectedRevision:result.workflow.revision});if(!edited.ok)throw new Error('conflict');
    expect(edited.workflow.nodes.find(node=>node.id==='task')?.revision).toBe(2);expect(edited.workflow.nodes.find(node=>node.id==='task')?.revisions).toHaveLength(2);
    await expect(service.run({workflowId:workflow.id,nodeId:'task',nodeRevision:1,operationId:'stale-revision'})).rejects.toThrow(/revision changed/);
    const rerun=await service.run({workflowId:workflow.id,nodeId:'task',nodeRevision:2,operationId:'clicked-new-revision'});expect(rerun.workflow.executions!.at(-1)).toMatchObject({nodeRevision:2,status:'completed'});
  });
  it('forks sibling branches with distinct Session IDs and shared history node references',async()=>{
    const {service,native}=await open();let workflow=await oneTask(service,true);await service.approve({workflowId:workflow.id,nodeId:'task',approved:true});
    const ran=await service.run({workflowId:workflow.id,nodeId:'task',operationId:'first-run'});const run=ran.workflow.executions![0]!;const sourceBefore=JSON.stringify(await native.read(run.sessionId));
    const left=await service.fork({workflowId:workflow.id,runId:run.runId,label:'Left',operationId:'fork-left'});
    const right=await service.fork({workflowId:workflow.id,runId:run.runId,label:'Right',operationId:'fork-right'});
    const branches=right.workflow.branches!;expect(new Set(branches.map(branch=>branch.sessionId)).size).toBe(branches.length);expect(right.workflow.nodes).toHaveLength(2);
    expect(branches.find(branch=>branch.id===left.branchId)!.nodeIds).toContain('task');expect(branches.find(branch=>branch.id===right.branchId)!.nodeIds).toContain('task');
    expect(JSON.stringify(await native.read(run.sessionId))).toBe(sourceBefore);expect(native.forks.slice(1).every(fork=>fork.atSeq===run.endSeq)).toBe(true);
    const leftId=branches.find(branch=>branch.id===left.branchId)!.sessionId,rightId=branches.find(branch=>branch.id===right.branchId)!.sessionId;
    await native.submit({sessionId:leftId,requestId:'left-only',text:'Left context'});expect(JSON.stringify(await native.read(rightId))).not.toContain('left-only');
  });
  it('retains unknown admission outcomes without blindly submitting them again',async()=>{
    const {service,native}=await open();const workflow=await oneTask(service);await service.approve({workflowId:workflow.id,nodeId:'task',approved:true});native.failAfterAdmission=true;
    await service.run({workflowId:workflow.id,nodeId:'task',operationId:'lost-result'}).catch(error=>expect(String(error)).toMatch(/Response lost/));
    const current=(await service.get({id:workflow.id})).workflow!;expect(current.operations![0]).toMatchObject({status:'needs-reconcile'});expect(current.executions![0]!.durability).toBe('needs-reconcile');
    await service.run({workflowId:workflow.id,nodeId:'task',operationId:'lost-result'});expect(native.prompts).toHaveLength(1);
  });
  it('proposes strict native Agent plans and runs accepted drafts only after an explicit Run click',async()=>{
    const {service,native}=await open();const original=JSON.stringify(await native.read('source'));const workflow=(await service.importSession({sessionId:'source'})).workflow;
    const requested=await service.generatePlan({workflowId:workflow.id,goal:'Read repository and report',operationId:'plan-once'});
    await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.plans![0]!.status).toBe('proposed'));
    const plan=(await service.get({id:workflow.id})).workflow!.plans![0]!;expect(plan.tasks).toHaveLength(2);expect(native.prompts[0]!.sessionId).not.toBe('source');expect(JSON.stringify(await native.read('source'))).toBe(original);
    await expect(service.applyPlan({workflowId:workflow.id,planId:requested.planId!,accept:true,taskIds:['b']})).rejects.toThrow(/prerequisite/);
    const accepted=await service.applyPlan({workflowId:workflow.id,planId:requested.planId!,accept:true,taskIds:['a','b']});const tasks=accepted.workflow.nodes.filter(node=>node.kind!=='session');expect(tasks).toHaveLength(2);expect(tasks.every(task=>task.status==='draft')).toBe(true);expect(accepted.workflow.branches).toHaveLength(0);
    expect(native.prompts).toHaveLength(1);
    const clicked=await service.run({workflowId:workflow.id,nodeId:tasks[0]!.id,operationId:'explicitly-clicked-draft'});expect(clicked.workflow.executions![0]!.status).toBe('completed');
  });
  it('uses an explicitly selected catalog Session only as read-only planning context and restores its guard after restart',async()=>{
    const first=await open();const original=JSON.stringify(await first.native.read('source'));const workflow=(await first.service.create({name:'Unlinked plan'})).workflow;
    await first.service.generatePlan({workflowId:workflow.id,sourceSessionId:'source',goal:'Inspect selected historical context',operationId:'catalog-context-plan'});
    await vi.waitFor(async()=>expect((await first.service.get({id:workflow.id})).workflow!.plans![0]!.status).toBe('proposed'));
    const current=(await first.service.get({id:workflow.id})).workflow!;const plan=current.plans![0]!;
    expect(current.sourceSessionId).toBeUndefined();expect(current.branches).toEqual([]);expect(first.native.protectedPlanning.has(plan.sessionId)).toBe(true);expect(JSON.stringify(await first.native.read('source'))).toBe(original);
    await first.service.applyPlan({workflowId:workflow.id,planId:plan.id,accept:false});
    await first.ctx.fiber.dispose();first.native.protectedPlanning.clear();const second=await open(first.root,first.native);
    const recover=Reflect.get(second.service,'recover') as ()=>Promise<void>;await recover.call(second.service);
    expect(first.native.protectedPlanning.has(plan.sessionId)).toBe(true);
    await expect(second.service.generatePlan({workflowId:workflow.id,sourceSessionId:'missing',goal:'Invalid context',operationId:'missing-context'})).rejects.toThrow(/no longer exists/);
  });
  it('does not propose syntactically valid plan JSON from a cancelled native request',async()=>{
    const {service,native}=await open();native.planTerminalReason='cancelled';const workflow=(await service.create({name:'Cancelled plan'})).workflow;
    await service.generatePlan({workflowId:workflow.id,goal:'Generate but cancel',operationId:'cancelled-plan'});
    await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.plans![0]!.status).toBe('failed'));
    const plan=(await service.get({id:workflow.id})).workflow!.plans![0]!;expect(plan.tasks).toEqual([]);expect(plan.error).toMatch(/did not complete successfully/);
    await expect(service.applyPlan({workflowId:workflow.id,planId:plan.id,accept:true})).rejects.toThrow(/No proposed plan/);
  });
  it('does not accept Client overwrites of authoritative run metadata and protects root content',async()=>{
    const {service}=await open();const workflow=await oneTask(service,true);
    const result=await service.save({workflow:{...workflow,nodes:workflow.nodes.map(node=>node.kind==='session'?{...node,title:'Overwrite source',sourceSessionId:'other'}:node),operations:[{id:'fake',kind:'run',status:'completed',createdAt:1}]},expectedRevision:workflow.revision});
    if(!result.ok)throw new Error('conflict');expect(result.workflow.operations).toEqual([]);expect(result.workflow.nodes[0]).toMatchObject({title:'source',sourceSessionId:'source'});
  });
  it('persists task and Session-root layers without revoking approval or changing native history',async()=>{
    const first=await open();const sourceBefore=JSON.stringify(await first.native.read('source'));let workflow=await oneTask(first.service,true);
    workflow=(await first.service.approve({workflowId:workflow.id,nodeId:'task',approved:true})).workflow;
    const approved=structuredClone(workflow.approvals);const task=workflow.nodes.find(node=>node.id==='task')!;const root=workflow.nodes.find(node=>node.kind==='session')!;
    const saved=await first.service.save({workflow:{...workflow,nodes:workflow.nodes.map(node=>node.kind==='session'?{...node,zIndex:14,title:'Cannot change source',instruction:'Cannot edit source',sourceSessionId:'forged-source'}:{...node,zIndex:4})},expectedRevision:workflow.revision});
    if(!saved.ok)throw new Error('conflict');
    expect(saved.workflow.nodes.find(node=>node.id==='task')).toMatchObject({revision:task.revision,zIndex:4,status:'ready'});
    expect(saved.workflow.nodes.find(node=>node.id===root.id)).toMatchObject({revision:root.revision,zIndex:14,title:root.title,instruction:root.instruction,sourceSessionId:'source'});
    expect(saved.workflow.approvals).toEqual(approved);expect(first.native.prompts).toHaveLength(0);expect(first.native.forks).toHaveLength(0);expect(JSON.stringify(await first.native.read('source'))).toBe(sourceBefore);
    await first.ctx.fiber.dispose();const second=await open(first.root,first.native);
    const restored=(await second.service.get({id:workflow.id})).workflow!;expect(restored).toEqual(saved.workflow);
    // Real execution admission verifies the retained approval fingerprint,
    // beyond merely checking that an approval object survived the write.
    const ran=await second.service.run({workflowId:workflow.id,nodeId:'task',operationId:'run-after-layer-only-edit'});
    expect(ran.workflow.executions![0]).toMatchObject({nodeRevision:task.revision,status:'completed'});
    expect(JSON.stringify(await first.native.read('source'))).toBe(sourceBefore);
  });
  it('rejects edits and approval changes while native approval is pending, then unlocks a terminal blocked execution',async()=>{
    const {service,native}=await open();let workflow=await oneTask(service);let running=false;
    native.isRunning=()=>running;
    native.submit=async request=>{
      running=true;
      native.prompts.push(request);const log=native.logs.get(request.sessionId)!;
      for(const [type,data] of [
        ['turn/start',{turn:1}],
        ['user/message',{id:request.requestId,source:{kind:'user',rpcId:request.requestId},content:[{type:'text',text:request.text}]}],
        ['step/start',{turn:1,step:1}],
        ['approval/asked',{turn:1,step:1,id:'native-approval',callId:'blocked-call',toolName:'pwsh',reason:'Permission required'}],
      ] as Array<[string,Record<string,unknown>]>)log.events.push({type,data,seq:log.events.length,time:log.events.length+10});
    };
    await service.approve({workflowId:workflow.id,nodeId:'task',approved:true});
    workflow=(await service.run({workflowId:workflow.id,nodeId:'task',operationId:'waiting-native-approval'})).workflow;
    const run=workflow.executions![0]!;expect(run).toMatchObject({status:'blocked',endSeq:undefined});
    await expect(service.save({workflow:{...workflow,nodes:workflow.nodes.map(node=>({...node,instruction:'Cannot change a paused execution'}))},expectedRevision:workflow.revision})).rejects.toThrow(/active execution/);
    await expect(service.approve({workflowId:workflow.id,nodeId:'task',approved:false})).rejects.toThrow(/currently executing/);
    expect((await service.get({id:workflow.id})).workflow!.revision).toBe(workflow.revision);
    const log=native.logs.get(run.sessionId)!;
    for(const [type,data] of [
      ['approval/decided',{turn:1,step:1,id:'native-approval',outcome:'rejected'}],
      ['turn/end',{turn:1,reason:{kind:'blocked'}}],
    ] as Array<[string,Record<string,unknown>]>)log.events.push({type,data,seq:log.events.length,time:log.events.length+10});
    running=false;const reconcile=Reflect.get(service,'reconcileSession') as (sessionId:string)=>Promise<void>;await reconcile.call(service,run.sessionId);
    workflow=(await service.get({id:workflow.id})).workflow!;
    expect(workflow.executions![0]).toMatchObject({status:'blocked',endSeq:log.events.at(-1)!.seq,durability:'durable'});
    const edited=await service.save({workflow:{...workflow,nodes:workflow.nodes.map(node=>({...node,instruction:'A new approved revision after terminal rejection'}))},expectedRevision:workflow.revision});
    if(!edited.ok)throw new Error('Expected terminal blocked task to be editable');
    expect(edited.workflow.nodes[0]).toMatchObject({revision:2,status:'draft'});expect(edited.workflow.approvals).toEqual([]);
    const approved=await service.approve({workflowId:workflow.id,nodeId:'task',approved:true});
    expect(approved.workflow.approvals![0]).toMatchObject({nodeRevision:2,decision:'approved'});
    expect(approved.workflow.nodes[0]).toMatchObject({revision:2,status:'ready'});
  });
  it('isolates prerequisite completion by branch and exact node revision, then permits inherited completed prefixes',async()=>{
    const {service}=await open();let workflow=await oneTask(service,true);
    let saved=await service.save({workflow:{...workflow,nodes:[...workflow.nodes,{id:'dependent',title:'Dependent',instruction:'Requires task',source:'user',status:'draft',revision:1,position:{x:500,y:100}}],edges:[{id:'requires-task',source:'task',target:'dependent',type:'dependency'}]},expectedRevision:workflow.revision});
    if(!saved.ok)throw new Error('conflict');workflow=saved.workflow;
    const sibling=await service.fork({workflowId:workflow.id,sessionId:'source',label:'Sibling before task',operationId:'early-sibling'});
    const siblingId=sibling.branchId!;
    const primary=await service.fork({workflowId:workflow.id,sessionId:'source',label:'Primary',operationId:'primary'});
    await service.approve({workflowId:workflow.id,nodeId:'task',approved:true});await service.approve({workflowId:workflow.id,nodeId:'dependent',approved:true});
    const completed=await service.run({workflowId:workflow.id,nodeId:'task',branchId:primary.branchId,operationId:'complete-primary'});const run=completed.workflow.executions![0]!;
    const waiting=await service.run({workflowId:workflow.id,nodeId:'dependent',branchId:siblingId,operationId:'wrong-sibling'});const waitingRun=waiting.workflow.executions!.find(run=>run.runId===waiting.runId)!;expect(waitingRun).toMatchObject({status:'waiting',waitingReason:'prerequisites'});expect(waitingRun.startSeq).toBeUndefined();
    const inherited=await service.fork({workflowId:workflow.id,runId:run.runId,label:'Inherited prefix',operationId:'inherit'});
    const ran=await service.run({workflowId:workflow.id,nodeId:'dependent',branchId:inherited.branchId,operationId:'inherited-dependency'});expect(ran.workflow.executions!.at(-1)?.status).toBe('completed');
    saved=await service.save({workflow:{...ran.workflow,nodes:ran.workflow.nodes.map(node=>node.id==='task'?{...node,instruction:'Revised prerequisite'}:node)},expectedRevision:ran.workflow.revision});if(!saved.ok)throw new Error('conflict');
    // Dependency content changed, so its old completion cannot admit another run.
    const revised=await service.run({workflowId:workflow.id,nodeId:'dependent',branchId:inherited.branchId,operationId:'old-revision'});expect(revised.workflow.executions!.find(run=>run.runId===revised.runId)!.status).toBe('waiting');
  });
  it('rebuilds an admitted execution after restart without submitting a second native prompt',async()=>{
    const first=await open();const workflow=await oneTask(first.service,true);await first.service.approve({workflowId:workflow.id,nodeId:'task',approved:true});first.native.failAfterAdmission=true;
    await first.service.run({workflowId:workflow.id,nodeId:'task',operationId:'lost-on-restart'}).catch(()=>{});
    await first.ctx.fiber.dispose();const second=await open(first.root,first.native);
    const recover=Reflect.get(second.service,'recover') as ()=>Promise<void>;await recover.call(second.service);
    const restored=(await second.service.get({id:workflow.id})).workflow!;expect(restored.executions![0]).toMatchObject({status:'completed',durability:'durable',summary:'Observable completion'});expect(first.native.prompts).toHaveLength(1);
    await second.service.run({workflowId:workflow.id,nodeId:'task',operationId:'lost-on-restart'});expect(first.native.prompts).toHaveLength(1);
  });
  it('advances only explicitly clicked tasks in dependency order and creates inert Dynamic proposals',async()=>{
    const first=await open();let workflow=await oneTask(first.service,true);
    const saved=await first.service.save({workflow:{...workflow,settings:{generation:'dynamic',execution:'auto'},nodes:[...workflow.nodes,
      {id:'dependent',title:'After task',instruction:'Use the completed task',source:'user',status:'draft',revision:1,position:{x:500,y:100}},
      {id:'unapproved',title:'Never approved',instruction:'Must remain idle',source:'user',status:'draft',revision:1,position:{x:800,y:100}}],edges:[{id:'dependency',source:'task',target:'dependent',type:'dependency'}]},expectedRevision:workflow.revision});
    if(!saved.ok)throw new Error('conflict');workflow=saved.workflow;
    const blocked=(await first.service.run({workflowId:workflow.id,nodeId:'dependent',operationId:'click-downstream-first'})).workflow;
    expect(blocked.nodes.find(node=>node.id==='dependent')!.status).toBe('waiting');expect(first.native.prompts).toHaveLength(0);
    await first.service.run({workflowId:workflow.id,nodeId:'task',operationId:'click-prerequisite'});
    await vi.waitFor(async()=>{
      const current=(await first.service.get({id:workflow.id})).workflow!;
      expect(current.executions?.map(run=>[run.nodeId,run.status,run.durability])).toEqual([['dependent','completed','durable'],['task','completed','durable']]);
      expect(current.plans?.filter(plan=>plan.status==='proposed')).toHaveLength(2);
    });
    const current=(await first.service.get({id:workflow.id})).workflow!;
    expect(current.nodes).toHaveLength(4);expect(current.executions!.every(run=>run.admissionPolicies?.generation==='dynamic'&&run.admissionPolicies.execution==='auto')).toBe(true);
    expect(current.executions!.some(run=>run.nodeId==='unapproved')).toBe(false);expect(current.plans!.every(plan=>!!plan.triggerRunId)).toBe(true);
    for(const run of current.executions!){const plan=current.plans!.find(plan=>plan.triggerRunId===run.runId)!;expect(plan.sessionId).not.toBe(run.sessionId);expect(first.native.forks).toContainEqual({sessionId:run.sessionId,atSeq:run.endSeq!});}
    const promptCount=first.native.prompts.length;await first.ctx.fiber.dispose();const second=await open(first.root,first.native);
    const recover=Reflect.get(second.service,'recover') as ()=>Promise<void>;await recover.call(second.service);
    const advance=Reflect.get(second.service,'advancePolicies') as (id:string)=>Promise<void>;await advance.call(second.service,workflow.id);await advance.call(second.service,workflow.id);
    expect(first.native.prompts).toHaveLength(promptCount);expect((await second.service.get({id:workflow.id})).workflow!.plans).toHaveLength(2);
  });
  it('does not dynamically revisit runs admitted under Suggest after changing generation policy',async()=>{
    const {service,native}=await open();let workflow=await oneTask(service);await service.approve({workflowId:workflow.id,nodeId:'task',approved:true});
    workflow=(await service.run({workflowId:workflow.id,nodeId:'task',operationId:'old-suggest-run'})).workflow;
    const saved=await service.save({workflow:{...workflow,settings:{generation:'dynamic',execution:'approval'}},expectedRevision:workflow.revision});if(!saved.ok)throw new Error('conflict');
    const advance=Reflect.get(service,'advancePolicies') as (id:string)=>Promise<void>;await advance.call(service,workflow.id);
    expect(native.prompts).toHaveLength(1);expect((await service.get({id:workflow.id})).workflow!.plans).toEqual([]);
  });
  it('does not automatically retry failed or unknown admissions and never advances unresolved branch outcomes',async()=>{
    for(const unknown of [false,true]){
      const {service,native}=await open();let workflow=await oneTask(service);
      const saved=await service.save({workflow:{...workflow,settings:{generation:'suggest',execution:'auto'}},expectedRevision:workflow.revision});if(!saved.ok)throw new Error('conflict');workflow=saved.workflow;
      native.taskTerminalReason='error';native.failAfterAdmission=unknown;
      const clicked=service.run({workflowId:workflow.id,nodeId:'task',operationId:`explicit-${unknown?'unknown':'failed'}`});if(unknown)await clicked.catch(error=>expect(String(error)).toMatch(/Response lost/));else await clicked;
      await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.executions).toHaveLength(1));
      const advance=Reflect.get(service,'advancePolicies') as (id:string)=>Promise<void>;
      await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.executions![0]!.status).toBe(unknown?'unknown':'failed'));
      await advance.call(service,workflow.id);await advance.call(service,workflow.id);
      expect(native.prompts).toHaveLength(1);expect((await service.get({id:workflow.id})).workflow!.plans).toEqual([]);
    }
  });
  it('revalidates Run authorization after asynchronous Session creation if the user changes policies',async()=>{
    const {service,native}=await open();let workflow=await oneTask(service);
    const saved=await service.save({workflow:{...workflow,settings:{generation:'suggest',execution:'auto'}},expectedRevision:workflow.revision});if(!saved.ok)throw new Error('conflict');workflow=saved.workflow;
    const create=native.create.bind(native);let entered!:()=>void;const entering=new Promise<void>(done=>{entered=done;});let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});
    native.create=async options=>{entered();await gate;return create(options);};
    const clicked=service.run({workflowId:workflow.id,nodeId:'task',operationId:'click-before-policy-change'});await entering;
    workflow=(await service.get({id:workflow.id})).workflow!;
    const disabled=await service.save({workflow:{...workflow,settings:{generation:'suggest',execution:'manual'}},expectedRevision:workflow.revision});if(!disabled.ok)throw new Error('conflict');
    release();
    await expect(clicked).rejects.toThrow(/policies changed/);
    await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.operations![0]!.status).toBe('needs-reconcile'));
    expect(native.prompts).toHaveLength(0);expect((await service.get({id:workflow.id})).workflow!.executions).toEqual([]);
  });
  it('keeps only clicked downstream tasks waiting without native sequence placeholders and cancels them locally',async()=>{
    const {service,native}=await open();let workflow=await oneTask(service,true);
    const saved=await service.save({workflow:{...workflow,nodes:[...workflow.nodes,{id:'downstream',title:'Wait for task',instruction:'Only run after task',position:{x:600,y:100},source:'user',revision:1,status:'draft'}],edges:[{id:'requires',source:'task',target:'downstream',type:'dependency'}]},expectedRevision:workflow.revision});if(!saved.ok)throw new Error('save');workflow=saved.workflow;
    const clicked=await service.run({workflowId:workflow.id,nodeId:'downstream',nodeRevision:1,operationId:'queued-click'});const run=clicked.workflow.executions![0]!;
    expect(run).toMatchObject({status:'waiting',waitingReason:'prerequisites',nodeRevision:1,turns:[]});expect(run.authorizationFingerprint).toMatch(/^[a-f0-9]{64}$/);expect(run.requestId).toBeTruthy();expect(run.startSeq).toBeUndefined();expect(native.prompts).toHaveLength(0);
    expect((await service.trace({workflowId:workflow.id,runId:run.runId})).trace).toMatchObject({status:'waiting',steps:[]});
    await expect(service.details({workflowId:workflow.id,runId:run.runId,stepId:'not-native'})).rejects.toThrow(/no native execution steps/);
    const alias=await service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'same-user-double-click'});expect(alias.runId).toBe(run.runId);expect(alias.workflow.executions).toHaveLength(1);
    const nativeCancel=vi.spyOn(native,'cancel');const cancelled=await service.cancel({workflowId:workflow.id,runId:run.runId});expect(cancelled.workflow.executions![0]).toMatchObject({status:'cancelled',terminalReason:'queue-cancelled'});expect(nativeCancel).not.toHaveBeenCalled();
    await service.run({workflowId:workflow.id,nodeId:'task',operationId:'run-only-prerequisite'});
    const advance=Reflect.get(service,'advancePolicies') as (id:string)=>Promise<void>;await advance.call(service,workflow.id);
    expect(native.prompts).toHaveLength(1);expect((await service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'same-user-double-click'})).runId).toBe(run.runId);
  });
  it('invalidates queued authorization when its task, prerequisite, dependency edge or policies change',async()=>{
    for(const change of ['task','prerequisite','edge','policies'] as const){
      const {service,native}=await open();let workflow=await oneTask(service,true);
      const added=await service.save({workflow:{...workflow,nodes:[...workflow.nodes,{id:'downstream',title:'Downstream',instruction:'Wait for task',source:'user',status:'draft',revision:1,position:{x:600,y:100}}],edges:[{id:'requires',source:'task',target:'downstream',type:'dependency'}]},expectedRevision:workflow.revision});if(!added.ok)throw new Error('save');
      const clicked=await service.run({workflowId:workflow.id,nodeId:'downstream',operationId:`queued-${change}`});workflow=clicked.workflow;
      const edited=await service.save({workflow:{...workflow,nodes:workflow.nodes.map(node=>node.id===(change==='task'?'downstream':'task')&&(change==='task'||change==='prerequisite')?{...node,instruction:'A changed authorization scope'}:node),edges:change==='edge'?[]:workflow.edges,settings:change==='policies'?{generation:'manual',execution:'manual'}:workflow.settings},expectedRevision:workflow.revision});
      if(!edited.ok)throw new Error('save');expect(edited.workflow.executions![0]).toMatchObject({status:'cancelled',terminalReason:'authorization-invalidated'});
      const advance=Reflect.get(service,'advancePolicies') as (id:string)=>Promise<void>;await advance.call(service,workflow.id);expect(native.prompts).toHaveLength(0);
    }
  });
  it('retains queued version authorization across task and source resizing and durable restart',async()=>{
    const first=await open();let workflow=await oneTask(first.service,true);
    const added=await first.service.save({workflow:{...workflow,nodes:[...workflow.nodes,{id:'downstream',title:'Downstream',instruction:'Wait for task',source:'user',status:'draft',revision:1,position:{x:600,y:100}}],edges:[{id:'requires',source:'task',target:'downstream',type:'dependency'}]},expectedRevision:workflow.revision});if(!added.ok)throw new Error('save');
    workflow=(await first.service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'queue-before-resize'})).workflow;const before=workflow.executions![0]!;const approvals=structuredClone(workflow.approvals);
    const resized=await first.service.save({workflow:{...workflow,nodes:workflow.nodes.map(node=>({...node,width:node.kind==='session'?440:520,height:node.kind==='session'?240:380}))},expectedRevision:workflow.revision});if(!resized.ok)throw new Error('save');
    expect(resized.workflow.executions![0]).toMatchObject({status:'waiting',authorizationFingerprint:before.authorizationFingerprint,requestId:before.requestId});expect(resized.workflow.approvals).toEqual(approvals);expect(resized.workflow.nodes.every(node=>node.revision===1)).toBe(true);
    await first.ctx.fiber.dispose();const second=await open(first.root,first.native);const recover=Reflect.get(second.service,'recover') as ()=>Promise<void>;await recover.call(second.service);
    const restored=(await second.service.get({id:workflow.id})).workflow!;expect(restored.executions![0]).toMatchObject({runId:before.runId,status:'waiting',requestId:before.requestId});expect(restored.nodes.every(node=>node.width!==undefined&&node.height!==undefined)).toBe(true);
    await second.service.run({workflowId:workflow.id,nodeId:'task',operationId:'run-after-resize'});
    await vi.waitFor(async()=>expect((await second.service.get({id:workflow.id})).workflow!.executions!.find(run=>run.runId===before.runId)!.status).toBe('completed'));
    expect(first.native.prompts).toHaveLength(2);
  });
  it('waits behind unknown native outcomes and never treats a failed prerequisite as completed',async()=>{
    for(const unknown of [true,false]){
      const {service,native}=await open();let workflow=await oneTask(service,true);
      const added=await service.save({workflow:{...workflow,nodes:[...workflow.nodes,{id:'next',title:'Next',instruction:'Later task',source:'user',status:'draft',revision:1,position:{x:600,y:100}}],edges:unknown?[]:[{id:'requires',source:'task',target:'next',type:'dependency'}]},expectedRevision:workflow.revision});if(!added.ok)throw new Error('save');
      native.failAfterAdmission=unknown;native.taskTerminalReason='error';const first=service.run({workflowId:workflow.id,nodeId:'task',operationId:'first-outcome'});if(unknown)await first.catch(()=>{});else await first;
      native.failAfterAdmission=false;const clicked=await service.run({workflowId:workflow.id,nodeId:'next',operationId:'waiting-after-outcome'});const run=clicked.workflow.executions!.find(run=>run.runId===clicked.runId)!;expect(run).toMatchObject({status:'waiting',waitingReason:unknown?'branch_busy':'prerequisites'});expect(run.startSeq).toBeUndefined();
      const advance=Reflect.get(service,'advancePolicies') as (id:string)=>Promise<void>;await advance.call(service,workflow.id);await advance.call(service,workflow.id);expect(native.prompts).toHaveLength(1);
    }
  });
  it('uses the latest visible prerequisite request instead of an older success at the same revision',async()=>{
    const {service,native}=await open();let workflow=await oneTask(service,true);
    const saved=await service.save({workflow:{...workflow,nodes:[...workflow.nodes,{id:'next',title:'Next',instruction:'Requires the latest task result',source:'user',status:'draft',revision:1,position:{x:600,y:100}}],edges:[{id:'requires',source:'task',target:'next',type:'dependency'}]},expectedRevision:workflow.revision});if(!saved.ok)throw new Error('save');
    await service.run({workflowId:workflow.id,nodeId:'task',operationId:'old-success'});native.taskTerminalReason='error';await service.run({workflowId:workflow.id,nodeId:'task',operationId:'latest-failed-retry'});
    const waiting=await service.run({workflowId:workflow.id,nodeId:'next',operationId:'wait-for-latest-success'});expect(waiting.workflow.executions!.find(run=>run.runId===waiting.runId)).toMatchObject({status:'waiting',waitingReason:'prerequisites'});
    const advance=Reflect.get(service,'advancePolicies') as (id:string)=>Promise<void>;await advance.call(service,workflow.id);expect(native.prompts).toHaveLength(2);
    native.taskTerminalReason='completed';await service.run({workflowId:workflow.id,nodeId:'task',operationId:'explicit-successful-retry'});
    await vi.waitFor(async()=>expect((await service.get({id:workflow.id})).workflow!.executions!.find(run=>run.runId===waiting.runId)!.status).toBe('completed'));expect(native.prompts).toHaveLength(4);
  });
  it('deduplicates active automatic-path executions from the manual canvas overview for Run and batch Run',async()=>{
    const {service,native}=await open();const workflow=await twoTasks(service);
    const saved=await service.save({workflow:{...workflow,edges:[...workflow.edges,{id:'second-path',source:'task',target:'unselected',type:'dependency'}]},expectedRevision:workflow.revision});if(!saved.ok)throw new Error('save');
    const common=await service.run({workflowId:workflow.id,nodeId:'task',operationId:'active-path-common'});const overview=common.workflow.activeBranchId!;
    const submit=native.submit.bind(native);let heldSession:string|undefined;
    native.isRunning=sessionId=>sessionId===heldSession;
    native.submit=async request=>{
      if(!request.text.includes('Use the latest completed task'))return submit(request);
      heldSession=request.sessionId;native.prompts.push(request);const log=native.logs.get(request.sessionId)!;
      const turn=log.events.filter(event=>event.type==='turn/start').length+1;
      for(const [type,data] of [['turn/start',{turn}],['user/message',{id:request.requestId,source:{kind:'user',rpcId:request.requestId},content:[{type:'text',text:request.text}]}]] as Array<[string,Record<string,unknown>]>)log.events.push({type,data,seq:log.events.length,time:Date.now()});
    };
    const started=await service.run({workflowId:workflow.id,nodeId:'downstream',branchId:overview,operationId:'start-automatic-path'});
    const active=started.workflow.executions!.find(run=>run.runId===started.runId)!;expect(active.branchId).not.toBe(overview);expect(started.workflow.activeBranchId).toBe(overview);expect(active.status).toBe('running');
    const clicked=await service.run({workflowId:workflow.id,nodeId:'downstream',branchId:overview,operationId:'repeat-active-path'});
    const batch=await service.batchRun({workflowId:workflow.id,nodeIds:['downstream'],nodeRevisions:{downstream:1},branchId:overview,operationId:'batch-repeat-active-path'});
    expect(clicked.runId).toBe(started.runId);expect(batch.runIds).toEqual([started.runId]);expect(batch.workflow.executions).toHaveLength(2);expect(native.prompts).toHaveLength(2);
    expect(batch.workflow.branches!.filter(branch=>branch.automatic)).toHaveLength(1);
  });
  it('does not repeat an automatic Fork or submit its task after losing the native child response and restarting',async()=>{
    const first=await open();const workflow=await twoTasks(first.service);
    const saved=await first.service.save({workflow:{...workflow,edges:[...workflow.edges,{id:'second-path',source:'task',target:'unselected',type:'dependency'}]},expectedRevision:workflow.revision});if(!saved.ok)throw new Error('save');
    const common=await first.service.run({workflowId:workflow.id,nodeId:'task',operationId:'fork-loss-common'}),commonRun=common.workflow.executions![0]!;
    const commonBytes=JSON.stringify(await first.native.read(commonRun.sessionId)),sourceBytes=JSON.stringify(await first.native.read('source'));
    const fork=first.native.fork.bind(first.native);first.native.fork=async request=>{await fork(request);throw new Error('Automatic child exists but native response was lost');};
    const args={workflowId:workflow.id,nodeId:'downstream',operationId:'automatic-fork-response-lost'};
    // Either this Run call or the background queue dispatcher can own admission;
    // both must persist the same uncertain Fork without another native attempt.
    await first.service.run(args).catch(error=>expect(String(error)).toMatch(/response was lost/));
    await vi.waitFor(async()=>expect((await first.service.get({id:workflow.id})).workflow!.executions!.find(run=>run.nodeId==='downstream')).toMatchObject({status:'unknown',durability:'needs-reconcile'}));
    const failed=(await first.service.get({id:workflow.id})).workflow!,run=failed.executions!.find(run=>run.nodeId==='downstream')!;
    expect(run).toMatchObject({status:'unknown',durability:'needs-reconcile'});expect(failed.operations!.find(operation=>operation.id===`route-${run.runId}`)).toMatchObject({kind:'fork',status:'needs-reconcile',atSeq:commonRun.endSeq});
    expect(first.native.forks).toHaveLength(2);expect(first.native.prompts).toHaveLength(1);
    expect((await first.service.run(args)).runId).toBe(run.runId);expect(first.native.forks).toHaveLength(2);
    await first.ctx.fiber.dispose();first.native.fork=fork;const second=await open(first.root,first.native);
    const recover=Reflect.get(second.service,'recover') as ()=>Promise<void>;await recover.call(second.service);
    const advance=Reflect.get(second.service,'advancePolicies') as (id:string)=>Promise<void>;await advance.call(second.service,workflow.id);await advance.call(second.service,workflow.id);
    expect((await second.service.run(args)).runId).toBe(run.runId);expect((await second.service.get({id:workflow.id})).workflow!.executions!.find(item=>item.runId===run.runId)).toMatchObject({status:'unknown',durability:'needs-reconcile'});
    expect(first.native.forks).toHaveLength(2);expect(first.native.prompts).toHaveLength(1);expect(JSON.stringify(await first.native.read(commonRun.sessionId))).toBe(commonBytes);expect(JSON.stringify(await first.native.read('source'))).toBe(sourceBytes);
  });
  it('refuses legacy predecessor history already polluted by a sibling path without rewriting native logs',async()=>{
    const first=await open();let workflow=await twoTasks(first.service);
    const saved=await first.service.save({workflow:{...workflow,nodes:[...workflow.nodes,{id:'after-polluted',title:'After polluted',instruction:'Must not inherit its prerequisite sibling',source:'user',status:'draft',revision:1,position:{x:1400,y:100}}],edges:[...workflow.edges,{id:'legacy-sibling',source:'task',target:'unselected',type:'dependency'},{id:'after-legacy-sibling',source:'unselected',target:'after-polluted',type:'dependency'}]},expectedRevision:workflow.revision});if(!saved.ok)throw new Error('save');workflow=saved.workflow;
    // Seed the exact old routing behavior: every request appends to one Session.
    const route=Reflect.get(first.service,'routeQueuedExecution');Reflect.set(first.service,'routeQueuedExecution',async(_workflow:Workflow,run:NonNullable<Workflow['executions']>[number])=>run);
    for(const nodeId of ['task','downstream','unselected'])await first.service.run({workflowId:workflow.id,nodeId,operationId:`legacy-${nodeId}`});Reflect.set(first.service,'routeQueuedExecution',route);
    const legacy=(await first.service.get({id:workflow.id})).workflow!,sessionId=legacy.executions![0]!.sessionId;
    expect(new Set(legacy.executions!.map(run=>run.sessionId)).size).toBe(1);expect(JSON.stringify(await first.native.read(sessionId))).toContain('Use the latest completed task');
    const original=JSON.stringify(await first.native.read(sessionId)),source=JSON.stringify(await first.native.read('source')),forkCount=first.native.forks.length;
    await first.ctx.fiber.dispose();const second=await open(first.root,first.native);
    const requested=await second.service.run({workflowId:workflow.id,nodeId:'after-polluted',operationId:'refuse-polluted-context'}),run=requested.workflow.executions!.find(run=>run.runId===requested.runId)!;
    expect(run).toMatchObject({status:'failed',durability:'durable',terminalReason:'context-isolation-required'});expect(run.error).toContain('已经包含其他任务路径');expect(run.startSeq).toBeUndefined();
    expect(first.native.prompts).toHaveLength(3);expect(first.native.forks).toHaveLength(forkCount);expect(JSON.stringify(await first.native.read(sessionId))).toBe(original);expect(JSON.stringify(await first.native.read('source'))).toBe(source);
    const reconcile=Reflect.get(second.service,'reconcileSession') as (id:string)=>Promise<void>;await reconcile.call(second.service,sessionId);
    expect((await second.service.trace({workflowId:workflow.id,runId:run.runId})).trace).toMatchObject({status:'failed',terminalReason:'context-isolation-required',steps:[]});
  });
  it('keeps automatic sibling paths and their continuation inside an explicit manual history branch',async()=>{
    const {service,native}=await open();const workflow=await twoTasks(service);
    const graph=await service.save({workflow:{...workflow,nodes:[...workflow.nodes,{id:'after-right',title:'After right',instruction:'Continue only the right path',source:'user',status:'draft',revision:1,position:{x:1400,y:350}}],edges:[...workflow.edges,{id:'manual-second-path',source:'task',target:'unselected',type:'dependency'},{id:'manual-right-continuation',source:'unselected',target:'after-right',type:'dependency'}]},expectedRevision:workflow.revision});if(!graph.ok)throw new Error('save');
    const common=await service.run({workflowId:workflow.id,nodeId:'task',operationId:'manual-scope-common'}),commonRun=common.workflow.executions![0]!,m1=common.workflow.branches!.find(branch=>branch.id===commonRun.branchId)!;
    const m1Before=JSON.stringify(await native.read(m1.sessionId));
    const forked=await service.fork({workflowId:workflow.id,runId:commonRun.runId,label:'M2 explicit history',operationId:'manual-scope-m2'}),m2=forked.workflow.branches!.find(branch=>branch.id===forked.branchId)!;
    const left=await service.run({workflowId:workflow.id,nodeId:'downstream',branchId:m2.id,operationId:'manual-m2-left'}),leftRun=left.workflow.executions!.find(run=>run.runId===left.runId)!;expect(leftRun.branchId).toBe(m2.id);expect(leftRun.sessionId).toBe(m2.sessionId);
    const right=await service.run({workflowId:workflow.id,nodeId:'unselected',branchId:m2.id,operationId:'manual-m2-right'}),rightRun=right.workflow.executions!.find(run=>run.runId===right.runId)!,rightBranch=right.workflow.branches!.find(branch=>branch.id===rightRun.branchId)!;
    expect(rightBranch).toMatchObject({automatic:true,parentBranchId:m2.id,sourceSessionId:m2.sessionId,forkBoundarySeq:commonRun.endSeq});expect(rightRun.sessionId).not.toBe(m2.sessionId);expect(right.workflow.activeBranchId).toBe(m2.id);
    const continued=await service.run({workflowId:workflow.id,nodeId:'after-right',branchId:m2.id,operationId:'manual-m2-right-continuation'}),last=continued.workflow.executions!.find(run=>run.runId===continued.runId)!;
    expect(last).toMatchObject({status:'completed',branchId:rightBranch.id,sessionId:rightRun.sessionId});expect(continued.workflow.activeBranchId).toBe(m2.id);
    const rightText=JSON.stringify(await native.read(rightRun.sessionId));expect(rightText).toContain('Continue only the right path');expect(rightText).not.toContain('Use the latest completed task');
    expect(JSON.stringify(await native.read(m1.sessionId))).toBe(m1Before);expect(native.prompts).toHaveLength(4);
  });
  it('revalidates a durably prepared automatic child after restart before rebinding its waiting execution',async()=>{
    const first=await open();const workflow=await twoTasks(first.service);
    const graph=await first.service.save({workflow:{...workflow,edges:[...workflow.edges,{id:'prepared-second-path',source:'task',target:'unselected',type:'dependency'}]},expectedRevision:workflow.revision});if(!graph.ok)throw new Error('save');
    const common=await first.service.run({workflowId:workflow.id,nodeId:'task',operationId:'prepared-common'}),commonRun=common.workflow.executions![0]!;
    const original=JSON.stringify(await first.native.read(commonRun.sessionId)),source=JSON.stringify(await first.native.read('source'));
    type Branch=NonNullable<Workflow['branches']>[number];let child:Branch|undefined;
    const prepare=Reflect.get(first.service,'forkQueuedContext') as (...args:unknown[])=>Promise<Branch>;
    Reflect.set(first.service,'forkQueuedContext',async(...args:unknown[])=>{
      child=await prepare.apply(first.service,args);
      // Crash after the Fork intent+child are durable, before Execution rebinding.
      Reflect.set(first.service,'stopped',true);throw new Error('Simulated crash before automatic execution rebind');
    });
    await first.service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'prepared-before-crash'}).catch(error=>expect(String(error)).toMatch(/Simulated crash/));
    const prepared=(await first.service.get({id:workflow.id})).workflow!,waiting=prepared.executions!.find(run=>run.nodeId==='downstream')!;
    expect(child).toBeDefined();expect(waiting).toMatchObject({status:'waiting',branchId:commonRun.branchId,sessionId:commonRun.sessionId});expect(prepared.operations!.find(operation=>operation.id===`route-${waiting.runId}`)).toMatchObject({status:'completed',childSessionId:child!.sessionId});
    await first.native.submit({sessionId:child!.sessionId,requestId:'foreign-prepared-chat',text:'FOREIGN_PREPARED_SESSION_CONTEXT'});
    const childBytes=JSON.stringify(await first.native.read(child!.sessionId)),forks=first.native.forks.length,prompts=first.native.prompts.length;
    await first.ctx.fiber.dispose();const second=await open(first.root,first.native);
    const recover=Reflect.get(second.service,'recover') as ()=>Promise<void>;await recover.call(second.service);
    const advance=Reflect.get(second.service,'advancePolicies') as (id:string)=>Promise<void>;await advance.call(second.service,workflow.id);
    const rejected=(await second.service.get({id:workflow.id})).workflow!.executions!.find(run=>run.runId===waiting.runId)!;
    expect(rejected).toMatchObject({status:'failed',durability:'durable',terminalReason:'context-isolation-required'});expect(rejected.error).toContain('已准备的分支会话内容发生变化');expect(rejected.startSeq).toBeUndefined();
    expect(first.native.forks).toHaveLength(forks);expect(first.native.prompts).toHaveLength(prompts);expect(JSON.stringify(await first.native.read(child!.sessionId))).toBe(childBytes);expect(JSON.stringify(await first.native.read(commonRun.sessionId))).toBe(original);expect(JSON.stringify(await first.native.read('source'))).toBe(source);
    expect((await second.service.trace({workflowId:workflow.id,runId:waiting.runId})).trace).toMatchObject({status:'failed',steps:[]});
  });
  it('isolates foreign native chat after a predecessor, rejects foreign input inside it, and permits native control notices',async()=>{
    for(const injection of ['after','before','native-notices'] as const){
      const {service,native}=await open();const workflow=await twoTasks(service),submit=native.submit.bind(native);
      if(injection!=='after')native.submit=async request=>{
        await submit(request);if(!request.text.startsWith('Task: Task\n'))return;
        const log=native.logs.get(request.sessionId)!,end=log.events.at(-1)!;
        const sources=injection==='before'?['user']:['model-selection','runtime-context','tool-registry','skill-catalog','time-context'];
        const notices=sources.map((kind,index)=>({type:'user/message',seq:end.seq+index,time:Date.now(),data:{id:`injected-${kind}`,source:{kind,...(kind==='user'?{rpcId:'foreign-inside-predecessor'}:{})},content:[{type:'text',text:kind==='user'?'FOREIGN_INSIDE_PREDECESSOR_CONTEXT':`Native ${kind} control notice`}]}}));
        log.events.splice(log.events.length-1,0,...notices);log.events.forEach((event,index)=>{event.seq=index;});
      };
      const common=await service.run({workflowId:workflow.id,nodeId:'task',operationId:`native-chat-common-${injection}`}),commonRun=common.workflow.executions![0]!;
      if(injection==='after')await native.submit({sessionId:commonRun.sessionId,requestId:'foreign-after-predecessor',text:'FOREIGN_AFTER_PREDECESSOR_CONTEXT'});
      const original=JSON.stringify(await native.read(commonRun.sessionId)),source=JSON.stringify(await native.read('source')),forks=native.forks.length,prompts=native.prompts.length;
      const result=await service.run({workflowId:workflow.id,nodeId:'downstream',operationId:`native-chat-child-${injection}`}),run=result.workflow.executions!.find(run=>run.runId===result.runId)!;
      if(injection==='before'){
        expect(run).toMatchObject({status:'failed',durability:'durable',terminalReason:'context-isolation-required'});expect(run.error).toContain('已经包含其他任务路径');expect(run.startSeq).toBeUndefined();expect(native.prompts).toHaveLength(prompts);expect(native.forks).toHaveLength(forks);expect(JSON.stringify(await native.read(commonRun.sessionId))).toBe(original);
      }else{
        expect(run.status).toBe('completed');expect(native.prompts).toHaveLength(prompts+1);
        if(injection==='after'){
          expect(run.sessionId).not.toBe(commonRun.sessionId);expect(native.forks).toHaveLength(forks+1);expect(native.forks.at(-1)).toEqual({sessionId:commonRun.sessionId,atSeq:commonRun.endSeq});expect(JSON.stringify(await native.read(run.sessionId))).not.toContain('FOREIGN_AFTER_PREDECESSOR_CONTEXT');expect(JSON.stringify(await native.read(commonRun.sessionId))).toBe(original);
        }else{expect(run.sessionId).toBe(commonRun.sessionId);expect(native.forks).toHaveLength(forks);}
      }
      expect(JSON.stringify(await native.read('source'))).toBe(source);
    }
  });
  it('follows the replacement automatic branch when rerunning a selected path without inheriting its previous attempt',async()=>{
    const {service,native}=await open();const workflow=await twoTasks(service);
    const graph=await service.save({workflow:{...workflow,edges:[...workflow.edges,{id:'rerun-second-path',source:'task',target:'unselected',type:'dependency'}]},expectedRevision:workflow.revision});if(!graph.ok)throw new Error('save');
    const common=await service.run({workflowId:workflow.id,nodeId:'task',operationId:'rerun-path-common'}),commonRun=common.workflow.executions![0]!;
    const first=await service.run({workflowId:workflow.id,nodeId:'downstream',operationId:'first-path-attempt'}),firstRun=first.workflow.executions!.find(run=>run.runId===first.runId)!;
    const sibling=await service.run({workflowId:workflow.id,nodeId:'unselected',operationId:'rerun-path-sibling'}),siblingRun=sibling.workflow.executions!.find(run=>run.runId===sibling.runId)!;
    expect(sibling.workflow.activeBranchId).toBe(commonRun.branchId);expect(firstRun.branchId).not.toBe(commonRun.branchId);
    const firstBytes=JSON.stringify(await native.read(firstRun.sessionId)),siblingBytes=JSON.stringify(await native.read(siblingRun.sessionId));
    const selected=await service.save({workflow:{...sibling.workflow,activeBranchId:firstRun.branchId},expectedRevision:sibling.workflow.revision});if(!selected.ok)throw new Error('save');
    const rerun=await service.run({workflowId:workflow.id,nodeId:'downstream',branchId:firstRun.branchId,operationId:'rerun-selected-automatic-path'}),run=rerun.workflow.executions!.find(run=>run.runId===rerun.runId)!;
    expect(run.status).toBe('completed');expect(run.sessionId).not.toBe(firstRun.sessionId);expect(run.branchId).not.toBe(firstRun.branchId);expect(rerun.workflow.activeBranchId).toBe(run.branchId);
    expect(rerun.workflow.branches!.find(branch=>branch.id===run.branchId)).toMatchObject({automatic:true,parentBranchId:firstRun.branchId,sourceSessionId:firstRun.sessionId,forkBoundarySeq:commonRun.endSeq});
    const log=await native.read(run.sessionId);expect(log.header.parentSession).toBe(firstRun.sessionId);expect(log.inheritedEventCount).toBe(commonRun.endSeq!+1);
    const requestIds=log.events.filter(event=>event.type==='user/message').map(event=>(event.data.source as {rpcId?:string}|undefined)?.rpcId);
    expect(requestIds).toContain(commonRun.requestId);expect(requestIds).toContain(run.requestId);expect(requestIds).not.toContain(firstRun.requestId);expect(requestIds).not.toContain(siblingRun.requestId);
    expect(JSON.stringify(log)).not.toContain('Do not run automatically');expect(JSON.stringify(await native.read(firstRun.sessionId))).toBe(firstBytes);expect(JSON.stringify(await native.read(siblingRun.sessionId))).toBe(siblingBytes);expect(native.prompts).toHaveLength(4);
  });
  it('joins isolated sibling results without truncation or reasoning, continues and preserves historical inputs while current reruns become stale',async()=>{
    const {service,native,root}=await open(),outputs=installDiamondResults(native),workflow=await diamondTasks(service);
    const ready=await runDiamondPrerequisites(service,workflow.id),overview=ready.activeBranchId!;
    const upstream=ready.executions!,left=upstream.find(run=>run.nodeId==='left')!,right=upstream.find(run=>run.nodeId==='right')!;
    expect(left.sessionId).not.toBe(right.sessionId);expect(left.summary).not.toContain('FULL_LEFT_RESULT_TAIL');
    const before=new Map(await Promise.all(['source',...upstream.map(run=>run.sessionId)].map(async id=>[id,JSON.stringify(await native.read(id))] as const)));
    const result=await service.run({workflowId:workflow.id,nodeId:'joined',operationId:'diamond-join'}),joined=result.workflow.executions!.find(run=>run.runId===result.runId)!;
    expect(joined).toMatchObject({status:'completed',durability:'durable',inputRunIds:[left.runId,right.runId]});
    expect(new Set(joined.resultInputs!.map(input=>input.runId))).toEqual(new Set(upstream.map(run=>run.runId)));
    expect(upstream.some(run=>run.sessionId===joined.sessionId)).toBe(false);
    const prompt=native.prompts.find(prompt=>prompt.requestId===joined.requestId)!,records=resultRecords(prompt.text);
    expect(records.map(record=>record.source.nodeId)).toEqual(['task','left','right']);
    expect(records.find(record=>record.source.nodeId==='left')!.result).toBe(outputs.left);
    expect(records.find(record=>record.source.nodeId==='right')!.result).toBe(outputs.right);
    expect(prompt.text.split(outputs.Task!).length-1).toBe(1);
    expect(prompt.text).not.toContain('PRIVATE_REASONING_MUST_NOT_ENTER_JOIN');expect(prompt.text).not.toContain('Recorded command output');
    for(const [id,bytes] of before)expect(JSON.stringify(await native.read(id))).toBe(bytes);
    expect(await readFile(join(root,'visual_workflow.json'),'utf8')).not.toContain('FULL_LEFT_RESULT_TAIL');
    const afterResult=await service.run({workflowId:workflow.id,nodeId:'after',operationId:'diamond-continue'}),after=afterResult.workflow.executions!.find(run=>run.runId===afterResult.runId)!;
    expect(after).toMatchObject({status:'completed',sessionId:joined.sessionId,inputRunIds:[joined.runId]});expect(after.resultInputs).toBeUndefined();
    const history=await service.fork({workflowId:workflow.id,runId:joined.runId,label:'Historical join',operationId:'diamond-history'}),historical=history.workflow.branches!.find(branch=>branch.id===history.branchId)!;
    expect(historical.nodeIds).toEqual(expect.arrayContaining(['task','left','right','joined']));
    const historicLog=await native.read(historical.sessionId);expect(historicLog.events.some(event=>event.type==='user/message'&&(event.data.source as {rpcId?:string}|undefined)?.rpcId===joined.requestId)).toBe(true);
    expect(JSON.stringify(historicLog)).toContain('FULL_LEFT_RESULT_TAIL');
    const rerun=await service.run({workflowId:workflow.id,nodeId:'left',branchId:overview,operationId:'diamond-left-new-attempt'}),newLeft=rerun.workflow.executions!.find(run=>run.runId===rerun.runId)!;
    expect(newLeft.status).toBe('completed');expect(newLeft.runId).not.toBe(left.runId);
    const selected=await service.save({workflow:{...rerun.workflow,activeBranchId:overview},expectedRevision:rerun.workflow.revision});if(!selected.ok)throw new Error('save conflict');
    expect(selected.workflow.nodes.find(node=>node.id==='joined')!.resultStale).toBe(true);expect(selected.workflow.nodes.find(node=>node.id==='after')!.resultStale).toBe(true);
    const historicalContinuation=await service.run({workflowId:workflow.id,nodeId:'after',branchId:historical.id,operationId:'diamond-historical-after-rerun'});
    expect(historicalContinuation.workflow.executions!.find(run=>run.runId===historicalContinuation.runId)!.status).toBe('completed');
    expect(JSON.stringify(await native.read(left.sessionId))).toBe(before.get(left.sessionId));expect(JSON.stringify(await native.read(right.sessionId))).toBe(before.get(right.sessionId));expect(JSON.stringify(await native.read('source'))).toBe(before.get('source'));
  });
  it('supports nested joins with unique exact upstream result identities instead of duplicated shared histories',async()=>{
    const {service,native}=await open();installDiamondResults(native);const workflow=await diamondTasks(service);
    await runDiamondPrerequisites(service,workflow.id);await service.run({workflowId:workflow.id,nodeId:'joined',operationId:'nested-first-join'});
    const current=(await service.get({id:workflow.id})).workflow!;
    const saved=await service.save({workflow:{...current,nodes:[...current.nodes,...['other','nested'].map((id,index)=>({id,title:id,instruction:`Execute ${id}`,source:'user' as const,status:'draft' as const,revision:1,position:{x:1800,y:index*300}}))],edges:[...current.edges,{id:'nested-joined',source:'joined',target:'nested',type:'dependency'},{id:'nested-other',source:'other',target:'nested',type:'dependency'}]},expectedRevision:current.revision});if(!saved.ok)throw new Error('save conflict');
    await service.run({workflowId:workflow.id,nodeId:'other',operationId:'nested-other'});
    const result=await service.run({workflowId:workflow.id,nodeId:'nested',operationId:'nested-second-join'}),run=result.workflow.executions!.find(run=>run.runId===result.runId)!;
    expect(run.status).toBe('completed');expect(run.resultInputs).toHaveLength(5);
    expect(new Set(run.resultInputs!.map(input=>input.runId)).size).toBe(5);
    const records=resultRecords(native.prompts.find(prompt=>prompt.requestId===run.requestId)!.text);
    expect(new Set(records.map(record=>record.source.nodeId))).toEqual(new Set(['task','left','right','joined','other']));
    expect(records.filter(record=>record.source.nodeId==='task')).toHaveLength(1);expect(result.workflow.nodes.find(node=>node.id==='nested')!.resultStale).toBeUndefined();
  });
  it('does not recreate or submit a join after losing its native empty Session creation response and restarting',async()=>{
    const first=await open();installDiamondResults(first.native);const workflow=await diamondTasks(first.service,false);await runDiamondPrerequisites(first.service,workflow.id);
    const native=first.native,create=native.create.bind(native),promptCount=native.prompts.length,sessionCount=native.logs.size;let creates=0;
    native.create=async options=>{creates++;await create(options);throw new Error('Join Session exists but create response was lost');};
    const args={workflowId:workflow.id,nodeId:'joined',operationId:'join-create-response-lost'};
    await first.service.run(args).catch(error=>expect(String(error)).toContain('response was lost'));
    await vi.waitFor(async()=>expect((await first.service.get({id:workflow.id})).workflow!.executions!.find(run=>run.nodeId==='joined')).toMatchObject({status:'unknown',durability:'needs-reconcile'}));
    const uncertain=(await first.service.get({id:workflow.id})).workflow!,run=uncertain.executions!.find(run=>run.nodeId==='joined')!;
    expect(uncertain.operations!.find(operation=>operation.id===`route-${run.runId}`)).toMatchObject({status:'needs-reconcile'});expect(creates).toBe(1);expect(native.logs.size).toBe(sessionCount+1);expect(native.prompts).toHaveLength(promptCount);
    await first.ctx.fiber.dispose();native.create=create;const second=await open(first.root,native);
    await (Reflect.get(second.service,'recover') as ()=>Promise<void>).call(second.service);
    await (Reflect.get(second.service,'advancePolicies') as (id:string)=>Promise<void>).call(second.service,workflow.id);
    expect((await second.service.run(args)).runId).toBe(run.runId);expect(native.logs.size).toBe(sessionCount+1);expect(native.prompts).toHaveLength(promptCount);
    expect((await second.service.get({id:workflow.id})).workflow!.executions!.find(item=>item.runId===run.runId)).toMatchObject({status:'unknown',durability:'needs-reconcile'});
  });
  it('rejects foreign native chat added to a durable prepared join instead of inheriting it after restart',async()=>{
    const first=await open();installDiamondResults(first.native);const workflow=await diamondTasks(first.service,false);await runDiamondPrerequisites(first.service,workflow.id);
    type Branch=NonNullable<Workflow['branches']>[number];let child:Branch|undefined;
    const prepare=Reflect.get(first.service,'forkQueuedContext') as (...args:unknown[])=>Promise<Branch>;
    Reflect.set(first.service,'forkQueuedContext',async(...args:unknown[])=>{child=await prepare.apply(first.service,args);Reflect.set(first.service,'stopped',true);throw new Error('Simulated join crash before binding');});
    await first.service.run({workflowId:workflow.id,nodeId:'joined',operationId:'join-prepared-before-crash'}).catch(error=>expect(String(error)).toContain('Simulated join crash'));
    const prepared=(await first.service.get({id:workflow.id})).workflow!,waiting=prepared.executions!.find(run=>run.nodeId==='joined')!;
    expect(waiting.status).toBe('waiting');expect(child).toBeDefined();expect(prepared.operations!.find(operation=>operation.id===`route-${waiting.runId}`)).toMatchObject({status:'completed',childSessionId:child!.sessionId});
    await first.native.submit({sessionId:child!.sessionId,requestId:'foreign-join-chat',text:'FOREIGN_JOIN_CONTEXT'});
    const bytes=JSON.stringify(await first.native.read(child!.sessionId)),prompts=first.native.prompts.length,sessions=first.native.logs.size;
    await first.ctx.fiber.dispose();const second=await open(first.root,first.native);
    await (Reflect.get(second.service,'recover') as ()=>Promise<void>).call(second.service);
    await (Reflect.get(second.service,'advancePolicies') as (id:string)=>Promise<void>).call(second.service,workflow.id);
    const rejected=(await second.service.get({id:workflow.id})).workflow!.executions!.find(run=>run.runId===waiting.runId)!;
    expect(rejected).toMatchObject({status:'failed',durability:'durable',terminalReason:'context-isolation-required'});expect(rejected.error).toContain('汇合会话内容发生变化');expect(rejected.startSeq).toBeUndefined();
    expect(first.native.prompts).toHaveLength(prompts);expect(first.native.logs.size).toBe(sessions);expect(JSON.stringify(await first.native.read(child!.sessionId))).toBe(bytes);
  });
  it('revalidates the original overview after a prepared join restarts and refuses its obsolete sibling result snapshot',async()=>{
    const first=await open();installDiamondResults(first.native);const workflow=await diamondTasks(first.service,false),ready=await runDiamondPrerequisites(first.service,workflow.id),overview=ready.activeBranchId!;
    const route=Reflect.get(first.service,'routeQueuedExecution') as (...args:unknown[])=>Promise<NonNullable<Workflow['executions']>[number]>;
    Reflect.set(first.service,'routeQueuedExecution',async(...args:unknown[])=>{const run=await route.apply(first.service,args);if(run.nodeId==='joined'){Reflect.set(first.service,'stopped',true);}return run;});
    const requested=await first.service.run({workflowId:workflow.id,nodeId:'joined',operationId:'join-rebound-before-crash'}),prepared=requested.workflow.executions!.find(run=>run.runId===requested.runId)!;
    expect(prepared).toMatchObject({status:'waiting',resultInputBranchId:overview});expect(prepared.resultInputs).toHaveLength(3);expect(prepared.branchId).not.toBe(overview);expect(prepared.startSeq).toBeUndefined();
    expect(first.native.prompts).toHaveLength(3);const preparedSession=JSON.stringify(await first.native.read(prepared.sessionId));
    await first.ctx.fiber.dispose();
    const native=first.native;native.isRunning=id=>id===prepared.sessionId;
    const second=await open(first.root,native);await (Reflect.get(second.service,'recover') as ()=>Promise<void>).call(second.service);
    // Hold only this prepared Session busy while a real new sibling execution
    // completes in the overview; no execution metadata is manufactured.
    const rerun=await second.service.run({workflowId:workflow.id,nodeId:'left',branchId:overview,operationId:'join-restart-new-left'}),left=rerun.workflow.executions!.find(run=>run.runId===rerun.runId)!;
    expect(left.status).toBe('completed');expect(prepared.resultInputs!.some(input=>input.runId===left.runId)).toBe(false);
    const prompts=native.prompts.length,sessions=native.logs.size;native.isRunning=()=>false;
    await (Reflect.get(second.service,'advancePolicies') as (id:string)=>Promise<void>).call(second.service,workflow.id);
    const rejected=(await second.service.get({id:workflow.id})).workflow!.executions!.find(run=>run.runId===prepared.runId)!;
    expect(rejected).toMatchObject({status:'failed',durability:'durable',terminalReason:'dependency-results-unavailable'});expect(rejected.error).toContain('已准备的汇合输入不一致');expect(rejected.startSeq).toBeUndefined();
    expect(native.prompts).toHaveLength(prompts);expect(native.logs.size).toBe(sessions);expect(JSON.stringify(await native.read(prepared.sessionId))).toBe(preparedSession);
  });
  it('restores an uncertain pre-submit crash as unknown without pretending that native execution started',async()=>{
    const first=await open();const workflow=await oneTask(first.service,true);let reached!:()=>void;const entered=new Promise<void>(resolve=>{reached=resolve;});
    const submit=first.native.submit.bind(first.native);
    first.native.submit=async()=>{reached();await new Promise<void>(()=>{});};
    void first.service.run({workflowId:workflow.id,nodeId:'task',operationId:'crash-before-native-submit'}).catch(()=>{});await entered;
    const preparing=(await first.service.get({id:workflow.id})).workflow!;expect(preparing.executions![0]!.status).toBe('ready');expect(preparing.operations![0]!.status).toBe('pending');expect(first.native.prompts).toHaveLength(0);
    await first.ctx.fiber.dispose();first.native.submit=submit;const second=await open(first.root,first.native);
    const recover=Reflect.get(second.service,'recover') as ()=>Promise<void>;await recover.call(second.service);
    const restored=(await second.service.get({id:workflow.id})).workflow!;const run=restored.executions![0]!;expect(run).toMatchObject({status:'unknown',durability:'needs-reconcile',turns:[]});expect(restored.operations![0]!.status).toBe('needs-reconcile');
    const reconcile=Reflect.get(second.service,'reconcileSession') as (sessionId:string)=>Promise<void>;await reconcile.call(second.service,run.sessionId);await reconcile.call(second.service,run.sessionId);
    expect((await second.service.trace({workflowId:workflow.id,runId:run.runId})).trace).toMatchObject({status:'unknown',steps:[]});
    await second.service.cancel({workflowId:workflow.id,runId:run.runId});await second.service.run({workflowId:workflow.id,nodeId:'task',operationId:'crash-before-native-submit'});
    expect((await second.service.get({id:workflow.id})).workflow!.executions![0]).toMatchObject({status:'unknown',durability:'needs-reconcile'});expect(first.native.prompts).toHaveLength(0);
  });
});
