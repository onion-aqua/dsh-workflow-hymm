import { BaseEdge, Position } from '@xyflow/react';
import type { ConnectionLineComponentProps, EdgeProps, EdgeTypes, Handle } from '@xyflow/react';
import { normalizePreview, workflowCurve } from './curve-path.ts';
/** Public preview coordinates are handle centers in flow space; final edges use their outer side. */
export function previewEndpoint(handle:Handle|undefined|null,x:number,y:number):{x:number;y:number}{
  if(!handle)return {x,y};
  if(handle.position===Position.Right)return {x:x+handle.width/2,y};
  if(handle.position===Position.Left)return {x:x-handle.width/2,y};
  if(handle.position===Position.Top)return {x,y:y-handle.height/2};
  return {x,y:y+handle.height/2};
}

export function WorkflowEdge(props:EdgeProps){
  const {path,labelX,labelY}=workflowCurve({...props,curvature:props.pathOptions?.curvature});
  return <BaseEdge id={props.id} path={path} labelX={labelX} labelY={labelY} style={props.style}
    markerStart={props.markerStart} markerEnd={props.markerEnd} interactionWidth={props.interactionWidth}
    label={props.label} labelStyle={props.labelStyle} labelShowBg={props.labelShowBg} labelBgStyle={props.labelBgStyle} labelBgPadding={props.labelBgPadding} labelBgBorderRadius={props.labelBgBorderRadius}/>;
}

export const workflowEdgeTypes:EdgeTypes={workflow:WorkflowEdge};

export function WorkflowConnectionLine(props:ConnectionLineComponentProps){
  const from=previewEndpoint(props.fromHandle,props.fromX,props.fromY);
  const to=previewEndpoint(props.toHandle,props.toX,props.toY);
  const input=normalizePreview({fromType:props.fromHandle.type,sourceX:from.x,sourceY:from.y,targetX:to.x,targetY:to.y,
    sourcePosition:props.fromPosition,targetPosition:props.toPosition});
  const {path}=workflowCurve(input);
  return <path className="react-flow__connection-path" data-testid="workflow-connection-path" d={path} fill="none" style={props.connectionLineStyle}/>;
}
