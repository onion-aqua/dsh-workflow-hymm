import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons.tsx';
import type { IconName } from './icons.tsx';

export interface ContextAction {id:string;label:string;icon:IconName;disabled?:boolean;title?:string;danger?:boolean;separatorBefore?:boolean;onSelect:()=>void}
export interface ContextMenuProps {container:HTMLElement;x:number;y:number;actions:readonly ContextAction[];caption?:string;onClose:()=>void}

/** The menu lives above React Flow's transformed nodes, with a position bounded by the canvas. */
export function ContextMenu({container,x,y,actions,caption,onClose}:ContextMenuProps){
  const ref=useRef<HTMLDivElement>(null);const [position,setPosition]=useState({x,y});
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useLayoutEffect(()=>{
    const menu=ref.current;if(!menu)return;
    const bounds=container.getBoundingClientRect();const size=menu.getBoundingClientRect();
    setPosition({x:Math.max(8,Math.min(x,bounds.width-size.width-8)),y:Math.max(8,Math.min(y,bounds.height-size.height-8))});
  },[container,x,y,actions.length,caption]);
  useEffect(()=>{
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Element))closeRef.current();};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();event.stopPropagation();closeRef.current();}};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);};
  },[container,x,y]);
  return createPortal(<div ref={ref} className="wf-context-menu nodrag nopan nowheel" data-testid="workflow-context-menu" role="menu" style={{left:position.x,top:position.y,maxHeight:Math.max(40,container.getBoundingClientRect().height-16)}} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onContextMenu={event=>{event.preventDefault();event.stopPropagation();}} onKeyDown={event=>{
    if(event.nativeEvent.isComposing)return;
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();event.stopPropagation();const choices=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current=choices.indexOf(document.activeElement as HTMLButtonElement);const next=event.key==='Home'?0:event.key==='End'?choices.length-1:(current+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;choices[next]?.focus();
    }else if(event.key==='Tab'){event.preventDefault();onClose();}
  }}>{actions.map(action=><div key={action.id} className={action.separatorBefore?'has-separator':undefined}><button type="button" role="menuitem" data-testid={`context-${action.id}`} disabled={action.disabled} title={action.title} className={action.danger?'is-danger':undefined} onClick={()=>{action.onSelect();onClose();}}><Icon name={action.icon} size={16}/><span>{action.label}</span></button></div>)}{caption&&<p className="wf-context-caption">{caption}</p>}</div>,container);
}
