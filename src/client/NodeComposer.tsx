import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { WorkflowNode } from '../shared/model.ts';
import { Icon } from './icons.tsx';
import { ModelPicker, modelChoiceAvailable, modelOptionKey, modelOptionLabel } from './ModelPicker.tsx';
import { NodeFileAttachments } from './NodeFileAttachments.tsx';
import { useSlashCommands } from './SlashCommands.tsx';
import type { Translate } from './locales.ts';
import type { ExecutionCard, WorkflowRuntimeProps } from './ui-contract.ts';
import './node-composer.css';

export interface NodeComposerProps extends Pick<WorkflowRuntimeProps,
  'modelOptions' | 'modelsLoading' | 'modelsError' | 'globalModelId' | 'defaultModelLabel' |
  'reasoningForNodeOption' | 'onNodeReasoningChange' | 'modelAvailable' | 'runtimeReady' | 'onReloadModels' | 'onUploadFiles' | 'onRemoveFile' |
  'contextUsage' | 'compacting' | 'onCompactContext' | 'skillOptions' | 'skillsLoading' | 'skillsError' | 'onReloadSkills'> {
  node:WorkflowNode;
  instruction:string;
  readOnly:boolean;
  busy:boolean;
  filesBusy?:boolean;
  activeRun?:ExecutionCard;
  onChangeInstruction:(value:string)=>void;
  /** Return false to keep the draft open when validation or conflict checks fail. */
  onCommit:()=>boolean;
  onRun:()=>void;
  onStop?:()=>void;
  onClose:()=>void;
  onExpand:()=>void;
  onSelectModel:(value:string|undefined)=>void;
  onFilesBusyChange?:(busy:boolean)=>void;
  t:Translate;
}

/** A controlled task draft. Native execution and persistence remain with the parent. */
export function NodeComposer({node,instruction,readOnly,busy,filesBusy=false,activeRun,
  modelOptions,modelsLoading,modelsError,globalModelId,defaultModelLabel,modelAvailable,runtimeReady,reasoningForNodeOption,onNodeReasoningChange,
  onChangeInstruction,onCommit,onRun,onStop,onClose,onExpand,onSelectModel,onReloadModels,
  onUploadFiles,onRemoveFile,onFilesBusyChange,contextUsage,compacting,onCompactContext,skillOptions,skillsLoading,skillsError,onReloadSkills,t}:NodeComposerProps){
  const textarea=useRef<HTMLTextAreaElement>(null);
  const composing=useRef(false);
  const currentNode=useRef(node.id);currentNode.current=node.id;
  const uploadBusy=useRef(false);
  const [uploadState,setUploadState]=useState({nodeId:node.id,busy:false});
  const localFilesBusy=uploadState.nodeId===node.id&&uploadState.busy;
  const transferring=filesBusy||localFilesBusy;
  const sourceReadOnly=node.kind==='session';
  const locked=readOnly||sourceReadOnly||busy||Boolean(activeRun)||transferring;
  const slash=useSlashCommands({value:instruction,onChange:onChangeInstruction,input:textarea,maxLength:20000,disabled:locked,skills:skillOptions,skillsLoading,skillsError,onReloadSkills,canCompact:Boolean(contextUsage?.canCompact&&!contextUsage.readOnly),compacting:compacting||contextUsage?.compacting,compactUnavailable:contextUsage?.unavailableReason,onCompact:onCompactContext,t});
  const available=modelChoiceAvailable(node.model,modelOptions,modelAvailable);
  const canRun=!locked&&!slash.working&&runtimeReady!==false&&!modelsLoading&&available;
  const canStop=Boolean(activeRun&&onStop)&&!sourceReadOnly&&!busy&&runtimeReady!==false;
  const waiting=Boolean(activeRun)&&activeRun?.status!=='running';
  const runLabel=t(activeRun?(waiting?'cancelWaiting':'stopExecution'):'runTask');
  const runDisabled=activeRun?!canStop:!canRun;
  const runHint=activeRun?runLabel:sourceReadOnly?t('nativeSourceProtected'):readOnly?t('editorReadOnlyHint'):
    transferring?t('uploadingFiles'):runtimeReady===false?t('runtimeUnavailable'):
    modelsLoading?t('modelsLoading'):!available?t('noModelConfigured'):runLabel;

  useLayoutEffect(()=>{
    const element=textarea.current;if(!element)return;
    const resize=()=>{
      element.style.height='auto';
      element.style.height=`${Math.max(84,Math.min(180,element.scrollHeight))}px`;
    };
    resize();
    let observedWidth=element.getBoundingClientRect().width;
    const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(entries=>{
      const width=entries[0]?.contentRect.width;
      if(width!==undefined&&width!==observedWidth){observedWidth=width;resize();}
    });
    observer?.observe(element);
    return()=>observer?.disconnect();
  },[node.id,instruction]);

  useLayoutEffect(()=>{uploadBusy.current=false;composing.current=false;},[node.id]);
  const changeFilesBusy=(value:boolean)=>{
    if(currentNode.current!==node.id)return;
    uploadBusy.current=value;setUploadState({nodeId:node.id,busy:value});onFilesBusyChange?.(value);
  };
  const commitAnd=(next:()=>void)=>{if(readOnly||sourceReadOnly||activeRun||onCommit())next();};
  const run=()=>{
    if(slash.interceptSubmit())return;
    if(!canRun||uploadBusy.current||filesBusy||composing.current)return;
    if(onCommit())onRun();
  };
  const onInputKeyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{
    event.stopPropagation();
    if(event.nativeEvent.isComposing||composing.current||event.keyCode===229)return;
    if(slash.onKeyDown(event))return;
    if(event.key==='Escape'){
      event.preventDefault();if(!busy)commitAnd(onClose);return;
    }
    if(event.key==='Enter'&&!event.shiftKey&&!event.altKey){
      event.preventDefault();if(!event.repeat)run();
    }
  };

  return <section className="wf-node-composer nodrag nopan nowheel" data-testid="node-composer" data-node-id={node.id}
    aria-label={t('nodeComposerTitle')} aria-busy={busy||transferring}
    onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}
    onDoubleClick={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()}
    onWheel={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
    <header className="wf-node-composer-header">
      <div className="wf-node-composer-title" title={node.title}><Icon name={sourceReadOnly?'chat':'task'} size={13}/><span>{node.title||t('newNodeTitle')}</span>{(readOnly||sourceReadOnly)&&<small>{t('editorReadOnly')}</small>}</div>
      <div className="wf-node-composer-window-actions">
        {!readOnly&&!sourceReadOnly&&!activeRun&&<span className="wf-node-composer-hint">{t('nodeComposerHint')}</span>}
        {!readOnly&&!sourceReadOnly&&<button type="button" className="wf-node-composer-save" data-testid="node-composer-save" disabled={locked} title={t('saveTask')} aria-label={t('saveTask')} onClick={()=>onCommit()}><Icon name="check" size={13}/></button>}
        <button type="button" className="wf-node-composer-icon" data-testid="node-composer-expand" title={t('editorMaximize')} aria-label={t('editorMaximize')} disabled={busy||transferring} onClick={()=>commitAnd(onExpand)}><Icon name="maximize" size={15}/></button>
        <button type="button" className="wf-node-composer-icon" data-testid="node-composer-close" title={t('close')} aria-label={t('close')} disabled={busy} onClick={()=>commitAnd(onClose)}><Icon name="close" size={16}/></button>
      </div>
    </header>
    <textarea ref={textarea} className="wf-node-composer-input nodrag nopan nowheel" data-testid="node-composer-input"
      aria-label={t('taskInstruction')} aria-readonly={locked} readOnly={locked} value={instruction} maxLength={20000}
      placeholder={t('instructionPlaceholder')} spellCheck={false} rows={3}
      {...slash.aria} onChange={slash.onChange} onSelect={slash.onSelect} onFocus={slash.onFocus} onBlur={slash.onBlur}
      onKeyDown={onInputKeyDown} onCompositionStart={()=>{composing.current=true;slash.onCompositionStart();}} onCompositionEnd={()=>{composing.current=false;slash.onCompositionEnd();}}/>
    {slash.menu}{slash.feedback}
    <footer className="wf-node-composer-footer">
      <div className="wf-node-composer-files"><NodeFileAttachments key={node.id} nodeId={node.id} testIdPrefix={`composer-${node.id}`} attachments={node.attachments}
        readOnly={readOnly||sourceReadOnly||Boolean(activeRun)} disabled={busy||filesBusy} onUploadFiles={onUploadFiles}
        onRemoveFile={onRemoveFile} onBusyChange={changeFilesBusy} t={t}/></div>
      <div className="wf-node-composer-run-controls">
        <ModelPicker compact options={modelOptions} value={modelOptionKey(node.model)}
          defaultLabel={t('inheritModel',{model:modelOptionLabel(modelOptions??[],globalModelId,defaultModelLabel??t('nativeDefaultModel'))})}
          label={t('nodeModel')} loading={modelsLoading} error={modelsError} disabled={locked}
          onChange={value=>{if(onCommit())onSelectModel(value);}} reasoningForOption={reasoningForNodeOption?value=>reasoningForNodeOption(node.id,value):undefined} onReasoningChange={onNodeReasoningChange?async(value,effort)=>{if(onCommit())await onNodeReasoningChange(node.id,value,effort);}:undefined} testId="node-composer-model" t={t}/>
        {modelsError&&onReloadModels&&<button type="button" className="wf-node-composer-icon" data-testid="node-composer-reload-models" title={modelsError} aria-label={t('reloadModels')} disabled={modelsLoading||busy} onClick={()=>void onReloadModels()}><Icon name="retry" size={14}/></button>}
        <button type="button" className={`wf-node-composer-send ${activeRun?'is-stopping':''}`} data-testid={activeRun?'node-composer-stop':'node-composer-run'}
          title={runHint} aria-label={runLabel} disabled={runDisabled}
          onClick={()=>{if(activeRun){if(canStop)onStop?.();}else run();}}><Icon name={activeRun?'stop':'send'} size={20}/></button>
      </div>
    </footer>
  </section>;
}
