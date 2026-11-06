// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskNode, type TaskFlowNode } from '../src/client/TaskNode.tsx';
import { en, translateZh, type Translate } from '../src/client/locales.ts';
import type { WorkflowNode } from '../src/shared/model.ts';
import type { ExecutionCard } from '../src/client/ui-contract.ts';

let root:Root,container:HTMLDivElement;
const task:WorkflowNode={id:'capacity-task',title:'TEST task',instruction:'TEST instruction',source:'user',status:'draft',revision:1,position:{x:0,y:0}};
const run:ExecutionCard={runId:'capacity-run',nodeId:task.id,nodeRevision:1,branchId:'branch',sessionId:'child-session',status:'waiting',waitingReason:'subagent_capacity',createdAt:1,updatedAt:1};
const translateEn:Translate=(key,values)=>Object.entries(values??{}).reduce((text,[name,value])=>text.replaceAll(`{${name}}`,String(value)),en[key]);
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
async function render(t:Translate,activeExecution:ExecutionCard,onCancelNode=vi.fn()){
  await act(async()=>root.render(createElement(ReactFlowProvider,null,createElement(TaskNode,{id:task.id,type:'task',data:{task,order:0,focused:false,collapsed:false,t,onMenu:()=>{},activeExecution,onCancelNode},dragging:false,selected:false,isConnectable:true,zIndex:0,positionAbsoluteX:0,positionAbsoluteY:0,selectable:true,deletable:true,draggable:true} as NodeProps<TaskFlowNode>))));
}
describe('Subagent capacity waiting label',()=>{
  it.each([[translateZh,'等待子智能体空位'],[translateEn,'Waiting for a subagent slot']] as const)('localizes capacity waiting and retains its cancel action',async(t,label)=>{
    const onCancelNode=vi.fn();await render(t,run,onCancelNode);expect(container.querySelector(`[data-testid="node-status-${task.id}"]`)?.textContent).toBe(label);const stop=container.querySelector<HTMLButtonElement>(`[data-testid="node-stop-${task.id}"]`)!;expect(stop.getAttribute('aria-label')).toBe(t('cancelWaiting'));await act(async()=>stop.click());expect(onCancelNode).toHaveBeenCalledExactlyOnceWith(run.runId);expect(container.querySelector('.wf-running-perimeter')).toBeNull();
  });
  it.each([[translateZh,'等待子智能体服务恢复'],[translateEn,'Waiting for the subagent service to recover']] as const)('distinguishes an unavailable provider from capacity waiting and retains cancellation',async(t,label)=>{
    const onCancelNode=vi.fn();await render(t,{...run,waitingReason:'subagent_unavailable'},onCancelNode);const status=()=>container.querySelector(`[data-testid="node-status-${task.id}"]`)?.textContent;expect(status()).toBe(label);expect(status()).not.toBe(t('waitingSubagentCapacity'));expect(container.querySelector(`[data-testid="node-run-${task.id}"]`)).toBeNull();const stop=container.querySelector<HTMLButtonElement>(`[data-testid="node-stop-${task.id}"]`)!;expect(stop.getAttribute('aria-label')).toBe(t('cancelWaiting'));await act(async()=>stop.click());expect(onCancelNode).toHaveBeenCalledExactlyOnceWith(run.runId);await render(t,{...run,status:'running',waitingReason:'subagent_unavailable'});expect(status()).toBe(t('running'));
  });
  it('preserves all existing waiting reasons and prioritizes native running and approval states',async()=>{
    const status=()=>container.querySelector(`[data-testid="node-status-${task.id}"]`)?.textContent;
    for(const [waitingReason,label] of [['prerequisites','等待前置任务'],['stale_prerequisites','等待前置任务重跑'],['branch_busy','等待执行']] as const){await render(translateZh,{...run,waitingReason});expect(status()).toBe(label);}
    await render(translateZh,{...run,status:'running'});expect(status()).toBe('运行中');await render(translateZh,{...run,status:'blocked'});expect(status()).toBe('等待审批');
  });
});
