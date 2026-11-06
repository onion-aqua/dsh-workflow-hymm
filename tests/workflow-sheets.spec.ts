// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Inspector, PlanSheet, SettingsSheet } from '../src/client/WorkflowSheets.tsx';
import { TracePanel } from '../src/client/TracePanel.tsx';
import { WorkflowClient } from '../src/client/data.ts';
import { WorkflowRuntimeClient, type WorkflowRuntimeApi } from '../src/client/runtime-data.ts';
import { translateZh } from '../src/client/locales.ts';
import type { Workflow, WorkflowNode } from '../src/shared/model.ts';
import type { ExecutionCard, WorkflowRuntimeProps } from '../src/client/ui-contract.ts';

let root:Root; let container:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const fixtureTask:WorkflowNode={id:'test-only-task',title:'TEST fixture task',instruction:'TEST fixture instruction',source:'user',status:'draft',revision:1,position:{x:0,y:0}};
const fixtureWorkflow:Workflow={id:'test-only-workflow',name:'TEST fixture graph',schemaVersion:2,revision:1,nodes:[fixtureTask],edges:[],viewport:{x:0,y:0,zoom:1},createdAt:1,updatedAt:1};
function button(label:string){const found=[...container.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent?.includes(label));if(!found)throw new Error(`Missing ${label}`);return found;}
async function inspector(runtime:WorkflowRuntimeProps={},extra:Partial<Parameters<typeof Inspector>[0]>={}){await act(async()=>root.render(createElement(Inspector,{runtime,workflow:fixtureWorkflow,task:fixtureTask,runs:[],approved:false,hasExecution:false,title:fixtureTask.title,instruction:fixtureTask.instruction,onTitle:()=>{},onInstruction:()=>{},onSave:()=>{},onBeforeAction:()=>{},onClose:()=>{},onDelete:()=>{},onRemoveEdge:()=>{},onOpenTrace:()=>{},onSelectRun:()=>{},t:translateZh,...extra})));}

describe('Workflow execution and plan presentation',()=>{
  it('explains stale current results while leaving historical execution labels unchanged and active waits specific',async()=>{
    const execution:ExecutionCard={runId:'completed-before-upstream-change',nodeId:fixtureTask.id,nodeRevision:1,branchId:'branch',sessionId:'session',status:'completed',durability:'durable',createdAt:1,updatedAt:2};
    const staleTask:WorkflowNode={...fixtureTask,status:'completed',resultStale:true};
    await inspector({}, {task:staleTask,runs:[execution],selectedRun:execution,hasExecution:true});
    expect(container.querySelector('.wf-inspector-task-label .wf-tag')?.textContent).toBe('结果已过期');expect(container.querySelector('[data-testid="result-stale-notice"]')?.textContent).toContain('重跑');
    expect(container.querySelector('select')?.textContent).toContain('已完成');expect(execution.status).toBe('completed');
    await inspector({}, {task:staleTask,runs:[execution],selectedRun:execution,hasExecution:true,activeRun:{...execution,runId:'new-wait',status:'waiting',waitingReason:'stale_prerequisites'}});
    expect(container.querySelector('.wf-inspector-task-label .wf-tag')?.textContent).toBe('等待前置任务重跑');expect(container.querySelector('[data-testid="result-stale-notice"]')).toBeNull();
  });
  it('runs the current task version with one explicit action and no separate approval button',async()=>{
    const onApproveNode=vi.fn();const onRejectNode=vi.fn();const onRunNode=vi.fn();
    await inspector({onApproveNode,onRejectNode,onRunNode});
    expect(button('执行任务').disabled).toBe(false);
    expect(container.querySelector('[data-testid="approve-node"]')).toBeNull();
    await act(async()=>button('执行任务').click());
    expect(onRunNode).toHaveBeenCalledWith(fixtureTask.id,undefined);
    expect(onApproveNode).not.toHaveBeenCalled();expect(onRejectNode).not.toHaveBeenCalled();
  });
  it('allows history branching only from a completed durable execution and never exposes deletion of executed nodes',async()=>{
    const execution:ExecutionCard={runId:'test-only-run',nodeId:fixtureTask.id,nodeRevision:1,branchId:'test-only-branch',sessionId:'test-only-session',status:'completed',createdAt:1,updatedAt:2,durability:'pending'};
    const onForkExecution=vi.fn();
    await inspector({onForkExecution},{runs:[execution],selectedRun:execution,hasExecution:true});
    expect(button('从此处分支').disabled).toBe(true);
    expect(container.textContent).not.toContain('删除草稿');
    await inspector({onForkExecution},{runs:[{...execution,durability:'durable'}],selectedRun:{...execution,durability:'durable'},hasExecution:true});
    await act(async()=>button('从此处分支').click());
    expect(onForkExecution).toHaveBeenCalledWith(execution.runId,'新的工作方向');
  });
  it('accepts the reviewed plan selection without executing proposed tasks',async()=>{
    const onApplyPlan=vi.fn();const onRunNode=vi.fn();const onRejectPlan=vi.fn();
    const runtime:WorkflowRuntimeProps={onApplyPlan,onRunNode,onRejectPlan,plans:[{id:'test-only-plan',goal:'TEST fixture goal',status:'proposed',tasks:[{id:'test-only-a',title:'TEST A',instruction:'test A',dependencies:[]},{id:'test-only-b',title:'TEST B',instruction:'test B',dependencies:[]}]}]};
    await act(async()=>root.render(createElement(PlanSheet,{runtime,t:translateZh,onClose:()=>{},onBeforeAction:()=>{}})));
    const checkboxes=container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    await act(async()=>checkboxes[1]!.click());
    await act(async()=>button('添加所选任务').click());
    expect(onApplyPlan).toHaveBeenCalledWith('test-only-plan',['test-only-a']);
    expect(onRunNode).not.toHaveBeenCalled();
    await act(async()=>button('拒绝计划').click());
    expect(onRejectPlan).toHaveBeenCalledWith('test-only-plan');
  });
  it('marks omitted plan dependencies for review and only adds tasks after explicit confirmation',async()=>{
    const onApplyPlan=vi.fn(),onRunNode=vi.fn();
    const runtime:WorkflowRuntimeProps={onApplyPlan,onRunNode,plans:[{id:'missing-dependencies',goal:'TEST recovered proposal',status:'proposed',tasks:[{id:'a',title:'TEST missing dependency',instruction:'TEST inspect',dependencies:[],dependencyUnspecified:true},{id:'b',title:'TEST explicit dependency',instruction:'TEST summarize',dependencies:['a']}]}]};
    await act(async()=>root.render(createElement(PlanSheet,{runtime,t:translateZh,onClose:()=>{},onBeforeAction:()=>{}})));
    expect(container.querySelector('[data-testid="plan-dependency-warning-missing-dependencies"]')?.textContent).toContain('未返回依赖关系');
    expect(container.textContent).toContain('依赖未提供，待确认');expect(container.textContent).toContain('TEST missing dependency');
    expect(onApplyPlan).not.toHaveBeenCalled();expect(onRunNode).not.toHaveBeenCalled();
    await act(async()=>button('确认依赖并添加所选').click());
    expect(onApplyPlan).toHaveBeenCalledWith('missing-dependencies',['a','b']);expect(onRunNode).not.toHaveBeenCalled();
  });
  it('keeps explicit Run authorization clear across stored execution policy values',async()=>{
    await act(async()=>root.render(createElement(SettingsSheet,{runtime:{onChangePolicies:()=>{}},t:translateZh,onClose:()=>{}})));
    const policies=[...container.querySelectorAll<HTMLSelectElement>('select:not([hidden])')];
    expect(policies.flatMap(select=>[...select.options].map(option=>option.value))).toEqual(['manual','suggest','dynamic','manual','approval','auto']);
    expect(policies.map(select=>select.value)).toEqual(['suggest','approval']);
    expect(container.textContent).toContain('点击运行即允许执行当前任务版本');
    expect(container.textContent).not.toContain('批准');
  });
  it('keeps plan selections closed over prerequisites without executing them',async()=>{
    const onApplyPlan=vi.fn();const onRunNode=vi.fn();
    const runtime:WorkflowRuntimeProps={onApplyPlan,onRunNode,plans:[{id:'test-only-dependent-plan',goal:'TEST dependent plan',status:'proposed',tasks:[{id:'a',title:'TEST prerequisite',instruction:'TEST A',dependencies:[]},{id:'b',title:'TEST dependent',instruction:'TEST B',dependencies:['a']},{id:'c',title:'TEST transitive',instruction:'TEST C',dependencies:['b']}]}]};
    await act(async()=>root.render(createElement(PlanSheet,{runtime,t:translateZh,onClose:()=>{},onBeforeAction:()=>{}})));
    const choices=()=>[...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    await act(async()=>choices()[0]!.click());
    expect(choices().map(input=>input.checked)).toEqual([false,false,false]);
    await act(async()=>choices()[2]!.click());
    expect(choices().map(input=>input.checked)).toEqual([true,true,true]);
    await act(async()=>button('添加所选任务').click());
    expect(onApplyPlan).toHaveBeenCalledWith('test-only-dependent-plan',['a','b','c']);
    expect(onRunNode).not.toHaveBeenCalled();
  });
  it('locks task and planning edits during a pending native action',async()=>{
    await inspector({busy:true,onApproveNode:()=>{},onRunNode:()=>{}},{approved:true});
    expect(container.querySelector<HTMLInputElement>('[data-testid="node-title-input"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="node-instruction-input"]')!.disabled).toBe(true);
    expect(button('保存任务').disabled).toBe(true);
    expect(container.querySelector('[data-testid="approve-node"]')).toBeNull();
    expect(button('执行任务').disabled).toBe(true);
    await act(async()=>root.render(createElement(PlanSheet,{runtime:{busy:true,onGeneratePlan:()=>{}},t:translateZh,onClose:()=>{},onBeforeAction:()=>{}})));
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="plan-goal"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLSelectElement>('select')!.disabled).toBe(true);
  });
  it('keeps Run available as the explicit authorization action in automatic policy mode',async()=>{
    const onRunNode=vi.fn();await inspector({executionMode:'auto',onRunNode});
    expect(button('执行任务').disabled).toBe(false);
    await act(async()=>button('执行任务').click());expect(onRunNode).toHaveBeenCalledWith(fixtureTask.id,undefined);
  });
  it('shows the actual branch Session and directory, and explicitly marks directory data that has not been read',async()=>{
    await inspector({activeBranchId:'test-only-branch',branches:[{id:'test-only-branch',label:'TEST child',sessionId:'test-only-child-session',nodeIds:[fixtureTask.id]}],sessionRoots:[{sessionId:'test-only-child-session',title:'TEST child session',updatedAt:1,cwd:'C:/test-only/shared-workspace'}]});
    expect(container.querySelector('.wf-context-session-id')?.textContent).toBe('test-only-child-session');
    expect(container.querySelector('.wf-context-cwd')?.textContent).toBe('C:/test-only/shared-workspace');
    expect(container.textContent).toContain('工作目录可能共享，不复制文件');
    await inspector({}, {sessionId:'test-only-source-session',sessionRoot:{sessionId:'test-only-source-session',title:'TEST source',updatedAt:1}});
    expect(container.querySelector('.wf-context-session-id')?.textContent).toBe('test-only-source-session');
    expect(container.querySelector('.wf-context-cwd')?.textContent).toBe('尚未读取');
  });
  it('shows the selected automatic execution Session instead of its manual overview Session',async()=>{
    const execution:ExecutionCard={runId:'test-auto-run',nodeId:fixtureTask.id,nodeRevision:1,branchId:'test-auto',sessionId:'test-auto-session',status:'completed',createdAt:1,updatedAt:2};
    const runtime:WorkflowRuntimeProps={activeBranchId:'test-overview',branches:[{id:'test-overview',label:'TEST overview',sessionId:'test-overview-session',nodeIds:[fixtureTask.id]},{id:'test-auto',label:'TEST automatic',sessionId:'test-auto-session',parentBranchId:'test-overview',automatic:true,nodeIds:[fixtureTask.id]}],sessionRoots:[{sessionId:'test-overview-session',title:'TEST overview',updatedAt:1,cwd:'C:/test-only/overview'},{sessionId:'test-auto-session',title:'TEST automatic',updatedAt:1,cwd:'C:/test-only/execution'}]};
    await inspector(runtime,{runs:[execution],selectedRun:execution,hasExecution:true});
    expect(container.querySelector('.wf-context-session-id')?.textContent).toBe('test-auto-session');
    expect(container.querySelector('.wf-context-cwd')?.textContent).toBe('C:/test-only/execution');
    await inspector(runtime,{sessionId:'test-overview-session',runs:[execution],selectedRun:execution,hasExecution:true});
    expect(container.querySelector('.wf-context-session-id')?.textContent).toBe('test-overview-session');
  });
  it('displays the native context-isolation rejection in the trace instead of an empty or read-failure state',async()=>{
    const error='任务依赖来自不同的独立会话，当前原生 Fork 无法合并这些历史。本次未向 Agent 提交。';
    const graphs=new WorkflowClient({list:async()=>({ok:true,value:{workflows:[fixtureWorkflow]}}),create:vi.fn(),save:vi.fn()});
    const api={trace:vi.fn<WorkflowRuntimeApi['trace']>(async()=>({ok:true,value:{trace:{runId:'test-isolation-rejected',sessionId:'test-overview-session',status:'failed',steps:[],terminalReason:'context-isolation-required',error}}}))} as unknown as WorkflowRuntimeApi;
    const runtime=new WorkflowRuntimeClient(api,graphs);
    try{
      await graphs.load();await runtime.readTrace('test-isolation-rejected');
      const trace=runtime.getSnapshot().trace!;
      expect(trace.error).toBe(error);
      await act(async()=>root.render(createElement(TracePanel,{...trace,nodeTitle:fixtureTask.title,onClose:()=>{},t:translateZh})));
      expect(container.querySelector('.wf-trace-header .wf-tag')?.textContent).toBe('失败');
      expect(container.querySelector('.wf-trace-error strong')?.textContent).toBe('执行失败');
      expect(container.querySelector('.wf-trace-error p')?.textContent).toBe(error);
      expect(container.querySelector('[data-testid="trace-empty"]')).toBeNull();
      expect(container.textContent).not.toContain('无法读取执行记录');
      expect(container.querySelectorAll('.wf-trace-step')).toHaveLength(0);
    }finally{runtime.dispose();graphs.dispose();}
  });
  it('shows the terminal status of the current execution even when the task revision remains approved',async()=>{
    const run:ExecutionCard={runId:'test-only-failed-run',nodeId:fixtureTask.id,nodeRevision:1,branchId:'test-only-branch',sessionId:'test-only-session',status:'failed',createdAt:1,updatedAt:2};
    await inspector({}, {approved:true,runs:[run],selectedRun:run,hasExecution:true});
    expect(container.querySelector('.wf-inspector-task-label .wf-tag')?.textContent).toBe('失败');
  });
  it('uses real planning history and retains the composer draft until the requested plan is persisted',async()=>{
    const onGeneratePlan=vi.fn();
    const render=(runtime:WorkflowRuntimeProps)=>act(async()=>root.render(createElement(PlanSheet,{runtime,t:translateZh,onClose:()=>{},onBeforeAction:()=>{}})));
    await render({onGeneratePlan});
    expect(container.querySelector('.wf-plan-welcome')).not.toBeNull();
    expect(container.querySelector('.wf-plan-user-message')).toBeNull();
    const composer=container.querySelector<HTMLTextAreaElement>('[data-testid="plan-goal"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(composer,'TEST actual planning request');composer.dispatchEvent(new Event('input',{bubbles:true}));});
    await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="generate-plan"]')!.click());
    expect(onGeneratePlan).toHaveBeenCalledWith('TEST actual planning request',undefined);
    expect(composer.value).toBe('TEST actual planning request');
    expect(container.querySelector('.wf-plan-user-message')).toBeNull();
    await render({onGeneratePlan,plans:[{id:'test-only-persisted-plan',goal:'TEST actual planning request',status:'running',tasks:[]}]});
    expect(composer.value).toBe('');
    expect(container.querySelector('.wf-plan-user-message')?.textContent).toBe('TEST actual planning request');
    expect(container.querySelector('[role=status]')?.textContent).toContain('正在生成计划');
  });
  it('preserves the planning goal for a persisted unacknowledged or uncertain request and clears it after confirmed admission',async()=>{
    const onGeneratePlan=vi.fn(),goal='TEST retained goal after native admission failure',render=(runtime:WorkflowRuntimeProps)=>act(async()=>root.render(createElement(PlanSheet,{runtime,t:translateZh,onClose:()=>{},onBeforeAction:()=>{}})));
    await render({onGeneratePlan,runtimeReady:true,modelAvailable:true});const composer=container.querySelector<HTMLTextAreaElement>('[data-testid="plan-goal"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(composer,goal);composer.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="generate-plan"]')!.click());
    const plan={id:'test-unconfirmed-plan',goal,status:'running',submitted:false,tasks:[]};await render({onGeneratePlan,plans:[plan]});expect(composer.value).toBe(goal);
    await render({onGeneratePlan,plans:[{...plan,status:'needs-reconcile',error:'TEST native acknowledgement lost'}]});expect(composer.value).toBe(goal);expect(container.textContent).toContain('TEST native acknowledgement lost');
    await render({onGeneratePlan,plans:[{...plan,status:'failed',submitted:true,error:'TEST generation failed'}]});expect(composer.value).toBe(goal);
    await render({onGeneratePlan,plans:[{...plan,status:'proposed',submitted:true,tasks:[{id:'a',title:'TEST approved-only draft',instruction:'Inspect evidence',dependencies:[]}]}]});expect(composer.value).toBe('');expect(container.querySelector('[data-testid="accept-plan-test-unconfirmed-plan"]')).not.toBeNull();
  });
  it('disables planning Send during a real file-selection upload and re-enables it after the transfer settles',async()=>{
    let complete!:()=>void;const onUploadPlanningFiles=vi.fn<NonNullable<WorkflowRuntimeProps['onUploadPlanningFiles']>>(()=>new Promise<void>(resolve=>{complete=resolve;})),onGeneratePlan=vi.fn();
    await act(async()=>root.render(createElement(PlanSheet,{runtime:{generationMode:'manual',runtimeReady:true,modelAvailable:true,onGeneratePlan,onUploadPlanningFiles},t:translateZh,onClose:()=>{},onBeforeAction:()=>{}})));
    const composer=container.querySelector<HTMLTextAreaElement>('[data-testid="plan-goal"]')!,send=()=>container.querySelector<HTMLButtonElement>('[data-testid="generate-plan"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(composer,'TEST goal after attachment upload');composer.dispatchEvent(new Event('input',{bubbles:true}));});expect(send().disabled).toBe(false);
    const file=new File(['TEST raw uploaded file bytes'],'requirements.txt');await act(async()=>{const input=container.querySelector<HTMLInputElement>('[data-testid="file-input-planning"]')!;Object.defineProperty(input,'files',{value:[file],configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(onUploadPlanningFiles.mock.calls[0]![0]).toEqual([file]);expect(onUploadPlanningFiles.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);expect(send().disabled).toBe(true);await act(async()=>send().click());expect(onGeneratePlan).not.toHaveBeenCalled();
    await act(async()=>complete());expect(send().disabled).toBe(false);await act(async()=>send().click());expect(onGeneratePlan).toHaveBeenCalledExactlyOnceWith('TEST goal after attachment upload',undefined);
  });

});
