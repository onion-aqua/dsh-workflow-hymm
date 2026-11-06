/** Adapter over released rc.3 capabilities. Imported source Sessions are read only. */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { WorkflowModelIdentity, WorkflowModelOption, WorkflowModelsValue, WorkflowPendingQuestion, WorkflowQuestionAnswer, WorkflowQuestionItem } from '../shared/model.ts';
export interface NativeEvent {
    type: string;
    seq: number;
    time: number;
    data: Record<string, unknown>;
}
export interface NativeSessionLog {
    sessionId: string;
    header: {
        id: string;
        createdAt: number;
        cwd?: string;
        parentSession?: string;
        agentPreset?: string;
        isSeeded: boolean;
    };
    inheritedEventCount: number;
    events: NativeEvent[];
}
export interface NativeSessionSummary {
    sessionId: string;
    title: string;
    updatedAt: number;
    running: boolean;
    blank: boolean;
    parentSessionId?: string;
    cwd?: string;
    formatStatus?: 'current' | 'migration-required';
}
/** A verified immutable native reference. Neither browser paths nor upload receipts persist here. */
export interface NativeFileReference {
    attachmentId: string;
    name: string;
    bytes: number;
}
type NativePendingQuestion = Omit<WorkflowPendingQuestion, 'workflowId' | 'runId' | 'nodeId'>;
interface NativeQuestionRequest {
    questions: WorkflowQuestionItem[];
    agent?: Agent;
    signal?: AbortSignal;
    wait?: {
        callId: string;
        timed?: boolean;
    };
}
interface NativeQuestionAnswerBatch {
    answers: WorkflowQuestionAnswer[];
}
declare module '@deepseek-ai/cordis' {
    interface Events {
        'user-questions/request'(request: NativeQuestionRequest, next: () => Promise<NativeQuestionAnswerBatch>): Promise<NativeQuestionAnswerBatch>;
    }
}
export interface NativeRuntime {
    models(): Promise<WorkflowModelsValue>;
    resolveModel(selection?: WorkflowModelIdentity): Promise<WorkflowModelIdentity>;
    catalog(signal?: AbortSignal): Promise<NativeSessionSummary[]>;
    read(sessionId: string): Promise<NativeSessionLog>;
    create(options?: {
        sessionId?: string;
        cwd?: string;
        agentPreset?: string;
    }): Promise<{
        sessionId: string;
    }>;
    fork(request: {
        sessionId: string;
        atSeq: number;
    }): Promise<{
        sessionId: string;
        inheritedEventCount: number;
    }>;
    resolveUploadedFile(sessionId: string, receiptId: string): Promise<NativeFileReference>;
    submit(request: {
        sessionId: string;
        requestId: string;
        text: string;
        clientTimeZone?: string;
        planning?: boolean;
        files?: readonly NativeFileReference[];
        model?: WorkflowModelIdentity;
    }): Promise<void>;
    cancel(sessionId: string, requestId?: string): Promise<'queued' | 'active' | 'none'>;
    flush(sessionId: string): Promise<void>;
    subscribe(listener: (sessionId: string, event: NativeEvent) => void): () => void;
    isRunning(sessionId: string): boolean;
    waitForIdle(sessionId: string): Promise<void>;
    protectPlanning(sessionId: string, files?: readonly NativeFileReference[]): void;
    supportsSubagents?(): boolean;
    startSubagent?(request: {
        parentSessionId: string;
        childSessionId: string;
        label: string;
        text: string;
        files?: readonly NativeFileReference[];
        model?: WorkflowModelIdentity;
        accessMode?: string;
    }): Promise<{
        messageId: string;
    }>;
    cancelSubagent?(childSessionId: string): Promise<void>;
    disposeSubagents?(): Promise<void>;
    questions?(sessionId: string): Promise<NativePendingQuestion[]>;
    answerQuestion?(sessionId: string, callId: string, answers: WorkflowQuestionAnswer[], resume?: {
        model: WorkflowModelIdentity;
        requestId: string;
    }): Promise<boolean>;
    setQuestionOwner?(owns: (sessionId: string, callId: string) => Promise<boolean>): void;
    pendingQuestionReplies?(sessionId: string): string[];
}
/** Strictly select a real, completed inclusive boundary; synthetic crash closers never qualify. */
export declare function completedBoundary(log: NativeSessionLog, requested?: number): number | undefined;
/** The Context declaring this adapter must inject every service named here. */
export declare class DshNativeRuntime implements NativeRuntime {
    private readonly ctx;
    static readonly inject: string[];
    private readonly planningAgents;
    private readonly planningSessions;
    private readonly planningReadPaths;
    private readonly selectedModels;
    private readonly subagentActivations;
    private readonly subagentStarts;
    private readonly subagentSandboxModes;
    private subagentsStopping;
    private questionOwner?;
    private readonly questionWaits;
    private readonly questionListeners;
    constructor(ctx: Context);
    setQuestionOwner(owns: (sessionId: string, callId: string) => Promise<boolean>): void;
    pendingQuestionReplies(sessionId: string): string[];
    private questionKey;
    private notifyQuestionState;
    private legacyQuestionCallId;
    private questionInboxBlocked;
    questions(sessionId: string): Promise<NativePendingQuestion[]>;
    answerQuestion(sessionId: string, callId: string, answers: WorkflowQuestionAnswer[], resume?: {
        model: WorkflowModelIdentity;
        requestId: string;
    }): Promise<boolean>;
    protectPlanning(sessionId: string, files?: readonly NativeFileReference[]): void;
    private protectPlanningAgent;
    models(): Promise<WorkflowModelsValue>;
    listModels(): Promise<WorkflowModelOption[]>;
    getDefaultModel(): Promise<WorkflowModelIdentity | undefined>;
    resolveModel(selection?: WorkflowModelIdentity): Promise<WorkflowModelIdentity>;
    private selectAgentModel;
    catalog(signal?: AbortSignal): Promise<NativeSessionSummary[]>;
    read(sessionId: string): Promise<NativeSessionLog>;
    create(options?: {
        sessionId?: string;
        cwd?: string;
        agentPreset?: string;
    }): Promise<{
        sessionId: string;
    }>;
    fork(request: {
        sessionId: string;
        atSeq: number;
    }): Promise<{
        sessionId: string;
        inheritedEventCount: number;
    }>;
    /** Optional native capability: ordinary execution still works when it is absent. */
    supportsSubagents(): boolean;
    startSubagent(request: {
        parentSessionId: string;
        childSessionId: string;
        label: string;
        text: string;
        files?: readonly NativeFileReference[];
        model?: WorkflowModelIdentity;
        accessMode?: string;
    }): Promise<{
        messageId: string;
    }>;
    cancelSubagent(childSessionId: string): Promise<void>;
    disposeSubagents(): Promise<void>;
    resolveUploadedFile(sessionId: string, receiptId: string): Promise<NativeFileReference>;
    submit(request: {
        sessionId: string;
        requestId: string;
        text: string;
        clientTimeZone?: string;
        planning?: boolean;
        files?: readonly NativeFileReference[];
        model?: WorkflowModelIdentity;
    }): Promise<void>;
    cancel(sessionId: string, requestId?: string): Promise<'queued' | 'active' | 'none'>;
    flush(sessionId: string): Promise<void>;
    subscribe(listener: (sessionId: string, event: NativeEvent) => void): () => void;
    isRunning(sessionId: string): boolean;
    waitForIdle(sessionId: string): Promise<void>;
}
export {};
