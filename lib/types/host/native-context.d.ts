import type { Context } from '@deepseek-ai/cordis';
import type { WorkflowModelIdentity } from '../shared/model.ts';
export interface NativeContextSnapshot {
    sessionId: string;
    usedTokens?: number;
    capacityTokens?: number;
    source: 'projected' | 'pressure' | 'unavailable';
    autoAvailable?: boolean;
    manualAvailable: boolean;
    capabilitiesKnown?: boolean;
    compacting: boolean;
    lastCompactedAt?: number;
    summaryModel?: WorkflowModelIdentity;
    configurationIssue?: string;
    error?: string;
}
export interface NativeCompactResult {
    changed: boolean;
    beforeTokens?: number;
    afterTokens?: number;
    compactionId?: string;
}
export declare class NativeContextError extends Error {
    readonly outcomeKnown = true;
    constructor(message: string, options?: ErrorOptions);
}
/** Native read models and explicit maintenance. Statistics never resolve an Agent. */
export declare class NativeContextControls {
    private readonly ctx;
    private readonly pending;
    constructor(ctx: Context);
    private engine;
    private measure;
    inspect(sessionId: string): Promise<NativeContextSnapshot>;
    compact(sessionId: string): Promise<NativeCompactResult>;
}
