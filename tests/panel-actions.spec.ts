// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '../src/shared/model.ts';
import type { WorkflowPanelProps } from '../src/client/WorkflowPanel.tsx';
const harness=vi.hoisted(()=>({nodes:[] as any[],props:{} as any}));
vi.mock('@xyflow/react',async()=>{
  const React=await import('react');
  return {useStoreApi:()=>({getState:()=>({nodeLookup:new Map()})}),useConnection:(select:any)=>select({inProgress:false}),ReactFlowProvider:({children}:any)=>children,ReactFlow:(props:any)=>{harness.props=props;harness.nodes=props.nodes;return React.createElement('div',{'data-testid':'flow-test'},...props.nodes.map((node:any)=>React.createElement('div',{'data-testid':`test-node-${node.id}`,key:node.id},node.data.task.title,React.createElement('button',{'data-testid':`test-action-${node.id}`,onKeyDown:(event:any)=>event.stopPropagation()},'Node action'))));},Background:()=>null,BackgroundVariant:{Dots:'dots'},Controls:()=>null,MiniMap:()=>null,MarkerType:{ArrowClosed:'closed'},ConnectionLineType:{Bezier:'bezier'},SelectionMode:{Partial:'partial'},applyNodeChanges:(_changes:any,nodes:any)=>nodes,useNodes:()=>[],useViewport:()=>({x:0,y:0,zoom:1}),useReactFlow:()=>({screenToFlowPosition:(p:any)=>p,getZoom:()=>1,fitView:vi.fn(),getInternalNode:()=>undefined})};
});

vi.mock('../src/client/TaskNode.tsx',()=>({TaskNode:()=>null,executionStatusText:()=>''}));
vi.mock('../src/client/WorkflowEdge.tsx',()=>({workflowEdgeTypes:{},WorkflowConnectionLine:()=>null}));
vi.mock('../src/client/NodeTextEditor.tsx',()=>({NodeTextEditor:()=>null}));
import { WorkflowPanel } from '../src/client/WorkflowPanel.tsx';
let root:Root,container:HTMLDivElement,current:Workflow;let changes:Workflow[];let overrides:Partial<WorkflowPanelProps>;
const task=(id:string):WorkflowNode=>({id,title:`TEST ${id}`,instruction:`TEST ${id}`,source:'user',status:'draft',revision:1,position:{x:id==='a'?100:600,y:100}});
const initial=():Workflow=>({id:'actions-test',name:'TEST actions',schemaVersion:2,revision:1,nodes:[task('a'),task('b'),task('c')],edges:[{id:'a-b',source:'a',target:'b',type:'dependency'},{id:'a-c',source:'a',target:'c',type:'dependency'},{id:'b-c',source:'b',target:'c',type:'dependency'}],groups:[{id:'pair',title:'TEST pair',nodeIds:['a','b']}],viewport:{x:0,y:0,zoom:1},createdAt:1,updatedAt:1});
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});container=document.createElement('div');document.body.append(container);root=createRoot(container);current=initial();changes=[];overrides={};});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
function renderNow(){root.render(createElement(WorkflowPanel,{workflows:[current],activeWorkflowId:current.id,loading:false,saveState:'saved',catalogMode:false,onSelectWorkflow:()=>{},onCreateWorkflow:()=>{},onRenameWorkflow:()=>{},onChangeWorkflow:next=>{changes.push(next);current=next;renderNow();},onRetry:()=>{},...overrides}));}
const render=()=>act(async()=>renderNow());
const button=(id:string)=>container.querySelector<HTMLButtonElement>(`[data-testid="context-${id}"]`)!;
const port=(nodeId:string,direction:'input'|'output')=>act(async()=>harness.nodes.find(node=>node.id===nodeId).data.onPortMenu(nodeId,direction,{clientX:120,clientY:160}));
const groupMenu=()=>act(async()=>container.querySelector('[data-testid="group-title-pair"]')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:160})));

describe('Canvas action boundaries',()=>{
 it('switches Run selected to Pause all until the node selection changes and preserves it across execution updates',async()=>{
  const run=vi.fn(),pause=vi.fn();overrides={onRunNodes:run,onPauseAll:pause,runtimeReady:true,modelAvailable:true};await render();
  await act(async()=>harness.props.onNodesChange([{type:'select',id:'a',selected:true},{type:'select',id:'b',selected:true}]));
  const action=()=>container.querySelector<HTMLButtonElement>('[data-testid="run-selected"]')!;
  await act(async()=>action().click());expect(run).toHaveBeenCalledExactlyOnceWith(['a','b'],undefined);expect(action().textContent).toContain('暂停所有');
  overrides={...overrides,executions:[{runId:'a-run',nodeId:'a',nodeRevision:1,branchId:'branch',sessionId:'session',status:'running',createdAt:1,updatedAt:1}]};await render();
  expect(action().getAttribute('data-mode')).toBe('pause');expect(action().disabled).toBe(false);await act(async()=>action().click());expect(pause).toHaveBeenCalledOnce();
  await act(async()=>harness.props.onNodesChange([{type:'select',id:'a',selected:false},{type:'select',id:'b',selected:false},{type:'select',id:'c',selected:true}]));
  expect(action().getAttribute('data-mode')).toBe('run');expect(action().textContent).toContain('运行所选');expect(action().disabled).toBe(false);
 });
 it('Delete reaches a complete multi-selection even when a node action consumes bubbling keys, while text input and open menus remain local',async()=>{
  const command=vi.fn(()=>[]);overrides={onCanvasCommand:command};await render();await act(async()=>harness.props.onNodesChange([{type:'select',id:'a',selected:true},{type:'select',id:'b',selected:true}]));
  const action=container.querySelector<HTMLElement>('[data-testid="test-action-a"]')!;await act(async()=>action.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true})));expect(command).toHaveBeenCalledExactlyOnceWith('delete',expect.objectContaining({nodeIds:['a','b']}));
  await act(async()=>harness.props.onNodesChange([{type:'select',id:'c',selected:true}]));const input=container.querySelector<HTMLInputElement>('[data-testid="workflow-name-input"]')!;await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true})));expect(command).toHaveBeenCalledTimes(1);
  await groupMenu();await act(async()=>button('copy').dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true})));expect(command).toHaveBeenCalledTimes(1);
 });
 it('disconnects precisely all edges of one port in a single graph change without deleting tasks or other dependencies',async()=>{
  await render();await port('a','output');expect(button('disconnect-port').textContent).toContain('2');await act(async()=>button('disconnect-port').click());expect(changes).toHaveLength(1);expect(current.edges.map(edge=>edge.id)).toEqual(['b-c']);expect(current.nodes.map(node=>node.id)).toEqual(['a','b','c']);
  await port('c','input');await act(async()=>button('disconnect-port').click());expect(changes).toHaveLength(2);expect(current.edges).toEqual([]);await port('a','output');expect(button('disconnect-port').disabled).toBe(true);
 });
 it('protects running and uncertain dependency targets and leaves the graph untouched',async()=>{
  overrides={executions:[{runId:'active',nodeId:'b',nodeRevision:1,branchId:'branch',sessionId:'session',status:'waiting',createdAt:1,updatedAt:1}]};await render();await port('a','output');expect(button('disconnect-port').disabled).toBe(true);expect(button('disconnect-port').title).toContain('停止');expect(changes).toEqual([]);
  overrides={executions:[{runId:'uncertain',nodeId:'b',nodeRevision:1,branchId:'branch',sessionId:'session',status:'unknown',durability:'needs-reconcile',createdAt:1,updatedAt:1}]};await render();expect(button('disconnect-port').disabled).toBe(true);expect(changes).toEqual([]);
 });
 it('runs group menu commands against the full group, changes layers atomically and renames or ungroups the group itself',async()=>{
  const command=vi.fn(()=>undefined);overrides={onCanvasCommand:command};await render();await groupMenu();await act(async()=>button('copy').click());expect(command).toHaveBeenLastCalledWith('copy',expect.objectContaining({nodeIds:['a','b']}));await groupMenu();await act(async()=>button('duplicate').click());expect(command).toHaveBeenLastCalledWith('duplicate',expect.objectContaining({nodeIds:['a','b']}));await groupMenu();await act(async()=>button('bring-front').click());expect(changes).toHaveLength(1);expect(current.nodes.find(node=>node.id==='a')!.zIndex).toBeGreaterThan(current.nodes.find(node=>node.id==='c')!.zIndex!);expect(current.nodes.find(node=>node.id==='b')!.zIndex).toBeGreaterThan(current.nodes.find(node=>node.id==='c')!.zIndex!);
  await groupMenu();await act(async()=>button('rename').click());expect(container.querySelector<HTMLInputElement>('[data-testid="group-name-input-pair"]')!.value).toBe('TEST pair');await act(async()=>container.querySelector<HTMLInputElement>('[data-testid="group-name-input-pair"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  await groupMenu();await act(async()=>button('ungroup').click());expect(current.groups).toEqual([]);expect(current.nodes).toHaveLength(3);
 });
 it('calls one catalog layer transaction for the group and keeps native source copy and deletion protected',async()=>{
  const layers=vi.fn(),groups=[{id:'pair',title:'TEST sources',nodeIds:['catalog:s1','catalog:s2']}];overrides={catalogMode:true,sessionRoots:[{sessionId:'s1',title:'TEST s1',updatedAt:1},{sessionId:'s2',title:'TEST s2',updatedAt:1}],catalogGroups:groups,onChangeSessionRootLayers:layers,onCanvasCommand:vi.fn()};await render();await groupMenu();expect(button('copy').disabled).toBe(true);expect(button('delete').disabled).toBe(true);await act(async()=>button('layer-up').click());expect(layers).toHaveBeenCalledExactlyOnceWith(['s1','s2'],'up');expect(changes).toEqual([]);
 });
 it('opens a utility context menu and removes the utility through the same canvas save path',async()=>{
  current={...initial(),utilityNodes:[{id:'utility-1',title:'Resources',position:{x:120,y:320},width:560,height:440}]};await render();
  await act(async()=>harness.nodes.find((node:any)=>node.id==='utility-1').data.onMenu('utility-1',{clientX:120,clientY:160}));
  expect(button('focus-utility').disabled).toBe(true);expect(button('delete-utility').disabled).toBe(false);
  await act(async()=>button('delete-utility').click());expect(changes).toHaveLength(1);expect(current.utilityNodes).toEqual([]);
 });
});
