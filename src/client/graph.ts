import { layoutDependencyNodes } from '../shared/layout.ts';
import type { WorkflowEdge, WorkflowGroup, WorkflowNode } from '../shared/model.ts';
import type { BranchCard, ExecutionCard, SessionRootCard } from './ui-contract.ts';

export type LayerAction='up'|'down'|'front'|'back'|'reset';
/** Rank all visible peers together so equal layer values still move exactly one position. */
export function changeLayer<T extends {id:string;zIndex?:number}>(items:readonly T[],id:string,action:LayerAction):T[]{
  if(!items.some(item=>item.id===id))return [...items];
  if(action==='reset')return items.map(item=>item.id===id?{...item,zIndex:0}:item);
  const ordered=items.map((item,index)=>({item,index})).sort((a,b)=>(a.item.zIndex??0)-(b.item.zIndex??0)||a.index-b.index);
  const current=ordered.findIndex(entry=>entry.item.id===id);
  const target=action==='front'?ordered.length-1:action==='back'?0:action==='up'?Math.min(ordered.length-1,current+1):Math.max(0,current-1);
  const [entry]=ordered.splice(current,1);ordered.splice(target,0,entry!);
  const ranks=new Map(ordered.map((entry,index)=>[entry.item.id,index]));
  return items.map(item=>({...item,zIndex:ranks.get(item.id)!}));
}

/** Move a selected group as one ordered layer block, crossing one outside peer at a time. */
export function changeLayers<T extends {id:string;zIndex?:number}>(items:readonly T[],ids:readonly string[],action:LayerAction):T[]{
  const selected=new Set(ids),ordered=items.map((item,index)=>({item,index})).sort((a,b)=>(a.item.zIndex??0)-(b.item.zIndex??0)||a.index-b.index);
  const members=ordered.filter(entry=>selected.has(entry.item.id));
  if(!members.length)return [...items];
  if(action==='reset')return items.map(item=>selected.has(item.id)?{...item,zIndex:0}:item);
  const rest=ordered.filter(entry=>!selected.has(entry.item.id));
  const first=ordered.findIndex(entry=>selected.has(entry.item.id)),last=ordered.findLastIndex(entry=>selected.has(entry.item.id));
  const beforeFirst=ordered.slice(0,first).filter(entry=>!selected.has(entry.item.id)).length;
  const beforeLast=ordered.slice(0,last).filter(entry=>!selected.has(entry.item.id)).length;
  const target=action==='front'?rest.length:action==='back'?0:action==='up'?Math.min(rest.length,beforeLast+1):Math.max(0,beforeFirst-1);
  rest.splice(target,0,...members);
  const ranks=new Map(rest.map((entry,index)=>[entry.item.id,index]));
  return items.map(item=>({...item,zIndex:ranks.get(item.id)!}));
}

/** Commit every coordinate from a group gesture in a single graph revision. */
export function applyNodePositions<T extends {id:string;position:{x:number;y:number}}>(items:readonly T[],moves:readonly Pick<T,'id'|'position'>[]):T[]{
  const positions=new Map(moves.map(move=>[move.id,move.position]));
  return items.map(item=>{const position=positions.get(item.id);return position&&(position.x!==item.position.x||position.y!==item.position.y)?{...item,position:{...position}}:item;});
}

export type SelectionLayout = 'grid' | 'horizontal' | 'vertical';
/** Compact geometry is a presentation projection; saved node dimensions remain untouched. */
export function compactNodeHeight(contentHeight:number,expandedHeight=210):number{
  const maximum=Math.max(96,Math.min(184,expandedHeight-24));
  return Math.round(Math.max(96,Math.min(maximum,29+24+Math.max(22,Number.isFinite(contentHeight)?contentHeight:22))));
}
export function estimateQuestionHeight(question:string,width=300):number{
  const columns=Math.max(12,Math.floor((width-32)/7));
  const lines=question.split('\n').reduce((count,line)=>count+Math.max(1,Math.ceil([...line].length/columns)),0);
  return Math.max(22,lines*21.6);
}
export interface GeometryNode { id:string; position:{x:number;y:number}; width?:number; height?:number; measured?:{width?:number;height?:number} }
const geometryWidth=(node:GeometryNode)=>node.measured?.width??node.width??300;
const geometryHeight=(node:GeometryNode)=>node.measured?.height??node.height??210;

/** Bounds use the actual card dimensions; groups are decoration and never resize their members. */
export function nodeSelectionBounds(nodes:readonly GeometryNode[],selection:ReadonlySet<string>,padding=0):Rectangle|null{
  const selected=nodes.filter(node=>selection.has(node.id));if(!selected.length)return null;
  const x=Math.min(...selected.map(node=>node.position.x)),y=Math.min(...selected.map(node=>node.position.y));
  const right=Math.max(...selected.map(node=>node.position.x+geometryWidth(node))),bottom=Math.max(...selected.map(node=>node.position.y+geometryHeight(node)));
  return {x:x-padding,y:y-padding,width:right-x+padding*2,height:bottom-y+padding*2};
}

/** Rearrange only the chosen cards, accounting for variable widths/heights in every row and column. */
export function layoutNodeSelection<T extends GeometryNode>(nodes:readonly T[],selection:ReadonlySet<string>,layout:SelectionLayout,gap=48):T[]{
  const selected=nodes.filter(node=>selection.has(node.id));const bounds=nodeSelectionBounds(nodes,selection);
  if(!bounds||selected.length<2)return [...nodes];
  const columns=layout==='horizontal'?selected.length:layout==='vertical'?1:Math.ceil(Math.sqrt(selected.length));
  const widths:number[]=[],heights:number[]=[];
  selected.forEach((node,index)=>{const column=index%columns,row=Math.floor(index/columns);widths[column]=Math.max(widths[column]??0,geometryWidth(node));heights[row]=Math.max(heights[row]??0,geometryHeight(node));});
  const xs:number[]=[],ys:number[]=[];let x=bounds.x,y=bounds.y;
  widths.forEach((width,index)=>{xs[index]=x;x+=width+gap;});heights.forEach((height,index)=>{ys[index]=y;y+=height+gap;});
  const moves=new Map(selected.map((node,index)=>[node.id,{x:xs[index%columns]!,y:ys[Math.floor(index/columns)]!}]));
  return nodes.map(node=>{const position=moves.get(node.id);return position&&(position.x!==node.position.x||position.y!==node.position.y)?{...node,position}:node;});
}

/** Reassign selected identities rather than nesting groups or duplicating membership. */
export function createNodeGroup(groups:readonly WorkflowGroup[],nodeIds:readonly string[],group:{id:string;title:string}):WorkflowGroup[]{
  const selected=new Set(nodeIds);if(selected.size<2)return [...groups];
  const remaining=groups.map(item=>({...item,nodeIds:item.nodeIds.filter(id=>!selected.has(id))})).filter(item=>item.nodeIds.length>0);
  return [...remaining,{...group,nodeIds:[...selected]}];
}

export function trimNodeGroups(groups:readonly WorkflowGroup[],validNodeIds:ReadonlySet<string>):WorkflowGroup[]{
  return groups.map(group=>({...group,nodeIds:group.nodeIds.filter(id=>validNodeIds.has(id))})).filter(group=>group.nodeIds.length>0);
}

export function runnableSelectedNodeIds(nodes:readonly WorkflowNode[],selection:ReadonlySet<string>,executions:readonly ExecutionCard[]):string[]{
  return nodes.filter(node=>!node.hidden&&selection.has(node.id)&&node.kind!=='session'&&!executions.some(run=>run.nodeId===node.id&&executionIsActive(run))).map(node=>node.id);
}

/** A delayed acknowledgement may advance revision while preserving the exact text opened in the editor. */
export function editorTextConflicts(current:Pick<WorkflowNode,'revision'|'title'|'instruction'>,baseline:Pick<WorkflowNode,'revision'|'title'|'instruction'>):boolean{
  return current.revision!==baseline.revision&&(current.title!==baseline.title||current.instruction!==baseline.instruction);
}

export function executionIsActive(run:ExecutionCard):boolean{
  return ['pending','queued','ready','running','waiting','waiting_approval','waiting_answer'].includes(run.status)||(run.status==='blocked'&&run.endSeq===undefined);
}

/** New catalog entries fill unused cells while preserving every saved user position. */
export function positionSessionRoots(roots:readonly SessionRootCard[]):SessionRootCard[]{
  const occupied=roots.flatMap(root=>root.position?[{...root.position,width:root.width??300,height:root.height??210}]:[]);
  const positions=new Map(roots.flatMap(root=>root.position?[[root.sessionId,root.position] as const]:[]));
  for(const root of [...roots].filter(root=>!root.position).sort((a,b)=>a.sessionId.localeCompare(b.sessionId))){
    let cell=0;let position={x:120,y:150};
    while(occupied.some(other=>position.x<other.x+other.width+30&&position.x+(root.width??300)+30>other.x&&position.y<other.y+other.height+30&&position.y+(root.height??210)+30>other.y)){
      cell++;position={x:120+cell%4*390,y:150+Math.floor(cell/4)*270};
    }
    occupied.push({...position,width:root.width??300,height:root.height??210});positions.set(root.sessionId,position);
  }
  return roots.map(root=>root.position?root:{...root,position:positions.get(root.sessionId)!});
}

/** Automatic execution paths stay visible in their owning manual graph scope. */
function manualBranchScope(branch:BranchCard,branches:readonly BranchCard[]):string|undefined{
  const visited=new Set<string>();
  let current:BranchCard|undefined=branch;
  while(current&&!visited.has(current.id)){
    visited.add(current.id);
    if(current.automatic!==true)return current.id;
    current=branches.find(item=>item.id===current!.parentBranchId);
  }
  return undefined;
}

/** Physical containment remains separate from result references. */
function executionHistoryContains(run:ExecutionCard,branch:BranchCard,branches:readonly BranchCard[],boundary=Infinity):boolean {
  if(run.endSeq===undefined)return false;
  const visited=new Set<string>();
  let ancestor=branch;
  let cap=boundary;
  while(!visited.has(ancestor.id)){
    visited.add(ancestor.id);
    if(ancestor.sessionId===run.sessionId)return run.endSeq<=cap;
    if(!ancestor.parentBranchId)return false;
    if(ancestor.forkBoundarySeq===undefined)return false;
    const parent=branches.find(item=>item.id===ancestor.parentBranchId);
    if(!parent||parent.sessionId!==ancestor.sourceSessionId)return false;
    cap=Math.min(cap,ancestor.forkBoundarySeq);
    ancestor=parent;
  }
  return false;
}

/** Manual scopes show their automatic paths. A completed native carrier can
 * also expose its exact result inputs; this does not create native ancestry. */
export function executionVisibleInBranch(run:ExecutionCard, branchId:string|null|undefined, branches:readonly BranchCard[],executions:readonly ExecutionCard[]=[]):boolean {
  if(!branchId||run.branchId===branchId)return true;
  const branch=branches.find(item=>item.id===branchId);
  const runBranch=branches.find(item=>item.id===run.branchId);
  if(branch&&branch.automatic!==true&&runBranch&&manualBranchScope(runBranch,branches)===branch.id)return true;
  if(!branch?.nodeIds.includes(run.nodeId))return false;
  if(executionHistoryContains(run,branch,branches))return true;
  return executions.some(carrier=>carrier.status==='completed'&&carrier.durability==='durable'&&carrier.resultInputs?.some(input=>input.runId===run.runId&&input.sessionId===run.sessionId&&input.requestId===run.requestId&&input.startSeq===run.startSeq&&input.endSeq===run.endSeq)&&executionHistoryContains(carrier,branch,branches));
}

/** Reject ambiguous or cyclic dependencies before sending the graph to the Host. */
export function connectionError(edges: readonly WorkflowEdge[], source: string, target: string): 'connectionSelf' | 'connectionDuplicate' | 'connectionCycle' | null {
  if (source === target) return 'connectionSelf';
  if (edges.some((edge) => edge.source === source && edge.target === target)) return 'connectionDuplicate';
  const next = new Map<string, string[]>();
  for (const edge of edges) next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
  const pending = [target];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === source) return 'connectionCycle';
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(next.get(current) ?? []));
  }
  return null;
}

/** Place dependency levels in columns; preserve the order of unrelated tasks. */
export function arrangeNodes(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]): WorkflowNode[] {
  return layoutDependencyNodes(nodes,edges);
}

export interface Rectangle { x: number; y: number; width: number; height: number; portY?: number }

/** Pick an anchored floating position without modifying any graph geometry. */
export function placeTracePanel(anchor: Rectangle, viewport: { width: number; height: number }, obstacles: readonly Rectangle[]): Rectangle {
  const gap = 16;
  const clamp = (value: number, max: number) => Math.max(12, Math.min(value, Math.max(12, max)));
  const overlap = (left: Rectangle, right: Rectangle) => Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)) * Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const score = (candidate: Rectangle) => obstacles.reduce((sum, node) => sum
    + overlap(candidate, { x: node.x - 8, y: node.y - 5, width: node.width + 16, height: 50 })
    + overlap(candidate, { x: node.x - 13, y: (node.portY ?? node.y + node.height / 2) - 13, width: 26, height: 26 }) * 3
    + overlap(candidate, { x: node.x + node.width - 13, y: (node.portY ?? node.y + node.height / 2) - 13, width: 26, height: 26 }) * 3, 0);
  let best: Rectangle | undefined;
  for (const preferred of [{ width: 540, height: 424 }, { width: 410, height: 424 }, { width: 360, height: 300 }, { width: 320, height: 240 }, { width: 280, height: 200 }, { width: 240, height: 160 }]) {
    const width = Math.max(1, Math.min(preferred.width, viewport.width - 24));
    const height = Math.max(1, Math.min(preferred.height, viewport.height - 28));
    const candidates = [
      { x: anchor.x, y: anchor.y + anchor.height + 96 },
      { x: anchor.x + anchor.width + gap, y: anchor.y },
      { x: anchor.x - width - gap, y: anchor.y },
      { x: anchor.x, y: anchor.y + anchor.height + 58 },
      { x: anchor.x, y: anchor.y - height - gap },
      { x: 12, y: viewport.height - height - 12 },
      { x: viewport.width - width - 12, y: viewport.height - height - 12 },
    ].map((position) => ({ x: clamp(position.x, viewport.width - width - 12), y: clamp(position.y, viewport.height - height - 12), width, height }));
    for (const candidate of candidates) {
      if (score(candidate) === 0) return candidate;
      if (!best || score(candidate) < score(best)) best = candidate;
    }
  }
  return best!;
}
