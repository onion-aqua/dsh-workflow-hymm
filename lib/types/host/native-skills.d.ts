import type { Context } from '@deepseek-ai/cordis';
/** Catalog metadata only. The native pre-step skill injector owns loading and activation. */
export interface WorkflowSkillOption {
    name: string;
    description?: string;
    source?: string;
}
export interface NativeSkillCatalogRequest {
    sessionId?: string;
    cwd?: string;
    signal?: AbortSignal;
}
/** Read native skills without restoring an Agent or repairing a source Session's directory. */
export declare class NativeSkillCatalog {
    private readonly ctx;
    constructor(ctx: Context);
    list(request?: NativeSkillCatalogRequest): Promise<WorkflowSkillOption[]>;
}
