import type { Position, Workflow, WorkflowNode, WorkflowEdge, WorkflowGroup } from '../shared/model.ts';
import { executionIsActive } from './graph.ts';

export const TASK_CLIPBOARD_MIME='application/vnd.dsh.workflow-task+json';
export interface TaskClipboardContent { title:string; instruction:string }
let clipboard:{mime:string;json:string}|undefined;

/** The page-local clipboard contains only editable task text, never authority or native history. */
export function copyTaskText(task:Pick<WorkflowNode,'title'|'instruction'>):void{
  clipboard={mime:TASK_CLIPBOARD_MIME,json:JSON.stringify({version:1,title:task.title,instruction:task.instruction})};
}
export function readTaskClipboard():TaskClipboardContent|undefined{
  if(clipboard?.mime!==TASK_CLIPBOARD_MIME)return;
  try{
    const value:unknown=JSON.parse(clipboard.json);
    if(!value||typeof value!=='object'||Array.isArray(value))return;
    const item=value as Record<string,unknown>;
    if(item.version!==1||typeof item.title!=='string'||!item.title.trim()||item.title.length>160||typeof item.instruction!=='string'||item.instruction.length>20000)return;
    return {title:item.title,instruction:item.instruction};
  }catch{return;}
}
export function createTaskDraft(content:TaskClipboardContent,position:Position):WorkflowNode{
  return {id:`node-${crypto.randomUUID()}`,title:content.title,instruction:content.instruction,source:'user',status:'draft',revision:1,position:{...position}};
}

interface GraphClipboard {workflowId:string;mode:'copy'|'cut';nodes:WorkflowNode[];edges:WorkflowEdge[];groups:WorkflowGroup[]}
let graphClipboard:GraphClipboard|undefined;

/** Copy editable task facts and internal links only; authority and native history stay with the original. */
export function copyGraph(workflow:Workflow,nodeIds:readonly string[]):void{
  graphClipboard=snapshotGraph(workflow,nodeIds);
  if(graphClipboard.nodes.length===1)copyTaskText(graphClipboard.nodes[0]!);
}
function snapshotGraph(workflow:Workflow,nodeIds:readonly string[]):GraphClipboard{
  const requested=new Set(nodeIds);
  const selected=workflow.nodes.filter(node=>requested.has(node.id)&&!node.hidden);
  const ids=new Set(selected.map(node=>node.id));
  if(!selected.length)throw new Error('请先选择要复制的任务。');
  if(selected.some(node=>node.kind==='session'))throw new Error('原生对话根节点不能复制或剪切；请从历史分支创建任务。');
  const x=Math.min(...selected.map(node=>node.position.x)),y=Math.min(...selected.map(node=>node.position.y));
  return {workflowId:workflow.id,mode:'copy',nodes:selected.map(node=>({...createTaskDraft(node,{x:node.position.x-x,y:node.position.y-y}),id:node.id,width:node.width,height:node.height,zIndex:node.zIndex??0,attachments:structuredClone(node.attachments??[]),model:node.model?{...node.model}:undefined})),
    edges:workflow.edges.filter(edge=>ids.has(edge.source)&&ids.has(edge.target)).map(edge=>({...edge})),
    groups:(workflow.groups??[]).map(group=>({...group,nodeIds:group.nodeIds.filter(id=>ids.has(id))})).filter(group=>group.nodeIds.length>0)};
}
export function pasteGraph(workflow:Workflow,position:Position):{workflow:Workflow;nodeIds:string[]}{
  const content=graphClipboard;
  if(!content?.nodes.length){
    const task=readTaskClipboard();if(!task)throw new Error('画布剪贴板为空，请先复制任务。');
    const node=createTaskDraft(task,position);return {workflow:{...workflow,nodes:[...workflow.nodes,node]},nodeIds:[node.id]};
  }
  if(content.mode==='cut'){
    if(content.workflowId!==workflow.id)throw new Error('剪切的节点保留原执行历史，仅能在原工作流中移动；跨工作流请使用复制。');
    const originals=content.nodes.map(node=>workflow.nodes.find(item=>item.id===node.id));
    if(originals.some(node=>!node))throw new Error('剪切来源已改变，请先恢复隐藏节点或重新复制。');
    if(originals.every(node=>node?.hidden)){
      const positions=new Map(content.nodes.map(node=>[node.id,{x:position.x+node.position.x,y:position.y+node.position.y}]));
      const next={...workflow,nodes:workflow.nodes.map(node=>positions.has(node.id)?{...node,hidden:false,position:positions.get(node.id)!}:node)};
      copyGraph(next,content.nodes.map(node=>node.id));
      return {workflow:next,nodeIds:content.nodes.map(node=>node.id)};
    }
    if(originals.some(node=>node?.hidden))throw new Error('部分剪切已被撤销，请先恢复隐藏节点，再重新选择。');
  }
  return pasteSnapshot(workflow,position,content);
}
function pasteSnapshot(workflow:Workflow,position:Position,content:GraphClipboard):{workflow:Workflow;nodeIds:string[]}{
  if(content.workflowId!==workflow.id&&content.nodes.some(node=>node.attachments?.length))throw new Error('带附件任务仅支持在同一工作流内粘贴；其他工作流请重新上传文件。');
  const ids=new Map(content.nodes.map(node=>[node.id,`node-${crypto.randomUUID()}`]));
  const nodes=content.nodes.map(node=>({...structuredClone(node),id:ids.get(node.id)!,position:{x:position.x+node.position.x,y:position.y+node.position.y}}));
  const edges=content.edges.map(edge=>({...edge,id:`edge-${crypto.randomUUID()}`,source:ids.get(edge.source)!,target:ids.get(edge.target)!}));
  const groups=content.groups.map(group=>({...group,id:`group-${crypto.randomUUID()}`,nodeIds:group.nodeIds.map(id=>ids.get(id)!)}));
  return {workflow:{...workflow,nodes:[...workflow.nodes,...nodes],edges:[...workflow.edges,...edges],groups:[...(workflow.groups??[]),...groups]},nodeIds:nodes.map(node=>node.id)};
}
/** Validate the entire selection before touching either graph or clipboard. */
export function cutGraph(workflow:Workflow,nodeIds:readonly string[]):Workflow{
  const next=hideGraphNodes(workflow,nodeIds);
  copyGraph(workflow,nodeIds);
  graphClipboard!.mode='cut';return next;
}
/** Removing a card from the canvas never deletes its Session, Execution or branch identity. */
export function hideGraphNodes(workflow:Workflow,nodeIds:readonly string[]):Workflow{
  const ids=new Set(nodeIds),selected=workflow.nodes.filter(node=>ids.has(node.id)&&!node.hidden);
  if(!selected.length)throw new Error('请先选择要移除的任务。');
  if(selected.some(node=>node.kind==='session'))throw new Error('原生对话根节点保持只读，请进入工作流选择任务节点。');
  if(selected.some(node=>workflow.executions?.some(run=>run.nodeId===node.id&&(executionIsActive(run)||run.status==='unknown'||run.durability==='needs-reconcile'))||workflow.operations?.some(op=>['pending','needs-reconcile'].includes(op.status)&&(op.nodeId===node.id||op.nodeIds?.includes(node.id)))))throw new Error('所选任务正在执行、等待或需要核对，请先停止或确认结果后再剪切。');
  return {...workflow,nodes:workflow.nodes.map(node=>ids.has(node.id)?{...node,hidden:true}:node)};
}
export function restoreGraphNodes(workflow:Workflow):Workflow{return {...workflow,nodes:workflow.nodes.map(node=>node.hidden?{...node,hidden:false}:node)};}
export function duplicateGraph(workflow:Workflow,nodeIds:readonly string[]):{workflow:Workflow;nodeIds:string[]}{
  const content=snapshotGraph(workflow,nodeIds),selected=workflow.nodes.filter(node=>nodeIds.includes(node.id)&&!node.hidden);
  return pasteSnapshot(workflow,{x:Math.min(...selected.map(node=>node.position.x))+48,y:Math.min(...selected.map(node=>node.position.y))+48},content);
}
