import type { Workflow, WorkflowNode } from '../shared/model.ts';
import { executionIsActive } from './graph.ts';

/** Only editable facts participate; native executions and immutable source metadata never travel backwards. */
export function editableFacts(workflow:Workflow){
  return {name:workflow.name,settings:workflow.settings,preferences:workflow.preferences,utilityNodes:workflow.utilityNodes??[],planningAttachments:workflow.planningAttachments??[],groups:workflow.groups??[],
    nodes:workflow.nodes.map(node=>({id:node.id,title:node.title,instruction:node.instruction,position:node.position,zIndex:node.zIndex??0,width:node.width??300,height:node.height??210,
      attachments:node.attachments??[],model:node.model??null,hidden:node.hidden??false})),edges:workflow.edges};
}
export function sameHistoryGraph(left:Workflow,right:Workflow):boolean{return JSON.stringify(editableFacts(left))===JSON.stringify(editableFacts(right));}

export interface GraphHistoryEntry {before:Workflow;after:Workflow}
export function replayGraph(current:Workflow,from:Workflow,to:Workflow):Workflow{
  if(!sameHistoryGraph(current,from))throw new Error('画布已由其他操作更新，无法撤销旧步骤。');
  const targetIds=new Set(to.nodes.map(node=>node.id));
  for(const node of current.nodes)if(!targetIds.has(node.id)&&(node.kind==='session'||current.executions?.some(run=>run.nodeId===node.id)||current.operations?.some(op=>op.status==='pending'&&(op.nodeId===node.id||op.nodeIds?.includes(node.id)))))throw new Error('节点已有执行历史或待处理操作，无法通过撤销删除。');
  const nodes=to.nodes.map(target=>{
    const live=current.nodes.find(node=>node.id===target.id);
    if(!live)return {...target,status:'draft' as const,revision:1,answerSummary:undefined,branchIds:undefined,revisions:undefined,originPlanId:undefined};
    const dependencies=(graph:Workflow)=>graph.edges.filter(edge=>edge.target===live.id).map(edge=>edge.source).sort();
    const textChanged=live.title!==target.title||live.instruction!==target.instruction||JSON.stringify(live.model??null)!==JSON.stringify(target.model??null)||JSON.stringify(live.attachments??[])!==JSON.stringify(target.attachments??[])||JSON.stringify(dependencies(current))!==JSON.stringify(dependencies(to));
    const pending=current.operations?.some(op=>op.status==='pending'&&[...(op.nodeIds??[]),...(op.nodeId?[op.nodeId]:[])].some(id=>id===live.id||current.edges.some(edge=>edge.source===live.id&&edge.target===id)));
    if(target.hidden&&!live.hidden&&(pending||current.executions?.some(run=>run.nodeId===live.id&&(executionIsActive(run)||run.status==='unknown'||run.durability==='needs-reconcile'))))throw new Error('请先停止或核对执行，再从画布移除节点。');
    if(textChanged&&(live.kind==='session'||pending||current.executions?.some(run=>run.nodeId===live.id&&executionIsActive(run))))throw new Error('请先停止执行，再撤销任务内容或依赖。');
    return {...live,title:target.title,instruction:target.instruction,position:{...target.position},width:target.width??300,height:target.height??210,zIndex:target.zIndex??0,
      attachments:structuredClone(target.attachments??[]),model:target.model?{...target.model}:undefined,hidden:target.hidden??false} as WorkflowNode;
  });
  return {...current,name:to.name,settings:to.settings,preferences:to.preferences,utilityNodes:structuredClone(to.utilityNodes??[]),planningAttachments:structuredClone(to.planningAttachments??[]),nodes,edges:structuredClone(to.edges),groups:structuredClone(to.groups??[])};
}
