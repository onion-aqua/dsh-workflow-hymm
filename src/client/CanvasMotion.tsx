import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useNodes, useViewport } from '@xyflow/react';
import type { TaskFlowNode } from './TaskNode.tsx';

export function useReducedMotion():boolean{
  const [reduced,setReduced]=useState(()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{if(typeof matchMedia!=='function')return;const query=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(query.matches);query.addEventListener?.('change',change);return()=>query.removeEventListener?.('change',change);},[]);return reduced;
}
/** Exit animation never holds back graph changes or retains an interactive card. */
export function SheetPresence({show,children}:{show:boolean;children:ReactNode}){
  const reduced=useReducedMotion();const [mounted,setMounted]=useState(show);
  useEffect(()=>{if(show){setMounted(true);return;}if(reduced){setMounted(false);return;}const timer=setTimeout(()=>setMounted(false),150);return()=>clearTimeout(timer);},[show,reduced]);
  if(!show&&!mounted)return null;
  return <div className={`wf-sheet-presence ${show?'is-entering':'is-exiting'}`} aria-hidden={!show||undefined} {...(!show?{inert:''}:{})}>{children}</div>;
}
interface Ghost {id:string;title:string;x:number;y:number;width:number;height:number}
export function CanvasNodeEffects({resetKey}:{resetKey:string}){
  const nodes=useNodes<TaskFlowNode>(),viewport=useViewport(),reduced=useReducedMotion();
  const previous=useRef<{key:string;nodes:readonly TaskFlowNode[]}>({key:resetKey,nodes:[]});
  const [ghosts,setGhosts]=useState<Ghost[]>([]);const timers=useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(()=>{
    const before=previous.current;previous.current={key:resetKey,nodes};
    if(before.key!==resetKey){setGhosts([]);return;}
    if(reduced)return;
    const removed=before.nodes.filter(node=>!nodes.some(current=>current.id===node.id));
    if(!removed.length)return;
    const additions=removed.map(node=>({id:`${node.id}:${Date.now()}`,title:node.data.task.title,x:node.position.x*viewport.zoom+viewport.x,y:node.position.y*viewport.zoom+viewport.y,width:(node.measured?.width??node.width??300)*viewport.zoom,height:(node.measured?.height??node.height??210)*viewport.zoom}));
    setGhosts(current=>[...current,...additions]);timers.current.push(setTimeout(()=>setGhosts(current=>current.filter(ghost=>!additions.some(item=>item.id===ghost.id))),260));
  },[nodes,resetKey,reduced,viewport.x,viewport.y,viewport.zoom]);
  useEffect(()=>()=>timers.current.forEach(clearTimeout),[]);
  return <div className="wf-node-effects" aria-hidden="true">{ghosts.map(ghost=><div className="wf-node-ghost" data-testid="node-removal-effect" key={ghost.id} style={{left:ghost.x,top:ghost.y,width:ghost.width,height:ghost.height}}>{Array.from({length:6},(_,index)=><div className="wf-node-fragment" key={index} style={{'--fragment-x':`${(index%3-1)*18}px`,'--fragment-y':`${(Math.floor(index/3)-.5)*25}px`,'--fragment-rotation':`${(index%3-1)*5}deg`,clipPath:`inset(${Math.floor(index/3)*50}% ${100-(index%3+1)*100/3}% ${50-Math.floor(index/3)*50}% ${index%3*100/3}%)`} as CSSProperties}><span>{ghost.title}</span></div>)}</div>)}</div>;
}
