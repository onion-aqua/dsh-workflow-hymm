// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Branch, Workflow, WorkflowPendingApproval, WorkflowPendingQuestion } from '../src/shared/model.ts';
import type { WorkflowPanelProps } from '../src/client/WorkflowPanel.tsx';
import type { ExecutionCard } from '../src/client/ui-contract.ts';
import { adoptUserNodes, XYResizer } from '@xyflow/system';

const harness=vi.hoisted(()=>({nodes:[] as any[],props:{} as any}));
vi.mock('@xyflow/react',async()=>{
  const React=await import('react');
  return {useStoreApi:()=>({getState:()=>({nodeLookup:new Map()})}),useConnection:(select:any)=>select({inProgress:false}),ReactFlowProvider:({children}:any)=>children,ReactFlow:(props:any)=>{harness.props=props;harness.nodes=props.nodes;return React.createElement('div',{'data-testid':'flow-test'},...props.nodes.map((node:any)=>React.createElement('div',{'data-testid':`test-node-${node.id}`,key:node.id},node.data.task.title)));},Background:()=>null,BackgroundVariant:{Dots:'dots'},Controls:()=>null,MiniMap:()=>null,MarkerType:{ArrowClosed:'closed'},ConnectionLineType:{Bezier:'bezier'},SelectionMode:{Partial:'partial'},applyNodeChanges:(_changes:any,nodes:any)=>nodes,useNodes:()=>harness.nodes,useViewport:()=>({x:0,y:0,zoom:1}),useReactFlow:()=>({screenToFlowPosition:(point:any)=>point,getZoom:()=>1,fitView:vi.fn(),getInternalNode:()=>undefined})};
});
vi.mock('../src/client/TaskNode.tsx',()=>({TaskNode:()=>null,executionStatusText:(status:string)=>status}));
vi.mock('../src/client/WorkflowEdge.tsx',()=>({workflowEdgeTypes:{},WorkflowConnectionLine:()=>null}));
vi.mock('../src/client/NodeTextEditor.tsx',()=>({NodeTextEditor:()=>null}));
import { WorkflowPanel } from '../src/client/WorkflowPanel.tsx';

let root:Root,container:HTMLDivElement,current:Workflow,overrides:Partial<WorkflowPanelProps>;
const branch=(id:string):Branch=>({id,label:`TEST ${id}`,sessionId:`session-${id}`,parentBranchId:'main',sourceSessionId:'session-main',forkBoundarySeq:10,automatic:true,nodeIds:['task'],createdAt:1});
const run=(id:string,branchId='left'):ExecutionCard=>({runId:id,nodeId:'task',nodeRevision:1,branchId,sessionId:`session-${branchId}`,status:'completed',createdAt:1,updatedAt:1,endSeq:20,durability:'durable'});
const initial=():Workflow=>({id:'trace-routing-test',name:'TEST trace routing',schemaVersion:2,revision:1,nodes:[{id:'task',title:'TEST task',instruction:'TEST only',source:'user',status:'completed',revision:1,position:{x:100,y:100}}],edges:[],viewport:{x:0,y:0,zoom:1},createdAt:1,updatedAt:1,branches:[{id:'main',label:'TEST overview',sessionId:'session-main',nodeIds:['task'],createdAt:1},branch('left'),branch('right')],activeBranchId:'left'});
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  vi.stubGlobal('ResizeObserver',class{constructor(private callback:(entries:any[])=>void){}observe(){this.callback([{contentRect:{width:1400,height:900}}]);}disconnect(){}});
  container=document.createElement('div');document.body.append(container);root=createRoot(container);current=initial();overrides={executions:[run('old-run')],activeBranchId:'left',branches:current.branches,onReadTrace:vi.fn(),onSelectExecution:vi.fn(),onOpenSession:vi.fn()};
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
function renderNow(){root.render(createElement(WorkflowPanel,{workflows:[current],activeWorkflowId:current.id,loading:false,saveState:'saved',catalogMode:false,onSelectWorkflow:()=>{},onCreateWorkflow:()=>{},onRenameWorkflow:()=>{},onChangeWorkflow:()=>{},onRetry:()=>{},...overrides}));}
const render=()=>act(async()=>renderNow());
const element=<T extends HTMLElement=HTMLElement>(id:string)=>container.querySelector<T>(`[data-testid="${id}"]`)!;
async function openTrace(){await act(async()=>harness.props.onNodeClick({target:element('test-node-task'),shiftKey:false,ctrlKey:false,metaKey:false},harness.nodes[0]));await act(async()=>element<HTMLButtonElement>('trace-entry').click());}

describe('Visible execution selection after native branch routing',()=>{
  it('targets the focused task or private planning context and restores the task when planning closes',async()=>{
    const onContextTarget=vi.fn();overrides={...overrides,onContextTarget};await render();expect(onContextTarget).toHaveBeenLastCalledWith(null);
    await act(async()=>harness.props.onNodeClick({target:element('test-node-task'),shiftKey:false,ctrlKey:false,metaKey:false},harness.nodes[0]));expect(onContextTarget).toHaveBeenLastCalledWith({nodeId:'task'});
    await act(async()=>element<HTMLButtonElement>('plan-open').click());expect(onContextTarget).toHaveBeenLastCalledWith({planning:true});
    await act(async()=>element<HTMLButtonElement>('plan-open').click());expect(onContextTarget).toHaveBeenLastCalledWith({nodeId:'task'});
    expect(container.querySelector('.wf-studio-utilities>div:last-child [data-testid="context-capacity-trigger"]')).not.toBeNull();
  });
  it('lets the real React Flow resizer start from an explicit utility size after a metadata refresh',async()=>{
    current={...current,utilityNodes:[{id:'utility',title:'TEST utility',position:{x:700,y:250},width:600,height:420}]};
    const onChangeWorkflow=vi.fn((next:Workflow)=>{current=next;});overrides={...overrides,onChangeWorkflow};await render();
    current={...current,revision:current.revision+1,updatedAt:2};await render();
    // React Flow adopts each fresh controlled node object. Its real resizer
    // reads measured dimensions, independently of the element's CSS width.
    const nodeLookup=new Map<string,any>(),parentLookup=new Map<string,any>();adoptUserNodes(harness.nodes,nodeLookup,parentLookup);
    const handle=document.createElement('div');container.append(handle);
    const resizer=XYResizer({domNode:handle,nodeId:'utility',getStoreItems:()=>({nodeLookup,transform:[0,0,1],snapGrid:[1,1],snapToGrid:false,nodeOrigin:[0,0],paneDomNode:container}),onChange:()=>{}});
    resizer.update({controlPosition:'bottom-right',boundaries:{minWidth:360,minHeight:260,maxWidth:1800,maxHeight:1400},keepAspectRatio:false,onResizeStart:undefined,onResize:undefined,shouldResize:undefined,onResizeEnd:(_event,size)=>harness.nodes.find((node:any)=>node.id==='utility').data.onChangeUtility('utility',{width:size.width,height:size.height})});
    const view=container.ownerDocument.defaultView!;
    const mouse=(type:string,init:MouseEventInit)=>{const event=new MouseEvent(type,init);Object.defineProperty(event,'view',{value:view});return event;};
    await act(async()=>handle.dispatchEvent(mouse('mousedown',{button:0,clientX:100,clientY:100,bubbles:true})));
    await act(async()=>view.dispatchEvent(mouse('mousemove',{buttons:1,clientX:205,clientY:185,bubbles:true})));
    await act(async()=>view.dispatchEvent(mouse('mouseup',{button:0,clientX:205,clientY:185,bubbles:true})));
    resizer.destroy();handle.remove();expect(onChangeWorkflow).toHaveBeenCalledOnce();expect(current.utilityNodes![0]).toMatchObject({width:705,height:505,position:{x:700,y:250}});
  });
  it('keeps utility metadata valid for invalid resize callbacks without rewriting valid sizes on unrelated edits',async()=>{
    current={...current,utilityNodes:[{id:'utility',title:'TEST utility',position:{x:700,y:250},width:300,height:220}]};
    overrides={...overrides,onChangeWorkflow:(next:Workflow)=>{current=next;}};await render();
    const change=(patch:Record<string,unknown>)=>act(async()=>harness.nodes.find((node:any)=>node.id==='utility').data.onChangeUtility('utility',patch));
    await change({title:'A renamed utility'});expect(current.utilityNodes![0]).toMatchObject({title:'A renamed utility',width:300,height:220});
    await change({width:-150,height:-90});expect(current.utilityNodes![0]).toMatchObject({width:300,height:220});
    await change({width:Number.NaN,height:Number.POSITIVE_INFINITY});expect(current.utilityNodes![0]).toMatchObject({width:300,height:220});
    await change({width:9999,height:9999});expect(current.utilityNodes![0]).toMatchObject({width:2400,height:1600});await render();
    await act(async()=>harness.props.onNodesChange([{type:'dimensions',id:'utility',resizing:false,dimensions:{width:-150,height:-90}}]));
    expect(harness.nodes.find((node:any)=>node.id==='utility')).toMatchObject({width:2400,height:1600,measured:{width:2400,height:1600}});
  });
  it('replaces an invisible selected execution when a rerun automatically changes the active branch',async()=>{
    await render();await openTrace();overrides.trace={runId:'old-run',status:'completed',steps:[]};await render();
    expect(container.querySelector('.wf-trace-loading')).toBeNull();
    const next=branch('rerun');current={...current,branches:[...current.branches!,next],activeBranchId:next.id};
    overrides={...overrides,branches:current.branches,activeBranchId:next.id,executions:[run('old-run'),run('new-run',next.id)],trace:{runId:'new-run',status:'completed',steps:[]}};
    await render();
    expect(overrides.onReadTrace).toHaveBeenLastCalledWith('new-run');
    expect(container.querySelector('.wf-trace-loading')).toBeNull();
    const conversation=container.querySelector<HTMLButtonElement>('[aria-label="打开对话"]');
    expect(conversation).not.toBeNull();await act(async()=>conversation!.click());
    expect(overrides.onOpenSession).toHaveBeenLastCalledWith('session-rerun');
    await act(async()=>element<HTMLButtonElement>('trace-close').click());await act(async()=>element<HTMLButtonElement>('trace-entry').click());
    expect(container.querySelector('.wf-trace-loading')).toBeNull();
  });
  it('retains an explicitly chosen visible historical run when later events or a new run arrive',async()=>{
    overrides.executions=[run('history-run'),run('latest-run')];await render();await openTrace();
    const select=element<HTMLSelectElement>('execution-select');await act(async()=>{select.value='history-run';select.dispatchEvent(new Event('change',{bubbles:true}));});
    overrides.trace={runId:'history-run',status:'completed',steps:[]};await render();
    const reads=(overrides.onReadTrace as ReturnType<typeof vi.fn>).mock.calls.length;
    overrides.executions=[run('history-run'),run('latest-run'),run('newer-run')];await render();
    expect(element<HTMLSelectElement>('execution-select').value).toBe('history-run');
    expect((overrides.onReadTrace as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(reads);
    expect(container.querySelector('.wf-trace-loading')).toBeNull();
  });
  it('pins the displayed historical execution and distinguishes unpinning from closing the focused panel',async()=>{
    overrides.executions=[run('history-run'),run('latest-run')];await render();await openTrace();
    const select=element<HTMLSelectElement>('execution-select');await act(async()=>{select.value='history-run';select.dispatchEvent(new Event('change',{bubbles:true}));});
    overrides.trace={runId:'history-run',status:'completed',steps:[]};await render();
    expect(element('node-trace-pin-task')).toBeNull();
    const pin=element<HTMLButtonElement>('trace-pin-task');expect(pin.parentElement?.getAttribute('data-testid')).toBe('trace-position-task');
    await act(async()=>pin.click());expect(pin.getAttribute('aria-pressed')).toBe('true');expect(element<HTMLSelectElement>('execution-select').value).toBe('history-run');
    overrides.executions=[run('history-run'),run('latest-run'),run('newer-run')];await render();expect(element<HTMLSelectElement>('execution-select').value).toBe('history-run');
    await act(async()=>pin.click());expect(pin.getAttribute('aria-pressed')).toBe('false');expect(element('trace-panel')).not.toBeNull();expect(element<HTMLSelectElement>('execution-select').value).toBe('history-run');
    await act(async()=>pin.click());expect(pin.getAttribute('aria-pressed')).toBe('true');await act(async()=>element<HTMLButtonElement>('trace-close').click());
    expect(element('trace-panel')).toBeNull();expect(element('trace-pin-task')).toBeNull();expect(element('trace-entry')).not.toBeNull();
    await act(async()=>element<HTMLButtonElement>('trace-entry').click());expect(element('trace-panel')).not.toBeNull();expect(element<HTMLButtonElement>('trace-pin-task').getAttribute('aria-pressed')).toBe('false');
  });
  it('shows an empty trace instead of waiting forever when the selected path has no visible execution',async()=>{
    await render();await openTrace();overrides.trace={runId:'old-run',status:'completed',steps:[]};await render();
    overrides.activeBranchId='right';await render();
    expect(element('trace-empty')).not.toBeNull();expect(container.querySelector('.wf-trace-loading')).toBeNull();expect(container.querySelector('.wf-trace-meta .wf-tag')?.classList.contains('wf-tag--draft')).toBe(true);
    expect(container.querySelector('[aria-label="打开对话"]')).toBeNull();
  });
  it('keeps one live native question and approval across metadata refreshes without duplicating layers or losing an answer draft',async()=>{
    current={...current,nodes:[...current.nodes,{id:'approval-task',title:'TEST approval task',instruction:'TEST native approval',source:'user',status:'running',revision:1,position:{x:700,y:300}}]};
    const question:WorkflowPendingQuestion={workflowId:current.id,runId:'old-run',nodeId:'task',sessionId:'native-question-session',callId:'native-question-call',questions:[{id:'direction',question:'Which exact direction?'}],state:'open',actionable:true,createdAt:1,autoContinueAt:Date.now()+60000};
    const approval:WorkflowPendingApproval={workflowId:current.id,runId:'approval-run',nodeId:'approval-task',sessionId:'native-approval-session',approvalId:'native-approval-call',toolName:'shell',command:'Write-Output TEST',actionable:true,createdAt:1};
    const onAnswerQuestion=vi.fn(async()=>{}),onDecideApproval=vi.fn(async()=>{}),onPauseQuestionAutomation=vi.fn(async()=>{});
    overrides={...overrides,pendingQuestions:[question],pendingApprovals:[approval],onAnswerQuestion,onDecideApproval,onPauseQuestionAutomation};await render();
    await act(async()=>element<HTMLButtonElement>('question-custom-direction').click());
    const input=element<HTMLTextAreaElement>('question-custom-input-direction');
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Keep my native answer');input.dispatchEvent(new Event('input',{bubbles:true}));});input.focus();
    for(let update=1;update<=8;update++){
      current={...current,revision:current.revision+1,updatedAt:update};
      overrides={...overrides,pendingQuestions:[{...question,autoContinuePaused:true}],pendingApprovals:[{...approval,createdAt:update}],trace:{runId:'old-run',status:'waiting_answer',steps:[]}};await render();
      expect(container.querySelectorAll('[data-testid="question-layer"]')).toHaveLength(1);expect(container.querySelectorAll('[data-testid="approval-layer"]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-testid="question-panel"]')).toHaveLength(1);expect(container.querySelectorAll('[data-testid="approval-panel"]')).toHaveLength(1);
      expect(element<HTMLTextAreaElement>('question-custom-input-direction')).toBe(input);expect(input.value).toBe('Keep my native answer');expect(document.activeElement).toBe(input);
    }
    await act(async()=>element<HTMLButtonElement>('question-submit').click());await act(async()=>element<HTMLButtonElement>('approval-allow').click());
    expect(onAnswerQuestion).toHaveBeenCalledExactlyOnceWith({...question,autoContinuePaused:true},[{id:'direction',selected:[],custom:'Keep my native answer'}]);expect(onDecideApproval).toHaveBeenCalledExactlyOnceWith({...approval,createdAt:8},'allowed-once');
    overrides={...overrides,pendingQuestions:[],pendingApprovals:[]};await render();expect(container.querySelector('[data-testid="question-layer"]')).toBeNull();expect(container.querySelector('[data-testid="approval-layer"]')).toBeNull();
  });
});
