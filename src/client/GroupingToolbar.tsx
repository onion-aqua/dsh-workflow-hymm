import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { WorkflowGroup } from '../shared/model.ts';
import type { GeometryNode, Rectangle, SelectionLayout } from './graph.ts';
import { nodeSelectionBounds } from './graph.ts';
import { Icon } from './icons.tsx';
import type { Translate } from './locales.ts';
import './grouping.css';

export function GroupingToolbar({count,group,disabled,canGroup,bounds,viewport,size,onGroup,onUngroup,onLayout,t}:{
  count:number;group?:WorkflowGroup;disabled:boolean;canGroup:boolean;bounds:Rectangle;
  viewport:{x:number;y:number;zoom:number};size:{width:number;height:number};
  onGroup:()=>void;onUngroup:()=>void;onLayout:(layout:SelectionLayout)=>void;t:Translate;
}){
  const [open,setOpen]=useState(false);const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{setOpen(false);},[group?.id,count]);
  useEffect(()=>{if(!open)return;const close=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',close,true);return()=>document.removeEventListener('pointerdown',close,true);},[open]);
  const width=230;const left=Math.max(84,Math.min(bounds.x*viewport.zoom+viewport.x+(bounds.width*viewport.zoom-width)/2,Math.max(84,size.width-width-16)));
  const top=Math.max(88,Math.min(bounds.y*viewport.zoom+viewport.y-82,Math.max(88,size.height-60)));
  return <div ref={ref} className="wf-grouping-toolbar nodrag nopan" data-testid="grouping-toolbar" style={{left,top}} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onContextMenu={event=>{event.preventDefault();event.stopPropagation();}}>
    <span className="wf-grouping-count" title={t('selectionCount',{count})}>{count}</span>
    {group?<button type="button" disabled={disabled} data-testid="ungroup-selection" onClick={onUngroup}><Icon name="ungroup" size={15}/>{t('ungroup')}</button>:<button type="button" disabled={disabled||!canGroup||count<2} data-testid="group-selection" onClick={onGroup}><Icon name="group" size={15}/>{t('groupSelection')}</button>}
    <span className="wf-grouping-divider"/>
    <button type="button" disabled={disabled||count<2} data-testid="selection-layout-menu" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><Icon name="grid" size={15}/>{t('selectionLayout')}<Icon name="collapse" size={11}/></button>
    {open&&<div className={`wf-selection-layout-menu ${top+200>size.height?'opens-above':''}`} role="menu" aria-label={t('selectionLayout')}>
      {(['grid','horizontal','vertical'] as const).map(layout=><button type="button" role="menuitem" key={layout} data-testid={`selection-layout-${layout}`} disabled={disabled} onClick={()=>{onLayout(layout);setOpen(false);}}><span className={`wf-layout-preview is-${layout}`} aria-hidden="true"><i/><i/><i/><i/></span><span>{t(layout==='grid'?'layoutGrid':layout==='horizontal'?'layoutHorizontal':'layoutVertical')}</span></button>)}
    </div>}
  </div>;
}

function GroupFrame({group,bounds,selected,busy,zoom,nodeBottomOverflow=0,renameRequested,onRenameHandled,onSelect,onRename,onUngroup,onContextMenu,onDragStart,onDragMove,onDragEnd,t}:{
  group:WorkflowGroup;bounds:Rectangle;selected:boolean;busy:boolean;zoom:number;nodeBottomOverflow?:number;
  renameRequested?:boolean;onRenameHandled?:()=>void;
  onSelect:(group:WorkflowGroup)=>boolean;onRename:(id:string,title:string)=>void;onUngroup:(id:string)=>void;
  onContextMenu?:(group:WorkflowGroup,point:{clientX:number;clientY:number})=>void;
  onDragStart:(group:WorkflowGroup)=>boolean;onDragMove:(delta:{x:number;y:number})=>void;onDragEnd:(cancelled:boolean)=>void;t:Translate;
}){
  const [editing,setEditing]=useState(false);const [title,setTitle]=useState(group.title);const input=useRef<HTMLInputElement>(null);const cancelRename=useRef(false);
  const gesture=useRef<{pointerId:number;x:number;y:number;moved:boolean;element:HTMLDivElement;delta:{x:number;y:number};frame?:number;cleanup:()=>void}|null>(null);
  useEffect(()=>{if(editing){input.current?.focus();input.current?.select();}},[editing]);
  useEffect(()=>{if(renameRequested&&!busy){cancelRename.current=false;setTitle(group.title);setEditing(true);onRenameHandled?.();}},[renameRequested,busy,group.title,onRenameHandled]);
  useEffect(()=>()=>{const current=gesture.current;if(current){current.cleanup();gesture.current=null;onDragEnd(true);}},[]);
  const begin=(event:ReactPointerEvent<HTMLDivElement>)=>{
    if(event.button!==0||(event.target as HTMLElement).closest('button,input'))return;
    event.stopPropagation();if(!onSelect(group)||busy||!onDragStart(group))return;
    const element=event.currentTarget;
    const move=(pointer:PointerEvent)=>{const current=gesture.current;if(!current||current.pointerId!==pointer.pointerId)return;const dx=pointer.clientX-current.x,dy=pointer.clientY-current.y;if(!current.moved&&Math.hypot(dx,dy)<4)return;if(!current.moved){current.moved=true;current.element.setPointerCapture(current.pointerId);}pointer.preventDefault();current.delta={x:dx/zoom,y:dy/zoom};if(current.frame===undefined)current.frame=requestAnimationFrame(()=>{if(gesture.current!==current)return;current.frame=undefined;onDragMove(current.delta);});};
    const end=(pointer:PointerEvent)=>{const current=gesture.current;if(!current||current.pointerId!==pointer.pointerId)return;current.cleanup();if(current.moved&&pointer.type!=='pointercancel')onDragMove(current.delta);gesture.current=null;if(current.element.hasPointerCapture(current.pointerId))current.element.releasePointerCapture(current.pointerId);onDragEnd(pointer.type==='pointercancel'||!current.moved);};
    const cleanup=()=>{const current=gesture.current;if(current?.frame!==undefined)cancelAnimationFrame(current.frame);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',end);};
    gesture.current={pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false,element,delta:{x:0,y:0},cleanup};document.addEventListener('pointermove',move,{passive:false});document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);
  };
  const finishRename=()=>{if(!cancelRename.current&&title.trim()&&title.trim()!==group.title)onRename(group.id,title.trim());setEditing(false);cancelRename.current=false;};
  return <div className={`wf-node-group ${selected?'is-selected':''}`} data-testid={`node-group-${group.id}`} data-group-id={group.id} style={{left:bounds.x-24,top:bounds.y-48,width:bounds.width+48,height:bounds.height+72+nodeBottomOverflow}} onPointerDown={begin} onContextMenu={event=>{if((event.target as Element).closest('input'))return;event.preventDefault();event.stopPropagation();onContextMenu?.(group,event);}} onLostPointerCapture={event=>{const current=gesture.current;if(current?.pointerId===event.pointerId){current.cleanup();gesture.current=null;onDragEnd(true);}}}>
    <span className="wf-group-border is-top"/><span className="wf-group-border is-right"/><span className="wf-group-border is-bottom"/><span className="wf-group-border is-left"/>
    <div className="wf-group-heading"><Icon name="group" size={14}/>{editing?<input ref={input} className="nodrag nopan" data-testid={`group-name-input-${group.id}`} aria-label={t('groupName')} maxLength={128} value={title} onChange={event=>setTitle(event.target.value)} onPointerDown={event=>event.stopPropagation()} onBlur={finishRename} onKeyDown={event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}else if(event.key==='Escape'){event.preventDefault();cancelRename.current=true;setEditing(false);}}}/>:<span role="button" tabIndex={0} data-testid={`group-title-${group.id}`} title={t('renameGroupHint')} onDoubleClick={event=>{event.preventDefault();event.stopPropagation();if(!busy){cancelRename.current=false;setTitle(group.title);setEditing(true);}}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();onSelect(group);}else if(event.key==='F2'&&!busy){event.preventDefault();event.stopPropagation();setTitle(group.title);setEditing(true);}}}>{group.title}</span>}<small>{group.nodeIds.length}</small><button type="button" className="wf-icon-button" data-testid={`ungroup-${group.id}`} aria-label={t('ungroup')} title={t('ungroup')} disabled={busy} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();onUngroup(group.id);}}><Icon name="ungroup" size={13}/></button></div>
  </div>;
}

export function CanvasGroups({groups,nodes,nodeBottomOverflow=0,selectedNodeIds,busy,viewport,renameGroupId,onRenameGroupHandled,onSelect,onRename,onUngroup,onContextMenu,onDragStart,onDragMove,onDragEnd,t}:{
  groups:readonly WorkflowGroup[];nodes:readonly GeometryNode[];nodeBottomOverflow?:number;selectedNodeIds:ReadonlySet<string>;busy:boolean;
  renameGroupId?:string|null;onRenameGroupHandled?:()=>void;
  viewport:{x:number;y:number;zoom:number};onSelect:(group:WorkflowGroup)=>boolean;
  onContextMenu?:(group:WorkflowGroup,point:{clientX:number;clientY:number})=>void;
  onRename:(id:string,title:string)=>void;onUngroup:(id:string)=>void;onDragStart:(group:WorkflowGroup)=>boolean;
  onDragMove:(delta:{x:number;y:number})=>void;onDragEnd:(cancelled:boolean)=>void;t:Translate;
}){
  return <div className="wf-group-layer" aria-label={t('nodeGroups')} style={{transform:`translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})`}}>
    {groups.map(group=>{const bounds=nodeSelectionBounds(nodes,new Set(group.nodeIds));return bounds?<GroupFrame key={group.id} nodeBottomOverflow={nodeBottomOverflow} group={group} bounds={bounds} selected={group.nodeIds.every(id=>selectedNodeIds.has(id))} busy={busy} zoom={viewport.zoom} renameRequested={renameGroupId===group.id} onRenameHandled={onRenameGroupHandled} onSelect={onSelect} onRename={onRename} onUngroup={onUngroup} onContextMenu={onContextMenu} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} t={t}/>:null;})}
  </div>;
}
