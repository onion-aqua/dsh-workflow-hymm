// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '../src/shared/model.ts';
import type { SubagentMode } from '../src/client/ui-contract.ts';

const harness=vi.hoisted(()=>({nodes:[] as any[],props:{} as any}));
vi.mock('@xyflow/react',async()=>{
  const React=await import('react');
  return {useStoreApi:()=>({getState:()=>({nodeLookup:new Map()})}),useConnection:(select:any)=>select({inProgress:false}),ReactFlowProvider:({children}:any)=>children,ReactFlow:(props:any)=>{harness.props=props;harness.nodes=props.nodes;return React.createElement('div',{'data-testid':'flow-test'},...props.nodes.map((node:any)=>React.createElement('div',{'data-testid':`test-node-${node.id}`,key:node.id},node.data.task.title)));},Background:()=>null,BackgroundVariant:{Dots:'dots'},Controls:()=>null,MiniMap:()=>null,MarkerType:{ArrowClosed:'closed'},ConnectionLineType:{Bezier:'bezier'},SelectionMode:{Partial:'partial'},applyNodeChanges:(_changes:any,nodes:any)=>nodes,useNodes:()=>[],useViewport:()=>({x:0,y:0,zoom:1}),useReactFlow:()=>({screenToFlowPosition:(p:any)=>p,getZoom:()=>1,fitView:vi.fn(),getInternalNode:()=>undefined})};
});
vi.mock('../src/client/TaskNode.tsx',()=>({TaskNode:()=>null,executionStatusText:()=>''}));
vi.mock('../src/client/WorkflowEdge.tsx',()=>({workflowEdgeTypes:{},WorkflowConnectionLine:()=>null}));
vi.mock('../src/client/NodeTextEditor.tsx',()=>({NodeTextEditor:()=>null}));
vi.mock('../src/client/WorkflowSheets.tsx',()=>({PlanSheet:()=>null,SettingsSheet:()=>null,Inspector:()=>null}));
import { SubagentModePicker, WorkflowPanel } from '../src/client/WorkflowPanel.tsx';
import type { WorkflowPanelProps } from '../src/client/WorkflowPanel.tsx';
import { en, translateZh } from '../src/client/locales.ts';

let root:Root,container:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const button=(testId:string)=>container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
const click=(testId:string)=>act(async()=>button(testId).click());
async function renderPicker(extra:Partial<Parameters<typeof SubagentModePicker>[0]>={}){await act(async()=>root.render(createElement(SubagentModePicker,{onChange:()=>{},t:translateZh,...extra})));}
async function key(element:Element,value:string){const event=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:value});await act(async()=>element.dispatchEvent(event));return event;}

describe('Subagent mode menu',()=>{
  it('defaults to off without a policy write and shows three independent radio choices',async()=>{
    const onChange=vi.fn();await renderPicker({onChange});expect(button('subagent-mode-trigger').textContent).toBe('子智能体关闭');expect(onChange).not.toHaveBeenCalled();await click('subagent-mode-trigger');expect(container.querySelectorAll('[role=menuitemradio]')).toHaveLength(3);expect(button('subagent-mode-off').getAttribute('aria-checked')).toBe('true');expect(button('subagent-mode-on').getAttribute('aria-checked')).toBe('false');expect(button('subagent-mode-auto').textContent).toBe('自动决定');
  });
  it('saves before switching and keeps the menu and draft when saving is rejected',async()=>{
    const calls:string[]=[],onBeforeAction=vi.fn(()=>{calls.push('save');return false;}),onChange=vi.fn(()=>{calls.push('change');});await renderPicker({onBeforeAction,onChange});await click('subagent-mode-trigger');await click('subagent-mode-on');expect(onBeforeAction).toHaveBeenCalledOnce();expect(onChange).not.toHaveBeenCalled();expect(container.querySelector('[role=menu]')).not.toBeNull();onBeforeAction.mockImplementation(()=>{calls.push('save');return true;});await click('subagent-mode-on');expect(calls).toEqual(['save','save','change']);expect(onChange).toHaveBeenCalledExactlyOnceWith('on');expect(container.querySelector('[role=menu]')).toBeNull();expect(document.activeElement).toBe(button('subagent-mode-trigger'));
  });
  it('supports keyboard navigation, selection, Escape and Tab with focus restoration',async()=>{
    const onChange=vi.fn();await renderPicker({onChange});const trigger=button('subagent-mode-trigger');await key(trigger,'Enter');expect(document.activeElement).toBe(button('subagent-mode-off'));await key(document.activeElement!,'ArrowDown');expect(document.activeElement).toBe(button('subagent-mode-on'));await key(document.activeElement!,'ArrowUp');expect(document.activeElement).toBe(button('subagent-mode-off'));await key(document.activeElement!,'End');expect(document.activeElement).toBe(button('subagent-mode-auto'));await key(document.activeElement!,'Home');expect(document.activeElement).toBe(button('subagent-mode-off'));await key(document.activeElement!,'ArrowUp');expect(document.activeElement).toBe(button('subagent-mode-auto'));await key(document.activeElement!,' ');expect(onChange).toHaveBeenCalledExactlyOnceWith('auto');expect(document.activeElement).toBe(trigger);await key(trigger,'ArrowUp');expect(document.activeElement).toBe(button('subagent-mode-auto'));await key(document.activeElement!,'Escape');expect(container.querySelector('[role=menu]')).toBeNull();expect(document.activeElement).toBe(trigger);await key(trigger,'ArrowDown');const tab=await key(document.activeElement!,'Tab');expect(tab.defaultPrevented).toBe(false);expect(container.querySelector('[role=menu]')).toBeNull();
  });
  it('closes on an outside pointer, disables an open menu and leaves an unchanged mode untouched',async()=>{
    const onChange=vi.fn(),onBeforeAction=vi.fn(()=>true);await renderPicker({onChange,onBeforeAction});await click('subagent-mode-trigger');await click('subagent-mode-off');expect(onBeforeAction).not.toHaveBeenCalled();expect(onChange).not.toHaveBeenCalled();await click('subagent-mode-trigger');await act(async()=>document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));expect(container.querySelector('[role=menu]')).toBeNull();await click('subagent-mode-trigger');await renderPicker({disabled:true,onChange});expect(button('subagent-mode-trigger').disabled).toBe(true);expect(container.querySelector('[role=menu]')).toBeNull();await click('subagent-mode-trigger');expect(container.querySelector('[role=menu]')).toBeNull();await renderPicker({onChange:undefined});expect(button('subagent-mode-trigger').disabled).toBe(true);
  });
  it('localizes the trigger and all choices and ignores IME key events',async()=>{
    await renderPicker({mode:'auto',t:key=>en[key]});expect(button('subagent-mode-trigger').getAttribute('aria-label')).toBe('Subagents: Automatic');expect(button('subagent-mode-trigger').title).toContain('main path is busy');await act(async()=>button('subagent-mode-trigger').dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',isComposing:true})));expect(container.querySelector('[role=menu]')).toBeNull();await click('subagent-mode-trigger');expect(button('subagent-mode-off').textContent).toBe('Off');expect(button('subagent-mode-on').textContent).toBe('On');expect(button('subagent-mode-on').title).toContain('up to 3');expect(button('subagent-mode-auto').getAttribute('aria-checked')).toBe('true');
  });
});

describe('Panel subagent policy and draft coordination',()=>{
  const task:WorkflowNode={id:'draft-task',title:'TEST task',instruction:'TEST original',source:'user',status:'draft',revision:1,position:{x:0,y:0}};
  const initial=():Workflow=>({id:'subagents-ui',name:'TEST policy',schemaVersion:2,revision:1,nodes:[{...task}],edges:[],viewport:{x:0,y:0,zoom:1},createdAt:1,updatedAt:1});
  it('commits the selected task draft before changing policy and blocks actual text conflicts',async()=>{
    let current=initial(),mode:SubagentMode='off';const order:string[]=[];
    const onMode=vi.fn((value:SubagentMode)=>{expect(current.nodes[0]?.instruction).toBe('TEST preserved instruction');order.push('mode');mode=value;renderNow();});
    const renderNow=()=>root.render(createElement(WorkflowPanel,{workflows:[current],activeWorkflowId:current.id,loading:false,saveState:'saved',catalogMode:false,subagentMode:mode,onChangeSubagentMode:onMode,onSelectWorkflow:()=>{},onCreateWorkflow:()=>{},onRenameWorkflow:()=>{},onChangeWorkflow:next=>{order.push('save');current=next;renderNow();},onRetry:()=>{}}));
    await act(async()=>renderNow());await act(async()=>harness.props.onNodeClick({target:container.querySelector('[data-testid="test-node-draft-task"]')},harness.nodes[0]));await act(async()=>harness.nodes[0].data.onInstructionChange('TEST preserved instruction'));await click('subagent-mode-trigger');await click('subagent-mode-on');expect(order).toEqual(['save','mode']);expect(onMode).toHaveBeenCalledExactlyOnceWith('on');
    await act(async()=>harness.nodes[0].data.onInstructionChange('TEST conflicting local draft'));current={...current,nodes:[{...current.nodes[0]!,instruction:'TEST native change',revision:2}]};await act(async()=>renderNow());await click('subagent-mode-trigger');await click('subagent-mode-auto');expect(onMode).toHaveBeenCalledTimes(1);expect(container.textContent).toContain('草稿已保留');expect(container.querySelector('[role=menu]')).not.toBeNull();
  });
  it('keeps the independent top-right policy disabled in the catalog or while busy',async()=>{
    const current=initial(),onChangeSubagentMode=vi.fn();const base:WorkflowPanelProps={workflows:[current],activeWorkflowId:current.id,loading:false,saveState:'saved',onChangeSubagentMode,onSelectWorkflow:()=>{},onCreateWorkflow:()=>{},onRenameWorkflow:()=>{},onChangeWorkflow:()=>{},onRetry:()=>{}};
    for(const extra of [{catalogMode:true},{catalogMode:false,busy:true}]){await act(async()=>root.render(createElement(WorkflowPanel,{...base,...extra})));expect(button('subagent-mode-trigger').disabled).toBe(true);await click('subagent-mode-trigger');expect(container.querySelector('[role=menu]')).toBeNull();}expect(onChangeSubagentMode).not.toHaveBeenCalled();expect(button('subagent-mode-trigger').closest('.wf-studio-top')).not.toBeNull();
  });
});
