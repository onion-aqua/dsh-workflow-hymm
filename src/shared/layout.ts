/** Geometry only: dependency layout never changes task identity or graph edges. */
export interface LayoutNode {
  id:string;
  position:{x:number;y:number};
  width?:number;
  height?:number;
}
export interface LayoutEdge {source:string;target:string}
const width=(node:LayoutNode)=>node.width??300;
const height=(node:LayoutNode)=>node.height??210;
const origin={x:100,y:100},columnGap=106,rowGap=80,bottomOverflow=40,obstacleGap=40;

/** Longest-path layers, with stable neighbour ordering to keep parallel paths together. */
export function layoutDependencyNodes<T extends LayoutNode>(nodes:readonly T[],edges:readonly LayoutEdge[]):T[]{
  if(!nodes.length)return [];
  const ids=new Set(nodes.map(node=>node.id));if(ids.size!==nodes.length)return [...nodes];
  const parents=new Map(nodes.map(node=>[node.id,[] as string[]])),children=new Map(nodes.map(node=>[node.id,[] as string[]]));
  const incoming=new Map(nodes.map(node=>[node.id,0])),depth=new Map(nodes.map(node=>[node.id,0]));
  for(const edge of edges){
    if(!ids.has(edge.source)||!ids.has(edge.target))continue;
    parents.get(edge.target)!.push(edge.source);children.get(edge.source)!.push(edge.target);incoming.set(edge.target,incoming.get(edge.target)!+1);
  }
  const ready=nodes.filter(node=>incoming.get(node.id)===0).map(node=>node.id);
  for(let index=0;index<ready.length;index++)for(const child of children.get(ready[index]!)!){
    depth.set(child,Math.max(depth.get(child)!,depth.get(ready[index]!)!+1));incoming.set(child,incoming.get(child)!-1);if(incoming.get(child)===0)ready.push(child);
  }
  if(ready.length!==nodes.length)return [...nodes];
  const layers:Array<T[]>=Array.from({length:Math.max(...depth.values())+1},()=>[]);
  for(const node of nodes)layers[depth.get(node.id)!]!.push(node);
  const ranks=new Map<string,number>();const indexLayer=(layer:readonly T[])=>layer.forEach((node,index)=>ranks.set(node.id,index));layers.forEach(indexLayer);
  const order=(layer:T[],neighbours:Map<string,string[]>)=>{
    const scores=new Map(layer.map((node,index)=>{const adjacent=neighbours.get(node.id)!;return[node.id,adjacent.length?adjacent.reduce((sum,id)=>sum+ranks.get(id)!,0)/adjacent.length:index] as const;}));
    const previous=new Map(layer.map((node,index)=>[node.id,index]));
    layer.sort((a,b)=>scores.get(a.id)!-scores.get(b.id)!||previous.get(a.id)!-previous.get(b.id)!);indexLayer(layer);
  };
  for(let pass=0;pass<3;pass++){
    for(let layer=1;layer<layers.length;layer++)order(layers[layer]!,parents);
    for(let layer=layers.length-2;layer>=0;layer--)order(layers[layer]!,children);
  }
  const positions=new Map<string,{x:number;y:number}>();let x=origin.x;
  for(const layer of layers){
    let y=origin.y;for(const node of layer){positions.set(node.id,{x,y});y+=height(node)+rowGap;}
    x+=Math.max(...layer.map(width))+columnGap;
  }
  return nodes.map(node=>({...node,position:positions.get(node.id)!}));
}

/** Place only a new graph, preserving every existing manually positioned card.
 * Find the first free vertical translation using obstacle intervals rather than
 * extending an unrelated existing canvas into one long horizontal row. */
export function placeNewDependencyNodes<T extends LayoutNode>(nodes:readonly T[],edges:readonly LayoutEdge[],existing:readonly LayoutNode[]):T[]{
  const arranged=layoutDependencyNodes(nodes,edges);if(!arranged.length||!existing.length)return arranged;
  const blocked:Array<{start:number;end:number}>=[];
  for(const node of arranged)for(const other of existing){
    if(node.position.x>=other.position.x+width(other)+obstacleGap||node.position.x+width(node)+obstacleGap<=other.position.x)continue;
    blocked.push({start:other.position.y-node.position.y-height(node)-bottomOverflow-obstacleGap,end:other.position.y+height(other)+bottomOverflow+obstacleGap-node.position.y});
  }
  blocked.sort((a,b)=>a.start-b.start||a.end-b.end);let dy=0;
  for(const interval of blocked){if(interval.start>=dy)break;if(interval.end>dy)dy=interval.end;}
  return dy?arranged.map(node=>({...node,position:{x:node.position.x,y:node.position.y+dy}})):arranged;
}
