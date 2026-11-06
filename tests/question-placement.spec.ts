import { describe, expect, it } from 'vitest';
import { placeQuestionPanels } from '../src/client/question-placement.ts';
import type { Rectangle } from '../src/client/graph.ts';

const intersects=(a:Rectangle,b:Rectangle)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
describe('Question overlay placement',()=>{
  it('places questions in empty space beside nodes and preserves every graph rectangle',()=>{
    const nodes=[{x:140,y:120,width:300,height:210},{x:580,y:120,width:300,height:210}];
    const before=structuredClone(nodes),anchors=[{key:'native-request',anchor:nodes[0]!,width:340,height:270}];
    const [panel]=placeQuestionPanels(anchors,{width:1500,height:900},nodes,{left:84,top:82,bottom:76});
    expect(nodes).toEqual(before);expect(anchors[0]!.anchor).toBe(nodes[0]);expect(nodes.some(node=>intersects(panel!,node))).toBe(false);expect(panel!.x).toBeGreaterThanOrEqual(84);expect(panel!.y).toBeGreaterThanOrEqual(82);expect(panel!.x+panel!.width).toBeLessThanOrEqual(1488);expect(panel!.y+panel!.height).toBeLessThanOrEqual(824);
  });
  it('keeps multiple simultaneous question panels separate without shifting their task anchors',()=>{
    const nodes=[{x:200,y:300,width:240,height:180},{x:780,y:300,width:240,height:180}];
    const panels=placeQuestionPanels(nodes.map((anchor,index)=>({key:`request-${index}`,anchor,width:320,height:220})),{width:1550,height:1000},nodes);
    expect(panels.map(panel=>panel.key)).toEqual(['request-0','request-1']);expect(intersects(panels[0]!,panels[1]!)).toBe(false);expect(panels.every(panel=>nodes.every(node=>!intersects(panel,node)))).toBe(true);
  });
  it('clamps oversized content and offscreen anchors to the available canvas rather than moving the viewport',()=>{
    const anchor={x:900,y:-300,width:300,height:210},viewport={width:320,height:430};
    const [panel]=placeQuestionPanels([{key:'request',anchor,width:600,height:900}],viewport,[],{left:8,right:8,top:84,bottom:60});
    expect(panel).toEqual({key:'request',x:8,y:84,width:304,height:286});expect(anchor).toEqual({x:900,y:-300,width:300,height:210});expect(viewport).toEqual({width:320,height:430});
  });
  it('returns deterministic finite positions even when the canvas is completely occupied',()=>{
    const anchor={x:0,y:0,width:350,height:400},args=[[{key:'request',anchor}],{width:350,height:400},[anchor]] as const;
    const first=placeQuestionPanels(...args);expect(first).toEqual(placeQuestionPanels(...args));expect(Object.values(first[0]!).filter(value=>typeof value==='number').every(Number.isFinite)).toBe(true);
    expect(placeQuestionPanels([],{width:0,height:0},[])).toEqual([]);
  });
});
