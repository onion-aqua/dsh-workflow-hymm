/** Released rc.3 permission bundles and live tool approvals. No core settings are replaced. */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { ApprovalOutcome, ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types';
import type { WorkflowAccessCatalog, WorkflowAccessMode, WorkflowApprovalDecision, WorkflowPendingApproval } from '../shared/model.ts';

type NativeApproval=Omit<WorkflowPendingApproval,'workflowId'|'runId'|'nodeId'>;
interface PermissionService {
  catalog():{options:Array<{value:string;name:string;description?:string}>;defaultPreset:string};
  resolve(name:string):{sandbox:'read-only'|'workspace-write'|'danger-full-access';approval:'ask'|'never'};
  set(session:Session,name:string):void;
}
interface ApprovalWait {agent:Agent;approval:NativeApproval;signal?:AbortSignal;resolve:(outcome:ApprovalOutcome)=>void;release:()=>void}
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

/** Optional controls: an absent permission/approval provider never disables ordinary Workflow execution. */
export class NativeControls {
  private owner?: (sessionId:string,callId:string|undefined,approvalId:string)=>Promise<boolean>;
  private readonly waits=new Map<string,ApprovalWait>();
  private readonly listeners=new Set<(sessionId:string)=>void>();
  private readonly stop:()=>unknown;
  private stopped=false;
  constructor(private readonly ctx:Context){
    this.stop=ctx.on('approval/request',async(request,next)=>{
      if(this.stopped||!this.owner)return next();
      const approval=this.unsettled(request.agent.session.ownEvents()).filter(item=>item.data.toolName===request.toolName&&item.data.callId===request.callId);
      if(approval.length!==1)return next();
      const event=approval[0]!,approvalId=String(event.data.id),sessionId=request.agent.id;
      if(!await this.owner(sessionId,request.callId,approvalId))return next();
      // The ownership read can outlive plugin teardown. Never register a new
      // resolver after dispose has drained its existing waits.
      if(this.stopped)return next();
      if(request.signal?.aborted)return 'cancelled';
      if(this.ctx.get('agents')?.get(request.agent.id)!==request.agent)return next();
      const key=this.key(sessionId,approvalId);if(this.waits.has(key))return next();
      return new Promise<ApprovalOutcome>(resolve=>{
        const abort=()=>{wait.release();resolve('cancelled');};
        const wait:ApprovalWait={agent:request.agent,approval:this.present(sessionId,event,request.agent.session.ownEvents(),true,request),signal:request.signal,resolve,release:()=>{request.signal?.removeEventListener('abort',abort);if(this.waits.get(key)===wait)this.waits.delete(key);this.notify(sessionId);}};
        this.waits.set(key,wait);request.signal?.addEventListener('abort',abort,{once:true});this.notify(sessionId);if(request.signal?.aborted)abort();
      });
    },{prepend:true});
  }
  available():boolean{return !!this.ctx.get('permissionPresets');}
  setApprovalOwner(owns:(sessionId:string,callId:string|undefined,approvalId:string)=>Promise<boolean>):void{this.owner=owns;}
  subscribe(listener:(sessionId:string)=>void):()=>void{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private key(sessionId:string,approvalId:string):string{return `${sessionId}\0${approvalId}`;}
  private notify(sessionId:string):void{for(const listener of this.listeners)try{listener(sessionId);}catch(error){this.ctx.logger.error('Workflow native approval notification failed',error);}}
  async catalogAccessModes():Promise<WorkflowAccessCatalog>{
    const service=this.ctx.get('permissionPresets') as PermissionService|undefined;
    if(!service)return {options:[],defaultPreset:''};
    const catalog=await service.catalog();
    return {options:catalog.options.map(option=>{const {sandbox,approval}=service.resolve(option.value);return {id:option.value,label:option.name,...option.description?{description:option.description}:{},sandbox,approval};}),defaultPreset:catalog.defaultPreset};
  }
  async applyAccessMode(sessionId:string,preset:WorkflowAccessMode):Promise<void>{
    if(this.stopped)throw new Error('Workflow native controls are stopping.');
    const service=this.ctx.get('permissionPresets') as PermissionService|undefined;
    if(!service)throw new Error('Native permission presets are unavailable in this DSH profile.');
    if(!(await this.catalogAccessModes()).options.some(option=>option.id===preset))throw new Error('The selected native permission preset is not currently available.');
    const resolved=await this.ctx.sessionController.resolveAgent(SessionId(sessionId));if('error' in resolved)throw resolved.error;
    // Native setters append Session-local permission facts. The settings
    // service and its defaultPreset for future native chats are not written.
    service.set(resolved.agent.session,preset);
    const session=this.ctx.sessions.get(SessionId(sessionId));
    if(session&&!(await this.ctx.sessions.flush(session)))throw new Error('The native access mode could not be durably stored.');
  }
  private unsettled(events:readonly SessionEvent[]):SessionEvent<'approval/asked'>[]{
    const pending=new Map<string,SessionEvent<'approval/asked'>>();
    for(const event of events){if(event.type==='approval/asked')pending.set(event.data.id,event);else if(event.type==='approval/decided')pending.delete(event.data.id);}
    return [...pending.values()];
  }
  private present(sessionId:string,event:SessionEvent<'approval/asked'>,events:readonly SessionEvent[],actionable:boolean,request?:ApprovalRequestEvent):NativeApproval{
    const call=events.findLast(item=>item.seq<event.seq&&(item.type==='tool/call'&&item.data.callId===event.data.callId||item.type==='tool/ptc-dispatch-start'&&item.data.subCallId===event.data.callId));
    let args:unknown;
    if(call?.type==='tool/call'){try{args=JSON.parse(call.data.arguments);}catch{args=call.data.arguments;}}
    else if(call?.type==='tool/ptc-dispatch-start')args=call.data.arguments;
    const command=object(args).command,input=args===undefined?undefined:typeof args==='string'?args:JSON.stringify(args,null,2);
    return {sessionId,approvalId:event.data.id,...event.data.callId?{callId:event.data.callId}:{},toolName:event.data.toolName,...(request?.reason??event.data.reason)?{reason:request?.reason??event.data.reason}:{},...typeof command==='string'?{command:command.slice(0,24000)}:{},...input!==undefined?{input:input.slice(0,24000)}:{},actionable,createdAt:event.time};
  }
  async approvals(sessionId:string):Promise<NativeApproval[]>{
    if(!this.ctx.get('approval'))return [];
    const observation=await this.ctx.sessionQuery.observeSession(SessionId(sessionId),{projectionMode:'none'});
    try{
      const own=observation.events.filter(event=>event.seq>=observation.inheritedEventCount),agent=this.ctx.get('agents')?.get(SessionId(sessionId));
      return this.unsettled(own).map(event=>{const wait=this.waits.get(this.key(sessionId,event.data.id)),actionable=!!wait&&!wait.signal?.aborted&&wait.agent===agent;return this.present(sessionId,event,own,actionable);});
    }finally{observation[Symbol.dispose]();}
  }
  async answerApproval(sessionId:string,approvalId:string,decision:WorkflowApprovalDecision):Promise<boolean>{
    if(decision!=='allowed-once'&&decision!=='rejected')throw new Error('A native tool approval supports Allow once or Reject.');
    const key=this.key(sessionId,approvalId),wait=this.waits.get(key);if(!wait||!this.owner||this.stopped)return false;
    if(!await this.owner(sessionId,wait.approval.callId,approvalId)||this.waits.get(key)!==wait||wait.signal?.aborted||this.ctx.get('agents')?.get(wait.agent.id)!==wait.agent)return false;
    if(!this.unsettled(wait.agent.session.ownEvents()).some(event=>event.data.id===approvalId))return false;
    wait.release();wait.resolve(decision);return true;
  }
  async dispose():Promise<void>{
    if(this.stopped)return;this.stopped=true;await this.stop();
    for(const wait of [...this.waits.values()]){wait.release();wait.resolve('cancelled');}this.listeners.clear();
  }
}
export default NativeControls;
