import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '../src/shared/model.ts';
import { WorkflowClient, type ClientResult } from '../src/client/data.ts';
import { WorkflowRuntimeClient, type WorkflowRuntimeApi } from '../src/client/runtime-data.ts';

const ok=<T>(value:T):ClientResult<T>=>({ok:true,value});
const graph=():Workflow=>({id:'subagent-policy',name:'TEST policy',schemaVersion:2,revision:1,nodes:[],edges:[],viewport:{x:0,y:0,zoom:1},createdAt:1,updatedAt:1});
const resources:{graphs:WorkflowClient;runtime:WorkflowRuntimeClient}[]=[];
function fixture(workflow=graph()){
  const save=vi.fn(async(request:{workflow:Workflow;expectedRevision:number})=>ok({ok:true as const,workflow:{...request.workflow,revision:request.expectedRevision+1}}));
  const graphs=new WorkflowClient({list:async()=>ok({workflows:[workflow]}),create:async()=>ok({workflow}),save});
  const runtime=new WorkflowRuntimeClient({} as WorkflowRuntimeApi,graphs);resources.push({graphs,runtime});return {graphs,runtime,save};
}
afterEach(()=>{for(const {graphs,runtime} of resources.splice(0)){runtime.dispose();graphs.dispose();}});

describe('Subagent policy persistence',()=>{
  it('defaults old workflows to off without rewriting them',async()=>{
    const {graphs,runtime,save}=fixture();await graphs.load();expect(runtime.presentation().subagentMode).toBe('off');runtime.showWorkflow();runtime.presentation().onChangeSubagentMode?.('off');expect(graphs.getSnapshot().workflows[0]?.settings).toBeUndefined();expect(save).not.toHaveBeenCalled();
  });
  it('stores the selected mode through graph history and persistence while retaining all other settings',async()=>{
    const original={...graph(),settings:{generation:'dynamic' as const,execution:'auto' as const,model:{provider:'TEST provider',model:'TEST model'}}};const {graphs,runtime,save}=fixture(original);await graphs.load();runtime.showWorkflow();await runtime.presentation().onChangeSubagentMode?.('on');expect(graphs.getSnapshot().workflows[0]?.settings).toEqual({...original.settings,subagents:'on'});await graphs.flush();expect(save).toHaveBeenLastCalledWith(expect.objectContaining({workflow:expect.objectContaining({settings:{...original.settings,subagents:'on'}})}));expect(runtime.presentation().subagentMode).toBe('on');
    runtime.presentation().onChangePolicies?.('manual','manual');expect(graphs.getSnapshot().workflows[0]?.settings).toEqual({...original.settings,generation:'manual',execution:'manual',subagents:'on'});runtime.presentation().onChangeSubagentMode?.('auto');expect(runtime.presentation().subagentMode).toBe('auto');graphs.undo();expect(runtime.presentation().subagentMode).toBe('on');graphs.redo();expect(runtime.presentation().subagentMode).toBe('auto');
  });
  it('uses existing policy defaults when adding mode to an old workflow and rejects catalog changes',async()=>{
    const {graphs,runtime}=fixture();await graphs.load();runtime.presentation().onChangeSubagentMode?.('on');expect(graphs.getSnapshot().workflows[0]?.settings).toBeUndefined();runtime.showWorkflow();runtime.presentation().onChangeSubagentMode?.('auto');expect(graphs.getSnapshot().workflows[0]?.settings).toEqual({generation:'suggest',execution:'approval',subagents:'auto'});
  });
});
