import type { Workflow, WorkflowNode } from '../shared/model.ts';

/** Allocation belongs to the Host; view ordering and user-supplied numbers have no authority. */
export function assignNodeNumbers(workflow:Workflow):Workflow{
  const ledger={...workflow.nodeSerials},used=new Set(Object.values(ledger));
  let next=Math.max(1,workflow.nextDisplayId??1,...Object.values(ledger).map(value=>value+1));
  const nodes=workflow.nodes.map(node=>{
    let displayId=ledger[node.id];
    if(displayId===undefined){
      if(node.displayId!==undefined&&!used.has(node.displayId)){displayId=node.displayId;}
      else {while(used.has(next))next++;displayId=next++;}
      ledger[node.id]=displayId;used.add(displayId);next=Math.max(next,displayId+1);
    }
    return {...node,displayId};
  });
  return {...workflow,nodes,nodeSerials:ledger,nextDisplayId:next};
}
export function taskCaption(node:Pick<WorkflowNode,'title'|'displayId'>):string{
  return `#${node.displayId??'?'} ${node.title.replace(/\s+/g,' ').trim().slice(0,46)||'任务'}`;
}
export function branchCaption(from:WorkflowNode|undefined,label:string):string{
  const summary=label.replace(/\s+/g,' ').trim().slice(0,38);
  return from?`从 ${taskCaption(from)} 开始分支${summary&&summary!==from.title?` · ${summary}`:''}`:`主线 · ${summary||'任务'}`;
}
export function nativeSessionCaption(workflow:Workflow,node:WorkflowNode,branchLabel?:string):string{
  const scope=branchLabel&&branchLabel.startsWith('从 ')?` · ${branchLabel}`:'';
  return `${workflow.name.replace(/\s+/g,' ').trim().slice(0,38)}${scope} · ${taskCaption(node)}`.slice(0,160);
}
