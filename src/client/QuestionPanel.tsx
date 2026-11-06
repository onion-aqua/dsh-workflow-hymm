import { useEffect, useId, useRef, useState } from 'react';
import type { WorkflowPendingQuestion, WorkflowQuestionAnswer } from '../shared/model.ts';
import { MarkdownContent } from './MarkdownContent.tsx';
import { Icon } from './icons.tsx';
import type { Translate } from './locales.ts';
import './question-panel.css';

interface AnswerDraft { selected:string[];custom:string;customOpen:boolean;skipped:boolean }
export interface QuestionPanelProps {
  question:WorkflowPendingQuestion;nodeTitle:string;otherBranch?:boolean;submitting?:boolean;error?:string;
  onAnswer?:(question:WorkflowPendingQuestion,answers:WorkflowQuestionAnswer[])=>Promise<void>;
  onClose:()=>void;onOpenSession?:(sessionId:string)=>void;t:Translate;
  onPauseAutomation?:(question:WorkflowPendingQuestion)=>Promise<void>;
}
/** Answers are private UI drafts until the complete native question batch is submitted. */
export function QuestionPanel({question,nodeTitle,otherBranch=false,submitting=false,error,onAnswer,onClose,onOpenSession,onPauseAutomation,t}:QuestionPanelProps){
  const heading=useId(),names=useId();const mounted=useRef(true),latch=useRef(false);
  const [drafts,setDrafts]=useState<Record<string,AnswerDraft>>({}),[pending,setPending]=useState(false),[sent,setSent]=useState(false),[localError,setLocalError]=useState('');
  const [now,setNow]=useState(Date.now()),[autoPaused,setAutoPaused]=useState(false);
  useEffect(()=>{if(!question.autoContinueAt||question.autoContinuePaused)return;const timer=setInterval(()=>setNow(Date.now()),500);return()=>clearInterval(timer);},[question.autoContinueAt,question.autoContinuePaused]);
  const pauseAutomation=()=>{if(!question.autoContinueAt||question.autoContinuePaused||autoPaused)return;setAutoPaused(true);void onPauseAutomation?.(question).catch(error=>setLocalError(String(error instanceof Error?error.message:error)));};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const draft=(id:string):AnswerDraft=>drafts[id]??{selected:[],custom:'',customOpen:false,skipped:false};
  const change=(id:string,patch:Partial<AnswerDraft>)=>{pauseAutomation();setDrafts(previous=>({...previous,[id]:{...(previous[id]??{selected:[],custom:'',customOpen:false,skipped:false}),...patch}}));setLocalError('');};
  const continued=question.state==='continued';
  const busy=submitting||pending;
  const blocked=busy||sent||!question.actionable||!onAnswer;
  const complete=question.questions.every(item=>{const value=draft(item.id);return value.skipped||value.selected.length>0||Boolean(value.custom.trim());});
  const submit=async(skipAll=false)=>{
    if(blocked||latch.current)return;
    if(!skipAll&&!complete){setLocalError(t('questionIncomplete'));return;}
    const answers=question.questions.map(item=>{const value=draft(item.id);return skipAll||value.skipped?{id:item.id,selected:[]}:{id:item.id,selected:value.selected,...(value.custom.trim()?{custom:value.custom.trim()}:{})};});
    latch.current=true;setPending(true);setLocalError('');
    try{await onAnswer!(question,answers);if(mounted.current)setSent(true);}
    catch(cause){if(mounted.current)setLocalError(cause instanceof Error?cause.message:t('questionFailed'));}
    finally{latch.current=false;if(mounted.current)setPending(false);}
  };
  return <section className="wf-question-panel nodrag nopan nowheel" role="dialog" aria-modal="false" aria-labelledby={heading}
    aria-busy={busy} data-testid="question-panel" data-call-id={question.callId} data-node-id={question.nodeId}
    onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()}
    onWheel={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()}
    onKeyDown={event=>{event.stopPropagation();if(event.nativeEvent.isComposing||event.keyCode===229)return;if(event.key==='Escape'){event.preventDefault();onClose();}else if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();if(!event.repeat)void submit();}}}>
    <header className="wf-question-header"><Icon name="help" size={16}/><div><strong id={heading}>{t('waitingAnswer')}</strong><span title={nodeTitle}>{nodeTitle}</span></div>{otherBranch&&<small>{t('questionOtherBranch')}</small>}<button type="button" className="wf-icon-button" aria-label={t('questionHide')} title={t('questionHide')} data-testid="question-close" onClick={onClose}><Icon name="close" size={15}/></button></header>
    <form onSubmit={event=>{event.preventDefault();void submit();}}>
      <div className="wf-question-body">
        {question.autoContinueAt&&<div className="wf-question-state" data-testid="question-auto-countdown">{question.autoContinuePaused||autoPaused?t('autoAnswerPaused'):t('autoAnswerCountdown',{seconds:Math.max(0,Math.ceil((question.autoContinueAt-now)/1000))})}{!question.autoContinuePaused&&!autoPaused&&<button type="button" data-testid="question-auto-pause" onClick={pauseAutomation}>{t('pauseAutoAnswer')}</button>}</div>}
        {question.questions.map((item,index)=>{const value=draft(item.id);return <fieldset key={item.id} className={value.skipped?'is-skipped':undefined} disabled={blocked} data-testid={`question-item-${item.id}`}>
          <legend>{item.header||t('questionNumber',{number:index+1,total:question.questions.length})}{item.multiSelect&&<small>{t('questionMultiple')}</small>}</legend>
          <div className="wf-question-prompt"><MarkdownContent source={item.question}/></div>
          {item.detail&&<div className="wf-question-detail"><MarkdownContent source={item.detail}/></div>}
          {(item.options??[]).map((option,optionIndex)=><label className={`wf-question-option ${!value.skipped&&value.selected.includes(option.label)?'is-selected':''}`} key={`${optionIndex}:${option.label}`}>
            <input type={item.multiSelect?'checkbox':'radio'} name={`${names}-${item.id}`} checked={!value.skipped&&value.selected.includes(option.label)}
              onChange={()=>change(item.id,{skipped:false,selected:item.multiSelect?(value.selected.includes(option.label)?value.selected.filter(label=>label!==option.label):[...value.selected,option.label]):[option.label]})}/>
            <span><b>{option.label}</b>{option.description&&<small>{option.description}</small>}</span>
          </label>)}
          <div className="wf-question-item-actions"><button type="button" aria-expanded={value.customOpen} data-testid={`question-custom-${item.id}`} onClick={()=>change(item.id,{customOpen:!value.customOpen,skipped:false})}><Icon name="edit" size={12}/>{t('questionCustom')}</button><button type="button" aria-pressed={value.skipped} data-testid={`question-skip-${item.id}`} onClick={()=>change(item.id,{skipped:!value.skipped})}>{t(value.skipped?'questionUndoSkip':'questionSkip')}</button></div>
          {value.customOpen&&<textarea aria-label={t('questionCustomFor',{question:item.question})} placeholder={t('questionCustomPlaceholder')} data-testid={`question-custom-input-${item.id}`} value={value.custom} rows={3} onChange={event=>change(item.id,{custom:event.target.value,skipped:false})}/>}
          {value.skipped&&<p className="wf-question-skipped">{t('questionSkipped')}</p>}
        </fieldset>;})}
        {sent&&<p className="wf-question-state" role="status">{t('questionSubmitted')}</p>}
        {!sent&&continued&&question.actionable&&<p className="wf-question-state" role="status">{t('questionContinued')}</p>}
        {!sent&&(!question.actionable||!onAnswer)&&<p className="wf-question-state">{t('questionUnavailable')}{onOpenSession&&<button type="button" onClick={()=>onOpenSession(question.sessionId)}>{t('openConversation')}</button>}</p>}
        {(error||localError)&&<p className="wf-question-error" role="alert">{localError||error}</p>}
      </div>
      <footer className="wf-question-footer"><button type="button" className="wf-button wf-button--quiet" data-testid="question-skip-all" disabled={blocked} onClick={()=>void submit(true)}>{t('questionSkipAll')}</button><button type="submit" className="wf-button wf-button--primary" data-testid="question-submit" disabled={blocked||!complete}>{busy?<><span className="wf-question-spinner"/>{t('questionSubmitting')}</>:t('questionSubmit')}</button></footer>
    </form>
  </section>;
}
