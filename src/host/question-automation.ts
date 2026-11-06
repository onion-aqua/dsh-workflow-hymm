import type { WorkflowQuestionAnswer, WorkflowQuestionItem } from '../shared/model.ts';
/** Only an explicit recommendation is a defensible automatic choice. Never
 * infer authority, invent text, or run an extra model to decide for the user. */
export function recommendedAnswers(questions:readonly WorkflowQuestionItem[]):WorkflowQuestionAnswer[]|undefined{
  if(!questions.length)return;
  const answers:WorkflowQuestionAnswer[]=[];
  for(const question of questions){
    const choices=(question.options??[]).filter(option=>{
      // Ordinary prose such as "not recommended" conveys no automatic choice.
      // A negative qualifier also overrides a contradictory positive marker.
      if(/(?:\b(?:not|never)\s+(?:(?:[a-z]+|[（(\[])\s*){0,3}recommended\b|\bunrecommended\b|不\s*推荐)/i.test(option.label))return false;
      return /(?:（\s*(?:推荐|recommended)\s*）|\(\s*(?:推荐|recommended)\s*\)|\[\s*(?:推荐|recommended)\s*\]|^\s*Recommended\s*[:：]\s*\S)/i.test(option.label);
    });
    if(!choices.length||!question.multiSelect&&choices.length!==1)return;
    answers.push({id:question.id,selected:choices.map(option=>option.label)});
  }
  return answers;
}
