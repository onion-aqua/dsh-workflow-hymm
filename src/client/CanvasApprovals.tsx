import { useEffect, useMemo, useState } from 'react';
import { useNodes, useViewport } from '@xyflow/react';
import type { WorkflowNode, WorkflowPendingApproval } from '../shared/model.ts';
import type { TaskFlowNode } from './TaskNode.tsx';
import type { WorkflowRuntimeProps } from './ui-contract.ts';
import { questionRequestKey } from './ui-contract.ts';
import { ApprovalPanel } from './ApprovalPanel.tsx';
import { placeQuestionPanels } from './question-placement.ts';
import type { Rectangle } from './graph.ts';
import type { Translate } from './locales.ts';
import { Icon } from './icons.tsx';

export function approvalRequestKey(approval:Pick<WorkflowPendingApproval,'workflowId'|'runId'|'sessionId'|'approvalId'>):string{return JSON.stringify([approval.workflowId,approval.runId,approval.sessionId,approval.approvalId]);}
/** Tool approval waits stay visible across focus and branch changes, independently of trace panels. */
export function CanvasApprovals({runtime,tasks,size,reveal,t}:{runtime:WorkflowRuntimeProps;tasks:readonly WorkflowNode[];size:{width:number;height:number};reveal?:{nodeId:string;token:number};t:Translate}){
  const nodes=useNodes<TaskFlowNode>(),viewport=useViewport(),approvals=runtime.pendingApprovals??[];
  const [hidden,setHidden]=useState<Set<string>>(()=>new Set());
  useEffect(()=>{if(reveal)setHidden(previous=>new Set([...previous].filter(key=>!approvals.some(approval=>approval.nodeId===reveal.nodeId&&approvalRequestKey(approval)===key))));},[reveal]);
  const rectangles=useMemo(()=>nodes.map(node=>({id:node.id,x:node.position.x*viewport.zoom+viewport.x,y:node.position.y*viewport.zoom+viewport.y,width:(node.measured?.width??node.width??300)*viewport.zoom,height:(node.measured?.height??node.height??210)*viewport.zoom})),[nodes,viewport.x,viewport.y,viewport.zoom]);
  const placements=useMemo(()=>{
    const margin={left:size.width<600?12:84,right:14,top:size.width<=1280?202:156,bottom:82};
    const anchor=(nodeId:string):Rectangle=>rectangles.find(node=>node.id===nodeId)??{x:size.width-30,y:90,width:0,height:0};
    // Existing question panels have priority; approval panels avoid their estimated bounds as well as cards.
    const questions=placeQuestionPanels((runtime.pendingQuestions??[]).map(question=>({key:questionRequestKey(question),anchor:anchor(question.nodeId),width:390,height:question.questions.length>1?450:Math.max(320,Math.min(450,210+(question.questions[0]?.options?.length??0)*45))})),size,rectangles,{left:size.width<600?12:84,right:14,top:size.width<=1280?128:82,bottom:82});
    return placeQuestionPanels(approvals.filter(approval=>!hidden.has(approvalRequestKey(approval))).map(approval=>({key:approvalRequestKey(approval),anchor:anchor(approval.nodeId),width:390,height:approval.command||approval.input?390:290})),size,[...rectangles,...questions],margin);
  },[approvals,runtime.pendingQuestions,hidden,rectangles,size.width,size.height]);
  if(size.width<=0||size.height<=0||!approvals.length&&!runtime.approvalLoadError)return null;
  return <div className="wf-approval-layer" data-testid="approval-layer">
    {approvals.length>0&&<button type="button" className="wf-approval-inbox nodrag nopan nowheel" data-testid="approval-inbox" onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();setHidden(new Set());}}><Icon name="approval" size={13}/>{t('approvalPendingCount',{count:approvals.length})}</button>}
    {approvals.map(approval=>{const key=approvalRequestKey(approval),placement=placements.find(panel=>panel.key===key),task=tasks.find(node=>node.id===approval.nodeId);return <div className="wf-approval-position" key={key} hidden={hidden.has(key)} style={placement?{left:placement.x,top:placement.y,width:placement.width,height:placement.height}:undefined}><ApprovalPanel approval={approval} nodeTitle={task?.title??t('task')} otherBranch={!rectangles.some(node=>node.id===approval.nodeId)} submitting={runtime.submittingApprovalKeys?.includes(key)} error={runtime.approvalErrors?.[key]} onDecide={runtime.onDecideApproval} onOpenSession={runtime.onOpenSession} onClose={()=>setHidden(previous=>new Set([...previous,key]))} t={t}/></div>;})}
    {runtime.approvalLoadError&&<div className="wf-approval-load-error" role="alert"><span>{t('approvalLoadFailed')} · {runtime.approvalLoadError}</span>{runtime.onReloadApprovals&&<button type="button" onClick={()=>void runtime.onReloadApprovals?.()}>{t('retry')}</button>}</div>}
  </div>;
}
