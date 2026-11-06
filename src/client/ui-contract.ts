import type { Position, Viewport, WorkflowNodeAttachment, WorkflowPendingQuestion, WorkflowQuestionAnswer, WorkflowAccessOption, WorkflowPendingApproval, WorkflowApprovalDecision, WorkflowPreferences, WorkflowWorkspaceOption, WorkflowSessionArchivePreviewValue, WorkflowSessionArchiveValue } from '../shared/model.ts';
import type { RemoveNodeFile, UploadNodeFiles } from './NodeFileAttachments.tsx';
import type { NativeUtilityBridge } from './native-utility.ts';

/** Presentation facts supplied by the Host adapter; no raw Session events are stored here. */
export interface SessionRootCard {
  sessionId: string;
  title: string;
  preview?: string;
  updatedAt: number;
  status?: string;
  cwd?: string;
  parentSessionId?: string;
  position?: Position;
  zIndex?: number;
  width?: number;
  height?: number;
}
export interface BranchCard {
  id: string;
  label: string;
  sessionId: string;
  sourceSessionId?: string;
  parentBranchId?: string;
  forkBoundarySeq?: number;
  automatic?: boolean;
  nodeIds: readonly string[];
}
export interface ExecutionCard {
  subagent?: {parentSessionId:string;provider:'fork';messageId?:string};
  runId: string;
  nodeId: string;
  nodeRevision: number;
  branchId: string;
  sessionId: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  summary?: string;
  error?: string;
  terminalReason?: string;
  durability?: string;
  endSeq?: number;
  waitingReason?: 'prerequisites' | 'stale_prerequisites' | 'branch_busy' | 'subagent_capacity' | 'subagent_unavailable';
}
export interface PlanTaskCard {
  id: string;
  title: string;
  instruction: string;
  dependencies: readonly string[];
  dependencyUnspecified?: boolean;
}
export interface PlanCard {
  /** Native submission was durably acknowledged; failed admission retains composer text. */
  submitted?:boolean;
  id: string;
  goal: string;
  status: string;
  tasks: readonly PlanTaskCard[];
  error?: string;
}
export interface TraceStepCard {
  id: string;
  title: string;
  actionKind?: 'read' | 'edit' | 'write' | 'command' | 'search' | 'fetch' | 'tool';
  target?: string;
  type: 'agent_step' | 'tool_call' | 'tool_result' | 'command' | 'file_operation' | 'approval' | 'error';
  status: string;
  time?: number;
  eventName?: string;
  toolName?: string;
  eventStartSeq?: number;
  eventEndSeq?: number;
  parentStepId?: string;
  /** Populated only by a native event detail read, never copied into Workflow JSON. */
  input?: string;
  command?: string;
  output?: string;
  error?: string;
  truncated?: boolean;
  unavailable?: string;
}
export interface TraceCard {
  runId: string;
  status: string;
  steps: readonly TraceStepCard[];
  loading?: boolean;
  error?: string;
  detailsLoadingStepIds?: readonly string[];
}
/** Stable option keys are supplied by the Host adapter; labels are never native identities. */
export interface ModelOption { id:string;label:string;provider?:string;disabled?:boolean }
export interface ModelReasoningControl {
  steps: readonly { value: string; label: string; description?: string }[];
  value?: string;
  availability?: 'available' | 'unsupported' | 'unknown';
  unavailableMessage?: string;
  highlightLastStep?: boolean;
  disabled?: boolean;
  label?: string;
  isDefault?:boolean;
}
export type SubagentMode = 'off' | 'on' | 'auto';
export function questionRequestKey(question:Pick<WorkflowPendingQuestion,'workflowId'|'runId'|'sessionId'|'callId'>):string{return JSON.stringify([question.workflowId,question.runId,question.sessionId,question.callId]);}
export interface WorkflowRuntimeProps {
  contextUsage?:import('../shared/model.ts').WorkflowContextValue;
  contextLoading?:boolean;contextError?:string;compacting?:boolean;
  onContextTarget?:(target:{nodeId?:string;sessionId?:string;planning?:boolean}|null)=>void;
  onCompactContext?:()=>Promise<void>;
  skillOptions?:readonly import('../shared/model.ts').WorkflowSkillOption[];
  skillsLoading?:boolean;skillsError?:string;onReloadSkills?:()=>Promise<void>;
  sessionNamingNotice?:string;
  onOrganizeSessionNames?:()=>Promise<void>;
  nativeUtilityBridge?:NativeUtilityBridge;
  onPauseQuestionAutomation?:(question:WorkflowPendingQuestion)=>Promise<void>;
  accessModes?:readonly WorkflowAccessOption[];accessMode?:string;defaultAccessMode?:string;accessModesLoading?:boolean;accessModesError?:string;
  onSelectAccessMode?:(id:string|undefined)=>void|Promise<void>;onReloadAccessModes?:()=>void|Promise<void>;
  pendingApprovals?:readonly WorkflowPendingApproval[];submittingApprovalKeys?:readonly string[];approvalErrors?:Readonly<Record<string,string>>;approvalLoadError?:string;
  onReloadApprovals?:()=>void|Promise<void>;onDecideApproval?:(approval:WorkflowPendingApproval,decision:WorkflowApprovalDecision)=>Promise<void>;
  preferences?:WorkflowPreferences;onChangePreferences?:(preferences:WorkflowPreferences)=>void|Promise<void>;onTestSound?:()=>void|Promise<void>;
  workspaceOptions?:readonly WorkflowWorkspaceOption[];workspaceId?:string;workspacesLoading?:boolean;workspacesError?:string;onSelectWorkspace?:(id:string|undefined)=>void|Promise<void>;onReloadWorkspaces?:()=>void|Promise<void>;
  traces?:Readonly<Record<string,TraceCard>>;onWatchTraceRuns?:(runIds:readonly string[])=>void;
  pendingQuestions?:readonly WorkflowPendingQuestion[];
  submittingQuestionKeys?:readonly string[];
  questionErrors?:Readonly<Record<string,string>>;
  questionLoadError?:string;
  onReloadQuestions?:()=>void|Promise<void>;
  onAnswerQuestion?:(question:WorkflowPendingQuestion,answers:WorkflowQuestionAnswer[])=>Promise<void>;
  modelOptions?:readonly ModelOption[];
  modelsLoading?:boolean;
  modelsError?:string;
  modelAvailable?:boolean;
  /** Verified native model metadata projected into the menu's reasoning popover. */
  reasoningForOption?:(id:string|undefined)=>ModelReasoningControl|undefined;
  onReasoningChange?:(id:string|undefined,value:string|undefined)=>void|Promise<void>;
  reasoningForNodeOption?:(nodeId:string,id:string|undefined)=>ModelReasoningControl|undefined;
  onNodeReasoningChange?:(nodeId:string,id:string|undefined,value:string|undefined)=>void|Promise<void>;
  globalModelId?:string;
  defaultModelLabel?:string;
  onSelectGlobalModel?:(id:string|undefined)=>void|Promise<void>;
  onSelectNodeModel?:(nodeId:string,id:string|undefined)=>void|Promise<void>;
  onReloadModels?:()=>void|Promise<void>;
  /** False means execution RPCs are unavailable; canvas editing remains usable. */
  runtimeReady?:boolean;
  planningAttachments?:readonly WorkflowNodeAttachment[];
  onUploadPlanningFiles?:(files:File[],signal?:AbortSignal,onProgress?:Parameters<UploadNodeFiles>[3])=>Promise<void>;
  onRemovePlanningFile?:(fileId:string)=>Promise<void>;
  onUploadFiles?:UploadNodeFiles;
  onRemoveFile?:RemoveNodeFile;
  onDeleteWorkflow?: (workflowId: string) => Promise<boolean>;
  onPreviewSessionArchive?:(workflowId:string)=>Promise<WorkflowSessionArchivePreviewValue>;
  onArchiveSessionHistory?:(preview:WorkflowSessionArchivePreviewValue)=>Promise<WorkflowSessionArchiveValue>;
  /** All native sessions, including ones that have no Workflow aggregate yet. */
  sessionRoots?: readonly SessionRootCard[];
  catalogLoading?: boolean;
  catalogMode?: boolean;
  catalogViewport?: Viewport;
  onMoveCatalogViewport?: (viewport: Viewport) => void;
  onShowCatalog?: () => void;
  onMoveSessionRoot?: (sessionId: string, position: Position) => void;
  onMoveSessionRoots?: (moves: readonly { sessionId: string; position: Position }[]) => void;
  onResizeSessionRoot?: (sessionId: string, size: { width: number; height: number }) => void;
  onBringSessionRootToFront?: (sessionId: string) => void;
  onChangeSessionRootLayers?: (sessionIds: readonly string[], action: 'up' | 'down' | 'front' | 'back' | 'reset') => void;
  onChangeSessionRootLayer?: (sessionId: string, action: 'up' | 'down' | 'front' | 'back' | 'reset') => void;
  onOpenSession?: (sessionId: string) => void;
  onImportSession?: (sessionId: string) => void | Promise<void>;
  onOriginalStyle?: () => void;
  branches?: readonly BranchCard[];
  activeBranchId?: string | null;
  onSelectBranch?: (branchId: string) => void;
  executions?: readonly ExecutionCard[];
  plans?: readonly PlanCard[];
  approvedNodeIds?: readonly string[];
  busy?: boolean;
  generationMode?: 'manual' | 'suggest' | 'dynamic';
  executionMode?: 'manual' | 'approval' | 'auto';
  subagentMode?: SubagentMode;
  onChangeSubagentMode?: (mode:SubagentMode) => void | Promise<void>;
  onChangePolicies?: (generationMode: 'manual' | 'suggest' | 'dynamic', executionMode: 'manual' | 'approval' | 'auto') => void | Promise<void>;
  trace?: TraceCard;
  onSelectExecution?: (runId: string) => void;
  onReadTrace?: (runId: string) => void | Promise<void>;
  onReadStep?: (runId: string, stepId: string) => void | Promise<void>;
  onApproveNode?: (nodeId: string) => void | Promise<void>;
  onRejectNode?: (nodeId: string) => void | Promise<void>;
  onRunNode?: (nodeId: string, branchId?: string) => void | Promise<void>;
  onRunNodes?: (nodeIds: readonly string[], branchId?: string) => void | Promise<void>;
  onCancelExecution?: (runId: string) => void | Promise<void>;
  onPauseAll?:()=>void|Promise<void>;
  onForkExecution?: (runId: string, label: string) => void | Promise<void>;
  onForkSession?: (sessionId: string, label: string) => void | Promise<void>;
  onGeneratePlan?: (goal: string, sourceSessionId?: string) => void | Promise<void>;
  onApplyPlan?: (planId: string, acceptedTaskIds: readonly string[]) => void | Promise<void>;
  onRejectPlan?: (planId: string) => void | Promise<void>;
}
