import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowPendingQuestion, WorkflowQuestionsValue } from '../src/shared/model.ts';
import { WorkflowClient, type ClientResult } from '../src/client/data.ts';
import { WorkflowRuntimeClient, type WorkflowRuntimeApi } from '../src/client/runtime-data.ts';
import { questionRequestKey } from '../src/client/ui-contract.ts';

const ok=<T>(value:T):ClientResult<T>=>({ok:true,value});
const graph=(id='workflow'):Workflow=>({id,name:'TEST questions',schemaVersion:2,revision:1,nodes:[],edges:[],viewport:{x:0,y:0,zoom:1},createdAt:1,updatedAt:1});
const question=(callId='call'):WorkflowPendingQuestion=>({workflowId:'workflow',runId:`run-${callId}`,nodeId:`node-${callId}`,sessionId:`session-${callId}`,callId,questions:[{id:'q',question:'Native question',options:[{label:'Original label'}]}],state:'open',actionable:true,createdAt:1});
const cleanup:Array<()=>void>=[];
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function fixture(initial=[question()]){
  const save=vi.fn(),graphs=new WorkflowClient({list:async()=>ok({workflows:[graph(),graph('other')]}),create:async()=>ok({workflow:graph()}),save});await graphs.load();graphs.select('workflow');
  const api={questions:vi.fn(async()=>ok({questions:initial})),answerQuestion:vi.fn(async()=>ok({accepted:true}))};
  const runtime=new WorkflowRuntimeClient(api as unknown as WorkflowRuntimeApi,graphs);runtime.showWorkflow();cleanup.push(()=>{runtime.dispose();graphs.dispose();});await runtime.refreshQuestions();return {api,graphs,runtime,save};
}
afterEach(()=>{for(const dispose of cleanup.splice(0))dispose();});

describe('Native question client routing',()=>{
  it('answers continued native timed questions when the native DTO still marks them actionable',async()=>{
    const continued={...question(),state:'continued' as const}, {api,runtime}=await fixture([continued]);api.questions.mockResolvedValueOnce(ok({questions:[]}));await runtime.answerQuestion(continued,[{id:'q',selected:[]}]);expect(api.answerQuestion).toHaveBeenCalledOnce();
  });
  it('uses exact workflow/run/session/call identities without storing questions or marking the whole runtime busy',async()=>{
    const native=question(),{api,graphs,runtime,save}=await fixture([native]);api.questions.mockResolvedValueOnce(ok({questions:[]}));const answers=[{id:'q',selected:['Original label']}];await runtime.presentation().onAnswerQuestion!(native,answers);expect(api.answerQuestion).toHaveBeenCalledExactlyOnceWith({workflowId:native.workflowId,runId:native.runId,sessionId:native.sessionId,callId:native.callId,answers});expect(runtime.getSnapshot().busy).toBe(false);expect(runtime.presentation().pendingQuestions).toEqual([]);expect(save).not.toHaveBeenCalled();expect(graphs.getSnapshot().workflows[0]?.nodes).toEqual([]);
  });
  it('allows separate requests to submit concurrently and prevents duplicate delivery for one request',async()=>{
    const a=question('a'),b=question('b'),{api,runtime}=await fixture([a,b]);const first=deferred<ClientResult<{accepted:boolean}>>(),second=deferred<ClientResult<{accepted:boolean}>>();api.answerQuestion.mockImplementationOnce(()=>first.promise).mockImplementationOnce(()=>second.promise);const one=runtime.answerQuestion(a,[{id:'q',selected:[]}]),two=runtime.answerQuestion(b,[{id:'q',selected:[]}]);await runtime.answerQuestion(a,[{id:'q',selected:[]}]);expect(api.answerQuestion).toHaveBeenCalledTimes(2);expect(runtime.getSnapshot().busy).toBe(false);expect(runtime.presentation().submittingQuestionKeys).toEqual([questionRequestKey(a),questionRequestKey(b)]);api.questions.mockResolvedValue(ok({questions:[]}));first.resolve(ok({accepted:true}));second.resolve(ok({accepted:true}));await Promise.all([one,two]);expect(runtime.presentation().submittingQuestionKeys).toEqual([]);
  });
  it('keeps existing questions on a polling error and records answer rejection only on that request',async()=>{
    const native=question(),{api,runtime}=await fixture([native]);api.questions.mockRejectedValueOnce(new Error('Native question read failed'));await runtime.refreshQuestions();expect(runtime.presentation().pendingQuestions).toEqual([native]);expect(runtime.presentation().questionLoadError).toContain('Native question read failed');api.answerQuestion.mockResolvedValueOnce(ok({accepted:false}));await expect(runtime.answerQuestion(native,[{id:'q',selected:[]}])).rejects.toThrow('未被接受');expect(runtime.presentation().questionErrors?.[questionRequestKey(native)]).toContain('未被接受');expect(runtime.presentation().pendingQuestions).toEqual([native]);expect(runtime.getSnapshot().error).toBeUndefined();expect(runtime.getSnapshot().busy).toBe(false);
  });
  it('does not replay an old workflow response after switching the current workflow',async()=>{
    const {api,graphs,runtime}=await fixture([]),old=deferred<ClientResult<WorkflowQuestionsValue>>();api.questions.mockImplementationOnce(()=>old.promise);const flight=runtime.refreshQuestions();graphs.select('other');old.resolve(ok({questions:[question()]}));await flight;expect(runtime.presentation().pendingQuestions).toEqual([]);expect(api.answerQuestion).not.toHaveBeenCalled();
  });
});
