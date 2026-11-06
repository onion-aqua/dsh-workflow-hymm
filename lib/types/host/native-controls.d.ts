/** Released rc.3 permission bundles and live tool approvals. No core settings are replaced. */
import type { Context } from '@deepseek-ai/cordis';
import type { WorkflowAccessCatalog, WorkflowAccessMode, WorkflowApprovalDecision, WorkflowPendingApproval } from '../shared/model.ts';
type NativeApproval = Omit<WorkflowPendingApproval, 'workflowId' | 'runId' | 'nodeId'>;
/** Optional controls: an absent permission/approval provider never disables ordinary Workflow execution. */
export declare class NativeControls {
    private readonly ctx;
    private owner?;
    private readonly waits;
    private readonly listeners;
    private readonly stop;
    private stopped;
    constructor(ctx: Context);
    available(): boolean;
    setApprovalOwner(owns: (sessionId: string, callId: string | undefined, approvalId: string) => Promise<boolean>): void;
    subscribe(listener: (sessionId: string) => void): () => void;
    private key;
    private notify;
    catalogAccessModes(): Promise<WorkflowAccessCatalog>;
    applyAccessMode(sessionId: string, preset: WorkflowAccessMode): Promise<void>;
    private unsettled;
    private present;
    approvals(sessionId: string): Promise<NativeApproval[]>;
    answerApproval(sessionId: string, approvalId: string, decision: WorkflowApprovalDecision): Promise<boolean>;
    dispose(): Promise<void>;
}
export default NativeControls;
