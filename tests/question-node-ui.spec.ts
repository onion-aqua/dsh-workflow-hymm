// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskNode, type TaskNodeData, type TaskFlowNode } from '../src/client/TaskNode.tsx';
import { translateZh } from '../src/client/locales.ts';
import { executionIsActive, runnableSelectedNodeIds } from '../src/client/graph.ts';
import type { ExecutionCard } from '../src/client/ui-contract.ts';
import type { WorkflowNode } from '../src/shared/model.ts';
let root:Root,container:HTMLDivElement;
const task:WorkflowNode={id:'question-node',title:'Native task',instruction:'Original prompt remains compact',source:'user',status:'running',revision:1,position:{x:50,y:60},width:300,height:210};
const run:ExecutionCard={runId:'run',nodeId:task.id,nodeRevision:1,branchId:'main',sessionId:'native',status:'waiting_answer',createdAt:1,updatedAt:1};
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
async function render(extra:Partial<TaskNodeData>={}){await act(async()=>root.render(createElement(ReactFlowProvider,null,createElement(TaskNode,{id:task.id,type:'task',width:300,height:210,data:{task,order:0,focused:true,collapsed:false,t:translateZh,onMenu:()=>{},...extra},dragging:false,selected:true,isConnectable:true,zIndex:0,positionAbsoluteX:50,positionAbsoluteY:60,selectable:true,deletable:true,draggable:true} as NodeProps<TaskFlowNode>))));}
describe('Task awaiting a native answer',()=>{
  it('shows a separate waiting reminder without enlarging the node or changing its focus',async()=>{
    const onOpenQuestions=vi.fn();await render({activeExecution:run,pendingQuestionCount:2,waitingQuestionCount:2,onOpenQuestions});expect(container.querySelector('.wf-task.is-awaiting-answer.is-focused')).not.toBeNull();expect(container.querySelector(`[data-testid=node-status-${task.id}]`)?.getAttribute('data-state')).toBe('waiting_answer');expect(container.querySelector(`[data-testid=node-status-${task.id}]`)?.textContent).toBe('等待回答');expect(container.querySelector('.wf-running-perimeter')).toBeNull();expect(container.textContent).toContain(task.instruction);await act(async()=>container.querySelector<HTMLButtonElement>(`[data-testid=node-answer-${task.id}]`)!.click());expect(onOpenQuestions).toHaveBeenCalledExactlyOnceWith(task.id);expect(task.position).toEqual({x:50,y:60});expect(task.width).toBe(300);expect(task.height).toBe(210);
  });
  it('keeps waiting_answer execution active so Run selected cannot submit it again',()=>{
    expect(executionIsActive(run)).toBe(true);expect(runnableSelectedNodeIds([task],new Set([task.id]),[run])).toEqual([]);
  });
  it('retains a supplement reminder after a timed question continued without pretending execution is paused',async()=>{
    await render({activeExecution:{...run,status:'running'},pendingQuestionCount:1,waitingQuestionCount:0});expect(container.querySelector('.is-awaiting-answer')).toBeNull();expect(container.querySelector('.is-running')).not.toBeNull();expect(container.querySelector(`[data-testid=node-status-${task.id}]`)?.getAttribute('data-state')).toBe('running');expect(container.querySelector(`[data-testid=node-answer-${task.id}]`)?.textContent).toBe('补充回答');
  });
});
