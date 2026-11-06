import { useEffect, useRef, useState } from 'react';
import type { WorkflowNodeAttachment } from '../shared/model.ts';
import { Icon } from './icons.tsx';
import type { Translate } from './locales.ts';

/** `index` is the zero-based file currently transferred in the ordered selection. */
export interface NodeFileUploadProgress { loaded:number; total?:number; index:number; count:number }
export type UploadNodeFiles=(nodeId:string,files:File[],signal?:AbortSignal,onProgress?:(progress:NodeFileUploadProgress)=>void)=>Promise<void>;
export type RemoveNodeFile=(nodeId:string,fileId:string)=>Promise<void>;
interface Props {
  nodeId:string; testIdPrefix?:string; attachments?:readonly WorkflowNodeAttachment[]; readOnly?:boolean; disabled?:boolean;
  onUploadFiles?:UploadNodeFiles; onRemoveFile?:RemoveNodeFile; onBusyChange?:(busy:boolean)=>void; t:Translate;
}
function fileSize(bytes:number):string{if(bytes<1024)return `${bytes} B`;if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;if(bytes<1024*1024*1024)return `${(bytes/1024/1024).toFixed(1)} MB`;return `${(bytes/1024/1024/1024).toFixed(1)} GB`;}

/** Only confirmed native references appear as attached files. Failed selections stay retryable. */
export function NodeFileAttachments({nodeId,testIdPrefix=nodeId,attachments=[],readOnly=false,disabled=false,onUploadFiles,onRemoveFile,onBusyChange,t}:Props){
  const inputRef=useRef<HTMLInputElement>(null);const controllerRef=useRef<AbortController|null>(null);const mounted=useRef(true);
  const retryFiles=useRef<File[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [progress,setProgress]=useState<NodeFileUploadProgress>();
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controllerRef.current?.abort();onBusyChange?.(false);};},[]);
  const setWorking=(value:boolean)=>{if(mounted.current)setBusy(value);onBusyChange?.(value);};
  const upload=async(files:File[])=>{
    if(readOnly||disabled||controllerRef.current||!files.length||!onUploadFiles)return;
    const controller=new AbortController();controllerRef.current=controller;retryFiles.current=files;setError('');setProgress({loaded:0,total:files[0]?.size,index:0,count:files.length});setWorking(true);
    try{await onUploadFiles(nodeId,files,controller.signal,item=>{if(mounted.current&&controllerRef.current===controller)setProgress(item);});if(mounted.current)retryFiles.current=[];}
    catch(cause){if(mounted.current)setError(controller.signal.aborted?t('uploadCancelled'):cause instanceof Error?cause.message:t('uploadFailed'));}
    finally{if(controllerRef.current===controller){controllerRef.current=null;if(mounted.current){setProgress(undefined);setWorking(false);}}}
  };
  const remove=async(fileId:string)=>{
    if(readOnly||disabled||busy||!onRemoveFile)return;setError('');setWorking(true);
    try{await onRemoveFile(nodeId,fileId);}catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:t('uploadFailed'));}finally{if(mounted.current)setWorking(false);}
  };
  if(readOnly&&!attachments.length)return null;
  const current=progress?retryFiles.current[progress.index]:undefined;
  return <div className="wf-node-files nodrag nopan nowheel" data-testid={`node-files-${testIdPrefix}`} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onDoubleClick={event=>{if((event.target as Element).closest('button,input,li'))event.stopPropagation();}} onKeyDown={event=>{if(!((event.ctrlKey||event.metaKey)&&['z','y','c','v','x'].includes(event.key.toLowerCase())))event.stopPropagation();}} onContextMenu={event=>event.stopPropagation()} aria-label={t('attachedFiles')}>
    {attachments.length>0&&<ul>{attachments.map(attachment=><li key={attachment.id} data-testid={testIdPrefix===nodeId?`node-file-${attachment.id}`:`node-file-${testIdPrefix}-${attachment.id}`}><Icon name="file" size={14}/><span title={attachment.file.name}>{attachment.file.name}<small>{fileSize(attachment.file.bytes)}</small></span>{!readOnly&&<button type="button" className="wf-icon-button" data-testid={testIdPrefix===nodeId?`remove-file-${attachment.id}`:`remove-file-${testIdPrefix}-${attachment.id}`} aria-label={`${t('removeFile')} ${attachment.file.name}`} title={t('removeFile')} disabled={disabled||busy||!onRemoveFile} onClick={()=>void remove(attachment.id)}><Icon name="close" size={12}/></button>}</li>)}</ul>}
    {!readOnly&&<div className="wf-node-file-actions"><input ref={inputRef} type="file" multiple hidden data-testid={`file-input-${testIdPrefix}`} aria-label={t('chooseFiles')} disabled={disabled||busy||!onUploadFiles} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';void upload(files);}}/><button type="button" className="wf-node-file-add" data-testid={`attach-files-${testIdPrefix}`} title={t(onUploadFiles?'attachFiles':'fileUploadUnavailable')} disabled={disabled||busy||!onUploadFiles} onClick={()=>inputRef.current?.click()}><Icon name="paperclip" size={13}/>{t('attachFiles')}</button>{attachments.length>0&&<span>{t('fileCount',{count:attachments.length})}</span>}</div>}
    {busy&&progress&&<div className="wf-node-file-upload" role="status" data-testid={`file-upload-progress-${testIdPrefix}`}><div><span>{t('uploadingFiles')} {progress.index+1}/{progress.count}</span><button type="button" className="wf-icon-button" data-testid={`cancel-upload-${testIdPrefix}`} title={t('cancelUpload')} aria-label={t('cancelUpload')} onClick={()=>controllerRef.current?.abort()}><Icon name="close" size={12}/></button></div><small title={current?.name}>{current?.name}</small><progress aria-label={t('uploadingFiles')} value={progress.total?Math.min(progress.loaded,progress.total):undefined} max={progress.total||undefined}/></div>}
    {error&&<div className="wf-node-file-error" role="alert" data-testid={`file-upload-error-${testIdPrefix}`}><span>{error}</span>{!readOnly&&retryFiles.current.length>0&&<button type="button" className="wf-node-file-add" data-testid={`retry-upload-${testIdPrefix}`} disabled={disabled||busy||!onUploadFiles} onClick={()=>void upload(retryFiles.current)}><Icon name="retry" size={12}/>{t('retryUpload')}</button>}</div>}
  </div>;
}
