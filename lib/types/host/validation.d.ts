/** Validate records at RPC and durable storage boundaries. */
import { z } from 'zod';
import type { Workflow } from '../shared/model.ts';
export declare const modelIdentitySchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
    reasoningEffort: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const workflowSettingsSchema: z.ZodObject<{
    generation: z.ZodEnum<{
        manual: "manual";
        suggest: "suggest";
        dynamic: "dynamic";
    }>;
    execution: z.ZodEnum<{
        auto: "auto";
        manual: "manual";
        approval: "approval";
    }>;
    model: z.ZodOptional<z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
        reasoningEffort: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    modelReasoning: z.ZodOptional<z.ZodArray<z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
        reasoningEffort: z.ZodString;
    }, z.core.$strict>>>;
    subagents: z.ZodOptional<z.ZodEnum<{
        off: "off";
        on: "on";
        auto: "auto";
    }>>;
    accessMode: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const planTaskSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    instruction: z.ZodString;
    dependsOn: z.ZodArray<z.ZodString>;
    dependencyUnspecified: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const structuredPlanSchema: z.ZodObject<{
    tasks: z.ZodArray<z.ZodPipe<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        instruction: z.ZodString;
        dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>, z.ZodTransform<{
        dependencyUnspecified?: boolean | undefined;
        dependsOn: string[];
        id: string;
        title: string;
        instruction: string;
    }, {
        id: string;
        title: string;
        instruction: string;
        dependsOn?: string[] | undefined;
    }>>>;
}, z.core.$strict>;
export declare const workflowSchema: z.ZodType<Workflow>;
export declare const getRequestSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strict>;
export declare const createRequestSchema: z.ZodObject<{
    name: z.ZodString;
}, z.core.$strict>;
export declare const deleteRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>;
export declare const pauseRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
}, z.core.$strict>;
export declare const saveRequestSchema: z.ZodObject<{
    workflow: z.ZodType<Workflow, unknown, z.core.$ZodTypeInternals<Workflow, unknown>>;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>;
export declare const catalogLayoutSchema: z.ZodObject<{
    revision: z.ZodNumber;
    positions: z.ZodRecord<z.ZodString, z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strict>>;
    viewport: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        zoom: z.ZodNumber;
    }, z.core.$strict>;
    zIndices: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    sizes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, z.core.$strict>>>;
    groups: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        nodeIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const catalogLayoutRequestSchema: z.ZodObject<{
    layout: z.ZodObject<{
        revision: z.ZodNumber;
        positions: z.ZodRecord<z.ZodString, z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strict>>;
        viewport: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            zoom: z.ZodNumber;
        }, z.core.$strict>;
        zIndices: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        sizes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            width: z.ZodNumber;
            height: z.ZodNumber;
        }, z.core.$strict>>>;
        groups: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodString;
            nodeIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
    }, z.core.$strict>;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>;
export declare const importRequestSchema: z.ZodObject<{
    sessionId: z.ZodString;
}, z.core.$strict>;
export declare const prepareAttachmentRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    nodeId: z.ZodString;
    nodeRevision: z.ZodNumber;
    operationId: z.ZodString;
}, z.core.$strict>;
export declare const attachRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    nodeId: z.ZodString;
    nodeRevision: z.ZodNumber;
    operationId: z.ZodString;
    sessionId: z.ZodString;
    receiptId: z.ZodString;
}, z.core.$strict>;
export declare const attachFilesRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    nodeId: z.ZodString;
    nodeRevision: z.ZodNumber;
    operationId: z.ZodString;
    sessionId: z.ZodString;
    receiptIds: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const preparePlanAttachmentsRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    operationId: z.ZodString;
}, z.core.$strict>;
export declare const attachPlanFilesRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    operationId: z.ZodString;
    sessionId: z.ZodString;
    receiptIds: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const approveRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    nodeId: z.ZodString;
    approved: z.ZodBoolean;
}, z.core.$strict>;
export declare const runRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    nodeId: z.ZodString;
    nodeRevision: z.ZodOptional<z.ZodNumber>;
    branchId: z.ZodOptional<z.ZodString>;
    operationId: z.ZodString;
}, z.core.$strict>;
export declare const batchRunRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    nodeIds: z.ZodArray<z.ZodString>;
    nodeRevisions: z.ZodRecord<z.ZodString, z.ZodNumber>;
    branchId: z.ZodOptional<z.ZodString>;
    operationId: z.ZodString;
}, z.core.$strict>;
export declare const traceRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    runId: z.ZodString;
}, z.core.$strict>;
export declare const detailsRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    runId: z.ZodString;
    stepId: z.ZodString;
}, z.core.$strict>;
export declare const questionsRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
}, z.core.$strict>;
export declare const answerQuestionRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    runId: z.ZodString;
    sessionId: z.ZodString;
    callId: z.ZodString;
    answers: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        selected: z.ZodArray<z.ZodString>;
        custom: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const pauseQuestionRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    runId: z.ZodString;
    sessionId: z.ZodString;
    callId: z.ZodString;
}, z.core.$strict>;
export declare const answerApprovalRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    runId: z.ZodString;
    sessionId: z.ZodString;
    approvalId: z.ZodString;
    decision: z.ZodEnum<{
        rejected: "rejected";
        "allowed-once": "allowed-once";
    }>;
}, z.core.$strict>;
export declare const accessModeRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    presetId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const workspaceRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    workspaceId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const contextRequestSchema: z.ZodObject<{
    workflowId: z.ZodOptional<z.ZodString>;
    branchId: z.ZodOptional<z.ZodString>;
    nodeId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    planning: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const compactRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    sessionId: z.ZodString;
    operationId: z.ZodString;
}, z.core.$strict>;
export declare const planRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    goal: z.ZodString;
    sourceSessionId: z.ZodOptional<z.ZodString>;
    operationId: z.ZodString;
    attachmentIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const applyPlanRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    planId: z.ZodString;
    accept: z.ZodBoolean;
    taskIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const forkRequestSchema: z.ZodObject<{
    workflowId: z.ZodString;
    runId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    atSeq: z.ZodOptional<z.ZodNumber>;
    label: z.ZodString;
    operationId: z.ZodString;
}, z.core.$strict>;
