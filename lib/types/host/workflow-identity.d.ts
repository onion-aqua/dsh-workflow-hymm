import type { Workflow, WorkflowNode } from '../shared/model.ts';
/** Allocation belongs to the Host; view ordering and user-supplied numbers have no authority. */
export declare function assignNodeNumbers(workflow: Workflow): Workflow;
export declare function taskCaption(node: Pick<WorkflowNode, 'title' | 'displayId'>): string;
export declare function branchCaption(from: WorkflowNode | undefined, label: string): string;
export declare function nativeSessionCaption(workflow: Workflow, node: WorkflowNode, branchLabel?: string): string;
