import { describe, expect, it } from 'vitest';
import { getBezierPath, Position } from '@xyflow/react';
import type { Handle } from '@xyflow/react';
import { normalizePreview, workflowCurve } from '../src/client/curve-path.ts';
import { previewEndpoint } from '../src/client/WorkflowEdge.tsx';
import type { CurveBounds, CurveInput } from '../src/client/curve-path.ts';

interface Point {x:number;y:number}
function sampledPath(path:string):Point[]{
  const tokens=path.match(/[MCL]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!;let cursor=0;let current:Point={x:0,y:0};const points:Point[]=[];
  const point=()=>({x:Number(tokens[cursor++]),y:Number(tokens[cursor++])});
  while(cursor<tokens.length){const command=tokens[cursor++];
    if(command==='M'){current=point();points.push(current);}
    else if(command==='L'){const end=point();for(let index=1;index<=100;index++){const t=index/100;points.push({x:current.x+(end.x-current.x)*t,y:current.y+(end.y-current.y)*t});}current=end;}
    else if(command==='C'){const a=point(),b=point(),end=point();for(let index=1;index<=100;index++){const t=index/100,u=1-t;points.push({x:u*u*u*current.x+3*u*u*t*a.x+3*u*t*t*b.x+t*t*t*end.x,y:u*u*u*current.y+3*u*u*t*a.y+3*u*t*t*b.y+t*t*t*end.y});}current=end;}
    else throw new Error(`Unexpected path command ${command}`);
  }
  return points;
}
const source:CurveBounds={x:700,y:100,width:300,height:210};const target:CurveBounds={x:100,y:100,width:300,height:210};
const reverse:CurveInput={sourceX:1009.5,sourceY:219.5,targetX:90.5,targetY:219.5,sourcePosition:Position.Right,targetPosition:Position.Left,sourceBounds:source,targetBounds:target};
const inside=(point:Point,box:CurveBounds)=>point.x>box.x&&point.x<box.x+box.width&&point.y>box.y&&point.y<box.y+box.height;

describe('Workflow smooth connection paths',()=>{
  it('preserves the public Bezier path exactly for ordinary forward links',()=>{
    const input={...reverse,sourceX:409.5,targetX:690.5,targetY:410};
    const [expected,labelX,labelY]=getBezierPath(input);expect(workflowCurve(input)).toEqual({path:expected,labelX,labelY,detour:false});
  });
  it('keeps a reverse same-height edge at its ports instead of routing around the cards',()=>{
    const curve=workflowCurve(reverse);const points=sampledPath(curve.path);
    expect(curve.detour).toBe(false);expect(curve.labelY).toBe(reverse.sourceY);
    expect(points.every(point=>Math.abs(point.y-reverse.sourceY)<.001)).toBe(true);
    expect(points.some(point=>inside(point,source))).toBe(true);
    expect(points.some(point=>inside(point,target))).toBe(true);
    expect(points[0]).toEqual({x:reverse.sourceX,y:reverse.sourceY});expect(points.at(-1)).toEqual({x:reverse.targetX,y:reverse.targetY});
  });
  it('keeps a staggered curve within the port heights and ignores unrelated card bounds',()=>{
    const movedSource={x:700,y:60,width:490,height:430};const movedTarget={x:100,y:270,width:340,height:310};
    const input={...reverse,sourceX:1199.5,sourceY:289.5,targetX:90.5,targetY:439.5,sourceBounds:movedSource,targetBounds:movedTarget};
    const curve=workflowCurve(input);expect(curve.path).not.toBe(workflowCurve(reverse).path);
    expect(sampledPath(curve.path).every(point=>Number.isFinite(point.x)&&point.y>=input.sourceY&&point.y<=input.targetY)).toBe(true);
    expect(workflowCurve({...input,sourceBounds:source,targetBounds:target})).toEqual(curve);
    expect(workflowCurve({...input,sourceBounds:undefined,targetBounds:undefined})).toEqual(curve);
  });
  it('normalizes dragging from a target into exactly the final source-to-target path',()=>{
    const preview=normalizePreview({fromType:'target',sourceX:reverse.targetX,sourceY:reverse.targetY,targetX:reverse.sourceX,targetY:reverse.sourceY,sourcePosition:Position.Left,targetPosition:Position.Right,sourceBounds:target,targetBounds:source});
    expect(workflowCurve(preview).path).toBe(workflowCurve(reverse).path);
    expect(workflowCurve(normalizePreview({...reverse,fromType:'source'})).path).toBe(workflowCurve(reverse).path);
  });
  it('uses public flow-space preview centers without adding relative or absolute Handle coordinates again',()=>{
    const relativeSource:Handle={nodeId:'test-source',type:'source',position:Position.Right,x:300.5,y:115,width:9,height:9};
    const absoluteTarget:Handle={nodeId:'test-target',type:'target',position:Position.Left,x:994,y:669.5,width:9,height:9};
    expect(previewEndpoint(relativeSource,1005,219.5)).toEqual({x:1009.5,y:219.5});
    expect(previewEndpoint(absoluteTarget,994,669.5)).toEqual({x:989.5,y:669.5});
    expect(previewEndpoint({...relativeSource,x:1005,y:219.5},1005,219.5)).toEqual({x:1009.5,y:219.5});
    expect(previewEndpoint({...absoluteTarget,x:-9.5,y:115},994,669.5)).toEqual({x:989.5,y:669.5});
    expect(previewEndpoint({...absoluteTarget,position:Position.Top},994,669.5)).toEqual({x:994,y:665});
    expect(previewEndpoint({...absoluteTarget,position:Position.Bottom},994,669.5)).toEqual({x:994,y:674});
    expect(previewEndpoint(null,994,669.5)).toEqual({x:994,y:669.5});
  });
  it('matches reverse final geometry from either drag direction after converting each public center exactly once',()=>{
    const sourceHandle:Handle={nodeId:'test-source',type:'source',position:Position.Right,x:300.5,y:115,width:9,height:9};
    const targetHandle:Handle={nodeId:'test-target',type:'target',position:Position.Left,x:95,y:219.5,width:9,height:9};
    const sourcePoint=previewEndpoint(sourceHandle,1005,219.5),targetPoint=previewEndpoint(targetHandle,95,219.5);
    const forwardGesture=normalizePreview({fromType:'source',sourceX:sourcePoint.x,sourceY:sourcePoint.y,targetX:targetPoint.x,targetY:targetPoint.y,sourcePosition:Position.Right,targetPosition:Position.Left,sourceBounds:source,targetBounds:target});
    const backwardGesture=normalizePreview({fromType:'target',sourceX:targetPoint.x,sourceY:targetPoint.y,targetX:sourcePoint.x,targetY:sourcePoint.y,sourcePosition:Position.Left,targetPosition:Position.Right,sourceBounds:target,targetBounds:source});
    expect(workflowCurve(forwardGesture).path).toBe(workflowCurve(reverse).path);
    expect(workflowCurve(backwardGesture).path).toBe(workflowCurve(reverse).path);
  });
});
