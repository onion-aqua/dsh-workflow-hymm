import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {WorkflowSessionArchivePreviewValue,WorkflowSessionArchiveValue} from '../shared/model.ts';
import type {Translate} from './locales.ts';
import {Icon} from './icons.tsx';

interface Props {
  workflow:{id:string;name:string};t:Translate;onClose:()=>void;
  onPreview:(id:string)=>Promise<WorkflowSessionArchivePreviewValue>;
  onArchive:(preview:WorkflowSessionArchivePreviewValue)=>Promise<WorkflowSessionArchiveValue>;
}

/** The workflow has already been archived. Native history needs its own explicit choice. */
export function WorkflowHistoryChoice({workflow,t,onClose,onPreview,onArchive}:Props){
  const [preview,setPreview]=useState<WorkflowSessionArchivePreviewValue>();
  const [loading,setLoading]=useState(true),[archiving,setArchiving]=useState(false),[error,setError]=useState('');
  const [result,setResult]=useState<WorkflowSessionArchiveValue>();
  const [reload,setReload]=useState(0);const latch=useRef(false),dialog=useRef<HTMLDivElement>(null),keep=useRef<HTMLButtonElement>(null);
  const heading=useId(),description=useId();
  useEffect(()=>{keep.current?.focus();},[]);
  useEffect(()=>{
    let current=true;setLoading(true);setError('');setPreview(undefined);setResult(undefined);
    void onPreview(workflow.id).then(value=>{if(current)setPreview(value);}).catch(cause=>{if(current)setError(cause instanceof Error?cause.message:String(cause));}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
  },[workflow.id,onPreview,reload]);
  const close=()=>{if(!latch.current)onClose();};
  const archive=async()=>{
    if(latch.current||!preview?.available||!preview.sessionIds.length)return;
    latch.current=true;setArchiving(true);setError('');
    try{
      const value=await onArchive(preview);setPreview(undefined);
      if(!value.failedSessionIds.length&&!value.skippedSessionIds.length)onClose();else setResult(value);
    }catch(cause){
      // A lost response cannot authorize replay. A fresh preview must be requested explicitly.
      setPreview(undefined);setError(`${t('historyArchiveUncertain')} ${cause instanceof Error?cause.message:String(cause)}`);
    }finally{latch.current=false;setArchiving(false);}
  };
  return createPortal(<div className="wf-picker-confirm-backdrop" onPointerDown={event=>{event.stopPropagation();if(event.target===event.currentTarget)close();}}
    onClick={event=>event.stopPropagation()} onKeyDown={event=>{
      event.stopPropagation();if(event.nativeEvent.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='Tab'){
        const choices=[...dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],first=choices[0],last=choices.at(-1);
        if(!choices.length){event.preventDefault();return;}
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    }}><div ref={dialog} className="wf-picker-confirm wf-history-choice" role="alertdialog" aria-modal="true" aria-labelledby={heading} aria-describedby={description} aria-busy={loading||archiving} data-testid="workflow-history-choice">
      <h2 id={heading}>{t('historyArchiveTitle')}</h2><strong>{workflow.name}</strong>
      <p id={description}>{t('historyArchiveDescription')}</p>
      {loading?<p role="status">{t('historyArchiveLoading')}</p>:preview&&<>
        <p className="wf-history-count" data-testid="history-archive-count"><Icon name="chat" size={15}/>{t('historyArchiveCount',{count:preview.sessionIds.length})}</p>
        {preview.protectedCount>0&&<p>{t('historyArchiveProtected',{count:preview.protectedCount})}</p>}
        {preview.alreadyArchivedCount>0&&<p>{t('historyArchiveAlready',{count:preview.alreadyArchivedCount})}</p>}
        {!preview.available&&<p role="status">{preview.reason??t('historyArchiveUnavailable')}</p>}
      </>}
      {result&&<p role="status" data-testid="history-archive-result">{t('historyArchivePartial',{archived:result.archivedSessionIds.length,remaining:result.failedSessionIds.length+result.skippedSessionIds.length})}</p>}
      {error&&<p role="alert" className="is-error">{error}</p>}
      <footer><button ref={keep} type="button" disabled={archiving} data-testid="keep-workflow-history" onClick={close}>{t('historyArchiveKeep')}</button>
        {!loading&&!preview&&(error||result)?<button type="button" disabled={archiving} data-testid="history-archive-recheck" onClick={()=>setReload(value=>value+1)}>{t('historyArchiveRecheck')}</button>:<button type="button" className="is-danger" data-testid="confirm-archive-history" disabled={loading||archiving||!preview?.available||!preview.sessionIds.length} onClick={()=>void archive()}>{archiving?t('historyArchiveBusy'):t('historyArchiveConfirm',{count:preview?.sessionIds.length??0})}</button>}
      </footer>
    </div></div>,document.body);
}
