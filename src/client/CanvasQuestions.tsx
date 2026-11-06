import { useEffect, useMemo, useState } from 'react';
import { useNodes, useViewport } from '@xyflow/react';
import type { WorkflowNode } from '../shared/model.ts';
import type { TaskFlowNode } from './TaskNode.tsx';
import type { WorkflowRuntimeProps } from './ui-contract.ts';
import { questionRequestKey } from './ui-contract.ts';
import { QuestionPanel } from './QuestionPanel.tsx';
import { placeQuestionPanels } from './question-placement.ts';
import type { Rectangle } from './graph.ts';
import type { Translate } from './locales.ts';
import { Icon } from './icons.tsx';

/** Pending questions are independent of node focus and the selected history branch. */
export function CanvasQuestions({runtime,tasks,size,reveal,t}:{runtime:WorkflowRuntimeProps;tasks:readonly WorkflowNode[];size:{width:number;height:number};reveal?:{nodeId:string;token:number};t:Translate}){
  const nodes=useNodes<TaskFlowNode>(),viewport=useViewport();
  const questions=runtime.pendingQuestions??[];
  const [hidden,setHidden]=useState<Set<string>>(()=>new Set());
  useEffect(()=>{if(reveal)setHidden(previous=>new Set([...previous].filter(key=>!questions.some(question=>question.nodeId===reveal.nodeId&&questionRequestKey(question)===key))));},[reveal]);
  const rectangles=useMemo(()=>nodes.map(node=>({id:node.id,x:node.position.x*viewport.zoom+viewport.x,y:node.position.y*viewport.zoom+viewport.y,width:(node.measured?.width??node.width??300)*viewport.zoom,height:(node.measured?.height??node.height??210)*viewport.zoom})),[nodes,viewport.x,viewport.y,viewport.zoom]);
  const placements=useMemo(()=>placeQuestionPanels(questions.filter(question=>!hidden.has(questionRequestKey(question))).map(question=>{
    const anchor:Rectangle=rectangles.find(node=>node.id===question.nodeId)??{x:size.width-30,y:90,width:0,height:0};
    return {key:questionRequestKey(question),anchor,width:390,height:question.questions.length>1?450:Math.max(320,Math.min(450,210+(question.questions[0]?.options?.length??0)*45))};
  }),size,rectangles,{left:size.width<600?12:84,right:14,top:size.width<=1280?128:82,bottom:82}),[questions,hidden,rectangles,size.width,size.height]);
  if(size.width<=0||size.height<=0||!questions.length&&!runtime.questionLoadError)return null;
  return <div className="wf-question-layer" data-testid="question-layer">
    {questions.length>0&&<button type="button" className="wf-question-inbox nodrag nopan nowheel" data-testid="question-inbox" onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();setHidden(new Set());}}><Icon name="help" size={13}/>{t('questionPendingCount',{count:questions.length})}</button>}
    {questions.map(question=>{
      const key=questionRequestKey(question),placement=placements.find(panel=>panel.key===key),task=tasks.find(node=>node.id===question.nodeId);
      return <div className="wf-question-position" key={key} hidden={hidden.has(key)} style={placement?{left:placement.x,top:placement.y,width:placement.width,height:placement.height}:undefined}>
        <QuestionPanel question={question} nodeTitle={task?.title??t('task')} otherBranch={!rectangles.some(node=>node.id===question.nodeId)} submitting={runtime.submittingQuestionKeys?.includes(key)} error={runtime.questionErrors?.[key]} onAnswer={runtime.onAnswerQuestion} onPauseAutomation={runtime.onPauseQuestionAutomation} onOpenSession={runtime.onOpenSession} onClose={()=>setHidden(previous=>new Set([...previous,key]))} t={t}/>
      </div>;
    })}
    {runtime.questionLoadError&&<div className="wf-question-load-error" role="alert"><span>{t('questionLoadFailed')} · {runtime.questionLoadError}</span>{runtime.onReloadQuestions&&<button type="button" onClick={()=>void runtime.onReloadQuestions?.()}>{t('retry')}</button>}</div>}
  </div>;
}
