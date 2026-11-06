import { Context, Service } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type * as M from '../shared/model.ts';
export type * from '../shared/model.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        visualWorkflow: VisualWorkflowService;
    }
}
export declare class VisualWorkflowService extends TypertRemoteService {
    static inject: string[];
    private records?;
    private layouts?;
    private native?;
    private controls?;
    private workspaces?;
    private contextControls?;
    private skillCatalog?;
    private readonly compactFlights;
    private readonly sessionArchiveFlights;
    private readonly autoAnswers;
    private readonly actionTails;
    private readonly scheduled;
    private readonly policyTimers;
    private readonly policyFlights;
    private readonly policyAgain;
    /** Prevent event projection and policy timers from writing while a delete
     * first interrupts the native work and then commits the archive tombstone. */
    private readonly archiveFlights;
    private readonly pausedPolicies;
    private recovering;
    private stopped;
    constructor(ctx: Context);
    [Service.init](): Promise<void>;
    private owner;
    private table;
    private runtime;
    private workflow;
    private write;
    private serial;
    capabilities(): Promise<M.WorkflowCapabilitiesValue>;
    models(): Promise<M.WorkflowModelsValue>;
    private resolveWorkflowModel;
    accessModes(): Promise<M.WorkflowAccessCatalog>;
    private resolveAccessMode;
    private workspacePath;
    setAccessMode(request: M.WorkflowAccessModeRequest): Promise<M.WorkflowActionValue>;
    workspacesList(): Promise<M.WorkflowWorkspacesValue>;
    private contextTarget;
    private inspectContext;
    contextUsage(request: M.WorkflowContextRequest): Promise<M.WorkflowContextValue>;
    skills(request: M.WorkflowContextRequest): Promise<M.WorkflowSkillsValue>;
    compactContext(request: M.WorkflowCompactRequest): Promise<M.WorkflowCompactValue>;
    organizeSessionNames(request: M.WorkflowQuestionsRequest): Promise<M.WorkflowOrganizeValue>;
    setWorkspace(request: M.WorkflowWorkspaceRequest): Promise<M.WorkflowActionValue>;
    list(): Promise<M.WorkflowListValue>;
    get(request: M.WorkflowGetRequest): Promise<M.WorkflowGetValue>;
    create(request: M.WorkflowCreateRequest): Promise<M.WorkflowCreateValue>;
    /**
     * Deletion is an explicit user command to stop this canvas. Interrupt every
     * owned native request first, then persist terminal metadata together with
     * the archive tombstone. Source Sessions are immutable and are never
     * cancelled; their references remain available for later history review.
     */
    private stopBeforeArchive;
    private waitForArchiveIdle;
    private stopPolicyTimers;
    private cancelLocalQueue;
    pauseAll(request: M.WorkflowPauseRequest): Promise<M.WorkflowActionValue>;
    delete(request: M.WorkflowDeleteRequest): Promise<M.WorkflowDeleteValue>;
    private archiveRegistry;
    private archivedWorkflow;
    private protectedHistorySession;
    private historyNeedsAttention;
    private sessionArchivePreview;
    previewSessionArchive(request: M.WorkflowSessionArchivePreviewRequest): Promise<M.WorkflowSessionArchivePreviewValue>;
    archiveSessionHistory(request: M.WorkflowSessionArchiveRequest): Promise<M.WorkflowSessionArchiveValue>;
    save(request: M.WorkflowSaveRequest): Promise<M.WorkflowSaveValue>;
    catalog(): Promise<M.WorkflowCatalogValue>;
    saveCatalogLayout(request: M.WorkflowCatalogLayoutRequest): Promise<M.WorkflowCatalogLayoutValue>;
    importSession(request: M.WorkflowImportRequest): Promise<M.WorkflowActionValue>;
    private attachmentNode;
    prepareAttachment(request: M.WorkflowPrepareAttachmentRequest): Promise<M.WorkflowPrepareAttachmentValue>;
    preparePlanAttachments(request: M.WorkflowPreparePlanAttachmentsRequest): Promise<M.WorkflowPrepareAttachmentValue>;
    private prepareUploadSession;
    attach(request: M.WorkflowAttachRequest): Promise<M.WorkflowActionValue>;
    attachFiles(request: M.WorkflowAttachFilesRequest): Promise<M.WorkflowActionValue>;
    private attachFilesAction;
    attachPlanFiles(request: M.WorkflowAttachPlanFilesRequest): Promise<M.WorkflowActionValue>;
    approve(request: M.WorkflowApproveRequest): Promise<M.WorkflowActionValue>;
    run(request: M.WorkflowRunRequest): Promise<M.WorkflowActionValue>;
    batchRun(request: M.WorkflowBatchRunRequest): Promise<M.WorkflowBatchRunValue>;
    private runAction;
    cancel(request: M.WorkflowCancelRequest): Promise<M.WorkflowActionValue>;
    trace(request: M.WorkflowTraceRequest): Promise<M.WorkflowTraceValue>;
    details(request: M.WorkflowDetailsRequest): Promise<M.WorkflowDetailsValue>;
    /** Verify a question against the exact owned native tool occurrence, not the
     * canvas selection or a caller-supplied Session. Later unrelated user work
     * makes late steering unsafe even if the native projection still retains it. */
    private questionBelongs;
    private questionRunSafe;
    private ownsQuestion;
    private automationKey;
    private automateQuestions;
    pauseQuestionAutomation(request: M.WorkflowPauseQuestionRequest): Promise<M.WorkflowAnswerQuestionValue>;
    questions(request: M.WorkflowQuestionsRequest): Promise<M.WorkflowQuestionsValue>;
    private approvalBelongs;
    private ownsApproval;
    pendingApprovals(request: M.WorkflowQuestionsRequest): Promise<M.WorkflowApprovalsValue>;
    answerApproval(request: M.WorkflowAnswerApprovalRequest): Promise<M.WorkflowAnswerQuestionValue>;
    answerQuestion(request: M.WorkflowAnswerQuestionRequest): Promise<M.WorkflowAnswerQuestionValue>;
    fork(request: M.WorkflowForkRequest): Promise<M.WorkflowActionValue>;
    generatePlan(request: M.WorkflowPlanRequest): Promise<M.WorkflowActionValue>;
    private generatePlanAction;
    applyPlan(request: M.WorkflowApplyPlanRequest): Promise<M.WorkflowActionValue>;
    private branchBusy;
    /** Shared ancestors appear once, with the exact executions visible in this scope. */
    private resultInputRuns;
    private readResultInputs;
    private rejectQueuedExecution;
    /** Resolve late: a user can queue children before their parent's durable endSeq exists. */
    private routeQueuedExecution;
    private forkQueuedContext;
    /** Auto is a graph decision over explicitly requested work, with no model call. */
    private useSubagent;
    private prepareSubagent;
    private dispatchQueue;
    private queuePolicies;
    /** Only explicitly clicked Run requests advance; proposals stay inert. */
    private advancePolicies;
    private newBranch;
    private project;
    private schedule;
    private reconcileSession;
    private operationFailure;
    private finishPlanLater;
    private recover;
}
export default VisualWorkflowService;
