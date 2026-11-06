import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowClient, type ClientResult, type WorkflowApi } from '../src/client/data.ts';
import { replayGraph } from '../src/client/graph-history.ts';
import { copyGraph, cutGraph, pasteGraph, duplicateGraph } from '../src/client/node-clipboard.ts';
import { WorkflowRuntimeClient, type WorkflowRuntimeApi } from '../src/client/runtime-data.ts';
import type { CatalogLayout, Execution, Workflow, WorkflowCatalogLayoutValue, WorkflowNode, WorkflowSaveValue } from '../src/shared/model.ts';
import { WORKFLOW_API_VERSION, WORKFLOW_PLUGIN_VERSION } from '../src/shared/model.ts';

const ok=<T>(value:T):ClientResult<T>=>({ok:true,value});
const node=(id:string):WorkflowNode=>({id,title:`TEST ${id}`,instruction:'TEST task',source:'user',status:'draft',revision:1,position:{x:id==='a'?10:450,y:20}});
const graph=():Workflow=>({id:'commands-test',name:'TEST graph',schemaVersion:2,revision:1,nodes:[node('a'),node('b')],edges:[{id:'edge-a-b',source:'a',target:'b',type:'dependency'}],groups:[{id:'group-test',title:'TEST group',nodeIds:['a','b']}],viewport:{x:0,y:0,zoom:1},createdAt:1,updatedAt:1});
const execution=(status:Execution['status']='running'):Execution=>({runId:'native-run',nodeId:'a',nodeRevision:3,branchId:'native-branch',sessionId:'native-session',requestId:'native-request',status,turns:[],createdAt:1,updatedAt:2,durability:'durable'});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function fixture(initial=graph()){
  const api={
    capabilities:vi.fn<WorkflowRuntimeApi['capabilities']>(async()=>ok({pluginVersion:WORKFLOW_PLUGIN_VERSION,apiVersion:WORKFLOW_API_VERSION,features:['batch-run','delete','model-selection','planning','planning-attachments','visual-node-hide','user-questions']})),
    models:vi.fn<WorkflowRuntimeApi['models']>(async()=>ok({models:[{provider:'test',model:'test-model',label:'Test model'}],defaultModel:{provider:'test',model:'test-model'}})),
    list:vi.fn<WorkflowApi['list']>(async()=>ok({workflows:[structuredClone(initial)]})),
    create:vi.fn<WorkflowApi['create']>(async()=>ok({workflow:structuredClone(initial)})),
    save:vi.fn<WorkflowApi['save']>(async request=>ok({ok:true,workflow:{...request.workflow,revision:request.expectedRevision+1}})),
    preparePlanAttachments:vi.fn<WorkflowRuntimeApi['preparePlanAttachments']>(),attachPlanFiles:vi.fn<WorkflowRuntimeApi['attachPlanFiles']>(),prepareAttachment:vi.fn<WorkflowRuntimeApi['prepareAttachment']>(),attachFiles:vi.fn<WorkflowRuntimeApi['attachFiles']>(),delete:vi.fn<WorkflowRuntimeApi['delete']>(),batchRun:vi.fn<WorkflowRuntimeApi['batchRun']>(),
    catalog:vi.fn<WorkflowRuntimeApi['catalog']>(async()=>ok({sessions:[],layout:{revision:0,positions:{},viewport:{x:0,y:0,zoom:1}}})),
    saveCatalogLayout:vi.fn<WorkflowRuntimeApi['saveCatalogLayout']>(async request=>ok({ok:true,layout:{...request.layout,revision:request.expectedRevision+1}})),
    importSession:vi.fn<WorkflowRuntimeApi['importSession']>(),approve:vi.fn<WorkflowRuntimeApi['approve']>(),run:vi.fn<WorkflowRuntimeApi['run']>(),cancel:vi.fn<WorkflowRuntimeApi['cancel']>(),trace:vi.fn<WorkflowRuntimeApi['trace']>(),details:vi.fn<WorkflowRuntimeApi['details']>(),generatePlan:vi.fn<WorkflowRuntimeApi['generatePlan']>(),applyPlan:vi.fn<WorkflowRuntimeApi['applyPlan']>(),fork:vi.fn<WorkflowRuntimeApi['fork']>(),
  };
  const graphs=new WorkflowClient(api),runtime=new WorkflowRuntimeClient(api,graphs);return {api,graphs,runtime};
}
afterEach(()=>{vi.useRealTimers();});

describe('Canvas command boundaries',()=>{
  it('cuts drafts in a real branch without sending dangling branch members, and undo restores a valid graph',async()=>{
    const source:Workflow={...graph(),activeBranchId:'branch',branches:[{id:'branch',label:'TEST branch',sessionId:'branch-session',nodeIds:['a','b'],createdAt:1}]};
    const {api,graphs,runtime}=fixture(source);await graphs.load();runtime.showWorkflow();runtime.canvasCommand('cut',{nodeIds:['b']});await graphs.flush();
    const sent=api.save.mock.calls[0]![0].workflow;expect(sent.nodes.filter(node=>!node.hidden).map(node=>node.id)).toEqual(['a']);expect(sent.branches![0]!.nodeIds).toEqual(['a','b']);
    const {workflowSchema}=await import('../src/host/validation.ts');expect(workflowSchema.safeParse(sent).success).toBe(true);
    runtime.canvasCommand('undo',{nodeIds:[]});await graphs.flush();const restored=api.save.mock.calls.at(-1)![0].workflow;expect(restored.nodes.map(node=>node.id)).toEqual(['a','b']);expect(workflowSchema.safeParse(restored).success).toBe(true);expect(restored.branches![0]!.sessionId).toBe('branch-session');runtime.dispose();graphs.dispose();
  });
  it('undoes layout without rolling back live execution, Session, node revision, summaries or approval facts',()=>{
    const before=graph(),after={...before,nodes:before.nodes.map(item=>({...item,position:{x:item.position.x+90,y:80}}))};
    const live:Workflow={...after,revision:40,activeBranchId:'native-branch',executions:[execution()],operations:[{id:'native-op',kind:'run',status:'completed',nodeId:'a',runId:'native-run',createdAt:2}],approvals:[{id:'approved',nodeId:'a',nodeRevision:3,fingerprint:'native-fingerprint',decision:'approved',createdAt:2}],nodes:after.nodes.map(item=>item.id==='a'?{...item,status:'running',revision:3,answerSummary:'TEST durable native answer',branchIds:['native-branch'],revisions:[{revision:3,title:item.title,instruction:item.instruction,dependencies:[],createdAt:2}]}:item)};
    const restored=replayGraph(live,after,before);expect(restored.nodes[0]!.position).toEqual(before.nodes[0]!.position);expect(restored.nodes[0]).toMatchObject({revision:3,status:'running',answerSummary:'TEST durable native answer',branchIds:['native-branch']});expect(restored.executions).toBe(live.executions);expect(restored.operations).toBe(live.operations);expect(restored.approvals).toBe(live.approvals);expect(restored.activeBranchId).toBe('native-branch');expect(restored.revision).toBe(40);
  });
  it('rejects replay that deletes new native history or edits active instructions',()=>{
    const full=graph(),empty={...full,nodes:[],edges:[],groups:[]};const native={...full,executions:[execution()]};expect(()=>replayGraph(native,full,empty)).toThrow(/执行历史/);
    const edited={...full,nodes:full.nodes.map(item=>item.id==='a'?{...item,instruction:'TEST edited instruction'}:item)};expect(()=>replayGraph({...edited,executions:[execution()]},edited,full)).toThrow(/停止执行/);
  });
  it('copies an internal graph into fresh Draft identities and isolates attachment references between pastes',()=>{
    const source=graph();source.nodes[0]!.attachments=[{id:'attachment-reference',file:{attachmentId:'native-file',name:'TEST.txt',bytes:12},createdAt:1}];source.nodes[0]!.branchIds=['native-branch'];source.nodes[0]!.answerSummary='native answer';source.executions=[execution('completed')];copyGraph(source,['a','b']);
    const first=pasteGraph(source,{x:1000,y:200});expect(first.nodeIds.every(id=>!source.nodes.some(item=>item.id===id))).toBe(true);const copies=first.workflow.nodes.slice(2);expect(copies[0]).toMatchObject({status:'draft',revision:1,position:{x:1000,y:200}});expect(copies[0]!.branchIds).toBeUndefined();expect(copies[0]!.answerSummary).toBeUndefined();expect(first.workflow.edges[1]).toMatchObject({source:first.nodeIds[0],target:first.nodeIds[1]});expect(first.workflow.groups![1]!.nodeIds).toEqual(first.nodeIds);expect(first.workflow.executions).toBe(source.executions);
    copies[0]!.attachments![0]!.file.name='TEST mutated pasted object';const second=pasteGraph(source,{x:2000,y:200});expect(second.workflow.nodes[2]!.attachments![0]!.file.name).toBe('TEST.txt');expect(source.nodes[0]!.attachments![0]!.file.name).toBe('TEST.txt');
  });
  it('validates an entire cut before deleting nodes or changing the previous clipboard',()=>{
    const source=graph();copyGraph(source,['b']);const protectedGraph={...source,executions:[execution('running')]};expect(()=>cutGraph(protectedGraph,['a','b'])).toThrow(/先停止/);expect(protectedGraph.nodes).toHaveLength(2);const pasted=pasteGraph(source,{x:900,y:0});expect(pasted.nodeIds).toHaveLength(1);expect(pasted.workflow.nodes.at(-1)!.title).toBe('TEST b');
    expect(()=>cutGraph({...source,operations:[{id:'pending',kind:'batch-run',status:'pending',nodeIds:['b'],createdAt:1}]},['a','b'])).toThrow(/先停止/);
  });
  it('keeps native projections and unrelated server text while retaining a pending local graph and its old conflict baseline',async()=>{
    const {api,graphs,runtime}=fixture();await graphs.load();graphs.change({...graph(),nodes:graph().nodes.map(item=>item.id==='a'?{...item,position:{x:90,y:90}}:item)});
    const native:Workflow={...graph(),revision:9,executions:[execution()],nodes:graph().nodes.map(item=>item.id==='a'?{...item,status:'running',revision:3,answerSummary:'native answer'}:{...item,instruction:'TEST changed in another window'})};graphs.acceptServer(native);
    const visible=graphs.getSnapshot().workflows[0]!;expect(visible.nodes[0]).toMatchObject({position:{x:90,y:90},status:'running',revision:3,answerSummary:'native answer'});expect(visible.nodes[1]!.instruction).toBe('TEST changed in another window');expect(visible.executions).toEqual(native.executions);expect(graphs.getSnapshot().saveState).toBe('error');
    api.save.mockResolvedValueOnce(ok({ok:false,code:'conflict',workflow:native}));await graphs.flush();expect(api.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({expectedRevision:1}));expect(graphs.hasUnsaved).toBe(true);runtime.dispose();graphs.dispose();
  });
  it('preserves newer native facts when an older save reply arrives and serializes the pending graph against the new revision',async()=>{
    const {api,graphs,runtime}=fixture();await graphs.load();const first=deferred<ClientResult<WorkflowSaveValue>>();api.save.mockImplementationOnce(()=>first.promise);
    const submitted={...graph(),nodes:graph().nodes.map(item=>item.id==='a'?{...item,position:{x:100,y:120}}:item)};graphs.change(submitted);const flight=graphs.flush();
    graphs.change({...submitted,nodes:submitted.nodes.map(item=>item.id==='b'?{...item,position:{x:700,y:300}}:item)});
    const native:Workflow={...submitted,revision:9,executions:[execution()],nodes:submitted.nodes.map(item=>item.id==='a'?{...item,status:'running',revision:3,answerSummary:'native current'}:item)};graphs.acceptServer(native);
    first.resolve(ok({ok:true,workflow:{...submitted,revision:2}}));await flight;expect(api.save.mock.calls[1]![0]).toMatchObject({expectedRevision:9,workflow:{executions:[{runId:'native-run'}]}});expect(graphs.getSnapshot().workflows[0]!.nodes[0]).toMatchObject({revision:3,status:'running',answerSummary:'native current'});expect(graphs.getSnapshot().workflows[0]!.nodes[1]!.position).toEqual({x:700,y:300});runtime.dispose();graphs.dispose();
  });
  it('undoes and redoes an atomic cut while retaining all native aggregate facts',async()=>{
    const source={...graph(),operations:[{id:'completed-plan',kind:'plan' as const,status:'completed' as const,createdAt:1}],plans:[{id:'native-plan',goal:'TEST',sessionId:'plan-session',requestId:'plan-request',status:'accepted' as const,tasks:[],createdAt:1}]};const {graphs,runtime}=fixture(source);await graphs.load();runtime.showWorkflow();expect(runtime.canvasCommand('cut',{nodeIds:['a','b']})).toEqual([]);expect(graphs.getSnapshot().workflows[0]!.nodes.filter(node=>!node.hidden)).toHaveLength(0);runtime.canvasCommand('undo',{nodeIds:[]});expect(graphs.getSnapshot().workflows[0]!.nodes).toHaveLength(2);expect(graphs.getSnapshot().workflows[0]!.plans).toEqual(source.plans);expect(graphs.getSnapshot().workflows[0]!.operations).toEqual(source.operations);runtime.canvasCommand('redo',{nodeIds:[]});expect(graphs.getSnapshot().workflows[0]!.nodes.filter(node=>!node.hidden)).toHaveLength(0);runtime.dispose();graphs.dispose();
  });
  it('moves completed nodes through cut and paste while repeated undo and redo preserve native branch references',async()=>{
    const source:Workflow={...graph(),activeBranchId:'native-branch',branches:[{id:'native-branch',label:'TEST preserved branch',sessionId:'native-session',nodeIds:['a','b'],createdAt:1}],executions:[execution('completed')]};
    const {api,graphs,runtime}=fixture(source);await graphs.load();runtime.showWorkflow();
    runtime.canvasCommand('cut',{nodeIds:['a','b']});await graphs.flush();
    expect(graphs.getSnapshot().workflows[0]!.nodes.every(node=>node.hidden)).toBe(true);
    expect(runtime.canvasCommand('paste',{nodeIds:[],position:{x:800,y:600}})).toEqual(['a','b']);await graphs.flush();
    const {workflowSchema}=await import('../src/host/validation.ts');
    for(let round=0;round<12;round++){
      runtime.canvasCommand('undo',{nodeIds:[]});await graphs.flush();
      expect(graphs.getSnapshot().workflows[0]!.nodes.every(node=>node.hidden)).toBe(true);
      runtime.canvasCommand('undo',{nodeIds:[]});await graphs.flush();
      expect(graphs.getSnapshot().workflows[0]!.nodes.every(node=>!node.hidden)).toBe(true);
      runtime.canvasCommand('redo',{nodeIds:[]});await graphs.flush();
      runtime.canvasCommand('redo',{nodeIds:[]});await graphs.flush();
      const live=graphs.getSnapshot().workflows[0]!;
      expect(workflowSchema.safeParse(live).success).toBe(true);expect(live.executions).toEqual(source.executions);expect(live.branches).toEqual(source.branches);expect(live.nodes[0]!.position).toEqual({x:800,y:600});
      graphs.acceptServer({...live,revision:live.revision+1,updatedAt:round+10});
    }
    expect(api.save.mock.calls.every(([request])=>workflowSchema.safeParse(request.workflow).success)).toBe(true);
    runtime.canvasCommand('delete',{nodeIds:['a']});expect(graphs.getSnapshot().workflows[0]!.nodes[0]!.hidden).toBe(true);
    runtime.canvasCommand('restore',{nodeIds:[]});expect(graphs.getSnapshot().workflows[0]!.nodes.every(node=>!node.hidden)).toBe(true);await graphs.flush();
    api.list.mockResolvedValueOnce(ok({workflows:[structuredClone(graphs.getSnapshot().workflows[0]!)]}));await graphs.refresh();expect(graphs.getSnapshot().workflows[0]!.branches).toEqual(source.branches);
    runtime.dispose();graphs.dispose();
  });
  it('duplicates fresh Drafts without changing clipboard and excludes stale hidden selections from copied links',()=>{
    const source=graph();copyGraph(source,['b']);const duplicated=duplicateGraph(source,['a']);expect(duplicated.workflow.nodes.at(-1)).toMatchObject({status:'draft',revision:1,position:{x:58,y:68}});expect(duplicated.nodeIds[0]).not.toBe('a');expect(pasteGraph(source,{x:0,y:0}).workflow.nodes.at(-1)!.title).toBe('TEST b');
    copyGraph({...source,nodes:source.nodes.map(node=>node.id==='b'?{...node,hidden:true}:node)},['a','b']);const pasted=pasteGraph(source,{x:0,y:0});expect(pasted.nodeIds).toHaveLength(1);expect(pasted.workflow.edges).toHaveLength(source.edges.length);expect(pasted.workflow.groups!.at(-1)!.nodeIds).toEqual(pasted.nodeIds);
  });
  it('merges untouched remote catalog groups on CAS conflict and refuses stale undo rather than overwriting another window',async()=>{
    vi.useFakeTimers();const {api,graphs,runtime}=fixture();const remote:CatalogLayout={revision:5,positions:{remote:{x:800,y:400}},groups:[{id:'remote-group',title:'TEST remote',nodeIds:['a','c']}],viewport:{x:20,y:30,zoom:.8}};
    api.saveCatalogLayout.mockResolvedValueOnce(ok({ok:false,layout:remote}));runtime.changeCatalogGroups([{id:'local-group',title:'TEST local',nodeIds:['catalog:a','catalog:b']}]);await vi.advanceTimersByTimeAsync(250);expect(runtime.hasUnsavedLayout).toBe(true);expect(runtime.getSnapshot().layout.groups).toEqual([{id:'remote-group',title:'TEST remote',nodeIds:['c']},{id:'local-group',title:'TEST local',nodeIds:['a','b']}]);await runtime.retry();expect(api.saveCatalogLayout.mock.calls[1]![0]).toMatchObject({expectedRevision:5,layout:{positions:{remote:{x:800,y:400}},viewport:remote.viewport}});const admitted=structuredClone(runtime.getSnapshot().layout);expect(()=>runtime.canvasCommand('undo',{nodeIds:[]})).toThrow(/其他操作更新/);expect(runtime.getSnapshot().layout).toEqual(admitted);expect(runtime.hasUnsavedLayout).toBe(false);runtime.dispose();graphs.dispose();
  });
  it('moves catalog group layers with one undo entry and persists only visual metadata',async()=>{
    vi.useFakeTimers();const {api,graphs,runtime}=fixture();api.catalog.mockResolvedValueOnce(ok({sessions:['a','b','c','d'].map(sessionId=>({sessionId,title:sessionId,updatedAt:1,running:false,blank:false})),layout:{revision:1,positions:{},zIndices:{a:0,b:1,c:2,d:3},groups:[{id:'native-roots-group',title:'TEST roots',nodeIds:['a','c']}],viewport:{x:10,y:20,zoom:.8}}}));
    await runtime.refresh();const before=structuredClone(runtime.getSnapshot().layout);runtime.presentation().onChangeSessionRootLayers?.(['a','c'],'front');expect(runtime.getSnapshot().layout.zIndices).toEqual({a:2,b:0,c:3,d:1});runtime.canvasCommand('undo',{nodeIds:[]});expect(runtime.getSnapshot().layout).toEqual(before);runtime.canvasCommand('redo',{nodeIds:[]});await vi.advanceTimersByTimeAsync(250);
    expect(api.saveCatalogLayout).toHaveBeenCalledTimes(1);expect(api.saveCatalogLayout.mock.calls[0]![0].layout).toMatchObject({groups:before.groups,positions:before.positions,viewport:before.viewport,zIndices:{a:2,b:0,c:3,d:1}});expect(api.run).not.toHaveBeenCalled();expect(api.save).not.toHaveBeenCalled();runtime.dispose();graphs.dispose();
  });
  it('records a catalog batch move as one undo entry, preserves view state and deletes positions on undo before saving',async()=>{
    vi.useFakeTimers();const {api,graphs,runtime}=fixture();runtime.moveRoots([{sessionId:'a',position:{x:100,y:200}},{sessionId:'b',position:{x:500,y:200}}]);runtime.moveCatalogViewport({x:25,y:35,zoom:.7});runtime.canvasCommand('undo',{nodeIds:[]});expect(runtime.getSnapshot().layout.positions).toEqual({});expect(runtime.getSnapshot().layout.viewport).toEqual({x:25,y:35,zoom:.7});await vi.advanceTimersByTimeAsync(250);expect(api.saveCatalogLayout.mock.calls[0]![0].layout.positions).toEqual({});expect(runtime.presentation().canUndo).toBe(false);expect(runtime.presentation().canRedo).toBe(true);runtime.canvasCommand('redo',{nodeIds:[]});expect(runtime.getSnapshot().layout.positions).toEqual({a:{x:100,y:200},b:{x:500,y:200}});runtime.dispose();graphs.dispose();
  });
  it('retains a newer catalog group rename while the previous group save is in flight',async()=>{
    vi.useFakeTimers();const {api,graphs,runtime}=fixture();const first=deferred<ClientResult<WorkflowCatalogLayoutValue>>();api.saveCatalogLayout.mockImplementationOnce(()=>first.promise);runtime.changeCatalogGroups([{id:'group',title:'TEST first',nodeIds:['catalog:a','catalog:b']}]);await vi.advanceTimersByTimeAsync(250);runtime.changeCatalogGroups([{id:'group',title:'TEST newer',nodeIds:['catalog:a','catalog:b']}]);await vi.advanceTimersByTimeAsync(250);first.resolve(ok({ok:true,layout:{...api.saveCatalogLayout.mock.calls[0]![0].layout,revision:1}}));await vi.advanceTimersByTimeAsync(1);expect(api.saveCatalogLayout.mock.calls[1]![0]).toMatchObject({expectedRevision:1,layout:{groups:[{id:'group',title:'TEST newer',nodeIds:['a','b']}]}});expect(runtime.presentation().catalogGroups).toEqual([{id:'group',title:'TEST newer',nodeIds:['catalog:a','catalog:b']}]);expect(runtime.hasUnsavedLayout).toBe(false);runtime.dispose();graphs.dispose();
  });
});
