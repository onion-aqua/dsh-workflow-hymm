/** Validate records at RPC and durable storage boundaries. */
import { z } from 'zod';
import { graphProblem } from '../shared/model.ts';
import type { Workflow } from '../shared/model.ts';

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const reference = z.string().min(1).max(512);
const coordinate = z.number().finite().min(-10_000_000).max(10_000_000);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const seq = z.number().int().nonnegative();
const position = z.object({ x: coordinate, y: coordinate }).strict();
const zIndex = z.number().int().min(0).max(1_000_000);
const viewport = z.object({ x: coordinate, y: coordinate, zoom: z.number().finite().min(0.05).max(4) }).strict();
const status = z.enum(['draft','waiting','ready','running','waiting_answer','completed','failed','blocked','cancelled','interrupted','unknown']);
const width=z.number().finite().min(220).max(1600);
const height=z.number().finite().min(140).max(1200);
const nodeSize=z.object({width,height}).strict();
export const modelIdentitySchema=z.object({provider:z.string().trim().min(1).max(512),model:z.string().trim().min(1).max(512),reasoningEffort:z.string().trim().min(1).max(128).optional()}).strict();
const fileReference=z.object({attachmentId:reference,name:z.string().min(1).max(1024),bytes:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict();
const nodeAttachment=z.object({id,file:fileReference,createdAt:timestamp}).strict();
const attachments=z.array(nodeAttachment).max(100).superRefine((items,ctx)=>{if(new Set(items.map(item=>item.id)).size!==items.length)ctx.addIssue({code:'custom',message:'duplicate attachment identity'});});
const nodeRevision = z.object({ revision: z.number().int().positive(), title: z.string().trim().min(1).max(160), instruction: z.string().max(20_000), dependencies: z.array(id), createdAt: timestamp,attachments:attachments.optional(),model:modelIdentitySchema.optional() }).strict();
const node = z.object({
  id, displayId:z.number().int().positive().max(1_000_000_000).optional(),title: z.string().trim().min(1).max(160), instruction: z.string().max(20_000),
  source: z.enum(['user', 'agent']), status, revision: z.number().int().positive(), position, zIndex: zIndex.optional(),width:width.optional(),height:height.optional(),hidden:z.boolean().optional(),
  kind: z.enum(['task','session']).optional(), sourceSessionId: reference.optional(),
  answerSummary: z.string().max(4000).optional(), resultStale:z.boolean().optional(), branchIds: z.array(id).optional(),
  revisions: z.array(nodeRevision).optional(), originPlanId: id.optional(),attachments:attachments.optional(),model:modelIdentitySchema.optional(),
}).strict();
const edge = z.object({ id, source: id, target: id, type: z.literal('dependency') }).strict();
const group=z.object({id,title:z.string().trim().min(1).max(128),nodeIds:z.array(id).min(1).max(1000)}).strict();
const catalogGroup=z.object({id,title:z.string().trim().min(1).max(128),nodeIds:z.array(reference).min(1).max(1000)}).strict();
const branch = z.object({ id, label: z.string().min(1).max(160), sessionId: reference, sourceSessionId: reference.optional(), parentBranchId: id.optional(), forkFromNodeId: id.optional(), forkBoundarySeq: seq.optional(), nodeIds: z.array(id), createdAt: timestamp, automatic:z.boolean().optional() }).strict();
const turn = z.object({ turn: seq, startSeq: seq, endSeq: seq.optional(), reason: z.string().max(128).optional() }).strict();
export const workflowSettingsSchema=z.object({generation:z.enum(['manual','suggest','dynamic']),execution:z.enum(['manual','approval','auto']),model:modelIdentitySchema.optional(),modelReasoning:z.array(modelIdentitySchema.extend({reasoningEffort:z.string().trim().min(1).max(128)})).max(500).refine(items=>new Set(items.map(item=>JSON.stringify([item.provider,item.model]))).size===items.length,'duplicate model reasoning selection').optional(),subagents:z.enum(['off','on','auto']).optional(),accessMode:reference.optional()}).strict();
const preferences=z.object({questionTimeout:z.object({enabled:z.boolean(),seconds:z.number().int().min(15).max(3600)}).strict().optional(),sounds:z.object({enabled:z.boolean(),completed:z.boolean(),failed:z.boolean(),question:z.boolean(),approval:z.boolean()}).strict().optional()}).strict();
const utilityNode=z.object({id,title:z.string().trim().min(1).max(160),position,width:z.number().finite().min(300).max(2400),height:z.number().finite().min(220).max(1600),sessionId:reference.optional(),activeTool:z.enum(['files','terminal','browser','tools']).optional(),terminal:z.object({id:reference,sessionId:reference,contentId:reference}).strict().optional()}).strict();
const resultInput=z.object({runId:id,sessionId:reference,requestId:reference,startSeq:seq,endSeq:seq,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const execution = z.object({ runId:id,nodeId:id,nodeRevision:z.number().int().positive(),branchId:id,sessionId:reference,requestId:reference,status,startSeq:seq.optional(),endSeq:seq.optional(),turns:z.array(turn),createdAt:timestamp,updatedAt:timestamp,summary:z.string().max(4000).optional(),error:z.string().max(4000).optional(),terminalReason:z.string().max(128).optional(),durability:z.enum(['pending','durable','needs-reconcile']),admissionPolicies:workflowSettingsSchema.optional(),authorizationFingerprint:z.string().max(128).optional(),waitingReason:z.enum(['prerequisites','stale_prerequisites','branch_busy','subagent_capacity','subagent_unavailable']).optional(),subagent:z.object({parentSessionId:reference,provider:z.literal('fork'),messageId:reference.optional()}).strict().optional(),inputRunIds:z.array(id).max(1000).optional(),resultInputs:z.array(resultInput).min(1).max(1000).optional(),resultInputBranchId:id.optional(),resolvedModel:modelIdentitySchema.optional(),resolvedAccessMode:reference.optional() }).strict();
const approval = z.object({ id,nodeId:id,nodeRevision:z.number().int().positive(),fingerprint:z.string().max(128),decision:z.enum(['approved','rejected']),createdAt:timestamp,resolvedModel:modelIdentitySchema.optional(),resolvedAccessMode:reference.optional() }).strict();
export const planTaskSchema = z.object({ id, title:z.string().trim().min(1).max(160),instruction:z.string().max(20_000),dependsOn:z.array(id).max(100),dependencyUnspecified:z.boolean().optional() }).strict();
// Only generated input tolerates omission. Stored tasks retain an explicit
// array and a review marker, without inferring edges from their list order.
const generatedPlanTaskSchema=planTaskSchema.omit({dependencyUnspecified:true}).extend({dependsOn:planTaskSchema.shape.dependsOn.optional()}).transform(task=>({...task,dependsOn:task.dependsOn??[],...(task.dependsOn===undefined?{dependencyUnspecified:true}:{})}));
export const structuredPlanSchema = z.object({ tasks:z.array(generatedPlanTaskSchema).min(1).max(100) }).strict().superRefine((value,ctx)=>{
  const problem=graphProblem(value.tasks,value.tasks.flatMap(task=>task.dependsOn.map(source=>({id:`${source}-${task.id}`,source,target:task.id,type:'dependency' as const}))));
  if(problem)ctx.addIssue({code:'custom',message:problem});
});
const plan = z.object({id,goal:z.string().min(1).max(20000),sessionId:reference,requestId:reference,status:z.enum(['running','proposed','accepted','rejected','failed','needs-reconcile']),tasks:z.array(planTaskSchema),createdAt:timestamp,error:z.string().max(4000).optional(),triggerRunId:id.optional(),resolvedModel:modelIdentitySchema.optional(),attachments:attachments.optional()}).strict();
const operation=z.object({id,kind:z.enum(['run','fork','plan','batch-run','prepare-attachment','attach','prepare-plan-attachments','attach-plan-files','compact']),status:z.enum(['pending','completed','failed','needs-reconcile']),createdAt:timestamp,nodeId:id.optional(),runId:id.optional(),sourceSessionId:reference.optional(),childSessionId:reference.optional(),atSeq:seq.optional(),error:z.string().max(4000).optional(),triggerRunId:id.optional(),nodeIds:z.array(id).optional(),runIds:z.array(id).optional(),attachmentId:id.optional()}).strict();

export const workflowSchema: z.ZodType<Workflow> = z.object({
  id, name:z.string().trim().min(1).max(128),schemaVersion:z.union([z.literal(1),z.literal(2)]),revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  nodes:z.array(node).max(1000),edges:z.array(edge).max(3000),groups:z.array(group).max(1000).optional(),viewport,createdAt:timestamp,updatedAt:timestamp,archivedAt:timestamp.optional(),
  sourceSessionId:reference.optional(),uploadSessionId:reference.optional(),attachmentReferences:z.array(nodeAttachment).max(10000).optional(),planningAttachments:attachments.optional(),activeBranchId:id.optional(),branches:z.array(branch).optional(),executions:z.array(execution).optional(),approvals:z.array(approval).optional(),plans:z.array(plan).optional(),operations:z.array(operation).optional(),settings:workflowSettingsSchema.optional(),preferences:preferences.optional(),utilityNodes:z.array(utilityNode).max(30).optional(),nodeSerials:z.record(id,z.number().int().positive().max(1_000_000_000)).optional(),nextDisplayId:z.number().int().positive().max(1_000_000_001).optional(),workspaceId:reference.optional(),organizeNativeNames:z.boolean().optional(),
}).strict().superRefine((workflow,ctx)=>{
  const problem=graphProblem(workflow.nodes,workflow.edges);
  if(problem)ctx.addIssue({code:'custom',path:['edges'],message:problem});
  if(workflow.updatedAt<workflow.createdAt)ctx.addIssue({code:'custom',path:['updatedAt'],message:'updatedAt precedes createdAt'});
  const nodes=new Set(workflow.nodes.map(node=>node.id));
  const groupIds=new Set<string>();const groupedNodes=new Set<string>();
  for(const item of workflow.groups??[]){
    if(groupIds.has(item.id)||nodes.has(item.id))ctx.addIssue({code:'custom',path:['groups'],message:'group identity is duplicated or conflicts with a node'});
    groupIds.add(item.id);
    for(const nodeId of item.nodeIds){
      if(!nodes.has(nodeId))ctx.addIssue({code:'custom',path:['groups'],message:'group member must be an existing node; nested groups are unsupported'});
      if(groupedNodes.has(nodeId))ctx.addIssue({code:'custom',path:['groups'],message:'each node may belong to only one group without duplicate membership'});
      groupedNodes.add(nodeId);
    }
  }
  const branchIds=new Set<string>(); const branchSessions=new Set<string>();
  for(const item of workflow.branches??[]){
    if(branchIds.has(item.id)||branchSessions.has(item.sessionId))ctx.addIssue({code:'custom',message:'duplicate branch identity/session'});
    branchIds.add(item.id); branchSessions.add(item.sessionId);
    if(item.nodeIds.some(id=>!nodes.has(id)))ctx.addIssue({code:'custom',message:'branch has missing node'});
    if(workflow.sourceSessionId===item.sessionId)ctx.addIssue({code:'custom',message:'source session cannot be writable branch'});
  }
  for(const run of workflow.executions??[]){
    if(!nodes.has(run.nodeId)||!branchIds.has(run.branchId))ctx.addIssue({code:'custom',message:'execution has missing node/branch'});
    if(run.subagent){const owner=workflow.branches?.find(branch=>branch.id===run.branchId);if(run.sessionId===run.subagent.parentSessionId||run.subagent.parentSessionId===workflow.sourceSessionId||owner?.sessionId!==run.sessionId||owner.sourceSessionId!==run.subagent.parentSessionId)ctx.addIssue({code:'custom',message:'subagent execution must reference its distinct child Session and private coordinator'});}
  }
  if(workflow.uploadSessionId&&(workflow.uploadSessionId===workflow.sourceSessionId||branchSessions.has(workflow.uploadSessionId)))ctx.addIssue({code:'custom',message:'upload Session must be independent of source and execution branches'});
});
export const getRequestSchema=z.object({id}).strict();
export const createRequestSchema=z.object({name:z.string().trim().min(1).max(128)}).strict();
export const deleteRequestSchema=z.object({workflowId:id,expectedRevision:z.number().int().positive()}).strict();
export const pauseRequestSchema=z.object({workflowId:id}).strict();
export const saveRequestSchema=z.object({workflow:workflowSchema,expectedRevision:z.number().int().positive()}).strict().superRefine((request,ctx)=>{
  if(request.workflow.revision!==request.expectedRevision)ctx.addIssue({code:'custom',path:['expectedRevision'],message:'revision does not match expectedRevision'});
});
export const catalogLayoutSchema=z.object({revision:z.number().int().nonnegative(),positions:z.record(reference,position),viewport,zIndices:z.record(reference,zIndex).optional(),sizes:z.record(reference,nodeSize).optional(),groups:z.array(catalogGroup).max(1000).optional()}).strict().superRefine((layout,ctx)=>{
  const groupIds=new Set<string>();const groupedNodes=new Set<string>();
  for(const item of layout.groups??[]){
    if(groupIds.has(item.id))ctx.addIssue({code:'custom',path:['groups'],message:'duplicate catalog group identity'});
    groupIds.add(item.id);
    for(const nodeId of item.nodeIds){if(groupedNodes.has(nodeId))ctx.addIssue({code:'custom',path:['groups'],message:'each Session may belong to only one group without duplicate membership'});groupedNodes.add(nodeId);}
  }
  for(const groupId of groupIds)if(groupedNodes.has(groupId))ctx.addIssue({code:'custom',path:['groups'],message:'nested catalog groups are unsupported'});
});
export const catalogLayoutRequestSchema=z.object({layout:catalogLayoutSchema,expectedRevision:z.number().int().nonnegative()}).strict();
export const importRequestSchema=z.object({sessionId:reference}).strict();
export const prepareAttachmentRequestSchema=z.object({workflowId:id,nodeId:id,nodeRevision:z.number().int().positive(),operationId:id}).strict();
export const attachRequestSchema=prepareAttachmentRequestSchema.extend({sessionId:reference,receiptId:reference}).strict();
export const attachFilesRequestSchema=prepareAttachmentRequestSchema.extend({sessionId:reference,receiptIds:z.array(reference).min(1).max(100)}).strict().superRefine((request,ctx)=>{if(new Set(request.receiptIds).size!==request.receiptIds.length)ctx.addIssue({code:'custom',path:['receiptIds'],message:'duplicate upload receipt'});});
export const preparePlanAttachmentsRequestSchema=z.object({workflowId:id,operationId:id}).strict();
export const attachPlanFilesRequestSchema=preparePlanAttachmentsRequestSchema.extend({sessionId:reference,receiptIds:z.array(reference).min(1).max(100)}).strict().superRefine((request,ctx)=>{if(new Set(request.receiptIds).size!==request.receiptIds.length)ctx.addIssue({code:'custom',path:['receiptIds'],message:'duplicate upload receipt'});});
export const approveRequestSchema=z.object({workflowId:id,nodeId:id,approved:z.boolean()}).strict();
export const runRequestSchema=z.object({workflowId:id,nodeId:id,nodeRevision:z.number().int().positive().optional(),branchId:id.optional(),operationId:id}).strict();
export const batchRunRequestSchema=z.object({workflowId:id,nodeIds:z.array(id).min(1).max(1000),nodeRevisions:z.record(id,z.number().int().positive()),branchId:id.optional(),operationId:id}).strict().superRefine((request,ctx)=>{
  if(new Set(request.nodeIds).size!==request.nodeIds.length)ctx.addIssue({code:'custom',path:['nodeIds'],message:'duplicate selected node'});
  if(request.nodeIds.some(nodeId=>request.nodeRevisions[nodeId]===undefined)||Object.keys(request.nodeRevisions).some(nodeId=>!request.nodeIds.includes(nodeId)))ctx.addIssue({code:'custom',path:['nodeRevisions'],message:'versions must match the selected node IDs exactly'});
});
export const traceRequestSchema=z.object({workflowId:id,runId:id}).strict();
export const detailsRequestSchema=z.object({workflowId:id,runId:id,stepId:reference}).strict();
export const questionsRequestSchema=z.object({workflowId:id}).strict();
export const answerQuestionRequestSchema=z.object({workflowId:id,runId:id,sessionId:reference,callId:reference,answers:z.array(z.object({id:reference,selected:z.array(z.string().max(10000)).max(100),custom:z.string().max(20000).optional()}).strict()).min(1).max(100)}).strict();
export const pauseQuestionRequestSchema=z.object({workflowId:id,runId:id,sessionId:reference,callId:reference}).strict();
export const answerApprovalRequestSchema=z.object({workflowId:id,runId:id,sessionId:reference,approvalId:reference,decision:z.enum(['allowed-once','rejected'])}).strict();
export const accessModeRequestSchema=z.object({workflowId:id,presetId:reference.optional()}).strict();
export const workspaceRequestSchema=z.object({workflowId:id,workspaceId:reference.optional()}).strict();
export const contextRequestSchema=z.object({workflowId:id.optional(),branchId:id.optional(),nodeId:id.optional(),sessionId:reference.optional(),planning:z.boolean().optional()}).strict().superRefine((request,ctx)=>{if((request.nodeId||request.branchId)&&!request.workflowId)ctx.addIssue({code:'custom',path:['workflowId'],message:'A node or branch context requires a workflow'});});
export const compactRequestSchema=z.object({workflowId:id,sessionId:reference,operationId:id}).strict();
export const planRequestSchema=z.object({workflowId:id,goal:z.string().trim().min(1).max(20000),sourceSessionId:reference.optional(),operationId:id,attachmentIds:z.array(id).max(100).optional()}).strict().superRefine((request,ctx)=>{if(request.attachmentIds&&new Set(request.attachmentIds).size!==request.attachmentIds.length)ctx.addIssue({code:'custom',path:['attachmentIds'],message:'duplicate planning attachment identity'});});
export const applyPlanRequestSchema=z.object({workflowId:id,planId:id,accept:z.boolean(),taskIds:z.array(id).optional()}).strict();
export const forkRequestSchema=z.object({workflowId:id,runId:id.optional(),sessionId:reference.optional(),atSeq:seq.optional(),label:z.string().trim().min(1).max(160),operationId:id}).strict();
