import type { WorkflowQuestionAnswer, WorkflowQuestionItem } from '../shared/model.ts';
/** Only an explicit recommendation is a defensible automatic choice. Never
 * infer authority, invent text, or run an extra model to decide for the user. */
export declare function recommendedAnswers(questions: readonly WorkflowQuestionItem[]): WorkflowQuestionAnswer[] | undefined;
