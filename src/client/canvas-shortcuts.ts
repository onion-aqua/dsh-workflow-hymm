import type { CanvasCommand } from './WorkflowPanel.tsx';

export type CanvasShortcut=CanvasCommand|'selectAll'|'rename'|'group'|'ungroup'|'fitAll'|'fitSelected'|'help';
export function canvasShortcut(event:Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'altKey'|'shiftKey'|'isComposing'>):CanvasShortcut|undefined{
  if(event.isComposing||event.altKey)return;
  const key=event.key.toLowerCase();
  if(event.ctrlKey||event.metaKey){
    if(key==='z')return event.shiftKey?'redo':'undo';
    if(key==='g')return event.shiftKey?'ungroup':'group';
    if(key==='h'&&event.shiftKey)return 'restore';
    if(key==='y'&&!event.shiftKey)return 'redo';
    if(event.shiftKey)return;
    return ({a:'selectAll',d:'duplicate',c:'copy',x:'cut',v:'paste'} as const)[key as 'a'|'d'|'c'|'x'|'v'];
  }
  if(key==='delete'||key==='backspace')return 'delete';
  if(key==='f2'&&!event.shiftKey)return 'rename';
  if(key==='f')return event.shiftKey?'fitSelected':'fitAll';
  if(key==='?'||key==='/'&&event.shiftKey)return 'help';
}
