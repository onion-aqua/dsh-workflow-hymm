import { useEffect, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from './icons.tsx';
import type { IconName } from './icons.tsx';
import { translateZh } from './locales.ts';
import type { Translate, WorkflowKey } from './locales.ts';
import { executionStatusText } from './TaskNode.tsx';
import type { ExecutionCard, TraceStepCard } from './ui-contract.ts';

/** Observable execution facts only; reasoning blocks never enter this presentation input. */
export interface TraceStepSummary extends TraceStepCard {
  actionKind?:'read'|'edit'|'write'|'command'|'search'|'fetch'|'tool';
  target?:string;
}
export interface TracePanelProps {
  nodeTitle:string;runId?:string;status?:string;loading?:boolean;error?:string;
  steps?:readonly TraceStepSummary[];executions?:readonly ExecutionCard[];detailsLoadingStepIds?:readonly string[];
  onSelectExecution?:(runId:string)=>void;onReadStep?:(stepId:string)=>void|Promise<void>;onOpenSession?:(sessionId:string)=>void;
  onClose:()=>void;t?:Translate;
  onHeaderPointerDown?:(event:ReactPointerEvent<HTMLElement>)=>void;pinned?:boolean;
}

/** Generic model-step containers add no timeline facts once concrete native actions exist. */
export function visibleTraceSteps(steps:readonly TraceStepSummary[]):readonly TraceStepSummary[]{
  const concrete=steps.filter(step=>step.type!=='agent_step');
  return concrete.length?concrete:steps.length?[steps.at(-1)!]:[];
}
function actionKind(step:TraceStepSummary):NonNullable<TraceStepSummary['actionKind']>{
  if(step.actionKind)return step.actionKind;
  if(step.type==='command')return 'command';
  const tool=(step.toolName??'').toLowerCase();
  if(/^(?:read|read_file|file_read|readfile)$/.test(tool))return 'read';
  if(/^(?:edit|edit_file|apply_patch|patch_file)$/.test(tool))return 'edit';
  if(/^(?:write|write_file|file_write)$/.test(tool))return 'write';
  if(/^(?:search|grep|glob|rg|web_search)$/.test(tool))return 'search';
  if(/^(?:fetch|web_fetch|http_fetch)$/.test(tool))return 'fetch';
  return 'tool';
}
const actionKeys={read:['traceRead','traceReadingAction','traceReadFailed'],edit:['traceEdited','traceEditing','traceEditFailed'],write:['traceWrote','traceWriting','traceWriteFailed'],command:['traceRan','traceRunningCommand','traceCommandFailed'],search:['traceSearched','traceSearching','traceSearchFailed'],fetch:['traceFetched','traceFetching','traceFetchFailed'],tool:['traceCalled','traceCalling','traceCallFailed']} as const;
const actionIcons:Record<NonNullable<TraceStepSummary['actionKind']>,IconName>={read:'file',edit:'edit',write:'file',command:'terminal',search:'search',fetch:'globe',tool:'tool'};
const approvalIsWaiting=(step:TraceStepSummary)=>step.status==='waiting_approval'||step.status==='blocked'&&step.eventEndSeq===undefined;
function rowPresentation(step:TraceStepSummary,t:Translate):{verb:string;target:string;fullTarget:string;icon:IconName}{
  if(step.type==='error')return {verb:t('traceExecutionFailed'),target:step.target??step.title,fullTarget:step.target??step.title,icon:'close'};
  if(step.type==='approval')return {verb:t(approvalIsWaiting(step)?'traceApprovalNeeded':step.status==='completed'?'traceApproved':'traceApprovalStopped'),target:step.target??step.toolName??step.title,fullTarget:step.target??step.toolName??step.title,icon:'approval'};
  if(step.type==='agent_step')return {verb:executionStatusText(step.status,t),target:t('traceAgent'),fullTarget:t('traceAgent'),icon:'sparkles'};
  const kind=actionKind(step);const keys=actionKeys[kind];
  const index=step.status==='failed'?2:['running','queued','ready','pending','waiting_approval'].includes(step.status)?1:0;
  const fullTarget=(step.target??(step.command?.replace(/\s+/g,' ').trim())??step.toolName??step.title).slice(0,240);
  const target=['read','edit','write'].includes(kind)&&step.target?fullTarget.replace(/\\/g,'/').split('/').filter(Boolean).slice(-2).join('/'):fullTarget;
  return {verb:step.status==='completed'||index>0?t(keys[index] as WorkflowKey):executionStatusText(step.status,t),target,fullTarget,icon:actionIcons[kind]};
}
function rowDepth(step:TraceStepSummary,rows:readonly TraceStepSummary[]):number{
  let depth=0;let parent=step.parentStepId;const visited=new Set<string>();
  while(parent&&!visited.has(parent)){visited.add(parent);const ancestor=rows.find(row=>row.id===parent);if(!ancestor)break;depth++;parent=ancestor.parentStepId;}
  return Math.min(depth,3);
}
function shellCommand(step:TraceStepSummary):string|undefined{
  if(step.command!==undefined)return step.command;
  if(step.type==='command'&&step.input&&!/^[\s]*[\[{]/.test(step.input))return step.input;
  return;
}

export function TracePanel({nodeTitle,runId,status,loading=false,error,steps=[],executions=[],detailsLoadingStepIds=[],onSelectExecution,onReadStep,onOpenSession,onClose,onHeaderPointerDown,pinned=false,t=translateZh}:TracePanelProps){
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set());const [copied,setCopied]=useState<string|null>(null);
  useEffect(()=>{setExpanded(new Set());setCopied(null);},[runId]);
  useEffect(()=>{
    if(!onReadStep)return;
    for(const step of steps){
      const loaded=step.eventName!==undefined||step.input!==undefined||step.command!==undefined||step.output!==undefined||step.error!==undefined;
      if(expanded.has(step.id)&&!loaded&&!step.unavailable&&!detailsLoadingStepIds.includes(step.id))void onReadStep(step.id);
    }
  },[expanded,steps,detailsLoadingStepIds,onReadStep]);
  const toggle=(step:TraceStepSummary)=>setExpanded(previous=>{const next=new Set(previous);next.has(step.id)?next.delete(step.id):next.add(step.id);return next;});
  const copy=async(id:string,text:string)=>{try{await navigator.clipboard.writeText(text);setCopied(id);}catch{setCopied(null);}};
  const execution=executions.find(item=>item.runId===runId);const rows=visibleTraceSteps(steps);
  const displayedStatus=status??execution?.status??'draft';
  const executionError=Boolean(error&&displayedStatus==='failed');
  const copyButton=(stepId:string,text:string,label=t('copyOutput'))=><button className="wf-icon-button" aria-label={label} title={label} onClick={()=>void copy(stepId,text)}><Icon name={copied===stepId?'check':'copy'} size={13}/></button>;
  return <section className="wf-trace" role="dialog" aria-label={t('traceTitle')} aria-description={nodeTitle} data-testid="trace-panel" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onWheel={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.stopPropagation();onClose();}}}>
    <header className="wf-trace-header" title={nodeTitle} data-draggable={Boolean(onHeaderPointerDown)} onPointerDown={onHeaderPointerDown}><Icon name="trace" size={15}/><strong title={nodeTitle}>{pinned?nodeTitle:t('traceCompactTitle')}</strong><div className="wf-trace-meta"><span className={`wf-tag wf-tag--${displayedStatus}`}>{loading?t('traceReading'):error&&!executionError?t('traceReadError'):status||execution?executionStatusText(displayedStatus,t):t('notExecuted')}</span><span className="wf-trace-count" title={t('traceStepCount',{count:rows.length})}>{rows.length}</span></div>{execution&&onOpenSession&&<button className="wf-icon-button" aria-label={t('openConversation')} title={t('openConversation')} onClick={()=>onOpenSession(execution.sessionId)}><Icon name="chat" size={14}/></button>}<button className="wf-icon-button" aria-label={t('traceClose')} data-testid="trace-close" onClick={onClose}><Icon name="close" size={15}/></button></header>
    {executions.length>1&&<div className="wf-trace-execution"><select aria-label={t('executionHistory')} data-testid="execution-select" value={runId??''} onChange={event=>onSelectExecution?.(event.target.value)}>{executions.map((item,index)=><option key={item.runId} value={item.runId}>{`#${index+1} · v${item.nodeRevision} · ${executionStatusText(item.status,t)}`}</option>)}</select></div>}
    <div className="wf-trace-body"><span className="wf-sr-only">{nodeTitle}</span>
      {loading?<div className="wf-trace-loading" role="status"><div/><div/><div/><span>{t('traceLoading')}</span></div>:error?<div className="wf-trace-empty wf-trace-error"><Icon name="trace" size={22}/><strong>{t(executionError?'traceExecutionFailed':'traceErrorTitle')}</strong><p>{error}</p></div>:rows.length===0?<div className="wf-trace-empty" data-testid="trace-empty"><Icon name="trace" size={22}/><strong>{t('traceEmptyTitle')}</strong><p>{t('traceEmptyDescription')}</p><span className="wf-sr-only">{t('traceStepCount',{count:0})}</span></div>:<div className="wf-trace-steps">{rows.map(step=>{
        const row=rowPresentation(step,t);const depth=rowDepth(step,rows);const command=shellCommand(step);const shell=step.type==='command'||step.actionKind==='command';const isOpen=expanded.has(step.id);const detailLoading=detailsLoadingStepIds.includes(step.id);
        return <div className={`wf-trace-step wf-trace-step--${step.status} ${depth?'is-child':''}`} key={step.id} style={{'--trace-depth':depth} as CSSProperties}>
          <button className="wf-trace-step-heading" title={`${row.verb} ${row.fullTarget}`} aria-expanded={isOpen} aria-label={`${row.verb} ${row.fullTarget}`} onClick={()=>toggle(step)}><span className="wf-trace-status-mark" title={executionStatusText(step.status,t)}><Icon name={step.status==='failed'?'close':row.icon} size={12}/></span><span className="wf-trace-action">{row.verb}</span><span className="wf-trace-target">{row.target}</span><Icon name="chevron" size={12} style={{transform:isOpen?'rotate(90deg)':undefined}}/></button>
          {isOpen&&<div className="wf-trace-step-details">
            {detailLoading?<p className="wf-trace-detail-status" role="status">{t('traceDetailsLoading')}</p>:step.unavailable?<><p className="wf-trace-detail-status is-error">{t('traceUnavailable')} · {step.unavailable}</p>{onReadStep&&<button className="wf-trace-retry" onClick={()=>void onReadStep(step.id)}><Icon name="retry" size={12}/>{t('traceDetailsRetry')}</button>}</>:<>
              {shell&&(command!==undefined||step.output!==undefined)&&<div className="wf-trace-shell"><div className="wf-trace-code-toolbar"><span><Icon name="terminal" size={12}/>{t('traceShell')}</span>{copyButton(step.id,step.output??command??'')}</div><pre className="wf-trace-shell-code">{command!==undefined&&<span className="wf-trace-shell-command">$ {command}</span>}{step.output!==undefined&&<span className="wf-trace-shell-output">{command!==undefined?'\n':''}{step.output}</span>}</pre></div>}
              {!shell&&step.input!==undefined&&<div className="wf-trace-code-block"><div className="wf-trace-code-toolbar"><span>{t('traceInput')}</span></div><pre>{step.input}</pre></div>}
              {!shell&&step.output!==undefined&&<div className="wf-trace-code-block"><div className="wf-trace-code-toolbar"><span>{t('traceOutput')}</span>{copyButton(step.id,step.output)}</div><pre>{step.output}</pre></div>}
              {step.error!==undefined&&<div className="wf-trace-code-block is-error"><div className="wf-trace-code-toolbar"><span>{t('traceError')}</span>{copyButton(`${step.id}:error`,step.error,t('copyError'))}</div><pre className="is-error">{step.error}</pre></div>}
              {step.input===undefined&&step.command===undefined&&step.output===undefined&&step.error===undefined&&onReadStep&&<button className="wf-trace-retry" onClick={()=>void onReadStep(step.id)}><Icon name="retry" size={12}/>{t('traceDetailsRetry')}</button>}
              {step.truncated&&<p className="wf-trace-detail-status">{t('traceTruncated')}</p>}
            </>}
            {step.type==='approval'&&approvalIsWaiting(step)&&<p className="wf-trace-detail-status wf-trace-approval"><Icon name="approval" size={12}/>{t('nativeApproval')}</p>}
            <details className="wf-trace-more"><summary>{t('traceMoreInfo')}</summary><dl>{step.target&&<><dt>{t('traceTarget')}</dt><dd><code>{step.target}</code></dd></>}<dt>{t('traceState')}</dt><dd>{executionStatusText(step.status,t)}</dd>{step.time!==undefined&&<><dt>{t('traceTime')}</dt><dd><time>{new Date(step.time).toLocaleString()}</time></dd></>}{step.toolName&&<><dt>{t('traceTool')}</dt><dd><code>{step.toolName}</code></dd></>}{step.eventName&&<><dt>{t('traceEvent')}</dt><dd><code>{step.eventName}</code></dd></>}{step.eventStartSeq!==undefined&&<><dt>{t('traceSequence')}</dt><dd><code>{step.eventStartSeq}{step.eventEndSeq!==undefined&&step.eventEndSeq!==step.eventStartSeq?`–${step.eventEndSeq}`:''}</code></dd></>}</dl>{shell&&step.input!==undefined&&step.input!==command&&<details className="wf-trace-raw-input"><summary>{t('traceRawInput')}</summary><pre>{step.input}</pre></details>}</details>
          </div>}
        </div>;
      })}</div>}
      {execution?.terminalReason&&<details className="wf-trace-terminal"><summary>{t('terminalReason')}</summary><code>{execution.terminalReason}</code></details>}
      {execution?.durability&&execution.durability!=='durable'&&<p className="wf-trace-detail-status">{t('pendingDurability')}</p>}
    </div>
  </section>;
}
