import { useEffect, useRef } from 'react';
import type { Translate, WorkflowKey } from './locales.ts';
import { Icon } from './icons.tsx';

export function CanvasShortcutsHelp({onClose,t}:{onClose:()=>void;t:Translate}){
  const close=useRef<HTMLButtonElement>(null);const panel=useRef<HTMLDivElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;close.current?.focus();return()=>{if(previous?.isConnected)previous.focus();};},[]);
  const mod=typeof navigator!=='undefined'&&/Mac|iPhone|iPad/.test(navigator.platform)?'⌘':'Ctrl';
  const rows:[string,WorkflowKey][]=[
    [`${mod}+A`,'shortcutSelectAll'],[`${mod}+D`,'shortcutDuplicate'],[`${mod}+C / X / V`,'shortcutClipboard'],['Delete / Backspace','shortcutRemove'],['F2','shortcutRename'],[`${mod}+Z`,'canvasUndo'],[`${mod}+Shift+Z / Y`,'canvasRedo'],[`${mod}+G`,'shortcutGroup'],[`${mod}+Shift+G`,'shortcutUngroup'],[`${mod}+Shift+H`,'restoreHidden'],['F / Shift+F','shortcutFit'],['Space + drag','shortcutPan'],['?','shortcutHelp'],
  ];
  return <div className="wf-shortcuts-backdrop nodrag nopan nowheel" data-testid="canvas-shortcuts-help" onPointerDown={event=>{event.stopPropagation();if(event.target===event.currentTarget)onClose();}} onClick={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.nativeEvent.isComposing)return;if(event.key==='Escape'){event.preventDefault();onClose();}else if(event.key==='Tab'){const controls=[...panel.current!.querySelectorAll<HTMLElement>('button,[href],[tabindex="0"]')];const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}}>
    <div ref={panel} className="wf-shortcuts-panel" role="dialog" aria-modal="true" aria-labelledby="wf-shortcuts-heading"><header><h2 id="wf-shortcuts-heading">{t('shortcutsTitle')}</h2><button ref={close} className="wf-icon-button" type="button" aria-label={t('close')} onClick={onClose}><Icon name="close" size={18}/></button></header><dl>{rows.map(([keys,label])=><div key={label}><dt>{t(label)}</dt><dd><kbd>{keys}</kbd></dd></div>)}</dl></div>
  </div>;
}

export function CanvasShortcutsHint({onOpen,t}:{onOpen:()=>void;t:Translate}){
  return <div className="wf-shortcuts-hint nodrag nopan nowheel" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
    <button type="button" data-testid="canvas-shortcuts-hover" aria-label={t('shortcutsTitle')} onClick={onOpen}><Icon name="keyboard" size={15}/><span>{t('shortcutsTitle')}</span></button>
    <div className="wf-shortcuts-hover-card" role="tooltip"><b>{t('shortcutsTitle')}</b><span><kbd>Space</kbd>{t('shortcutPan')}</span><span><kbd>Ctrl / ⌘ + A</kbd>{t('shortcutSelectAll')}</span><span><kbd>Delete</kbd>{t('shortcutRemove')}</span><span><kbd>F</kbd>{t('shortcutFit')}</span><span><kbd>?</kbd>{t('shortcutHelp')}</span></div>
  </div>;
}
