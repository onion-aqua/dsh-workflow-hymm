// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskNode, type TaskFlowNode, type TaskNodeData } from '../src/client/TaskNode.tsx';
import { ContextMenu, type ContextAction } from '../src/client/ContextMenu.tsx';
import { WorkflowPicker } from '../src/client/WorkflowPicker.tsx';
import { copyTaskText, createTaskDraft, readTaskClipboard } from '../src/client/node-clipboard.ts';
import { executionIsActive } from '../src/client/graph.ts';
import { translateZh } from '../src/client/locales.ts';
import type { WorkflowNode } from '../src/shared/model.ts';
import type { ExecutionCard } from '../src/client/ui-contract.ts';

let root:Root;let container:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
const task:WorkflowNode={id:'test-inline-task',title:'TEST task title',instruction:'TEST instruction',source:'user',status:'draft',revision:1,position:{x:40,y:50}};
async function renderNode(extra:Partial<TaskNodeData>={}){
  const data:TaskNodeData={task,order:0,focused:true,collapsed:false,t:translateZh,onMenu:()=>{},...extra};
  await act(async()=>root.render(createElement(ReactFlowProvider,null,createElement(TaskNode,{id:task.id,type:'task',data,dragging:false,selected:true,isConnectable:true,zIndex:0,positionAbsoluteX:40,positionAbsoluteY:50,selectable:true,deletable:true,draggable:true} as NodeProps<TaskFlowNode>))));
}

describe('Inline task editing and canvas context actions',()=>{
  it('keeps the complete Markdown question when collapsed and hides response, files, footer and resize controls',async()=>{
    const question='## TEST question\n\n**Important requirement**\n\n'+Array.from({length:30},(_,index)=>`- TEST detail ${index}`).join('\n');await renderNode({task:{...task,instruction:question,answerSummary:'TEST answer must stay hidden'},collapsed:true});const questionElement=container.querySelector(`[data-testid="node-instruction-${task.id}"]`)!;expect(questionElement.textContent).toContain('TEST detail 29');expect(questionElement.querySelector('h2')?.textContent).toBe('TEST question');expect(questionElement.querySelector('strong')?.textContent).toBe('Important requirement');expect(container.querySelector('.wf-task.is-collapsed')).not.toBeNull();expect(container.querySelector('.wf-answer-summary')).toBeNull();expect(container.querySelector('.wf-node-files')).toBeNull();expect(container.querySelector('.wf-node-model-bubble')).toBeNull();expect(container.querySelector(`[data-testid="node-resize-${task.id}"]`)).toBeNull();await renderNode({task:{...task,instruction:question,answerSummary:'TEST answer must stay hidden'},collapsed:false});expect(container.querySelector('.wf-answer-summary')?.textContent).toContain('TEST answer must stay hidden');expect(container.querySelector('.wf-node-model-bubble')).not.toBeNull();expect(container.querySelector(`[data-testid="node-resize-${task.id}"]`)).not.toBeNull();
  });
  it('edits the actual header name once, selects the body on click, and opens the large editor on double-click',async()=>{
    const onStartEditing=vi.fn();const onOpenTextEditor=vi.fn();await renderNode({onStartEditing,onOpenTextEditor});
    await act(async()=>container.querySelector<HTMLElement>(`[data-testid="node-title-${task.id}"]`)!.click());
    expect(onStartEditing).toHaveBeenCalledWith(task.id,'title');
    await act(async()=>container.querySelector<HTMLElement>(`[data-testid="node-instruction-${task.id}"]`)!.click());
    expect(onStartEditing).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.wf-task-body h3')).toBeNull();
    expect(container.querySelector('.wf-task-heading')?.textContent).toBe(task.title);
    await act(async()=>container.querySelector<HTMLElement>(`[data-testid="node-instruction-${task.id}"]`)!.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));
    expect(onOpenTextEditor).toHaveBeenCalledWith(task.id);
    expect(container.querySelector('.wf-task-top')!.classList.contains('nodrag')).toBe(false);
  });
  it('uses the top-right button to toggle folding directly and opens a distinct disconnect menu from each port',async()=>{
    const onCollapse=vi.fn(),onPortMenu=vi.fn(),onMenu=vi.fn();await renderNode({onCollapse,onPortMenu,onMenu});const toggle=container.querySelector<HTMLButtonElement>(`[data-testid="node-collapse-${task.id}"]`)!;expect(toggle.getAttribute('aria-expanded')).toBe('true');await act(async()=>toggle.click());expect(onCollapse).toHaveBeenCalledExactlyOnceWith(task.id);expect(onMenu).not.toHaveBeenCalled();expect(container.querySelector(`[data-testid="node-menu-${task.id}"]`)).toBeNull();
    for(const [port,direction] of [['target','input'],['source','output']]as const){const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:50,clientY:60});await act(async()=>container.querySelector(`[data-testid="${port}-handle-${task.id}"]`)!.dispatchEvent(event));expect(event.defaultPrevented).toBe(true);expect(onPortMenu).toHaveBeenLastCalledWith(task.id,direction,expect.objectContaining({clientX:50,clientY:60}));}
  });
  it('commits on leaving the editor or Ctrl+Enter, cancels on Escape, and respects IME composition',async()=>{
    const onCommitEditing=vi.fn();const onCancelEditing=vi.fn();
    await renderNode({editingField:'title',editTitle:task.title,editInstruction:task.instruction,onCommitEditing,onCancelEditing});
    const title=container.querySelector<HTMLInputElement>(`[data-testid="inline-title-${task.id}"]`)!;
    expect(document.activeElement).toBe(title);
    expect(container.querySelector('textarea')).toBeNull();
    expect(title.closest('.wf-task-top')).not.toBeNull();
    await act(async()=>title.dispatchEvent(new FocusEvent('focusout',{bubbles:true,relatedTarget:document.body})));
    expect(onCommitEditing).toHaveBeenCalledTimes(1);
    await act(async()=>title.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',ctrlKey:true})));
    expect(onCommitEditing).toHaveBeenCalledTimes(2);
    await act(async()=>title.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Escape',isComposing:true})));
    expect(onCancelEditing).not.toHaveBeenCalled();
    await act(async()=>title.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Escape'})));
    expect(onCancelEditing).toHaveBeenCalledOnce();
    const contextEvent=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});
    await act(async()=>title.dispatchEvent(contextEvent));expect(contextEvent.defaultPrevented).toBe(false);
  });
  it('keeps native source nodes and actively executing tasks out of inline editing',async()=>{
    const onStartEditing=vi.fn();const onOpenTextEditor=vi.fn();
    await renderNode({task:{...task,kind:'session',sourceSessionId:'test-native-source'},editingField:'title',onStartEditing,onOpenTextEditor});
    expect(container.querySelector('input')).toBeNull();
    await act(async()=>container.querySelector<HTMLElement>(`[data-testid="node-title-${task.id}"]`)!.click());expect(onStartEditing).not.toHaveBeenCalled();
    await act(async()=>container.querySelector('p')!.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));expect(onOpenTextEditor).toHaveBeenCalledWith(task.id);
    await renderNode({editLocked:true,editingField:'instruction',onStartEditing,onOpenTextEditor});
    expect(container.querySelector('textarea')).toBeNull();
    await act(async()=>container.querySelector('p')!.click());expect(onStartEditing).not.toHaveBeenCalled();
    await act(async()=>container.querySelector('p')!.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));expect(onOpenTextEditor).toHaveBeenCalledTimes(2);
    const run:ExecutionCard={runId:'test-run',nodeId:task.id,nodeRevision:1,branchId:'test-branch',sessionId:'test-session',status:'blocked',createdAt:1,updatedAt:2};
    expect(executionIsActive(run)).toBe(true);
    expect(executionIsActive({...run,endSeq:18,durability:'durable'})).toBe(false);
  });
  it('copies text only and creates a fresh unapproved Draft without Sessions, executions or dependencies',()=>{
    const source={...task,status:'completed',sourceSessionId:'test-session',branchIds:['test-branch'],answerSummary:'TEST answer',revisions:[{revision:1,title:'TEST',instruction:'TEST',dependencies:['test-prerequisite'],createdAt:1}]} as WorkflowNode;
    copyTaskText(source);const content=readTaskClipboard()!;
    expect(Object.keys(content).sort()).toEqual(['instruction','title']);
    const draft=createTaskDraft(content,{x:900,y:700});
    expect(draft).toMatchObject({title:task.title,instruction:task.instruction,status:'draft',revision:1,source:'user',position:{x:900,y:700}});
    expect(draft.id).not.toBe(task.id);expect(draft.sourceSessionId).toBeUndefined();expect(draft.branchIds).toBeUndefined();expect(draft.revisions).toBeUndefined();expect(draft.answerSummary).toBeUndefined();
  });
  it('portals and bounds the menu, navigates enabled actions, preserves focus across renders, and closes outside or on Escape',async()=>{
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){return {x:0,y:0,left:0,top:0,right:this===container?320:228,bottom:this===container?300:180,width:this===container?320:228,height:this===container?300:180,toJSON:()=>({})};});
    const onClose=vi.fn();const selected=vi.fn();const actions:ContextAction[]=[{id:'first',label:'TEST first',icon:'copy',onSelect:selected},{id:'disabled',label:'TEST disabled',icon:'trash',disabled:true,onSelect:()=>{}},{id:'last',label:'TEST last',icon:'edit',onSelect:()=>{}}];
    const render=()=>act(async()=>root.render(createElement(ContextMenu,{container,x:310,y:290,actions,onClose:()=>onClose()})));
    await render();const menu=container.querySelector<HTMLDivElement>('[role=menu]')!;
    expect(menu.parentElement).toBe(container);expect(menu.style.left).toBe('84px');expect(menu.style.top).toBe('112px');
    expect(document.activeElement?.textContent).toBe('TEST first');
    await act(async()=>menu.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'ArrowDown'})));
    expect(document.activeElement?.textContent).toBe('TEST last');
    await render();expect(document.activeElement?.textContent).toBe('TEST last');
    await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Escape'})));expect(onClose).toHaveBeenCalledOnce();
    await act(async()=>document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));expect(onClose).toHaveBeenCalledTimes(2);
    await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="context-first"]')!.click());expect(selected).toHaveBeenCalledOnce();expect(onClose).toHaveBeenCalledTimes(3);
  });
  it('uses a node Run button and actual running or waiting state without a separate approval step',async()=>{
    const onRunNode=vi.fn();const onCancelNode=vi.fn();await renderNode({onRunNode,onCancelNode});
    await act(async()=>container.querySelector<HTMLButtonElement>(`[data-testid="node-run-${task.id}"]`)!.click());
    expect(onRunNode).toHaveBeenCalledWith(task.id);expect(container.querySelector('.wf-task-bottom')).toBeNull();
    expect(container.querySelector(`[data-testid="node-resize-${task.id}"]`)).not.toBeNull();
    const run:ExecutionCard={runId:'test-only-live-run',nodeId:task.id,nodeRevision:1,branchId:'test-branch',sessionId:'test-session',status:'running',createdAt:1,updatedAt:2};
    await renderNode({activeExecution:run,onRunNode,onCancelNode});
    expect(container.querySelector('.wf-task.is-running .wf-running-perimeter rect')).not.toBeNull();
    await act(async()=>container.querySelector<HTMLButtonElement>(`[data-testid="node-stop-${task.id}"]`)!.click());expect(onCancelNode).toHaveBeenCalledWith(run.runId);
    await renderNode({activeExecution:{...run,status:'waiting',waitingReason:'prerequisites'},onRunNode,onCancelNode});
    expect(container.querySelector('.wf-running-perimeter')).toBeNull();
    expect(container.querySelector(`[data-testid="node-status-${task.id}"]`)?.textContent).toBe('等待前置任务');
    expect(container.querySelector(`[data-testid="node-stop-${task.id}"]`)?.getAttribute('aria-label')).toBe('取消等待');
    await renderNode({activeExecution:{...run,status:'waiting',waitingReason:'branch_busy'},onRunNode,onCancelNode});
    expect(container.querySelector(`[data-testid="node-status-${task.id}"]`)?.textContent).toBe('等待执行');
    await renderNode({task:{...task,status:'ready'},onRunNode,onCancelNode});
    expect(container.querySelector(`[data-testid="node-status-${task.id}"]`)?.textContent).toBe('草稿');
  });
  it('marks only a current actual failed Execution and keeps multi-selection independent from trace focus',async()=>{
    const run:ExecutionCard={runId:'test-failed-run',nodeId:task.id,nodeRevision:1,branchId:'test-branch',sessionId:'test-session',status:'failed',createdAt:1,updatedAt:2};
    await renderNode({task:{...task,status:'failed'},focused:false,selected:true});
    expect(container.querySelector('.wf-task.is-selected')).not.toBeNull();expect(container.querySelector('.wf-task.is-focused')).toBeNull();expect(container.querySelector('.wf-task.is-failed')).toBeNull();
    await renderNode({execution:run});expect(container.querySelector('.wf-task.is-failed')).not.toBeNull();expect(container.querySelector('.wf-running-perimeter')).toBeNull();
    await renderNode({execution:{...run,status:'cancelled'}});expect(container.querySelector('.wf-task.is-failed')).toBeNull();
    await renderNode({execution:{...run,nodeRevision:0}});expect(container.querySelector('.wf-task.is-failed')).toBeNull();
    await renderNode({execution:run,activeExecution:{...run,runId:'test-new-run',status:'running'}});expect(container.querySelector('.wf-task.is-failed')).toBeNull();expect(container.querySelector('.wf-running-perimeter')).not.toBeNull();
  });
  it('marks a completed current result as stale while retaining its answer and prioritizing active execution state',async()=>{
    const run:ExecutionCard={runId:'stale-result-run',nodeId:task.id,nodeRevision:1,branchId:'branch',sessionId:'session',status:'completed',createdAt:1,updatedAt:2,summary:'TEST preserved historical answer'};
    await renderNode({task:{...task,status:'completed',resultStale:true},execution:run});
    const status=()=>container.querySelector(`[data-testid="node-status-${task.id}"]`)!;
    expect(status().getAttribute('data-state')).toBe('stale');expect(status().textContent).toBe('结果已过期');expect(status().getAttribute('title')).toContain('重跑');
    expect(container.querySelector('.wf-answer-summary')?.textContent).toContain('TEST preserved historical answer');expect(run.status).toBe('completed');
    await renderNode({task:{...task,status:'completed',resultStale:true},execution:run,activeExecution:{...run,runId:'fresh-run',status:'running'}});
    expect(status().getAttribute('data-state')).toBe('running');expect(container.querySelector('.wf-running-perimeter')).not.toBeNull();
    await renderNode({task:{...task,status:'completed',resultStale:true},execution:run,activeExecution:{...run,runId:'waiting-fresh-run',status:'waiting',waitingReason:'stale_prerequisites'}});
    expect(status().getAttribute('data-state')).toBe('waiting');expect(status().textContent).toBe('等待前置任务重跑');
    await renderNode({task:{...task,status:'completed',resultStale:false},execution:run});expect(status().getAttribute('data-state')).toBe('completed');
  });
  it('selects workflows through the custom list with keyboard support and closes on Escape or outside click',async()=>{
    const onSelect=vi.fn();await act(async()=>root.render(createElement(WorkflowPicker,{options:[{id:'a',name:'TEST A'},{id:'b',name:'TEST B'}],value:'a',onSelect,t:translateZh})));
    const picker=container.querySelector<HTMLButtonElement>('[data-testid="workflow-picker"]')!;
    await act(async()=>picker.click());expect(picker.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-testid="workflow-option-a"]')?.getAttribute('aria-selected')).toBe('true');
    const options=container.querySelector('[role=listbox]')!;
    await act(async()=>options.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'End'})));
    expect(document.activeElement?.textContent).toBe('TEST B');
    await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="workflow-option-b"]')!.click());expect(onSelect).toHaveBeenCalledWith('b');
    expect(picker.getAttribute('aria-expanded')).toBe('false');
    await act(async()=>picker.click());await act(async()=>container.querySelector('[role=listbox]')!.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Escape'})));expect(picker.getAttribute('aria-expanded')).toBe('false');
    await act(async()=>picker.click());await act(async()=>document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));expect(picker.getAttribute('aria-expanded')).toBe('false');
  });
});
