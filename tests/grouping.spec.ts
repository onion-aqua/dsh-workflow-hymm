import { describe, expect, it } from 'vitest';
import { createNodeGroup, layoutNodeSelection, nodeSelectionBounds, trimNodeGroups } from '../src/client/graph.ts';
import type { GeometryNode, SelectionLayout } from '../src/client/graph.ts';

const cards=[
  {id:'a',position:{x:150,y:120},width:460,height:320,title:'TEST A'},
  {id:'b',position:{x:700,y:80},width:250,height:190,title:'TEST B'},
  {id:'c',position:{x:10,y:600},width:320,height:450,title:'TEST C'},
  {id:'outside',position:{x:2200,y:140},width:300,height:210,title:'TEST outside'},
];
function overlaps(a:GeometryNode,b:GeometryNode){return a.position.x<b.position.x+(b.width??300)&&a.position.x+(a.width??300)>b.position.x&&a.position.y<b.position.y+(b.height??210)&&a.position.y+(a.height??210)>b.position.y;}

describe('Visual groups and selected layouts',()=>{
  it.each<SelectionLayout>(['grid','horizontal','vertical'])('%s respects each selected card size, preserves other cards and does not mutate task facts',layout=>{
    const result=layoutNodeSelection(cards,new Set(['a','b','c']),layout);
    const selected=result.slice(0,3);for(let i=0;i<selected.length;i++)for(let j=i+1;j<selected.length;j++)expect(overlaps(selected[i]!,selected[j]!)).toBe(false);
    expect(result[3]).toBe(cards[3]);expect(result.map(node=>node.title)).toEqual(cards.map(node=>node.title));
    expect(nodeSelectionBounds(result,new Set(['a','b','c']))).toMatchObject({x:10,y:80});
    expect(cards[0]!.position).toEqual({x:150,y:120});
    if(layout==='horizontal')expect(new Set(selected.map(node=>node.position.y)).size).toBe(1);
    if(layout==='vertical')expect(new Set(selected.map(node=>node.position.x)).size).toBe(1);
  });
  it('uses measured dimensions for geometry and safely ignores empty/single selections',()=>{
    expect(nodeSelectionBounds([{id:'a',position:{x:20,y:30},width:1,height:1,measured:{width:400,height:240}}],new Set(['a']),24)).toEqual({x:-4,y:6,width:448,height:288});
    expect(nodeSelectionBounds(cards,new Set(['missing']))).toBeNull();
    expect(layoutNodeSelection(cards,new Set(['a']),'grid').every((node,index)=>node===cards[index])).toBe(true);
  });
  it('reassigns identities once across groups, retains one-member groups and never nests or deletes nodes',()=>{
    const groups=[{id:'old-a',title:'TEST A',nodeIds:['a','b']},{id:'old-b',title:'TEST B',nodeIds:['c','outside']}];
    const next=createNodeGroup(groups,['a','c','a'],{id:'new',title:'TEST new'});
    expect(next).toEqual([{id:'old-a',title:'TEST A',nodeIds:['b']},{id:'old-b',title:'TEST B',nodeIds:['outside']},{id:'new',title:'TEST new',nodeIds:['a','c']}]);
    expect(groups[0]!.nodeIds).toEqual(['a','b']);expect(next.flatMap(group=>group.nodeIds).sort()).toEqual(['a','b','c','outside']);
  });
  it('trims deleted members, removes empty groups and preserves surviving one-member groups',()=>{
    expect(trimNodeGroups([{id:'a',title:'TEST A',nodeIds:['a','gone']},{id:'b',title:'TEST B',nodeIds:['gone']}],new Set(['a']))).toEqual([{id:'a',title:'TEST A',nodeIds:['a']}]);
  });
});
