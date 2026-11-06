import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeResizeControl, useUpdateNodeInternals } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { WorkflowNode } from '../shared/model.ts';
import { Icon } from './icons.tsx';
import type { Translate } from './locales.ts';
import { executionIsActive } from './graph.ts';
import type { ExecutionCard, ModelOption, SessionRootCard, WorkflowRuntimeProps } from './ui-contract.ts';
import { NodeFileAttachments } from './NodeFileAttachments.tsx';
import type { RemoveNodeFile, UploadNodeFiles } from './NodeFileAttachments.tsx';
import { ModelPicker, modelChoiceAvailable, modelOptionKey, modelOptionLabel } from './ModelPicker.tsx';
import { MarkdownContent } from './MarkdownContent.tsx';
import { MagneticHandle } from './MagneticHandle.tsx';

export type InlineField = 'title' | 'instruction';
export interface MenuPoint { clientX:number; clientY:number }
export interface TaskNodeData extends Record<string, unknown> {
  task:WorkflowNode; root?:SessionRootCard; order:number; focused:boolean; selected?:boolean; collapsed:boolean; menuOpen?:boolean;
  approved?:boolean; execution?:ExecutionCard; activeExecution?:ExecutionCard; hasExecution?:boolean; busy?:boolean; editLocked?:boolean;
  editingField?:InlineField; editTitle?:string; editInstruction?:string; sharedBranchCount?:number; t:Translate;
  onMenu:(id:string,point:MenuPoint)=>void;
  onPortMenu?:(id:string,direction:'input'|'output',point:MenuPoint)=>void;
  onCollapse?:(id:string)=>void;
  onStartEditing?:(id:string,field:InlineField)=>void;
  onOpenTextEditor?:(id:string)=>void;
  onTitleChange?:(value:string)=>void; onInstructionChange?:(value:string)=>void;
  onCommitEditing?:()=>void; onCancelEditing?:()=>void;
  onResizeNode?:(id:string,size:{width:number;height:number})=>void;
  onRunNode?:(id:string)=>void;onCancelNode?:(runId:string)=>void;
  onOpenSession?:(sessionId:string)=>void; onImportSession?:(sessionId:string)=>void;
  onUploadFiles?:UploadNodeFiles; onRemoveFile?:RemoveNodeFile;filesBusy?:boolean;onFilesBusyChange?:(id:string,working:boolean)=>void;
  modelOptions?:readonly ModelOption[];modelsLoading?:boolean;modelsError?:string;globalModelId?:string;defaultModelLabel?:string;modelAvailable?:boolean;runtimeReady?:boolean;
  onSelectNodeModel?:(nodeId:string,id:string|undefined)=>void;
  reasoningForNodeOption?:WorkflowRuntimeProps['reasoningForNodeOption'];
  onNodeReasoningChange?:WorkflowRuntimeProps['onNodeReasoningChange'];
  onCollapsedContentHeight?:(nodeId:string,height:number)=>void;
  pendingApprovalCount?:number;onOpenApprovals?:(nodeId:string)=>void;
  pendingQuestionCount?:number;waitingQuestionCount?:number;onOpenQuestions?:(nodeId:string)=>void;
}
export type TaskFlowNode = Node<TaskNodeData,'task'>;
export function executionStatusText(status:string,t:Translate):string {
  const keys={draft:'draft',ready:'queued',waiting:'waiting',queued:'queued',running:'running',waiting_answer:'waitingAnswer',completed:'completed',stale:'resultStale',failed:'failed',blocked:'blocked',waiting_approval:'waitingApproval',cancelled:'cancelled',interrupted:'interrupted',unknown:'unknown',pending:'pending','needs-reconcile':'needsReconcile'} as const;
  return t(keys[status as keyof typeof keys]??'unknown');
}

/** Node text is directly editable; native Session cards remain immutable references. */
export function TaskNode({data,id,width,height,isConnectable}:NodeProps<TaskFlowNode>){
  const {t,task}=data;
  const [filesBusy,setFilesBusy]=useState(false);
  const sessionId=data.root?.sessionId??(task.kind==='session'?task.sourceSessionId:undefined);
  const isSession=Boolean(sessionId);const locked=isSession||data.busy||data.editLocked||filesBusy;
  const editing=data.editingField==='title'&&!locked;
  const titleRef=useRef<HTMLInputElement>(null);
  const questionRef=useRef<HTMLDivElement>(null);const updateNodeInternals=useUpdateNodeInternals();
  useEffect(()=>{if(editing){titleRef.current?.focus();titleRef.current?.select();}},[editing]);
  const active=data.activeExecution??(data.execution&&executionIsActive(data.execution)?data.execution:undefined);
  const stale=!active&&task.resultStale&&data.execution?.status==='completed'&&data.execution.nodeRevision===task.revision;
  const awaitingAnswers=Boolean(data.waitingQuestionCount??data.pendingQuestionCount)||active?.status==='waiting_answer';
  const awaitingApproval=Boolean(data.pendingApprovalCount);
  const state=awaitingApproval?'waiting_approval':awaitingAnswers?'waiting_answer':active?.status??(stale?'stale':data.execution?.status??'draft');
  const running=state==='running'&&Boolean(active);const waiting=Boolean(active)&&!running;
  const failed=!active&&data.execution?.status==='failed'&&data.execution.nodeRevision===(task.revision??1);
  const stateLabel=awaitingApproval?t('waitingApproval'):awaitingAnswers?t('waitingAnswer'):waiting?t(state==='blocked'||state==='waiting_approval'?'waitingApproval':state==='waiting'?(active?.waitingReason==='branch_busy'?'waitingTurn':active?.waitingReason==='subagent_capacity'?'waitingSubagentCapacity':active?.waitingReason==='subagent_unavailable'?'waitingSubagentUnavailable':active?.waitingReason==='stale_prerequisites'?'waitingStalePrerequisites':'waitingPrerequisites'):'waitingTurn'):executionStatusText(state,t);
  const edit=(field:InlineField)=>{if(!locked)data.onStartEditing?.(id,field);};
  const reportFilesBusy=useCallback((working:boolean)=>{setFilesBusy(working);data.onFilesBusyChange?.(id,working);},[id,data.onFilesBusyChange]);
  const canUseModel=modelChoiceAvailable(task.model,data.modelOptions,data.modelAvailable);
  const question=isSession?task.instruction||data.root?.preview||t('sessionReference'):task.instruction||t('instructionPreview');
  useLayoutEffect(()=>{if(!data.collapsed||!questionRef.current)return;const element=questionRef.current;const measure=()=>data.onCollapsedContentHeight?.(id,element.scrollHeight);measure();const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(measure);observer?.observe(element);return()=>observer?.disconnect();},[id,data.collapsed,question,width,data.onCollapsedContentHeight]);
  useEffect(()=>{updateNodeInternals(id);},[id,data.collapsed,width,height,updateNodeInternals]);
  return <article className={`wf-task ${isSession?'wf-session-root':`wf-task--${data.order%4}`} ${data.collapsed?'is-collapsed':''} ${data.focused?'is-focused':''} ${data.selected?'is-selected':''} ${editing?'is-editing':''} ${running?'is-running':''} ${waiting?'is-waiting':''} ${awaitingAnswers||awaitingApproval?'is-awaiting-answer':''} ${failed?'is-failed':''}`} data-testid={isSession?`session-node-${sessionId}`:`task-node-${id}`} data-node-id={id} data-session-id={sessionId} aria-label={t(isSession?'sessionLabel':'taskLabel',{title:task.title})}>
    {!data.root&&<MagneticHandle nodeId={id} type="target" label={t('inputHandle')} enabled={isConnectable!==false&&!data.busy} bodyHeight={Math.max(9,(height??task.height??210)-29)} onMenu={data.onPortMenu}/>}
    <div className="wf-task-top"><div className="wf-task-heading">{task.displayId&&<small className="wf-node-display-id" data-testid={`node-display-id-${id}`} title={t('nodeNumber',{number:task.displayId})}>#{task.displayId}</small>}<Icon name={isSession?'chat':'task'} size={13}/>{editing?<input ref={titleRef} className="wf-inline-title nodrag nopan" data-testid={`inline-title-${id}`} aria-label={t('taskTitle')} value={data.editTitle??task.title} maxLength={160} onChange={event=>data.onTitleChange?.(event.target.value)} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()} onBlur={()=>data.onCommitEditing?.()} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();data.onCancelEditing?.();}else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();data.onCommitEditing?.();}}}/>:<span data-testid={`node-title-${id}`} className={!locked?'wf-editable-text nodrag nopan':''} title={!locked?t('clickToEdit'):task.title} tabIndex={!locked?0:undefined} onClick={event=>{if(!locked){event.stopPropagation();edit('title');}}} onKeyDown={event=>{if(event.key==='Enter'&&!locked){event.preventDefault();event.stopPropagation();edit('title');}}}>{task.title||t('newNodeTitle')}</span>}</div><div className="wf-task-top-actions">{!isSession&&<span className={`wf-node-state is-${state}`} data-testid={`node-status-${id}`} data-state={state} title={stale?t('resultStaleHint'):undefined}>{awaitingApproval?<button type="button" className="wf-node-answer-status nodrag nopan" data-testid={`node-approval-${id}`} onClick={event=>{event.stopPropagation();data.onOpenApprovals?.(id);}}><Icon name="approval" size={11}/>{t('waitingApproval')}</button>:awaitingAnswers||data.pendingQuestionCount?<button type="button" className="wf-node-answer-status nodrag nopan" data-testid={`node-answer-${id}`} title={t('questionPendingCount',{count:data.pendingQuestionCount??1})} onClick={event=>{event.stopPropagation();data.onOpenQuestions?.(id);}}><Icon name="help" size={11}/>{awaitingAnswers?stateLabel:t('questionSupplement')}</button>:stateLabel}</span>}<button type="button" className="wf-icon-button wf-node-collapse nodrag nopan" title={t(data.collapsed?'expandNode':'collapseNode')} aria-label={t(data.collapsed?'expandNode':'collapseNode')} aria-expanded={!data.collapsed} data-testid={`node-collapse-${id}`} disabled={data.busy||!data.onCollapse} onClick={event=>{event.stopPropagation();data.onCollapse?.(id);}}><Icon name="collapse" size={16} style={{transform:data.collapsed?'none':'rotate(180deg)'}}/></button>{!isSession&&(active?<button type="button" className="wf-node-run nodrag nopan" data-testid={`node-stop-${id}`} title={t(waiting?'cancelWaiting':'stopExecution')} aria-label={t(waiting?'cancelWaiting':'stopExecution')} disabled={data.busy||!data.onCancelNode} onClick={event=>{event.stopPropagation();data.onCancelNode?.(active.runId);}}><Icon name="stop" size={13}/></button>:<button type="button" className="wf-node-run nodrag nopan" data-testid={`node-run-${id}`} title={t('runTask')} aria-label={t('runTask')} disabled={data.busy||data.editLocked||filesBusy||data.filesBusy||data.runtimeReady===false||data.modelsLoading||!canUseModel||!data.onRunNode} onClick={event=>{event.stopPropagation();data.onRunNode?.(id);}}><Icon name="play" size={14}/></button>)}</div></div>
    <div className="wf-task-body">
      {running&&<svg className="wf-running-perimeter" aria-hidden="true"><rect x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)" rx="17" pathLength="100"/></svg>}
      <div className="wf-task-content nowheel" onDoubleClick={event=>{event.preventDefault();event.stopPropagation();data.onOpenTextEditor?.(id);}}>
      <div ref={questionRef} data-testid={`node-instruction-${id}`} className={`wf-node-question ${task.instruction||data.root?.preview?'':'is-placeholder'}`} title={t('doubleClickToEdit')} tabIndex={0} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();data.onOpenTextEditor?.(id);}}}><MarkdownContent source={question}/></div>
    {!data.collapsed&&!isSession&&(data.execution?.summary||task.answerSummary)&&<div className="wf-answer-summary"><Icon name="sparkles" size={13}/><MarkdownContent source={data.execution?.summary||task.answerSummary||''}/></div>}
    {!data.collapsed&&<NodeFileAttachments nodeId={id} attachments={task.attachments} readOnly={isSession||data.editLocked} disabled={data.busy} onUploadFiles={data.onUploadFiles} onRemoveFile={data.onRemoveFile} onBusyChange={reportFilesBusy} t={t}/>}
      </div>
    </div>
    {!isSession&&!data.collapsed&&<footer className="wf-node-model-bubble nodrag nopan nowheel" data-testid={`node-model-bubble-${id}`} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()}><ModelPicker compact options={data.modelOptions} value={modelOptionKey(task.model)} defaultLabel={t('inheritModel',{model:modelOptionLabel(data.modelOptions??[],data.globalModelId,data.defaultModelLabel??t('nativeDefaultModel'))})} label={t('nodeModel')} loading={data.modelsLoading} error={data.modelsError} disabled={locked||data.filesBusy} onChange={data.onSelectNodeModel?value=>data.onSelectNodeModel?.(id,value):undefined} reasoningForOption={data.reasoningForNodeOption?value=>data.reasoningForNodeOption?.(id,value):undefined} onReasoningChange={data.onNodeReasoningChange?(value,effort)=>data.onNodeReasoningChange?.(id,value,effort):undefined} testId={`node-model-${id}`} t={t}/></footer>}
    {!data.busy&&!data.collapsed&&<NodeResizeControl position="bottom-right" minWidth={240} minHeight={180} maxWidth={1200} maxHeight={1000} className="wf-node-resize nodrag nopan" autoScale={false} onResizeEnd={(_event,size)=>data.onResizeNode?.(id,{width:Math.round(size.width),height:Math.round(size.height)})}><span data-testid={`node-resize-${id}`} role="separator" aria-label={t('resizeNode')} title={t('resizeNode')}><Icon name="resize" size={17}/></span></NodeResizeControl>}
    {isSession&&data.focused&&<div className="wf-root-actions nodrag nopan"><button onClick={event=>{event.stopPropagation();data.onOpenSession?.(sessionId!);}}><Icon name="chat" size={14}/>{t('openConversation')}</button>{data.root&&<button disabled={data.busy} onClick={event=>{event.stopPropagation();data.onImportSession?.(sessionId!);}}><Icon name="arrow" size={14}/>{t('enterWorkflow')}</button>}</div>}
    {!data.root&&<MagneticHandle nodeId={id} type="source" label={t('outputHandle')} enabled={isConnectable!==false&&!data.busy} bodyHeight={Math.max(9,(height??task.height??210)-29)} onMenu={data.onPortMenu}/>}
  </article>;
}
