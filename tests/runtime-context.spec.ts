import {afterEach,describe,expect,it,vi} from 'vitest';
import {WorkflowClient,type ClientResult} from '../src/client/data.ts';
import {WorkflowRuntimeClient,type WorkflowRuntimeApi} from '../src/client/runtime-data.ts';
import type {Workflow,WorkflowCompactValue,WorkflowContextValue,WorkflowSkillsValue} from '../src/shared/model.ts';
import {WORKFLOW_API_VERSION,WORKFLOW_PLUGIN_VERSION} from '../src/shared/model.ts';

const graph=():Workflow=>({id:'context-workflow',name:'TEST context workflow',schemaVersion:2,revision:1,nodes:[{id:'task-a',title:'TEST task A',instruction:'Private task input',source:'user',status:'draft',revision:1,position:{x:0,y:0}}],edges:[],viewport:{x:0,y:0,zoom:1},createdAt:1,updatedAt:1,sourceSessionId:'immutable-source'});
const branchGraph=():Workflow=>({...graph(),activeBranchId:'branch-a',branches:[{id:'branch-a',label:'A',sessionId:'session-a',nodeIds:['task-a'],createdAt:1},{id:'branch-b',label:'B',sessionId:'session-b',nodeIds:['task-a'],createdAt:1}]});
const usage=(sessionId='private-task-a',extra:Partial<WorkflowContextValue>={}):WorkflowContextValue=>({sessionId,label:`TEST ${sessionId}`,usedTokens:2400,capacityTokens:10000,source:'pressure',canCompact:true,compacting:false,readOnly:false,...extra});
const ok=<T>(value:T):ClientResult<T>=>({ok:true,value});
function pending<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};}
const dispose:Array<()=>void>=[];
function fixture(initial=graph()){
  let server=initial;
  const api={
    capabilities:vi.fn<WorkflowRuntimeApi['capabilities']>(async()=>ok({pluginVersion:WORKFLOW_PLUGIN_VERSION,apiVersion:WORKFLOW_API_VERSION,features:['batch-run','delete','model-selection','planning','planning-attachments','visual-node-hide','native-context','skills']})),
    models:vi.fn<WorkflowRuntimeApi['models']>(async()=>ok({models:[]})),
    list:vi.fn(async()=>ok({workflows:[server]})),create:vi.fn(async()=>ok({workflow:server})),
    save:vi.fn(async(request:{workflow:Workflow;expectedRevision:number})=>{server={...request.workflow,revision:request.expectedRevision+1};return ok({ok:true as const,workflow:server});}),
    contextUsage:vi.fn<NonNullable<WorkflowRuntimeApi['contextUsage']>>(async request=>ok(usage(request.planning?'private-planning':request.sessionId??(request.nodeId?`private-${request.nodeId}`:'private-active-branch')))),
    skills:vi.fn<NonNullable<WorkflowRuntimeApi['skills']>>(async()=>ok({skills:[{name:'native-test-skill',description:'A real adapter result'}]})),
    compactContext:vi.fn<NonNullable<WorkflowRuntimeApi['compactContext']>>(async request=>ok({workflow:server,context:usage(request.sessionId,{usedTokens:400,lastCompactedAt:5000}),changed:true})),
    catalog:vi.fn<WorkflowRuntimeApi['catalog']>(async()=>ok({sessions:[],layout:{revision:0,positions:{},viewport:{x:0,y:0,zoom:1}}})),
    preparePlanAttachments:vi.fn<WorkflowRuntimeApi['preparePlanAttachments']>(),attachPlanFiles:vi.fn<WorkflowRuntimeApi['attachPlanFiles']>(),prepareAttachment:vi.fn<WorkflowRuntimeApi['prepareAttachment']>(),attachFiles:vi.fn<WorkflowRuntimeApi['attachFiles']>(),
    delete:vi.fn<WorkflowRuntimeApi['delete']>(),batchRun:vi.fn<WorkflowRuntimeApi['batchRun']>(),saveCatalogLayout:vi.fn<WorkflowRuntimeApi['saveCatalogLayout']>(),importSession:vi.fn<WorkflowRuntimeApi['importSession']>(),approve:vi.fn<WorkflowRuntimeApi['approve']>(),run:vi.fn<WorkflowRuntimeApi['run']>(),cancel:vi.fn<WorkflowRuntimeApi['cancel']>(),trace:vi.fn<WorkflowRuntimeApi['trace']>(),details:vi.fn<WorkflowRuntimeApi['details']>(),generatePlan:vi.fn<WorkflowRuntimeApi['generatePlan']>(),applyPlan:vi.fn<WorkflowRuntimeApi['applyPlan']>(),fork:vi.fn<WorkflowRuntimeApi['fork']>(),
  };
  const graphs=new WorkflowClient(api,60000),runtime=new WorkflowRuntimeClient(api,graphs);dispose.push(()=>{runtime.dispose();graphs.dispose();});
  const load=async()=>{await graphs.load();runtime.showWorkflow();};
  const select=async(target:Parameters<typeof runtime.selectContextTarget>[0],sessionId:string)=>{runtime.selectContextTarget(target);await vi.waitFor(()=>expect(runtime.presentation().contextUsage?.sessionId).toBe(sessionId));};
  return {api,graphs,runtime,load,select};
}
afterEach(()=>{for(const close of dispose.splice(0))close();vi.useRealTimers();});

describe('Native context and skills runtime coordination',()=>{
  it('clears the previous measurement immediately and ignores late context and skills results from another node',async()=>{
    const {api,runtime,load}=fixture();await load();const oldContext=pending<ClientResult<WorkflowContextValue>>(),newContext=pending<ClientResult<WorkflowContextValue>>(),oldSkills=pending<ClientResult<WorkflowSkillsValue>>(),newSkills=pending<ClientResult<WorkflowSkillsValue>>();
    api.contextUsage.mockImplementation(request=>request.nodeId==='task-a'?oldContext.promise:newContext.promise);api.skills.mockImplementation(request=>request.nodeId==='task-a'?oldSkills.promise:newSkills.promise);
    runtime.selectContextTarget({nodeId:'task-a'});runtime.selectContextTarget({nodeId:'task-b'});expect(runtime.presentation().contextUsage).toBeUndefined();expect(runtime.presentation().skillOptions).toEqual([]);expect(runtime.presentation().contextLoading).toBe(true);
    newContext.resolve(ok(usage('private-task-b',{usedTokens:500})));newSkills.resolve(ok({skills:[{name:'native-b'}]}));await vi.waitFor(()=>expect(runtime.presentation().skillOptions).toEqual([{name:'native-b'}]));
    oldContext.resolve(ok(usage('private-task-a',{usedTokens:9999})));oldSkills.resolve(ok({skills:[{name:'stale-a'}]}));await Promise.all([oldContext.promise,oldSkills.promise]);await Promise.resolve();
    expect(runtime.presentation().contextUsage).toMatchObject({sessionId:'private-task-b',usedTokens:500});expect(runtime.presentation().skillOptions).toEqual([{name:'native-b'}]);expect(runtime.presentation().contextLoading).toBe(false);expect(runtime.presentation().skillsLoading).toBe(false);
  });
  it('does not let late failures from an old target erase the current context or native skills',async()=>{
    const {api,runtime,load}=fixture();await load();const oldContext=pending<ClientResult<WorkflowContextValue>>(),oldSkills=pending<ClientResult<WorkflowSkillsValue>>();api.contextUsage.mockImplementationOnce(()=>oldContext.promise);api.skills.mockImplementationOnce(()=>oldSkills.promise);
    runtime.selectContextTarget({nodeId:'old'});runtime.selectContextTarget({nodeId:'current'});await vi.waitFor(()=>expect(runtime.presentation().contextUsage?.sessionId).toBe('private-current'));
    oldContext.reject(new Error('Old context offline'));oldSkills.reject(new Error('Old skill lookup offline'));await Promise.allSettled([oldContext.promise,oldSkills.promise]);await Promise.resolve();
    expect(runtime.presentation().contextUsage?.sessionId).toBe('private-current');expect(runtime.presentation().skillOptions?.[0]?.name).toBe('native-test-skill');expect(runtime.presentation().contextError).toBeUndefined();expect(runtime.presentation().skillsError).toBeUndefined();
  });
  it('scopes an empty-canvas context to the selected branch and ignores late context and skills from the old branch',async()=>{
    const {api,runtime,load}=fixture(branchGraph());await load();
    const oldContext=pending<ClientResult<WorkflowContextValue>>(),newContext=pending<ClientResult<WorkflowContextValue>>(),oldSkills=pending<ClientResult<WorkflowSkillsValue>>(),newSkills=pending<ClientResult<WorkflowSkillsValue>>();
    api.contextUsage.mockImplementation(request=>request.branchId==='branch-a'?oldContext.promise:newContext.promise);api.skills.mockImplementation(request=>request.branchId==='branch-a'?oldSkills.promise:newSkills.promise);
    runtime.selectContextTarget(null);expect(api.contextUsage).toHaveBeenLastCalledWith({workflowId:graph().id,branchId:'branch-a'});
    runtime.selectBranch('branch-b');expect(runtime.presentation().contextUsage).toBeUndefined();expect(runtime.presentation().skillOptions).toEqual([]);expect(runtime.presentation().contextLoading).toBe(true);
    expect(api.contextUsage).toHaveBeenLastCalledWith({workflowId:graph().id,branchId:'branch-b'});expect(api.skills).toHaveBeenLastCalledWith({workflowId:graph().id,branchId:'branch-b'});
    newContext.resolve(ok(usage('session-b',{usedTokens:500})));newSkills.resolve(ok({skills:[{name:'branch-b-skill'}]}));await vi.waitFor(()=>expect(runtime.presentation().skillOptions).toEqual([{name:'branch-b-skill'}]));
    oldContext.resolve(ok(usage('session-a',{usedTokens:9999})));oldSkills.resolve(ok({skills:[{name:'stale-a'}]}));await Promise.all([oldContext.promise,oldSkills.promise]);await Promise.resolve();
    expect(runtime.presentation().contextUsage).toMatchObject({sessionId:'session-b',usedTokens:500});expect(runtime.presentation().skillOptions).toEqual([{name:'branch-b-skill'}]);expect(runtime.presentation().contextLoading).toBe(false);
  });
  it('does not let late failures from the old branch erase a new branch context',async()=>{
    const {api,runtime,load}=fixture(branchGraph());await load();const oldContext=pending<ClientResult<WorkflowContextValue>>(),oldSkills=pending<ClientResult<WorkflowSkillsValue>>();
    api.contextUsage.mockImplementation(request=>request.branchId==='branch-a'?oldContext.promise:Promise.resolve(ok(usage('session-b'))));api.skills.mockImplementation(request=>request.branchId==='branch-a'?oldSkills.promise:Promise.resolve(ok({skills:[{name:'branch-b-skill'}]})));
    runtime.selectContextTarget(null);runtime.selectBranch('branch-b');await vi.waitFor(()=>expect(runtime.presentation().contextUsage?.sessionId).toBe('session-b'));
    oldContext.reject(new Error('Old branch context disconnected'));oldSkills.reject(new Error('Old branch skills disconnected'));await Promise.allSettled([oldContext.promise,oldSkills.promise]);await Promise.resolve();
    expect(runtime.presentation().contextUsage?.sessionId).toBe('session-b');expect(runtime.presentation().skillOptions).toEqual([{name:'branch-b-skill'}]);expect(runtime.presentation().contextError).toBeUndefined();expect(runtime.presentation().skillsError).toBeUndefined();
  });
  it('rejects an immediate compact click after a branch switch while its new context is still loading',async()=>{
    const {api,runtime,load,select}=fixture(branchGraph());await load();api.contextUsage.mockResolvedValue(ok(usage('session-a')));await select(null,'session-a');const newContext=pending<ClientResult<WorkflowContextValue>>();api.contextUsage.mockImplementation(()=>newContext.promise);
    runtime.selectBranch('branch-b');await expect(runtime.compactContext()).rejects.toThrow('当前没有可压缩');expect(api.compactContext).not.toHaveBeenCalled();expect(runtime.presentation().contextUsage).toBeUndefined();expect(runtime.presentation().busy).toBe(false);
    newContext.resolve(ok(usage('session-b')));await vi.waitFor(()=>expect(runtime.presentation().contextUsage?.sessionId).toBe('session-b'));expect(api.compactContext).not.toHaveBeenCalled();
  });
  it('keeps unknown tokens unknown and preserves native configuration diagnostics instead of synthesizing usage',async()=>{
    const {api,runtime,load}=fixture();await load();const unknown=usage('private-task-a',{usedTokens:undefined,capacityTokens:undefined,source:'unavailable',canCompact:false,configurationIssue:'No native context window',unavailableReason:'Native projection unavailable'});api.contextUsage.mockResolvedValue(ok(unknown));runtime.selectContextTarget({nodeId:'task-a'});await vi.waitFor(()=>expect(runtime.presentation().contextLoading).toBe(false));
    expect(runtime.presentation().contextUsage).toEqual(unknown);expect(runtime.presentation().contextUsage?.usedTokens).toBeUndefined();expect(runtime.presentation().contextUsage?.capacityTokens).toBeUndefined();expect(runtime.presentation().contextUsage).not.toHaveProperty('percentage');expect(api.compactContext).not.toHaveBeenCalled();
  });
  it('routes planning lookup to its private target without passing the referenced original source and restores the focused node',async()=>{
    const {api,runtime,load,select}=fixture();await load();await select({nodeId:'task-a'},'private-task-a');await select({planning:true},'private-planning');expect(api.contextUsage).toHaveBeenLastCalledWith({workflowId:graph().id,planning:true});expect(api.skills).toHaveBeenLastCalledWith({workflowId:graph().id,planning:true});expect(api.contextUsage.mock.calls.at(-1)![0]).not.toHaveProperty('sessionId');
    await runtime.presentation().onCompactContext?.();expect(api.compactContext).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({workflowId:graph().id,sessionId:'private-planning'}));expect(api.compactContext.mock.calls[0]![0].sessionId).not.toBe('immutable-source');
    await select({nodeId:'task-a'},'private-task-a');expect(api.contextUsage).toHaveBeenLastCalledWith({workflowId:graph().id,nodeId:'task-a'});await select(null,'private-active-branch');expect(api.contextUsage).toHaveBeenLastCalledWith({workflowId:graph().id});
  });
  it('admits one compaction RPC for repeated UI clicks while saving the latest graph before admission and releasing edits afterward',async()=>{
    const {api,graphs,runtime,load,select}=fixture();await load();await select({nodeId:'task-a'},'private-task-a');const response=pending<ClientResult<WorkflowCompactValue>>();api.compactContext.mockImplementationOnce(()=>response.promise);graphs.change({...graphs.getSnapshot().workflows[0]!,name:'Saved before compaction'});
    const compact=runtime.presentation().onCompactContext!(),duplicate=runtime.presentation().onCompactContext!();expect(runtime.presentation().compacting).toBe(true);expect(runtime.presentation().busy).toBe(true);await vi.waitFor(()=>expect(api.compactContext).toHaveBeenCalledOnce());await duplicate;
    expect(api.save).toHaveBeenCalledOnce();expect(api.save.mock.invocationCallOrder[0]).toBeLessThan(api.compactContext.mock.invocationCallOrder[0]!);const sent=api.compactContext.mock.calls[0]![0];expect(sent).toEqual({workflowId:graph().id,sessionId:'private-task-a',operationId:expect.any(String)});expect(sent.operationId).toMatch(/^[\da-f-]{36}$/i);
    graphs.change({...graphs.getSnapshot().workflows[0]!,name:'Must not race native compaction'});expect(graphs.getSnapshot().workflows[0]!.name).toBe('Saved before compaction');
    response.resolve(ok({workflow:graphs.getSnapshot().workflows[0]!,context:usage('private-task-a',{usedTokens:300}),changed:true}));await compact;expect(runtime.presentation().compacting).toBe(false);expect(runtime.presentation().busy).toBe(false);graphs.change({...graphs.getSnapshot().workflows[0]!,name:'Editing released'});expect(graphs.getSnapshot().workflows[0]!.name).toBe('Editing released');expect(api.compactContext).toHaveBeenCalledOnce();
  });
  it('does not issue compaction for an original read-only Session even if a stale native capability flag says it can compact',async()=>{
    const {api,runtime,load}=fixture();await load();api.contextUsage.mockResolvedValue(ok(usage('immutable-source',{readOnly:true,canCompact:true})));runtime.selectContextTarget({sessionId:'immutable-source'});await vi.waitFor(()=>expect(runtime.presentation().contextUsage?.readOnly).toBe(true));
    await expect(runtime.compactContext()).rejects.toThrow();expect(api.compactContext).not.toHaveBeenCalled();expect(runtime.presentation().busy).toBe(false);
  });
  it('does not issue compaction after a graph flush failure and releases the graph lock without discarding the draft',async()=>{
    const {api,graphs,runtime,load,select}=fixture();await load();await select({nodeId:'task-a'},'private-task-a');graphs.change({...graphs.getSnapshot().workflows[0]!,name:'Retained unsaved title'});api.save.mockRejectedValueOnce(new Error('Controlled save disconnected'));
    await expect(runtime.compactContext()).rejects.toThrow('成功保存');expect(api.compactContext).not.toHaveBeenCalled();expect(graphs.hasUnsaved).toBe(true);expect(graphs.getSnapshot()).toMatchObject({saveState:'error',error:'Controlled save disconnected'});expect(runtime.presentation().compacting).toBe(false);expect(runtime.presentation().busy).toBe(false);
    graphs.change({...graphs.getSnapshot().workflows[0]!,name:'Editable retry draft'});expect(graphs.getSnapshot().workflows[0]!.name).toBe('Editable retry draft');await graphs.flush();expect(graphs.hasUnsaved).toBe(false);expect(api.compactContext).not.toHaveBeenCalled();
  });
  it('keeps an uncertain response failure visible and never automatically reissues compaction during refresh or retry',async()=>{
    const {api,runtime,load,select}=fixture();await load();await select({nodeId:'task-a'},'private-task-a');api.compactContext.mockRejectedValueOnce(new Error('Native compaction response lost'));api.contextUsage.mockResolvedValueOnce(ok(usage('private-task-a'))).mockRejectedValue(new Error('Native state needs reconciliation'));
    await expect(runtime.compactContext()).rejects.toThrow('Native compaction response lost');expect(api.compactContext).toHaveBeenCalledOnce();expect(runtime.presentation().busy).toBe(false);expect(runtime.presentation().compacting).toBe(false);await runtime.refreshContext();await runtime.reloadSkills();await runtime.retry();expect(api.compactContext).toHaveBeenCalledOnce();expect(runtime.presentation().contextError).toContain('reconciliation');
  });
  it('revalidates the latest private planning Session before compacting and never submits the replaced plan target',async()=>{
    const {api,runtime,load,select}=fixture();await load();await select({planning:true},'private-planning');api.contextUsage.mockResolvedValue(ok(usage('private-new-plan')));
    await expect(runtime.compactContext()).rejects.toThrow('上下文目标或执行状态已经变化');expect(api.contextUsage).toHaveBeenLastCalledWith({workflowId:graph().id,planning:true});expect(api.compactContext).not.toHaveBeenCalled();expect(runtime.presentation().busy).toBe(false);
    await vi.waitFor(()=>expect(runtime.presentation().contextUsage?.sessionId).toBe('private-new-plan'));
  });
  it.each([{canCompact:false},{readOnly:true}])('rechecks native admission after the displayed capability becomes stale: %j',async flags=>{
    const {api,runtime,load,select}=fixture();await load();await select({nodeId:'task-a'},'private-task-a');api.contextUsage.mockResolvedValue(ok(usage('private-task-a',flags)));
    await expect(runtime.compactContext()).rejects.toThrow('上下文目标或执行状态已经变化');expect(api.compactContext).not.toHaveBeenCalled();expect(runtime.presentation().busy).toBe(false);expect(runtime.presentation().compacting).toBe(false);
  });
  it('rejects a preflight result when a server refresh changes the active branch before admission',async()=>{
    const {api,graphs,runtime,load,select}=fixture(branchGraph());await load();api.contextUsage.mockResolvedValue(ok(usage('session-a')));await select(null,'session-a');const preflight=pending<ClientResult<WorkflowContextValue>>();api.contextUsage.mockImplementationOnce(()=>preflight.promise).mockResolvedValue(ok(usage('session-b')));
    const compact=runtime.compactContext();await vi.waitFor(()=>expect(api.contextUsage).toHaveBeenCalledTimes(2));graphs.acceptServer({...graphs.getSnapshot().workflows[0]!,revision:2,activeBranchId:'branch-b'});preflight.resolve(ok(usage('session-a')));
    await expect(compact).rejects.toThrow('上下文目标或执行状态已经变化');expect(api.compactContext).not.toHaveBeenCalled();await vi.waitFor(()=>expect(runtime.presentation().contextUsage?.sessionId).toBe('session-b'));expect(api.contextUsage).toHaveBeenLastCalledWith({workflowId:graph().id,branchId:'branch-b'});
  });
  it('does not replace a newly focused target with a previous compaction result',async()=>{
    const {api,graphs,runtime,load,select}=fixture();await load();await select({nodeId:'task-a'},'private-task-a');const response=pending<ClientResult<WorkflowCompactValue>>();api.compactContext.mockImplementationOnce(()=>response.promise);const compact=runtime.compactContext();await vi.waitFor(()=>expect(api.compactContext).toHaveBeenCalledOnce());await select({nodeId:'task-b'},'private-task-b');
    response.resolve(ok({workflow:graphs.getSnapshot().workflows[0]!,context:usage('private-task-a',{usedTokens:1}),changed:true}));await compact;await vi.waitFor(()=>expect(runtime.presentation().contextLoading).toBe(false));expect(runtime.presentation().contextUsage?.sessionId).toBe('private-task-b');expect(runtime.presentation().contextUsage?.usedTokens).toBe(2400);expect(api.compactContext).toHaveBeenCalledOnce();
  });
});
