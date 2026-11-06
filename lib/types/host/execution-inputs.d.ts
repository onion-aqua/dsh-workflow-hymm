import type { Execution, ExecutionResultInput, WorkflowNode } from '../shared/model.ts';
import type { NativeSessionLog } from './native-runtime.ts';
export interface ResolvedExecutionResultInput {
    reference: ExecutionResultInput;
    text: string;
}
export declare const EXECUTION_RESULT_TEXT_LIMIT = 200000;
export declare const EXECUTION_RESULT_INPUT_LIMIT = 240000;
export declare const RESULT_TASK_LIMIT = 500000;
/** Read from the completed native request, never the canvas's bounded summary.
 * The returned text belongs only in the new native user request, not Workflow JSON. */
export declare function readExecutionResultInput(log: NativeSessionLog, run: Execution, node: WorkflowNode): ResolvedExecutionResultInput;
/** Transfer data as explicitly attributed results, never as spliced histories,
 * assistant turns, tool outputs, hidden reasoning or new tool permissions. */
export declare function buildResultInputTask(node: WorkflowNode, inputs: readonly ResolvedExecutionResultInput[]): string;
