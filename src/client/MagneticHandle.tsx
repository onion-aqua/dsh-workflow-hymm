import { useEffect, useRef } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { Handle, Position, useConnection, useStore, useStoreApi } from '@xyflow/react';
import type { Viewport } from '@xyflow/react';
import type { MenuPoint } from './TaskNode.tsx';

const clearPort=(port:HTMLElement|null)=>{
  port?.classList.remove('is-magnetic');
  port?.style.removeProperty('--wf-port-x');port?.style.removeProperty('--wf-port-y');
};
const SENSE_RADIUS=32;
const ACTIVE_HIT_RADIUS=22;

/** Keep the established port core usable while nearby edges and controls win
 * over the newly enlarged area. Pseudo elements otherwise hide their targets. */
function coveredAction(port:HTMLElement,x:number,y:number):boolean{
  const rect=port.getBoundingClientRect(),dx=x-rect.left-rect.width/2,dy=y-rect.top-rect.height/2;
  if(Math.abs(dx)<=rect.width/2&&Math.abs(dy)<=rect.height/2)return false;
  const zoom=parseFloat(port.style.getPropertyValue('--wf-port-zoom'))||1;
  const radiusY=Math.max(.5,parseFloat(port.style.getPropertyValue('--wf-port-hit-height'))*zoom/2);
  const inside=port.classList.contains('source')?dx>=-8:dx<=8;
  if(inside&&Math.hypot(dx/12,dy/radiusY)<=1)return false;
  for(const hit of port.ownerDocument.elementsFromPoint(x,y)){
    if(hit===port||port.contains(hit))continue;
    return Boolean(hit.closest('button,input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"],[role="listbox"],.wf-task-top,.react-flow__edge'));
  }
  return false;
}

/** One frame-limited canvas listener senses proximity without blocking nearby edges. */
export function useMagneticPorts(canvas:RefObject<HTMLDivElement|null>,viewport:Viewport){
  const origin=useConnection(connection=>connection.inProgress?`${connection.fromNode.id}:${connection.fromHandle.type}`:null);
  const store=useStoreApi();
  const active=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const root=canvas.current;if(!root)return;
    let frame:number|null=null,pointer:{x:number;y:number}|null=null,frozen=false,releaseFrame:number|null=null;
    const clear=()=>{if(frame!==null){cancelAnimationFrame(frame);frame=null;}clearPort(active.current);active.current=null;};
    const paint=()=>{
      frame=null;if(!pointer||frozen)return;
      const state=store.getState(),bounds=state.domNode?.getBoundingClientRect()??root.getBoundingClientRect();
      const flowPoint={x:(pointer.x-bounds.left-viewport.x)/viewport.zoom,y:(pointer.y-bounds.top-viewport.y)/viewport.zoom};
      let closest:HTMLElement|null=null,distance=SENSE_RADIUS,x=0,y=0;
      // Use node bounds for a coarse lookup. Handle bounds may trail a collapse
      // by a frame, so measure the few nearby ports at their rendered positions.
      for(const node of state.nodeLookup.values()){
        if(node.hidden||node.data.root)continue;
        const at=node.internals.positionAbsolute,radius=SENSE_RADIUS/viewport.zoom+12;
        if(flowPoint.x<at.x-radius||flowPoint.x>at.x+(node.measured.width??node.width??300)+radius||flowPoint.y<at.y-radius||flowPoint.y>at.y+(node.measured.height??node.height??210)+radius)continue;
        for(const type of ['source','target']){
          if(origin&&(origin.startsWith(`${node.id}:`)||origin.endsWith(`:${type}`)))continue;
          const port=root.querySelector<HTMLElement>(`[data-testid="${type}-handle-${node.id}"][data-magnetic-enabled="true"]`);if(!port)continue;
          const rect=port.getBoundingClientRect(),px=pointer.x-rect.left-rect.width/2,py=pointer.y-rect.top-rect.height/2,d=Math.hypot(px,py);
          if(d>=distance)continue;
          // A covered port must not steal attraction from a visible neighbor.
          const hit=port.ownerDocument.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
          if(!hit||hit!==port&&!port.contains(hit))continue;
          if(coveredAction(port,pointer.x,pointer.y))continue;
          closest=port;distance=d;x=px;y=py;
        }
      }
      if(active.current!==closest){clearPort(active.current);active.current=closest;}
      if(!closest)return;
      const pull=Math.min(1,8/Math.max(1,distance))*Math.min(1,(SENSE_RADIUS-distance)/8);
      let dx=x*pull,dy=y*pull;
      const coverage=Math.hypot(dx/ACTIVE_HIT_RADIUS,dy/ACTIVE_HIT_RADIUS);
      if(coverage>.8){dx*=.8/coverage;dy*=.8/coverage;}
      if(closest.classList.contains('source'))dx=Math.max(-7,dx);else dx=Math.min(7,dx);
      closest.style.setProperty('--wf-port-x',`${dx/viewport.zoom}px`);
      closest.style.setProperty('--wf-port-y',`${dy/viewport.zoom}px`);
      closest.classList.add('is-magnetic');
    };
    const move=(event:PointerEvent)=>{
      if(frozen)return;
      if(event.pointerType!=='mouse'||event.buttons!==0&&!origin){clear();return;}
      const target=event.target as Element;
      if(target.closest('button,input,textarea,select,[role="dialog"],[role="menu"],[role="listbox"],.wf-node-model-bubble')){clear();return;}
      // Clear synchronously before a possible click: waiting for the next frame
      // would let the enlarged pseudo element swallow an underlying short edge.
      if(active.current&&coveredAction(active.current,event.clientX,event.clientY)){clear();return;}
      pointer={x:event.clientX,y:event.clientY};if(frame===null)frame=requestAnimationFrame(paint);
    };
    const down=()=>{if(frame!==null){cancelAnimationFrame(frame);frame=null;}frozen=true;};
    // The native Handle starts from mousedown after pointerdown. Preserve its
    // expanded hit region through the compatibility mouse events, then clear.
    const release=()=>{if(releaseFrame!==null)cancelAnimationFrame(releaseFrame);releaseFrame=requestAnimationFrame(()=>{releaseFrame=null;frozen=false;clear();});};
    clear();
    root.addEventListener('pointermove',move);root.addEventListener('pointerleave',clear);root.addEventListener('pointerdown',down,true);root.addEventListener('pointercancel',release);root.ownerDocument.addEventListener('pointerup',release);
    return ()=>{clear();if(releaseFrame!==null)cancelAnimationFrame(releaseFrame);root.removeEventListener('pointermove',move);root.removeEventListener('pointerleave',clear);root.removeEventListener('pointerdown',down,true);root.removeEventListener('pointercancel',release);root.ownerDocument.removeEventListener('pointerup',release);};
  },[canvas,viewport.x,viewport.y,viewport.zoom,origin,store]);
}

/** Native geometry stays fixed; only the nearest unobstructed port expands. */
export function MagneticHandle({nodeId,type,label,enabled=true,bodyHeight=181,onMenu}:{
  nodeId:string;type:'source'|'target';label:string;enabled?:boolean;bodyHeight?:number;
  onMenu?:(id:string,direction:'input'|'output',point:MenuPoint)=>void;
}){
  const element=useRef<HTMLDivElement>(null),zoom=useStore(state=>state.transform[2]);
  useEffect(()=>{clearPort(element.current);},[enabled,bodyHeight,zoom]);
  return <Handle ref={element} type={type} position={type==='source'?Position.Right:Position.Left}
    className="wf-magnetic-port" data-testid={`${type}-handle-${nodeId}`} aria-label={label}
    data-magnetic-enabled={enabled} isConnectable={enabled}
    style={{'--wf-port-zoom':zoom,'--wf-port-hit-height':`${Math.min(24/zoom,Math.max(9,bodyHeight))}px`} as CSSProperties}
    onContextMenu={event=>{event.preventDefault();event.stopPropagation();clearPort(element.current);onMenu?.(nodeId,type==='source'?'output':'input',event);}}>
    <span className="wf-magnetic-port-dot" aria-hidden="true"/>
  </Handle>;
}
