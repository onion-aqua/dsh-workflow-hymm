import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-commands';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry';
import { ManualCompactionError, type CompactionEngine } from '@deepseek-ai/dsh-compaction';
import type { WorkflowModelIdentity } from '../shared/model.ts';

export interface NativeContextSnapshot {
  sessionId:string;usedTokens?:number;capacityTokens?:number;
  source:'projected'|'pressure'|'unavailable';autoAvailable?:boolean;manualAvailable:boolean;capabilitiesKnown?:boolean;
  compacting:boolean;lastCompactedAt?:number;summaryModel?:WorkflowModelIdentity;configurationIssue?:string;error?:string;
}
export interface NativeCompactResult {changed:boolean;beforeTokens?:number;afterTokens?:number;compactionId?:string}
export class NativeContextError extends Error {
  readonly outcomeKnown=true;
  constructor(message:string,options?:ErrorOptions){super(message,options);this.name='NativeContextError';}
}
interface Meter {measure(session:Agent['session']):{totalTokens:number}}
interface NativeCompactionConfig {auto?:boolean;headroomTokens?:number;summarizationProvider?:string;summarizationModel?:string;modelPolicies?:Array<{provider:string;model:string;headroomTokens?:number;summarizationProvider?:string;summarizationModel?:string}>}
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const positive=(value:unknown):number|undefined=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0?value:undefined;
const nonnegative=(value:unknown):number|undefined=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:undefined;

/** Native read models and explicit maintenance. Statistics never resolve an Agent. */
export class NativeContextControls {
  private readonly pending=new Set<string>();
  constructor(private readonly ctx:Context){}
  private engine(agent?:Agent):CompactionEngine|undefined{
    const presets=this.ctx.get('agentPresets') as AgentPresetRegistry|undefined;
    return agent?presets?.serviceFor(agent,'compaction')??agent.ctx.get('compaction')??this.ctx.get('compaction'):this.ctx.get('compaction');
  }
  private measure(agent:Agent):number|undefined{return nonnegative((this.ctx.get('tokenMeter') as Meter|undefined)?.measure(agent.session).totalTokens);}
  async inspect(sessionId:string):Promise<NativeContextSnapshot>{
    const observation=await this.ctx.sessionQuery.observeSession(SessionId(sessionId),{projectionMode:'all'});
    try{
      const agent=this.ctx.get('agents')?.get(SessionId(sessionId));
      const values=record(observation.projections?.values),pressure=record(values.contextPressure),engine=this.engine(agent),config=record(engine).config as NativeCompactionConfig|undefined;
      // Preset backends are scoped to a real Agent. A cold Session remains cold:
      // projections supply occupancy, while backend availability stays unknown.
      const capabilitiesKnown=!!agent||!!engine;
      const projected=nonnegative(pressure.projectedTokens),reported=nonnegative(pressure.pressureTokens),capacityTokens=positive(pressure.contextWindow);
      const events=observation.events;let compacting=this.pending.has(sessionId),lastCompactedAt:number|undefined;
      const open=new Set<string>();
      for(const event of events){if(event.type==='session/end-seed')open.clear();else if(event.type==='compaction/start')open.add(event.data.compactionId);else if(event.type==='compaction/end'){open.delete(event.data.compactionId);if(!event.data.error)lastCompactedAt=event.time;}}
      compacting||=open.size>0;
      const header=events.findLast(event=>event.type==='request/header'),call=record(record(header?.data).header),route=record(call.config);
      const policy=config?.modelPolicies?.find(item=>item.provider===route.provider&&item.model===route.model),headroom=policy?.headroomTokens??config?.headroomTokens??65536,reserved=nonnegative(route.maxTokens)??0;
      const invalidBudget=!!engine&&capacityTokens!==undefined&&capacityTokens-reserved-headroom<=0;
      const provider=policy?.summarizationProvider??config?.summarizationProvider,summary=policy?.summarizationModel??config?.summarizationModel;
      const summaryModel=!engine?undefined:provider&&summary?{provider,model:summary}:typeof route.provider==='string'&&typeof route.model==='string'?{provider:route.provider,model:route.model}:agent?.options.provider&&agent.options.model?{provider:agent.options.provider,model:agent.options.model}:undefined;
      let usedTokens=projected??reported,source:NativeContextSnapshot['source']=projected!==undefined?'projected':reported!==undefined?'pressure':'unavailable';
      // A route-aware native meter estimate can still describe a live Session
      // before the provider has emitted its first usage sample.
      if(usedTokens===undefined&&agent){usedTokens=this.measure(agent);if(usedTokens!==undefined)source='projected';}
      const manualAvailable=(!capabilitiesKnown||!!engine)&&observation.header.origin!=='subagent'&&(!agent||this.ctx.agents.roots().includes(agent)&&agent.status==='idle'&&!agent.inbox.nextStep.length&&!agent.inbox.nextTurn.length)&&!compacting;
      return {sessionId,...usedTokens===undefined?{}:{usedTokens},...capacityTokens===undefined?{}:{capacityTokens},source,capabilitiesKnown,...capabilitiesKnown?{autoAvailable:!!engine&&config?.auto!==false&&!invalidBudget}:{},manualAvailable,compacting,...lastCompactedAt===undefined?{}:{lastCompactedAt},...summaryModel?{summaryModel}:{},...invalidBudget?{configurationIssue:`The native ${capacityTokens}-token context leaves no compaction pressure budget after reserving ${reserved} output tokens and ${headroom} compaction headroom tokens.`}:{}};
    }finally{observation[Symbol.dispose]();}
  }
  async compact(sessionId:string):Promise<NativeCompactResult>{
    if(this.pending.has(sessionId))throw new Error('Native compaction is already running for this Session.');
    this.pending.add(sessionId);
    try{
      const resolved=await this.ctx.sessionController.resolveAgent(SessionId(sessionId));if('error' in resolved)throw resolved.error;const agent=resolved.agent;
      const preflightFailure=async(message:string):Promise<never>=>{
        // No summary was attempted. Only a successful native durability check
        // makes this rejection a known, retryable outcome for the operation.
        if(!await this.ctx.sessions.flush(agent.session))throw new Error('Native compaction has no durability listener.');
        throw new NativeContextError(message);
      };
      const engine=this.engine(agent);if(!engine)return preflightFailure('Native conversation compaction is unavailable in this Agent preset.');
      if(!this.ctx.agents.roots().includes(agent))return preflightFailure('An owned native child cannot be compacted through ordinary Session controls.');
      if(agent.status!=='idle'||agent.inbox.nextStep.length||agent.inbox.nextTurn.length)return preflightFailure('Wait for the native Session and its queued work before compacting.');
      const beforeTokens=this.measure(agent),beforeSeq=agent.session.seq,signal=new AbortController().signal;
      const presets=this.ctx.get('agentPresets') as AgentPresetRegistry|undefined;
      const commands=presets?.serviceFor(agent,'commands')??agent.ctx.get('commands')??this.ctx.get('commands');
      const failed=async(message:string,cause?:unknown):Promise<never>=>{
        // A command's explicit error is useful only after native durability
        // succeeds. A partially committed summary remains an uncertain result.
        if(!await this.ctx.sessions.flush(agent.session))throw new Error('Native compaction has no durability listener.');
        const suffix=agent.session.ownEvents().filter(event=>event.seq>=beforeSeq),starts=suffix.filter(event=>event.type==='compaction/start'),ends=suffix.filter(event=>event.type==='compaction/end');
        if(!suffix.some(event=>event.type==='compaction/summary')&&(!starts.length||starts.every(start=>ends.some(end=>end.type==='compaction/end'&&start.type==='compaction/start'&&end.data.compactionId===start.data.compactionId&&typeof end.data.error==='string'))))throw new NativeContextError(message,{cause});
        throw new Error(message,{cause});
      };
      if(commands?.find(agent,'compact')){
        const execution=await commands.execute(agent,'/compact',[],signal);
        if(!execution)throw new Error('The native compact command did not return an outcome.');
        if(execution.result.kind!=='success')return failed(execution.result.text??'The native compact command did not complete.');
      }else {
        try{await engine.compactNow(agent,signal);}catch(error){if(error instanceof ManualCompactionError&&error.code!=='persistence'&&error.code!=='commit')return failed(error.message,error);throw error;}
      }
      if(!await this.ctx.sessions.flush(agent.session))throw new Error('Native compaction has no durability listener.');
      const afterTokens=this.measure(agent),result=agent.session.ownEvents().findLast(event=>event.seq>=beforeSeq&&event.type==='compaction/summary');
      return {changed:!!result,...beforeTokens===undefined?{}:{beforeTokens},...afterTokens===undefined?{}:{afterTokens},...result?.type==='compaction/summary'?{compactionId:String(result.data.compactionId)}:{}};
    }finally{this.pending.delete(sessionId);}
  }
}
