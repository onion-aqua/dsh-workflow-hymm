import type { Context } from '@deepseek-ai/cordis';
import type { WorkflowWorkspaceOption } from '../shared/model.ts';
/** Workspace membership is a canonical directory fact, never a fake canvas group. */
export declare class NativeWorkspaces {
    private readonly ctx;
    private readonly pendingTitles;
    private readonly dirtyTitles;
    constructor(ctx: Context);
    list(): WorkflowWorkspaceOption[];
    attach(sessionId: string, workspaceId?: string): Promise<void>;
    rename(sessionId: string, title: string): Promise<boolean>;
}
