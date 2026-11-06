import { getBezierPath, Position } from '@xyflow/react';

export interface CurveBounds {x:number;y:number;width:number;height:number}
export interface CurveInput {
  sourceX:number;sourceY:number;targetX:number;targetY:number;
  sourcePosition?:Position;targetPosition?:Position;
  sourceBounds?:CurveBounds;targetBounds?:CurveBounds;curvature?:number;
}
export interface CurveResult {path:string;labelX:number;labelY:number;detour:boolean}

/** Keep every link direct. Cards cover the curve wherever it passes beneath them. */
export function workflowCurve(input:CurveInput):CurveResult {
  const [path,labelX,labelY]=getBezierPath(input);
  return {path,labelX,labelY,detour:false};
}

export interface PreviewInput extends CurveInput {fromType:'source'|'target'}
/** Starting a gesture from a target reverses its coordinates into the final source-to-target direction. */
export function normalizePreview(input:PreviewInput):CurveInput {
  if(input.fromType==='source')return input;
  return {sourceX:input.targetX,sourceY:input.targetY,targetX:input.sourceX,targetY:input.sourceY,
    sourcePosition:input.targetPosition,targetPosition:input.sourcePosition,
    sourceBounds:input.targetBounds,targetBounds:input.sourceBounds,curvature:input.curvature};
}
