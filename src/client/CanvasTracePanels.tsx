import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useNodes, useReactFlow, useViewport } from '@xyflow/react';
import type { TaskFlowNode } from './TaskNode.tsx';
import type { ExecutionCard, TraceCard, WorkflowRuntimeProps } from './ui-contract.ts';
import type { Rectangle } from './graph.ts';
import { executionIsActive, executionVisibleInBranch, placeTracePanel } from './graph.ts';
import { TracePanel, visibleTraceSteps } from './TracePanel.tsx';
import { Icon } from './icons.tsx';
import type { Translate } from './locales.ts';

export type TracePins=Readonly<Record<string,{runId:string|null}>>;
interface Props {focusedNodeId:string|null;traceNodeId:string|null;size:{width:number;height:number};selectedRunId:string|null;runtime:WorkflowRuntimeProps;pins:TracePins;onOpen:()=>void;onClose:()=>void;onClosePin:(nodeId:string)=>void;onTogglePin:(nodeId:string,runId:string|null)=>void;onSelectRun:(runId:string)=>void;onSelectPinnedRun:(nodeId:string,runId:string)=>void;t:Translate}
interface TraceViewport {x:number;y:number;zoom:number}
interface TracePlacement {space:'screen'|'canvas';x:number;y:number;width:number;height:number;baseZoom:number}
/** The same mounted panel changes coordinate space without replacing its expanded rows. */
function MovableTrace({nodeId,position,size,pinned,viewport,children}:{nodeId:string;position:Rectangle;size:{width:number;height:number};pinned:boolean;viewport:TraceViewport;children:(start:(event:ReactPointerEvent<HTMLElement>)=>void)=>React.ReactNode}){
  const [placement,setPlacement]=useState<TracePlacement>(),[dragging,setDragging]=useState(false);
  const currentViewport=useRef(viewport);currentViewport.current=viewport;
  const element=useRef<HTMLDivElement>(null);
  const gesture=useRef<{space:'screen'|'canvas';origin:TracePlacement;x:number;y:number;offsetX:number;offsetY:number;canvasLeft:number;canvasTop:number;pointerId:number}|null>(null);
  const source=placement??{space:'screen' as const,...position,baseZoom:1};
  const scale=source.space==='canvas'?viewport.zoom/source.baseZoom:source.baseZoom;
  const screenX=source.space==='canvas'?source.x*viewport.zoom+viewport.x:source.x;
  const screenY=source.space==='canvas'?source.y*viewport.zoom+viewport.y:source.y;
  const left=source.space==='canvas'?screenX:Math.max(12,Math.min(screenX,Math.max(12,size.width-source.width*scale-12)));
  const top=source.space==='canvas'?screenY:Math.max(104,Math.min(screenY,Math.max(104,size.height-source.height*scale-12)));
  const maxHeight=source.space==='canvas'?source.height:Math.max(1,Math.min(source.height,(size.height-top-12)/scale));
  const rendered=useRef({left,top,scale,width:source.width,height:maxHeight});rendered.current={left,top,scale,width:source.width,height:maxHeight};
  useLayoutEffect(()=>{
    const target=pinned?'canvas':'screen';if(placement?.space===target||!pinned&&!placement)return;
    const current=rendered.current,vp=currentViewport.current;
    gesture.current=null;setDragging(false);
    setPlacement({space:target,x:pinned?(current.left-vp.x)/vp.zoom:current.left,y:pinned?(current.top-vp.y)/vp.zoom:current.top,
      width:current.width,height:current.height,baseZoom:pinned?vp.zoom/current.scale:current.scale});
  },[pinned]);
  const start=(event:ReactPointerEvent<HTMLElement>)=>{
    if(event.button!==0||(event.target as Element).closest('button,input,select,a'))return;
    event.preventDefault();event.stopPropagation();const vp=currentViewport.current,current=rendered.current;
    const canvas=element.current?.parentElement?.getBoundingClientRect();
    const origin:TracePlacement={...source,x:source.space==='canvas'?source.x:current.left,y:source.space==='canvas'?source.y:current.top,height:current.height};
    gesture.current={space:origin.space,origin,x:event.clientX,y:event.clientY,
      offsetX:(event.clientX-(canvas?.left??0)-vp.x)/vp.zoom-origin.x,offsetY:(event.clientY-(canvas?.top??0)-vp.y)/vp.zoom-origin.y,
      canvasLeft:canvas?.left??0,canvasTop:canvas?.top??0,pointerId:event.pointerId};setDragging(true);
  };
  useEffect(()=>{
    if(!dragging)return;
    const move=(event:PointerEvent)=>{
      const current=gesture.current;if(!current||event.pointerId!==current.pointerId)return;const vp=currentViewport.current;
      const x=current.space==='canvas'?(event.clientX-current.canvasLeft-vp.x)/vp.zoom-current.offsetX:current.origin.x+event.clientX-current.x;
      const y=current.space==='canvas'?(event.clientY-current.canvasTop-vp.y)/vp.zoom-current.offsetY:current.origin.y+event.clientY-current.y;
      setPlacement({...current.origin,x,y});
    };
    const finish=()=>{gesture.current=null;setDragging(false);};
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);
    return()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',finish);document.removeEventListener('pointercancel',finish);};
  },[dragging]);
  return <div ref={element} className={`wf-trace-position ${dragging?'is-dragging':''}`} data-testid={`trace-position-${nodeId}`} data-node-id={nodeId} data-coordinate-space={source.space}
    style={{left,top,width:source.width,maxHeight,transform:scale===1?undefined:`scale(${scale})`,transformOrigin:'0 0'}}>{children(start)}</div>;
}

/** Pinned execution panels keep their run identity when canvas focus changes. */
export function CanvasTracePanels({focusedNodeId,traceNodeId,size,selectedRunId,runtime,pins,onOpen,onClose,onClosePin,onTogglePin,onSelectRun,onSelectPinnedRun,t}:Props){
  const nodes=useNodes<TaskFlowNode>(),viewport=useViewport(),flow=useReactFlow<TaskFlowNode>();
  const executions=runtime.executions??[],branches=runtime.branches??[];
  const resultInputLabels=Object.fromEntries(executions.flatMap(run=>{const task=nodes.find(node=>node.id===run.nodeId)?.data.task;if(!task)return [];const revision=task.revision===run.nodeRevision?task:task.revisions?.find(item=>item.revision===run.nodeRevision);return [[run.runId,`${task.displayId?`#${task.displayId} · `:''}${revision?.title??task.title} · v${run.nodeRevision}`]];}));
  const rectangle=(node:TaskFlowNode):Rectangle=>{const handle=flow.getInternalNode(node.id)?.internals.handleBounds?.source?.[0];return {x:node.position.x*viewport.zoom+viewport.x,y:node.position.y*viewport.zoom+viewport.y,width:(node.measured?.width??node.width??300)*viewport.zoom,height:(node.measured?.height??node.height??210)*viewport.zoom,portY:handle?(node.position.y+handle.y+handle.height/2)*viewport.zoom+viewport.y:undefined};};
  const focused=nodes.find(node=>node.id===focusedNodeId&&!node.data.root&&node.data.task.kind!=='session');
  const panels=Object.entries(pins).flatMap(([nodeId,pin])=>{const node=nodes.find(node=>node.id===nodeId);return node?[{node,runId:pin.runId??executions.filter(run=>run.nodeId===nodeId).at(-1)?.runId??null,pinned:true}]:[];});
  if(focused&&traceNodeId===focused.id&&!pins[focused.id])panels.push({node:focused,runId:selectedRunId,pinned:false});
  const watch=panels.flatMap(panel=>panel.runId?[panel.runId]:[]).sort();const watchKey=JSON.stringify(watch);
  useEffect(()=>{runtime.onWatchTraceRuns?.(watch);return()=>runtime.onWatchTraceRuns?.([]);},[watchKey,runtime.onWatchTraceRuns]);
  const traceFor=(runId:string|null):TraceCard|undefined=>runId?runtime.traces?.[runId]??(runtime.trace?.runId===runId?runtime.trace:undefined):undefined;
  if(size.width<=0)return null;
  const focusedRuns=focused?executions.filter(run=>run.nodeId===focused.id&&executionVisibleInBranch(run,runtime.activeBranchId,branches,executions)):[];
  const focusedTrace=traceFor(selectedRunId);const active=focusedRuns.find(run=>run.runId===selectedRunId)??focusedRuns.findLast(executionIsActive)??focusedRuns.at(-1);
  const anchor=focused?rectangle(focused):undefined;
  const entry=anchor?{left:Math.max(12,Math.min(anchor.x,size.width-244)),top:Math.max(74,Math.min(anchor.y+anchor.height+(focused!.data.collapsed?12:Math.max(12,40*viewport.zoom+8)),size.height-48))}:undefined;
  const placed:Rectangle[]=[];
  return <div className="wf-canvas-overlays">
    {focused&&entry&&<button className={`wf-trace-entry ${traceNodeId===focused.id?'is-open':''}`} aria-label={t('traceTitle')} data-testid="trace-entry" style={{left:entry.left,top:entry.top,maxWidth:Math.min(232,size.width-24)}} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();onOpen();}}><Icon name="trace" size={14}/><span>{t('traceCompactTitle')}</span><b>{focusedTrace?t('traceActionCount',{count:visibleTraceSteps(focusedTrace.steps).length}):t('traceExecutionCount',{count:focusedRuns.length})}</b>{active&&<i className={`wf-run-dot is-${active.status}`}/>}<Icon name="chevron" size={12}/></button>}
    {panels.map(({node,runId,pinned})=>{
      const runs=executions.filter(run=>run.nodeId===node.id&&(pinned||executionVisibleInBranch(run,runtime.activeBranchId,branches,executions))),selected=runs.find(run=>run.runId===runId),trace=traceFor(runId);
      const position=placeTracePanel(rectangle(node),size,[...nodes.map(rectangle),...placed]);placed.push(position);
      return <MovableTrace key={node.id} nodeId={node.id} position={position} size={size} pinned={pinned} viewport={viewport}>{start=><><button type="button" className={`wf-trace-pin nodrag nopan ${pinned?'is-pinned':''}`} data-testid={`trace-pin-${node.id}`} aria-label={t(pinned?'traceUnpin':'tracePin')} title={t(pinned?'traceUnpin':'tracePin')} aria-pressed={pinned} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();onTogglePin(node.id,runId);}}><Icon name="pin" size={13}/></button><TracePanel nodeTitle={`${node.data.task.displayId?`#${node.data.task.displayId} · `:''}${node.data.task.title}`} runId={runId??undefined} status={trace?.status??selected?.status} loading={trace?.loading??(Boolean(runId)&&!trace)} error={trace?.error} steps={trace?.steps} detailsLoadingStepIds={trace?.detailsLoadingStepIds} executions={runs} resultInputLabels={resultInputLabels} onHeaderPointerDown={start} pinned={pinned} onSelectExecution={value=>pinned?onSelectPinnedRun(node.id,value):onSelectRun(value)} onReadStep={runId?stepId=>runtime.onReadStep?.(runId,stepId):undefined} onOpenSession={runtime.onOpenSession} onClose={()=>pinned?onClosePin(node.id):onClose()} t={t}/></>}</MovableTrace>;
    })}
  </div>;
}
