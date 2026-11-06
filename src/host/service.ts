/** Native-backed workflow metadata. Existing source Sessions are immutable references. */
import { createHash, randomUUID } from 'node:crypto';
import { Context, Service } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import type { KvTable } from '@deepseek-ai/dsh-storage-domain';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z, type ZodType } from 'zod';
import type * as M from '../shared/model.ts';
import { graphProblem, WORKFLOW_API_VERSION, WORKFLOW_PLUGIN_VERSION } from '../shared/model.ts';
import { placeNewDependencyNodes } from '../shared/layout.ts';
import * as V from './validation.ts';
import { DshNativeRuntime, completedBoundary, type NativeRuntime, type NativeSessionLog } from './native-runtime.ts';
import { assistantTextForRequest, projectExecution, readTraceStepDetails, type NativeExecutionProjection, type NativeExecutionStatus } from './trace-projector.ts';
import { updateWorkflowMetadata } from './storage-retry.ts';
import { buildPlanningInstruction } from './planning.ts';
import { assignNodeNumbers, branchCaption, nativeSessionCaption, taskCaption } from './workflow-identity.ts';
import { NativeControls } from './native-controls.ts';
import { NativeWorkspaces } from './native-workspaces.ts';
import { NativeContextControls, NativeContextError } from './native-context.ts';
import { NativeSkillCatalog } from './native-skills.ts';
import { verifiedCompactionCheckpoints, compactionContinuationBoundary } from './compaction-history.ts';
import { recommendedAnswers } from './question-automation.ts';
export type * from '../shared/model.ts';

const initialLayout: M.CatalogLayout = { revision:0,positions:{},viewport:{x:0,y:0,zoom:1} };
// Unit version remains 1: the additive table set and union record schema can
// read every Phase 1 document. Conversion is backed up before schemaVersion 2.
const workflowDomainSpec=defineDomain({name:'visual_workflow',version:1,layout:'single',tables:{
  workflows:domainTable<string,M.Workflow>(V.workflowSchema),
  legacy_backup:domainTable<string,M.Workflow>(V.workflowSchema),
  catalog_layout:domainTable<string,M.CatalogLayout>(V.catalogLayoutSchema),
}});
class RevisionConflict extends Error { constructor(readonly workflow:M.Workflow){super('workflow revision conflict');} }
function parse<T>(schema:ZodType<T>,input:unknown):T{
  const result=schema.safeParse(input);
  if(!result.success)throw new RemoteError('gateway/bad-request',`Invalid workflow data: ${result.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; ')}`,{});
  return result.data;
}
function fail(message:string):never{throw new RemoteError('gateway/bad-request',message,{});}
const clone=<T>(value:T):T=>structuredClone(value);
const uid=(prefix:string)=>`${prefix}-${randomUUID()}`;
const err=(error:unknown)=>String(error instanceof Error?error.message:error).slice(0,4000);
/** References protect shared history even when the referring canvas is archived. */
function sessionReferences(workflow:M.Workflow):Set<string>{
  return new Set([workflow.sourceSessionId,workflow.uploadSessionId,...workflow.nodes.map(node=>node.sourceSessionId),
    ...workflow.branches?.flatMap(branch=>[branch.sessionId,branch.sourceSessionId])??[],
    ...workflow.executions?.flatMap(run=>[run.sessionId,run.subagent?.parentSessionId])??[],
    ...workflow.plans?.map(plan=>plan.sessionId)??[],...workflow.operations?.flatMap(operation=>[operation.sourceSessionId,operation.childSessionId])??[],
    ...workflow.utilityNodes?.flatMap(node=>[node.sessionId,node.terminal?.sessionId])??[]].filter((id):id is string=>Boolean(id)));
}
/** These identities are minted by Host orchestration, never copied from a browser draft. */
function ownedSessionIds(workflow:M.Workflow):Set<string>{
  return new Set([workflow.uploadSessionId,...workflow.branches?.map(branch=>branch.sessionId)??[],
    ...workflow.executions?.flatMap(run=>[run.sessionId,run.subagent?.parentSessionId])??[],
    ...workflow.plans?.map(plan=>plan.sessionId)??[],...workflow.operations?.map(operation=>operation.childSessionId)??[]].filter((id):id is string=>Boolean(id)));
}
const nativeStatus=(value:NativeExecutionStatus):M.WorkflowStatus=>value==='queued'?'ready':value==='waiting_approval'?'blocked':value;
function normalized(workflow:M.Workflow):M.Workflow{
  return assignNodeNumbers({...workflow,schemaVersion:2,branches:workflow.branches??[],executions:workflow.executions??[],approvals:workflow.approvals??[],plans:workflow.plans??[],operations:workflow.operations??[],settings:workflow.settings??{generation:'suggest',execution:'approval'}});
}
function dependencies(workflow:M.Workflow,nodeId:string):string[]{return workflow.edges.filter(edge=>edge.target===nodeId).map(edge=>edge.source).sort();}
function ancestorIds(workflow:M.Workflow,nodeId:string):string[]{
  const seen=new Set<string>(),pending=[nodeId];
  while(pending.length)for(const id of dependencies(workflow,pending.pop()!))if(!seen.has(id)){seen.add(id);pending.push(id);}
  return [...seen].sort();
}
function attachmentIdentity(items:M.WorkflowNodeAttachment[]|undefined):unknown{return (items??[]).map(item=>({id:item.id,file:item.file})).sort((a,b)=>a.id.localeCompare(b.id));}
function knownAttachments(workflow:M.Workflow):M.WorkflowNodeAttachment[]{
  const known=new Map<string,M.WorkflowNodeAttachment>();
  for(const item of [...workflow.attachmentReferences??[],...workflow.planningAttachments??[],...workflow.plans?.flatMap(plan=>plan.attachments??[])??[],...workflow.nodes.flatMap(node=>[...node.attachments??[],...node.revisions?.flatMap(revision=>revision.attachments??[])??[]])])known.set(item.id,item);
  return [...known.values()];
}
function retainedAttachments(workflow:M.Workflow,old:Pick<M.WorkflowNode,'attachments'>|undefined,incoming:M.WorkflowNodeAttachment[]|undefined):M.WorkflowNodeAttachment[]|undefined{
  if(incoming===undefined)return old?.attachments;
  const known=knownAttachments(workflow);
  return incoming.map(item=>{const verified=known.find(candidate=>candidate.id===item.id);if(!verified||JSON.stringify(verified)!==JSON.stringify(item))fail('Attachments must be exact native-verified references already owned by this workflow');return verified;});
}
function authorizationSettings(settings:M.WorkflowSettings|undefined):Omit<M.WorkflowSettings,'modelReasoning'>|undefined{
  if(!settings)return undefined;const {modelReasoning:_futurePreferences,...policies}=settings;return policies;
}
function fingerprint(workflow:M.Workflow,node:M.WorkflowNode,resolvedModel?:M.WorkflowModelIdentity):string{
  return createHash('sha256').update(JSON.stringify({id:node.id,revision:node.revision,title:node.title,instruction:node.instruction,model:node.model,resolvedModel,attachments:attachmentIdentity(node.attachments),dependencies:ancestorIds(workflow,node.id).map(id=>({id,revision:workflow.nodes.find(candidate=>candidate.id===id)?.revision})),settings:authorizationSettings(workflow.settings)})).digest('hex');
}
function revisions(node:M.WorkflowNode,workflow:M.Workflow):M.NodeRevision[]{return node.revisions?.length?node.revisions:[{revision:node.revision,title:node.title,instruction:node.instruction,dependencies:dependencies(workflow,node.id),createdAt:workflow.createdAt,attachments:node.attachments,model:node.model}];}
function activeExecution(run:M.Execution):boolean{return ['running','ready','waiting_answer'].includes(run.status)||run.status==='blocked'&&run.endSeq===undefined;}
function localQueueRecord(run:M.Execution):boolean{return run.status==='waiting'||run.terminalReason==='queue-cancelled'||run.terminalReason==='authorization-invalidated'||run.terminalReason==='context-isolation-required'||run.terminalReason==='workflow-deleted'||run.terminalReason==='workflow-paused';}
function queueAuthorized(workflow:M.Workflow,run:M.Execution):boolean{
  const node=workflow.nodes.find(item=>item.id===run.nodeId);
  return !!node&&!!run.resolvedModel&&node.revision===run.nodeRevision&&run.authorizationFingerprint===fingerprint(workflow,node,run.resolvedModel)&&workflow.approvals!.some(approval=>approval.nodeId===node.id&&approval.nodeRevision===node.revision&&approval.decision==='approved'&&approval.fingerprint===run.authorizationFingerprint);
}
function invalidateQueue(workflow:M.Workflow):M.Workflow{
  const executions=workflow.executions!.map(run=>run.status==='waiting'&&!queueAuthorized(workflow,run)?{...run,status:'cancelled' as const,terminalReason:'authorization-invalidated',error:'The queued task, its prerequisites, or its execution policies changed. Click Run again to authorize the current version.',updatedAt:Date.now()}:run);
  const next={...workflow,executions};return {...next,nodes:projectNodes(next)};
}
function manualScope(workflow:M.Workflow,branch:M.Branch):M.Branch{
  const seen=new Set<string>();let current=branch;
  while(current.automatic&&current.parentBranchId&&!seen.has(current.id)){
    seen.add(current.id);const parent=workflow.branches!.find(item=>item.id===current.parentBranchId);if(!parent)break;current=parent;
  }
  return current;
}
/** Physical prefix containment; canvas visibility alone never proves context inheritance. */
function historyContains(workflow:M.Workflow,run:M.Execution,branch:M.Branch,boundary=Infinity):boolean{
  if(run.endSeq===undefined)return false;
  const seen=new Set<string>();let current:M.Branch|undefined=branch,cap=boundary;
  while(current&&!seen.has(current.id)){
    seen.add(current.id);
    if(current.sessionId===run.sessionId)return run.endSeq<=cap;
    if(!current.parentBranchId||current.forkBoundarySeq===undefined)return false;
    const parent=workflow.branches!.find(item=>item.id===current!.parentBranchId);
    if(!parent||current.sourceSessionId!==parent.sessionId)return false;
    cap=Math.min(cap,current.forkBoundarySeq);current=parent;
  }
  return false;
}
function runVisible(workflow:M.Workflow,run:M.Execution,branch:M.Branch):boolean{
  if(run.branchId===branch.id)return true;
  const owner=workflow.branches!.find(item=>item.id===run.branchId);
  if(!branch.automatic&&owner?.automatic&&manualScope(workflow,owner).id===branch.id)return true;
  return branch.nodeIds.includes(run.nodeId)&&historyContains(workflow,run,branch);
}
/** Completion is historical; eligibility also requires current upstream inputs.
 * Evaluate against the requested view so an explicit historical fork can retain
 * its old prefix while the manual overview follows its latest executions. */
function contextCheck(workflow:M.Workflow,branch:M.Branch|undefined){
  const nodes=new Map(workflow.nodes.map(node=>[node.id,node]));
  const latestByNode=new Map<string,M.Execution|undefined>(),validity=new Map<string,boolean>(),checking=new Set<string>();
  const latest=(nodeId:string):M.Execution|undefined=>{
    if(!latestByNode.has(nodeId))latestByNode.set(nodeId,workflow.executions!.findLast(run=>run.nodeId===nodeId&&run.nodeRevision===nodes.get(nodeId)?.revision&&!!branch&&runVisible(workflow,run,branch)));
    return latestByNode.get(nodeId);
  };
  const inputs=(nodeId:string):M.Execution[]=>dependencies(workflow,nodeId).filter(id=>nodes.get(id)?.kind!=='session').flatMap(id=>{const run=latest(id);return run?[run]:[];});
  const current=(run:M.Execution):boolean=>{
    if(validity.has(run.runId))return validity.get(run.runId)!;
    if(checking.has(run.runId)||run.status!=='completed'||run.durability!=='durable'||run.endSeq===undefined||run.nodeRevision!==nodes.get(run.nodeId)?.revision)return false;
    const owner=workflow.branches!.find(item=>item.id===run.branchId);if(!owner)return false;
    checking.add(run.runId);
    const valid=dependencies(workflow,run.nodeId).every(id=>{
      if(nodes.get(id)?.kind==='session')return true;
      const required=latest(id);
      return !!required&&(!run.inputRunIds||run.inputRunIds.includes(required.runId))&&historyContains(workflow,required,owner,run.endSeq)&&current(required);
    });
    checking.delete(run.runId);validity.set(run.runId,valid);return valid;
  };
  const ready=(nodeId:string)=>dependencies(workflow,nodeId).every(id=>nodes.get(id)?.kind==='session'||!!latest(id)&&current(latest(id)!));
  const stale=(nodeId:string)=>inputs(nodeId).some(run=>run.status==='completed'&&!current(run));
  return {latest,inputs,current,ready,stale};
}
function projectNodes(workflow:M.Workflow):M.WorkflowNode[]{
  const branch=workflow.branches?.find(item=>item.id===workflow.activeBranchId);
  const check=contextCheck(workflow,branch);
  return workflow.nodes.map(node=>{
    if(node.kind==='session')return node;
    const run=[...(workflow.executions??[])].reverse().find(run=>run.nodeId===node.id&&run.nodeRevision===node.revision&&(!branch||runVisible(workflow,run,branch)));
    const approved=workflow.approvals?.some(item=>item.nodeId===node.id&&item.nodeRevision===node.revision&&item.decision==='approved'&&item.fingerprint===fingerprint(workflow,node,item.resolvedModel));
    const {resultStale:_,...base}=node;
    return {...base,status:run?.status??(approved?(check.ready(node.id)?'ready':'blocked'):'draft'),answerSummary:run?.summary,...(run?.status==='completed'&&!check.current(run)?{resultStale:true}:{})};
  });
}
function prerequisitesComplete(workflow:M.Workflow,nodeId:string,branch:M.Branch|undefined):boolean{
  return contextCheck(workflow,branch).ready(nodeId);
}
function assertPrerequisites(workflow:M.Workflow,nodeId:string,branch:M.Branch|undefined):void{if(!prerequisitesComplete(workflow,nodeId,branch))fail('Complete prerequisite tasks before executing');}
const policyOperationId=(prefix:string,identity:unknown)=>`${prefix}-${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;

declare module '@deepseek-ai/cordis' { interface Context { visualWorkflow:VisualWorkflowService } }

export class VisualWorkflowService extends TypertRemoteService {
  static inject=['storageDomain'];
  private records?:KvTable<string,M.Workflow>;
  private layouts?:KvTable<string,M.CatalogLayout>;
  private native?:NativeRuntime;
  private controls?:NativeControls;
  private workspaces?:NativeWorkspaces;
  private contextControls?:NativeContextControls;
  private skillCatalog?:NativeSkillCatalog;
  private readonly compactFlights=new Set<string>();
  private readonly sessionArchiveFlights=new Map<string,string>();
  private readonly autoAnswers=new Map<string,{at:number;signature:string;paused:boolean;timer?:ReturnType<typeof setTimeout>}>();
  private readonly actionTails=new Map<string,Promise<unknown>>();
  private readonly scheduled=new Map<string,ReturnType<typeof setTimeout>>();
  private readonly policyTimers=new Map<string,ReturnType<typeof setTimeout>>();
  private readonly policyFlights=new Set<string>();
  private readonly policyAgain=new Set<string>();
  /** Prevent event projection and policy timers from writing while a delete
   * first interrupts the native work and then commits the archive tombstone. */
  private readonly archiveFlights=new Set<string>();
  private readonly pausedPolicies=new Set<string>();
  private recovering=false;
  private stopped=false;
  constructor(ctx:Context){super(ctx,'visualWorkflow');}
  async [Service.init]():Promise<void>{
    this.ctx.effect(()=>()=>{this.stopped=true;for(const timer of this.policyTimers.values())clearTimeout(timer);this.policyTimers.clear();this.policyAgain.clear();for(const state of this.autoAnswers.values())if(state.timer)clearTimeout(state.timer);this.autoAnswers.clear();},'visual-workflow.policy-close');
    const domain=await this.ctx.storageDomain.open(workflowDomainSpec);
    this.ctx.effect(()=>()=>domain.close(),'visual-workflow.domain-close');
    this.records=domain.table('workflows');this.layouts=domain.table('catalog_layout');
    const backups=domain.table('legacy_backup');
    for(const [id,workflow] of this.records.entries())if(workflow.schemaVersion===1){
      if(!backups.get(id))await backups.put(id,clone(workflow));
      await this.records.put(id,normalized(workflow));
    }
    // Deliberately not awaited: layouts remain usable in storage-only profiles.
    this.ctx.inject([...DshNativeRuntime.inject],ctx=>{
      const runtime=new DshNativeRuntime(ctx);this.native=runtime;
      const controls=new NativeControls(ctx);this.controls=controls;
      this.workspaces=new NativeWorkspaces(ctx);
      this.contextControls=new NativeContextControls(ctx);
      this.skillCatalog=new NativeSkillCatalog(ctx);
      ctx.on('agent/created',({agent})=>{
        for(const [,raw] of this.table().entries())if(raw.archivedAt===undefined&&raw.organizeNativeNames&&raw.sourceSessionId!==agent.id){
          const workflow=normalized(raw),run=workflow.executions!.findLast(item=>item.sessionId===agent.id),node=workflow.nodes.find(item=>item.id===run?.nodeId),branch=workflow.branches!.find(item=>item.sessionId===agent.id);
          const title=node&&branch?nativeSessionCaption(workflow,node,branch.label):workflow.executions!.some(item=>item.subagent?.parentSessionId===agent.id)?`${workflow.name.slice(0,80)} · 内部协调`:undefined;
          if(title)void this.workspaces?.rename(agent.id,title).catch(error=>ctx.logger.warn('Workflow deferred native naming failed',error));
        }
      });
      controls.setApprovalOwner((sessionId,callId,approvalId)=>this.ownsApproval(sessionId,callId,approvalId));
      const stopControls=controls.subscribe(sessionId=>this.schedule(sessionId));
      ctx.effect(()=>()=>{stopControls();if(this.controls===controls)this.controls=undefined;return controls.dispose();},'visual-workflow.native-controls');
      runtime.setQuestionOwner?.((sessionId,callId)=>this.ownsQuestion(sessionId,callId));
      ctx.effect(()=>()=>runtime.disposeSubagents?.(),'visual-workflow.subagents');
      ctx.on('subagent/end',info=>this.schedule(info.id));
      ctx.on('subagent/provider-added',()=>{for(const [id] of this.table().entries())this.queuePolicies(id);});
      const dispose=runtime.subscribe(sessionId=>this.schedule(sessionId));
      ctx.effect(()=>()=>{dispose();for(const timer of this.scheduled.values())clearTimeout(timer);this.scheduled.clear();if(this.native===runtime)this.native=undefined;});
      void this.recover().catch(error=>ctx.logger.error('Workflow recovery failed',error));
    });
  }
  private owner():void{
    const invocation=this.ctx.invocation;
    if(invocation&&invocation.peer.principal.kind!=='owner')fail('Workflow Session orchestration is available only to the local owner');
  }
  private table():KvTable<string,M.Workflow>{this.owner();if(!this.records)throw new Error('Workflow storage is not ready');return this.records;}
  private runtime():NativeRuntime{this.owner();if(!this.native)fail('Native Session runtime is not available in this profile');return this.native;}
  private workflow(id:string):M.Workflow{const item=this.table().get(id);if(!item||item.archivedAt!==undefined)fail('Workflow no longer exists');return normalized(item);}
  private async write(id:string,transform:(current:M.Workflow)=>M.Workflow):Promise<M.Workflow>{
    if(this.archiveFlights.has(id))fail('Workflow is stopping native work');
    const saved=await updateWorkflowMetadata(this.table(),id,current=>{
      if(this.archiveFlights.has(id))fail('Workflow is stopping native work');
      if(current.archivedAt!==undefined)fail('Workflow no longer exists');
      const next=invalidateQueue(normalized(transform(normalized(clone(current)))));
      const previousReferences=sessionReferences(current);
      const archivedSessions=new Set<string>(this.archiveRegistry()?.archivedSessionIds??[]);
      if([...sessionReferences(next)].some(id=>(this.sessionArchiveFlights.has(id)||archivedSessions.has(id))&&!previousReferences.has(id)))fail('This Session is being archived or is already archived; its history cannot be newly referenced');
      return parse(V.workflowSchema,{...next,schemaVersion:2,revision:current.revision+1,createdAt:current.createdAt,updatedAt:Math.max(Date.now(),current.updatedAt+1)});
    });
    this.queuePolicies(id);return saved;
  }
  private serial<T>(key:string,action:()=>Promise<T>):Promise<T>{
    const previous=this.actionTails.get(key)??Promise.resolve();
    const next=previous.then(action,action);this.actionTails.set(key,next);
    void next.finally(()=>{if(this.actionTails.get(key)===next)this.actionTails.delete(key);}).catch(()=>{});return next;
  }
  @Remote async capabilities():Promise<M.WorkflowCapabilitiesValue>{
    this.owner();return {pluginVersion:WORKFLOW_PLUGIN_VERSION,apiVersion:WORKFLOW_API_VERSION,features:['batch-run','pause-all','delete','native-session-archive','model-selection','model-reasoning','node-model-override','pinned-execution-model','planning','attachments','planning-attachments','visual-node-hide','user-questions']};
  }
  @Remote async models():Promise<M.WorkflowModelsValue>{
    const value=await this.runtime().models();
    return {models:value.models.map(item=>({...parse(V.modelIdentitySchema,{provider:item.provider,model:item.model}),label:item.label,...item.reasoning?{reasoning:{efforts:item.reasoning.efforts.map(effort=>({id:effort.id,name:effort.name,...effort.description===undefined?{}:{description:effort.description}})),...(item.reasoning.defaultEffort===undefined?{}:{defaultEffort:item.reasoning.defaultEffort})}}:{}})),...(value.defaultModel?{defaultModel:parse(V.modelIdentitySchema,value.defaultModel)}:{})};
  }
  private async resolveWorkflowModel(workflow:M.Workflow,node?:M.WorkflowNode):Promise<M.WorkflowModelIdentity>{
    const runtime=this.runtime();
    const explicit=node?.model??workflow.settings?.model;
    if(!workflow.settings?.modelReasoning?.length)return parse(V.modelIdentitySchema,await runtime.resolveModel(explicit));
    const selected=explicit??(await runtime.models()).defaultModel;
    const preference=selected&&explicit?.reasoningEffort===undefined&&workflow.settings?.modelReasoning?.find(item=>item.provider===selected.provider&&item.model===selected.model);
    return parse(V.modelIdentitySchema,await runtime.resolveModel(selected?{...selected,...preference?{reasoningEffort:preference.reasoningEffort}:{}}:undefined));
  }
  @Remote async accessModes():Promise<M.WorkflowAccessCatalog>{this.owner();return this.controls?this.controls.catalogAccessModes():{options:[],defaultPreset:''};}
  private async resolveAccessMode(workflow:M.Workflow):Promise<string|undefined>{
    const catalog=await this.accessModes(),mode=workflow.settings?.accessMode??catalog.defaultPreset;
    if(mode&&!catalog.options.some(option=>option.id===mode))fail('Selected native access mode is no longer available');
    return mode||undefined;
  }
  private workspacePath(workflow:M.Workflow):string|undefined{
    if(!workflow.workspaceId)return;
    const workspace=this.workspaces?.list().find(item=>item.id===workflow.workspaceId);if(!workspace)fail('Native workspace no longer exists');return workspace.path;
  }
  @Remote async setAccessMode(request:M.WorkflowAccessModeRequest):Promise<M.WorkflowActionValue>{
    const args=parse(V.accessModeRequestSchema,request);return this.serial(args.workflowId,async()=>{
      const current=this.workflow(args.workflowId),catalog=await this.accessModes();
      if(args.presetId&&!catalog.options.some(option=>option.id===args.presetId))fail('Native access mode is unavailable');
      // Selection applies to future explicit admissions; active executions keep
      // their own approval policy and cannot silently gain wider authority.
      const workflow=await this.write(current.id,item=>({...item,settings:{...item.settings!,accessMode:args.presetId}}));
      return {workflow:clone(workflow)};
    });
  }
  @Remote async workspacesList():Promise<M.WorkflowWorkspacesValue>{this.owner();return {workspaces:this.workspaces?.list()??[]};}
  private contextTarget(args:M.WorkflowContextRequest):{workflow?:M.Workflow;sessionId?:string;label:string;readOnly:boolean}{
    this.owner();
    if(!args.workflowId)return {sessionId:args.sessionId,label:args.sessionId?'原生会话':'当前上下文',readOnly:true};
    const workflow=this.workflow(args.workflowId),branch=workflow.branches!.find(item=>item.id===(args.branchId??workflow.activeBranchId));
    if(args.branchId&&!branch)fail('The selected context branch does not belong to this workflow');
    const node=args.nodeId?workflow.nodes.find(item=>item.id===args.nodeId):undefined;
    if(args.nodeId&&!node)fail('The selected context node no longer exists');
    const run=node?workflow.executions!.findLast(item=>item.nodeId===node.id&&(!branch||runVisible(workflow,item,branch))):undefined;
    const plan=args.planning?workflow.plans!.at(-1):undefined;
    const sessionId=args.sessionId??(args.planning?plan?.sessionId:node?.sourceSessionId??run?.sessionId??branch?.sessionId);
    if(sessionId&&![workflow.sourceSessionId,workflow.uploadSessionId,...workflow.branches!.map(item=>item.sessionId),...workflow.plans!.map(item=>item.sessionId),...workflow.nodes.map(item=>item.sourceSessionId)].includes(sessionId))fail('The context Session does not belong to this workflow');
    return {workflow,sessionId,label:args.planning?'任务规划会话':node?`${node.displayId?`#${node.displayId} · `:''}${node.title}`:branch?.label??workflow.name,readOnly:!!sessionId&&(sessionId===workflow.sourceSessionId||workflow.nodes.some(item=>item.kind==='session'&&item.sourceSessionId===sessionId))};
  }
  private async inspectContext(target:ReturnType<VisualWorkflowService['contextTarget']>):Promise<M.WorkflowContextValue>{
    const {workflow,sessionId,label,readOnly}=target;
    if(!sessionId)return {label,readOnly,source:'unavailable',canCompact:false,compacting:false,unavailableReason:'尚未建立会话，请先运行任务或生成规划。'};
    if(!this.contextControls)return {sessionId,label,readOnly,source:'unavailable',canCompact:false,compacting:false,unavailableReason:'当前 DSH 未提供上下文服务。'};
    const snapshot=await this.contextControls.inspect(sessionId);
    const native=this.runtime();
    const child=workflow?.executions!.some(run=>run.sessionId===sessionId&&run.subagent);
    const busy=native.isRunning(sessionId)||workflow?.executions!.some(run=>run.sessionId===sessionId&&(run.status==='waiting'||activeExecution(run)||run.status==='unknown'||run.durability==='needs-reconcile'))||workflow?.plans!.some(plan=>plan.sessionId===sessionId&&['running','needs-reconcile'].includes(plan.status));
    const uncertain=workflow?.operations!.some(operation=>operation.kind==='compact'&&operation.sourceSessionId===sessionId&&['pending','needs-reconcile'].includes(operation.status));
    const questions=await native.questions?.(sessionId)??[];
    const approvals=await this.controls?.approvals(sessionId)??[];
    const unavailableReason=readOnly?'原始会话保持只读，请在工作流分支中压缩。':child?'原生子智能体暂不支持独立的手动压缩入口。':snapshot.compacting||uncertain?'压缩正在执行或上次结果需要核对，不能重复提交。':busy||questions.some(item=>item.actionable)||approvals.some(item=>item.actionable)?'请先结束当前任务、等待队列、提问或权限审批。':!snapshot.manualAvailable?'当前原生会话不支持手动压缩。':undefined;
    return {...snapshot,label,readOnly,canCompact:!!workflow&&!unavailableReason,...unavailableReason?{unavailableReason}:{}};
  }
  @Remote async contextUsage(request:M.WorkflowContextRequest):Promise<M.WorkflowContextValue>{
    return this.inspectContext(this.contextTarget(parse(V.contextRequestSchema,request)));
  }
  @Remote async skills(request:M.WorkflowContextRequest):Promise<M.WorkflowSkillsValue>{
    const target=this.contextTarget(parse(V.contextRequestSchema,request));
    if(!this.skillCatalog)return {skills:[]};
    const cwd=target.workflow?this.workspacePath(target.workflow):undefined;
    return {skills:await this.skillCatalog.list({sessionId:target.sessionId,cwd})};
  }
  @Remote async compactContext(request:M.WorkflowCompactRequest):Promise<M.WorkflowCompactValue>{
    const args=parse(V.compactRequestSchema,request);
    return this.serial(args.workflowId,async()=>{
      const target=this.contextTarget({workflowId:args.workflowId,sessionId:args.sessionId}),current=target.workflow!;
      const existing=current.operations!.find(item=>item.id===args.operationId);
      if(existing){
        if(existing.kind!=='compact'||existing.sourceSessionId!==args.sessionId)fail('The operation identity belongs to another action');
        if(existing.status==='completed')return {workflow:clone(current),context:await this.inspectContext(target),changed:existing.atSeq!==undefined};
        fail('The previous compaction outcome must be checked in the native Session; it was not resubmitted');
      }
      const context=await this.inspectContext(target);if(!context.canCompact)fail(context.unavailableReason??'Native compaction is unavailable');
      const key=`${args.workflowId}:${args.sessionId}`;if(this.compactFlights.has(key))fail('Compaction is already running');
      await this.write(current.id,item=>({...item,operations:[...item.operations!,{id:args.operationId,kind:'compact',status:'pending',sourceSessionId:args.sessionId,createdAt:Date.now()}]}));
      this.compactFlights.add(key);
      try{
        const result=await this.contextControls!.compact(args.sessionId);
        const log=await this.runtime().read(args.sessionId),end=result.changed?log.events.findLast(item=>item.type==='compaction/end'&&item.data.compactionId===result.compactionId&&!item.data.error)?.seq:undefined,verified=verifiedCompactionCheckpoints(log);
        if(result.changed&&(end===undefined||!log.events.some(event=>verified.has(event.seq)&&event.seq<end&&(event.data.source as {compactionId?:unknown}|undefined)?.compactionId===result.compactionId)))throw new Error('The native compaction result has no verified durable checkpoint; inspect the Session before retrying.');
        const workflow=await this.write(current.id,item=>({...item,operations:item.operations!.map(operation=>operation.id===args.operationId?{...operation,status:'completed',atSeq:end}:operation)}));
        return {workflow:clone(workflow),context:await this.inspectContext({...target,workflow}),changed:result.changed};
      }catch(error){
        if(error instanceof NativeContextError&&error.outcomeKnown)await this.write(current.id,item=>({...item,operations:item.operations!.map(operation=>operation.id===args.operationId?{...operation,status:'failed',error:err(error)}:operation)}));
        else await this.operationFailure(current.id,args.operationId,error);
        throw error;
      }
      finally{this.compactFlights.delete(key);}
    });
  }
  @Remote async organizeSessionNames(request:M.WorkflowQuestionsRequest):Promise<M.WorkflowOrganizeValue>{
    const {workflowId}=parse(V.questionsRequestSchema,request);return this.serial(workflowId,async()=>{
      let workflow=await this.write(workflowId,item=>({...item,organizeNativeNames:true}));const updatedSessionIds:string[]=[],deferredSessionIds:string[]=[];if(!this.workspaces)return {updatedSessionIds,deferredSessionIds};
      if(workflow.branches!.some(branch=>branch.label==='Main branch'||branch.label.startsWith('路径 · ')))workflow=await this.write(workflow.id,item=>({...item,branches:item.branches!.map(branch=>{
        if(branch.label==='Main branch')return {...branch,label:'主线'};
        if(!branch.label.startsWith('路径 · '))return branch;
        const source=item.nodes.find(node=>node.id===branch.forkFromNodeId),target=item.nodes.find(node=>node.id===item.executions!.find(run=>run.branchId===branch.id)?.nodeId);
        return {...branch,label:branchCaption(source,target?.title??branch.label.slice(5)).slice(0,160)};
      })}));
      for(const branch of workflow.branches!){
        if(branch.sessionId===workflow.sourceSessionId)continue;
        const run=workflow.executions!.findLast(item=>item.sessionId===branch.sessionId),node=workflow.nodes.find(item=>item.id===run?.nodeId);
        const coordinator=workflow.executions!.some(item=>item.subagent?.parentSessionId===branch.sessionId);
        if(!node&&!coordinator)continue;
        const updated=await this.workspaces.rename(branch.sessionId,node?nativeSessionCaption(workflow,node,branch.label):`${workflow.name.slice(0,80)} · 内部协调`);
        await this.workspaces.attach(branch.sessionId,workflow.workspaceId);(updated?updatedSessionIds:deferredSessionIds).push(branch.sessionId);
      }
      return {updatedSessionIds,deferredSessionIds};
    });
  }
  @Remote async setWorkspace(request:M.WorkflowWorkspaceRequest):Promise<M.WorkflowActionValue>{
    const args=parse(V.workspaceRequestSchema,request);return this.serial(args.workflowId,async()=>{
      const current=this.workflow(args.workflowId);
      if(current.sourceSessionId||current.branches!.length||current.executions!.length||current.plans!.length||current.uploadSessionId)fail('Choose the workspace before creating native Sessions; existing Session directories are immutable');
      if(args.workspaceId&&!this.workspaces?.list().some(workspace=>workspace.id===args.workspaceId))fail('Native workspace no longer exists');
      return {workflow:clone(await this.write(current.id,item=>({...item,workspaceId:args.workspaceId})))};
    });
  }
  @Remote async list():Promise<M.WorkflowListValue>{
    const workflows=[...this.table().entries()].filter(([,workflow])=>workflow.archivedAt===undefined).map(([,workflow])=>{const value=normalized(clone(workflow));return {...value,nodes:projectNodes(value)};});
    workflows.sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));return {workflows};
  }
  @Remote async get(request:M.WorkflowGetRequest):Promise<M.WorkflowGetValue>{const {id}=parse(V.getRequestSchema,request);const workflow=this.table().get(id);if(!workflow||workflow.archivedAt!==undefined)return {workflow:null};const value=normalized(clone(workflow));return {workflow:{...value,nodes:projectNodes(value)}};}
  @Remote async create(request:M.WorkflowCreateRequest):Promise<M.WorkflowCreateValue>{
    const {name}=parse(V.createRequestSchema,request),now=Date.now();
    const workflow=normalized({id:uid('workflow'),name,schemaVersion:2,revision:1,nodes:[],edges:[],viewport:{x:0,y:0,zoom:1},createdAt:now,updatedAt:now});
    await this.table().put(workflow.id,workflow);return {workflow:clone(workflow)};
  }
  /**
   * Deletion is an explicit user command to stop this canvas. Interrupt every
   * owned native request first, then persist terminal metadata together with
   * the archive tombstone. Source Sessions are immutable and are never
   * cancelled; their references remain available for later history review.
   */
  private async stopBeforeArchive(workflow:M.Workflow,reason:'workflow-deleted'|'workflow-paused'='workflow-deleted'):Promise<M.Workflow>{
    const runtime=this.native,now=Date.now();
    const sources=new Set([workflow.sourceSessionId,...workflow.nodes.map(node=>node.sourceSessionId)].filter((id):id is string=>!!id));
    const requests=new Map<string,{requestIds:Set<string>;subagent?:boolean}>();
    const runsToStop=workflow.executions!.filter(run=>
      run.status==='waiting'||run.status==='ready'||run.status==='running'||run.status==='waiting_answer'||run.status==='blocked'||run.status==='unknown'||run.durability==='needs-reconcile');
    const add=(sessionId:string,requestId?:string,subagent=false)=>{if(sources.has(sessionId))return;const item=requests.get(sessionId)??{requestIds:new Set<string>()};if(requestId)item.requestIds.add(requestId);item.subagent||=subagent;requests.set(sessionId,item);};
    for(const run of runsToStop)if(run.status!=='waiting')add(run.sessionId,run.requestId,!!run.subagent);
    for(const plan of workflow.plans!.filter(plan=>plan.status==='running'||plan.status==='needs-reconcile'))add(plan.sessionId,plan.requestId);
    for(const operation of workflow.operations!.filter(operation=>operation.status==='pending'||operation.status==='needs-reconcile')){
      // A fork's source can be someone else's Session. Only its newly minted
      // child (or an owned run/compaction target) is ours to interrupt.
      const sessionId=operation.childSessionId??(['run','compact'].includes(operation.kind)?operation.sourceSessionId:undefined);
      if(sessionId&&ownedSessionIds(workflow).has(sessionId))add(sessionId);
    }
    const stopErrors=new Map<string,string>();
    if(requests.size&&!runtime)fail('Native Session runtime is unavailable; the workflow was kept because its tasks could not be stopped');
    if(runtime)for(const [sessionId,request] of requests){
      try{
        if(request.subagent&&runtime.isRunning(sessionId)){
          if(!runtime.cancelSubagent)throw new Error('Native subagent cancellation is unavailable');
          await runtime.cancelSubagent(sessionId);
        }
        else {
          for(const requestId of request.requestIds)await runtime.cancel(sessionId,requestId);
          // Includes owned pending question replies whose native follow-up
          // request identity differs from the original task request.
          if(runtime.isRunning(sessionId)&&!this.protectedHistorySession(workflow,sessionId))await runtime.cancel(sessionId);
        }
        if(runtime.isRunning(sessionId))await this.waitForArchiveIdle(runtime,sessionId);
        await runtime.flush(sessionId);
        if(runtime.isRunning(sessionId))throw new Error('Native work did not stop');
      }catch(error){stopErrors.set(sessionId,err(error));}
    }
    if(stopErrors.size)fail(`Unable to stop workflow tasks; the workflow was kept. ${[...stopErrors].map(([id,message])=>`${id}: ${message}`).join('; ')}`);
    const stoppedExecutions=workflow.executions!.map(run=>{
      const shouldStop=runsToStop.some(candidate=>candidate.runId===run.runId);if(!shouldStop)return run;
      return {...run,status:'cancelled' as const,waitingReason:undefined,terminalReason:run.status==='waiting'?'queue-cancelled':reason,updatedAt:now,...requests.has(run.sessionId)?{durability:'durable' as const}:{}};
    });
    const stoppedOperations=workflow.operations!.map(operation=>{
      if(operation.status!=='pending'&&operation.status!=='needs-reconcile')return operation;
      return {...operation,status:'failed' as const,error:`${reason}. Previous operation outcome: ${operation.status}${operation.error?`; ${operation.error}`:''}`.slice(0,4000)};
    });
    const stoppedPlans=workflow.plans!.map(plan=>{
      if(plan.status!=='running'&&plan.status!=='needs-reconcile')return plan;
      return {...plan,status:'failed' as const,error:reason==='workflow-deleted'?'Stopped while deleting workflow':'Stopped by Pause all'};
    });
    return {...workflow,executions:stoppedExecutions,operations:stoppedOperations,plans:stoppedPlans};
  }
  private async waitForArchiveIdle(runtime:NativeRuntime,sessionId:string):Promise<void>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([runtime.waitForIdle(sessionId),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timed out while waiting for native cancellation')),10000);})]);}
    finally{if(timer)clearTimeout(timer);}
  }
  private stopPolicyTimers(workflowId:string):void{
    const timer=this.policyTimers.get(workflowId);if(timer)clearTimeout(timer);this.policyTimers.delete(workflowId);this.policyAgain.delete(workflowId);
    const prefix=`[${JSON.stringify(workflowId)},`;
    for(const [key,state] of this.autoAnswers)if(key.startsWith(prefix)){if(state.timer)clearTimeout(state.timer);this.autoAnswers.delete(key);}
  }
  private async cancelLocalQueue(workflowId:string,expectedRevision?:number):Promise<M.Workflow>{
    const workflow=this.workflow(workflowId);
    const unsuppressed=workflow.executions!.filter(run=>run.admissionPolicies?.generation==='dynamic'&&!workflow.operations!.some(operation=>operation.id===policyOperationId('dynamic-plan',run.runId)));
    if(!workflow.executions!.some(run=>run.status==='waiting')&&!unsuppressed.length)return workflow;
    return updateWorkflowMetadata(this.table(),workflowId,current=>{
      if(current.archivedAt!==undefined)fail('Workflow no longer exists');
      if(expectedRevision!==undefined&&current.revision!==expectedRevision)throw new RevisionConflict(normalized(current));
      const value=normalized(current),now=Math.max(Date.now(),current.updatedAt+1);
      // Persist suppression using the same one-shot planning identity as the
      // dynamic scheduler. A restart must not revive pre-pause suggestions.
      const suppressed=value.executions!.filter(run=>run.admissionPolicies?.generation==='dynamic'&&!value.operations!.some(operation=>operation.id===policyOperationId('dynamic-plan',run.runId))).map(run=>({id:policyOperationId('dynamic-plan',run.runId),kind:'plan' as const,status:'failed' as const,triggerRunId:run.runId,error:'Automatic follow-up suppressed by explicit workflow stop',createdAt:now}));
      const next={...value,operations:[...value.operations!,...suppressed],executions:value.executions!.map(run=>run.status==='waiting'?{...run,status:'cancelled' as const,terminalReason:'queue-cancelled',waitingReason:undefined,updatedAt:now}:run)};
      return parse(V.workflowSchema,{...next,nodes:projectNodes(next),revision:current.revision+1,updatedAt:now});
    });
  }
  @Remote async pauseAll(request:M.WorkflowPauseRequest):Promise<M.WorkflowActionValue>{
    const {workflowId}=parse(V.pauseRequestSchema,request);
    return this.serial(workflowId,async()=>{
      this.workflow(workflowId);this.archiveFlights.add(workflowId);this.pausedPolicies.add(workflowId);this.stopPolicyTimers(workflowId);
      try{
        const stopping=await this.cancelLocalQueue(workflowId),stopped=await this.stopBeforeArchive(stopping,'workflow-paused');
        const workflow=await updateWorkflowMetadata(this.table(),workflowId,current=>{
          if(current.archivedAt!==undefined)fail('Workflow no longer exists');
          if(current.revision!==stopping.revision)throw new RevisionConflict(normalized(current));
          const now=Math.max(Date.now(),current.updatedAt+1);
          return parse(V.workflowSchema,{...stopped,nodes:projectNodes(stopped),revision:current.revision+1,updatedAt:now});
        });
        return {workflow:clone(workflow)};
      }finally{this.archiveFlights.delete(workflowId);}
    });
  }
  @Remote async delete(request:M.WorkflowDeleteRequest):Promise<M.WorkflowDeleteValue>{
    const {workflowId,expectedRevision}=parse(V.deleteRequestSchema,request);
    return this.serial(workflowId,async()=>{
      const existing=this.table().get(workflowId);if(!existing||existing.archivedAt!==undefined)return {ok:false,code:'not-found',workflow:null};
      if(existing.revision!==expectedRevision)return {ok:false,code:'conflict',workflow:clone(normalized(existing))};
      this.archiveFlights.add(workflowId);this.pausedPolicies.add(workflowId);this.stopPolicyTimers(workflowId);
      try{
        // Cancel the durable local queue before touching native work. Even if
        // native cancellation fails, no dependent task may start afterwards.
        const stopping=await this.cancelLocalQueue(workflowId,expectedRevision);
        const stopped=await this.stopBeforeArchive(stopping);
        await this.table().update(workflowId,current=>{
          if(current.archivedAt!==undefined)fail('Workflow no longer exists');
          if(current.revision!==stopping.revision)throw new RevisionConflict(normalized(current));
          const item=normalized(stopped);
          const now=Math.max(Date.now(),current.updatedAt+1);
          return parse(V.workflowSchema,{...item,archivedAt:now,revision:current.revision+1,updatedAt:now});
        });
        this.stopPolicyTimers(workflowId);this.pausedPolicies.delete(workflowId);
        return {ok:true,workflowId};
      }catch(error){if(error instanceof RevisionConflict)return {ok:false,code:'conflict',workflow:clone(error.workflow)};throw error;}
      finally{this.archiveFlights.delete(workflowId);}
    });
  }
  private archiveRegistry():Pick<WorkspaceRegistry,'archivedSessionIds'|'archiveSession'>|undefined{
    const registry=this.ctx.get('workspaceRegistry') as WorkspaceRegistry|undefined;
    return typeof registry?.archiveSession==='function'?registry:undefined;
  }
  private archivedWorkflow(id:string,revision?:number):M.Workflow{
    const item=this.table().get(id);if(!item||item.archivedAt===undefined)fail('Archive the workflow before choosing what to do with its native history');
    if(revision!==undefined&&item.revision!==revision)fail('The archived workflow changed; review its native history again');
    return normalized(item);
  }
  private protectedHistorySession(workflow:M.Workflow,sessionId:string):boolean{
    if(workflow.sourceSessionId===sessionId||workflow.nodes.some(node=>node.sourceSessionId===sessionId))return true;
    if(!ownedSessionIds(workflow).has(sessionId))return true;
    for(const [id,other] of this.table().entries())if(id!==workflow.id&&sessionReferences(other).has(sessionId))return true;
    return false;
  }
  private async historyNeedsAttention(sessionId:string):Promise<boolean>{
    const runtime=this.runtime(),questions=await runtime.questions?.(sessionId)??[],approvals=await this.controls?.approvals(sessionId)??[];
    return questions.some(item=>item.actionable)||approvals.some(item=>item.actionable)||Boolean(runtime.pendingQuestionReplies?.(sessionId).length);
  }
  private async sessionArchivePreview(workflowId:string):Promise<M.WorkflowSessionArchivePreviewValue>{
    const workflow=this.archivedWorkflow(workflowId),registry=this.archiveRegistry();
    if(!registry)return {workflowId,expectedRevision:workflow.revision,available:false,sessionIds:[],protectedCount:0,alreadyArchivedCount:0,reason:'This DSH profile does not expose native Session archival. Physical log deletion is not a released API.'};
    const runtime=this.runtime(),catalog=await runtime.catalog(),listed=new Map(catalog.map(session=>[session.sessionId,session]));
    const owned=ownedSessionIds(workflow),candidates=new Set([...owned,...[workflow.sourceSessionId,...workflow.nodes.map(node=>node.sourceSessionId)].filter((id):id is string=>Boolean(id))]);
    const archived=new Set<string>(registry.archivedSessionIds);const sessionIds:string[]=[];let protectedCount=0,alreadyArchivedCount=0;
    for(const id of [...candidates].sort()){
      if(this.protectedHistorySession(workflow,id)){protectedCount++;continue;}
      if(archived.has(id)){alreadyArchivedCount++;continue;}
      const session=listed.get(id);
      // A missing or unreadable catalogue entry never grants archival authority.
      if(!session||session.running||runtime.isRunning(id)||catalog.some(child=>child.parentSessionId===id&&!owned.has(child.sessionId))||await this.historyNeedsAttention(id)){protectedCount++;continue;}
      const activity=await this.ctx.waterfall('workspace/session-activity',{sessionId:SessionId(id)},()=>Promise.resolve([]));
      if(activity.length){protectedCount++;continue;}
      sessionIds.push(id);
    }
    this.archivedWorkflow(workflowId,workflow.revision);
    return {workflowId,expectedRevision:workflow.revision,available:true,sessionIds,protectedCount,alreadyArchivedCount};
  }
  @Remote async previewSessionArchive(request:M.WorkflowSessionArchivePreviewRequest):Promise<M.WorkflowSessionArchivePreviewValue>{
    const {workflowId}=parse(V.questionsRequestSchema,request);
    return this.serial(workflowId,()=>this.sessionArchivePreview(workflowId));
  }
  @Remote async archiveSessionHistory(request:M.WorkflowSessionArchiveRequest):Promise<M.WorkflowSessionArchiveValue>{
    const args=parse(V.deleteRequestSchema.extend({sessionIds:z.array(z.string().min(1).max(512)).max(4000)}),request);
    return this.serial(args.workflowId,async()=>{
      const workflow=this.archivedWorkflow(args.workflowId,args.expectedRevision),preview=await this.sessionArchivePreview(workflow.id);
      const requested=[...args.sessionIds].sort();
      if(!preview.available)fail(preview.reason??'Native Session archival is unavailable');
      if(new Set(requested).size!==requested.length||JSON.stringify(requested)!==JSON.stringify(preview.sessionIds))fail('Native history eligibility changed; review the current archive preview before confirming');
      if(requested.some(id=>this.sessionArchiveFlights.has(id)))fail('Native history is already being archived');
      const registry=this.archiveRegistry()!,runtime=this.runtime();for(const id of requested)this.sessionArchiveFlights.set(id,workflow.id);
      const result:M.WorkflowSessionArchiveValue={archivedSessionIds:[],failedSessionIds:[],skippedSessionIds:[]};
      const guard=async(sessionId:string)=>{const attention=await this.historyNeedsAttention(sessionId),current=this.archivedWorkflow(workflow.id,args.expectedRevision);if(this.protectedHistorySession(current,sessionId)||runtime.isRunning(sessionId)||attention)fail('Native history became shared, active or awaiting an answer before archival');};
      // This check runs inside the native registry's own activity-admission queue.
      const stopGuard=this.ctx.on('workspace/session-activity',async(request,next)=>{const activity=await next();if(this.sessionArchiveFlights.get(request.sessionId)===workflow.id)await guard(request.sessionId);return activity;},{prepend:true});
      try{
        for(const id of requested){
          try{await guard(id);}catch{result.skippedSessionIds.push(id);continue;}
          try{
            // Omitting stopActivity is intentional: new turns, jobs, child work or
            // schedules must refuse this action rather than be silently stopped.
            await registry.archiveSession(SessionId(id));
            if(!registry.archivedSessionIds.includes(SessionId(id)))throw new Error('Native archive durability was not confirmed');
            result.archivedSessionIds.push(id);
          }catch{if(registry.archivedSessionIds.includes(SessionId(id)))result.archivedSessionIds.push(id);else result.failedSessionIds.push(id);}
        }
        return result;
      }finally{stopGuard();for(const id of requested)if(this.sessionArchiveFlights.get(id)===workflow.id)this.sessionArchiveFlights.delete(id);}
    });
  }
  @Remote async save(request:M.WorkflowSaveRequest):Promise<M.WorkflowSaveValue>{
    const {workflow,expectedRevision}=parse(V.saveRequestSchema,request);
    const existing=this.table().get(workflow.id);if(!existing||existing.archivedAt!==undefined)return {ok:false,code:'not-found',workflow:null};
    try{
      const saved=await this.write(workflow.id,current=>{
        if(current.revision!==expectedRevision)throw new RevisionConflict(current);
        const incoming=new Map(workflow.nodes.map(node=>[node.id,node]));
        for(const node of current.nodes)if(!incoming.has(node.id)&&(node.kind==='session'||(current.executions??[]).some(run=>run.nodeId===node.id)))fail('Executed and Session nodes cannot be deleted');
        const groups=workflow.groups??current.groups?.map(group=>({...group,nodeIds:group.nodeIds.filter(nodeId=>incoming.has(nodeId))})).filter(group=>group.nodeIds.length>0);
        const verifiedReferences=knownAttachments(current);
        const planningAttachments=retainedAttachments(current,{attachments:current.planningAttachments},workflow.planningAttachments);
        const next={...current,name:workflow.name,viewport:workflow.viewport,edges:workflow.edges,groups,settings:workflow.settings??current.settings,preferences:workflow.preferences??current.preferences,utilityNodes:workflow.utilityNodes??current.utilityNodes,planningAttachments,...(verifiedReferences.length?{attachmentReferences:verifiedReferences}:{})};
        const changed=new Set<string>();
        next.nodes=workflow.nodes.map(node=>{
          const old=current.nodes.find(candidate=>candidate.id===node.id);
          if(!old){const attachments=retainedAttachments(current,undefined,node.attachments);return {id:node.id,title:node.title,instruction:node.instruction,model:node.model,attachments,position:node.position,zIndex:node.zIndex,width:node.width,height:node.height,hidden:node.hidden,status:'draft' as const,revision:1,kind:'task' as const,source:'user' as const,revisions:[{revision:1,title:node.title,instruction:node.instruction,model:node.model,attachments,dependencies:dependencies(workflow,node.id),createdAt:Date.now()}]};}
          const hidden=node.hidden??old.hidden;
          if(hidden&&!old.hidden&&((current.executions??[]).some(run=>run.nodeId===node.id&&(run.status==='waiting'||activeExecution(run)))||(current.operations??[]).some(operation=>['run','batch-run'].includes(operation.kind)&&operation.status==='pending'&&(operation.nodeId===node.id||operation.nodeIds?.includes(node.id)))))fail('Stop waiting or active tasks before hiding their nodes');
          if(old.kind==='session')return {...old,position:node.position,zIndex:node.zIndex??old.zIndex,width:node.width??old.width,height:node.height??old.height,hidden};
          const attachments=retainedAttachments(current,old,node.attachments);
          const edited=old.title!==node.title||old.instruction!==node.instruction||JSON.stringify(old.model)!==JSON.stringify(node.model)||JSON.stringify(dependencies(current,node.id))!==JSON.stringify(dependencies(workflow,node.id))||JSON.stringify(attachmentIdentity(old.attachments))!==JSON.stringify(attachmentIdentity(attachments));
          if(!edited)return {...old,position:node.position,zIndex:node.zIndex??old.zIndex,width:node.width??old.width,height:node.height??old.height,hidden};
          if((current.executions??[]).some(run=>run.nodeId===node.id&&activeExecution(run))||(current.operations??[]).some(operation=>['run','batch-run'].includes(operation.kind)&&operation.status==='pending'&&[...(operation.nodeIds??[]),...(operation.nodeId?[operation.nodeId]:[])].some(id=>id===node.id||dependencies(current,id).includes(node.id))))fail('Cancel the active execution before editing its task or prerequisites');
          changed.add(node.id);const revision=old.revision+1;
          return {...old,title:node.title,instruction:node.instruction,model:node.model,attachments,position:node.position,zIndex:node.zIndex??old.zIndex,width:node.width??old.width,height:node.height??old.height,hidden,status:'draft' as const,revision,revisions:[...revisions(old,current),{revision,title:node.title,instruction:node.instruction,model:node.model,attachments,dependencies:dependencies(workflow,node.id),createdAt:Date.now()}]};
        });
        const settingsChanged=JSON.stringify(authorizationSettings(next.settings))!==JSON.stringify(authorizationSettings(current.settings));
        next.approvals=(current.approvals??[]).filter(approval=>!settingsChanged&&!changed.has(approval.nodeId)&&incoming.has(approval.nodeId));
        if(workflow.activeBranchId&&(current.branches??[]).some(branch=>branch.id===workflow.activeBranchId))next.activeBranchId=workflow.activeBranchId;
        next.branches=(current.branches??[]).map(branch=>({...branch,nodeIds:[...new Set([...branch.nodeIds.filter(id=>incoming.has(id)),...(branch.id===next.activeBranchId?next.nodes.filter(node=>!current.nodes.some(old=>old.id===node.id)).map(node=>node.id):[])])]}));
        next.nodes=projectNodes(next);return next;
      });return {ok:true,workflow:clone(saved)};
    }catch(error){if(error instanceof RevisionConflict)return {ok:false,code:'conflict',workflow:clone(error.workflow)};throw error;}
  }
  @Remote async catalog():Promise<M.WorkflowCatalogValue>{
    this.owner();const hidden=new Set<string>(this.archiveRegistry()?.archivedSessionIds??[]);
    for(const [,workflow] of this.table().entries()){if(workflow.uploadSessionId)hidden.add(workflow.uploadSessionId);for(const run of workflow.executions??[])if(run.subagent)hidden.add(run.subagent.parentSessionId);for(const operation of workflow.operations??[])if(['prepare-attachment','prepare-plan-attachments'].includes(operation.kind)&&operation.childSessionId)hidden.add(operation.childSessionId);}
    return {sessions:(await this.runtime().catalog()).filter(session=>!hidden.has(session.sessionId)),layout:clone(this.layouts!.get('root')??initialLayout)};
  }
  @Remote async saveCatalogLayout(request:M.WorkflowCatalogLayoutRequest):Promise<M.WorkflowCatalogLayoutValue>{
    this.owner();const {layout,expectedRevision}=parse(V.catalogLayoutRequestSchema,request);
    return this.serial('catalog-layout',async()=>{const current=this.layouts!.get('root')??initialLayout;if(current.revision!==expectedRevision)return {ok:false,layout:clone(current)};const next={...layout,zIndices:layout.zIndices??current.zIndices,sizes:layout.sizes??current.sizes,groups:layout.groups??current.groups,revision:current.revision+1};await this.layouts!.put('root',next);return {ok:true,layout:clone(next)};});
  }
  @Remote async importSession(request:M.WorkflowImportRequest):Promise<M.WorkflowActionValue>{
    const {sessionId}=parse(V.importRequestSchema,request);const runtime=this.runtime();
    return this.serial('import',async()=>{
      const assertImportable=()=>{if(this.sessionArchiveFlights.has(sessionId)||this.archiveRegistry()?.archivedSessionIds.includes(SessionId(sessionId)))fail('This Session is being archived or is already archived; it cannot be imported');};assertImportable();
      const existing=[...this.table().entries()].map(([,item])=>item).find(item=>item.archivedAt===undefined&&item.sourceSessionId===sessionId);if(existing)return {workflow:clone(existing)};
      const source=(await runtime.catalog()).find(item=>item.sessionId===sessionId);if(!source)fail('Source Session no longer exists');
      assertImportable();
      const {workflow}=await this.create({name:source.title.slice(0,128)});
      const root:M.WorkflowNode={id:uid('session'),kind:'session',sourceSessionId:sessionId,title:source.title.slice(0,160),instruction:'',source:'user',status:source.running?'running':'completed',revision:1,position:{x:80,y:100}};
      const workspaceId=this.workspaces?.list().find(item=>item.path.toLowerCase()===source.cwd?.toLowerCase())?.id;
      const saved=await this.write(workflow.id,current=>({...current,sourceSessionId:sessionId,workspaceId,nodes:[root]}));return {workflow:clone(saved)};
    });
  }
  private attachmentNode(workflow:M.Workflow,nodeId:string,nodeRevision:number):M.WorkflowNode{
    const node=workflow.nodes.find(item=>item.id===nodeId);if(!node||node.kind==='session')fail('Select an editable task for attachments');
    if(node.revision!==nodeRevision)fail('Task revision changed while uploading files; refresh the task');
    if(workflow.executions!.some(run=>run.nodeId===nodeId&&activeExecution(run))||workflow.operations!.some(operation=>['run','batch-run'].includes(operation.kind)&&operation.status==='pending'&&[...(operation.nodeIds??[]),...(operation.nodeId?[operation.nodeId]:[])].some(id=>id===nodeId||dependencies(workflow,id).includes(nodeId))))fail('Stop the active task before changing its attachments');
    return node;
  }
  @Remote async prepareAttachment(request:M.WorkflowPrepareAttachmentRequest):Promise<M.WorkflowPrepareAttachmentValue>{
    const args=parse(V.prepareAttachmentRequestSchema,request);
    return this.serial(args.workflowId,async()=>{
      this.attachmentNode(this.workflow(args.workflowId),args.nodeId,args.nodeRevision);
      return this.prepareUploadSession(args.workflowId,args.operationId,'prepare-attachment',args.nodeId);
    });
  }
  @Remote async preparePlanAttachments(request:M.WorkflowPreparePlanAttachmentsRequest):Promise<M.WorkflowPrepareAttachmentValue>{
    const args=parse(V.preparePlanAttachmentsRequestSchema,request);
    return this.serial(args.workflowId,()=>this.prepareUploadSession(args.workflowId,args.operationId,'prepare-plan-attachments'));
  }
  private async prepareUploadSession(workflowId:string,operationId:string,kind:'prepare-attachment'|'prepare-plan-attachments',nodeId?:string):Promise<M.WorkflowPrepareAttachmentValue>{
      const runtime=this.runtime();let current=this.workflow(workflowId);
      const repeated=current.operations!.find(operation=>operation.id===operationId);
      if(repeated&&repeated.kind!==kind)fail('Operation identity is already used by another action');
      if(current.uploadSessionId){
        await runtime.read(current.uploadSessionId);
        await runtime.flush(current.uploadSessionId);
        return {workflow:clone(current),sessionId:current.uploadSessionId};
      }
      if(repeated){
        if(!repeated.childSessionId)fail('The attachment Session preparation requires reconciliation');
        // A known identity may be verified by a cold read after response loss.
        // It is never blindly created a second time.
        await runtime.read(repeated.childSessionId);
        await runtime.flush(repeated.childSessionId);
        current=await this.write(current.id,item=>({...item,uploadSessionId:repeated.childSessionId,operations:item.operations!.map(operation=>operation.id===operationId?{...operation,status:'completed'}:operation)}));
        return {workflow:clone(current),sessionId:repeated.childSessionId};
      }
      const uploadSessionId=randomUUID();
      current=await this.write(current.id,item=>({...item,operations:[...item.operations!,{id:operationId,kind,status:'pending',nodeId,childSessionId:uploadSessionId,createdAt:Date.now()}]}));
      try{
        const created=await runtime.create({sessionId:uploadSessionId,cwd:this.workspacePath(current)});if(created.sessionId!==uploadSessionId)fail('Native upload Session identity changed unexpectedly');
        await runtime.flush(uploadSessionId);
        current=await this.write(current.id,item=>({...item,uploadSessionId,operations:item.operations!.map(operation=>operation.id===operationId?{...operation,status:'completed'}:operation)}));
        return {workflow:clone(current),sessionId:uploadSessionId};
      }catch(error){await this.operationFailure(current.id,operationId,error);throw error;}
  }
  @Remote async attach(request:M.WorkflowAttachRequest):Promise<M.WorkflowActionValue>{
    const args=parse(V.attachRequestSchema,request);return this.attachFilesAction({...args,receiptIds:[args.receiptId]});
  }
  @Remote async attachFiles(request:M.WorkflowAttachFilesRequest):Promise<M.WorkflowActionValue>{
    return this.attachFilesAction(parse(V.attachFilesRequestSchema,request));
  }
  private async attachFilesAction(args:M.WorkflowAttachFilesRequest):Promise<M.WorkflowActionValue>{
    const runtime=this.runtime();return this.serial(args.workflowId,async()=>{
      let current=this.workflow(args.workflowId);
      const repeated=current.operations!.find(operation=>operation.id===args.operationId);
      if(repeated){if(repeated.kind!=='attach')fail('Operation identity is already used by another action');return {workflow:clone(current)};}
      const node=this.attachmentNode(current,args.nodeId,args.nodeRevision);
      if(!current.uploadSessionId||args.sessionId!==current.uploadSessionId)fail('Upload receipt must belong to this workflow\'s private attachment Session');
      if((node.attachments?.length??0)+args.receiptIds.length>100)fail('A task can contain at most 100 attachments');
      // Resolve every receipt against its exact native Agent before mutating
      // any node. Expired or cross-Session receipts cannot partially attach.
      const files=[];for(const receiptId of args.receiptIds)files.push(await runtime.resolveUploadedFile(args.sessionId,receiptId));
      const now=Date.now();const added:M.WorkflowNodeAttachment[]=files.map(file=>({id:uid('attachment'),file:{attachmentId:file.attachmentId,name:file.name,bytes:file.bytes},createdAt:now}));
      current=await this.write(current.id,item=>{
        const target=this.attachmentNode(item,args.nodeId,args.nodeRevision);if(item.uploadSessionId!==args.sessionId)fail('Attachment Session changed before admission');
        const attachments=[...target.attachments??[],...added],revision=target.revision+1;
        const updated={...target,attachments,revision,status:'draft' as const,revisions:[...revisions(target,item),{revision,title:target.title,instruction:target.instruction,model:target.model,attachments,dependencies:dependencies(item,target.id),createdAt:now}]};
        return {...item,nodes:item.nodes.map(node=>node.id===target.id?updated:node),attachmentReferences:[...knownAttachments(item),...added],approvals:item.approvals!.filter(approval=>approval.nodeId!==target.id),operations:[...item.operations!,{id:args.operationId,kind:'attach',status:'completed',nodeId:target.id,childSessionId:args.sessionId,attachmentId:added[0]!.id,createdAt:now}]};
      });return {workflow:clone(current)};
    });
  }
  @Remote async attachPlanFiles(request:M.WorkflowAttachPlanFilesRequest):Promise<M.WorkflowActionValue>{
    const args=parse(V.attachPlanFilesRequestSchema,request),runtime=this.runtime();return this.serial(args.workflowId,async()=>{
      let current=this.workflow(args.workflowId);const repeated=current.operations!.find(operation=>operation.id===args.operationId);
      if(repeated){if(repeated.kind!=='attach-plan-files')fail('Operation identity is already used by another action');return {workflow:clone(current)};}
      if(!current.uploadSessionId||args.sessionId!==current.uploadSessionId)fail('Upload receipt must belong to this workflow\'s private attachment Session');
      if((current.planningAttachments?.length??0)+args.receiptIds.length>100)fail('A planning draft can contain at most 100 attachments');
      const files=[];for(const receiptId of args.receiptIds)files.push(await runtime.resolveUploadedFile(args.sessionId,receiptId));
      const now=Date.now(),added:M.WorkflowNodeAttachment[]=files.map(file=>({id:uid('attachment'),file:{attachmentId:file.attachmentId,name:file.name,bytes:file.bytes},createdAt:now}));
      current=await this.write(current.id,item=>{
        if(item.uploadSessionId!==args.sessionId)fail('Attachment Session changed before admission');
        const planningAttachments=[...item.planningAttachments??[],...added];if(planningAttachments.length>100)fail('A planning draft can contain at most 100 attachments');
        return {...item,planningAttachments,attachmentReferences:[...knownAttachments(item),...added],operations:[...item.operations!,{id:args.operationId,kind:'attach-plan-files',status:'completed',childSessionId:args.sessionId,attachmentId:added[0]!.id,createdAt:now}]};
      });return {workflow:clone(current)};
    });
  }
  @Remote async approve(request:M.WorkflowApproveRequest):Promise<M.WorkflowActionValue>{
    const {workflowId,nodeId,approved}=parse(V.approveRequestSchema,request);
    const saved=await this.write(workflowId,current=>{
      const node=current.nodes.find(item=>item.id===nodeId);if(!node||node.kind==='session')fail('Select an editable task');
      if(current.executions!.some(run=>run.nodeId===nodeId&&activeExecution(run))||current.operations!.some(operation=>['run','batch-run'].includes(operation.kind)&&(operation.nodeId===nodeId||operation.nodeIds?.includes(nodeId))&&operation.status==='pending'))fail('Task is currently executing');
      const approval:M.Approval={id:uid('approval'),nodeId,nodeRevision:node.revision,fingerprint:fingerprint(current,node),decision:approved?'approved':'rejected',createdAt:Date.now()};
      const next={...current,approvals:[...(current.approvals??[]).filter(item=>item.nodeId!==nodeId),approval]};return {...next,nodes:projectNodes(next)};
    });return {workflow:clone(saved)};
  }
  @Remote async run(request:M.WorkflowRunRequest):Promise<M.WorkflowActionValue>{
    return this.runAction(parse(V.runRequestSchema,request));
  }
  @Remote async batchRun(request:M.WorkflowBatchRunRequest):Promise<M.WorkflowBatchRunValue>{
    const args=parse(V.batchRunRequestSchema,request);const runtime=this.runtime();
    const result=await this.serial(args.workflowId,async()=>{
      if(this.stopped)fail('Workflow plugin is stopping');
      let current=this.workflow(args.workflowId);
      this.pausedPolicies.delete(args.workflowId);

      const repeated=current.operations!.find(operation=>operation.id===args.operationId);
      if(repeated){if(repeated.kind!=='batch-run')fail('Operation identity is already used by another action');return {workflow:clone(current),runIds:repeated.runIds??[]};}
      if(current.settings!.subagents==='on'&&(!runtime.supportsSubagents?.()||!runtime.startSubagent||!runtime.cancelSubagent))fail('当前 DSH 未提供可用的原生子智能体，请选择关闭或自动决定。');
      let branch=current.branches!.find(item=>item.id===(args.branchId??current.activeBranchId));if(args.branchId&&!branch)fail('Selected branch no longer exists');
      const nodes=args.nodeIds.map(nodeId=>{
        const node=current.nodes.find(item=>item.id===nodeId);
        if(!node||node.kind==='session')fail('Select editable tasks to execute');
        if(node.hidden)fail('Restore hidden tasks before running them');
        if(!node.instruction.trim())fail(`Task instructions are empty: ${node.title}`);
        if(args.nodeRevisions[node.id]!==node.revision)fail('Task revision changed before batch Run; refresh the selected tasks');
        if(branch&&node.branchIds?.length&&!node.branchIds.includes(branch.id)&&!branch.nodeIds.includes(node.id))fail('A selected task does not belong to the selected branch');
        return node;
      });
      // All validation precedes any write, Session creation, or authorization.
      const entries=await Promise.all(nodes.map(async node=>{
        const existing=current.executions!.findLast(run=>run.nodeId===node.id&&run.nodeRevision===node.revision&&!!branch&&runVisible(current,run,branch)&&(run.status==='waiting'||activeExecution(run)));
        const resolvedModel=existing?.resolvedModel??await this.resolveWorkflowModel(current,node);
        return {nodeId:node.id,revision:node.revision,fingerprint:fingerprint(current,node,resolvedModel),resolvedModel,existing,runId:existing?.runId??uid('run'),requestId:existing?.requestId??uid('workflow-request'),operationId:uid('batch-item')};
      }));
      const runIds=entries.map(entry=>entry.runId);
      const resolvedAccessMode=await this.resolveAccessMode(current);
      current=await this.write(current.id,item=>{
        for(const entry of entries){const node=item.nodes.find(node=>node.id===entry.nodeId);if(!node||fingerprint(item,node,entry.resolvedModel)!==entry.fingerprint)fail('Selected tasks changed before batch authorization');}
        return {...item,operations:[...item.operations!,{id:args.operationId,kind:'batch-run',status:entries.every(entry=>entry.existing)?'completed':'pending',createdAt:Date.now(),nodeIds:args.nodeIds,runIds,sourceSessionId:branch?.sessionId??item.sourceSessionId}]};
      });
      if(entries.every(entry=>entry.existing))return {workflow:clone(current),runIds};
      try{
        if(!branch){branch=await this.newBranch(current,current.sourceSessionId,undefined,'主线',args.operationId);current=this.workflow(current.id);}
        const now=Date.now();
        current=await this.write(current.id,item=>{
          for(const entry of entries){const node=item.nodes.find(node=>node.id===entry.nodeId);if(!node||node.kind==='session'||!node.instruction.trim()||fingerprint(item,node,entry.resolvedModel)!==entry.fingerprint)fail('Selected tasks or policies changed while preparing the batch Session');if(node.branchIds?.length&&!node.branchIds.includes(branch!.id)&&!branch!.nodeIds.includes(node.id))fail('Selected task branch membership changed');}
          const added=entries.filter(entry=>!entry.existing);
          const executions:M.Execution[]=added.map(entry=>({runId:entry.runId,nodeId:entry.nodeId,nodeRevision:entry.revision,branchId:branch!.id,sessionId:branch!.sessionId,requestId:entry.requestId,status:'waiting',turns:[],createdAt:now,updatedAt:now,durability:'pending',admissionPolicies:clone(item.settings!),resolvedModel:entry.resolvedModel,resolvedAccessMode,authorizationFingerprint:entry.fingerprint}));
          const approvals:M.Approval[]=added.map(entry=>({id:uid('batch-authorization'),nodeId:entry.nodeId,nodeRevision:entry.revision,fingerprint:entry.fingerprint,resolvedModel:entry.resolvedModel,decision:'approved',createdAt:now}));
          const operations:M.OperationIntent[]=added.map(entry=>({id:entry.operationId,kind:'run',status:'completed',createdAt:now,nodeId:entry.nodeId,runId:entry.runId,sourceSessionId:branch!.sessionId}));
          return {...item,approvals:[...item.approvals!.filter(approval=>!added.some(entry=>entry.nodeId===approval.nodeId)),...approvals],executions:[...item.executions!,...executions],operations:[...item.operations!.map(operation=>operation.id===args.operationId?{...operation,status:'completed' as const}:operation),...operations],branches:item.branches!.map(item=>item.id===branch!.id?{...item,nodeIds:[...new Set([...item.nodeIds,...args.nodeIds])]}:item)};
        });
        return {workflow:clone(current),runIds};
      }catch(error){await this.operationFailure(current.id,args.operationId,error);throw error;}
    });
    await this.dispatchQueue(args.workflowId);
    return {...result,workflow:clone(this.workflow(args.workflowId))};
  }
  private async runAction(args:M.WorkflowRunRequest):Promise<M.WorkflowActionValue>{
    const runtime=this.runtime();
    const result=await this.serial(args.workflowId,async()=>{
      if(this.stopped)fail('Workflow plugin is stopping');
      let current=this.workflow(args.workflowId);
      this.pausedPolicies.delete(args.workflowId);
const repeated=current.operations!.find(item=>item.id===args.operationId);if(repeated){if(repeated.kind!=='run')fail('Operation identity is already used by another action');return {workflow:clone(current),runId:repeated.runId};}
      if(current.settings!.subagents==='on'&&(!runtime.supportsSubagents?.()||!runtime.startSubagent||!runtime.cancelSubagent))fail('当前 DSH 未提供可用的原生子智能体，请选择关闭或自动决定。');
      const node=current.nodes.find(item=>item.id===args.nodeId);if(!node||node.kind==='session')fail('Select a task to execute');if(!node.instruction.trim())fail('Task instructions are empty');
      if(node.hidden)fail('Restore hidden tasks before running them');
      if(args.nodeRevision!==undefined&&args.nodeRevision!==node.revision)fail('Task revision changed before Run; refresh and run the current version');
      let branch=current.branches!.find(item=>item.id===(args.branchId??current.activeBranchId));if(args.branchId&&!branch)fail('Selected branch no longer exists');
      if(branch&&node.branchIds?.length&&!node.branchIds.includes(branch.id)&&!branch.nodeIds.includes(node.id))fail('Task does not belong to the selected branch');
      const existing=current.executions!.find(run=>run.nodeId===node.id&&run.nodeRevision===node.revision&&!!branch&&runVisible(current,run,branch)&&(run.status==='waiting'||activeExecution(run)));
      if(existing){
        current=await this.write(current.id,item=>({...item,operations:[...item.operations!,{id:args.operationId,kind:'run',status:'completed',createdAt:Date.now(),nodeId:node.id,runId:existing.runId,sourceSessionId:existing.sessionId}]}));
        return {workflow:clone(current),runId:existing.runId};
      }
      const resolvedModel=await this.resolveWorkflowModel(current,node);
      const resolvedAccessMode=await this.resolveAccessMode(current);
      const authorizationFingerprint=fingerprint(current,node,resolvedModel);
      const runId=uid('run'),requestId=uid('workflow-request');
      current=await this.write(current.id,item=>{
        const admitted=item.nodes.find(task=>task.id===node.id);if(!admitted||fingerprint(item,admitted,resolvedModel)!==authorizationFingerprint)fail('Task or policies changed while resolving the selected model; click Run again');
        return {...item,operations:[...item.operations!,{id:args.operationId,kind:'run',status:'pending',createdAt:Date.now(),nodeId:node.id,runId,sourceSessionId:branch?.sessionId??item.sourceSessionId}]};
      });
      try{
        if(!branch){branch=await this.newBranch(current,current.sourceSessionId,undefined,'主线',args.operationId);current=this.workflow(current.id);}
        const now=Date.now();
        const execution:M.Execution={runId,nodeId:node.id,nodeRevision:node.revision,branchId:branch.id,sessionId:branch.sessionId,requestId,status:'waiting',turns:[],createdAt:now,updatedAt:now,durability:'pending',admissionPolicies:clone(current.settings!),resolvedModel,resolvedAccessMode,authorizationFingerprint};
        current=await this.write(current.id,item=>{
          const admitted=item.nodes.find(task=>task.id===node.id);
          if(!admitted||fingerprint(item,admitted,resolvedModel)!==authorizationFingerprint)fail('Task or policies changed while preparing the native Session; click Run again');
          const approval:M.Approval={id:uid('run-authorization'),nodeId:node.id,nodeRevision:node.revision,fingerprint:authorizationFingerprint,resolvedModel,decision:'approved',createdAt:now};
          return {...item,approvals:[...item.approvals!.filter(candidate=>candidate.nodeId!==node.id),approval],executions:[...item.executions!,execution],operations:item.operations!.map(operation=>operation.id===args.operationId?{...operation,status:'completed'}:operation),branches:item.branches!.map(entry=>entry.id===branch!.id?{...entry,nodeIds:[...new Set([...entry.nodeIds,node.id])]}:entry)};
        });
        return {workflow:clone(current),runId};
      }catch(error){await this.operationFailure(current.id,args.operationId,error);throw error;}
    });
    // Ready requests may start immediately, while blocked requests remain a
    // durable queue entry. This never submits an unclicked prerequisite.
    await this.dispatchQueue(args.workflowId);
    return {...result,workflow:clone(this.workflow(args.workflowId))};
  }
  @Remote async cancel(request:M.WorkflowCancelRequest):Promise<M.WorkflowActionValue>{
    const {workflowId,runId}=parse(V.traceRequestSchema,request);return this.serial(workflowId,async()=>{
    const current=this.workflow(workflowId);const run=current.executions!.find(item=>item.runId===runId);if(!run)fail('Execution not found');
    if(run.status==='waiting'){
      const workflow=await this.write(workflowId,item=>({...item,executions:item.executions!.map(execution=>execution.runId===runId?{...execution,status:'cancelled',terminalReason:'queue-cancelled',waitingReason:undefined,updatedAt:Date.now()}:execution)}));
      return {workflow:clone(workflow),runId};
    }
    if(run.sessionId===current.sourceSessionId)fail('Source Session is read only');
    const outcome=run.subagent?(await this.runtime().cancelSubagent!(run.sessionId),'active' as const):await this.runtime().cancel(run.sessionId,run.requestId);
    if(outcome==='queued'){
      await this.runtime().flush(run.sessionId);
      await this.write(workflowId,item=>{const next={...item,executions:item.executions!.map(execution=>execution.runId===runId?{...execution,status:'cancelled' as const,terminalReason:'queue-removed',durability:'durable' as const,updatedAt:Date.now()}:execution)};return {...next,nodes:projectNodes(next)};});
    }else await this.reconcileSession(run.sessionId);
    return {workflow:clone(this.workflow(workflowId)),runId};});
  }
  @Remote async trace(request:M.WorkflowTraceRequest):Promise<M.WorkflowTraceValue>{
    const {workflowId,runId}=parse(V.traceRequestSchema,request);const current=this.workflow(workflowId);const run=current.executions!.find(item=>item.runId===runId);if(!run)fail('Execution not found');
    if(localQueueRecord(run)||run.terminalReason==='queue-removed')return {trace:{runId,sessionId:run.sessionId,status:run.status,startSeq:run.startSeq,endSeq:run.endSeq,steps:[],summary:run.summary,terminalReason:run.terminalReason,error:run.error}};
    const log=await this.runtime().read(run.sessionId);const projection=this.project(log,run);
    const questions=await this.runtime().questions?.(run.sessionId)??[];
    const waiting=projection.endSeq===undefined&&questions.some(question=>question.actionable&&question.state==='open'&&this.questionBelongs(log,run,question.callId));
    return {trace:{runId,sessionId:run.sessionId,status:waiting?'waiting_answer':nativeStatus(projection.status),startSeq:projection.startSeq,endSeq:projection.endSeq,steps:projection.steps.map(step=>({...step,status:nativeStatus(step.status)})),summary:projection.assistantText,terminalReason:projection.terminalReason}};
  }
  @Remote async details(request:M.WorkflowDetailsRequest):Promise<M.WorkflowDetailsValue>{
    const {workflowId,runId,stepId}=parse(V.detailsRequestSchema,request);const current=this.workflow(workflowId);const run=current.executions!.find(item=>item.runId===runId);if(!run)fail('Execution not found');
    if(localQueueRecord(run))fail('The waiting request has no native execution steps');
    const log=await this.runtime().read(run.sessionId),projection=this.project(log,run);const details=readTraceStepDetails(log,projection,stepId);return {details:{...details,stepId,timestamp:details.time,status:nativeStatus(details.status)}};
  }
  /** Verify a question against the exact owned native tool occurrence, not the
   * canvas selection or a caller-supplied Session. Later unrelated user work
   * makes late steering unsafe even if the native projection still retains it. */
  private questionBelongs(log:NativeSessionLog,run:M.Execution,callId:string):boolean{
    if(localQueueRecord(run)||['cancelled','failed','interrupted'].includes(run.status))return false;
    const projection=this.project(log,run);
    const step=projection.steps.find(item=>item.callId===callId&&item.toolName==='ask_user_question');
    if(!step)return false;
    const ownQuestions=new Set(projection.steps.filter(item=>item.toolName==='ask_user_question').map(item=>item.callId));
    return !log.events.some(event=>{
      if(event.seq<=step.eventStartSeq||event.type!=='user/message')return false;
      const source=event.data.source&&typeof event.data.source==='object'?event.data.source as {kind?:unknown;outcome?:unknown;callId?:unknown}:undefined;
      if(source&&['model-selection','runtime-context','tool-registry','skill-catalog','time-context'].includes(String(source.kind)))return false;
      return !(source?.kind==='user-question-reply'&&source.outcome==='answered'&&ownQuestions.has(String(source.callId)));
    });
  }
  private questionRunSafe(workflow:M.Workflow,log:NativeSessionLog,run:M.Execution):boolean{
    const index=workflow.executions!.findIndex(item=>item.runId===run.runId);
    const settled=this.project(log,run).endSeq!==undefined;
    // A later request can be in the native inbox before user/message exists.
    // Never steer an old timed continuation into that newly admitted task.
    // A local successor waiting behind an OPEN question is expected and does
    // not prevent the current task from receiving its required answer.
    if(workflow.executions!.slice(index+1).some(item=>item.sessionId===run.sessionId&&(activeExecution(item)||item.status==='unknown'||item.durability==='needs-reconcile'||settled&&item.status==='waiting')))return false;
    return !workflow.operations!.some(operation=>operation.status==='pending'&&['run','batch-run'].includes(operation.kind)&&operation.sourceSessionId===run.sessionId&&operation.runId!==run.runId&&!operation.runIds?.includes(run.runId));
  }
  private async ownsQuestion(sessionId:string,callId:string):Promise<boolean>{
    const log=await this.runtime().read(sessionId);
    for(const [,raw] of this.table().entries())if(raw.archivedAt===undefined&&raw.sourceSessionId!==sessionId){
      const workflow=normalized(raw);
      if(workflow.executions!.some(run=>run.sessionId===sessionId&&workflow.branches!.some(branch=>branch.id===run.branchId&&branch.sessionId===sessionId)&&this.questionRunSafe(workflow,log,run)&&this.questionBelongs(log,run,callId)))return true;
    }
    return false;
  }
  private automationKey(question:Pick<M.WorkflowPendingQuestion,'workflowId'|'runId'|'sessionId'|'callId'>):string{return JSON.stringify([question.workflowId,question.runId,question.sessionId,question.callId]);}
  private automateQuestions(workflow:M.Workflow,questions:M.WorkflowPendingQuestion[]):M.WorkflowPendingQuestion[]{
    if(this.archiveFlights.has(workflow.id)||this.pausedPolicies.has(workflow.id))return questions;
    const policy=workflow.preferences?.questionTimeout,prefix=`[${JSON.stringify(workflow.id)},`,live=new Set(questions.map(question=>this.automationKey(question)));
    for(const [key,state] of this.autoAnswers)if(key.startsWith(prefix)&&(!live.has(key)||!policy?.enabled)){if(state.timer)clearTimeout(state.timer);this.autoAnswers.delete(key);}
    return questions.map(question=>{
      const answers=recommendedAnswers(question.questions);if(!policy?.enabled||question.state!=='open'||!question.actionable||!answers)return question;
      const key=this.automationKey(question),signature=JSON.stringify([question.questions,policy.seconds]);let state=this.autoAnswers.get(key);
      if(state?.signature!==signature){if(state?.timer)clearTimeout(state.timer);state={at:Date.now()+policy.seconds*1000,signature,paused:false};this.autoAnswers.set(key,state);}
      if(!state.paused&&!state.timer){const active=state;state.timer=setTimeout(()=>{
        active.timer=undefined;active.paused=true;
        if(this.stopped||this.archiveFlights.has(workflow.id)||this.pausedPolicies.has(workflow.id))return;
        void (async()=>{
          const current=this.workflow(workflow.id);if(!current.preferences?.questionTimeout?.enabled||current.preferences.questionTimeout.seconds!==policy.seconds)return;
          await this.answerQuestion({workflowId:question.workflowId,runId:question.runId,sessionId:question.sessionId,callId:question.callId,answers});
        })().catch(error=>this.ctx.logger.warn('Workflow recommended answer was not accepted',error));
      },Math.max(0,state.at-Date.now()));}
      return {...question,autoContinueAt:state.at,...state.paused?{autoContinuePaused:true}:{}};
    });
  }
  @Remote async pauseQuestionAutomation(request:M.WorkflowPauseQuestionRequest):Promise<M.WorkflowAnswerQuestionValue>{
    const args=parse(V.pauseQuestionRequestSchema,request),pending=(await this.questions({workflowId:args.workflowId})).questions.find(question=>question.runId===args.runId&&question.sessionId===args.sessionId&&question.callId===args.callId);
    if(!pending)return {accepted:false};const key=this.automationKey(pending),state=this.autoAnswers.get(key);
    if(state){state.paused=true;if(state.timer)clearTimeout(state.timer);state.timer=undefined;}return {accepted:true};
  }
  @Remote async questions(request:M.WorkflowQuestionsRequest):Promise<M.WorkflowQuestionsValue>{
    const {workflowId}=parse(V.questionsRequestSchema,request),workflow=this.workflow(workflowId),runtime=this.runtime();
    if(!runtime.questions)return {questions:[]};
    const questions:M.WorkflowPendingQuestion[]=[];
    for(const sessionId of new Set(workflow.executions!.map(run=>run.sessionId))){
      if(sessionId===workflow.sourceSessionId)continue;
      const pending=await runtime.questions(sessionId);if(!pending.length)continue;
      const log=await runtime.read(sessionId);
      for(const question of pending){
        if(question.sessionId!==sessionId)continue;
        const run=workflow.executions!.find(item=>item.sessionId===sessionId&&this.questionRunSafe(workflow,log,item)&&this.questionBelongs(log,item,question.callId));
        if(run&&workflow.branches!.some(branch=>branch.id===run.branchId&&branch.sessionId===sessionId))questions.push({...question,workflowId,runId:run.runId,nodeId:run.nodeId});
      }
    }
    return {questions:this.automateQuestions(workflow,questions)};
  }
  private approvalBelongs(log:NativeSessionLog,run:M.Execution,approvalId:string,callId?:string):boolean{
    if(localQueueRecord(run)||['cancelled','failed','interrupted'].includes(run.status))return false;
    const projection=this.project(log,run),step=projection.steps.find(item=>item.type==='approval'&&item.stepId===`${run.runId}:approval:${approvalId}`&&item.callId===callId);
    return !!step&&projection.endSeq===undefined&&step.eventEndSeq===undefined;
  }
  private async ownsApproval(sessionId:string,callId:string|undefined,approvalId:string):Promise<boolean>{
    const log=await this.runtime().read(sessionId);
    for(const [,raw] of this.table().entries())if(raw.archivedAt===undefined&&raw.sourceSessionId!==sessionId){const workflow=normalized(raw);if(workflow.executions!.some(run=>run.sessionId===sessionId&&workflow.branches!.some(branch=>branch.id===run.branchId&&branch.sessionId===sessionId)&&this.approvalBelongs(log,run,approvalId,callId)))return true;}
    return false;
  }
  @Remote async pendingApprovals(request:M.WorkflowQuestionsRequest):Promise<M.WorkflowApprovalsValue>{
    const {workflowId}=parse(V.questionsRequestSchema,request),workflow=this.workflow(workflowId),approvals:M.WorkflowPendingApproval[]=[];
    if(!this.controls)return {approvals};
    for(const sessionId of new Set(workflow.executions!.map(run=>run.sessionId))){
      if(sessionId===workflow.sourceSessionId)continue;
      const pending=await this.controls.approvals(sessionId);if(!pending.length)continue;const log=await this.runtime().read(sessionId);
      for(const approval of pending){const run=workflow.executions!.find(item=>item.sessionId===sessionId&&this.approvalBelongs(log,item,approval.approvalId,approval.callId));if(run)approvals.push({...approval,workflowId,runId:run.runId,nodeId:run.nodeId});}
    }
    return {approvals};
  }
  @Remote async answerApproval(request:M.WorkflowAnswerApprovalRequest):Promise<M.WorkflowAnswerQuestionValue>{
    const args=parse(V.answerApprovalRequestSchema,request);return this.serial(args.workflowId,async()=>{
      const workflow=this.workflow(args.workflowId),run=workflow.executions!.find(item=>item.runId===args.runId);
      if(!run||run.sessionId!==args.sessionId||run.sessionId===workflow.sourceSessionId)fail('Approval does not belong to this Execution Session');
      const pending=(await this.pendingApprovals({workflowId:args.workflowId})).approvals.find(approval=>approval.runId===run.runId&&approval.sessionId===args.sessionId&&approval.approvalId===args.approvalId&&approval.actionable);
      if(!pending||!this.controls)return {accepted:false};const accepted=await this.controls.answerApproval(args.sessionId,args.approvalId,args.decision);if(accepted)await this.reconcileSession(args.sessionId);return {accepted};
    });
  }
  @Remote async answerQuestion(request:M.WorkflowAnswerQuestionRequest):Promise<M.WorkflowAnswerQuestionValue>{
    const args=parse(V.answerQuestionRequestSchema,request);
    return this.serial(args.workflowId,async()=>{
      const workflow=this.workflow(args.workflowId),run=workflow.executions!.find(item=>item.runId===args.runId);
      if(!run||run.sessionId!==args.sessionId||run.sessionId===workflow.sourceSessionId)fail('Question does not belong to this execution Session');
      const runtime=this.runtime();if(!runtime.questions||!runtime.answerQuestion)return {accepted:false};
      const pending=(await this.questions({workflowId:args.workflowId})).questions.find(question=>question.runId===args.runId&&question.sessionId===args.sessionId&&question.callId===args.callId&&question.actionable);
      if(!pending)return {accepted:false};
      if(args.answers.length!==pending.questions.length||new Set(args.answers.map(answer=>answer.id)).size!==args.answers.length||args.answers.some(answer=>!pending.questions.some(question=>question.id===answer.id)))fail('Answers must match every native question exactly once');
      for(const answer of args.answers){
        const question=pending.questions.find(question=>question.id===answer.id)!;
        if(new Set(answer.selected).size!==answer.selected.length||!question.multiSelect&&answer.selected.length>1||answer.selected.some(label=>!question.options?.some(option=>option.label===label)))fail('Select only the original native question options');
      }
      // The adapter rechecks ownership immediately before settling its live
      // waiter/native continuation; failures never submit a new prompt.
      const accepted=await runtime.answerQuestion(args.sessionId,args.callId,args.answers,run.resolvedModel?{model:run.resolvedModel,requestId:run.requestId}:undefined);
      if(accepted)await this.reconcileSession(args.sessionId);
      return {accepted};
    });
  }
  @Remote async fork(request:M.WorkflowForkRequest):Promise<M.WorkflowActionValue>{
    const args=parse(V.forkRequestSchema,request);this.runtime();return this.serial(args.workflowId,async()=>{
      let current=this.workflow(args.workflowId);const repeated=current.operations!.find(item=>item.id===args.operationId);if(repeated)return {workflow:clone(current),branchId:current.branches!.find(item=>item.sessionId===repeated.childSessionId)?.id};
      const run=args.runId?current.executions!.find(item=>item.runId===args.runId):undefined;
      if(args.runId&&(!run||run.status!=='completed'||run.endSeq===undefined||run.durability!=='durable'))fail('Fork requires a completed durable execution');
      const source=run?.sessionId??args.sessionId??current.sourceSessionId;if(!source)fail('Select an existing source Session');
      if(!run&&source!==current.sourceSessionId&&!current.branches!.some(branch=>branch.sessionId===source))fail('Source Session does not belong to this workflow');
      const sourceLog=await this.runtime().read(source),completed=run?.endSeq??completedBoundary(sourceLog,args.atSeq);
      const atSeq=completed===undefined?undefined:args.atSeq===undefined?compactionContinuationBoundary(sourceLog,completed):completed;if(atSeq===undefined)fail('The source has no completed native turn boundary');
      current=await this.write(current.id,item=>({...item,operations:[...item.operations!,{id:args.operationId,kind:'fork',status:'pending',createdAt:Date.now(),sourceSessionId:source,atSeq,nodeId:run?.nodeId}]}));
      try{const branch=await this.newBranch(current,source,atSeq,args.label,args.operationId,run);return {workflow:clone(this.workflow(current.id)),branchId:branch.id};}
      catch(error){await this.operationFailure(current.id,args.operationId,error);throw error;}
    });
  }
  @Remote async generatePlan(request:M.WorkflowPlanRequest):Promise<M.WorkflowActionValue>{
    return this.generatePlanAction(parse(V.planRequestSchema,request));
  }
  private async generatePlanAction(args:M.WorkflowPlanRequest,triggerRunId?:string):Promise<M.WorkflowActionValue>{
    const runtime=this.runtime();return this.serial(args.workflowId,async()=>{
      if(triggerRunId&&this.pausedPolicies.has(args.workflowId))fail('Workflow policies are paused');
      if(triggerRunId&&this.stopped)fail('Workflow plugin is stopping');
      let current=this.workflow(args.workflowId);const repeated=current.operations!.find(item=>item.id===args.operationId);if(repeated)return {workflow:clone(current),planId:current.plans!.find(plan=>plan.requestId===repeated.runId)?.id};
      const trigger=triggerRunId?current.executions!.find(run=>run.runId===triggerRunId):undefined;
      if(triggerRunId&&(!trigger||current.settings!.generation!=='dynamic'||trigger.admissionPolicies?.generation!=='dynamic'||trigger.status!=='completed'||trigger.durability!=='durable'||trigger.endSeq===undefined))fail('Dynamic suggestions require a durably completed execution admitted in Dynamic mode');
      const source=args.sourceSessionId??current.sourceSessionId;
      // The owner may explicitly choose any existing Session as read-only plan
      // context. It never replaces this Workflow's immutable source reference.
      if(source&&!(await runtime.catalog()).some(session=>session.sessionId===source))fail('Selected planning Session no longer exists');
      const selectAttachments=(item:M.Workflow):M.WorkflowNodeAttachment[]=>{
        if(triggerRunId)return [];
        const draft=item.planningAttachments??[];
        return args.attachmentIds===undefined?draft:args.attachmentIds.map(id=>draft.find(attachment=>attachment.id===id)??fail('A selected planning attachment is no longer in this draft; upload or select it again'));
      };
      const attachments=clone(selectAttachments(current));
      const modelSelection=current.settings!.model;
      const resolvedModel=await this.resolveWorkflowModel(current);
      const planId=uid('plan'),requestId=uid('plan-request');
      current=await this.write(current.id,item=>{
        if(triggerRunId&&item.settings!.generation!=='dynamic')fail('Planning policy changed before admission');
        if(JSON.stringify(item.settings!.model)!==JSON.stringify(modelSelection))fail('Workflow model changed before plan generation; submit the goal again');
        if(JSON.stringify(selectAttachments(item))!==JSON.stringify(attachments))fail('Planning attachments changed before admission; submit the goal again');
        return {...item,operations:[...item.operations!,{id:args.operationId,kind:'plan',status:'pending',createdAt:Date.now(),sourceSessionId:source,runId:requestId,...(triggerRunId?{triggerRunId}:{})}]};
      });
      try{
        const branch=await this.newBranch(current,source,trigger?.endSeq,'Planning context',args.operationId,undefined,false);current=this.workflow(current.id);
        const plan:M.WorkflowPlan={id:planId,goal:args.goal,sessionId:branch.sessionId,requestId,status:'running',tasks:[],createdAt:Date.now(),resolvedModel,attachments,...(triggerRunId?{triggerRunId}:{})};
        current=await this.write(current.id,item=>{
          if(JSON.stringify(selectAttachments(item))!==JSON.stringify(attachments))fail('Planning attachments changed while preparing the planning Session; submit the goal again');
          if(JSON.stringify(item.settings!.model)!==JSON.stringify(modelSelection))fail('Workflow model changed while preparing the planning Session; submit the goal again');
          return {...item,plans:[...item.plans!,plan]};
        });
        runtime.protectPlanning(branch.sessionId,attachments.map(attachment=>attachment.file));
        const instruction=buildPlanningInstruction(args.goal);
        if(triggerRunId&&this.stopped)fail('Workflow plugin stopped before dynamic planning submission');
        await runtime.submit({sessionId:branch.sessionId,requestId,text:instruction,planning:true,model:resolvedModel,files:attachments.map(attachment=>attachment.file)});
        const submittedIds=new Set(attachments.map(attachment=>attachment.id));
        await this.write(current.id,item=>({...item,planningAttachments:(item.planningAttachments??[]).filter(attachment=>!submittedIds.has(attachment.id)),operations:item.operations!.map(operation=>operation.id===args.operationId?{...operation,status:'completed'}:operation)}));
        this.finishPlanLater(current.id,planId);return {workflow:clone(this.workflow(current.id)),planId};
      }catch(error){await this.operationFailure(current.id,args.operationId,error);throw error;}
    });
  }
  @Remote async applyPlan(request:M.WorkflowApplyPlanRequest):Promise<M.WorkflowActionValue>{
    const args=parse(V.applyPlanRequestSchema,request);
    const saved=await this.write(args.workflowId,current=>{
      const plan=current.plans!.find(item=>item.id===args.planId);if(!plan||plan.status!=='proposed')fail('No proposed plan is available');
      if(!args.accept)return {...current,plans:current.plans!.map(item=>item.id===plan.id?{...item,status:'rejected'}:item)};
      const selected=new Set(args.taskIds??plan.tasks.map(task=>task.id));if(!selected.size)fail('Select at least one proposed task');
      if([...selected].some(id=>!plan.tasks.some(task=>task.id===id)))fail('Selected task is not in this plan');
      const tasks=plan.tasks.filter(task=>selected.has(task.id));if(tasks.some(task=>task.dependsOn.some(id=>!selected.has(id))))fail('Accept prerequisite tasks together with dependent tasks');
      const ids=new Map(tasks.map(task=>[task.id,uid('node')]));
      const nodes:M.WorkflowNode[]=tasks.map(task=>({id:ids.get(task.id)!,title:task.title,instruction:task.instruction,source:'agent',status:'draft',revision:1,position:{x:0,y:0},originPlanId:plan.id,branchIds:current.activeBranchId?[current.activeBranchId]:[]}));
      const edges:M.WorkflowEdge[]=tasks.flatMap(task=>task.dependsOn.map(dependency=>({id:uid('edge'),source:ids.get(dependency)!,target:ids.get(task.id)!,type:'dependency'})));
      if(graphProblem([...current.nodes,...nodes],[...current.edges,...edges]))fail('Plan would produce an invalid graph');
      return {...current,nodes:[...current.nodes,...placeNewDependencyNodes(nodes,edges,current.nodes)],edges:[...current.edges,...edges],plans:current.plans!.map(item=>item.id===plan.id?{...item,status:'accepted'}:item),branches:current.branches!.map(branch=>branch.id===current.activeBranchId?{...branch,nodeIds:[...branch.nodeIds,...nodes.map(node=>node.id)]}:branch)};
    });return {workflow:clone(saved),planId:args.planId};
  }
  private branchBusy(workflow:M.Workflow,branch:M.Branch):boolean{
    return this.compactFlights.has(`${workflow.id}:${branch.sessionId}`)||workflow.operations!.some(operation=>operation.kind==='compact'&&operation.sourceSessionId===branch.sessionId&&['pending','needs-reconcile'].includes(operation.status))||this.runtime().isRunning(branch.sessionId)||workflow.executions!.some(run=>run.branchId===branch.id&&(activeExecution(run)||run.status==='unknown'||run.durability==='needs-reconcile'));
  }
  /** Resolve late: a user can queue children before their parent's durable endSeq exists. */
  private async routeQueuedExecution(workflow:M.Workflow,run:M.Execution,forceCoordinator=false):Promise<M.Execution>{
    const runtime=this.runtime(),branch=workflow.branches!.find(item=>item.id===run.branchId)!,scope=manualScope(workflow,branch);
    const required=dependencies(workflow,run.nodeId).flatMap(id=>{
      const node=workflow.nodes.find(item=>item.id===id);if(node?.kind==='session')return [];
      const execution=workflow.executions!.findLast(item=>item.nodeId===id&&item.nodeRevision===node?.revision&&runVisible(workflow,item,branch));
      return execution?[execution]:[];
    });
    const candidates=required.filter(candidate=>{
      const owner=workflow.branches!.find(item=>item.id===candidate.branchId)!;
      return required.every(item=>historyContains(workflow,item,owner,candidate.endSeq));
    });
    const predecessor=candidates.at(-1);
    const reject=async(message:string):Promise<M.Execution>=>{
      const saved=await this.write(workflow.id,item=>({...item,executions:item.executions!.map(candidate=>candidate.runId===run.runId?{...candidate,status:'failed',durability:'durable',terminalReason:'context-isolation-required',error:message,waitingReason:undefined,updatedAt:Date.now()}:candidate)}));
      return saved.executions!.find(item=>item.runId===run.runId)!;
    };
    if(required.length&&!predecessor)return reject('任务依赖来自不同的独立会话，当前原生 Fork 无法合并这些历史。请先选择单一路径，或建立明确的汇总任务后再连接；本次未向 Agent 提交。');
    const allowed=new Set<string>();const visit=(id:string)=>{for(const dependency of dependencies(workflow,id))if(!allowed.has(dependency)){allowed.add(dependency);visit(dependency);}};visit(run.nodeId);
    // An explicit historical fork establishes an intentional baseline even for
    // newly created roots. The imported source is never a writable destination.
    const baseline=scope.sourceSessionId&&scope.forkBoundarySeq!==undefined?await runtime.read(scope.sourceSessionId):undefined;
    const requestId=(event:NativeSessionLog['events'][number]):string|undefined=>{
      if(event.type!=='user/message')return;
      const source=event.data.source as {rpcId?:unknown}|undefined;
      return typeof source?.rpcId==='string'?source.rpcId:typeof event.data.id==='string'?event.data.id:undefined;
    };
    const baselineIds=new Set(baseline?.events.filter(event=>event.seq<=scope.forkBoundarySeq!).map(requestId).filter(Boolean));
    const owned=new Map(workflow.executions!.flatMap(item=>[[item.requestId,item] as const,...(item.subagent?.messageId?[[item.subagent.messageId,item] as const]:[])]));
    const clean=(log:NativeSessionLog,boundary=Infinity)=>{
      const checkpoints=verifiedCompactionCheckpoints(log);
      const questionOwners=new Map<string,{owner:M.Execution;seq:number}|null>();
      if(log.events.some(event=>event.type==='user/message'&&(event.data.source as {kind?:unknown}|undefined)?.kind==='user-question-reply')){
        // Forks intentionally include their ancestors. Replay the physical
        // prefix here to prove each reply's original task/tool occurrence;
        // the normal execution trace still excludes inherited events.
        for(const owner of workflow.executions!){
          const projection=projectExecution({...log,inheritedEventCount:0},{runId:owner.runId,requestId:owner.requestId,messageId:owner.subagent?.messageId,startSeq:owner.startSeq});
          for(const step of projection.steps)if(step.toolName==='ask_user_question'&&step.callId){
            const previous=questionOwners.get(step.callId);
            questionOwners.set(step.callId,previous===null||previous&&previous.owner.runId!==owner.runId?null:{owner,seq:step.eventStartSeq});
          }
        }
      }
      return !log.events.some(event=>{
      if(event.seq>boundary||event.type!=='user/message')return false;
      // rc.3 represents these native control notices as user/message too.
      // Other sources (including agent/team/webhook messages) carry context.
      const source=event.data.source as {kind?:unknown;outcome?:unknown;callId?:unknown}|undefined;
      if(source&&['model-selection','runtime-context','tool-registry','skill-catalog','time-context'].includes(String(source.kind)))return false;
      if(checkpoints.has(event.seq))return false;
      if(source?.kind==='skill-invocation'){
        // Native skill instructions are appended by the pre-step hook after
        // their user message. Inherit them only with that same authorized turn.
        const start=log.events.findLast(item=>item.seq<event.seq&&item.type==='turn/start');
        const input=start&&log.events.find(item=>item.seq>start.seq&&item.seq<event.seq&&item.type==='user/message'&&requestId(item)&&owned.has(requestId(item)!));
        const skillOwner=input?owned.get(requestId(input)!):undefined;
        if(skillOwner&&(allowed.has(skillOwner.nodeId)||required.length===0&&skillOwner.nodeId===run.nodeId))return false;
      }
      const id=requestId(event);if(id&&baselineIds.has(id))return false;
      const reply=source?.kind==='user-question-reply'&&source.outcome==='answered'?questionOwners.get(String(source.callId)):undefined;
      const owner=reply&&reply.seq<event.seq?reply.owner:id?owned.get(id):undefined;return !owner||!allowed.has(owner.nodeId)&&!(required.length===0&&owner.nodeId===run.nodeId);
      });
    };
    const atTail=(log:NativeSessionLog,boundary:number)=>{const latest=completedBoundary(log);return latest!==undefined&&compactionContinuationBoundary(log,latest)===boundary&&!log.events.some(event=>event.seq>boundary&&(event.type==='turn/start'||event.type==='user/message'));};
    let target:M.Branch|undefined;
    if(predecessor){
      const owner=workflow.branches!.find(item=>item.id===predecessor.branchId)!;
      const sourceBranch=historyContains(workflow,predecessor,branch,predecessor.endSeq!)?branch:owner,sourceLog=await runtime.read(sourceBranch.sessionId),boundary=compactionContinuationBoundary(sourceLog,predecessor.endSeq!);
      if(!clean(sourceLog,boundary))return reject('前驱执行的原生历史已经包含其他任务路径，无法通过 Fork 删除中间上下文。请从干净分支重新运行前驱；已有聊天记录保持原样，本次未向 Agent 提交。');
      const fanOut=workflow.edges.filter(edge=>edge.source===predecessor.nodeId).length>1;
      // Prefer an already prepared child (including a recovered one). Never
      // append either side of a fan-out to their common predecessor's Session.
      for(const candidate of forceCoordinator?[]:[branch,owner]){
        if(manualScope(workflow,candidate).id!==scope.id||fanOut&&candidate.id===owner.id||this.branchBusy(workflow,candidate)||workflow.executions!.some(item=>item.subagent&&item.sessionId===candidate.sessionId))continue;
        const log=candidate.id===sourceBranch.id?sourceLog:await runtime.read(candidate.sessionId);
        if(historyContains(workflow,predecessor,candidate)&&atTail(log,boundary)&&clean(log)){target=candidate;break;}
      }
      if(!target)target=await this.forkQueuedContext(workflow,run,sourceBranch.sessionId,boundary,predecessor);
    }else{
      const log=await runtime.read(branch.sessionId);
      if(!forceCoordinator&&clean(log))target=branch;
      else target=await this.forkQueuedContext(workflow,run,scope.forkBoundarySeq===undefined?undefined:scope.sourceSessionId,scope.forkBoundarySeq,undefined,scope);
    }
    // A prepared Fork can survive a response loss or restart. Its identity is
    // durable, but its current content still needs checking before submission.
    const targetLog=await runtime.read(target.sessionId);
    if(!clean(targetLog)||predecessor&&(!historyContains(this.workflow(workflow.id),predecessor,target)||!atTail(targetLog,compactionContinuationBoundary(targetLog,predecessor.endSeq!))))return reject('已准备的分支会话内容发生变化，无法确认上下文隔离；本次未向 Agent 提交。请从干净历史重新创建分支。');
    const saved=await this.write(workflow.id,item=>({...item,...(branch.automatic&&item.activeBranchId===branch.id?{activeBranchId:target!.id}:{}),executions:item.executions!.map(candidate=>candidate.runId===run.runId?{...candidate,branchId:target!.id,sessionId:target!.sessionId,updatedAt:Date.now()}:candidate),branches:item.branches!.map(candidate=>candidate.id===target!.id?{...candidate,nodeIds:[...new Set([...candidate.nodeIds,run.nodeId])]}:candidate)}));
    return saved.executions!.find(item=>item.runId===run.runId)!;
  }
  private async forkQueuedContext(workflow:M.Workflow,run:M.Execution,source:string|undefined,atSeq:number|undefined,predecessor?:M.Execution,scope?:M.Branch):Promise<M.Branch>{
    const operationId=`route-${run.runId}`,previous=workflow.operations!.find(item=>item.id===operationId);
    if(previous){
      const prepared=workflow.branches!.find(item=>item.sessionId===previous.childSessionId);
      if(previous.status==='completed'&&prepared)return prepared;
      fail('Automatic context Fork requires reconciliation; it was not repeated');
    }
    const current=await this.write(workflow.id,item=>({...item,operations:[...item.operations!,{id:operationId,kind:'fork',status:'pending',createdAt:Date.now(),runId:run.runId,nodeId:run.nodeId,sourceSessionId:source,atSeq}]}));
    try{
      const title=workflow.nodes.find(item=>item.id===run.nodeId)!.title;
      return await this.newBranch(current,source,atSeq,branchCaption(predecessor?workflow.nodes.find(node=>node.id===predecessor.nodeId):undefined,title).slice(0,160),operationId,predecessor,true,true,scope);
    }catch(error){await this.operationFailure(workflow.id,operationId,error);throw error;}
  }
  /** Auto is a graph decision over explicitly requested work, with no model call. */
  private useSubagent(workflow:M.Workflow,run:M.Execution):boolean{
    const mode=run.admissionPolicies?.subagents??'off';
    if(run.resolvedAccessMode==='auto')return false;
    if(mode==='off'||!this.runtime().supportsSubagents?.())return false;
    if(mode==='on')return true;
    const branch=workflow.branches!.find(item=>item.id===run.branchId)!;
    if(!this.branchBusy(workflow,branch))return false;
    const scope=manualScope(workflow,branch),ancestors=new Set(ancestorIds(workflow,run.nodeId));
    const active=workflow.executions!.filter(other=>activeExecution(other)&&manualScope(workflow,workflow.branches!.find(b=>b.id===other.branchId)!).id===scope.id);
    return active.length>0&&active.every(other=>other.nodeId!==run.nodeId&&!ancestors.has(other.nodeId)&&!ancestorIds(workflow,other.nodeId).includes(run.nodeId));
  }
  private async prepareSubagent(workflow:M.Workflow,run:M.Execution):Promise<M.Execution>{
    const parent=workflow.branches!.find(branch=>branch.id===run.branchId)!;
    if(parent.sessionId===workflow.sourceSessionId)fail('A source Session cannot coordinate a subagent');
    const log=await this.runtime().read(parent.sessionId),completed=completedBoundary(log),boundary=completed===undefined?undefined:compactionContinuationBoundary(log,completed);
    const childId=randomUUID();
    const branch:M.Branch={id:uid('branch'),label:`子智能体 · ${taskCaption(workflow.nodes.find(node=>node.id===run.nodeId)!)}`.slice(0,160),sessionId:childId,sourceSessionId:parent.sessionId,parentBranchId:parent.id,forkBoundarySeq:boundary,nodeIds:[...parent.nodeIds],createdAt:Date.now(),automatic:true};
    const saved=await this.write(workflow.id,item=>{
      const queued=item.executions!.find(candidate=>candidate.runId===run.runId);
      if(!queued||queued.status!=='waiting'||!queueAuthorized(item,queued)||!prerequisitesComplete(item,queued.nodeId,parent))fail('Task changed before native child admission');
      const inputRunIds=contextCheck(item,parent).inputs(queued.nodeId).map(input=>input.runId);
      // Reserve the actual child identity and pending admission atomically. A
      // crash here is uncertain and never an ordinary waiting request to retry.
      return {...item,...(parent.automatic&&item.activeBranchId===parent.id?{activeBranchId:branch.id}:{}),branches:[...item.branches!,branch],executions:item.executions!.map(candidate=>candidate.runId===run.runId?{...candidate,status:'ready' as const,waitingReason:undefined,inputRunIds,startSeq:(boundary??-1)+1,branchId:branch.id,sessionId:childId,subagent:{parentSessionId:parent.sessionId,provider:'fork' as const},updatedAt:Date.now()}:candidate),operations:item.operations!.map(operation=>operation.kind==='run'&&operation.runId===run.runId?{...operation,status:'pending' as const,sourceSessionId:parent.sessionId,childSessionId:childId}:operation)};
    });
    return saved.executions!.find(candidate=>candidate.runId===run.runId)!;
  }
  private async dispatchQueue(workflowId:string):Promise<void>{
    if(this.stopped||this.recovering||!this.native)return;
    await this.serial(workflowId,async()=>{
      if(this.table().get(workflowId)?.archivedAt!==undefined)return;
      for(;;){
        let current=this.workflow(workflowId);
        if(current.executions!.some(run=>run.status==='waiting'&&!queueAuthorized(current,run)))current=await this.write(workflowId,item=>item);
        let selected:M.Execution|undefined,delegated=false;
        const reasons=new Map<string,M.Execution['waitingReason']>();
        for(const run of current.executions!.filter(run=>run.status==='waiting')){
          const branch=current.branches!.find(item=>item.id===run.branchId);if(!branch)continue;
          const check=contextCheck(current,branch);
          if(!check.ready(run.nodeId)){reasons.set(run.runId,check.stale(run.nodeId)?'stale_prerequisites':'prerequisites');continue;}
          if(run.admissionPolicies?.subagents==='on'&&!this.runtime().supportsSubagents?.()){reasons.set(run.runId,'subagent_unavailable');continue;}
          const child=this.useSubagent(current,run);
          if(child&&current.executions!.filter(item=>item.subagent&&(activeExecution(item)||item.status==='unknown'||item.durability==='needs-reconcile'||this.runtime().isRunning(item.sessionId))).length>=3){reasons.set(run.runId,'subagent_capacity');continue;}
          if(!child&&this.branchBusy(current,branch)){reasons.set(run.runId,'branch_busy');continue;}
          selected=run;delegated=child;break;
        }
        if([...reasons].some(([id,reason])=>current.executions!.find(run=>run.runId===id)?.waitingReason!==reason))current=await this.write(workflowId,item=>({...item,executions:item.executions!.map(run=>reasons.has(run.runId)?{...run,waitingReason:reasons.get(run.runId)}:run)}));
        if(!selected||this.stopped)return;
        let run=await this.routeQueuedExecution(current,selected,delegated);current=this.workflow(workflowId);
        if(run.status!=='waiting'){continue;}if(this.stopped)return;
        if(delegated){run=await this.prepareSubagent(current,run);current=this.workflow(workflowId);}
        const branch=current.branches!.find(item=>item.id===run.branchId)!;
        const operation=current.operations!.find(item=>item.kind==='run'&&item.runId===run.runId);if(!operation)fail('Queued execution has no durable operation identity');
        const log=await this.runtime().read(run.subagent?.parentSessionId??run.sessionId);if(this.stopped)return;
        let admitted=false;
        current=await this.write(workflowId,item=>{
          const queued=item.executions!.find(candidate=>candidate.runId===run.runId);
          const busy=this.branchBusy({...item,executions:run.subagent?item.executions!.filter(candidate=>candidate.runId!==run.runId):item.executions},branch);
          if(!queued||queued.status!=='waiting'&&!(run.subagent&&queued.status==='ready')||!queueAuthorized(item,queued)||!prerequisitesComplete(item,queued.nodeId,branch)||busy)return item;
          admitted=true;
          const inputRunIds=contextCheck(item,branch).inputs(queued.nodeId).map(input=>input.runId);
          return {...item,executions:item.executions!.map(candidate=>candidate.runId===run.runId?{...candidate,status:'ready',waitingReason:undefined,inputRunIds,startSeq:((run.subagent?completedBoundary(log):log.events.at(-1)?.seq)??-1)+1,updatedAt:Date.now()}:candidate),operations:item.operations!.map(candidate=>candidate.id===operation.id?{...candidate,status:'pending',sourceSessionId:run.subagent?.parentSessionId??run.sessionId,...(run.subagent?{childSessionId:run.sessionId}:{})}:candidate)};
        });
        if(!admitted||this.stopped)return;
        const node=current.nodes.find(item=>item.id===run.nodeId)!;
        try{
          const task={text:`Task: ${node.title}\n\n${node.instruction}`,files:node.attachments?.map(attachment=>attachment.file),model:run.resolvedModel};
          if(run.subagent){
            const receipt=await this.runtime().startSubagent!({...task,parentSessionId:run.subagent.parentSessionId,childSessionId:run.sessionId,label:taskCaption(node),accessMode:run.resolvedAccessMode});
            await this.write(workflowId,item=>({...item,executions:item.executions!.map(candidate=>candidate.runId===run.runId?{...candidate,subagent:{...candidate.subagent!,messageId:receipt.messageId}}:candidate)}));
          }else {
            if(run.resolvedAccessMode)await this.controls?.applyAccessMode(run.sessionId,run.resolvedAccessMode);
            await this.runtime().submit({...task,sessionId:run.sessionId,requestId:run.requestId});
          }
          if(this.workspaces)try{await this.workspaces.rename(run.sessionId,nativeSessionCaption(current,node,branch.label));await this.workspaces.attach(run.sessionId,current.workspaceId);}catch(error){this.ctx.logger.warn('Workflow native Session label or workspace could not be updated',error);}
          await this.write(workflowId,item=>({...item,operations:item.operations!.map(candidate=>candidate.id===operation.id?{...candidate,status:'completed'}:candidate)}));
          await this.reconcileSession(run.sessionId);
        }catch(error){await this.operationFailure(workflowId,operation.id,error);throw error;}
      }
    });
  }
  private queuePolicies(workflowId:string):void{
    if(this.stopped||this.recovering||!this.native||this.archiveFlights.has(workflowId)||this.pausedPolicies.has(workflowId))return;
    if(this.table().get(workflowId)?.archivedAt!==undefined)return;
    if(this.policyFlights.has(workflowId)){this.policyAgain.add(workflowId);return;}
    if(this.policyTimers.has(workflowId))return;
    this.policyTimers.set(workflowId,setTimeout(()=>{
      this.policyTimers.delete(workflowId);if(this.stopped||this.recovering||!this.native)return;
      this.policyFlights.add(workflowId);
      void this.advancePolicies(workflowId).catch(error=>this.ctx.logger.error('Workflow policy requires attention',error)).finally(()=>{
        this.policyFlights.delete(workflowId);
        if(this.policyAgain.delete(workflowId))this.queuePolicies(workflowId);
      });
    },25));
  }
  /** Only explicitly clicked Run requests advance; proposals stay inert. */
  private async advancePolicies(workflowId:string):Promise<void>{
    if(this.stopped||!this.native||this.archiveFlights.has(workflowId)||this.pausedPolicies.has(workflowId))return;
    if(this.table().get(workflowId)?.archivedAt!==undefined)return;
    let current=this.workflow(workflowId);
    if(current.settings!.generation==='dynamic'){
      const completed=current.executions!.filter(run=>run.admissionPolicies?.generation==='dynamic'&&run.status==='completed'&&run.durability==='durable'&&run.endSeq!==undefined);
      for(const run of completed){
        current=this.workflow(workflowId);if(current.settings!.generation!=='dynamic')break;
        const operationId=policyOperationId('dynamic-plan',run.runId);
        if(current.operations!.some(operation=>operation.id===operationId))continue;
        const task=current.nodes.find(node=>node.id===run.nodeId);
        const goal=`Review this successfully completed task and propose only necessary follow-up tasks for user review. Do not repeat existing tasks. Do not execute or approve anything.\n\nCompleted task: ${task?.title??run.nodeId}\nTask instructions: ${task?.instruction??''}\nObservable result: ${run.summary??''}\nExisting task titles: ${current.nodes.filter(node=>node.kind!=='session').map(node=>node.title).join('; ')}`.slice(0,20000);
        await this.generatePlanAction({workflowId,goal,sourceSessionId:run.sessionId,operationId},run.runId);
      }
    }
    await this.dispatchQueue(workflowId);
  }
  private async newBranch(workflow:M.Workflow,source:string|undefined,atSeq:number|undefined,label:string,operationId:string,run?:M.Execution,attach=true,automatic=false,scope?:M.Branch):Promise<M.Branch>{
    const runtime=this.runtime();let child:{sessionId:string};let boundary=atSeq;
    if(this.stopped)fail('Workflow plugin is stopping');
    if(source){const log=await runtime.read(source);if(this.stopped)fail('Workflow plugin is stopping');boundary=completedBoundary(log,atSeq);if(boundary===undefined){if(log.events.length)fail('Source Session has no safe completed turn boundary');child=await runtime.create({cwd:log.header.cwd,agentPreset:log.header.agentPreset});}else child=await runtime.fork({sessionId:source,atSeq:boundary});}
    else {const base=scope?await runtime.read(scope.sessionId):undefined;child=await runtime.create({sessionId:randomUUID(),...(base?{cwd:base.header.cwd,agentPreset:base.header.agentPreset}:{cwd:this.workspacePath(workflow)})});}
    if(child.sessionId===source||workflow.branches!.some(branch=>branch.sessionId===child.sessionId))fail('Native child Session identity is not independent');
    const parent=workflow.branches!.find(branch=>branch.sessionId===source);
    const shared=run?workflow.nodes.filter(node=>node.kind==='session'||workflow.executions!.some(execution=>execution.nodeId===node.id&&execution.status==='completed'&&execution.endSeq!==undefined&&(
      !!parent&&historyContains(workflow,execution,parent,boundary)
    ))).map(node=>node.id):workflow.nodes.filter(node=>node.kind==='session').map(node=>node.id);
    const displayLabel=run&&!automatic?branchCaption(workflow.nodes.find(node=>node.id===run.nodeId),label).slice(0,160):label;
    const branch:M.Branch={id:uid('branch'),label:displayLabel,sessionId:child.sessionId,sourceSessionId:source,parentBranchId:parent?.id??scope?.id,forkFromNodeId:run?.nodeId,forkBoundarySeq:boundary,nodeIds:shared,createdAt:Date.now(),...(automatic?{automatic:true}:{})};
    await this.write(workflow.id,current=>{const next={...current,...(attach?{...(!automatic?{activeBranchId:branch.id}:{}),branches:[...current.branches!,branch]}:{}),operations:current.operations!.map(operation=>operation.id===operationId?{...operation,childSessionId:child.sessionId,status:operation.kind==='fork'?'completed' as const:operation.status}:operation)};next.nodes=projectNodes(next);return next;});
    return branch;
  }
  private project(log:NativeSessionLog,run:M.Execution):NativeExecutionProjection{
    const projection=projectExecution(log,{runId:run.runId,requestId:run.requestId,messageId:run.subagent?.messageId,startSeq:run.startSeq,running:this.runtime().isRunning(run.sessionId)});
    const replies=this.runtime().pendingQuestionReplies?.(run.sessionId)??[];
    if(replies.some(callId=>projection.steps.some(step=>step.toolName==='ask_user_question'&&step.callId===callId)))return {...projection,status:'queued',endSeq:undefined,terminalReason:undefined};
    return run.durability==='needs-reconcile'&&!projection.turns.length?{...projection,status:'unknown'}:projection;
  }
  private schedule(sessionId:string):void{
    if(this.scheduled.has(sessionId))return;
    this.scheduled.set(sessionId,setTimeout(()=>{this.scheduled.delete(sessionId);void this.reconcileSession(sessionId).catch(error=>this.ctx.logger.error('Workflow event projection failed',error));},80));
  }
  private async reconcileSession(sessionId:string):Promise<void>{
    const runtime=this.runtime();
    for(const [workflowId,raw] of this.table().entries()){
      if(raw.archivedAt!==undefined||this.archiveFlights.has(workflowId))continue;
      const workflow=normalized(raw),runs=workflow.executions!.filter(run=>run.sessionId===sessionId);if(!runs.length)continue;
      const log=await runtime.read(sessionId),questions=await runtime.questions?.(sessionId)??[];let changed=false;
      const projected=new Map<string,M.Execution>();
      for(const run of runs){if(localQueueRecord(run)||run.terminalReason==='queue-removed'||run.subagent&&!run.subagent.messageId&&run.status==='ready'&&workflow.operations!.some(operation=>operation.runId===run.runId&&operation.status==='pending'))continue;const projection=this.project(log,run);const status:M.WorkflowStatus=projection.endSeq===undefined&&questions.some(question=>question.actionable&&question.state==='open'&&this.questionBelongs(log,run,question.callId))?'waiting_answer':nativeStatus(projection.status);let durability=run.durability;
        if(projection.endSeq!==undefined){await runtime.flush(sessionId);durability='durable';}
        else if(!runtime.isRunning(sessionId)&&status==='unknown')durability='needs-reconcile';
        const turns=projection.turns.map(turnNumber=>{const start=log.events.find(event=>event.type==='turn/start'&&event.data.turn===turnNumber);const end=log.events.find(event=>event.type==='turn/end'&&event.data.turn===turnNumber);return {turn:turnNumber,startSeq:start?.seq??projection.startSeq??0,endSeq:end?.seq,reason:end&&typeof end.data.reason==='object'&&end.data.reason!==null?String((end.data.reason as {kind?:unknown}).kind??'unknown'):undefined};});
        const next={...run,status,startSeq:projection.startSeq??run.startSeq,endSeq:projection.endSeq,turns,summary:projection.assistantText,terminalReason:projection.terminalReason,durability};
        if(JSON.stringify({...run,updatedAt:0})!==JSON.stringify({...next,updatedAt:0})){changed=true;projected.set(run.runId,{...next,updatedAt:Date.now()});}
      }
      if(changed&&!this.archiveFlights.has(workflowId)&&this.table().get(workflowId)?.archivedAt===undefined)await this.write(workflowId,current=>{
        const executions=current.executions!.map(run=>projected.get(run.runId)??run);
        const next={...current,executions};return {...next,nodes:projectNodes(next)};
      });
      this.queuePolicies(workflowId);
    }
  }
  private async operationFailure(workflowId:string,operationId:string,error:unknown):Promise<void>{
    await this.write(workflowId,current=>({...current,operations:current.operations!.map(operation=>operation.id===operationId?{...operation,status:'needs-reconcile',error:err(error)}:operation),executions:current.executions!.map(run=>current.operations!.some(operation=>operation.id===operationId&&operation.runId===run.runId)?{...run,status:'unknown',durability:'needs-reconcile',error:err(error)}:run),plans:current.plans!.map(plan=>current.operations!.some(operation=>operation.id===operationId&&operation.kind==='plan'&&operation.runId===plan.requestId)?{...plan,status:'needs-reconcile',error:err(error)}:plan)}));
  }
  private finishPlanLater(workflowId:string,planId:string):void{
    let settling:M.WorkflowPlan|undefined;
    const unchanged=(plan:M.WorkflowPlan)=>plan.id===planId&&plan.status===settling?.status&&plan.error===settling?.error;
    void (async()=>{
      const plan=this.workflow(workflowId).plans!.find(item=>item.id===planId);if(!plan)return;settling=plan;const runtime=this.runtime();await runtime.waitForIdle(plan.sessionId);
      if(this.archiveFlights.has(workflowId)||this.table().get(workflowId)?.archivedAt!==undefined)return;
      await runtime.flush(plan.sessionId);
      const log=await runtime.read(plan.sessionId);
      const projection=projectExecution(log,{runId:plan.id,requestId:plan.requestId,running:runtime.isRunning(plan.sessionId)});
      if(projection.status!=='completed')throw new Error(`Planning request did not complete successfully (${projection.status})`);
      const text=assistantTextForRequest(log,plan.requestId);const content=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
      const parsed=parse(V.structuredPlanSchema,JSON.parse(content));
      if(this.archiveFlights.has(workflowId)||this.table().get(workflowId)?.archivedAt!==undefined)return;
      if(!this.table().get(workflowId)?.plans?.some(unchanged))return;
      await this.write(workflowId,current=>({...current,plans:current.plans!.map(item=>unchanged(item)?{...item,status:'proposed',tasks:parsed.tasks,error:undefined}:item)}));
    })().catch(async error=>{if(this.archiveFlights.has(workflowId)||this.table().get(workflowId)?.archivedAt!==undefined||!this.table().get(workflowId)?.plans?.some(unchanged))return;try{await this.write(workflowId,current=>({...current,plans:current.plans!.map(item=>unchanged(item)?{...item,status:'failed',error:err(error)}:item)}));}catch{this.ctx.logger.error('Workflow plan settlement failed',error);}});
  }
  private async recover():Promise<void>{
    this.recovering=true;
    try{
    const sessions=new Set<string>();
    // Register every durable planning identity before resuming any request.
    // Reopening an accepted/rejected plan Session must retain the same guard.
    for(const [,raw] of this.table().entries())for(const plan of normalized(raw).plans!)this.runtime().protectPlanning(plan.sessionId,plan.attachments?.map(attachment=>attachment.file));
    for(const [id,raw] of this.table().entries()){
      if(raw.archivedAt!==undefined)continue;
      const workflow=normalized(raw);for(const run of workflow.executions!)sessions.add(run.sessionId);
      if(workflow.operations!.some(operation=>operation.status==='pending'))await this.write(id,current=>{
        const uncertain=new Set(current.operations!.filter(operation=>(operation.kind==='run'||operation.kind==='fork')&&operation.status==='pending').map(operation=>operation.runId));
        const uncertainForks=new Set(current.operations!.filter(operation=>operation.kind==='fork'&&operation.status==='pending').map(operation=>operation.runId));
        const error='Host restarted before the native admission outcome was durably confirmed; it was not resubmitted';
        return {...current,operations:current.operations!.map(operation=>operation.status==='pending'?{...operation,status:'needs-reconcile',error}:operation),executions:current.executions!.map(run=>uncertain.has(run.runId)&&(run.status!=='waiting'||uncertainForks.has(run.runId))?{...run,status:'unknown',durability:'needs-reconcile',error}:run)};
      });
      for(const plan of workflow.plans!){
        // Retry only this known old parser incompatibility, from the completed
        // native request. Never submit again or revive accepted/rejected plans.
        const omittedDependencies=plan.status==='failed'&&/^Invalid workflow data: tasks\.\d+\.dependsOn: Invalid input: expected array, received undefined(?:; tasks\.\d+\.dependsOn: Invalid input: expected array, received undefined)*$/.test(plan.error??'')&&workflow.operations!.some(operation=>operation.kind==='plan'&&operation.runId===plan.requestId&&operation.status==='completed');
        if(plan.status==='running'||omittedDependencies)this.finishPlanLater(id,plan.id);
      }
    }
    for(const session of sessions)try{await this.reconcileSession(session);}catch(error){this.ctx.logger.error('Workflow execution requires reconciliation',error);}
    }finally{
      this.recovering=false;
      for(const [id] of this.table().entries())this.queuePolicies(id);
    }
  }
}
export default VisualWorkflowService;
