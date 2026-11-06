/** Adapter over released rc.3 capabilities. Imported source Sessions are read only. */
import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type { PromptContentPart, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type {} from '@deepseek-ai/dsh-client-file-upload';
import type { FileUploadReceiptId } from '@deepseek-ai/dsh-client-file-upload/types';
import { boundContextSummary, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SubagentActivation, SubagentRuntime } from '@deepseek-ai/dsh-subagent';
import type { WorkflowModelIdentity, WorkflowModelOption, WorkflowModelsValue, WorkflowPendingQuestion, WorkflowQuestionAnswer, WorkflowQuestionItem } from '../shared/model.ts';
import type {} from '@deepseek-ai/dsh-session-query';
import type {} from '@deepseek-ai/dsh-tools';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox';
import { compactionContinuationBoundary } from './compaction-history.ts';

export interface NativeEvent { type: string; seq: number; time: number; data: Record<string, unknown> }
export interface NativeSessionLog {
  sessionId: string;
  header: { id: string; createdAt: number; cwd?: string; parentSession?: string; agentPreset?: string; isSeeded: boolean };
  inheritedEventCount: number;
  events: NativeEvent[];
}
export interface NativeSessionSummary {
  sessionId: string; title: string; updatedAt: number; running: boolean; blank: boolean;
  parentSessionId?: string; cwd?: string; formatStatus?: 'current' | 'migration-required';
}
/** A verified immutable native reference. Neither browser paths nor upload receipts persist here. */
export interface NativeFileReference { attachmentId:string; name:string; bytes:number }
interface SelectedExecutionModel { current?:WorkflowModelIdentity; assembled?:WorkflowModelIdentity; requestId:string; owningTurn?:number; questionCallId?:string }
type NativePendingQuestion=Omit<WorkflowPendingQuestion,'workflowId'|'runId'|'nodeId'>;
// Structural declarations match the installed rc.3 public service contract.
// The optional service is intentionally not a required runtime dependency.
interface NativeQuestionRequest {questions:WorkflowQuestionItem[];agent?:Agent;signal?:AbortSignal;wait?:{callId:string;timed?:boolean}}
interface NativeQuestionAnswerBatch {answers:WorkflowQuestionAnswer[]}
interface NativeQuestionService {answer(agent:Agent,callId:string,answer:NativeQuestionAnswerBatch):boolean}
interface LiveQuestionWait {agent:Agent;callId:string;questions:WorkflowQuestionItem[];createdAt:number;signal?:AbortSignal;resolve:(answer:NativeQuestionAnswerBatch)=>void;reject:(reason:unknown)=>void;release:()=>void}
const questionControlSources=new Set(['model-selection','runtime-context','working-directory','ptc-mode','tool-registry','user-approval','compact-checkpoint','system-prompt','plan-mode']);
declare module '@deepseek-ai/cordis' {interface Events {'user-questions/request'(request:NativeQuestionRequest,next:()=>Promise<NativeQuestionAnswerBatch>):Promise<NativeQuestionAnswerBatch>}}
export interface NativeRuntime {
  models():Promise<WorkflowModelsValue>;
  resolveModel(selection?:WorkflowModelIdentity):Promise<WorkflowModelIdentity>;
  catalog(signal?: AbortSignal): Promise<NativeSessionSummary[]>;
  read(sessionId: string): Promise<NativeSessionLog>;
  create(options?: { sessionId?: string; cwd?: string; agentPreset?: string }): Promise<{ sessionId: string }>;
  fork(request: { sessionId: string; atSeq: number }): Promise<{ sessionId: string; inheritedEventCount: number }>;
  resolveUploadedFile(sessionId:string,receiptId:string):Promise<NativeFileReference>;
  submit(request: { sessionId: string; requestId: string; text: string; clientTimeZone?: string; planning?: boolean; files?:readonly NativeFileReference[]; model?:WorkflowModelIdentity }): Promise<void>;
  cancel(sessionId: string, requestId?: string): Promise<'queued' | 'active' | 'none'>;
  flush(sessionId: string): Promise<void>;
  subscribe(listener: (sessionId: string, event: NativeEvent) => void): () => void;
  isRunning(sessionId: string): boolean;
  waitForIdle(sessionId: string): Promise<void>;
  protectPlanning(sessionId: string,files?:readonly NativeFileReference[]): void;
  supportsSubagents?():boolean;
  startSubagent?(request:{parentSessionId:string;childSessionId:string;label:string;text:string;files?:readonly NativeFileReference[];model?:WorkflowModelIdentity;accessMode?:string}):Promise<{messageId:string}>;
  cancelSubagent?(childSessionId:string):Promise<void>;
  disposeSubagents?():Promise<void>;
  questions?(sessionId:string):Promise<NativePendingQuestion[]>;
  answerQuestion?(sessionId:string,callId:string,answers:WorkflowQuestionAnswer[],resume?:{model:WorkflowModelIdentity;requestId:string}):Promise<boolean>;
  setQuestionOwner?(owns:(sessionId:string,callId:string)=>Promise<boolean>):void;
  pendingQuestionReplies?(sessionId:string):string[];
}

/** Strictly select a real, completed inclusive boundary; synthetic crash closers never qualify. */
export function completedBoundary(log: NativeSessionLog, requested?: number): number | undefined {
  const eligible = log.events.filter(event => event.type === 'turn/end' &&
    record(event.data.reason).kind === 'completed');
  if (requested !== undefined) {
    if (!Number.isSafeInteger(requested) || requested < 0 || !eligible.some(event => event.seq === requested||compactionContinuationBoundary(log,event.seq)===requested)) {
      throw new Error('Fork requires an existing completed turn/end event boundary');
    }
    return requested;
  }
  return eligible.at(-1)?.seq;
}

/** The Context declaring this adapter must inject every service named here. */
export class DshNativeRuntime implements NativeRuntime {
  static readonly inject = ['sessionController', 'sessionQuery', 'sessions', 'agents', 'tools', 'attachments', 'fileUploads', 'agentDefaultModel', 'llm', 'systemPrompt'];
  private readonly planningAgents = new WeakSet<object>();
  private readonly planningSessions = new Set<string>();
  private readonly planningReadPaths = new Map<string,ReadonlySet<string>>();
  private readonly selectedModels = new WeakMap<Agent,SelectedExecutionModel>();
  private readonly subagentActivations = new Map<string,SubagentActivation>();
  private readonly subagentStarts = new Map<string,{controller:AbortController;flight:Promise<SubagentActivation>}>();
  private readonly subagentSandboxModes = new Map<string,{parentSessionId:string;mode:SandboxMode}>();
  private subagentsStopping = false;
  private questionOwner?: (sessionId:string,callId:string)=>Promise<boolean>;
  private readonly questionWaits = new Map<string,LiveQuestionWait>();
  private readonly questionListeners = new Set<(sessionId:string,event:NativeEvent)=>void>();
  constructor(private readonly ctx: Context) {
    // Reapply the scope-owned policy before a cold resumed Agent may drive its
    // inbox. The Workflow store registers its durable planning identities here.
    ctx.on('agent/created', ({ agent }) => {
      if (this.planningSessions.has(agent.id)) this.protectPlanningAgent(agent);
      const permission=this.subagentSandboxModes.get(agent.id);
      if(permission){
        if(agent.session.header.origin!=='subagent'||agent.session.header.parentSession!==permission.parentSessionId)throw new Error('The reserved Workflow child does not match its native permission owner.');
        // Apply the user's sandbox snapshot after native setup and before the
        // child can drive. Its native delegated approval=never pin is retained.
        setSandboxMode(agent.session,permission.mode);
      }
    });
    ctx.on('session/event',(session,event)=>{
      if(event.type!=='turn/end')return;const agent=ctx.agents.get(session.id);if(!agent)return;
      const selection=this.selectedModels.get(agent);if(!selection?.current)return;
      if(selection.owningTurn===event.data.turn){
        selection.current=undefined;selection.assembled=undefined;selection.owningTurn=undefined;selection.questionCallId=undefined;
      }
    });
    ctx.on('user-questions/request',async(request,next)=>{
      const agent=request.agent;
      if(!agent||!this.questionOwner)return next();
      const callId=request.wait?.callId??this.legacyQuestionCallId(agent,request.questions);
      if(!callId||!await this.questionOwner(agent.id,callId))return next();
      if(request.signal?.aborted)throw request.signal.reason;
      if(this.ctx.agents.get(agent.id)!==agent||!this.ctx.agents.roots().includes(agent))return next();
      const key=this.questionKey(agent.id,callId);
      if(this.questionWaits.has(key))return next();
      return new Promise<NativeQuestionAnswerBatch>((resolve,reject)=>{
        const event=agent.session.snapshotEvents().findLast(item=>item.type==='tool/call'&&item.data.callId===callId||item.type==='tool/ptc-dispatch-start'&&item.data.subCallId===callId);
        const abort=()=>{wait.release();reject(request.signal?.reason??new Error('The native question wait was aborted.'));};
        const wait:LiveQuestionWait={agent,callId,questions:structuredClone(request.questions),createdAt:event?.time??Date.now(),signal:request.signal,resolve,reject,release:()=>{
          request.signal?.removeEventListener('abort',abort);
          if(this.questionWaits.get(key)===wait)this.questionWaits.delete(key);
          this.notifyQuestionState(agent.id);
        }};
        this.questionWaits.set(key,wait);request.signal?.addEventListener('abort',abort,{once:true});this.notifyQuestionState(agent.id);
        if(request.signal?.aborted)abort();
      });
    },{prepend:true});
    ctx.effect(()=>()=>{
      for(const wait of [...this.questionWaits.values()]){wait.release();wait.reject(new Error('The Workflow question interface was disposed.'));}
      this.questionListeners.clear();
    },'visual-workflow.question-waits');
  }

  setQuestionOwner(owns:(sessionId:string,callId:string)=>Promise<boolean>):void{this.questionOwner=owns;}
  pendingQuestionReplies(sessionId:string):string[]{
    const agent=this.ctx.agents.get(SessionId(sessionId));if(!agent)return [];
    return [...agent.inbox.nextStep,...agent.inbox.nextTurn].flatMap(message=>{const source=record(message.source);return source.kind==='user-question-reply'&&source.outcome==='answered'&&typeof source.callId==='string'?[source.callId]:[];});
  }
  private questionKey(sessionId:string,callId:string):string{return `${sessionId}\0${callId}`;}
  private notifyQuestionState(sessionId:string):void{
    // An adapter notification only: it is never appended to the native log.
    const notification:NativeEvent={type:'workflow/question-state',seq:-1,time:Date.now(),data:{}};
    for(const listener of this.questionListeners)try{listener(sessionId,notification);}catch(error){this.ctx.logger.error('Workflow question state listener failed',error);}
  }
  private legacyQuestionCallId(agent:Agent,questions:WorkflowQuestionItem[]):string|undefined{
    const unresolved=new Map<string,WorkflowQuestionItem[]>();
    for(const event of agent.session.ownEvents()){
      if((event.type==='tool/call'||event.type==='tool/ptc-dispatch-start')&&event.data.name==='ask_user_question'){
        try{const args=event.type==='tool/call'?JSON.parse(event.data.arguments) as {questions?:unknown}:record(event.data.arguments);const items=normalizeQuestionItems(args.questions);const callId=event.type==='tool/call'?event.data.callId:event.data.subCallId;if(items)unresolved.set(callId,items);}catch{/* Invalid native arguments cannot identify a wait. */}
      }else if(event.type==='tool/result')unresolved.delete(event.data.message.toolCallId);
      else if(event.type==='tool/ptc-dispatch')unresolved.delete(event.data.subCallId);
    }
    const signature=(items:WorkflowQuestionItem[])=>JSON.stringify(items.map(item=>({id:item.id,question:item.question,header:item.header,detail:item.detail,options:item.options,multiSelect:item.multiSelect??false})));
    const matches=[...unresolved].filter(([,items])=>signature(items)===signature(questions));
    return matches.length===1?matches[0]![0]:undefined;
  }
  private questionInboxBlocked(agent:Agent|undefined,callId:string):boolean{
    return !!agent&&[...agent.inbox.nextStep,...agent.inbox.nextTurn].some(message=>{
      const source=record(message.source);
      if(source.kind==='user-question-reply')return true; // Same-call duplicates and other-question work both block admission.
      return typeof source.kind!=='string'||!questionControlSources.has(source.kind);
    });
  }
  async questions(sessionId:string):Promise<NativePendingQuestion[]>{
    if(!this.ctx.get('userQuestions'))return [];
    const observation=await this.ctx.sessionQuery.observeSession(SessionId(sessionId),{projectionMode:'all'});
    try{
      const view=record(record(observation.projections?.values).userQuestions),rows=Array.isArray(view.active)?view.active:[],result=new Map<string,NativePendingQuestion>();
      const agent=this.ctx.agents.get(SessionId(sessionId)),liveRoot=agent?this.ctx.agents.roots().includes(agent):observation.header.origin!=='subagent';
      for(const value of rows){
        const row=record(value),callId=typeof row.callId==='string'?row.callId:undefined,items=normalizeQuestionItems(row.questions);
        if(!callId||!items||!['open','continued'].includes(String(row.state)))continue;
        const wait=this.questionWaits.get(this.questionKey(sessionId,callId)),foreground=!!wait&&!wait.signal?.aborted&&wait.agent===agent;
        const event=observation.events.find(item=>item.seq>=observation.inheritedEventCount&&(item.type==='tool/call'&&item.data.callId===callId||item.type==='tool/ptc-dispatch'&&item.data.subCallId===callId));
        result.set(callId,{sessionId,callId,questions:items,state:row.state as 'open'|'continued',actionable:liveRoot&&!this.questionInboxBlocked(agent,callId)&&(row.state==='continued'||foreground),createdAt:event?.time??wait?.createdAt??observation.header.createdAt});
      }
      for(const wait of this.questionWaits.values())if(wait.agent.id===sessionId&&!wait.signal?.aborted&&wait.agent===agent&&!result.has(wait.callId))result.set(wait.callId,{sessionId,callId:wait.callId,questions:structuredClone(wait.questions),state:'open',actionable:liveRoot&&!this.questionInboxBlocked(agent,wait.callId),createdAt:wait.createdAt});
      return [...result.values()];
    }finally{observation[Symbol.dispose]();}
  }
  async answerQuestion(sessionId:string,callId:string,answers:WorkflowQuestionAnswer[],resume?:{model:WorkflowModelIdentity;requestId:string}):Promise<boolean>{
    const service=this.ctx.get('userQuestions') as NativeQuestionService|undefined;
    if(!service||!this.questionOwner||!await this.questionOwner(sessionId,callId))return false;
    const question=(await this.questions(sessionId)).find(item=>item.callId===callId);
    if(!question?.actionable)return false;
    const named=new Set(answers.map(answer=>answer.id));
    if(named.size!==answers.length||answers.length!==question.questions.length||question.questions.some(item=>!named.has(item.id)))throw new Error('A native question answer must name each question exactly once.');
    for(const answer of answers){const item=question.questions.find(item=>item.id===answer.id)!;if(new Set(answer.selected).size!==answer.selected.length||item.multiSelect!==true&&answer.selected.length>1||answer.selected.some(label=>!item.options?.some(option=>option.label===label)))throw new Error('A native question answer contains an invalid option selection.');}
    const key=this.questionKey(sessionId,callId),wait=this.questionWaits.get(key);
    if(wait){
      if(!await this.questionOwner(sessionId,callId)||this.questionWaits.get(key)!==wait||wait.signal?.aborted||this.ctx.agents.get(wait.agent.id)!==wait.agent||this.questionInboxBlocked(wait.agent,callId))return false;
      wait.release();wait.resolve({answers:structuredClone(answers)});return true;
    }
    if(question.state!=='continued')return false;
    const resolved=await this.ctx.sessionController.resolveAgent(SessionId(sessionId));if('error' in resolved)throw resolved.error;
    const fresh=(await this.questions(sessionId)).find(item=>item.callId===callId);
    if(fresh?.state!=='continued'||!fresh.actionable)return false;
    const model=resume?await this.resolveModel(resume.model):undefined;
    if(!await this.questionOwner(sessionId,callId))return false;
    if(this.ctx.agents.get(resolved.agent.id)!==resolved.agent||!this.ctx.agents.roots().includes(resolved.agent)||this.questionInboxBlocked(resolved.agent,callId))return false;
    if(model&&resume)this.selectAgentModel(resolved.agent,model,resume.requestId,callId);
    const clear=()=>{const selection=this.selectedModels.get(resolved.agent);if(selection?.questionCallId===callId&&selection.requestId===resume?.requestId){selection.current=undefined;selection.assembled=undefined;selection.owningTurn=undefined;selection.questionCallId=undefined;}};
    try{const accepted=service.answer(resolved.agent,callId,{answers:structuredClone(answers)});if(accepted)this.notifyQuestionState(sessionId);else clear();return accepted;}catch(error){clear();throw error;}
  }

  protectPlanning(sessionId: string,files?:readonly NativeFileReference[]): void {
    if(files!==undefined){
      const paths=new Set<string>();
      for(const file of files){
        const ref={...file,attachmentId:file.attachmentId as FileAttachmentRef['attachmentId']};
        const path=this.ctx.attachments.fileHostPath?.(ref);
        if(!path)throw new Error(`Planning attachment ${file.name} has no native readable file path in this environment.`);
        paths.add(path);
      }
      this.planningReadPaths.set(sessionId,paths);
    }
    this.planningSessions.add(sessionId);
    const agent = this.ctx.agents.get(SessionId(sessionId));
    if (agent) this.protectPlanningAgent(agent);
  }

  private protectPlanningAgent(agent: Agent): void {
    if (this.planningAgents.has(agent)) return;
    // This native monotonic guard runs after extensible policy, before every
    // tool body, including scoped tools and the reserved PTC transport. It
    // belongs to this dedicated planning Agent, so closing a panel or
    // returning the prompt acknowledgement cannot lift it prematurely.
    // This is a dedicated planning Agent. A native presentation exposes the
    // read tool even when its preset/deployment otherwise presents only PTC.
    agent.ctx.tools.presentAs('native');
    agent.ctx.tools.guard(execution=>{
      const path=record(execution.arguments).file_path;
      if(execution.name==='read'&&!execution.parent&&execution.agent===agent&&typeof path==='string'&&this.planningReadPaths.get(agent.id)?.has(path))return undefined;
      return 'Workflow plan generation cannot execute tools before plan approval; only its uploaded read-only planning files may be read';
    });
    this.planningAgents.add(agent);
  }

  async models():Promise<WorkflowModelsValue>{
    const catalog=await this.ctx.sessionController.modelCatalog();
    const models:WorkflowModelOption[]=catalog.groups.flatMap(group=>group.models.map(model=>({
      provider:group.id,model:model.id,label:`${group.name} / ${model.name}`,
      ...(model.reasoning===undefined?{}:{reasoning:{
        efforts:model.reasoning.efforts.map(effort=>({id:effort.id,name:effort.name,...effort.description===undefined?{}:{description:effort.description}})),
        ...model.reasoning.defaultEffort===undefined?{}:{defaultEffort:model.reasoning.defaultEffort},
      }}),
    })));
    const selected=catalog.default;
    const defaultModel=models.some(model=>model.provider===selected.provider&&model.model===selected.model)?{
      provider:selected.provider,model:selected.model,...(selected.reasoningEffort===undefined?{}:{reasoningEffort:selected.reasoningEffort}),
    }:undefined;
    return {models,...defaultModel?{defaultModel}:{}};
  }
  async listModels():Promise<WorkflowModelOption[]>{return (await this.models()).models;}
  async getDefaultModel():Promise<WorkflowModelIdentity|undefined>{return (await this.models()).defaultModel;}
  async resolveModel(selection?:WorkflowModelIdentity):Promise<WorkflowModelIdentity>{
    const catalog=await this.models();const requested=selection??catalog.defaultModel;
    if(!requested)throw new Error('No available default model is configured in DSH. Choose an available model before running or planning.');
    const model=catalog.models.find(model=>model.provider===requested.provider&&model.model===requested.model);
    if(!model)throw new Error(`Model ${requested.provider}/${requested.model} is not currently available. Choose an available DSH model.`);
    // Capability validation is metadata-only: it never dispatches a provider request.
    const resolved=await this.ctx.llm.resolveCallConfig({
      provider:model.provider,model:model.model,
      ...(requested.reasoningEffort===undefined?{}:{reasoningEffort:ReasoningEffortId(requested.reasoningEffort)}),
    });
    return {
      provider:resolved.provider,model:resolved.model,
      ...(resolved.reasoningEffort===undefined?{}:{reasoningEffort:String(resolved.reasoningEffort)}),
    };
  }

  private selectAgentModel(agent:Agent,model:WorkflowModelIdentity,requestId:string,questionCallId?:string):void{
    let selected=this.selectedModels.get(agent);
    if(selected){selected.current={...model};selected.requestId=requestId;selected.questionCallId=questionCallId;selected.owningTurn=undefined;selected.assembled=undefined;}else{
      const state:SelectedExecutionModel={current:{...model},requestId,questionCallId};selected=state;this.selectedModels.set(agent,state);
      // The public claim event precedes first-step prompt assembly. Arming a
      // later queued Workflow request must not affect a native conversation
      // request that happened to enter the same Agent first.
      agent.ctx.on('agent/inbox/claimed',({message,turn})=>{
        const source=record(message.source);
        const owns=state.questionCallId?source.kind==='user-question-reply'&&source.callId===state.questionCallId:source.kind==='user'&&source.rpcId===state.requestId;
        if(owns&&state.current){
          state.owningTurn=turn;
          // Native intent is recorded only when this exact prompt is claimed,
          // before its assembly. Merely arming queued work must not change an
          // earlier native request or leave a choice behind after queue removal.
          agent.session.append('model/selection',{...state.current});
        }
      });
      const ownsOpenTurn=()=>{
        if(state.owningTurn===undefined)return false;
        const last=agent.session.snapshotEvents().findLast(event=>event.type==='turn/start'||event.type==='turn/end');
        return last?.type==='turn/start'&&last.data.turn===state.owningTurn;
      };
      // These public scoped waterfalls are the rc.3 extension points for
      // request routing. Prepending makes this explicit Execution selection
      // authoritative over the Controller's default-selection listeners.
      agent.ctx.on('system-prompt/assemble',async(_assembly,_context,next)=>{
        const choice=ownsOpenTurn()?state.current:undefined;const assembly=await next();state.assembled=choice;if(!choice)return assembly;
        return {...assembly,variables:{...assembly.variables,provider:choice.provider,model:choice.model}};
      },{prepend:true});
      agent.ctx.on('agent/request',async({turn},next)=>{
        const config=await next();const choice=state.owningTurn===turn?state.assembled??state.current:undefined;if(!choice)return config;
        const {reasoningEffort:_inheritedEffort,...rest}=config;
        return {...rest,provider:choice.provider,model:choice.model,
          ...(choice.reasoningEffort===undefined?{}:{reasoningEffort:ReasoningEffortId(choice.reasoningEffort)})};
      },{prepend:true});
      agent.ctx.on('agent/pre-step',async({messages,signal,step,turn},next)=>{
        const decision=await next();if(decision.kind==='reject'||signal.aborted||decision.messages.length===0&&(step===1||messages.length>0))return decision;
        const choice=state.owningTurn===turn?state.assembled??state.current:undefined;const previous=agent.session.requestHeader()?.config;
        if(!choice||!previous||previous.provider===choice.provider&&previous.model===choice.model)return decision;
        const before=`${previous.provider}/${previous.model}`,after=`${choice.provider}/${choice.model}`;
        const notice=createUserMessage({content:[{type:'text',text:`[model changed: assistant turns above this point were generated by ${before}; the session continues with ${after}]`}],source:{kind:'model-selection',form:'notice',summary:boundContextSummary(`${before} → ${after}`)}});
        return {...decision,messages:[...decision.messages,notice]};
      },{prepend:true});
    }
    // Claim observation records native intent. The application-wide default
    // configuration is deliberately never written by this scoped selection.
  }

  async catalog(signal = new AbortController().signal): Promise<NativeSessionSummary[]> {
    const { items } = await this.ctx.sessionController.list({}, signal);
    return Promise.all(items.map(async item => {
      signal.throwIfAborted();
      const projectedTitle = item.projections?.values.title;
      const title = typeof projectedTitle === 'string' ? projectedTitle
        : (await this.ctx.sessionQuery.readTitle(SessionId(item.sessionId), signal).catch(() => undefined))?.title;
      return { sessionId: item.sessionId, title: title || item.sessionId, updatedAt: item.updatedAt,
        running: item.running, blank: item.blank, ...(item.parentSessionId ? { parentSessionId: item.parentSessionId } : {}),
        ...(item.cwd ? { cwd: item.cwd } : {}), ...(item.formatStatus ? { formatStatus: item.formatStatus } : {}) };
    }));
  }

  async read(sessionId: string): Promise<NativeSessionLog> {
    const snapshot = await this.ctx.sessionQuery.readSession(SessionId(sessionId));
    return { sessionId: snapshot.session.id, header: { ...snapshot.session }, inheritedEventCount: snapshot.inheritedEventCount,
      events: snapshot.events as unknown as NativeEvent[] };
  }

  async create(options: { sessionId?: string; cwd?: string; agentPreset?: string } = {}): Promise<{ sessionId: string }> {
    // No supplied existing identity is reused: only a caller-minted new ID is accepted here.
    if (options.sessionId) {
      const present = await this.catalog();
      if (present.some(item => item.sessionId === options.sessionId)) throw new Error('Refusing to reuse an existing source Session');
    }
    return this.ctx.sessionController.create({ ...options,
      ...(options.sessionId ? { sessionId: SessionId(options.sessionId) } : { sessionId: undefined }) });
  }

  async fork(request: { sessionId: string; atSeq: number }): Promise<{ sessionId: string; inheritedEventCount: number }> {
    // Flushing only a live source drains already committed input; never resume or append to it.
    if (this.ctx.sessions.get(SessionId(request.sessionId))) await this.flush(request.sessionId);
    const source = await this.read(request.sessionId);
    completedBoundary(source, request.atSeq);
    const result = await this.ctx.sessionController.fork({ sessionId: SessionId(request.sessionId), atSeq: request.atSeq, allowMigration: false });
    if (result.sessionId === request.sessionId) throw new Error('Native fork returned the source Session identity');
    return { sessionId: result.sessionId, inheritedEventCount: request.atSeq + 1 };
  }

  /** Optional native capability: ordinary execution still works when it is absent. */
  supportsSubagents():boolean{
    const provider=(this.ctx.get('subagents') as SubagentRuntime|undefined)?.getProvider('fork');
    return !!provider&&provider.inheritsParentContext&&typeof provider.prepareContinuable==='function'&&provider.capabilities.agentOptions;
  }

  async startSubagent(request:{parentSessionId:string;childSessionId:string;label:string;text:string;files?:readonly NativeFileReference[];model?:WorkflowModelIdentity;accessMode?:string}):Promise<{messageId:string}>{
    const subagents=this.ctx.get('subagents') as SubagentRuntime|undefined;
    if(!subagents||!this.supportsSubagents())throw new Error('The native rc.3 fork subagent provider is unavailable.');
    if(this.subagentsStopping)throw new Error('Workflow native subagents are stopping.');
    if(!request.text.trim()||!request.childSessionId||request.parentSessionId===request.childSessionId)throw new Error('A native subagent requires a nonempty task and an independent reserved child Session.');
    if(this.subagentActivations.has(request.childSessionId)||this.subagentStarts.has(request.childSessionId))throw new Error('This native child Session already has an owned activation.');
    const model=await this.resolveModel(request.model);
    const content:ContentBlock[]=[{type:'text',text:request.text}];
    // The native child endpoint does not accept upload receipts. Host-owned
    // references are verified in full before native admission, then persisted
    // directly as the released ContentBlock file vocabulary.
    for(const file of request.files??[]){
      const ref:FileAttachmentRef={...file,attachmentId:file.attachmentId as FileAttachmentRef['attachmentId']};
      let bytes=0;
      for await(const chunk of this.ctx.attachments.readFileStream(ref)){
        bytes+=chunk.byteLength;
        if(!Number.isSafeInteger(bytes)||bytes>ref.bytes)throw new Error('Native subagent attachment length does not match its verified reference.');
      }
      if(bytes!==ref.bytes)throw new Error('Native subagent attachment length does not match its verified reference.');
      content.push({type:'file',attachment:ref});
    }
    const resolved=await this.ctx.sessionController.resolveAgent(SessionId(request.parentSessionId));
    if('error' in resolved)throw resolved.error;
    const parent=resolved.agent;
    if(parent.status!=='idle'||parent.inbox.nextStep.length||parent.inbox.nextTurn.length)throw new Error('The private subagent coordinator must be idle before native delegation.');
    if(this.subagentsStopping)throw new Error('Workflow native subagents are stopping.');
    if(this.subagentActivations.has(request.childSessionId)||this.subagentStarts.has(request.childSessionId))throw new Error('This native child Session already has an owned activation.');
    let sandboxMode:SandboxMode|undefined;
    if(request.accessMode){
      const permissions=this.ctx.get('permissionPresets') as {catalog():{options:Array<{value:string}>};resolve(name:string):{sandbox:SandboxMode}}|undefined;
      if(request.accessMode==='auto')throw new Error('Native automatic approval review requires an ordinary Session; owned child Agents retain approval=never.');
      if(!permissions?.catalog().options.some(option=>option.value===request.accessMode))throw new Error('The selected native permission preset is not currently available for this child.');
      sandboxMode=permissions.resolve(request.accessMode).sandbox;
    }
    const controller=new AbortController();
    const maxDepth=subagents.resolveMaxDepth();
    if(sandboxMode)this.subagentSandboxModes.set(request.childSessionId,{parentSessionId:request.parentSessionId,mode:sandboxMode});
    let flight:Promise<SubagentActivation>;
    try{flight=subagents.startActivation({provider:'fork',label:request.label||'Workflow task',childId:SessionId(request.childSessionId),delivery:'caller',signal:controller.signal,request:{parent,prompt:content,agentOptions:{provider:model.provider,model:model.model,...(model.reasoningEffort===undefined?{}:{reasoningEffort:ReasoningEffortId(model.reasoningEffort)})},...(maxDepth===undefined?{}:{maxDepth})}});}catch(error){this.subagentSandboxModes.delete(request.childSessionId);throw error;}
    const pending={controller,flight};this.subagentStarts.set(request.childSessionId,pending);
    try{
      const activation=await flight;
      if(this.subagentsStopping){await activation.dispose();throw new Error('Workflow stopped while the native child was being admitted.');}
      this.subagentActivations.set(request.childSessionId,activation);
      // A result rejection describes infrastructure, not a rejected start.
      // Native Session events and subagent/end remain the projection sources.
      void activation.result.catch(error=>{this.ctx.logger.error('Workflow native subagent settlement failed',error);}).finally(()=>{if(this.subagentActivations.get(request.childSessionId)===activation)this.subagentActivations.delete(request.childSessionId);}).catch(()=>{});
      if(activation.childId!==request.childSessionId||!activation.messageId){await activation.dispose();throw new Error('The native provider did not retain the reserved child identity and initial message.');}
      return {messageId:activation.messageId};
    }finally{if(this.subagentStarts.get(request.childSessionId)===pending)this.subagentStarts.delete(request.childSessionId);this.subagentSandboxModes.delete(request.childSessionId);}
  }

  async cancelSubagent(childSessionId:string):Promise<void>{
    const owned=this.subagentActivations.get(childSessionId);
    if(owned){await owned.dispose();return;}
    const pending=this.subagentStarts.get(childSessionId);
    if(pending){pending.controller.abort(new Error('Workflow native subagent startup was cancelled.'));await pending.flight.then(activation=>activation.dispose(),()=>{});return;}
    // After a runtime replacement, interrupt only an already-live child under
    // its exact live coordinator. Cancellation never cold-resumes a Session.
    const subagents=this.ctx.get('subagents') as SubagentRuntime|undefined;
    const child=this.ctx.agents.get(SessionId(childSessionId));
    const parentId=child?.session.header.parentSession;
    const parent=parentId?this.ctx.agents.get(parentId):undefined;
    if(!subagents||!child||child.session.header.origin!=='subagent'||!parent)throw new Error('No live native subagent activation and coordinator are available to cancel; no Session was resumed.');
    subagents.interrupt(child.id,{kind:'ancestor',agent:parent});
    await child.whenIdle();
  }

  async disposeSubagents():Promise<void>{
    this.subagentsStopping=true;
    const starts=[...this.subagentStarts.values()];
    for(const pending of starts)pending.controller.abort(new Error('Workflow native subagents are stopping.'));
    const outcomes=await Promise.allSettled([...this.subagentActivations.values()].map(activation=>activation.dispose()).concat(starts.map(pending=>pending.flight.then(activation=>activation.dispose(),()=>{}))));
    this.subagentActivations.clear();
    this.subagentSandboxModes.clear();
    const errors=outcomes.flatMap(result=>result.status==='rejected'?[result.reason]:[]);
    if(errors.length)throw new AggregateError(errors,'Native Workflow subagents could not all be released.');
  }

  async resolveUploadedFile(sessionId:string,receiptId:string):Promise<NativeFileReference>{
    const resolved=await this.ctx.sessionController.resolveAgent(SessionId(sessionId));
    if('error' in resolved)throw resolved.error;
    const file=this.ctx.fileUploads.resolve(resolved.agent,receiptId as FileUploadReceiptId);
    if(!file)throw new Error('File was not uploaded for this Session, or its upload receipt has expired. Upload the file again.');
    return {attachmentId:String(file.attachmentId),name:file.name,bytes:file.bytes};
  }

  async submit(request: { sessionId: string; requestId: string; text: string; clientTimeZone?: string; planning?: boolean; files?:readonly NativeFileReference[]; model?:WorkflowModelIdentity }): Promise<void> {
    if (!request.text.trim() || !request.requestId) throw new Error('Execution needs a nonempty prompt and persisted request ID');
    let selectedAgent:Agent|undefined;
    if(request.model){
      const resolved=await this.ctx.sessionController.resolveAgent(SessionId(request.sessionId));if('error' in resolved)throw resolved.error;selectedAgent=resolved.agent;
      const owns=(message:{source:unknown})=>{const source=record(message.source);return source.kind==='user'&&source.rpcId===request.requestId;};
      if(selectedAgent.session.snapshotEvents().some(event=>event.type==='user/message'&&owns(event.data))||[...selectedAgent.inbox.nextStep,...selectedAgent.inbox.nextTurn].some(owns))return;
      if(selectedAgent.status==='running')throw new Error('Wait for the current native execution to finish before selecting the next task model.');
    }
    if (request.planning) {
      this.protectPlanning(request.sessionId,request.files??[]);
      const resolved = await this.ctx.sessionController.resolveAgent(SessionId(request.sessionId));
      if ('error' in resolved) throw resolved.error;
      this.protectPlanningAgent(resolved.agent);
    }
    const content:PromptContentPart[]=[{type:'text',text:request.text}];
    // Receipts belong to one exact live native Session and expire after prompt
    // observation or disposal. Re-stage durable objects for this branch rather
    // than carrying an upload Session's authority across a fork or restart.
    for(const file of request.files??[]){
      const ref:FileAttachmentRef={...file,attachmentId:file.attachmentId as FileAttachmentRef['attachmentId']};
      const uploaded=await this.ctx.fileUploads.uploadStream({sessionId:SessionId(request.sessionId),name:ref.name,data:this.ctx.attachments.readFileStream(ref)});
      if(uploaded.file.attachmentId!==ref.attachmentId||uploaded.file.bytes!==ref.bytes||uploaded.file.name!==ref.name)throw new Error('Native attachment changed while preparing this execution.');
      content.push({type:'file',receiptId:uploaded.receiptId});
    }
    if(request.model){
      const chosen=await this.resolveModel(request.model);
      this.selectAgentModel(selectedAgent!,chosen,request.requestId);
    }
    // Admission starts only after every streamed object passed native digest
    // and length verification. Missing/corrupt files never produce a prompt.
    try{
      await this.ctx.sessionController.prompt({ sessionId: SessionId(request.sessionId), requestId: request.requestId as SessionRequestId,
        mode: 'queue', content,
        ...(request.clientTimeZone ? { clientTimeZone: request.clientTimeZone } : {}) }, new AbortController().signal);
    }catch(error){const selection=selectedAgent&&this.selectedModels.get(selectedAgent);if(selection?.requestId===request.requestId){selection.current=undefined;selection.assembled=undefined;selection.owningTurn=undefined;}throw error;}
  }
  async cancel(sessionId: string, requestId?: string): Promise<'queued' | 'active' | 'none'> {
    const id = SessionId(sessionId);
    const agent = this.ctx.agents.get(id);
    if (!agent) return 'none';
    if (!requestId) { this.ctx.sessionController.cancel({ sessionId: id }); return 'active'; }
    const queued = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].filter(message =>
      message.source.kind === 'user' && 'rpcId' in message.source && message.source.rpcId === requestId);
    let removed = false;
    for (const message of queued) {
      try {
        await this.ctx.sessionController.updateQueue({ sessionId: id, itemId: message.id, action: { kind: 'remove' } });
        removed = true;
      } catch (error) {
        // A queued occurrence can be claimed between lookup and removal. The
        // exact live open-turn check below handles only that request's turn.
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'session/queue-item-not-found') throw error;
      }
    }
    const events = agent.session.snapshotEvents();
    const start = events.findLastIndex(event => event.type === 'turn/start');
    if (start < 0 || events.slice(start).some(event => event.type === 'turn/end')) return removed ? 'queued' : 'none';
    const ownsOpenTurn = events.slice(start).some(event => event.type === 'user/message' &&
      event.data.source.kind === 'user' && 'rpcId' in event.data.source && event.data.source.rpcId === requestId);
    if (ownsOpenTurn) { this.ctx.sessionController.cancel({ sessionId: id }); return 'active'; }
    return removed ? 'queued' : 'none';
  }
  async flush(sessionId: string): Promise<void> {
    const session = this.ctx.sessions.get(SessionId(sessionId));
    if (session && !(await this.ctx.sessions.flush(session))) throw new Error('Session has no native durability listener');
  }
  subscribe(listener: (sessionId: string, event: NativeEvent) => void): () => void {
    const dispose = this.ctx.on('session/event', (session, event) => listener(session.id, event as unknown as NativeEvent));
    this.questionListeners.add(listener);
    return () => { this.questionListeners.delete(listener);void dispose(); };
  }
  isRunning(sessionId: string): boolean { const agent=this.ctx.agents.get(SessionId(sessionId));return !!agent&&(agent.status==='running'||agent.inbox.nextStep.length>0||agent.inbox.nextTurn.length>0); }
  async waitForIdle(sessionId: string): Promise<void> { await this.ctx.agents.get(SessionId(sessionId))?.whenIdle(); }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function normalizeQuestionItems(value:unknown):WorkflowQuestionItem[]|undefined{
  if(!Array.isArray(value)||!value.length)return;
  const result:WorkflowQuestionItem[]=[];
  for(const item of value){
    const row=record(item);if(typeof row.id!=='string'||typeof row.question!=='string')return;
    const options=Array.isArray(row.options)?row.options.map(value=>record(value)):undefined;
    if(options?.some(option=>typeof option.label!=='string'||option.description!==undefined&&typeof option.description!=='string'))return;
    result.push({id:row.id,question:row.question,...typeof row.detail==='string'?{detail:row.detail}:{},...typeof row.header==='string'?{header:row.header}:{},...(options?{options:options.map(option=>({label:option.label as string,...typeof option.description==='string'?{description:option.description}:{}}))}:{}),...(typeof row.multiSelect==='boolean'?{multiSelect:row.multiSelect}:typeof row.multi_select==='boolean'?{multiSelect:row.multi_select}:{})});
  }
  return new Set(result.map(item=>item.id)).size===result.length?result:undefined;
}
