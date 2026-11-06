import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, MarkerType, ConnectionLineType, SelectionMode, applyNodeChanges, useNodes, useReactFlow, useViewport } from '@xyflow/react';
import type { Connection, Edge, EdgeChange, NodeChange, Viewport as FlowViewport } from '@xyflow/react';
import type { Workflow, WorkflowEdge, WorkflowGroup, WorkflowNode, WorkflowUtilityNode } from '../shared/model.ts';
import { WORKFLOW_PLUGIN_VERSION } from '../shared/model.ts';
import { useMagneticPorts } from './MagneticHandle.tsx';
import { UtilityNode } from './UtilityNode.tsx';
import { NodeCreateMenu } from './NodeCreateMenu.tsx';
import { TaskNode, executionStatusText } from './TaskNode.tsx';
import type { InlineField, MenuPoint, TaskFlowNode } from './TaskNode.tsx';
import { ContextMenu } from './ContextMenu.tsx';
import { WorkflowPicker } from './WorkflowPicker.tsx';
import { NodeTextEditor } from './NodeTextEditor.tsx';
import { NodeComposer } from './NodeComposer.tsx';
import { ContextCapacity } from './ContextCapacity.tsx';
import { AccessModePicker } from './AccessModePicker.tsx';
import { CanvasApprovals } from './CanvasApprovals.tsx';
import { CanvasQuestions } from './CanvasQuestions.tsx';
import { CanvasTracePanels } from './CanvasTracePanels.tsx';
import type { TracePins } from './CanvasTracePanels.tsx';
import { BranchPicker } from './BranchPicker.tsx';
import { CanvasNodeEffects, SheetPresence } from './CanvasMotion.tsx';
import { ModelPicker, modelChoiceAvailable, MODEL_PICKER_VIEWPORT_EVENT } from './ModelPicker.tsx';
import { CanvasGroups, GroupingToolbar } from './GroupingToolbar.tsx';
import { CanvasShortcutsHelp, CanvasShortcutsHint } from './CanvasShortcutsHelp.tsx';
import { canvasShortcut } from './canvas-shortcuts.ts';
import type { CanvasShortcut } from './canvas-shortcuts.ts';
import { workflowEdgeTypes, WorkflowConnectionLine } from './WorkflowEdge.tsx';
import type { ContextAction } from './ContextMenu.tsx';
import { copyTaskText, createTaskDraft, readTaskClipboard } from './node-clipboard.ts';
import { TracePanel, visibleTraceSteps } from './TracePanel.tsx';
import { Inspector, PlanSheet, SettingsSheet } from './WorkflowSheets.tsx';
import { Icon } from './icons.tsx';
import { arrangeNodes, changeLayer, changeLayers, applyNodePositions, compactNodeHeight, estimateQuestionHeight, createNodeGroup, layoutNodeSelection, nodeSelectionBounds, trimNodeGroups, runnableSelectedNodeIds, editorTextConflicts, connectionError, executionVisibleInBranch, executionIsActive, placeTracePanel, positionSessionRoots } from './graph.ts';
import type { LayerAction, Rectangle, SelectionLayout } from './graph.ts';
import { translateZh } from './locales.ts';
import type { Translate } from './locales.ts';
import type { ExecutionCard, SubagentMode, WorkflowRuntimeProps } from './ui-contract.ts';
import '@xyflow/react/dist/style.css';
import './styles.css';

export type CanvasCommand='undo'|'redo'|'copy'|'cut'|'paste'|'duplicate'|'delete'|'restore';
export interface CanvasCommandContext { nodeIds:readonly string[];position?:{x:number;y:number} }
interface DragPointerEvent { clientX?:number;clientY?:number;touches?:ArrayLike<{clientX:number;clientY:number}> }
export interface WorkflowPanelProps extends WorkflowRuntimeProps {
  workflows: readonly Workflow[]; activeWorkflowId: string | null; loading: boolean;
  saveState: 'saved' | 'saving' | 'error'; error?: string;
  onSelectWorkflow: (id: string) => void; onCreateWorkflow: () => void | Promise<void>;
  onRenameWorkflow: (id: string, name: string) => void; onChangeWorkflow: (workflow: Workflow) => void;
  onRetry: () => void | Promise<void>; t?: Translate;
  onCanvasCommand?: (command:CanvasCommand,context:CanvasCommandContext)=>readonly string[]|void|Promise<readonly string[]|void>;
  canUndo?:boolean;canRedo?:boolean;
  catalogGroups?:readonly WorkflowGroup[];
  onChangeCatalogGroups?:(groups:readonly WorkflowGroup[])=>void;
}
const nodeTypes = { task: TaskNode,utility:UtilityNode };
const nodeWidth = 300;
const emptyViewport = { x: 0, y: 0, zoom: 1 };
const emptyItems: readonly never[] = Object.freeze([]);

/** A policy choice only; native execution remains the Host's responsibility. */
export function SubagentModePicker({mode='off',disabled=false,onBeforeAction,onChange,t}:{
  mode?:SubagentMode;disabled?:boolean;onBeforeAction?:()=>boolean;onChange?:(mode:SubagentMode)=>void;t:Translate;
}){
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const id=useId();const [open,setOpen]=useState(false),[active,setActive]=useState(0);
  const choices=[{value:'off',label:t('subagentModeOff'),hint:t('subagentModeOffHint')},{value:'on',label:t('subagentModeOn'),hint:t('subagentModeOnHint')},{value:'auto',label:t('subagentModeAuto'),hint:t('subagentModeAutoHint')}] as const;
  const blocked=disabled||!onChange;
  const close=(restore=false)=>{setOpen(false);if(restore)trigger.current?.focus();};
  const show=(index=choices.findIndex(choice=>choice.value===mode))=>{if(!blocked){setActive(Math.max(0,index));setOpen(true);}};
  const choose=(value:SubagentMode)=>{
    if(blocked)return;
    if(value!==mode){if(onBeforeAction?.()===false)return;onChange?.(value);}
    close(true);
  };
  const navigate=(event:ReactKeyboardEvent)=>{
    event.stopPropagation();if(event.nativeEvent.isComposing||event.keyCode===229)return;
    if(event.key==='Escape'){event.preventDefault();close(true);return;}
    if(event.key==='Tab'){close();return;}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(choices[active]!.value);return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();setActive(index=>event.key==='Home'?0:event.key==='End'?choices.length-1:(index+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length);
  };
  useEffect(()=>{if(open)menu.current?.querySelector<HTMLButtonElement>(`[data-mode-index="${active}"]`)?.focus();},[open,active]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))close();};
    document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);
  },[open]);
  useEffect(()=>{if(blocked)setOpen(false);},[blocked]);
  return <div ref={root} className="wf-subagent-picker nodrag nopan nowheel" data-testid="subagent-mode-picker"
    onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()}>
    <button ref={trigger} type="button" className="wf-subagent-trigger" data-testid="subagent-mode-trigger" aria-label={`${t('subagentMode')}: ${choices.find(choice=>choice.value===mode)?.label}`} title={choices.find(choice=>choice.value===mode)?.hint}
      aria-haspopup="menu" aria-expanded={open} aria-controls={id} disabled={blocked} onClick={()=>open?close():show()}
      onKeyDown={event=>{if(event.nativeEvent.isComposing||event.keyCode===229)return;if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();show(event.key==='ArrowUp'?choices.length-1:undefined);}else if(event.key==='Escape'){event.preventDefault();close(true);}}}>
      <Icon name="workflow" size={14}/><span>{t('subagentMode')}</span><b>{choices.find(choice=>choice.value===mode)?.label}</b><Icon name="chevron" size={11} style={{transform:'rotate(90deg)'}}/>
    </button>
    {open&&<div ref={menu} id={id} role="menu" aria-label={t('subagentMode')} className="wf-subagent-menu" data-testid="subagent-mode-menu" onKeyDown={navigate}>
      {choices.map((choice,index)=><button key={choice.value} type="button" role="menuitemradio" aria-checked={mode===choice.value} tabIndex={active===index?0:-1}
        data-mode-index={index} data-testid={`subagent-mode-${choice.value}`} title={choice.hint} className={mode===choice.value?'is-selected':undefined} onClick={()=>choose(choice.value)}><span>{choice.label}</span>{mode===choice.value&&<Icon name="check" size={14}/>}</button>)}
    </div>}
  </div>;
}



function WorkflowWorkspace(props: WorkflowPanelProps) {
  const { workflows, activeWorkflowId, loading, saveState, error, onSelectWorkflow, onCreateWorkflow, onRenameWorkflow, onChangeWorkflow, onRetry, t=translateZh }=props;
  const busy=Boolean(props.busy);
  const workflow=workflows.find(item=>item.id===activeWorkflowId)??null;
  const catalog=props.catalogMode??!workflow; const roots=props.sessionRoots??emptyItems;
  const workflowRef=useRef(workflow); workflowRef.current=workflow;
  const activeCanvasRef=useRef(catalog?'catalog':workflow?.id);activeCanvasRef.current=catalog?'catalog':workflow?.id;
  const catalogPositions=useRef(new Map<string,WorkflowNode['position']>());
  const positionedCatalogRootIds=useRef(new Set<string>());
  const [nodes,setNodes]=useState<TaskFlowNode[]>([]);
  const [utilityLive,setUtilityLive]=useState<Record<string,Partial<WorkflowUtilityNode>&{dragging?:boolean}>>({});
  const [focusedUtilityId,setFocusedUtilityId]=useState<string|null>(null);
  const [viewport,setViewport]=useState<FlowViewport>((catalog?props.catalogViewport:workflow?.viewport)??emptyViewport);
  const [focusedNodeId,setFocusedNodeId]=useState<string|null>(null);
  const [composerNodeId,setComposerNodeId]=useState<string|null>(null);
  const [approvalReveal,setApprovalReveal]=useState<{nodeId:string;token:number}>();
  const pendingApprovalCounts=useMemo(()=>{const counts=new Map<string,number>();for(const approval of props.pendingApprovals??[])if(approval.workflowId===workflow?.id)counts.set(approval.nodeId,(counts.get(approval.nodeId)??0)+1);return counts;},[props.pendingApprovals,workflow?.id]);
  const openApprovals=useCallback((nodeId:string)=>{setApprovalReveal({nodeId,token:Date.now()});void props.onReloadApprovals?.();},[props.onReloadApprovals]);
  const [questionReveal,setQuestionReveal]=useState<{nodeId:string;token:number}>();
  const pendingQuestionCounts=useMemo(()=>{const counts=new Map<string,number>();for(const question of props.pendingQuestions??[])if(question.workflowId===workflow?.id)counts.set(question.nodeId,(counts.get(question.nodeId)??0)+question.questions.length);return counts;},[props.pendingQuestions,workflow?.id]);
  const waitingQuestionCounts=useMemo(()=>{const counts=new Map<string,number>();for(const question of props.pendingQuestions??[])if(question.workflowId===workflow?.id&&question.state==='open')counts.set(question.nodeId,(counts.get(question.nodeId)??0)+question.questions.length);return counts;},[props.pendingQuestions,workflow?.id]);
  const openQuestions=useCallback((nodeId:string)=>{setQuestionReveal({nodeId,token:Date.now()});void props.onReloadQuestions?.();},[props.onReloadQuestions]);
  const fileActivity=useRef(new Map<string,string>());
  const [fileBusyNodeIds,setFileBusyNodeIds]=useState<Set<string>>(()=>new Set());
  const trackFileActivity=useCallback((source:string,id:string,working:boolean)=>{
    if(working?fileActivity.current.get(source)===id:!fileActivity.current.has(source))return;
    if(working)fileActivity.current.set(source,id);else fileActivity.current.delete(source);
    setFileBusyNodeIds(new Set(fileActivity.current.values()));
  },[]);
  const trackCardFiles=useCallback((id:string,working:boolean)=>trackFileActivity(`card:${id}`,id,working),[trackFileActivity]);
  const [selectedNodeIds,setSelectedNodeIds]=useState<Set<string>>(()=>new Set());
  const [submittedSelection,setSubmittedSelection]=useState<string|null>(null);
  const selectionKey=JSON.stringify([workflow?.id,...[...selectedNodeIds].sort()]);
  useEffect(()=>{setSubmittedSelection(null);},[selectionKey]);
  const [textEditor,setTextEditor]=useState<{nodeId:string;title:string;instruction:string;revision:number;readOnly:boolean}|null>(null);
  const [textEditorError,setTextEditorError]=useState<string|undefined>();
  const rightGesture=useRef<{x:number;y:number;moved:boolean}|null>(null);
  const lastCanvasPoint=useRef<{x:number;y:number}|undefined>();
  const groupDrag=useRef<{nodes:TaskFlowNode[];delta:{x:number;y:number}}|null>(null);
  const nodeDragGesture=useRef<{start:{x:number;y:number};offset?:{x:number;y:number};ids:Set<string>}|null>(null);
  const lastNodeDragStop=useRef<object|null>(null);
  const additiveBoxSelection=useRef<Set<string>|null>(null);
  const boxSelecting=useRef(false);
  const [traceNodeId,setTraceNodeId]=useState<string|null>(null);
  const [tracePins,setTracePins]=useState<TracePins>({});
  const [layoutAnimating,setLayoutAnimating]=useState(false);
  const layoutTimer=useRef<ReturnType<typeof setTimeout>>();
  useEffect(()=>()=>{if(layoutTimer.current)clearTimeout(layoutTimer.current);},[]);
  const beginLayoutMotion=()=>{setLayoutAnimating(true);if(layoutTimer.current)clearTimeout(layoutTimer.current);layoutTimer.current=setTimeout(()=>setLayoutAnimating(false),230);};
  const [selectedRunId,setSelectedRunId]=useState<string|null>(null);
  const [selectedEdgeId,setSelectedEdgeId]=useState<string|null>(null);
  const [contextMenu,setContextMenu]=useState<{nodeId?:string;utilityId?:string;groupId?:string;port?:'input'|'output';x:number;y:number;flowPosition:{x:number;y:number}}|null>(null);
  const [inlineEditing,setInlineEditing]=useState<{nodeId:string;field:InlineField}|null>(null);
  const [,refreshClipboard]=useState(0);
  const inlineBaseline=useRef<{id:string;revision:number}|null>(null);
  const draftOwner=useRef<{id:string;revision:number;title:string;instruction:string;dirty:boolean}|null>(null);
  const [collapsedNodes,setCollapsedNodes]=useState<Set<string>>(()=>new Set());
  const [collapsedContentHeights,setCollapsedContentHeights]=useState<Record<string,number>>({});
  const [showInspector,setShowInspector]=useState(false); const [showList,setShowList]=useState(false);
  const [showPlan,setShowPlan]=useState(false); const [showSettings,setShowSettings]=useState(false);
  const [showShortcuts,setShowShortcuts]=useState(false);const [renameGroupId,setRenameGroupId]=useState<string|null>(null);
  const [search,setSearch]=useState(''); const [draftTitle,setDraftTitle]=useState(''); const [draftInstruction,setDraftInstruction]=useState('');
  const [name,setName]=useState(workflow?.name??''); const [notice,setNotice]=useState<string|null>(null);
  const [size,setSize]=useState({width:0,height:0}); const canvasRef=useRef<HTMLDivElement>(null);
  useMagneticPorts(canvasRef,viewport);
  const flow=useReactFlow<TaskFlowNode>(); const branches=props.branches??emptyItems;
  const activeBranch=branches.find(item=>item.id===props.activeBranchId); const executions=props.executions??emptyItems;
  const selectedTask=workflow?.nodes.find(node=>node.id===focusedNodeId);
  const selectedRoot=roots.find(root=>`catalog:${root.sessionId}`===focusedNodeId);
  const focusedNodeExists=Boolean(catalog?selectedRoot:selectedTask&&!selectedTask.hidden&&(!activeBranch||selectedTask.kind==='session'||activeBranch.nodeIds.includes(selectedTask.id)||!selectedTask.branchIds?.length));
  const selectedSessionId=selectedRoot?.sessionId??(selectedTask?.kind==='session'?selectedTask.sourceSessionId:undefined);
  useEffect(()=>{props.onContextTarget?.(showPlan?{planning:true}:selectedSessionId?{sessionId:selectedSessionId}:focusedNodeId&&focusedNodeExists?{nodeId:focusedNodeId}:null);},[props.onContextTarget,showPlan,selectedSessionId,focusedNodeId,focusedNodeExists,workflow?.id]);
  const selectedEdge=workflow?.edges.find(edge=>edge.id===selectedEdgeId);
  const nodeRuns=executions.filter(run=>run.nodeId===focusedNodeId&&executionVisibleInBranch(run,props.activeBranchId,branches,executions));
  const explicitRun=nodeRuns.find(run=>run.runId===selectedRunId);
  const selectedRun=explicitRun??nodeRuns.at(-1);
  // Backend routing can change the active automatic branch without a picker
  // change. Keep valid history choices; replace an invisible one immediately.
  const traceRunId=explicitRun?.runId??(traceNodeId===focusedNodeId?(nodeRuns.findLast(executionIsActive)??nodeRuns.at(-1))?.runId??null:null);
  const hasExecution=Boolean(selectedTask&&executions.some(run=>run.nodeId===selectedTask.id));
  const approved=Boolean(selectedTask&&saveState==='saved'&&draftTitle===selectedTask.title&&draftInstruction===selectedTask.instruction&&props.approvedNodeIds?.includes(selectedTask.id));
  const activeRun=nodeRuns.findLast(executionIsActive);
  const editLocked=executions.some(run=>run.nodeId===focusedNodeId&&executionIsActive(run));

  useEffect(()=>{setUtilityLive({});setFocusedUtilityId(null);setTracePins({});groupDrag.current=null;nodeDragGesture.current=null;lastNodeDragStop.current=null;lastCanvasPoint.current=undefined;draftOwner.current=null;setComposerNodeId(null);fileActivity.current.clear();setFileBusyNodeIds(new Set());setFocusedNodeId(null);setSelectedNodeIds(new Set());setTextEditor(null);setTextEditorError(undefined);setTraceNodeId(null);setSelectedRunId(null);setSelectedEdgeId(null);setContextMenu(null);setShowInspector(false);setInlineEditing(null);setShowPlan(false);setShowSettings(false);setShowShortcuts(false);setRenameGroupId(null);setCollapsedNodes(new Set());setCollapsedContentHeights({});setNotice(null);},[workflow?.id,catalog]);
  useEffect(()=>setName(workflow?.name??''),[workflow?.id,workflow?.name]);
  const storedViewport=catalog?props.catalogViewport:workflow?.viewport;
  useEffect(()=>setViewport(storedViewport??emptyViewport),[catalog,workflow?.id,storedViewport?.x,storedViewport?.y,storedViewport?.zoom]);
  useEffect(()=>{
    for(const root of roots){if(root.position)positionedCatalogRootIds.current.add(root.sessionId);else if(positionedCatalogRootIds.current.delete(root.sessionId))catalogPositions.current.delete(root.sessionId);}
    const positionedRoots=positionSessionRoots(roots.map(root=>({...root,position:root.position??catalogPositions.current.get(root.sessionId)})));
    for(const root of positionedRoots)catalogPositions.current.set(root.sessionId,root.position!);
    const tasks=catalog?positionedRoots.map((root,index)=>({task:{id:`catalog:${root.sessionId}`,title:root.title,instruction:root.preview??'',width:root.width,height:root.height,source:'user',status:'draft',revision:1,position:root.position??{x:120+index%4*390,y:150+Math.floor(index/4)*270}} as WorkflowNode,root})):(workflow?.nodes??[]).filter(task=>!task.hidden&&(!activeBranch||task.kind==='session'||activeBranch.nodeIds.includes(task.id)||!(task.branchIds?.length))).map(task=>({task,root:undefined}));
    setNodes(previous=>tasks.map(({task,root},order)=>{
      const local=previous.find(node=>node.id===task.id);
      return {...local,id:task.id,type:'task',selected:selectedNodeIds.has(task.id),width:local?.resizing?local.width:task.width??300,height:local?.resizing?local.height:task.height??210,position:local?.dragging?local.position:task.position,data:{task,root,order,focused:false,collapsed:false,menuOpen:false,t,onMenu:()=>{}}};
    }));
  },[workflow?.id,workflow?.nodes,catalog,roots,activeBranch]);
  useEffect(()=>{setSelectedNodeIds(previous=>{const visible=new Set(catalog?roots.map(root=>`catalog:${root.sessionId}`):(workflow?.nodes??[]).filter(node=>!node.hidden&&(!activeBranch||node.kind==='session'||activeBranch.nodeIds.includes(node.id)||!node.branchIds?.length)).map(node=>node.id));const next=new Set([...previous].filter(id=>visible.has(id)));return next.size===previous.size?previous:next;});},[catalog,roots,workflow?.nodes,activeBranch]);
  useEffect(()=>{if(!selectedTask){if(!focusedNodeId){draftOwner.current=null;setDraftTitle('');setDraftInstruction('');}return;}if(draftOwner.current?.id===selectedTask.id&&draftOwner.current.dirty)return;draftOwner.current={id:selectedTask.id,revision:selectedTask.revision,title:selectedTask.title,instruction:selectedTask.instruction,dirty:false};setDraftTitle(selectedTask.title);setDraftInstruction(selectedTask.instruction);},[workflow?.id,focusedNodeId,selectedTask?.title,selectedTask?.instruction,selectedTask?.revision,inlineEditing?.nodeId]);
  const inlineDirty=Boolean(selectedTask&&draftOwner.current?.id===selectedTask.id&&draftOwner.current.dirty&&(draftTitle!==selectedTask.title||draftInstruction!==selectedTask.instruction));
  useEffect(()=>{if(!inlineEditing)inlineBaseline.current=null;},[inlineEditing]);
  useEffect(()=>{if(!inlineDirty)return;const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect);},[inlineDirty]);
  useEffect(()=>{const owner=draftOwner.current;if(inlineEditing&&selectedTask&&owner?.id===selectedTask.id&&owner.dirty&&editorTextConflicts(selectedTask,owner))setNotice(t('inlineConflict'));},[inlineEditing?.nodeId,selectedTask?.revision,t]);
  useEffect(()=>{const element=canvasRef.current;if(!element)return;const observer=new ResizeObserver(([entry])=>{if(entry)setSize({width:entry.contentRect.width,height:entry.contentRect.height});});observer.observe(element);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(focusedNodeId&&!focusedNodeExists){setFocusedNodeId(null);setTraceNodeId(null);setInlineEditing(null);}},[focusedNodeId,focusedNodeExists]);
  useEffect(()=>{if(selectedRunId&&!explicitRun)setSelectedRunId(traceRunId);},[selectedRunId,explicitRun?.runId,traceRunId]);
  useEffect(()=>{if(traceNodeId&&traceRunId)void props.onReadTrace?.(traceRunId);},[traceNodeId,traceRunId]);
  const publish=useCallback((next:Workflow)=>{if(busy)return;workflowRef.current=next;onChangeWorkflow(next);},[onChangeWorkflow,busy]);
  const saveTask=useCallback((quiet=false):boolean=>{
    if(busy)return false;const current=workflowRef.current;if(!current||!focusedNodeId)return true;
    const task=current.nodes.find(node=>node.id===focusedNodeId);if(!task||task.kind==='session')return true;
    const owner=draftOwner.current;
    // Selecting a node never authorizes saving the previous node's editor state.
    if(owner?.id!==task.id||!owner.dirty)return true;
    if(task.title===draftTitle&&task.instruction===draftInstruction){owner.dirty=false;return true;}
    if(executions.some(run=>run.nodeId===task.id&&executionIsActive(run)))return false;
    if(editorTextConflicts(task,owner)){setNotice(t('inlineConflict'));return false;}
    if(!draftTitle.trim()){setNotice(t('titleRequired'));return false;}
    draftOwner.current={id:task.id,revision:task.revision,title:draftTitle.trim(),instruction:draftInstruction,dirty:false};
    publish({...current,nodes:current.nodes.map(node=>node.id===focusedNodeId?{...node,title:draftTitle.trim(),instruction:draftInstruction}:node)});
    if(!quiet)setNotice(t('taskSaved'));return true;
  },[focusedNodeId,draftTitle,draftInstruction,publish,t,busy,executions]);
  const focusNode=useCallback((id:string):boolean=>{setFocusedUtilityId(null);if(id!==focusedNodeId){if(!saveTask(true))return false;setInlineEditing(null);setTraceNodeId(null);setSelectedRunId(null);}const task=workflowRef.current?.nodes.find(node=>node.id===id);if(task&&(id!==focusedNodeId||draftOwner.current?.id!==id)){draftOwner.current={id,revision:task.revision,title:task.title,instruction:task.instruction,dirty:false};setDraftTitle(task.title);setDraftInstruction(task.instruction);}setFocusedNodeId(id);setSelectedEdgeId(null);setContextMenu(null);setNotice(null);return true;},[focusedNodeId,saveTask]);
  const focusUtility=(id:string)=>{if(!saveTask(true))return;setFocusedUtilityId(id);setFocusedNodeId(null);setSelectedNodeIds(new Set());setTraceNodeId(null);setComposerNodeId(null);setInlineEditing(null);setShowInspector(false);setSelectedEdgeId(null);setContextMenu(null);};
  const changeDraft=useCallback((field:'title'|'instruction',value:string)=>{const task=workflowRef.current?.nodes.find(node=>node.id===focusedNodeId);if(!task)return;const owner=draftOwner.current;if(owner?.id!==task.id||!owner.dirty)draftOwner.current={id:task.id,revision:task.revision,title:task.title,instruction:task.instruction,dirty:true};if(field==='title')setDraftTitle(value);else setDraftInstruction(value);},[focusedNodeId]);
  const changeDraftTitle=useCallback((value:string)=>changeDraft('title',value),[changeDraft]);
  const changeDraftInstruction=useCallback((value:string)=>changeDraft('instruction',value),[changeDraft]);
  const deleteTask=useCallback((id:string)=>{if(busy)return;const current=workflowRef.current;const task=current?.nodes.find(node=>node.id===id);if(!current||!task||task.kind==='session')return;if(props.onCanvasCommand){try{void Promise.resolve(props.onCanvasCommand('delete',{nodeIds:[id]})).then(()=>{setSelectedNodeIds(previous=>new Set([...previous].filter(item=>item!==id)));if(focusedNodeId===id){setFocusedNodeId(null);setTraceNodeId(null);}setContextMenu(null);}).catch(failure=>setNotice(failure instanceof Error?failure.message:String(failure)));}catch(failure){setNotice(failure instanceof Error?failure.message:String(failure));}return;}if(executions.some(run=>run.nodeId===id))return;const nodes=current.nodes.filter(node=>node.id!==id);publish({...current,nodes,edges:current.edges.filter(edge=>edge.source!==id&&edge.target!==id),groups:trimNodeGroups(current.groups??[],new Set(nodes.map(node=>node.id)))});if(focusedNodeId===id){setFocusedNodeId(null);setTraceNodeId(null);}setContextMenu(null);},[publish,focusedNodeId,executions,busy,props.onCanvasCommand]);
  const dependencyEditProtected=(targetIds:ReadonlySet<string>):boolean=>Boolean(workflowRef.current?.nodes.some(node=>targetIds.has(node.id)&&node.kind==='session')||executions.some(run=>targetIds.has(run.nodeId)&&(executionIsActive(run)||run.status==='unknown'||run.durability==='needs-reconcile'))||workflowRef.current?.operations?.some(operation=>['pending','needs-reconcile'].includes(operation.status)&&[...(operation.nodeIds??[]),...(operation.nodeId?[operation.nodeId]:[])].some(id=>targetIds.has(id))));
  const removeEdges=(ids:ReadonlySet<string>):boolean=>{if(busy||catalog||!saveTask(true))return false;const current=workflowRef.current;if(!current)return false;const edges=current.edges.filter(edge=>ids.has(edge.id));if(!edges.length)return false;if(dependencyEditProtected(new Set(edges.map(edge=>edge.target)))){setNotice(t('disconnectProtected'));return false;}publish({...current,edges:current.edges.filter(edge=>!ids.has(edge.id))});setSelectedEdgeId(null);setContextMenu(null);return true;};
  const removeEdge=(id:string)=>{removeEdges(new Set([id]));};
  const addTask=()=>{if(busy)return;const current=workflowRef.current;const element=canvasRef.current;if(!current||catalog){void onCreateWorkflow();return;}if(!element)return;if(!saveTask(true))return;const bounds=element.getBoundingClientRect();const origin=flow.screenToFlowPosition({x:bounds.left+130,y:bounds.top+160});let cell=0;let position={x:Math.round(origin.x),y:Math.round(origin.y)};const columns=Math.max(1,Math.floor(((bounds.width-230)/flow.getZoom()+80)/390));while(current.nodes.some(node=>position.x<node.position.x+(node.width??300)+30&&position.x+330>node.position.x&&position.y<node.position.y+(node.height??210)+30&&position.y+240>node.position.y)){cell++;position={x:Math.round(origin.x+cell%columns*390),y:Math.round(origin.y+Math.floor(cell/columns)*280)};}const task:WorkflowNode={id:`node-${crypto.randomUUID()}`,title:t('newNodeTitle'),instruction:'',source:'user',status:'draft',revision:1,position};publish({...workflowRef.current!,nodes:[...workflowRef.current!.nodes,task]});setFocusedNodeId(task.id);setSelectedNodeIds(new Set([task.id]));setTraceNodeId(null);setSelectedRunId(null);setSelectedEdgeId(null);setContextMenu(null);setShowInspector(false);inlineBaseline.current={id:task.id,revision:1};draftOwner.current={id:task.id,revision:1,title:task.title,instruction:task.instruction,dirty:false};setInlineEditing({nodeId:task.id,field:'title'});setDraftTitle(task.title);setDraftInstruction(task.instruction);setNotice(null);};
  const onConnect=(connection:Connection)=>{if(busy||!saveTask(true))return;const current=workflowRef.current;if(!current||!connection.source||!connection.target||catalog||!current.nodes.some(node=>node.id===connection.source)||!current.nodes.some(node=>node.id===connection.target))return;if(dependencyEditProtected(new Set([connection.target]))){setNotice(t('disconnectProtected'));return;}const problem=connectionError(current.edges,connection.source,connection.target);if(problem){setNotice(t(problem));return;}const edge:WorkflowEdge={id:`edge-${crypto.randomUUID()}`,source:connection.source,target:connection.target,type:'dependency'};publish({...current,edges:[...current.edges,edge]});setNotice(null);};
  const onNodesChange=useCallback((incoming:NodeChange<TaskFlowNode>[])=>{
    const utilityIds=new Set(workflowRef.current?.utilityNodes?.map(node=>node.id));
    const gesture=nodeDragGesture.current;
    const utilityChanges=incoming.filter(change=>'id' in change&&utilityIds.has(change.id));
    if(utilityChanges.length)setUtilityLive(previous=>{const next={...previous};for(const change of utilityChanges){if(change.type==='position'&&change.position)next[change.id]={...next[change.id],position:gesture?.offset&&gesture.ids.has(change.id)?{x:change.position.x+gesture.offset.x,y:change.position.y+gesture.offset.y}:change.position,dragging:change.dragging};else if(change.type==='dimensions'&&change.dimensions&&Number.isFinite(change.dimensions.width)&&Number.isFinite(change.dimensions.height)&&change.dimensions.width>=300&&change.dimensions.height>=220)next[change.id]={...next[change.id],width:Math.min(2400,change.dimensions.width),height:Math.min(1600,change.dimensions.height)};}return next;});
    const changes=incoming.filter(change=>!('id' in change&&utilityIds.has(change.id)));
    const adjusted=gesture?.offset?changes.map(change=>change.type==='position'&&change.position&&gesture.ids.has(change.id)?{...change,position:{x:change.position.x+gesture.offset!.x,y:change.position.y+gesture.offset!.y}}:change):changes;
    const selections=changes.filter(change=>change.type==='select');
    if(selections.length)setSelectedNodeIds(previous=>{const next=new Set(previous);for(const change of selections)if(change.type==='select'){change.selected?next.add(change.id):additiveBoxSelection.current?.has(change.id)?next.add(change.id):next.delete(change.id);}return next;});
    setNodes(previous=>applyNodeChanges(adjusted,previous));
  },[]);
  const onEdgesChange=useCallback((changes:EdgeChange[])=>{
    if(busy||boxSelecting.current)return;
    // React Flow emits keyboard selection through this public callback;
    // synchronize the same owned selection used by pointer actions and Delete.
    const selected=changes.findLast(change=>change.type==='select'&&change.selected);
    if(selected?.type==='select'){
      if(!saveTask(true))return;
      setInlineEditing(null);setSelectedEdgeId(selected.id);setFocusedNodeId(null);setTraceNodeId(null);setContextMenu(null);setShowInspector(true);
    }else setSelectedEdgeId(current=>current&&changes.some(change=>change.type==='select'&&change.id===current&&!change.selected)?null:current);
  },[saveTask,busy]);
  const commitNodePositions=(moved:readonly TaskFlowNode[])=>{
    if(busy||!moved.length)return;
    const utilities=moved.filter(node=>Boolean(node.data.utility));
    if(utilities.length){const current=workflowRef.current;if(current)publish({...current,utilityNodes:(current.utilityNodes??[]).map(item=>{const moved=utilities.find(node=>node.id===item.id);return moved?{...item,position:{...moved.position}}:item;})});setUtilityLive(previous=>{const next={...previous};for(const node of utilities)delete next[node.id];return next;});}
    moved=moved.filter(node=>!node.data.utility);
    const rootMoves=moved.flatMap(node=>node.data.root?[{sessionId:node.data.root.sessionId,position:{...node.position}}]:[]);
    for(const move of rootMoves)catalogPositions.current.set(move.sessionId,move.position);
    if(rootMoves.length){if(props.onMoveSessionRoots)props.onMoveSessionRoots(rootMoves);else for(const move of rootMoves)props.onMoveSessionRoot?.(move.sessionId,move.position);}
    const current=workflowRef.current;if(!current)return;
    const moves=moved.filter(node=>!node.data.root);const next=applyNodePositions(current.nodes,moves);
    if(next.some((node,index)=>node!==current.nodes[index]))publish({...current,nodes:next});
  };
  const startNodeDrag=(event:DragPointerEvent,node:TaskFlowNode,moved:TaskFlowNode[])=>{
    if(!saveTask(true))return;setComposerNodeId(null);
    const gesture=nodeDragGesture.current;const touch=event.touches?.[0];const pointer=typeof event.clientX==='number'&&typeof event.clientY==='number'?{x:event.clientX,y:event.clientY}:touch?{x:touch.clientX,y:touch.clientY}:undefined;
    if(gesture&&!gesture.offset&&pointer){const point=flow.screenToFlowPosition(pointer);gesture.offset={x:point.x-gesture.start.x,y:point.y-gesture.start.y};gesture.ids=new Set((moved.length?moved:[node]).map(item=>item.id));const offset=gesture.offset;if(Boolean(node.data.utility))setUtilityLive(previous=>({...previous,[node.id]:{...previous[node.id],position:{x:node.position.x+offset.x,y:node.position.y+offset.y},dragging:true}}));setNodes(previous=>previous.map(item=>gesture.ids.has(item.id)?{...item,position:{x:item.position.x+offset.x,y:item.position.y+offset.y},dragging:true}:item));}
    if(!node.data.utility&&focusedNodeId!==node.id)focusNode(node.id);setContextMenu(null);
  };
  const finishNodeDrag=(event:object,moved:readonly TaskFlowNode[])=>{
    if(lastNodeDragStop.current===event)return;lastNodeDragStop.current=event;const gesture=nodeDragGesture.current;nodeDragGesture.current=null;
    const corrected=moved.map(node=>gesture?.offset&&gesture.ids.has(node.id)?{...node,dragging:false,position:{x:node.position.x+gesture.offset.x,y:node.position.y+gesture.offset.y}}:{...node,dragging:false});const positions=new Map(corrected.map(node=>[node.id,node.position]));setNodes(previous=>previous.map(node=>positions.has(node.id)?{...node,position:positions.get(node.id)!,dragging:false}:node));commitNodePositions(corrected);
  };
  const resizeNode=useCallback((id:string,size:{width:number;height:number})=>{
    if(busy)return;
    const width=Math.min(1200,Math.max(240,Math.round(size.width)));const height=Math.min(1000,Math.max(180,Math.round(size.height)));
    setNodes(previous=>previous.map(node=>node.id===id?{...node,width,height}:node));
    const root=roots.find(item=>`catalog:${item.sessionId}`===id);
    if(root){props.onResizeSessionRoot?.(root.sessionId,{width,height});return;}
    const current=workflowRef.current;if(current)publish({...current,nodes:current.nodes.map(node=>node.id===id?{...node,width,height}:node)});
  },[busy,roots,props.onResizeSessionRoot,publish]);
  const runNode=useCallback((id:string)=>{if(busy||[...fileActivity.current.values()].includes(id)||!saveTask(true))return;setInlineEditing(null);if(!focusNode(id))return;void props.onRunNode?.(id,props.activeBranchId??undefined);},[busy,saveTask,focusNode,props.onRunNode,props.activeBranchId]);
  const startInline=useCallback((id:string,field:InlineField)=>{
    if(focusedNodeId===id&&!inlineEditing&&!saveTask(true))return;
    const task=workflowRef.current?.nodes.find(item=>item.id===id);
    if(busy||catalog||!task||task.kind==='session'||executions.some(run=>run.nodeId===id&&executionIsActive(run))){focusNode(id);return;}
    if(inlineEditing?.nodeId!==id){if(!focusNode(id))return;inlineBaseline.current={id,revision:task.revision};draftOwner.current={id,revision:task.revision,title:task.title,instruction:task.instruction,dirty:false};setDraftTitle(task.title);setDraftInstruction(task.instruction);}
    setCollapsedNodes(previous=>{if(!previous.has(id))return previous;const next=new Set(previous);next.delete(id);return next;});
    setSelectedNodeIds(previous=>previous.has(id)?previous:new Set([id]));setInlineEditing({nodeId:id,field});setShowInspector(false);setContextMenu(null);
  },[busy,catalog,executions,inlineEditing,focusedNodeId,saveTask,focusNode]);
  const commitInline=useCallback(()=>{if(!draftTitle.trim()){setNotice(t('titleRequired'));return;}if(saveTask(true)){inlineBaseline.current=null;setInlineEditing(null);}},[draftTitle,saveTask,t]);
  const cancelInline=useCallback(()=>{const task=workflowRef.current?.nodes.find(item=>item.id===inlineEditing?.nodeId);draftOwner.current=task?{id:task.id,revision:task.revision,title:task.title,instruction:task.instruction,dirty:false}:null;setDraftTitle(task?.title??'');setDraftInstruction(task?.instruction??'');inlineBaseline.current=null;setInlineEditing(null);},[inlineEditing?.nodeId]);
  const openContextMenu=useCallback((nodeId:string|undefined,point:MenuPoint)=>{
    const target=document.elementFromPoint?.(point.clientX,point.clientY);
    if(target?.closest('input,textarea,select,[contenteditable="true"]'))return;
    if(!saveTask(true))return;setInlineEditing(null);inlineBaseline.current=null;if(nodeId&&!focusNode(nodeId))return;if(nodeId)setSelectedNodeIds(previous=>previous.has(nodeId)?previous:new Set([nodeId]));
    const bounds=canvasRef.current?.getBoundingClientRect();if(!bounds)return;
    setContextMenu({nodeId,x:point.clientX-bounds.left,y:point.clientY-bounds.top,flowPosition:flow.screenToFlowPosition({x:point.clientX,y:point.clientY})});
  },[saveTask,focusNode,flow]);
  const openUtilityContextMenu=useCallback((id:string,point:MenuPoint)=>{
    if(rightGesture.current?.moved||!saveTask(true))return;
    const current=workflowRef.current;if(!current?.utilityNodes?.some(node=>node.id===id))return;
    const bounds=canvasRef.current?.getBoundingClientRect();if(!bounds)return;
    setFocusedUtilityId(id);setFocusedNodeId(null);setSelectedNodeIds(new Set());setTraceNodeId(null);setComposerNodeId(null);setInlineEditing(null);setShowInspector(false);setSelectedEdgeId(null);
    setContextMenu({utilityId:id,x:point.clientX-bounds.left,y:point.clientY-bounds.top,flowPosition:flow.screenToFlowPosition({x:point.clientX,y:point.clientY})});
  },[saveTask,flow]);
  const openPortMenu=useCallback((id:string,port:'input'|'output',point:MenuPoint)=>{if(rightGesture.current?.moved||!saveTask(true))return;setInlineEditing(null);if(!focusNode(id))return;const bounds=canvasRef.current?.getBoundingClientRect();if(bounds)setContextMenu({nodeId:id,port,x:point.clientX-bounds.left,y:point.clientY-bounds.top,flowPosition:flow.screenToFlowPosition({x:point.clientX,y:point.clientY})});},[saveTask,focusNode,flow]);
  const toggleCollapsed=useCallback((id:string)=>{if(busy||!saveTask(true))return;setInlineEditing(null);if(!focusNode(id))return;setSelectedNodeIds(previous=>previous.has(id)?previous:new Set([id]));setContextMenu(null);setCollapsedNodes(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);return next;});},[busy,saveTask,focusNode]);
  const openTextEditor=useCallback((id:string)=>{
    if(!saveTask(true))return;setComposerNodeId(null);const task=workflowRef.current?.nodes.find(node=>node.id===id);
    const source=roots.find(root=>`catalog:${root.sessionId}`===id);if(!task&&!source)return;
    focusNode(id);setInlineEditing(null);setContextMenu(null);setTextEditorError(undefined);
    setTextEditor({nodeId:id,title:source?.title??task!.title,instruction:source?.preview??task!.instruction,revision:task?.revision??1,readOnly:Boolean(source||task?.kind==='session'||executions.some(run=>run.nodeId===id&&executionIsActive(run)))});
  },[saveTask,roots,executions,focusNode]);
  const saveTextEditor=(instruction:string)=>{
    if(!textEditor)return;
    if(busy){setTextEditorError(t('saving'));return;}
    if(textEditor.readOnly){setTextEditorError(t('nativeSourceProtected'));return;}
    const current=workflowRef.current;const task=current?.nodes.find(node=>node.id===textEditor.nodeId);
    if(!task){setTextEditorError(t('missingError'));return;}
    if(task.kind==='session'){setTextEditorError(t('nativeSourceProtected'));return;}
    if(executions.some(run=>run.nodeId===task.id&&executionIsActive(run))){setTextEditorError(t('inlineConflict'));return;}
    if(editorTextConflicts(task,textEditor)){setTextEditorError(t('inlineConflict'));return;}
    if(task.instruction!==instruction)publish({...current!,nodes:current!.nodes.map(node=>node.id===task.id?{...node,instruction}:node)});
    setTextEditor(null);setTextEditorError(undefined);setDraftInstruction(instruction);
  };
  const measureCollapsedContent=useCallback((id:string,height:number)=>{if(height<=0||!Number.isFinite(height))return;setCollapsedContentHeights(previous=>previous[id]===height?previous:{...previous,[id]:height});},[]);
  const runnableSelection=runnableSelectedNodeIds(catalog?[]:workflow?.nodes??[],selectedNodeIds,executions);
  const selectionFilesBusy=runnableSelection.some(id=>fileBusyNodeIds.has(id));
  const unavailableSelectionModel=runnableSelection.some(id=>!modelChoiceAvailable(workflow?.nodes.find(node=>node.id===id)?.model,props.modelOptions,props.modelAvailable));
  const showPauseAll=submittedSelection===selectionKey;
  const hasActiveWork=executions.some(executionIsActive)||(props.plans??[]).some(plan=>plan.status==='running');
  const pauseAll=()=>{if(busy||!hasActiveWork||!props.onPauseAll)return;void Promise.resolve(props.onPauseAll()).catch(failure=>setNotice(failure instanceof Error?failure.message:String(failure)));};
  const runSelected=()=>{if(selectionFilesBusy||busy||props.runtimeReady===false||props.modelsLoading||unavailableSelectionModel||!runnableSelection.length||!props.onRunNodes||!saveTask(true))return;setInlineEditing(null);setSubmittedSelection(selectionKey);try{void Promise.resolve(props.onRunNodes(runnableSelection,props.activeBranchId??undefined)).catch(failure=>{setSubmittedSelection(current=>current===selectionKey?null:current);setNotice(failure instanceof Error?failure.message:String(failure));});}catch(failure){setSubmittedSelection(null);setNotice(failure instanceof Error?failure.message:String(failure));}};
  const changeNodeModel=useCallback((id:string,value:string|undefined)=>{if([...fileActivity.current.values()].includes(id)||busy||!props.onSelectNodeModel||executions.some(run=>run.nodeId===id&&executionIsActive(run))||!saveTask(true))return;setInlineEditing(null);try{void Promise.resolve(props.onSelectNodeModel(id,value)).catch(failure=>setNotice(failure instanceof Error?failure.message:String(failure)));}catch(failure){setNotice(failure instanceof Error?failure.message:String(failure));}},[busy,props.onSelectNodeModel,executions,saveTask]);
  const changeGlobalModel=(value:string|undefined)=>{if(busy||catalog||!saveTask(true))return;setInlineEditing(null);try{void Promise.resolve(props.onSelectGlobalModel?.(value)).catch(failure=>setNotice(failure instanceof Error?failure.message:String(failure)));}catch(failure){setNotice(failure instanceof Error?failure.message:String(failure));}};
  const changeSubagentMode=(value:SubagentMode)=>{if(busy||catalog)return;setInlineEditing(null);try{void Promise.resolve(props.onChangeSubagentMode?.(value)).catch(failure=>setNotice(failure instanceof Error?failure.message:String(failure)));}catch(failure){setNotice(failure instanceof Error?failure.message:String(failure));}};
  const uploadNodeFiles=useCallback<NonNullable<WorkflowRuntimeProps['onUploadFiles']>>(async(id,files,signal,onProgress)=>{
    if(!saveTask(true))throw new Error(t('inlineConflict'));
    if(!props.onUploadFiles)throw new Error(t('fileUploadUnavailable'));
    await props.onUploadFiles(id,files,signal,onProgress);
  },[saveTask,props.onUploadFiles,t]);
  const removeNodeFile=useCallback<NonNullable<WorkflowRuntimeProps['onRemoveFile']>>(async(id,fileId)=>{
    if(!saveTask(true))throw new Error(t('inlineConflict'));
    if(!props.onRemoveFile)throw new Error(t('fileUploadUnavailable'));
    await props.onRemoveFile(id,fileId);
  },[saveTask,props.onRemoveFile,t]);
  const toggleTracePin=useCallback((nodeId:string,runId:string|null)=>{
    if(tracePins[nodeId]){
      setTracePins(previous=>{const next={...previous};delete next[nodeId];return next;});
      if(focusedNodeId===nodeId){setTraceNodeId(nodeId);setSelectedRunId(runId);if(runId)props.onSelectExecution?.(runId);}return;
    }
    if(runId)void props.onReadTrace?.(runId);setTracePins(previous=>({...previous,[nodeId]:{runId}}));
  },[tracePins,focusedNodeId,props.onReadTrace,props.onSelectExecution]);
  const closePinnedTrace=useCallback((nodeId:string)=>{setTracePins(previous=>{const next={...previous};delete next[nodeId];return next;});setTraceNodeId(previous=>previous===nodeId?null:previous);},[]);
  const selectPinnedRun=(nodeId:string,runId:string)=>{setTracePins(previous=>({...previous,[nodeId]:{runId}}));void props.onReadTrace?.(runId);};
  const renderedNodes=useMemo(()=>nodes.filter(node=>!node.data.task.hidden&&(!search||`${node.data.task.title} ${node.data.task.instruction}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))).map((node,order)=>{const collapsed=collapsedNodes.has(node.id);const displayHeight=collapsed?compactNodeHeight(collapsedContentHeights[node.id]??estimateQuestionHeight(node.data.task.instruction||node.data.root?.preview||"",node.width??300),node.data.task.height??node.height??210):node.resizing?node.height??210:node.data.task.height??node.height??210;return {...node,height:displayHeight,measured:node.measured?{...node.measured,height:displayHeight}:undefined,selected:selectedNodeIds.has(node.id),zIndex:node.data.root?.zIndex??node.data.task.zIndex??0,data:{...node.data,pendingApprovalCount:pendingApprovalCounts.get(node.id)??0,onOpenApprovals:openApprovals,pendingQuestionCount:pendingQuestionCounts.get(node.id)??0,waitingQuestionCount:waitingQuestionCounts.get(node.id)??0,onOpenQuestions:openQuestions,onPortMenu:openPortMenu,onCollapse:toggleCollapsed,order,selected:selectedNodeIds.has(node.id),focused:node.id===focusedNodeId,collapsed,onCollapsedContentHeight:measureCollapsedContent,menuOpen:contextMenu?.nodeId===node.id,t,busy,filesBusy:fileBusyNodeIds.has(node.id),onFilesBusyChange:trackCardFiles,editLocked:executions.some(run=>run.nodeId===node.id&&executionIsActive(run)),editingField:inlineEditing?.nodeId===node.id?inlineEditing.field:undefined,editTitle:draftTitle,editInstruction:draftInstruction,onOpenTextEditor:openTextEditor,onTitleChange:changeDraftTitle,onInstructionChange:changeDraftInstruction,onStartEditing:startInline,onCommitEditing:commitInline,onCancelEditing:cancelInline,approved:props.approvedNodeIds?.includes(node.id),hasExecution:executions.some(run=>run.nodeId===node.id),onResizeNode:resizeNode,onRunNode:runNode,onCancelNode:props.onCancelExecution,onUploadFiles:props.onUploadFiles?uploadNodeFiles:undefined,onRemoveFile:props.onRemoveFile?removeNodeFile:undefined,modelOptions:props.modelOptions,modelsLoading:props.modelsLoading,modelsError:props.modelsError,globalModelId:props.globalModelId,defaultModelLabel:props.defaultModelLabel,modelAvailable:props.modelAvailable,runtimeReady:props.runtimeReady,onSelectNodeModel:changeNodeModel,reasoningForNodeOption:props.reasoningForNodeOption,onNodeReasoningChange:props.onNodeReasoningChange,activeExecution:executions.filter(run=>run.nodeId===node.id&&executionVisibleInBranch(run,props.activeBranchId,branches,executions)&&executionIsActive(run)).at(-1),execution:executions.filter(run=>run.nodeId===node.id&&run.nodeRevision===node.data.task.revision&&executionVisibleInBranch(run,props.activeBranchId,branches,executions)).at(-1),sharedBranchCount:branches.filter(branch=>branch.nodeIds.includes(node.id)).length,onMenu:(id:string,point:MenuPoint)=>openContextMenu(id,point),onOpenSession:props.onOpenSession,onImportSession:(sessionId:string)=>{void props.onImportSession?.(sessionId);}}}}),[nodes,pendingApprovalCounts,openApprovals,pendingQuestionCounts,waitingQuestionCounts,openQuestions,openPortMenu,toggleCollapsed,focusedNodeId,selectedNodeIds,openTextEditor,collapsedNodes,collapsedContentHeights,measureCollapsedContent,contextMenu?.nodeId,inlineEditing,draftTitle,draftInstruction,changeDraftTitle,changeDraftInstruction,startInline,commitInline,cancelInline,openContextMenu,t,search,props.approvedNodeIds,executions,branches,props.activeBranchId,props.onOpenSession,props.onImportSession,busy,resizeNode,runNode,props.onCancelExecution,props.onUploadFiles,props.onRemoveFile,uploadNodeFiles,removeNodeFile,fileBusyNodeIds,trackCardFiles,props.modelOptions,props.modelsLoading,props.modelsError,props.globalModelId,props.defaultModelLabel,props.modelAvailable,props.runtimeReady,changeNodeModel,props.reasoningForNodeOption,props.onNodeReasoningChange]);
  const visibleIds=new Set(renderedNodes.map(node=>node.id));
  const sourceGroups=catalog?props.catalogGroups??emptyItems:workflow?.groups??emptyItems;
  const visibleGroups=sourceGroups.map(group=>({...group,nodeIds:group.nodeIds.filter(id=>visibleIds.has(id))})).filter(group=>group.nodeIds.length>0);
  const visibleSelection=new Set([...selectedNodeIds].filter(id=>visibleIds.has(id)));
  const selectedGroup=visibleGroups.find(group=>group.nodeIds.length===visibleSelection.size&&group.nodeIds.every(id=>visibleSelection.has(id)));
  const selectionBounds=nodeSelectionBounds(renderedNodes,visibleSelection);
  const changeGroups=(groups:WorkflowGroup[])=>{if(busy)return;if(catalog){props.onChangeCatalogGroups?.(groups);return;}const current=workflowRef.current;if(current)publish({...current,groups});};
  const selectGroup=(group:WorkflowGroup):boolean=>{if(!saveTask(true))return false;setInlineEditing(null);setSelectedNodeIds(new Set(group.nodeIds));setFocusedNodeId(null);setTraceNodeId(null);setSelectedEdgeId(null);setContextMenu(null);setShowInspector(false);return true;};
  const openGroupMenu=(group:WorkflowGroup,point:MenuPoint)=>{if(rightGesture.current?.moved||!selectGroup(group))return;const bounds=canvasRef.current?.getBoundingClientRect();if(bounds)setContextMenu({groupId:group.id,x:point.clientX-bounds.left,y:point.clientY-bounds.top,flowPosition:flow.screenToFlowPosition({x:point.clientX,y:point.clientY})});};
  const makeGroup=()=>{if(busy||visibleSelection.size<2||!saveTask(true))return;setInlineEditing(null);changeGroups(createNodeGroup(sourceGroups,[...visibleSelection],{id:`group-${crypto.randomUUID()}`,title:t('newGroupName',{count:sourceGroups.length+1})}));};
  const ungroup=(id:string)=>{if(busy||!saveTask(true))return;setInlineEditing(null);changeGroups(sourceGroups.filter(group=>group.id!==id));};
  const renameGroup=(id:string,title:string)=>{if(busy||!title.trim()||!saveTask(true))return;setInlineEditing(null);changeGroups(sourceGroups.map(group=>group.id===id?{...group,title:title.trim().slice(0,128)}:group));};
  const startGroupDrag=(group:WorkflowGroup):boolean=>{if(busy)return false;groupDrag.current={nodes:nodes.filter(node=>group.nodeIds.includes(node.id)).map(node=>({...node,position:{...node.position}})),delta:{x:0,y:0}};return true;};
  const moveGroup=(delta:{x:number;y:number})=>{const gesture=groupDrag.current;if(!gesture)return;gesture.delta=delta;const positions=new Map(gesture.nodes.map(node=>[node.id,{x:node.position.x+delta.x,y:node.position.y+delta.y}]));setNodes(previous=>previous.map(node=>positions.has(node.id)?{...node,position:positions.get(node.id)!,dragging:true}:node));};
  const endGroupDrag=(cancelled:boolean)=>{const gesture=groupDrag.current;if(!gesture)return;groupDrag.current=null;if(cancelled&&gesture.delta.x===0&&gesture.delta.y===0)return;const moved=gesture.nodes.map(node=>({...node,dragging:false,position:cancelled?node.position:{x:node.position.x+gesture.delta.x,y:node.position.y+gesture.delta.y}}));const positions=new Map(moved.map(node=>[node.id,node.position]));setNodes(previous=>previous.map(node=>positions.has(node.id)?{...node,position:positions.get(node.id)!,dragging:false}:node));if(!cancelled)commitNodePositions(moved);};
  const layoutSelection=(kind:SelectionLayout,nodeIds?:readonly string[])=>{const selection=nodeIds?new Set(nodeIds.filter(id=>visibleIds.has(id))):visibleSelection;if(busy||selection.size<2||!saveTask(true))return;setInlineEditing(null);beginLayoutMotion();const arranged=layoutNodeSelection(renderedNodes,selection,kind);const moved=arranged.filter(node=>selection.has(node.id));setNodes(previous=>applyNodePositions(previous,moved));commitNodePositions(moved);setContextMenu(null);};
  const changeUtility=useCallback((id:string,patch:Partial<WorkflowUtilityNode>)=>{const current=workflowRef.current;if(!current||busy)return;publish({...current,utilityNodes:(current.utilityNodes??[]).map(node=>node.id===id?{...node,...patch,id:node.id,...('width' in patch?{width:Math.min(2400,Math.max(300,Math.round(Number.isFinite(patch.width)?patch.width!:node.width)))}:{}),...('height' in patch?{height:Math.min(1600,Math.max(220,Math.round(Number.isFinite(patch.height)?patch.height!:node.height)))}:{})}:node)});setUtilityLive(previous=>{const next={...previous};delete next[id];return next;});},[publish,busy]);
  const removeUtility=useCallback((id:string)=>{const current=workflowRef.current;if(current&&!busy){publish({...current,utilityNodes:(current.utilityNodes??[]).filter(node=>node.id!==id)});setFocusedUtilityId(previous=>previous===id?null:previous);}},[publish,busy]);
  // The native resizer reads measured at pointerdown. Retain explicit utility
  // dimensions when React Flow adopts a fresh controlled node after polling.
  const utilityFlowNodes:TaskFlowNode[]=catalog?[]:(workflow?.utilityNodes??[]).map(utility=>{
    const width=utilityLive[utility.id]?.width??utility.width,height=utilityLive[utility.id]?.height??utility.height;
    return {id:utility.id,type:'utility',position:utilityLive[utility.id]?.position??utility.position,width,height,measured:{width,height},dragging:utilityLive[utility.id]?.dragging,selected:focusedUtilityId===utility.id,draggable:!busy,selectable:false,connectable:false,deletable:false,dragHandle:focusedUtilityId===utility.id?'.wf-utility-drag':'.wf-utility',data:{utility,focused:focusedUtilityId===utility.id,onFocusUtility:focusUtility,workflowId:workflow!.id,sessions:roots,defaultSessionId:activeBranch?.sessionId??workflow?.sourceSessionId,bridge:props.nativeUtilityBridge,onChangeUtility:changeUtility,onRemoveUtility:removeUtility,busy,task:{id:utility.id,title:utility.title,instruction:'',source:'user',status:'draft',revision:1,position:utility.position},order:0,collapsed:false,t,onMenu:openUtilityContextMenu}} as unknown as TaskFlowNode;
  });
  const addUtility=(at?:{x:number;y:number})=>{
    if(busy||catalog||!workflowRef.current||!saveTask(true))return;
    const current=workflowRef.current,rect=canvasRef.current?.getBoundingClientRect();
    const origin=at??flow.screenToFlowPosition({x:(rect?.left??0)+Math.max(150,(rect?.width??1000)/2-260),y:(rect?.top??0)+Math.max(180,(rect?.height??800)/2-180)});
    let position={x:Math.round(origin.x),y:Math.round(origin.y)};
    if(!at)while((current.utilityNodes??[]).some(node=>Math.abs(node.position.x-position.x)<32&&Math.abs(node.position.y-position.y)<32))position={x:position.x+40,y:position.y+40};
    const id=`utility-${crypto.randomUUID()}`;
    publish({...current,utilityNodes:[...(current.utilityNodes??[]),{id,title:t('utilityNode'),position,width:600,height:420,activeTool:'files'}]});focusUtility(id);
  };
  const renderedEdges:Edge[]=catalog?[]:(workflow?.edges??[]).filter(edge=>visibleIds.has(edge.source)&&visibleIds.has(edge.target)).map(edge=>({...edge,type:'workflow',zIndex:-1,selected:edge.id===selectedEdgeId,style:{stroke:edge.id===selectedEdgeId?'#b7caff':'#686868',strokeWidth:1.6},markerEnd:{type:MarkerType.ArrowClosed,color:edge.id===selectedEdgeId?'#b7caff':'#686868',width:15,height:15}}));
  const saveViewport=(_event:unknown,next:FlowViewport)=>{if(catalog){props.onMoveCatalogViewport?.(next);return;}const current=workflowRef.current;if(current&&(current.viewport.x!==next.x||current.viewport.y!==next.y||current.viewport.zoom!==next.zoom))publish({...current,viewport:next});};
  const layout=()=>{if(busy)return;beginLayoutMotion();if(catalog){const moves=positionSessionRoots(renderedNodes.flatMap(node=>node.data.root?[{...node.data.root,width:node.width,height:node.height,position:undefined}]:[])).map(root=>({sessionId:root.sessionId,position:root.position!}));if(props.onMoveSessionRoots)props.onMoveSessionRoots(moves);else moves.forEach(move=>props.onMoveSessionRoot?.(move.sessionId,move.position));void flow.fitView({padding:.18,duration:180,maxZoom:1});return;}const current=workflowRef.current;if(!current||!renderedNodes.length||!saveTask(true))return;const visible=renderedNodes.map(node=>({...node.data.task,width:node.width,height:node.height,position:node.position}));const arranged=arrangeNodes(visible,current.edges.filter(edge=>visibleIds.has(edge.source)&&visibleIds.has(edge.target)));const maxX=Math.max(...arranged.map(node=>node.position.x+(node.width??nodeWidth)));const maxY=Math.max(...arranged.map(node=>node.position.y+(node.height??210)));const width=maxX-100;const height=maxY-90;const zoom=Math.max(.2,Math.min(1,(size.width-230)/Math.max(width,1),(size.height-230)/Math.max(height,1)));publish({...workflowRef.current!,nodes:applyNodePositions(workflowRef.current!.nodes,arranged),viewport:{x:(size.width-width*zoom)/2-100*zoom,y:(size.height-height*zoom)/2-90*zoom,zoom}});setContextMenu(null);};
  const openTrace=()=>{const run=explicitRun??nodeRuns.findLast(item=>executionIsActive(item))??nodeRuns.at(-1);const runId=run?.runId??null;setSelectedRunId(runId);if(runId)props.onSelectExecution?.(runId);setTraceNodeId(focusedNodeId);setContextMenu(null);};
  const selectRun=(runId:string)=>{setSelectedRunId(runId);props.onSelectExecution?.(runId);};
  const commitName=()=>{if(busy)return;if(workflow&&name.trim()&&name.trim()!==workflow.name)onRenameWorkflow(workflow.id,name.trim());else if(workflow)setName(workflow.name);};
  const createAt=(position:{x:number;y:number},content:{title:string;instruction:string})=>{
    if(busy||catalog||!workflowRef.current)return;if(!saveTask(true))return;
    const current=workflowRef.current!;const draft=createTaskDraft(content,{x:Math.round(position.x),y:Math.round(position.y)});
    const top=Math.max(0,...current.nodes.map(node=>node.zIndex??0));
    const ordered=top>=999999?[...current.nodes].sort((a,b)=>(a.zIndex??0)-(b.zIndex??0)).map((node,index)=>({...node,zIndex:index})):current.nodes;
    draft.zIndex=top>=999999?ordered.length:top+1;
    publish({...current,nodes:[...ordered,draft]});setFocusedNodeId(draft.id);setSelectedNodeIds(new Set([draft.id]));setTraceNodeId(null);setSelectedRunId(null);setSelectedEdgeId(null);setContextMenu(null);setShowInspector(false);setDraftTitle(draft.title);setDraftInstruction(draft.instruction);inlineBaseline.current={id:draft.id,revision:1};draftOwner.current={id:draft.id,revision:1,title:draft.title,instruction:draft.instruction,dirty:false};setInlineEditing({nodeId:draft.id,field:'title'});
  };
  const canvasCommand=async(command:CanvasCommand,position?:{x:number;y:number},nodeIds?:readonly string[])=>{
    if(busy||!props.onCanvasCommand||command==='undo'&&props.canUndo===false||command==='redo'&&props.canRedo===false||!saveTask(true))return;
    setInlineEditing(null);setContextMenu(null);const view=activeCanvasRef.current;
    const bounds=canvasRef.current?.getBoundingClientRect();
    const target=position??lastCanvasPoint.current??(bounds?flow.screenToFlowPosition({x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2}):undefined);
    const selected=[...selectedNodeIds].filter(id=>visibleIds.has(id));const commandIds=nodeIds??(selected.length?selected:focusedNodeId&&visibleIds.has(focusedNodeId)?[focusedNodeId]:[]);
    try{const ids=await props.onCanvasCommand(command,{nodeIds:commandIds,position:target});if(ids&&activeCanvasRef.current===view){setSelectedNodeIds(new Set(ids));setFocusedNodeId(null);setTraceNodeId(null);setSelectedEdgeId(null);setShowInspector(false);}}catch(failure){setNotice(failure instanceof Error?failure.message:String(failure));}
  };
  const handleCanvasShortcut=(action:CanvasShortcut)=>{setFocusedUtilityId(null);
    if(action==='help'){setShowShortcuts(true);return;}
    if(action==='fitAll'){void flow.fitView({padding:.2,duration:180,maxZoom:1});return;}
    if(action==='fitSelected'){const selected=renderedNodes.filter(node=>selectedNodeIds.has(node.id));if(selected.length)void flow.fitView({nodes:selected,padding:.22,duration:180,maxZoom:1});return;}
    if(action==='selectAll'){if(!saveTask(true))return;setInlineEditing(null);setSelectedNodeIds(new Set(renderedNodes.map(node=>node.id)));setFocusedNodeId(null);setTraceNodeId(null);setSelectedEdgeId(null);setContextMenu(null);setShowInspector(false);return;}
    if(action==='group'){makeGroup();return;}
    if(action==='ungroup'){if(busy||!saveTask(true))return;const targets=new Set(visibleGroups.filter(group=>group.nodeIds.some(id=>selectedNodeIds.has(id))).map(group=>group.id));if(targets.size)changeGroups(sourceGroups.filter(group=>!targets.has(group.id)));return;}
    if(action==='rename'){if(selectedGroup&&!focusedNodeId){setRenameGroupId(selectedGroup.id);return;}const id=focusedNodeId&&visibleIds.has(focusedNodeId)?focusedNodeId:visibleSelection.size===1?[...visibleSelection][0]:undefined;if(id)startInline(id,'title');return;}
    if(action==='delete'&&selectedEdgeId){removeEdge(selectedEdgeId);return;}
    void canvasCommand(action);
  };
  const commandEntry=useRef({editorOpen:Boolean(textEditor)||showShortcuts,menuOpen:Boolean(contextMenu),invoke:handleCanvasShortcut});commandEntry.current={editorOpen:Boolean(textEditor)||showShortcuts,menuOpen:Boolean(contextMenu),invoke:handleCanvasShortcut};
  useEffect(()=>{
    const bodyShortcut=(event:KeyboardEvent)=>{const current=commandEntry.current;if(current.editorOpen||current.menuOpen||event.target!==document.body&&event.target!==document.documentElement)return;const command=canvasShortcut(event);if(!command)return;event.preventDefault();event.stopPropagation();if(!event.repeat)current.invoke(command);};
    const deleteShortcut=(event:KeyboardEvent)=>{const current=commandEntry.current,target=event.target as Element|null;if(event.key!=='Delete'||current.editorOpen||current.menuOpen||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||!target)return;const panel=canvasRef.current?.closest('[data-testid="workflow-panel"]');if(!panel?.contains(target)||target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="dialog"],[role="menu"],[role="listbox"],[role="combobox"]'))return;event.preventDefault();event.stopPropagation();if(!event.repeat)current.invoke('delete');};
    document.addEventListener('keydown',bodyShortcut);document.addEventListener('keydown',deleteShortcut,true);return()=>{document.removeEventListener('keydown',bodyShortcut);document.removeEventListener('keydown',deleteShortcut,true);};
  },[]);
  const menuTask=contextMenu?.nodeId?workflow?.nodes.find(node=>node.id===contextMenu.nodeId):undefined;
  const menuUtility=contextMenu?.utilityId?workflow?.utilityNodes?.find(node=>node.id===contextMenu.utilityId):undefined;
  const menuRoot=contextMenu?.nodeId?roots.find(root=>`catalog:${root.sessionId}`===contextMenu.nodeId):undefined;
  const menuGroup=contextMenu?.groupId?visibleGroups.find(group=>group.id===contextMenu.groupId):undefined;
  const menuIds=menuGroup?.nodeIds??(contextMenu?.nodeId?[contextMenu.nodeId]:[]);
  const menuSessionId=menuRoot?.sessionId??(menuTask?.kind==='session'?menuTask.sourceSessionId:undefined);
  const menuIsSource=Boolean(menuSessionId||menuGroup&&catalog||menuGroup?.nodeIds.some(id=>workflow?.nodes.find(node=>node.id===id)?.kind==='session'));
  const menuLocked=executions.some(run=>menuIds.includes(run.nodeId)&&executionIsActive(run));
  const menuHistoryUncertain=Boolean(executions.some(run=>menuIds.includes(run.nodeId)&&(run.status==='unknown'||run.durability==='needs-reconcile'))||workflow?.operations?.some(operation=>['pending','needs-reconcile'].includes(operation.status)&&[...(operation.nodeIds??[]),...(operation.nodeId?[operation.nodeId]:[])].some(id=>menuIds.includes(id))));
  const clipboard=readTaskClipboard();
  const changeMenuLayer=(action:LayerAction)=>{
    if(busy)return;
    if(menuGroup&&catalog){props.onChangeSessionRootLayers?.(menuGroup.nodeIds.map(id=>id.startsWith('catalog:')?id.slice(8):id),action);return;}
    if(menuRoot){props.onChangeSessionRootLayer?.(menuRoot.sessionId,action);return;}
    const current=workflowRef.current;if(!current||!menuIds.length)return;
    publish({...current,nodes:menuGroup?changeLayers(current.nodes,menuIds,action):changeLayer(current.nodes,menuTask!.id,action)});
  };
  const menuActions:ContextAction[]=[];
  if(menuUtility){
    menuActions.push({id:'focus-utility',label:t('focusUtility'),icon:'tool',disabled:busy||focusedUtilityId===menuUtility.id,onSelect:()=>focusUtility(menuUtility.id)});
    menuActions.push({id:'delete-utility',label:t('removeFromCanvas'),icon:'trash',danger:true,separatorBefore:true,disabled:busy,onSelect:()=>removeUtility(menuUtility.id)});
  }else if(contextMenu?.port){
    const port=contextMenu.port,nodeId=contextMenu.nodeId!;
    const edges=(workflow?.edges??[]).filter(edge=>port==='input'?edge.target===nodeId:edge.source===nodeId);
    const protectedEdit=dependencyEditProtected(new Set(edges.map(edge=>edge.target)));
    menuActions.push({id:'disconnect-port',label:t(port==='input'?'disconnectInput':'disconnectOutput',{count:edges.length}),icon:'unlink',disabled:busy||catalog||!edges.length||protectedEdit,title:protectedEdit?t('disconnectProtected'):!edges.length?t('noPortConnections'):undefined,onSelect:()=>{removeEdges(new Set(edges.map(edge=>edge.id)));}});
  }else{
    if(contextMenu&&!contextMenu.nodeId&&!menuGroup){
      menuActions.push({id:'add-node',label:t('taskNode'),icon:'task',disabled:busy||catalog,title:catalog?t('enterWorkflowFirst'):undefined,onSelect:()=>createAt(contextMenu.flowPosition,{title:t('newNodeTitle'),instruction:''})});
      menuActions.push({id:'add-utility-node',label:t('utilityNode'),icon:'tool',disabled:busy||catalog,title:catalog?t('enterWorkflowFirst'):undefined,onSelect:()=>addUtility(contextMenu.flowPosition)});
    }
    if(contextMenu?.nodeId||menuGroup){
      menuActions.push(...([{id:'layer-up',label:'layerUp',action:'up'},{id:'layer-down',label:'layerDown',action:'down'},{id:'bring-front',label:'bringToFront',action:'front'},{id:'send-back',label:'sendToBack',action:'back'},{id:'reset-layer',label:'resetLayer',action:'reset'}] as const).map(item=>({id:item.id,label:t(item.label),icon:'layers' as const,disabled:busy||(Boolean(menuRoot)&&!props.onChangeSessionRootLayer)||(Boolean(menuGroup)&&catalog&&!props.onChangeSessionRootLayers),onSelect:()=>changeMenuLayer(item.action)})));
      menuActions.push({id:'duplicate',label:t(menuGroup?'groupDuplicate':'duplicateNode'),icon:'plus',disabled:busy||menuIsSource||!menuIds.length||Boolean(menuGroup&&!props.onCanvasCommand),onSelect:()=>{if(props.onCanvasCommand){void canvasCommand('duplicate',undefined,menuIds);return;}if(menuTask)createAt({x:menuTask.position.x+42,y:menuTask.position.y+42},{title:`${menuTask.title} ${t('copySuffix')}`.slice(0,160),instruction:menuTask.instruction});}});
      menuActions.push({id:'copy',label:t(menuGroup?'groupCopy':'copyNode'),icon:'copy',disabled:busy||menuIsSource||!menuIds.length||Boolean(menuGroup&&!props.onCanvasCommand),onSelect:()=>{if(props.onCanvasCommand){void canvasCommand('copy',undefined,menuIds);return;}if(menuTask){copyTaskText(menuTask);refreshClipboard(value=>value+1);setNotice(t('nodeCopied'));}}});
      if(props.onCanvasCommand)menuActions.push({id:'cut',label:t(menuGroup?'groupCut':'cutNode'),icon:'copy',disabled:busy||menuIsSource||!menuIds.length||menuLocked||menuHistoryUncertain,title:menuIsSource?t('nativeSourceProtected'):menuHistoryUncertain?t('uncertainNodeProtected'):menuLocked?t('activeNodeProtected'):undefined,onSelect:()=>{void canvasCommand('cut',undefined,menuIds);}});
    }
    menuActions.push({id:'paste',label:t('pasteNode'),icon:'clipboard',disabled:busy||catalog||!props.onCanvasCommand&&!clipboard,title:!props.onCanvasCommand&&!clipboard?t('copyTaskFirst'):catalog?t('enterWorkflowFirst'):t('clipboardScope'),onSelect:()=>{if(props.onCanvasCommand){void canvasCommand('paste',contextMenu?.flowPosition);return;}const content=readTaskClipboard();if(content&&contextMenu)createAt(contextMenu.flowPosition,content);}});
    if(menuGroup){
      menuActions.push({id:'rename',label:t('groupRename'),icon:'edit',disabled:busy,onSelect:()=>setRenameGroupId(menuGroup.id)});
      menuActions.push({id:'ungroup',label:t('ungroup'),icon:'ungroup',disabled:busy,separatorBefore:true,onSelect:()=>ungroup(menuGroup.id)});
      menuActions.push(...(['grid','horizontal','vertical'] as const).map(kind=>({id:`layout-${kind}`,label:t(kind==='grid'?'layoutGrid':kind==='horizontal'?'layoutHorizontal':'layoutVertical'),icon:'layout' as const,disabled:busy||menuIds.length<2,onSelect:()=>layoutSelection(kind,menuIds)})));
      menuActions.push({id:'delete',label:t('groupRemove'),icon:'trash',danger:true,separatorBefore:true,disabled:busy||menuIsSource||menuLocked||menuHistoryUncertain||!props.onCanvasCommand,title:menuIsSource?t('nativeSourceProtected'):menuHistoryUncertain?t('uncertainNodeProtected'):menuLocked?t('activeNodeProtected'):undefined,onSelect:()=>{void canvasCommand('delete',undefined,menuIds);}});
    }else if(contextMenu?.nodeId){
      menuActions.push({id:'rename',label:t('renameNode'),icon:'edit',disabled:busy||menuIsSource||menuLocked,onSelect:()=>{if(contextMenu.nodeId)startInline(contextMenu.nodeId,'title');}});
      if(menuSessionId){menuActions.push({id:'open-session',label:t('openConversation'),icon:'chat',separatorBefore:true,onSelect:()=>props.onOpenSession?.(menuSessionId)});if(menuRoot)menuActions.push({id:'import-session',label:t('enterWorkflow'),icon:'arrow',disabled:busy,onSelect:()=>{void props.onImportSession?.(menuSessionId);}});}
      menuActions.push({id:'details',label:t('inspectTask'),icon:'panel',separatorBefore:!menuSessionId,onSelect:()=>{setInlineEditing(null);setShowInspector(true);}});
      menuActions.push({id:'collapse',label:t(collapsedNodes.has(contextMenu.nodeId)?'expandNode':'collapseNode'),icon:'collapse',onSelect:()=>toggleCollapsed(contextMenu.nodeId!)});
      menuActions.push({id:'delete',label:t('removeFromCanvas'),icon:'trash',danger:true,separatorBefore:true,disabled:busy||menuIsSource||menuLocked||menuHistoryUncertain,title:menuIsSource?t('nativeSourceProtected'):menuHistoryUncertain?t('uncertainNodeProtected'):menuLocked?t('activeNodeProtected'):undefined,onSelect:()=>{if(props.onCanvasCommand)void canvasCommand('delete',undefined,menuIds);else if(contextMenu.nodeId)deleteTask(contextMenu.nodeId);}});
    }
  }


  return <div className={`dsh-workflow wf-studio ${layoutAnimating?'wf-layout-animating':''}`} data-testid="workflow-panel" tabIndex={-1}
    onContextMenuCapture={event=>{if((event.target as Element).classList.contains('react-flow__pane')){event.preventDefault();event.stopPropagation();if(!rightGesture.current?.moved)openContextMenu(undefined,event);}}}
    onPointerDownCapture={event=>{const target=event.target as Element;if(!target.closest('.react-flow__node-utility'))setFocusedUtilityId(null);lastNodeDragStop.current=null;nodeDragGesture.current=event.button===0&&target.closest('.react-flow__node,.react-flow__nodesselection-rect')&&!target.closest('.nodrag,button,input,textarea,select,.react-flow__handle')?{start:flow.screenToFlowPosition({x:event.clientX,y:event.clientY}),ids:new Set()}:null;if(target.closest('.wf-canvas')&&!target.closest('input,textarea,select,button,[contenteditable="true"],[role="dialog"]'))event.currentTarget.focus({preventScroll:true});additiveBoxSelection.current=event.button===0&&(event.shiftKey||event.ctrlKey||event.metaKey)&&target.classList.contains('react-flow__pane')?new Set(selectedNodeIds):null;if(event.button===2)rightGesture.current={x:event.clientX,y:event.clientY,moved:false};else rightGesture.current=null;}}
    onPointerMoveCapture={event=>{if((event.target as Element).closest('.wf-canvas'))lastCanvasPoint.current=flow.screenToFlowPosition({x:event.clientX,y:event.clientY});const gesture=rightGesture.current;if(gesture&&Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>4)gesture.moved=true;}}
    onKeyDown={event=>{
      if(event.nativeEvent.isComposing||(event.target as HTMLElement).closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="dialog"],[role="menu"],[role="listbox"],[role="combobox"]'))return;
      const action=canvasShortcut(event.nativeEvent);if(action){event.preventDefault();event.stopPropagation();if(!event.repeat)handleCanvasShortcut(action);return;}
      if(event.key==='Escape'){setFocusedUtilityId(null);if(contextMenu){event.stopPropagation();setContextMenu(null);return;}setContextMenu(null);if(traceNodeId)setTraceNodeId(null);else if(showInspector)setShowInspector(false);else{if(!saveTask(true))return;setFocusedNodeId(null);setSelectedNodeIds(new Set());setSelectedEdgeId(null);}}
    }}>
    <div className="wf-canvas" data-testid="workflow-canvas" ref={canvasRef}>
      <ReactFlow<TaskFlowNode> nodes={[...renderedNodes,...utilityFlowNodes]} edges={renderedEdges} nodeTypes={nodeTypes} edgeTypes={workflowEdgeTypes} connectionLineType={ConnectionLineType.Bezier} connectionLineComponent={WorkflowConnectionLine} connectionRadius={32/viewport.zoom} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} viewport={viewport} onViewportChange={setViewport} onMoveEnd={saveViewport} onNodeClick={(event,node)=>{
        if(node.data.utility){focusUtility(node.id);return;}if((event.target as Element).closest('.react-flow__handle,button,input,textarea'))return;
        if(event.shiftKey||event.ctrlKey||event.metaKey){if(saveTask(true))setComposerNodeId(null);return;}
        if(!saveTask(true)||!focusNode(node.id))return;
        setInlineEditing(null);setShowPlan(false);setShowSettings(false);
        setComposerNodeId(node.data.root||node.data.task.kind==='session'?null:node.id);
      }} onNodeDoubleClick={(_event,node)=>{if(!node.data.utility)openTextEditor(node.id);}} onNodeContextMenu={(event,node)=>{if(Boolean(node.data.utility))return;if((event.target as Element).closest('input,textarea,select,[contenteditable="true"]'))return;event.preventDefault();event.stopPropagation();if(rightGesture.current?.moved)return;openContextMenu(node.id,event);}} onPaneContextMenu={event=>{event.preventDefault();if(rightGesture.current?.moved)return;openContextMenu(undefined,event);}} onNodeDragStart={(...args)=>{setLayoutAnimating(false);startNodeDrag(...args);}} nodeDragThreshold={4} onNodeDragStop={(event,node,moved)=>finishNodeDrag(event,moved.length?moved:[node])} onSelectionDragStop={finishNodeDrag} onPaneClick={()=>{if(!saveTask(true))return;setFocusedUtilityId(null);setFocusedNodeId(null);setSelectedNodeIds(new Set());setTraceNodeId(null);setSelectedEdgeId(null);setContextMenu(null);setInlineEditing(null);setShowInspector(false);setComposerNodeId(null);}} onEdgeClick={(event,edge)=>{event.stopPropagation();if(!saveTask(true))return;setInlineEditing(null);setSelectedEdgeId(edge.id);setFocusedNodeId(null);setTraceNodeId(null);setContextMenu(null);setShowInspector(true);}} deleteKeyCode={null} multiSelectionKeyCode={['Shift','Control','Meta']} selectionKeyCode={null} minZoom={.1} maxZoom={2} nodesConnectable={!catalog&&!busy} nodesDraggable={!busy} elevateNodesOnSelect={false} elevateEdgesOnSelect={false} onMoveStart={()=>{setContextMenu(null);window.dispatchEvent(new Event(MODEL_PICKER_VIEWPORT_EVENT));}} selectionOnDrag selectionMode={SelectionMode.Partial} panOnDrag={[1,2]} panActivationKeyCode="Space" zoomOnDoubleClick={false} onSelectionEnd={()=>{boxSelecting.current=false;additiveBoxSelection.current=null;}} onSelectionStart={()=>{boxSelecting.current=true;if(saveTask(true)){setSelectedEdgeId(null);setShowInspector(false);setInlineEditing(null);setFocusedNodeId(null);setTraceNodeId(null);setContextMenu(null);}}} zoomOnScroll colorMode="dark" proOptions={{hideAttribution:true}}>
        <Background variant={BackgroundVariant.Dots} color="#343434" gap={24} size={1.1}/><Controls position="bottom-left" showInteractive={false}/><MiniMap position="bottom-right" nodeColor={node=>node.data.root?'#4a4a4a':'#686868'} nodeStrokeColor="#888888" maskColor="rgba(13,13,13,.78)" pannable zoomable/>
      </ReactFlow>
      <CanvasGroups nodeBottomOverflow={catalog?0:40} groups={visibleGroups} nodes={renderedNodes} selectedNodeIds={selectedNodeIds} busy={busy} viewport={viewport} renameGroupId={renameGroupId} onRenameGroupHandled={()=>setRenameGroupId(null)} onSelect={selectGroup} onContextMenu={openGroupMenu} onRename={renameGroup} onUngroup={ungroup} onDragStart={startGroupDrag} onDragMove={moveGroup} onDragEnd={endGroupDrag} t={t}/>
      {selectionBounds&&(visibleSelection.size>=2||selectedGroup)&&<GroupingToolbar count={visibleSelection.size} group={selectedGroup} bounds={selectionBounds} viewport={viewport} size={size} disabled={busy} canGroup={!catalog||Boolean(props.onChangeCatalogGroups)} onGroup={makeGroup} onUngroup={()=>{if(selectedGroup)ungroup(selectedGroup.id);}} onLayout={layoutSelection} t={t}/>}
      {!catalog&&workflow&&<CanvasQuestions key={`questions:${workflow.id}`} runtime={props} tasks={workflow.nodes} size={size} reveal={questionReveal} t={t}/>}
      {!catalog&&workflow&&<CanvasApprovals key={`approvals:${workflow.id}`} runtime={props} tasks={workflow.nodes} size={size} reveal={approvalReveal} t={t}/>}
      <CanvasNodeEffects resetKey={`${workflow?.id??'catalog'}:${props.activeBranchId??''}:${search}`} />
      <CanvasTracePanels focusedNodeId={focusedNodeId} traceNodeId={traceNodeId} size={size} selectedRunId={traceRunId} runtime={props} pins={tracePins} onOpen={openTrace} onClose={()=>setTraceNodeId(null)} onClosePin={closePinnedTrace} onTogglePin={toggleTracePin} onSelectRun={selectRun} onSelectPinnedRun={selectPinnedRun} t={t}/>
      {contextMenu&&canvasRef.current&&<ContextMenu container={canvasRef.current} x={contextMenu.x} y={contextMenu.y} actions={menuActions} caption={menuIsSource?t('nativeSourceProtected'):t('clipboardScope')} onClose={()=>setContextMenu(null)}/>}
      {(loading||props.catalogLoading)&&nodes.length===0?<div className="wf-loading" role="status"><div className="wf-loader"/>{t('loading')}</div>:nodes.length===0&&utilityFlowNodes.length===0&&<div className="wf-empty-canvas"><div className="wf-empty-mark"><Icon name={catalog?'chat':'workflow'} size={36}/></div><h2>{t(catalog?'noSessions':'emptyTitle')}</h2><p>{t(catalog?'noSessionsDescription':'emptyDescription')}</p><button className="wf-button wf-button--primary" onClick={addTask}><Icon name="plus"/>{t(catalog?'newWorkflow':'newNode')}</button></div>}
    </div>
    <header className="wf-studio-top" onPointerDown={event=>event.stopPropagation()}>
      <div className="wf-studio-title"><Icon name="workflow" size={25}/><WorkflowPicker onDelete={async id=>{if(!saveTask(true))return false;return props.onDeleteWorkflow?await props.onDeleteWorkflow(id):false;}} onPreviewSessionArchive={props.onPreviewSessionArchive} onArchiveSessionHistory={props.onArchiveSessionHistory} deleteError={error} options={workflows} value={catalog?'':workflow?.id??''} disabled={busy} t={t} onSelect={value=>{if(!saveTask(true))return;if(value)onSelectWorkflow(value);else props.onShowCatalog?.();}}/><button className="wf-icon-button" title={t('newWorkflow')} aria-label={t('newWorkflow')} data-testid="add-workflow" disabled={busy} onClick={()=>{if(!saveTask(true))return;void onCreateWorkflow();}}><Icon name="plus" size={17}/></button></div>
      <div className="wf-view-toggle"><button type="button" aria-pressed={!showList} className={!showList?'is-active':''} onClick={()=>{if(saveTask(true))setShowList(false);}}><Icon name="edit" size={16}/>{t('canvasMode')}</button><button type="button" aria-pressed={showList} className={showList?'is-active':''} onClick={()=>{if(saveTask(true))setShowList(true);}}><Icon name="grid" size={16}/>{t('listMode')}</button></div>
      {!catalog&&branches.length>0&&<BranchPicker options={branches.filter(branch=>!(props.executions??[]).some(run=>run.subagent?.parentSessionId===branch.sessionId))} value={props.activeBranchId??''} disabled={busy} t={t} onSelect={value=>{if(!saveTask(true))return false;setFocusedNodeId(null);setTraceNodeId(null);setSelectedRunId(null);setSelectedNodeIds(new Set());setContextMenu(null);setInlineEditing(null);setShowInspector(false);props.onSelectBranch?.(value);return true;}}/>}
      <div className="wf-top-spacer"/><AccessModePicker options={props.accessModes??[]} value={props.accessMode} defaultPreset={props.defaultAccessMode} loading={props.accessModesLoading} error={props.accessModesError} disabled={busy||catalog} onChange={props.onSelectAccessMode?async value=>{if(!saveTask(true))throw new Error(t('inlineConflict'));await props.onSelectAccessMode!(value);}:undefined} onReload={props.onReloadAccessModes?()=>void props.onReloadAccessModes?.():undefined} t={t}/><ModelPicker key={`global-model:${workflow?.id}`} options={props.modelOptions} value={props.globalModelId} defaultLabel={props.defaultModelLabel?`${t('nativeDefaultModel')} · ${props.defaultModelLabel}`:t('nativeDefaultModel')} label={t('globalModel')} loading={props.modelsLoading} error={props.modelsError} disabled={busy||catalog} onChange={props.onSelectGlobalModel?changeGlobalModel:undefined} onRetry={props.onReloadModels?()=>void props.onReloadModels?.():undefined} reasoningForOption={props.reasoningForOption} onReasoningChange={props.onReasoningChange} testId="global-model-picker" t={t}/><SubagentModePicker key={workflow?.id??'catalog'} mode={props.subagentMode} disabled={busy||catalog} onBeforeAction={()=>saveTask(true)} onChange={props.onChangeSubagentMode?changeSubagentMode:undefined} t={t}/><button type="button" className={`wf-button wf-run-selected ${showPauseAll?'is-pausing':''}`} data-testid="run-selected" data-mode={showPauseAll?'pause':'run'} disabled={showPauseAll?busy||!hasActiveWork||!props.onPauseAll:busy||selectionFilesBusy||props.runtimeReady===false||props.modelsLoading||unavailableSelectionModel||!runnableSelection.length||!props.onRunNodes} title={showPauseAll?t('pauseAllHint'):props.runtimeReady===false?t('runtimeUnavailable'):unavailableSelectionModel?t('noModelConfigured'):undefined} onClick={showPauseAll?pauseAll:runSelected}><Icon name={showPauseAll?'pause':'play'} size={14}/>{showPauseAll?t('pauseAll'):t('runSelected',{count:runnableSelection.length})}</button>
      <div className="wf-studio-utilities"><div className={`wf-save-state is-${saveState}`} data-testid="save-state" data-state={saveState}><span className="wf-status-dot"/>{t(saveState==='saved'?'saved':saveState==='saving'?'saving':'saveError')}</div>
      <button className="wf-button wf-original-style" data-testid="original-style" onClick={()=>{if(!saveTask(true))return;setInlineEditing(null);props.onOriginalStyle?.();}}><Icon name="chat" size={16}/>{t('originalStyle')}</button><ContextCapacity contextUsage={props.contextUsage} contextLoading={props.contextLoading} contextError={props.contextError} compacting={props.compacting} onCompactContext={props.onCompactContext} t={t}/></div>
    </header>
    <nav className="wf-tool-dock" aria-label={t('workspace')}>
      <NodeCreateMenu disabled={busy} utilityDisabled={catalog} onTask={addTask} onUtility={()=>addUtility()} resetKey={`${workflow?.id??'catalog'}:${props.activeBranchId??''}`} t={t}/>
      <button className={showPlan?'is-active':''} aria-label={t('createPlan')} title={t('createPlan')} data-testid="plan-open" disabled={catalog||busy} onClick={()=>{if(!saveTask(true))return;setShowPlan(previous=>!previous);setShowSettings(false);}}><Icon name="sparkles"/></button><span/>
      <button aria-label={t('autoLayout')} title={t('autoLayout')} data-testid="auto-layout" disabled={busy||!nodes.length} onClick={layout}><Icon name="layout"/></button>
      <button aria-label={t('fitView')} title={t('fitView')} data-testid="fit-view" disabled={!nodes.length&&!utilityFlowNodes.length} onClick={()=>void flow.fitView({padding:.2,duration:180,maxZoom:1})}><Icon name="fit"/></button>
      <button aria-label={t('canvasUndo')} title={`${t('canvasUndo')} (Ctrl+Z)`} data-testid="canvas-undo" disabled={busy||!props.canUndo||!props.onCanvasCommand} onClick={()=>void canvasCommand('undo')}><Icon name="undo"/></button>
      <button aria-label={t('canvasRedo')} title={`${t('canvasRedo')} (Ctrl+Shift+Z)`} data-testid="canvas-redo" disabled={busy||!props.canRedo||!props.onCanvasCommand} onClick={()=>void canvasCommand('redo')}><Icon name="redo"/></button>
      <button className={showInspector?'is-active':''} aria-label={t('inspectTask')} title={t('inspectTask')} data-testid="inspector-toggle" onClick={()=>{if(!saveTask(true))return;setInlineEditing(null);setShowInspector(previous=>!previous);}}><Icon name="panel"/></button>
      <button className={showSettings?'is-active':''} aria-label={t('settings')} title={t('settings')} disabled={catalog||busy} onClick={()=>{if(!saveTask(true))return;setShowSettings(previous=>!previous);setShowPlan(false);}}><Icon name="settings"/></button>
      {!catalog&&workflow?.nodes.some(node=>node.hidden)&&<button aria-label={t('restoreHidden')} title={`${t('restoreHidden')} (Ctrl+Shift+H)`} data-testid="restore-hidden" disabled={busy||!props.onCanvasCommand} onClick={()=>void canvasCommand('restore')}><Icon name="retry"/></button>}
      <button aria-label={t('shortcutsTitle')} title={`${t('shortcutsTitle')} (?)`} data-testid="canvas-shortcuts-open" onClick={()=>setShowShortcuts(true)}><Icon name="help"/></button>
    </nav>
    {(error||notice)&&<div className={`wf-notice ${error?'is-error':''}`} role={error?'alert':'status'}><span>{error||notice}</span>{error?<button data-testid="workflow-retry" onClick={()=>void onRetry()}><Icon name="retry" size={14}/>{t('retry')}</button>:<button className="wf-icon-button" aria-label={t('close')} onClick={()=>setNotice(null)}><Icon name="close" size={14}/></button>}</div>}
    <div className="wf-bottom-caption"><span>{catalog?t('catalogCount',{count:roots.length}):t('nodeCount',{count:workflow?.nodes.filter(node=>!node.hidden).length??0})}</span><i/><span>{t('canvasHint')}</span><i/><span>{Math.round(viewport.zoom*100)}%</span><span className="wf-version" data-testid="workflow-version" title={t(props.runtimeReady===true?'versionConnected':props.runtimeReady===false?'versionRestart':'versionConnecting')} aria-label={`Workflow v${WORKFLOW_PLUGIN_VERSION} · ${t(props.runtimeReady===true?'versionConnected':props.runtimeReady===false?'versionRestart':'versionConnecting')}`}>Workflow v{WORKFLOW_PLUGIN_VERSION}</span></div>
    <CanvasShortcutsHint t={t} onOpen={()=>setShowShortcuts(true)}/>
    {showShortcuts&&<CanvasShortcutsHelp onClose={()=>setShowShortcuts(false)} t={t}/>}
    {showList&&<section className="wf-list-view" aria-label={t('listMode')}><div className="wf-list-search"><Icon name="search" size={17}/><input aria-label={t('searchSessions')} placeholder={t('searchSessions')} value={search} onChange={event=>setSearch(event.target.value)}/><button className="wf-icon-button" aria-label={t('close')} onClick={()=>setShowList(false)}><Icon name="close"/></button></div><div className="wf-list-rows">{renderedNodes.map(node=><button key={node.id} onClick={()=>{focusNode(node.id);setShowList(false);setShowInspector(true);}}><Icon name={node.data.root||node.data.task.kind==='session'?'chat':'task'} size={19}/><span><strong>{node.data.task.title}</strong><small>{node.data.task.instruction||t(node.data.root?'sessionReference':'instructionPreview')}</small></span><b>{node.data.root?t('rootNode'):executionStatusText(node.data.execution?.status??node.data.task.status,t)}</b><Icon name="chevron" size={16}/></button>)}</div></section>}
    {composerNodeId===focusedNodeId&&selectedTask&&focusedNodeExists&&selectedTask.kind!=='session'&&visibleSelection.size<=1&&!catalog&&!showInspector&&!showPlan&&!showSettings&&!showList&&!contextMenu&&!textEditor&&<NodeComposer key={`${workflow?.id}:${selectedTask.id}`} node={selectedTask} instruction={draftInstruction} readOnly={editLocked} busy={busy} filesBusy={fileBusyNodeIds.has(selectedTask.id)} activeRun={activeRun} modelOptions={props.modelOptions} modelsLoading={props.modelsLoading} modelsError={props.modelsError} globalModelId={props.globalModelId} defaultModelLabel={props.defaultModelLabel} modelAvailable={props.modelAvailable} runtimeReady={props.runtimeReady} contextUsage={props.contextUsage} compacting={props.compacting} onCompactContext={props.onCompactContext} skillOptions={props.skillOptions} skillsLoading={props.skillsLoading} skillsError={props.skillsError} onReloadSkills={props.onReloadSkills} onChangeInstruction={changeDraftInstruction} onCommit={()=>saveTask(true)} onRun={()=>runNode(selectedTask.id)} onStop={activeRun&&props.onCancelExecution?()=>void props.onCancelExecution?.(activeRun.runId):undefined} onClose={()=>setComposerNodeId(null)} onExpand={()=>openTextEditor(selectedTask.id)} reasoningForNodeOption={props.reasoningForNodeOption} onNodeReasoningChange={props.onNodeReasoningChange} onSelectModel={value=>changeNodeModel(selectedTask.id,value)} onReloadModels={props.onReloadModels} onUploadFiles={props.onUploadFiles?uploadNodeFiles:undefined} onRemoveFile={props.onRemoveFile?removeNodeFile:undefined} onFilesBusyChange={working=>trackFileActivity(`composer:${selectedTask.id}`,selectedTask.id,working)} t={t}/>}
    {textEditor&&<NodeTextEditor title={textEditor.title} instruction={textEditor.instruction} readOnly={textEditor.readOnly||executions.some(run=>run.nodeId===textEditor.nodeId&&executionIsActive(run))} saving={busy} error={textEditorError} onSave={saveTextEditor} onClose={()=>{setTextEditor(null);setTextEditorError(undefined);}} t={t}/>}
    <SheetPresence show={showInspector}><Inspector t={t} runtime={props} workflow={workflow} task={selectedTask} sessionRoot={selectedRoot} sessionId={selectedSessionId} edge={selectedEdge} runs={nodeRuns} selectedRun={selectedRun} approved={approved} activeRun={activeRun} editLocked={editLocked} hasExecution={hasExecution} title={draftTitle} instruction={draftInstruction} onTitle={changeDraftTitle} onInstruction={changeDraftInstruction} onSave={()=>saveTask()} onBeforeAction={()=>saveTask(true)} onClose={()=>{saveTask(true);setShowInspector(false);}} onDelete={deleteTask} onRemoveEdge={removeEdge} onOpenTrace={openTrace} onSelectRun={selectRun}/></SheetPresence>
    <SheetPresence show={showPlan}><PlanSheet runtime={props} selectedSessionId={selectedSessionId} t={t} onClose={()=>setShowPlan(false)} onBeforeAction={()=>saveTask(true)}/></SheetPresence>
    <SheetPresence show={showSettings}><SettingsSheet runtime={props} workflow={workflow} onBeforeAction={()=>saveTask(true)} t={t} onClose={()=>setShowSettings(false)}/></SheetPresence>
    {!catalog&&workflow&&<input className="wf-name-input" aria-label={t('workflowName')} data-testid="workflow-name-input" disabled={busy} value={name} onChange={event=>setName(event.target.value)} onBlur={commitName} onKeyDown={event=>{if(event.key==='Enter'){commitName();event.currentTarget.blur();}}} maxLength={128}/>}
  </div>;
}
export function WorkflowPanel(props:WorkflowPanelProps){return <ReactFlowProvider><WorkflowWorkspace {...props}/></ReactFlowProvider>;}
