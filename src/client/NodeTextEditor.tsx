import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Icon } from './icons.tsx';
import { safeMarkdownHref } from './MarkdownContent.tsx';
import { createRichTextExtensions } from './rich-text.ts';
import type { Translate } from './locales.ts';
import './node-text-editor.css';

export interface NodeTextEditorProps {
  title:string;instruction:string;readOnly?:boolean;saving?:boolean;error?:string;
  onSave:(instruction:string)=>void|Promise<void>;onClose:()=>void;t:Translate;
}
type Format='bold'|'italic'|'heading'|'bullet'|'code'|'link';

/** A private visual draft; only Markdown is passed back through the existing node API. */
export function NodeTextEditor({title,instruction,readOnly=false,saving=false,error,onSave,onClose,t}:NodeTextEditorProps){
  const [draft,setDraft]=useState(()=>instruction);const draftRef=useRef(instruction);
  const [mode,setMode]=useState<'visual'|'source'>('visual');
  const [maximized,setMaximized]=useState(false);const [fontSize,setFontSize]=useState(14);
  const [pending,setPending]=useState(false);const [localError,setLocalError]=useState('');
  const [linkOpen,setLinkOpen]=useState(false);const [linkUrl,setLinkUrl]=useState('https://');
  const [,refresh]=useState(0);const sourceHistory=useRef({values:[instruction],index:0});
  const baseline=useRef({source:instruction,json:''});
  const dialogRef=useRef<HTMLDivElement>(null);const sourceRef=useRef<HTMLTextAreaElement>(null);
  const linkRef=useRef<HTMLInputElement>(null);const linkSelection=useRef({from:1,to:1});
  const composing=useRef(false);const saveLatch=useRef(false);const titleId=useId();const contextId=useId();
  const busy=saving||pending;const blocked=readOnly||busy;
  const blockedRef=useRef(blocked);blockedRef.current=blocked;
  const reportLimit=useRef(()=>{});reportLimit.current=()=>setLocalError(t('editorTooLong'));
  const extensions=useMemo(()=>createRichTextExtensions(()=>reportLimit.current(),()=>blockedRef.current),[]);
  const editor=useEditor({
    extensions,content:baseline.current.source,contentType:'markdown',immediatelyRender:true,
    shouldRerenderOnTransaction:false,
    editorProps:{
      attributes:{class:'wf-rich-editor wf-markdown-content','data-testid':'editor-text',role:'textbox','aria-multiline':'true','aria-label':t('taskInstruction'),tabindex:'0',spellcheck:'false'},
      // Import pasted text through the same safe Markdown parser as source mode.
      handlePaste(view,event){
        if(!event.clipboardData)return false;
        const text=event.clipboardData.getData('text/plain');
        if(!text&&!event.clipboardData.types.includes('text/plain'))return false;
        event.preventDefault();
        const json=editor?.markdown?.parse(text);
        if(json)editor?.commands.insertContent(json.content??[]);else view.dispatch(view.state.tr.insertText(text));
        return true;
      },
    },
    onUpdate({editor:current}){
      const json=JSON.stringify(current.getJSON());
      const markdown=json===baseline.current.json?baseline.current.source:current.getMarkdown();
      draftRef.current=markdown;setDraft(markdown);setLocalError('');
    },
    onTransaction(){refresh(value=>value+1);},
  });
  if(editor&&!baseline.current.json)baseline.current.json=JSON.stringify(editor.getJSON());
  useEffect(()=>{editor?.setEditable(!blocked,false);},[editor,blocked]);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;editor?.commands.focus();return()=>{if(previous?.isConnected)previous.focus();};},[editor]);
  useEffect(()=>{if(mode==='source')sourceRef.current?.focus();else editor?.commands.focus();},[mode,editor]);
  useEffect(()=>{if(linkOpen){linkRef.current?.focus();linkRef.current?.select();}},[linkOpen]);

  const updateSource=(value:string)=>{
    if(blocked)return;if(value.length>20000){reportLimit.current();return;}
    const history=sourceHistory.current;const values=history.values.slice(0,history.index+1);
    if(values.at(-1)!==value)values.push(value);if(values.length>150)values.shift();
    sourceHistory.current={values,index:values.length-1};draftRef.current=value;setDraft(value);setLocalError('');
  };
  const switchMode=(next:'visual'|'source')=>{
    if(next===mode)return;setLinkOpen(false);
    if(next==='source'){
      const value=draftRef.current;sourceHistory.current={values:[value],index:0};setDraft(value);
    }else if(editor){
      const value=draftRef.current;const parsed=editor.markdown!.parse(value);
      // A deliberate source spelling stays exact until the visual document changes.
      editor.commands.setContent(parsed,{emitUpdate:false});
      baseline.current={source:value,json:JSON.stringify(editor.getJSON())};
    }
    setMode(next);
  };
  const travel=(redo:boolean)=>{
    if(blocked)return;
    if(mode==='visual'){if(redo)editor?.chain().focus().redo().run();else editor?.chain().focus().undo().run();return;}
    const history=sourceHistory.current,index=history.index+(redo?1:-1);
    if(index<0||index>=history.values.length)return;
    history.index=index;const value=history.values[index]!;draftRef.current=value;setDraft(value);setLocalError('');sourceRef.current?.focus();
  };
  const openLink=()=>{
    if(blocked||mode==='source'||!editor)return;
    linkSelection.current={from:editor.state.selection.from,to:editor.state.selection.to};
    setLinkUrl(String(editor.getAttributes('link').href??'https://'));setLinkOpen(value=>!value);
  };
  const format=(kind:Format)=>{
    if(blocked||mode==='source'||!editor)return;
    switch(kind){
      case 'bold':editor.chain().focus().toggleBold().run();break;
      case 'italic':editor.chain().focus().toggleItalic().run();break;
      case 'heading':editor.chain().focus().toggleHeading({level:2}).run();break;
      case 'bullet':editor.chain().focus().toggleBulletList().run();break;
      case 'code':if(editor.state.doc.textBetween(editor.state.selection.from,editor.state.selection.to,'\n').includes('\n'))editor.chain().focus().toggleCodeBlock().run();else editor.chain().focus().toggleCode().run();break;
      case 'link':openLink();break;
    }
  };
  const applyLink=(remove=false)=>{
    if(blocked||!editor)return;const href=safeMarkdownHref(linkUrl);
    if(!remove&&!href){setLocalError(t('editorUnsafeLink'));return;}
    const chain=editor.chain().focus().setTextSelection(linkSelection.current).extendMarkRange('link');
    if(remove)chain.unsetLink().run();
    else if(linkSelection.current.from===linkSelection.current.to&&!editor.isActive('link'))chain.insertContent({type:'text',text:href!,marks:[{type:'link',attrs:{href}}]}).run();
    else chain.setLink({href:href!}).run();
    setLinkOpen(false);setLocalError('');
  };
  const save=async()=>{
    if(blocked||saveLatch.current)return;
    const value=draftRef.current;if(value.length>20000){reportLimit.current();return;}
    saveLatch.current=true;setPending(true);setLocalError('');
    try{await onSave(value);}catch(cause){setLocalError(cause instanceof Error?cause.message:t('saveError'));}
    finally{saveLatch.current=false;setPending(false);}
  };
  const onKeyDown=(event:KeyboardEvent<HTMLDivElement>)=>{
    event.stopPropagation();if(event.nativeEvent.isComposing||composing.current||event.keyCode===229)return;
    if(event.key==='Escape'){event.preventDefault();if(linkOpen){setLinkOpen(false);editor?.commands.focus();}else if(!busy)onClose();return;}
    if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void save();return;}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&mode==='visual'&&!linkOpen){event.preventDefault();openLink();return;}
    // ProseMirror owns visual editor undo/redo and formatting shortcuts.
    if(mode==='source'&&(event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();travel(event.key.toLowerCase()==='y'||event.shiftKey);return;}
    if(event.key==='Tab'){
      const controls=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button,textarea,input,select,[contenteditable="true"],[tabindex="0"]')??[]).filter(element=>!element.matches(':disabled')&&!element.closest('[hidden]')&&element.getAttribute('aria-hidden')!=='true');
      const first=controls[0],last=controls.at(-1);if(!first)return;
      if(event.shiftKey&&(document.activeElement===first||!dialogRef.current?.contains(document.activeElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!dialogRef.current?.contains(document.activeElement))){event.preventDefault();first.focus();}
    }
  };
  const onKeyDownCapture=(event:KeyboardEvent<HTMLDivElement>)=>{
    if(event.nativeEvent.isComposing||composing.current||event.keyCode===229)return;
    // Handle modal shortcuts before ProseMirror's Ctrl+Enter hard-break binding.
    if(event.key==='Escape'||((event.ctrlKey||event.metaKey)&&(event.key==='Enter'||(event.key.toLowerCase()==='k'&&mode==='visual'))))onKeyDown(event);
  };
  const formats:[Format,'bold'|'italic'|'heading'|'list'|'code'|'link','editorBold'|'editorItalic'|'editorHeading'|'editorList'|'editorCode'|'editorLink'][]=[['bold','bold','editorBold'],['italic','italic','editorItalic'],['heading','heading','editorHeading'],['bullet','list','editorList'],['code','code','editorCode'],['link','link','editorLink']];
  const active=(kind:Format)=>mode==='visual'&&!!editor?.isActive(kind==='bullet'?'bulletList':kind==='heading'?'heading':kind==='code'&&editor.isActive('codeBlock')?'codeBlock':kind);
  const canUndo=mode==='source'?sourceHistory.current.index>0:!!editor?.can().undo();
  const canRedo=mode==='source'?sourceHistory.current.index<sourceHistory.current.values.length-1:!!editor?.can().redo();
  return <div className="wf-text-editor-backdrop nodrag nopan nowheel" data-testid="node-text-editor" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()}>
    <div ref={dialogRef} className={`wf-text-editor ${maximized?'is-maximized':''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={contextId} onKeyDown={onKeyDown} onKeyDownCapture={onKeyDownCapture} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}>
      <header><div className="wf-text-editor-heading"><Icon name="edit" size={18}/><h2 id={titleId}>{t('editorTitle')}</h2>{readOnly&&<span className="wf-text-editor-readonly">{t('editorReadOnly')}</span>}</div><div className="wf-text-editor-window-actions"><button type="button" className="wf-icon-button" data-testid="editor-maximize" title={t(maximized?'editorRestore':'editorMaximize')} aria-label={t(maximized?'editorRestore':'editorMaximize')} aria-pressed={maximized} onClick={()=>setMaximized(!maximized)}><Icon name={maximized?'restore':'maximize'} size={17}/></button><button type="button" className="wf-icon-button" data-testid="editor-close" title={t('close')} aria-label={t('close')} disabled={busy} onClick={onClose}><Icon name="close" size={18}/></button></div></header>
      <div className="wf-text-editor-context" id={contextId}>{title}</div>
      <div className="wf-text-editor-toolbar" role="toolbar" aria-label={t('editorFormatting')}>
        <div>{formats.map(([kind,icon,label])=><button key={kind} type="button" className="wf-icon-button" data-testid={`editor-${kind}`} title={t(label)} aria-label={t(label)} aria-pressed={active(kind)} disabled={blocked||mode==='source'} onMouseDown={event=>event.preventDefault()} onClick={()=>format(kind)}><Icon name={icon} size={17}/></button>)}<i/><button type="button" className="wf-icon-button" data-testid="editor-undo" title={t('editorUndo')} aria-label={t('editorUndo')} disabled={blocked||!canUndo} onMouseDown={event=>event.preventDefault()} onClick={()=>travel(false)}><Icon name="undo" size={17}/></button><button type="button" className="wf-icon-button" data-testid="editor-redo" title={t('editorRedo')} aria-label={t('editorRedo')} disabled={blocked||!canRedo} onMouseDown={event=>event.preventDefault()} onClick={()=>travel(true)}><Icon name="redo" size={17}/></button></div>
        <div className="wf-text-editor-modes"><button type="button" data-testid="editor-mode-visual" aria-pressed={mode==='visual'} disabled={busy} onClick={()=>switchMode('visual')}>{t('editorVisual')}</button><button type="button" data-testid="editor-mode-source" aria-pressed={mode==='source'} disabled={busy} onClick={()=>switchMode('source')}>{t('editorSource')}</button></div>
        <div className="wf-text-editor-zoom"><button type="button" className="wf-icon-button" data-testid="editor-font-decrease" title={t('editorFontDecrease')} aria-label={t('editorFontDecrease')} disabled={fontSize<=11} onClick={()=>setFontSize(value=>Math.max(11,value-1))}>A−</button><span data-testid="editor-font-size">{fontSize}</span><button type="button" className="wf-icon-button" data-testid="editor-font-increase" title={t('editorFontIncrease')} aria-label={t('editorFontIncrease')} disabled={fontSize>=24} onClick={()=>setFontSize(value=>Math.min(24,value+1))}>A+</button></div>
      </div>
      {linkOpen&&<form className="wf-text-editor-link" onSubmit={event=>{event.preventDefault();applyLink();}}><label htmlFor={`${titleId}-url`}>{t('editorLinkUrl')}</label><input ref={linkRef} id={`${titleId}-url`} data-testid="editor-link-url" value={linkUrl} onChange={event=>setLinkUrl(event.target.value)} placeholder="https://"/><button type="submit" className="wf-button" data-testid="editor-link-apply">{t('editorApplyLink')}</button><button type="button" className="wf-button wf-button--quiet" data-testid="editor-link-remove" onClick={()=>applyLink(true)}>{t('editorRemoveLink')}</button></form>}
      <EditorContent editor={editor} className="wf-rich-editor-wrap" hidden={mode==='source'} style={{fontSize}}/>
      <textarea ref={sourceRef} hidden={mode==='visual'} className="wf-text-editor-input" data-testid="editor-source" aria-label={t('editorSource')} aria-readonly={readOnly} readOnly={blocked} value={draft} maxLength={20000} placeholder={t('instructionPlaceholder')} style={{fontSize}} spellCheck={false} onChange={event=>updateSource(event.target.value)}/>
      {(error||localError)&&<div className="wf-text-editor-error" role="alert" data-testid="editor-error">{error||localError}</div>}
      <footer><div className="wf-text-editor-footnote"><span>{t('editorCharacterCount',{count:draft.length})}</span><span>{t(readOnly?'editorReadOnlyHint':'editorSaveHint')}</span></div><div><button type="button" className="wf-button wf-button--quiet" data-testid="editor-cancel" disabled={busy} onClick={onClose}>{t(readOnly?'close':'cancel')}</button>{!readOnly&&<button type="button" className="wf-button wf-button--primary" data-testid="editor-save" disabled={busy||draft.length>20000} onClick={()=>void save()}>{t(busy?'saving':'editorSave')}</button>}</div></footer>
    </div>
  </div>;
}
