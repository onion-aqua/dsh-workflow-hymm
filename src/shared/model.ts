/** Workflow metadata and native event references. Raw Session logs never live here. */
import { layoutDependencyNodes } from './layout.ts';
export interface Position { x: number; y: number }
export interface NodeSize { width: number; height: number }
export interface Viewport extends Position { zoom: number }
export const WORKFLOW_PLUGIN_VERSION='0.17.1';
export const WORKFLOW_API_VERSION=3;
/** Native model identity only; provider configuration and credentials stay in DSH. */
export interface WorkflowModelIdentity { provider: string; model: string; /** Provider-owned native reasoning effort; omitted follows the model default. */ reasoningEffort?: string }
export interface WorkflowReasoningEffort { id: string; name: string; description?: string }
export interface WorkflowReasoningMetadata { efforts: WorkflowReasoningEffort[]; defaultEffort?: string }
export interface WorkflowModelOption extends WorkflowModelIdentity { label: string; reasoning?: WorkflowReasoningMetadata }
export interface WorkflowModelsValue { models: WorkflowModelOption[]; defaultModel?: WorkflowModelIdentity }
export interface WorkflowCapabilitiesValue { pluginVersion: string; apiVersion: number; features: string[] }

export type WorkflowStatus = 'draft' | 'waiting' | 'ready' | 'running' | 'waiting_answer' | 'completed' | 'failed' | 'blocked' | 'cancelled' | 'interrupted' | 'unknown';
export interface WorkflowFileReference { attachmentId: string; name: string; bytes: number }
export interface WorkflowNodeAttachment { id: string; file: WorkflowFileReference; createdAt: number }
export interface NodeRevision { revision: number; title: string; instruction: string; dependencies: string[]; createdAt: number; attachments?: WorkflowNodeAttachment[]; model?: WorkflowModelIdentity }

export interface WorkflowNode {
  id: string;
  /** Stable human-readable number; the UUID remains the execution identity. */
  displayId?:number;
  title: string;
  instruction: string;
  source: 'user' | 'agent';
  status: WorkflowStatus;
  revision: number;
  position: Position;
  zIndex?: number;
  width?: number;
  height?: number;
  /** Visual cut/hide keeps the original task and all native execution references. */
  hidden?: boolean;
  kind?: 'task' | 'session';
  sourceSessionId?: string;
  answerSummary?: string;
  /** A completed result whose upstream executions no longer match this view. */
  resultStale?: boolean;
  branchIds?: string[];
  revisions?: NodeRevision[];
  originPlanId?: string;
  attachments?: WorkflowNodeAttachment[];
  /** Undefined follows the Workflow global model, then the DSH configured default. */
  model?: WorkflowModelIdentity;
}

export interface SessionRoot {
  sessionId: string; title: string; updatedAt: number; running: boolean; blank: boolean;
  parentSessionId?: string; cwd?: string; formatStatus?: string;
}
export interface Branch {
  id: string; label: string; sessionId: string; sourceSessionId?: string; parentBranchId?: string;
  forkFromNodeId?: string; forkBoundarySeq?: number; nodeIds: string[]; createdAt: number;
  /** A native path fork inside the nearest manually selected branch's canvas. */
  automatic?: boolean;
}
export interface TurnRef { turn: number; startSeq: number; endSeq?: number; reason?: string }
export interface Execution {
  runId: string; nodeId: string; nodeRevision: number; branchId: string; sessionId: string; requestId: string;
  status: WorkflowStatus; startSeq?: number; endSeq?: number; turns: TurnRef[];
  createdAt: number; updatedAt: number; summary?: string; error?: string; terminalReason?: string;
  durability: 'pending' | 'durable' | 'needs-reconcile';
  /** Policies explicitly approved with this exact admission; legacy runs have no automatic follow-ups. */
  admissionPolicies?: WorkflowSettings;
  /** Explicit Run click authorizes only this version, dependencies and policies. */
  authorizationFingerprint?: string;
  waitingReason?: 'prerequisites' | 'stale_prerequisites' | 'branch_busy' | 'subagent_capacity' | 'subagent_unavailable';
  /** Native child identity; its initial message has no Session RPC id. */
  subagent?: { parentSessionId:string; provider:'fork'; messageId?:string };
  /** Exact direct task inputs, resolved immediately before native admission. */
  inputRunIds?: string[];
  /** Resolved at explicit Run admission and never changed by later selection edits. */
  resolvedModel?: WorkflowModelIdentity;
  resolvedAccessMode?:string;
}
export interface Approval {
  id: string; nodeId: string; nodeRevision: number; fingerprint: string;
  decision: 'approved' | 'rejected'; createdAt: number;
  resolvedModel?: WorkflowModelIdentity;
}
export interface PlanTask { id: string; title: string; instruction: string; dependsOn: string[]; dependencyUnspecified?: boolean }
export interface WorkflowPlan {
  id: string; goal: string; sessionId: string; requestId: string; status: 'running' | 'proposed' | 'accepted' | 'rejected' | 'failed' | 'needs-reconcile';
  tasks: PlanTask[]; createdAt: number; error?: string; triggerRunId?: string;
  resolvedModel?: WorkflowModelIdentity;
  attachments?: WorkflowNodeAttachment[];
}
export interface OperationIntent {
  id: string; kind: 'run' | 'fork' | 'plan' | 'batch-run' | 'prepare-attachment' | 'attach' | 'prepare-plan-attachments' | 'attach-plan-files' | 'compact'; status: 'pending' | 'completed' | 'failed' | 'needs-reconcile';
  createdAt: number; nodeId?: string; runId?: string; sourceSessionId?: string; childSessionId?: string;
  atSeq?: number; error?: string; triggerRunId?: string; nodeIds?: string[]; runIds?: string[]; attachmentId?: string;
}
export type WorkflowSubagentMode='off'|'on'|'auto';
export interface WorkflowSettings { generation: 'manual' | 'suggest' | 'dynamic'; execution: 'manual' | 'approval' | 'auto'; model?: WorkflowModelIdentity; modelReasoning?:WorkflowModelIdentity[]; subagents?:WorkflowSubagentMode; accessMode?:string }
export interface WorkflowPreferences { questionTimeout?:{enabled:boolean;seconds:number}; sounds?:{enabled:boolean;completed:boolean;failed:boolean;question:boolean;approval:boolean} }
export interface WorkflowUtilityNode {id:string;title:string;position:Position;width:number;height:number;sessionId?:string;activeTool?:'files'|'terminal'|'browser'|'tools';terminal?:{id:string;sessionId:string;contentId:string}}
export type WorkflowAccessMode=string;
export interface WorkflowAccessOption {id:string;label:string;description?:string;sandbox:'read-only'|'workspace-write'|'danger-full-access';approval:'ask'|'never'}
export interface WorkflowAccessCatalog {options:WorkflowAccessOption[];defaultPreset:string}
export type WorkflowApprovalDecision='allowed-once'|'rejected';
export interface WorkflowPendingApproval {workflowId:string;runId:string;nodeId:string;sessionId:string;approvalId:string;callId?:string;toolName:string;reason?:string;command?:string;input?:string;actionable:boolean;createdAt:number}
export interface WorkflowWorkspaceOption {id:string;title:string;path:string}
export interface WorkflowSkillOption {name:string;description?:string;source?:string}
/** Read-only native Session context, never cumulative billing usage. */
export interface WorkflowContextValue {
  sessionId?:string;label:string;usedTokens?:number;capacityTokens?:number;
  source:'projected'|'pressure'|'unavailable';readOnly:boolean;canCompact:boolean;
  unavailableReason?:string;configurationIssue?:string;compacting:boolean;
  autoAvailable?:boolean;manualAvailable?:boolean;capabilitiesKnown?:boolean;lastCompactedAt?:number;
  summaryModel?:WorkflowModelIdentity;
}
export interface WorkflowContextRequest {workflowId?:string;branchId?:string;nodeId?:string;sessionId?:string;planning?:boolean}
export interface WorkflowCompactRequest {workflowId:string;sessionId:string;operationId:string}
export interface WorkflowCompactValue {workflow:Workflow;context:WorkflowContextValue;changed:boolean}
export interface WorkflowSkillsValue {skills:WorkflowSkillOption[]}
export interface TraceStep {
  stepId: string; eventStartSeq: number; eventEndSeq?: number; type: 'agent_step' | 'tool_call' | 'tool_result' | 'command' | 'file_operation' | 'approval' | 'error';
  title: string; status: WorkflowStatus; timestamp: number; toolName?: string; callId?: string; parentStepId?: string;
  actionKind?: 'read' | 'edit' | 'write' | 'command' | 'search' | 'fetch' | 'tool';
  target?: string;
}
export interface ExecutionTrace { runId: string; sessionId: string; status: WorkflowStatus; startSeq?: number; endSeq?: number; steps: TraceStep[]; summary?: string; terminalReason?: string; error?:string }
export interface ExecutionStepDetails { stepId: string; eventName: string; timestamp: number; status: WorkflowStatus; toolName?: string; input?: string; command?: string; output?: string; error?: string; truncated?: boolean }
export interface CatalogLayout { revision: number; positions: Record<string, Position>; viewport: Viewport; zIndices?: Record<string, number>; sizes?: Record<string, NodeSize>; groups?: WorkflowGroup[] }

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type: 'dependency';
}
/** A visual collection of existing node identities, never an Agent or Session. */
export interface WorkflowGroup { id: string; title: string; nodeIds: string[] }

export interface Workflow {
  id: string;
  name: string;
  schemaVersion: 1 | 2;
  revision: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  groups?: WorkflowGroup[];
  viewport: Viewport;
  createdAt: number;
  updatedAt: number;
  /** Recoverable metadata-only deletion; native Sessions and complete history remain intact. */
  archivedAt?: number;
  sourceSessionId?: string;
  /** Private plugin-owned staging context; never the imported read-only source. */
  uploadSessionId?: string;
  /** Host-verified durable references retained for same-workflow copy/cut/undo. */
  attachmentReferences?: WorkflowNodeAttachment[];
  /** Verified native references for the next explicit planning submission. */
  planningAttachments?: WorkflowNodeAttachment[];
  activeBranchId?: string;
  branches?: Branch[];
  executions?: Execution[];
  approvals?: Approval[];
  plans?: WorkflowPlan[];
  operations?: OperationIntent[];
  settings?: WorkflowSettings;
  /** UI and interaction preferences do not change execution authorization. */
  preferences?:WorkflowPreferences;
  utilityNodes?:WorkflowUtilityNode[];
  /** Host-owned allocation ledger keeps numbers stable across undo/redo. */
  nodeSerials?:Record<string,number>;
  nextDisplayId?:number;
  workspaceId?:string;
  organizeNativeNames?:boolean;
}

export interface WorkflowListValue { workflows: Workflow[] }
export interface WorkflowGetRequest { id: string }
export interface WorkflowGetValue { workflow: Workflow | null }
export interface WorkflowCreateRequest { name: string }
export interface WorkflowCreateValue { workflow: Workflow }
export interface WorkflowDeleteRequest { workflowId: string; expectedRevision: number }
export type WorkflowDeleteValue = { ok: true; workflowId: string } | { ok: false; code: 'conflict' | 'not-found'; workflow: Workflow | null };
/** rc.3 provides durable native archival, not physical Session-log deletion. */
export interface WorkflowSessionArchivePreviewRequest {workflowId:string}
export interface WorkflowSessionArchivePreviewValue {workflowId:string;expectedRevision:number;available:boolean;sessionIds:string[];protectedCount:number;alreadyArchivedCount:number;reason?:string}
export interface WorkflowSessionArchiveRequest {workflowId:string;expectedRevision:number;sessionIds:string[]}
export interface WorkflowSessionArchiveValue {archivedSessionIds:string[];failedSessionIds:string[];skippedSessionIds:string[]}
export interface WorkflowSaveRequest { workflow: Workflow; expectedRevision: number }
export type WorkflowSaveValue = { ok: true; workflow: Workflow } | {
  ok: false;
  code: 'conflict' | 'not-found';
  workflow: Workflow | null;
};
export interface WorkflowCatalogValue { sessions: SessionRoot[]; layout: CatalogLayout }
export interface WorkflowCatalogLayoutRequest { layout: CatalogLayout; expectedRevision: number }
export interface WorkflowCatalogLayoutValue { ok: boolean; layout: CatalogLayout }
export interface WorkflowImportRequest { sessionId: string }
export interface WorkflowPrepareAttachmentRequest { workflowId: string; nodeId: string; nodeRevision: number; operationId: string }
export interface WorkflowPrepareAttachmentValue { workflow: Workflow; sessionId: string }
export interface WorkflowAttachRequest extends WorkflowPrepareAttachmentRequest { sessionId: string; receiptId: string }
export interface WorkflowAttachFilesRequest extends WorkflowPrepareAttachmentRequest { sessionId: string; receiptIds: string[] }
export interface WorkflowPreparePlanAttachmentsRequest { workflowId: string; operationId: string }
export interface WorkflowAttachPlanFilesRequest extends WorkflowPreparePlanAttachmentsRequest { sessionId: string; receiptIds: string[] }
export interface WorkflowApproveRequest { workflowId: string; nodeId: string; approved: boolean }
export interface WorkflowRunRequest { workflowId: string; nodeId: string; nodeRevision?: number; branchId?: string; operationId: string }
export interface WorkflowBatchRunRequest { workflowId: string; nodeIds: string[]; nodeRevisions: Record<string, number>; branchId?: string; operationId: string }
export interface WorkflowBatchRunValue { workflow: Workflow; runIds: string[] }
export interface WorkflowCancelRequest { workflowId: string; runId: string }
export interface WorkflowPauseRequest { workflowId: string }
export interface WorkflowTraceRequest { workflowId: string; runId: string }
export interface WorkflowTraceValue { trace: ExecutionTrace }
export interface WorkflowDetailsRequest extends WorkflowTraceRequest { stepId: string }
export interface WorkflowDetailsValue { details: ExecutionStepDetails }
/** Transient native userQuestions projection. Never stored in Workflow JSON. */
export interface WorkflowQuestionItem { id:string; question:string; detail?:string; header?:string; options?:{label:string;description?:string}[]; multiSelect?:boolean }
export interface WorkflowQuestionAnswer { id:string; selected:string[]; custom?:string }
export interface WorkflowPendingQuestion {
  workflowId:string; runId:string; nodeId:string; sessionId:string; callId:string;
  questions:WorkflowQuestionItem[]; state:'open'|'continued'; actionable:boolean; createdAt:number;
  autoContinueAt?:number;
  autoContinuePaused?:boolean;
}
export interface WorkflowQuestionsRequest { workflowId:string }
export interface WorkflowQuestionsValue { questions:WorkflowPendingQuestion[] }
export interface WorkflowAnswerQuestionRequest extends WorkflowTraceRequest { sessionId:string; callId:string; answers:WorkflowQuestionAnswer[] }
export interface WorkflowAnswerQuestionValue { accepted:boolean }
export interface WorkflowPauseQuestionRequest extends WorkflowTraceRequest {sessionId:string;callId:string}
export interface WorkflowApprovalsValue {approvals:WorkflowPendingApproval[]}
export interface WorkflowAnswerApprovalRequest extends WorkflowTraceRequest {sessionId:string;approvalId:string;decision:WorkflowApprovalDecision}
export interface WorkflowAccessModeRequest {workflowId:string;presetId?:string}
export interface WorkflowWorkspacesValue {workspaces:WorkflowWorkspaceOption[]}
export interface WorkflowWorkspaceRequest {workflowId:string;workspaceId?:string}
export interface WorkflowOrganizeValue {updatedSessionIds:string[];deferredSessionIds:string[]}
export interface WorkflowPlanRequest { workflowId: string; goal: string; sourceSessionId?: string; operationId: string; attachmentIds?: string[] }
export interface WorkflowApplyPlanRequest { workflowId: string; planId: string; accept: boolean; taskIds?: string[] }
export interface WorkflowForkRequest { workflowId: string; runId?: string; sessionId?: string; atSeq?: number; label: string; operationId: string }
export interface WorkflowActionValue { workflow: Workflow; runId?: string; planId?: string; branchId?: string }

/** A dependency graph has stable endpoints and no repeated edges or cycles. */
export function graphProblem(nodes: readonly Pick<WorkflowNode, 'id'>[], edges: readonly WorkflowEdge[]): string | null {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) return 'duplicate-node-id';
    ids.add(node.id);
  }
  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  const next = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const id of ids) { next.set(id, []); incoming.set(id, 0); }
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) return 'duplicate-edge-id';
    edgeIds.add(edge.id);
    if (!ids.has(edge.source) || !ids.has(edge.target)) return 'missing-endpoint';
    if (edge.source === edge.target) return 'self-dependency';
    const pair = JSON.stringify([edge.source, edge.target]);
    if (pairs.has(pair)) return 'duplicate-dependency';
    pairs.add(pair);
    next.get(edge.source)!.push(edge.target);
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
  }
  const ready = [...ids].filter(id => incoming.get(id) === 0);
  let visited = 0;
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index]!;
    visited++;
    for (const target of next.get(id)!) {
      incoming.set(target, incoming.get(target)! - 1);
      if (incoming.get(target) === 0) ready.push(target);
    }
  }
  return visited === ids.size ? null : 'dependency-cycle';
}

/** Deterministic left-to-right placement for a valid dependency graph. */
export function layoutWorkflow(workflow: Workflow): Workflow {
  if (graphProblem(workflow.nodes, workflow.edges)) return workflow;
  return {...workflow,nodes:layoutDependencyNodes(workflow.nodes,workflow.edges)};
}
