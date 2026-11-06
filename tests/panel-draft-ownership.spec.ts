// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '../src/shared/model.ts';

const harness=vi.hoisted(()=>({nodes:[] as any[],props:{} as any}));
vi.mock('@xyflow/react',async()=>{
  const React=await import('react');
  return {useStoreApi:()=>({getState:()=>({nodeLookup:new Map()})}),useConnection:(select:any)=>select({inProgress:false}),ReactFlowProvider:({children}:any)=>children,ReactFlow:(props:any)=>{harness.props=props;harness.nodes=props.nodes;return React.createElement('div',{'data-testid':'flow-test'},...props.nodes.map((node:any)=>React.createElement('div',{'data-testid':`test-node-${node.id}`,key:node.id},node.data.task.title)));},Background:()=>null,BackgroundVariant:{Dots:'dots'},Controls:()=>null,MiniMap:()=>null,MarkerType:{ArrowClosed:'closed'},ConnectionLineType:{Bezier:'bezier'},SelectionMode:{Partial:'partial'},applyNodeChanges:(_changes:any,nodes:any)=>nodes,useNodes:()=>[],useViewport:()=>({x:0,y:0,zoom:1}),useReactFlow:()=>({screenToFlowPosition:(p:any)=>p,getZoom:()=>1,fitView:vi.fn(),getInternalNode:()=>undefined})};
});
vi.mock('../src/client/TaskNode.tsx',()=>({TaskNode:()=>null,executionStatusText:()=>''}));
vi.mock('../src/client/WorkflowEdge.tsx',()=>({workflowEdgeTypes:{},WorkflowConnectionLine:()=>null}));
vi.mock('../src/client/NodeTextEditor.tsx',async()=>{const React=await import('react');return {NodeTextEditor:(props:any)=>React.createElement('div',{'data-testid':'test-text-editor','data-title':props.title},props.instruction)};});
vi.mock('../src/client/WorkflowSheets.tsx',async()=>{const React=await import('react');return {PlanSheet:()=>null,SettingsSheet:()=>null,Inspector:(props:any)=>React.createElement('div',{'data-testid':'test-inspector'},React.createElement('input',{'data-testid':'test-title-input',value:props.title,onChange:(event:any)=>props.onTitle(event.target.value)}),React.createElement('textarea',{'data-testid':'test-instruction-input',value:props.instruction,onChange:(event:any)=>props.onInstruction(event.target.value)}),React.createElement('button',{'data-testid':'test-save',onClick:props.onSave},'Save'))};});
import { WorkflowPanel } from '../src/client/WorkflowPanel.tsx';

let root:Root,container:HTMLDivElement,current:Workflow;let changes:Workflow[];
const task=(id:string):WorkflowNode=>({id,title:`TEST ${id} title`,instruction:`TEST ${id} instruction`,source:'user',status:'draft',revision:1,position:{x:0,y:0}});
const initial=():Workflow=>({id:'ownership-test',name:'TEST workflow',schemaVersion:2,revision:1,nodes:[task('a'),task('b')],edges:[],viewport:{x:0,y:0,zoom:1},createdAt:1,updatedAt:1});
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});container=document.createElement('div');document.body.append(container);root=createRoot(container);current=initial();changes=[];});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
function renderNow(){root.render(createElement(WorkflowPanel,{workflows:[current],activeWorkflowId:current.id,loading:false,saveState:'saved',catalogMode:false,onSelectWorkflow:()=>{},onCreateWorkflow:()=>{},onRenameWorkflow:()=>{},onChangeWorkflow:next=>{changes.push(next);current=next;renderNow();},onRetry:()=>{}}));}
const render=()=>act(async()=>renderNow());
function clickNow(id:string){const node=harness.nodes.find(node=>node.id===id);harness.props.onNodeClick({target:container.querySelector(`[data-testid="test-node-${id}"]`)},node);}
const click=(id:string)=>act(async()=>clickNow(id));
function openNow(id:string){harness.nodes.find(node=>node.id===id).data.onOpenTextEditor(id);}
async function changeInput(testId:string,text:string){await act(async()=>{const element=container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,text);element.dispatchEvent(new Event('input',{bubbles:true}));});}

describe('Canvas editor draft ownership',()=>{
  it('opens the first double-click after mount and remount without saving an empty or unrelated title',async()=>{
    await render();await act(async()=>{clickNow('a');openNow('a');});expect(container.querySelector('[data-testid="test-text-editor"]')?.getAttribute('data-title')).toBe('TEST a title');expect(changes).toEqual([]);expect(container.textContent).not.toContain('请输入任务标题');await act(async()=>root.render(null));await render();await act(async()=>{clickNow('b');openNow('b');});expect(container.querySelector('[data-testid="test-text-editor"]')?.getAttribute('data-title')).toBe('TEST b title');expect(changes).toEqual([]);
  });
  it('does not publish selection state as task edits when switching between differently titled nodes',async()=>{
    await render();await click('a');await click('b');await act(async()=>openNow('b'));expect(changes).toEqual([]);expect(current.nodes.map(node=>node.title)).toEqual(['TEST a title','TEST b title']);
  });
  it('saves a dirty Inspector draft to its original node before focus changes and preserves the target task',async()=>{
    await render();await click('a');await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="inspector-toggle"]')!.click());await changeInput('test-title-input','TEST edited first title');await click('b');expect(changes).toHaveLength(1);expect(current.nodes[0]!.title).toBe('TEST edited first title');expect(current.nodes[1]!.title).toBe('TEST b title');expect(container.querySelector<HTMLInputElement>('[data-testid="test-title-input"]')!.value).toBe('TEST b title');await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="test-save"]')!.click());expect(changes).toHaveLength(1);
  });
  it('hydrates untouched drafts from native updates, accepts metadata revision acknowledgements and blocks actual concurrent text edits',async()=>{
    await render();await click('a');await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="inspector-toggle"]')!.click());current={...current,nodes:current.nodes.map(node=>node.id==='a'?{...node,title:'TEST native title',revision:2}:node)};await render();expect(container.querySelector<HTMLInputElement>('[data-testid="test-title-input"]')!.value).toBe('TEST native title');await changeInput('test-title-input','TEST local draft');current={...current,nodes:current.nodes.map(node=>node.id==='a'?{...node,revision:3}:node)};await render();await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="test-save"]')!.click());expect(current.nodes[0]!.title).toBe('TEST local draft');await changeInput('test-title-input','TEST preserved conflict draft');current={...current,nodes:current.nodes.map(node=>node.id==='a'?{...node,title:'TEST another editor',revision:4}:node)};await render();const count=changes.length;await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="test-save"]')!.click());expect(changes).toHaveLength(count);expect(container.querySelector<HTMLInputElement>('[data-testid="test-title-input"]')!.value).toBe('TEST preserved conflict draft');expect(container.textContent).toContain('草稿已保留');
  });
});
