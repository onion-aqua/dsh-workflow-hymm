import { describe, expect, it } from 'vitest';
import { layoutDependencyNodes, placeNewDependencyNodes, type LayoutNode } from '../src/shared/layout.ts';
const node=(id:string,width=300,height=210):LayoutNode=>({id,width,height,position:{x:0,y:0}});
const edge=(source:string,target:string)=>({source,target});
function overlaps(a:LayoutNode,b:LayoutNode,margin=0){return a.position.x<b.position.x+(b.width??300)+margin&&a.position.x+(a.width??300)+margin>b.position.x&&a.position.y<b.position.y+(b.height??210)+40+margin&&a.position.y+(a.height??210)+40+margin>b.position.y;}
function expectClear(nodes:readonly LayoutNode[]){for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++)expect(overlaps(nodes[a]!,nodes[b]!)).toBe(false);}

describe('Dependency-aware placement of accepted plan tasks',()=>{
  it('lays out a reverse-ordered chain by dependency, keeping every edge left to right',()=>{
    const nodes=['f','e','d','c','b','a'].map(id=>({...node(id),instruction:`TEST ${id}`}));
    const edges=[edge('a','b'),edge('b','c'),edge('c','d'),edge('d','e'),edge('e','f')];
    const arranged=layoutDependencyNodes(nodes,edges),byId=new Map(arranged.map(item=>[item.id,item]));
    for(const e of edges){expect(byId.get(e.target)!.position.x).toBeGreaterThan(byId.get(e.source)!.position.x+300);expect(byId.get(e.target)!.position.y).toBe(byId.get(e.source)!.position.y);}
    expect(arranged.map(item=>item.id)).toEqual(nodes.map(item=>item.id));expect(arranged.map(item=>item.instruction)).toEqual(nodes.map(item=>item.instruction));expect(nodes.every(item=>item.position.x===0)).toBe(true);expectClear(arranged);
    expect(layoutDependencyNodes(arranged,edges)).toEqual(arranged);
  });
  it('puts parallel branches in separate rows and orders their descendants to avoid simple crossing',()=>{
    const edges=[edge('root','left'),edge('root','right'),edge('left','left-next'),edge('right','right-next'),edge('left-next','done'),edge('right-next','done')];
    const nodes=['root','left','right','right-next','left-next','done'].map(id=>node(id));
    const result=layoutDependencyNodes(nodes,edges),byId=new Map(result.map(item=>[item.id,item]));
    expect(byId.get('left')!.position.x).toBe(byId.get('right')!.position.x);expect(byId.get('left')!.position.y).not.toBe(byId.get('right')!.position.y);
    expect((byId.get('left')!.position.y-byId.get('right')!.position.y)*(byId.get('left-next')!.position.y-byId.get('right-next')!.position.y)).toBeGreaterThan(0);
    for(const e of edges)expect(byId.get(e.target)!.position.x).toBeGreaterThan(byId.get(e.source)!.position.x+300);expectClear(result);
  });
  it('accounts for actual card widths, heights and the model bubble clearance',()=>{
    const nodes=[node('wide',920,500),node('other',220,180),node('next',600,900),node('parallel',450,350)];
    const result=layoutDependencyNodes(nodes,[edge('wide','next'),edge('other','parallel')]),byId=new Map(result.map(item=>[item.id,item]));
    expect(byId.get('next')!.position.x).toBeGreaterThan(byId.get('wide')!.position.x+920);
    const roots=result.filter(item=>['wide','other'].includes(item.id)).sort((a,b)=>a.position.y-b.position.y);
    expect(roots[1]!.position.y).toBeGreaterThanOrEqual(roots[0]!.position.y+roots[0]!.height!+80);expectClear(result);
  });
  it('keeps independent roots in one layer rather than treating list order as a long sequential row',()=>{
    const result=layoutDependencyNodes(Array.from({length:8},(_,index)=>node(`independent-${index}`)),[]);
    expect(new Set(result.map(item=>item.position.x)).size).toBe(1);expect(new Set(result.map(item=>item.position.y)).size).toBe(8);expectClear(result);
  });
  it('finds a free batch position while preserving existing cards and the new dependency geometry',()=>{
    const existing=[{...node('manual',700,480),position:{x:100,y:100}},{...node('lower-manual',1000,300),position:{x:100,y:900}}],before=structuredClone(existing);
    const nodes=[node('first'),node('second'),node('parallel')],edges=[edge('first','second'),edge('first','parallel')];
    const placed=placeNewDependencyNodes(nodes,edges,existing),byId=new Map(placed.map(item=>[item.id,item]));
    expect(existing).toEqual(before);for(const added of placed)for(const old of existing)expect(overlaps(added,old,40)).toBe(false);expectClear(placed);
    expect(byId.get('second')!.position.x).toBeGreaterThan(byId.get('first')!.position.x);expect(byId.get('parallel')!.position.x).toBe(byId.get('second')!.position.x);
    expect(placeNewDependencyNodes(nodes,edges,existing)).toEqual(placed);
  });
  it('uses free nearby canvas space instead of extending after a distant manual node',()=>{
    const nodes=[node('new-root'),node('new-next')],edges=[edge('new-root','new-next')];
    expect(placeNewDependencyNodes(nodes,edges,[{...node('far-manual',1600,1200),position:{x:50000,y:50000}}])).toEqual(layoutDependencyNodes(nodes,edges));
  });
  it('does not invent a layout for a dependency cycle',()=>{
    const nodes=[node('a'),node('b')];expect(layoutDependencyNodes(nodes,[edge('a','b'),edge('b','a')])).toEqual(nodes);expect(layoutDependencyNodes([],[])).toEqual([]);
  });
});
