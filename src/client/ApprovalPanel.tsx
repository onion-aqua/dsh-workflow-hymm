import { useEffect, useId, useRef, useState } from 'react';
import type { WorkflowPendingApproval, WorkflowApprovalDecision } from '../shared/model.ts';
import { Icon } from './icons.tsx';
import { translateZh, type Translate } from './locales.ts';
import './approval-panel.css';

export interface ApprovalPanelProps {
  approval:WorkflowPendingApproval;nodeTitle?:string;otherBranch?:boolean;submitting?:boolean;error?:string;
  onDecide?:(approval:WorkflowPendingApproval,decision:WorkflowApprovalDecision)=>Promise<void>;
  onClose?:()=>void;onOpenSession?:(sessionId:string)=>void;t?:Translate;
}
/** A visible native approval is not itself a grant. Only the two explicit decisions reach the Host. */
export function ApprovalPanel({approval,nodeTitle,otherBranch=false,submitting=false,error,onDecide,onClose,onOpenSession,t=translateZh}:ApprovalPanelProps){
  const heading=useId(),latch=useRef(false),mounted=useRef(true);
  const [pending,setPending]=useState(false),[sent,setSent]=useState(false),[localError,setLocalError]=useState('');
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setSent(false);setLocalError('');},[approval.sessionId,approval.approvalId]);
  const busy=pending||submitting,blocked=busy||sent||!approval.actionable||!onDecide;
  const decide=async(decision:WorkflowApprovalDecision)=>{
    if(blocked||latch.current)return;latch.current=true;setPending(true);setLocalError('');
    try{await onDecide!(approval,decision);if(mounted.current)setSent(true);}catch(cause){if(mounted.current)setLocalError(cause instanceof Error?cause.message:t('approvalFailed'));}finally{latch.current=false;if(mounted.current)setPending(false);}
  };
  return <section className="wf-approval-panel nodrag nopan nowheel" role="dialog" aria-modal="false" aria-labelledby={heading} aria-busy={busy} data-testid="approval-panel" data-approval-id={approval.approvalId} data-node-id={approval.nodeId}
    onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onWheel={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();onClose?.();}}}>
    <header className="wf-approval-header"><Icon name="approval" size={17}/><div><strong id={heading}>{t('approvalTitle')}</strong><span title={nodeTitle}>{nodeTitle??t('task')}</span></div>{otherBranch&&<small>{t('approvalOtherBranch')}</small>}{onClose&&<button type="button" className="wf-icon-button" aria-label={t('approvalHide')} data-testid="approval-close" onClick={onClose}><Icon name="close" size={15}/></button>}</header>
    <div className="wf-approval-body"><div className="wf-approval-tool"><Icon name="tool" size={14}/><b>{approval.toolName}</b></div>
      {approval.reason&&<div className="wf-approval-reason"><small>{t('approvalReason')}</small><p>{approval.reason}</p></div>}
      {approval.command&&<div><small>{t('approvalCommand')}</small><pre data-testid="approval-command"><code>{approval.command}</code></pre></div>}
      {approval.input&&approval.input!==approval.command&&<details open={!approval.command}><summary>{t('approvalInput')}</summary><pre data-testid="approval-input"><code>{approval.input}</code></pre></details>}
      {sent&&<p className="wf-approval-state" role="status">{t('approvalSubmitted')}</p>}
      {!sent&&(!approval.actionable||!onDecide)&&<p className="wf-approval-state">{t('approvalUnavailable')}{onOpenSession&&<button type="button" onClick={()=>onOpenSession(approval.sessionId)}>{t('openConversation')}</button>}</p>}
      {(localError||error)&&<p className="wf-approval-error" role="alert">{localError||error}</p>}
    </div>
    <footer className="wf-approval-footer"><button type="button" className="wf-button wf-button--quiet" data-testid="approval-reject" disabled={blocked} onClick={()=>void decide('rejected')}>{t('approvalReject')}</button><button type="button" className="wf-button wf-button--primary" data-testid="approval-allow" disabled={blocked} onClick={()=>void decide('allowed-once')}>{busy?<><span className="wf-approval-spinner"/>{t('approvalSubmitting')}</>:t('approvalAllowOnce')}</button></footer>
  </section>;
}
