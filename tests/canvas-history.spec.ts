import { describe, expect, it } from 'vitest';
import { applyNodePositions, changeLayer, changeLayers, editorTextConflicts, executionVisibleInBranch, positionSessionRoots, runnableSelectedNodeIds } from '../src/client/graph.ts';
import type { WorkflowNode } from '../src/shared/model.ts';
import type { BranchCard, ExecutionCard } from '../src/client/ui-contract.ts';

describe('Canvas shared history visibility',()=>{
  it('accepts a delayed text-save revision acknowledgement but detects actual concurrent text edits',()=>{
    const baseline={revision:1,title:'TEST renamed header',instruction:'TEST original body'};
    expect(editorTextConflicts({...baseline,revision:2},baseline)).toBe(false);
    expect(editorTextConflicts({...baseline,revision:2,instruction:'TEST another editor changed body'},baseline)).toBe(true);
    expect(editorTextConflicts({...baseline,revision:2,title:'TEST another header'},baseline)).toBe(true);
  });
  it('moves one level through equal layers and restores only the chosen node to the default',()=>{
    const items=[{id:'a',zIndex:0,title:'TEST A'},{id:'b',zIndex:0,title:'TEST B'},{id:'c',zIndex:0,title:'TEST C'}];
    const order=(nodes:typeof items)=>[...nodes].sort((a,b)=>a.zIndex-b.zIndex).map(node=>node.id);
    expect(order(changeLayer(items,'a','up'))).toEqual(['b','a','c']);
    expect(order(changeLayer(items,'c','down'))).toEqual(['a','c','b']);
    expect(order(changeLayer(items,'a','front'))).toEqual(['b','c','a']);
    expect(order(changeLayer(items,'c','back'))).toEqual(['c','a','b']);
    const reset=changeLayer([{id:'a',zIndex:9,title:'TEST A'},{id:'b',zIndex:5,title:'TEST B'}],'a','reset');
    expect(reset[0]).toEqual({id:'a',zIndex:0,title:'TEST A'});expect(reset[1]).toEqual({id:'b',zIndex:5,title:'TEST B'});
  });
  it('moves every selected group member as one stable ordered layer block',()=>{
    const items=['a','b','c','d','e'].map((id,index)=>({id,zIndex:index,position:{x:index,y:index}}));
    const order=(nodes:typeof items)=>[...nodes].sort((left,right)=>left.zIndex-right.zIndex).map(node=>node.id);
    expect(order(changeLayers(items,['b','c'],'up'))).toEqual(['a','d','b','c','e']);
    expect(order(changeLayers(items,['b','c'],'down'))).toEqual(['b','c','a','d','e']);
    expect(order(changeLayers(items,['b','d'],'front'))).toEqual(['a','c','e','b','d']);
    expect(order(changeLayers(items,['b','d'],'back'))).toEqual(['b','d','a','c','e']);
    expect(order(changeLayers(items,['b','d'],'up'))).toEqual(['a','c','e','b','d']);
    expect(order(changeLayers(items,['b','d'],'down'))).toEqual(['b','d','a','c','e']);
    const reset=changeLayers(items,['b','d'],'reset');expect(reset.map(node=>node.zIndex)).toEqual([0,0,2,0,4]);expect(reset.map(node=>node.position)).toEqual(items.map(node=>node.position));expect(items.map(node=>node.zIndex)).toEqual([0,1,2,3,4]);
    expect(changeLayers(items,['missing'],'front')).toEqual(items);
  });
  it('commits all group drag positions together without replacing other task facts',()=>{
    const original=[{id:'a',position:{x:1,y:2},title:'TEST A'},{id:'b',position:{x:3,y:4},title:'TEST B'},{id:'c',position:{x:5,y:6},title:'TEST C'}];
    const moved=applyNodePositions(original,[{id:'a',position:{x:101,y:102}},{id:'b',position:{x:103,y:104}}]);
    expect(moved.map(node=>node.position)).toEqual([{x:101,y:102},{x:103,y:104},{x:5,y:6}]);
    expect(moved[0]!.title).toBe('TEST A');expect(moved[2]).toBe(original[2]);expect(original[0]!.position).toEqual({x:1,y:2});
  });
  it('batches only selected executable tasks and excludes read-only roots and active runs from any branch',()=>{
    const task=(id:string):WorkflowNode=>({id,title:`TEST ${id}`,instruction:'TEST',source:'user',status:'draft',revision:1,position:{x:0,y:0}});
    const nodes=[task('a'),task('b'),task('c'),{...task('root'),kind:'session' as const,sourceSessionId:'test-source'}];
    const run:ExecutionCard={runId:'test-only-active',nodeId:'b',nodeRevision:1,branchId:'another-branch',sessionId:'test-session',status:'waiting',createdAt:1,updatedAt:2};
    expect(runnableSelectedNodeIds(nodes,new Set(['root','a','b']),[run])).toEqual(['a']);
    expect(runnableSelectedNodeIds(nodes,new Set(['a','b','c']),[{...run,status:'completed'}])).toEqual(['a','b','c']);
  });
  it('places newly discovered native Sessions away from saved root positions even when the catalog order changes',()=>{
    const positioned=positionSessionRoots([{sessionId:'newest',title:'TEST newest',updatedAt:3},{sessionId:'saved',title:'TEST saved',updatedAt:2,position:{x:120,y:150}},{sessionId:'another',title:'TEST another',updatedAt:1}]);
    expect(positioned.find(root=>root.sessionId==='saved')?.position).toEqual({x:120,y:150});
    expect(positioned.find(root=>root.sessionId==='newest')?.position).toEqual({x:900,y:150});
    expect(positioned.find(root=>root.sessionId==='another')?.position).toEqual({x:510,y:150});
  });
  it('shows shared ancestor execution references through nested forks only up to their native boundary',()=>{
    const branches:BranchCard[]=[
      {id:'root',label:'TEST root',sessionId:'root-session',nodeIds:['a','late']},
      {id:'child',label:'TEST child',sessionId:'child-session',sourceSessionId:'root-session',parentBranchId:'root',forkBoundarySeq:20,nodeIds:['a','b']},
      {id:'grandchild',label:'TEST grandchild',sessionId:'grandchild-session',sourceSessionId:'child-session',parentBranchId:'child',forkBoundarySeq:12,nodeIds:['a','b','c']},
    ];
    const run:ExecutionCard={runId:'test-only-run',nodeId:'a',nodeRevision:1,branchId:'root',sessionId:'root-session',status:'completed',createdAt:1,updatedAt:2,endSeq:12};
    expect(executionVisibleInBranch(run,'child',branches)).toBe(true);
    expect(executionVisibleInBranch(run,'grandchild',branches)).toBe(true);
    expect(executionVisibleInBranch({...run,endSeq:20},'child',branches)).toBe(true);
    expect(executionVisibleInBranch({...run,endSeq:20},'grandchild',branches)).toBe(false);
    expect(executionVisibleInBranch({...run,endSeq:21},'grandchild',branches)).toBe(false);
    expect(executionVisibleInBranch({...run,nodeId:'late'},'child',branches)).toBe(false);
    expect(executionVisibleInBranch({...run,endSeq:undefined},'child',branches)).toBe(false);
    expect(executionVisibleInBranch({...run,nodeId:'b',branchId:'child',sessionId:'child-session',endSeq:12},'grandchild',branches)).toBe(true);
    expect(executionVisibleInBranch({...run,nodeId:'b',branchId:'child',sessionId:'child-session',endSeq:13},'grandchild',branches)).toBe(false);
    expect(executionVisibleInBranch({...run,branchId:'grandchild',endSeq:undefined},'grandchild',branches)).toBe(true);
  });
  it('shows automatic execution paths in their manual scope without exposing sibling or future events inside a native path',()=>{
    const branches:BranchCard[]=[
      {id:'root',label:'TEST root',sessionId:'root-session',nodeIds:['a']},
      {id:'auto-left',label:'TEST left',sessionId:'left-session',sourceSessionId:'root-session',parentBranchId:'root',forkBoundarySeq:10,nodeIds:['a','left'],automatic:true},
      {id:'auto-right',label:'TEST right',sessionId:'right-session',sourceSessionId:'root-session',parentBranchId:'root',forkBoundarySeq:10,nodeIds:['a','right'],automatic:true},
      {id:'auto-next',label:'TEST next',sessionId:'next-session',sourceSessionId:'left-session',parentBranchId:'auto-left',forkBoundarySeq:15,nodeIds:['a','left','next'],automatic:true},
      {id:'manual',label:'TEST history',sessionId:'manual-session',sourceSessionId:'left-session',parentBranchId:'auto-left',forkBoundarySeq:13,nodeIds:['a','left']},
      {id:'manual-auto',label:'TEST history next',sessionId:'manual-auto-session',sourceSessionId:'manual-session',parentBranchId:'manual',forkBoundarySeq:18,nodeIds:['a','left','manual-next'],automatic:true},
    ];
    const run=(branchId:string,nodeId:string,sessionId:string,endSeq?:number):ExecutionCard=>({runId:`test-${branchId}-${nodeId}`,nodeId,nodeRevision:1,branchId,sessionId,status:endSeq===undefined?'running':'completed',createdAt:1,updatedAt:2,endSeq});
    const left=run('auto-left','left','left-session',13),right=run('auto-right','right','right-session'),next=run('auto-next','next','next-session',21),manual=run('manual','left','manual-session',17),manualNext=run('manual-auto','manual-next','manual-auto-session');
    expect(executionVisibleInBranch(left,'root',branches)).toBe(true);
    expect(executionVisibleInBranch(right,'root',branches)).toBe(true);
    expect(executionVisibleInBranch(next,'root',branches)).toBe(true);
    expect(executionVisibleInBranch(manual,'root',branches)).toBe(false);
    expect(executionVisibleInBranch(manualNext,'root',branches)).toBe(false);
    expect(executionVisibleInBranch(manualNext,'manual',branches)).toBe(true);
    expect(executionVisibleInBranch(right,'auto-left',branches)).toBe(false);
    expect(executionVisibleInBranch(next,'auto-left',branches)).toBe(false);
    expect(executionVisibleInBranch(run('root','a','root-session',11),'auto-left',branches)).toBe(false);
    expect(executionVisibleInBranch(run('root','a','root-session',10),'auto-next',branches)).toBe(true);
    expect(executionVisibleInBranch(left,'auto-next',branches)).toBe(true);
    expect(executionVisibleInBranch(left,'manual',branches)).toBe(true);
    expect(executionVisibleInBranch({...left,endSeq:14},'manual',branches)).toBe(false);
    expect(executionVisibleInBranch(right,'manual',branches)).toBe(false);
    expect(executionVisibleInBranch(run('auto-next','next','next-session'),'auto-next',branches)).toBe(true);
  });
  it('does not treat a logical scope parent as native Session ancestry',()=>{
    const branches:BranchCard[]=[
      {id:'scope',label:'TEST scope',sessionId:'scope-session',nodeIds:['a']},
      {id:'other',label:'TEST other',sessionId:'other-session',nodeIds:['a']},
      {id:'logical-child',label:'TEST logical child',sessionId:'logical-session',parentBranchId:'scope',sourceSessionId:'other-session',forkBoundarySeq:20,nodeIds:['a'],automatic:true},
    ];
    const run:ExecutionCard={runId:'test-scope-only-parent',nodeId:'a',nodeRevision:1,branchId:'other',sessionId:'other-session',status:'completed',createdAt:1,updatedAt:2,endSeq:10};
    expect(executionVisibleInBranch(run,'logical-child',branches)).toBe(false);
    expect(executionVisibleInBranch({...run,branchId:'scope',sessionId:'scope-session'},'logical-child',branches)).toBe(false);
  });
  it('shows exact upstream results through a completed join carrier and respects every later physical fork cap',()=>{
    const branches:BranchCard[]=[
      {id:'scope',label:'TEST scope',sessionId:'scope-session',nodeIds:['a','b','join']},
      {id:'left',label:'TEST left',sessionId:'left-session',sourceSessionId:'scope-session',parentBranchId:'scope',forkBoundarySeq:9,nodeIds:['a'],automatic:true},
      {id:'right',label:'TEST right',sessionId:'right-session',sourceSessionId:'scope-session',parentBranchId:'scope',forkBoundarySeq:9,nodeIds:['b'],automatic:true},
      {id:'join',label:'TEST result join',sessionId:'join-session',parentBranchId:'scope',nodeIds:['a','b','join'],automatic:true},
      {id:'manual-after',label:'TEST after join',sessionId:'after-session',sourceSessionId:'join-session',parentBranchId:'join',forkBoundarySeq:14,nodeIds:['a','b','join']},
      {id:'manual-before',label:'TEST before join end',sessionId:'before-session',sourceSessionId:'join-session',parentBranchId:'join',forkBoundarySeq:13,nodeIds:['a','b','join']},
    ];
    const left:ExecutionCard={runId:'left-run',requestId:'left-request',nodeId:'a',nodeRevision:1,branchId:'left',sessionId:'left-session',status:'completed',durability:'durable',createdAt:1,updatedAt:1,startSeq:10,endSeq:20};
    const right:ExecutionCard={...left,runId:'right-run',requestId:'right-request',nodeId:'b',branchId:'right',sessionId:'right-session',endSeq:25};
    const carrier:ExecutionCard={...left,runId:'join-run',requestId:'join-request',nodeId:'join',branchId:'join',sessionId:'join-session',startSeq:0,endSeq:14,resultInputs:[left,right].map(run=>({runId:run.runId,sessionId:run.sessionId,requestId:run.requestId!,startSeq:run.startSeq!,endSeq:run.endSeq!,sha256:'a'.repeat(64)}))};
    const runs=[left,right,carrier];
    expect(executionVisibleInBranch(left,'join',branches,runs)).toBe(true);
    expect(executionVisibleInBranch(right,'join',branches,runs)).toBe(true);
    expect(executionVisibleInBranch(left,'manual-after',branches,runs)).toBe(true);
    expect(executionVisibleInBranch(right,'manual-before',branches,runs)).toBe(false);
    expect(executionVisibleInBranch(right,'left',branches,runs)).toBe(false);
    // The same node's later rerun is not the specific result that was imported.
    expect(executionVisibleInBranch({...left,runId:'left-rerun'},'join',branches,runs)).toBe(false);
    expect(executionVisibleInBranch({...left,endSeq:21},'join',branches,runs)).toBe(false);
    expect(executionVisibleInBranch({...left,requestId:'different-request'},'join',branches,runs)).toBe(false);
    expect(executionVisibleInBranch(left,'join',branches,[...runs.slice(0,2),{...carrier,status:'running'}])).toBe(false);
    expect(executionVisibleInBranch(left,'join',branches,[...runs.slice(0,2),{...carrier,durability:'pending'}])).toBe(false);
    expect(executionVisibleInBranch(left,'join',branches,[...runs.slice(0,2),{...carrier,endSeq:undefined}])).toBe(false);
    expect(executionVisibleInBranch(left,'join',branches)).toBe(false);
  });
});
