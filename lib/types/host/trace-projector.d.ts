/** Replayable projection of native observable facts. No model reasoning is exposed. */
import type { NativeSessionLog } from './native-runtime.ts';
export type NativeExecutionStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled' | 'blocked' | 'interrupted' | 'unknown';
export interface NativeTraceStep {
    stepId: string;
    eventStartSeq: number;
    eventEndSeq?: number;
    type: 'agent_step' | 'tool_call' | 'command' | 'file_operation' | 'approval' | 'error';
    title: string;
    status: NativeExecutionStatus;
    timestamp: number;
    toolName?: string;
    callId?: string;
    parentStepId?: string;
    actionKind?: 'read' | 'edit' | 'write' | 'command' | 'search' | 'fetch' | 'tool';
    /** Bounded display-only argument preview, rebuilt from native events on demand. */
    target?: string;
}
export interface NativeExecutionProjection {
    status: NativeExecutionStatus;
    terminalReason?: string;
    startSeq?: number;
    endSeq?: number;
    turns: number[];
    steps: NativeTraceStep[];
    assistantText: string;
    cursor: number;
}
export interface NativeProjectionIdentity {
    runId: string;
    requestId: string;
    startSeq?: number;
    running?: boolean;
    messageId?: string;
}
export interface ExecutionStepDetails {
    eventName: string;
    time: number;
    status: NativeExecutionStatus;
    toolName?: string;
    input?: string;
    command?: string;
    output?: string;
    error?: string;
    truncated: boolean;
}
/** Only explicit text blocks are visible; raw streams, reasoning and replay metadata never enter this path. */
export declare function observableText(content: unknown): string;
/** Rebuild exactly the turns claiming this persisted rpcId; inherited seeds are never counted twice. */
export declare function projectExecution(log: NativeSessionLog, identity: NativeProjectionIdentity): NativeExecutionProjection;
/** Complete observable final text for structured plan parsing, never assistant.stream. */
export declare function assistantTextForRequest(log: NativeSessionLog, requestId: string): string;
/** Complete observable text for an exact execution boundary. Callers impose
 * their own admission budget rather than inheriting the trace view's truncation. */
export declare function assistantTextForExecution(log: NativeSessionLog, identity: NativeProjectionIdentity, endSeq: number): string;
/** Read details from the native events when expanded; callers must not save this response in Workflow JSON. */
export declare function readTraceStepDetails(log: NativeSessionLog, projection: NativeExecutionProjection, stepId: string): ExecutionStepDetails;
