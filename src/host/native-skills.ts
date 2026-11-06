import type {Context} from '@deepseek-ai/cordis';
import {SessionId} from '@deepseek-ai/dsh-session';
import {isUserInvocable} from '@deepseek-ai/dsh-skill';
import type {SkillRegistry,SkillViewOptions} from '@deepseek-ai/dsh-skill';
import type {AgentPresetRegistry} from '@deepseek-ai/dsh-agent-preset-registry';
import type {} from '@deepseek-ai/dsh-working-directory';

/** Catalog metadata only. The native pre-step skill injector owns loading and activation. */
export interface WorkflowSkillOption {name:string;description?:string;source?:string}
export interface NativeSkillCatalogRequest {sessionId?:string;cwd?:string;signal?:AbortSignal}

/** Read native skills without restoring an Agent or repairing a source Session's directory. */
export class NativeSkillCatalog {
  constructor(private readonly ctx:Context){}
  async list(request:NativeSkillCatalogRequest={}):Promise<WorkflowSkillOption[]> {
    const {signal}=request;signal?.throwIfAborted();
    let cwd=request.cwd,scope:SkillViewOptions['scope'];
    let registry=this.ctx.get('skills') as SkillRegistry|undefined;
    const presets=this.ctx.get('agentPresets') as AgentPresetRegistry|undefined;
    let presetId:string|undefined;
    if(request.sessionId){
      // observeSession retains an immutable native observation. No resolveAgent,
      // workingDirectory.ensure, prompt or log append is involved in discovery.
      using observation=await this.ctx.sessionQuery.observeSession(SessionId(request.sessionId),signal?{signal}:undefined);
      signal?.throwIfAborted();
      const values=observation.projections?.values;
      cwd=values?.workingDirectory??observation.header.cwd;
      presetId=values?.agentPreset??undefined;
      const live=this.ctx.get('agents')?.get(SessionId(request.sessionId));
      if(live){scope=live;registry=presets?.serviceFor(live,'skills')??registry;}
    }
    // A standing preset lease exposes its actual registered skill layer while
    // keeping cold Sessions cold. Always release it, including failed reads.
    await using lease=!scope&&presets&&request.sessionId?await presets.acquireScope(presetId):undefined;
    scope??=lease?.key;
    if(!registry)throw new Error('The native skill registry is unavailable in this DSH composition.');
    const skills=await registry.list({...(cwd?{cwd}:{}),...(scope?{scope}:{}),...(signal?{signal}:{})});
    signal?.throwIfAborted();
    return skills.filter(isUserInvocable).map(skill=>({name:skill.name,description:skill.description,source:skill.source}));
  }
}
