import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowClient, type ClientResult } from '../src/client/data.ts';
import { WorkflowRuntimeClient, type WorkflowRuntimeApi } from '../src/client/runtime-data.ts';
import type { Workflow, WorkflowCatalogLayoutValue, WorkflowTraceValue } from '../src/shared/model.ts';
import { WORKFLOW_API_VERSION, WORKFLOW_PLUGIN_VERSION } from '../src/shared/model.ts';

const graph = (): Workflow => ({ id:'workflow-test', name:'Test', schemaVersion:2, revision:1,
  nodes:[], edges:[], viewport:{x:0,y:0,zoom:1}, createdAt:1, updatedAt:1 });
const ok = <T>(value:T):ClientResult<T> => ({ok:true,value});
function pending<T>() { let resolve!:(value:T)=>void; const promise=new Promise<T>(done=>{resolve=done}); return {promise,resolve}; }
function fixture() {
  const api = {
    capabilities:vi.fn<WorkflowRuntimeApi['capabilities']>(async()=>ok({pluginVersion:WORKFLOW_PLUGIN_VERSION,apiVersion:WORKFLOW_API_VERSION,features:['batch-run','delete','model-selection','planning','planning-attachments','visual-node-hide','user-questions']})),
    models:vi.fn<WorkflowRuntimeApi['models']>(async()=>ok({models:[{provider:'test',model:'test-model',label:'Test model'}],defaultModel:{provider:'test',model:'test-model'}})),
    preparePlanAttachments:vi.fn<WorkflowRuntimeApi['preparePlanAttachments']>(),attachPlanFiles:vi.fn<WorkflowRuntimeApi['attachPlanFiles']>(),prepareAttachment:vi.fn<WorkflowRuntimeApi['prepareAttachment']>(),attachFiles:vi.fn<WorkflowRuntimeApi['attachFiles']>(),
    delete:vi.fn<WorkflowRuntimeApi['delete']>(async request=>ok({ok:true as const,workflowId:request.workflowId})),
    batchRun:vi.fn<WorkflowRuntimeApi['batchRun']>(async()=>ok({workflow:graph(),runIds:[]})),
    list:vi.fn(async()=>ok({workflows:[graph()]})),
    create:vi.fn(async()=>ok({workflow:graph()})),
    save:vi.fn(async (request:{workflow:Workflow;expectedRevision:number})=>ok({ok:true as const,workflow:{...request.workflow,revision:request.expectedRevision+1}})),
    catalog:vi.fn(async()=>ok({sessions:[],layout:{revision:0,positions:{},viewport:{x:0,y:0,zoom:1}}})),
    saveCatalogLayout:vi.fn<WorkflowRuntimeApi['saveCatalogLayout']>(async request=>ok({ok:true,layout:{...request.layout,revision:request.expectedRevision+1}})),
    importSession:vi.fn<WorkflowRuntimeApi['importSession']>(), approve:vi.fn<WorkflowRuntimeApi['approve']>(),
    run:vi.fn<WorkflowRuntimeApi['run']>(async()=>ok({workflow:graph()})), cancel:vi.fn<WorkflowRuntimeApi['cancel']>(),
    trace:vi.fn<WorkflowRuntimeApi['trace']>(), details:vi.fn<WorkflowRuntimeApi['details']>(),
    generatePlan:vi.fn<WorkflowRuntimeApi['generatePlan']>(), applyPlan:vi.fn<WorkflowRuntimeApi['applyPlan']>(),fork:vi.fn<WorkflowRuntimeApi['fork']>(),
  };
  const graphs=new WorkflowClient(api); const runtime=new WorkflowRuntimeClient(api,graphs);
  return {api,graphs,runtime};
}
afterEach(()=>vi.useRealTimers());
describe('native Workflow client coordination',()=>{
  it('keeps several pinned execution traces and their expanded details independent while another trace is selected',async()=>{
    const {api,graphs,runtime}=fixture();await graphs.load();
    api.trace.mockImplementation(async({runId})=>ok({trace:{runId,sessionId:`session-${runId}`,status:'running',steps:[{stepId:`tool-${runId}`,eventStartSeq:3,title:runId,type:'tool_call',status:'running',timestamp:1}]}}));
    const first=runtime.readTrace('run-one'),second=runtime.readTrace('run-two');await Promise.all([first,second]);
    expect(runtime.getSnapshot().traces['run-one']?.steps[0]?.title).toBe('run-one');expect(runtime.getSnapshot().traces['run-two']?.steps[0]?.title).toBe('run-two');expect(runtime.getSnapshot().trace?.runId).toBe('run-two');
    api.details.mockResolvedValue(ok({details:{stepId:'tool-run-one',eventName:'tool/call',timestamp:1,status:'running',output:'Only first output'}}));await runtime.readStep('run-one','tool-run-one');
    expect(runtime.getSnapshot().traces['run-one']?.steps[0]?.output).toBe('Only first output');expect(runtime.getSnapshot().traces['run-two']?.steps[0]?.output).toBeUndefined();expect(runtime.getSnapshot().trace?.runId).toBe('run-two');
    runtime.watchTraceRuns(['run-one','run-two']);runtime.dispose();graphs.dispose();
  });
  it('detects a stale Host before Run or delete, reports a restart instruction and never automatically replays actions',async()=>{
    const {api,graphs,runtime}=fixture();await graphs.load();
    api.capabilities.mockResolvedValueOnce({ok:false,error:{message:'client api: visualWorkflow/capabilities failed: HTTP 404'}});
    await runtime.runNodes(['a']);expect(api.batchRun).not.toHaveBeenCalled();expect(runtime.getSnapshot().runtimeReady).toBe(false);expect(runtime.getSnapshot().error).toContain('完全退出');
    expect(await runtime.deleteWorkflow(graph().id)).toBe(false);expect(api.delete).not.toHaveBeenCalled();expect(api.capabilities).toHaveBeenCalledTimes(1);
    await runtime.retry();expect(runtime.getSnapshot().runtimeReady).toBe(true);expect(api.batchRun).not.toHaveBeenCalled();expect(api.delete).not.toHaveBeenCalled();runtime.dispose();graphs.dispose();
  });
  it('rejects a protocol or package mismatch without submitting planning',async()=>{
    const {api,graphs,runtime}=fixture();await graphs.load();api.capabilities.mockResolvedValueOnce(ok({pluginVersion:'0.7.0',apiVersion:1,features:[]}));
    await runtime.generatePlan('User goal');expect(api.generatePlan).not.toHaveBeenCalled();expect(runtime.getSnapshot().error).toContain('版本不一致');runtime.dispose();graphs.dispose();
  });
  it('persists explicit global and node models, clears override and preserves the global model when policies change',async()=>{
    const {api,graphs,runtime}=fixture();const node={id:'model-node',title:'Models',instruction:'Task',source:'user' as const,status:'draft' as const,revision:1,position:{x:0,y:0}};
    api.list.mockResolvedValueOnce(ok({workflows:[{...graph(),nodes:[node]}]}));await graphs.load();
    api.models.mockResolvedValueOnce(ok({models:[{provider:'test',model:'a',label:'Model A'},{provider:'test',model:'b',label:'Model B'}],defaultModel:{provider:'test',model:'a'}}));await runtime.reloadModels();
    runtime.selectGlobalModel(JSON.stringify(['test','b']));runtime.selectNodeModel(node.id,JSON.stringify(['test','a']));runtime.presentation().onChangePolicies?.('manual','manual');
    expect(graphs.getSnapshot().workflows[0]?.settings).toMatchObject({generation:'manual',execution:'manual',model:{provider:'test',model:'b'}});expect(graphs.getSnapshot().workflows[0]?.nodes[0]?.model).toEqual({provider:'test',model:'a'});
    runtime.selectNodeModel(node.id,undefined);expect(graphs.getSnapshot().workflows[0]?.nodes[0]?.model).toBeUndefined();expect(runtime.presentation().globalModelId).toBe(JSON.stringify(['test','b']));expect(runtime.presentation().modelAvailable).toBe(true);graphs.undo();expect(graphs.getSnapshot().workflows[0]?.nodes[0]?.model).toEqual({provider:'test',model:'a'});runtime.dispose();graphs.dispose();
  });
  it('does not mistake available choices for a configured global default',async()=>{
    const {api,graphs,runtime}=fixture();await graphs.load();api.models.mockResolvedValueOnce(ok({models:[{provider:'test',model:'a',label:'Model A'}]}));await runtime.reloadModels();expect(runtime.presentation().modelAvailable).toBe(false);
    runtime.selectGlobalModel(JSON.stringify(['test','a']));expect(runtime.presentation().modelAvailable).toBe(true);runtime.dispose();graphs.dispose();
  });
  it('persists right-click effort per exact model without selecting it, including inherited node menus and reset',async()=>{
    const {api,graphs,runtime}=fixture();
    const node={id:'effort-node',title:'Effort',instruction:'Task',source:'user' as const,status:'draft' as const,revision:1,position:{x:0,y:0},model:{provider:'test',model:'a'}};
    api.list.mockResolvedValueOnce(ok({workflows:[{...graph(),nodes:[node],settings:{generation:'manual',execution:'manual',model:{provider:'test',model:'b'}}}]}));await graphs.load();
    const reasoning={efforts:[{id:'low',name:'Low'},{id:'high',name:'High'}],defaultEffort:'low'};
    api.models.mockResolvedValueOnce(ok({models:[{provider:'test',model:'a',label:'A',reasoning},{provider:'test',model:'b',label:'B',reasoning},{provider:'other',model:'a',label:'Other A',reasoning}],defaultModel:{provider:'test',model:'a'}}));await runtime.reloadModels();
    await runtime.selectGlobalReasoning(JSON.stringify(['test','a']),'high');
    let saved=graphs.getSnapshot().workflows[0]!;
    expect(saved.settings?.model).toEqual({provider:'test',model:'b'});expect(saved.nodes[0]?.model).toEqual(node.model);
    expect(saved.settings?.modelReasoning).toEqual([{provider:'test',model:'a',reasoningEffort:'high'}]);
    expect(runtime.presentation().reasoningForOption?.(JSON.stringify(['test','a']))).toMatchObject({value:'high',isDefault:false});
    expect(runtime.presentation().reasoningForOption?.(JSON.stringify(['other','a']))).toMatchObject({value:'low',isDefault:true});
    await runtime.selectNodeReasoning(node.id,undefined,'high');
    saved=graphs.getSnapshot().workflows[0]!;expect(saved.settings?.modelReasoning).toHaveLength(2);expect(saved.nodes[0]?.model).toEqual(node.model);
    expect(runtime.presentation().reasoningForNodeOption?.(node.id,undefined)).toMatchObject({value:'high',isDefault:false});
    await runtime.selectNodeReasoning(node.id,JSON.stringify(['test','a']),undefined);
    expect(graphs.getSnapshot().workflows[0]!.nodes[0]?.model).toEqual(node.model);
    expect(runtime.presentation().reasoningForOption?.(JSON.stringify(['test','a']))).toMatchObject({value:'low',isDefault:true});
    await expect(runtime.selectGlobalReasoning(JSON.stringify(['test','a']),'invented')).rejects.toThrow('档位');
    expect(graphs.hasUnsaved).toBe(false);runtime.dispose();graphs.dispose();
  });
  it('pauses the entire current workflow with one host transaction',async()=>{
    const {api,graphs,runtime}=fixture();await graphs.load();const pauseAll=vi.fn(async()=>ok({workflow:graph()}));Object.assign(api,{pauseAll});
    await runtime.presentation().onPauseAll?.();expect(pauseAll).toHaveBeenCalledExactlyOnceWith({workflowId:graph().id});expect(api.cancel).not.toHaveBeenCalled();runtime.dispose();graphs.dispose();
  });
  it('uploads all files through native staging before one atomic attachment transaction and supports undo',async()=>{
    const {api,graphs,runtime:unused}=fixture();unused.dispose();
    const node={id:'file-node',title:'Files',instruction:'Read files',source:'user' as const,status:'draft' as const,revision:1,position:{x:0,y:0}};
    const original={...graph(),nodes:[node]};api.list.mockResolvedValueOnce(ok({workflows:[original]}));await graphs.load();
    const staged={...original,revision:2,uploadSessionId:'plugin-stage'};api.prepareAttachment.mockResolvedValueOnce(ok({workflow:staged,sessionId:'plugin-stage'}));
    const refs=['a.txt','b.md'].map((name,index)=>({id:`file-${index}`,createdAt:1,file:{attachmentId:`native-${index}`,name,bytes:3}}));
    api.attachFiles.mockResolvedValueOnce(ok({workflow:{...staged,revision:3,nodes:[{...node,revision:2,attachments:refs}]}}));
    const upload=vi.fn(async(_session:string,_file:File)=>ok({receiptId:`receipt-${_file.name}`,file:{attachmentId:'native',name:_file.name,bytes:3}}));
    const runtime=new WorkflowRuntimeClient(api,graphs,upload),files=[new File(['abc'],'a.txt'),new File(['xyz'],'b.md')];
    await runtime.uploadFiles(node.id,files);
    expect(upload.mock.calls.map(call=>[call[0],call[1].name])).toEqual([['plugin-stage','a.txt'],['plugin-stage','b.md']]);
    expect(api.attachFiles).toHaveBeenCalledTimes(1);expect(api.attachFiles).toHaveBeenCalledWith(expect.objectContaining({nodeRevision:1,receiptIds:['receipt-a.txt','receipt-b.md']}));
    expect(graphs.getSnapshot().workflows[0]?.nodes[0]?.attachments).toEqual(refs);expect(api.run).not.toHaveBeenCalled();expect(runtime.getSnapshot().busy).toBe(false);
    graphs.undo();await graphs.flush();expect(graphs.getSnapshot().workflows[0]?.nodes[0]?.attachments).toEqual([]);
    graphs.redo();await graphs.flush();expect(graphs.getSnapshot().workflows[0]?.nodes[0]?.attachments).toEqual(refs);runtime.dispose();graphs.dispose();
  });
  it('does not register partially uploaded files and releases locks on native failure',async()=>{
    const {api,graphs,runtime:unused}=fixture();unused.dispose();
    const node={id:'file-node',title:'Files',instruction:'Read',source:'user' as const,status:'draft' as const,revision:1,position:{x:0,y:0}};
    const original={...graph(),nodes:[node]};api.list.mockResolvedValueOnce(ok({workflows:[original]}));await graphs.load();api.prepareAttachment.mockResolvedValueOnce(ok({workflow:original,sessionId:'owned'}));
    const upload=vi.fn().mockResolvedValueOnce(ok({receiptId:'first',file:{attachmentId:'native',name:'a',bytes:1}})).mockResolvedValueOnce({ok:false,error:{message:'native upload interrupted'}});
    const runtime=new WorkflowRuntimeClient(api,graphs,upload);
    await expect(runtime.uploadFiles(node.id,[new File(['a'],'a'),new File(['b'],'b')])).rejects.toThrow('native upload interrupted');
    expect(api.attachFiles).not.toHaveBeenCalled();expect(graphs.getSnapshot().workflows[0]?.nodes[0]?.attachments).toBeUndefined();expect(runtime.getSnapshot().busy).toBe(false);
    graphs.change({...original,name:'Unlocked'});expect(graphs.getSnapshot().workflows[0]?.name).toBe('Unlocked');runtime.dispose();graphs.dispose();
  });
  it('does not touch the native upload service when cancelled before preparation',async()=>{
    const {api,graphs,runtime:unused}=fixture();unused.dispose();await graphs.load();const upload=vi.fn();const runtime=new WorkflowRuntimeClient(api,graphs,upload),cancel=new AbortController();cancel.abort();
    await expect(runtime.uploadFiles('missing',[new File(['x'],'x')],cancel.signal)).rejects.toThrow();expect(upload).not.toHaveBeenCalled();expect(api.prepareAttachment).not.toHaveBeenCalled();runtime.dispose();graphs.dispose();
  });
  it('uploads planning files atomically, removes and undoes references and submits selected IDs only',async()=>{
    const {api,graphs,runtime:unused}=fixture();unused.dispose();await graphs.load();
    const original=graph(),refs=['a.txt','b.md'].map((name,index)=>({id:`plan-file-${index}`,createdAt:1,file:{attachmentId:`native-plan-${index}`,name,bytes:3}}));
    api.preparePlanAttachments.mockResolvedValueOnce(ok({workflow:{...original,revision:2,uploadSessionId:'planning-stage'},sessionId:'planning-stage'}));
    api.attachPlanFiles.mockResolvedValueOnce(ok({workflow:{...original,revision:3,uploadSessionId:'planning-stage',planningAttachments:refs}}));
    const upload=vi.fn(async(session:string,file:File)=>ok({receiptId:`receipt-${file.name}`,file:{attachmentId:'native',name:file.name,bytes:3}}));
    const runtime=new WorkflowRuntimeClient(api,graphs,upload);await runtime.uploadPlanningFiles([new File(['abc'],'a.txt'),new File(['xyz'],'b.md')]);
    expect(upload.mock.calls.map(call=>call[0])).toEqual(['planning-stage','planning-stage']);expect(api.attachPlanFiles).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({sessionId:'planning-stage',receiptIds:['receipt-a.txt','receipt-b.md']}));
    expect(runtime.presentation().planningAttachments).toEqual(refs);graphs.undo();await graphs.flush();expect(runtime.presentation().planningAttachments).toEqual([]);graphs.redo();await graphs.flush();expect(runtime.presentation().planningAttachments).toEqual(refs);
    await runtime.removePlanningFile(refs[0]!.id);expect(runtime.presentation().planningAttachments).toEqual([refs[1]]);graphs.undo();await graphs.flush();expect(runtime.presentation().planningAttachments).toEqual(refs);
    api.generatePlan.mockResolvedValueOnce(ok({workflow:{...graphs.getSnapshot().workflows[0]!,planningAttachments:[]}}));await runtime.generatePlan('Plan with uploaded files');expect(api.generatePlan).toHaveBeenCalledWith(expect.objectContaining({attachmentIds:refs.map(file=>file.id)}));expect(api.run).not.toHaveBeenCalled();runtime.dispose();graphs.dispose();
  });
  it('retains planning references on partial upload or cancellation without admitting phantom attachments',async()=>{
    const {api,graphs,runtime:unused}=fixture();unused.dispose();const original={...graph(),planningAttachments:[{id:'keep',createdAt:1,file:{attachmentId:'known',name:'keep.txt',bytes:1}}]};api.list.mockResolvedValueOnce(ok({workflows:[original]}));await graphs.load();api.preparePlanAttachments.mockResolvedValue(ok({workflow:original,sessionId:'owned-stage'}));
    const upload=vi.fn().mockResolvedValueOnce(ok({receiptId:'first',file:{attachmentId:'native',name:'a',bytes:1}})).mockResolvedValueOnce({ok:false,error:{message:'planning upload interrupted'}});const runtime=new WorkflowRuntimeClient(api,graphs,upload);
    await expect(runtime.uploadPlanningFiles([new File(['a'],'a'),new File(['b'],'b')])).rejects.toThrow('planning upload interrupted');expect(api.attachPlanFiles).not.toHaveBeenCalled();expect(runtime.presentation().planningAttachments).toEqual(original.planningAttachments);expect(runtime.getSnapshot().busy).toBe(false);
    const cancel=new AbortController();cancel.abort();await expect(runtime.uploadPlanningFiles([new File(['a'],'a')],cancel.signal)).rejects.toThrow('取消');expect(api.preparePlanAttachments).toHaveBeenCalledTimes(1);expect(api.attachPlanFiles).not.toHaveBeenCalled();expect(runtime.presentation().planningAttachments).toEqual(original.planningAttachments);runtime.dispose();graphs.dispose();
  });
  it('submits every selected saved revision in one batch RPC without losing tasks to the busy guard',async()=>{
    const {api,graphs,runtime}=fixture();
    const nodes=['a','b'].map(id=>({id,title:id,instruction:'Do this',source:'user' as const,status:'draft' as const,revision:1,position:{x:0,y:0}}));
    api.list.mockResolvedValueOnce(ok({workflows:[{...graph(),nodes}]}));await graphs.load();
    api.save.mockImplementationOnce(async request=>ok({ok:true as const,workflow:{...request.workflow,revision:2,nodes:request.workflow.nodes.map(node=>({...node,revision:2}))}}));
    graphs.change({...graph(),nodes:nodes.map(node=>({...node,instruction:'Edited'}))});await runtime.runNodes(['b','a','b'],'branch-selected');
    expect(api.batchRun).toHaveBeenCalledTimes(1);expect(api.batchRun).toHaveBeenCalledWith(expect.objectContaining({nodeIds:['b','a'],nodeRevisions:{a:2,b:2},branchId:'branch-selected'}));
    expect(api.run).not.toHaveBeenCalled();runtime.dispose();graphs.dispose();
  });
  it('deletes only after saving and never resurrects a removed workflow from a delayed snapshot',async()=>{
    const {api,graphs,runtime}=fixture();await graphs.load();graphs.change({...graph(),name:'Final name'});
    expect(await runtime.deleteWorkflow(graph().id)).toBe(true);expect(api.delete).toHaveBeenCalledWith({workflowId:graph().id,expectedRevision:2});
    graphs.acceptServer({...graph(),revision:40});expect(graphs.getSnapshot().workflows).toEqual([]);expect(runtime.getSnapshot().catalogMode).toBe(true);
    runtime.dispose();graphs.dispose();
  });
  it('keeps a conflicting workflow visible when deletion is rejected',async()=>{
    const {api,graphs,runtime}=fixture();await graphs.load();api.delete.mockResolvedValueOnce(ok({ok:false,code:'conflict',workflow:{...graph(),revision:5,name:'Other window'}}));
    expect(await runtime.deleteWorkflow(graph().id)).toBe(false);expect(graphs.getSnapshot().workflows[0]).toMatchObject({revision:5,name:'Other window'});
    expect(runtime.getSnapshot().error).toContain('其他窗口');runtime.dispose();graphs.dispose();
  });
  it('automatically retries a definite deletion revision conflict caused only by native progress, but never a lost response',async()=>{
    const {api,graphs,runtime}=fixture();await graphs.load();
    api.delete.mockResolvedValueOnce(ok({ok:false,code:'conflict',workflow:{...graph(),revision:8,updatedAt:10}}));
    expect(await runtime.deleteWorkflow(graph().id)).toBe(true);expect(api.delete).toHaveBeenNthCalledWith(2,{workflowId:graph().id,expectedRevision:8});
    runtime.dispose();graphs.dispose();
    const second=fixture();await second.graphs.load();second.api.delete.mockRejectedValueOnce(new Error('connection lost'));
    expect(await second.runtime.deleteWorkflow(graph().id)).toBe(false);expect(second.api.delete).toHaveBeenCalledTimes(1);expect(second.graphs.getSnapshot().workflows).toHaveLength(1);second.runtime.dispose();second.graphs.dispose();
  });
  it('archives no native history from workflow deletion alone and submits only a separately reviewed Session set',async()=>{
    const {api,graphs,runtime}=fixture();await graphs.load();
    const preview={workflowId:graph().id,expectedRevision:3,available:true,sessionIds:['owned-a'],protectedCount:1,alreadyArchivedCount:0};
    const readPreview=vi.fn(async()=>ok(preview)),archive=vi.fn(async()=>ok({archivedSessionIds:['owned-a'],failedSessionIds:[],skippedSessionIds:[]}));
    Object.assign(api,{previewSessionArchive:readPreview,archiveSessionHistory:archive});
    expect(await runtime.deleteWorkflow(graph().id)).toBe(true);expect(archive).not.toHaveBeenCalled();expect(readPreview).not.toHaveBeenCalled();
    const reviewed=await runtime.previewSessionArchive(graph().id);expect(reviewed).toEqual(preview);
    expect(readPreview).toHaveBeenCalledExactlyOnceWith({workflowId:graph().id});
    expect(await runtime.archiveSessionHistory(reviewed)).toEqual({archivedSessionIds:['owned-a'],failedSessionIds:[],skippedSessionIds:[]});
    expect(archive).toHaveBeenCalledExactlyOnceWith({workflowId:graph().id,expectedRevision:3,sessionIds:['owned-a']});
    expect(runtime.getSnapshot().busy).toBe(false);runtime.dispose();graphs.dispose();
  });
  it('releases native-history UI state after a lost response without automatically retrying the write',async()=>{
    const {api,graphs,runtime}=fixture();await graphs.load();
    const archive=vi.fn(async()=>{throw new Error('Lost response');});Object.assign(api,{archiveSessionHistory:archive});
    await expect(runtime.archiveSessionHistory({workflowId:graph().id,expectedRevision:2,available:true,sessionIds:['owned-a'],protectedCount:0,alreadyArchivedCount:0})).rejects.toThrow('Lost response');
    expect(archive).toHaveBeenCalledOnce();expect(runtime.getSnapshot().busy).toBe(false);runtime.dispose();graphs.dispose();
  });
  it('persists group root movement and a reset layer as one catalog layout',async()=>{
    vi.useFakeTimers();const {api,graphs,runtime}=fixture();
    api.catalog.mockResolvedValueOnce(ok({sessions:[{sessionId:'a',title:'A',updatedAt:1,running:false,blank:false},{sessionId:'b',title:'B',updatedAt:1,running:false,blank:false}],layout:{revision:0,positions:{},zIndices:{a:8,b:1},viewport:{x:0,y:0,zoom:1}}}) as never);
    await runtime.refresh();runtime.moveRoots([{sessionId:'a',position:{x:10,y:20}},{sessionId:'b',position:{x:80,y:90}}]);runtime.changeRootLayer('a','reset');await vi.advanceTimersByTimeAsync(250);
    expect(api.saveCatalogLayout).toHaveBeenCalledTimes(1);expect(api.saveCatalogLayout).toHaveBeenCalledWith(expect.objectContaining({layout:expect.objectContaining({positions:{a:{x:10,y:20},b:{x:80,y:90}},zIndices:{a:0,b:1}})}));runtime.dispose();graphs.dispose();
  });
  it('merges resized roots with untouched remote sizes after a catalog conflict',async()=>{
    vi.useFakeTimers(); const {api,graphs,runtime}=fixture();
    api.saveCatalogLayout.mockResolvedValueOnce(ok({ok:false,layout:{revision:4,positions:{},sizes:{remote:{width:620,height:430}},viewport:{x:0,y:0,zoom:1}}}));
    runtime.resizeRoot('local',{width:510,height:330});await vi.advanceTimersByTimeAsync(250);
    await runtime.retry();
    expect(api.saveCatalogLayout.mock.calls[1]![0]).toMatchObject({expectedRevision:4,layout:{sizes:{local:{width:510,height:330},remote:{width:620,height:430}}}});
    expect(runtime.hasUnsavedLayout).toBe(false);runtime.dispose();graphs.dispose();
  });
  it('retains a newer resize during an in-flight layout save',async()=>{
    vi.useFakeTimers(); const {api,graphs,runtime}=fixture();const first=pending<ClientResult<WorkflowCatalogLayoutValue>>();
    api.saveCatalogLayout.mockImplementationOnce(()=>first.promise);
    runtime.resizeRoot('local',{width:400,height:250});await vi.advanceTimersByTimeAsync(250);
    runtime.resizeRoot('local',{width:580,height:370});await vi.advanceTimersByTimeAsync(250);
    first.resolve(ok({ok:true,layout:{...api.saveCatalogLayout.mock.calls[0]![0].layout,revision:1}}));await vi.advanceTimersByTimeAsync(1);
    expect(api.saveCatalogLayout.mock.calls[1]![0]).toMatchObject({expectedRevision:1,layout:{sizes:{local:{width:580,height:370}}}});
    expect(runtime.getSnapshot().layout.sizes?.local).toEqual({width:580,height:370});
    expect(runtime.hasUnsavedLayout).toBe(false);runtime.dispose();graphs.dispose();
  });
  it('runs the saved task revision without a separate approval RPC',async()=>{
    const {api,graphs,runtime}=fixture();
    const node={id:'node-one',title:'Task',instruction:'Original',source:'user' as const,status:'draft' as const,revision:1,position:{x:0,y:0}};
    api.list.mockResolvedValueOnce(ok({workflows:[{...graph(),nodes:[node]}]}));await graphs.load();
    api.save.mockImplementationOnce(async request=>ok({ok:true as const,workflow:{...request.workflow,revision:2,nodes:request.workflow.nodes.map(item=>({...item,revision:2}))}}));
    graphs.change({...graph(),nodes:[{...node,instruction:'Edited before Run'}]});await runtime.run('node-one');
    expect(api.run).toHaveBeenCalledWith(expect.objectContaining({nodeId:'node-one',nodeRevision:2}));expect(api.approve).not.toHaveBeenCalled();
    runtime.dispose();graphs.dispose();
  });
  it('persists root layering and preserves another window layers when retrying a conflict',async()=>{
    vi.useFakeTimers(); const {api,graphs,runtime}=fixture();
    api.catalog.mockResolvedValue(ok({sessions:[{sessionId:'local',title:'Local',updatedAt:1,running:false,blank:false}],layout:{revision:0,positions:{},viewport:{x:0,y:0,zoom:1}}}) as never);
    await runtime.refresh(); runtime.bringSessionRootToFront('local');
    api.saveCatalogLayout.mockResolvedValueOnce(ok({ok:false,layout:{revision:2,positions:{remote:{x:80,y:90}},zIndices:{remote:4},viewport:{x:0,y:0,zoom:1}}}));
    await vi.advanceTimersByTimeAsync(250); expect(runtime.hasUnsavedLayout).toBe(true);
    await runtime.retry();
    expect(api.saveCatalogLayout.mock.calls[1]![0]).toMatchObject({expectedRevision:2,layout:{zIndices:{local:1,remote:4},positions:{remote:{x:80,y:90}}}});
    expect(runtime.presentation().sessionRoots?.[0]?.zIndex).toBe(1);
    expect(runtime.hasUnsavedLayout).toBe(false);runtime.dispose();graphs.dispose();
  });
  it('retains local moves and merges untouched remote roots when retrying a layout conflict',async()=>{
    vi.useFakeTimers(); const {api,graphs,runtime}=fixture();
    api.saveCatalogLayout.mockResolvedValueOnce(ok({ok:false,layout:{revision:3,positions:{remote:{x:80,y:90}},viewport:{x:7,y:8,zoom:0.7}}}));
    runtime.moveRoot('local',{x:12,y:34});await vi.advanceTimersByTimeAsync(250);
    expect(runtime.hasUnsavedLayout).toBe(true);expect(runtime.getSnapshot().error).toContain('重试');
    await runtime.retry();
    expect(api.saveCatalogLayout.mock.calls[1]![0]).toMatchObject({expectedRevision:3,layout:{positions:{local:{x:12,y:34},remote:{x:80,y:90}},viewport:{x:7,y:8,zoom:0.7}}});
    expect(runtime.hasUnsavedLayout).toBe(false);runtime.dispose();graphs.dispose();
  });
  it('does not roll back a saved layout when an older catalog read arrives late',async()=>{
    vi.useFakeTimers(); const {api,graphs,runtime}=fixture();const catalog=pending<Awaited<ReturnType<WorkflowRuntimeApi['catalog']>>>();
    api.catalog.mockImplementationOnce(()=>catalog.promise as never);const refresh=runtime.refresh();
    runtime.moveRoot('local',{x:66,y:77});await vi.advanceTimersByTimeAsync(250);
    catalog.resolve(ok({sessions:[],layout:{revision:0,positions:{},viewport:{x:0,y:0,zoom:1}}}));await refresh;
    expect(runtime.getSnapshot().layout).toMatchObject({revision:1,positions:{local:{x:66,y:77}}});runtime.dispose();graphs.dispose();
  });
  it('locks local graph edits while a plan is accepted so new server nodes cannot be erased',async()=>{
    const {api,graphs,runtime}=fixture();await graphs.load();const apply=pending<Awaited<ReturnType<WorkflowRuntimeApi['applyPlan']>>>();
    api.applyPlan.mockImplementationOnce(()=>apply.promise);const accepting=runtime.applyPlan('plan',['task']);await Promise.resolve();await Promise.resolve();
    graphs.change({...graph(),name:'old graph edited during request'});
    apply.resolve(ok({workflow:{...graph(),revision:2,nodes:[{id:'planned-node',title:'Accepted',instruction:'Do this',source:'agent',status:'draft',revision:1,position:{x:0,y:0}}]}}));await accepting;
    expect(graphs.getSnapshot().workflows[0]?.nodes).toHaveLength(1);expect(graphs.hasUnsaved).toBe(false);
    graphs.change({...graphs.getSnapshot().workflows[0]!,name:'editing restored'});expect(graphs.hasUnsaved).toBe(true);
    runtime.dispose();graphs.dispose();
  });
  it('serializes root-layout edits during an in-flight write and retains the viewport',async()=>{
    vi.useFakeTimers();
    const {api,graphs,runtime}=fixture(); const first=pending<ClientResult<WorkflowCatalogLayoutValue>>();
    api.saveCatalogLayout.mockImplementationOnce(()=>first.promise);
    runtime.moveRoot('source-one',{x:10,y:20}); await vi.advanceTimersByTimeAsync(250);
    runtime.moveRoot('source-two',{x:70,y:80}); runtime.moveCatalogViewport({x:-40,y:15,zoom:0.8});
    await vi.advanceTimersByTimeAsync(250);
    expect(api.saveCatalogLayout).toHaveBeenCalledTimes(1);
    first.resolve(ok({ok:true,layout:{...api.saveCatalogLayout.mock.calls[0]![0].layout,revision:1}}));
    await vi.advanceTimersByTimeAsync(1);
    expect(api.saveCatalogLayout).toHaveBeenCalledTimes(2);
    expect(api.saveCatalogLayout.mock.calls[1]![0]).toMatchObject({expectedRevision:1,layout:{positions:{'source-one':{x:10,y:20},'source-two':{x:70,y:80}},viewport:{x:-40,y:15,zoom:0.8}}});
    expect(runtime.getSnapshot().layout.revision).toBe(2);
    runtime.dispose();graphs.dispose();
  });
  it('ignores late trace responses after switching execution and lets failed details retry',async()=>{
    const {api,graphs,runtime}=fixture(); await graphs.load();
    const old=pending<ClientResult<WorkflowTraceValue>>(); api.trace.mockImplementationOnce(()=>old.promise);
    const flight=runtime.readTrace('run-old');
    api.trace.mockResolvedValueOnce(ok({trace:{runId:'run-new',sessionId:'child',status:'running',steps:[{stepId:'tool-1',eventStartSeq:3,title:'Tool',type:'tool_call',status:'running',timestamp:1}]}}));
    await runtime.readTrace('run-new'); old.resolve(ok({trace:{runId:'run-old',sessionId:'old',status:'completed',steps:[]}})); await flight;
    expect(runtime.getSnapshot().trace?.runId).toBe('run-new');
    api.details.mockResolvedValueOnce({ok:false,error:{message:'temporarily offline'}});
    await runtime.readStep('run-new','tool-1'); expect(runtime.getSnapshot().trace?.steps[0]?.unavailable).toContain('offline');
    api.details.mockResolvedValueOnce(ok({details:{stepId:'tool-1',eventName:'tool/call',timestamp:1,status:'completed',output:'native output',truncated:true}}));
    await runtime.readStep('run-new','tool-1');
    expect(runtime.getSnapshot().trace?.steps[0]).toMatchObject({output:'native output',truncated:true,unavailable:undefined});
    api.trace.mockResolvedValueOnce(ok({trace:{runId:'run-new',sessionId:'child',status:'completed',steps:[{stepId:'tool-1',eventStartSeq:3,eventEndSeq:6,title:'Tool',type:'tool_call',status:'completed',timestamp:1}]}}));
    await runtime.readTrace('run-new',true);
    expect(runtime.getSnapshot().trace).toMatchObject({runId:'run-new',steps:[{id:'tool-1',status:'completed',eventEndSeq:6}]});
    expect(runtime.getSnapshot().trace?.steps[0]?.output).toBeUndefined();
    expect(runtime.getSnapshot().trace?.steps[0]?.eventName).toBeUndefined();
    api.details.mockResolvedValueOnce(ok({details:{stepId:'tool-1',eventName:'tool/result',timestamp:2,status:'completed',output:'final native result'}}));
    await runtime.readStep('run-new','tool-1');
    expect(runtime.getSnapshot().trace?.steps[0]?.output).toBe('final native result');
    runtime.dispose();graphs.dispose();
  });
  it('does not dispatch an Agent operation when the editable graph cannot be saved',async()=>{
    const {api,graphs,runtime}=fixture(); await graphs.load();
    api.save.mockResolvedValueOnce({ok:false,error:{message:'offline'}} as never);
    graphs.change({...graph(),name:'unsaved approval target'}); await runtime.run('node-one');
    expect(api.run).not.toHaveBeenCalled(); expect(graphs.hasUnsaved).toBe(true);
    expect(runtime.getSnapshot().error).toContain('保存');
    runtime.dispose();graphs.dispose();
  });
});
