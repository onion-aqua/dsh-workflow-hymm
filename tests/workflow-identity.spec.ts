import { describe,expect,it } from 'vitest';
import type {Workflow,WorkflowNode} from '../src/shared/model.ts';
import {assignNodeNumbers,branchCaption,nativeSessionCaption} from '../src/host/workflow-identity.ts';
import {recommendedAnswers} from '../src/host/question-automation.ts';
const node=(id:string):WorkflowNode=>({id,title:`Task ${id}`,instruction:'Test',position:{x:0,y:0},source:'user',status:'draft',revision:1});
const workflow:Workflow={id:'identity',name:'Test Workflow',schemaVersion:2,revision:1,nodes:[node('a'),node('b'),node('c')],edges:[],viewport:{x:0,y:0,zoom:1},createdAt:1,updatedAt:1};
describe('stable workflow display identities',()=>{
  it('retains numbers through reorder, hide, delete, new tasks, undo and reload',()=>{
    const first=assignNodeNumbers(workflow);expect(first.nodes.map(node=>node.displayId)).toEqual([1,2,3]);
    const next=assignNodeNumbers({...first,nodes:[{...first.nodes[2]!,position:{x:900,y:200}},first.nodes[0]!,node('d')]});expect(next.nodes.map(node=>node.displayId)).toEqual([3,1,4]);
    const restored=assignNodeNumbers({...next,nodes:[...next.nodes,node('b')]});expect(restored.nodes.at(-1)!.displayId).toBe(2);expect(restored.nextDisplayId).toBe(5);
    expect(assignNodeNumbers(structuredClone(restored))).toEqual(restored);
  });
  it('names branch origins and targets without using view order as identity',()=>{
    const numbered=assignNodeNumbers(workflow),from=numbered.nodes[2]!;
    expect(branchCaption(from,'Research')).toBe('从 #3 Task c 开始分支 · Research');
    expect(nativeSessionCaption(numbered,numbered.nodes[0]!,branchCaption(from,'Research'))).toContain('Test Workflow · 从 #3 Task c 开始分支 · Research · #1 Task a');
  });
});
describe('question timeout choice',()=>{
  it('uses only an explicit native recommendation and includes every question',()=>{
    expect(recommendedAnswers([{id:'city',question:'Where?',options:[{label:'A'},{label:'B（推荐）'}]},{id:'fields',question:'Which?',multiSelect:true,options:[{label:'X (Recommended)'},{label:'Y（推荐）'}]}])).toEqual([{id:'city',selected:['B（推荐）']},{id:'fields',selected:['X (Recommended)','Y（推荐）']}]);
  });
  it('never invents an optimal answer from ordering, descriptions, partial batches or ambiguous single choices',()=>{
    for(const questions of [[],[{id:'x',question:'Which?',options:[{label:'First',description:'Recommended'}]}],[{id:'x',question:'Which?',options:[{label:'A（推荐）'},{label:'B（推荐）'}]}],[{id:'x',question:'Which?',options:[{label:'A（推荐）'}]},{id:'y',question:'Enter custom text'}]])expect(recommendedAnswers(questions)).toBeUndefined();
  });
  it('accepts an explicit positive marker or recommendation prefix and rejects ordinary recommendation prose',()=>{
    for(const label of ['Use the native path (Recommended)','使用原生路径（推荐）','Recommended: Inspect first','Recommended：Inspect first','[Recommended] Inspect first'])expect(recommendedAnswers([{id:'path',question:'Which path?',options:[{label},{label:'Another path'}]}])).toEqual([{id:'path',selected:[label]}]);
    for(const label of ['Recommended','This option is recommended','Highly recommended path','Recommended:'])expect(recommendedAnswers([{id:'path',question:'Which path?',options:[{label},{label:'Another path'}]}])).toBeUndefined();
  });
  it('never automatically selects a negative recommendation even beside a positive marker',()=>{
    for(const label of ['Not recommended','Not recommended for production','Delete records — not recommended','Never recommended','Not currently recommended','Dangerous (not recommended)','Not (Recommended)','不推荐','删除历史（不推荐）','不推荐：删除（推荐）','Delete (Recommended) — not recommended for this project'])expect(recommendedAnswers([{id:'path',question:'Which path?',options:[{label},{label:'Keep existing records'}]}])).toBeUndefined();
  });
});
