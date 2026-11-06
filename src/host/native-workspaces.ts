import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace';
import type { SessionTitleService } from '@deepseek-ai/dsh-session-title';
import type { WorkflowWorkspaceOption } from '../shared/model.ts';
import { realpath } from 'node:fs/promises';

/** Workspace membership is a canonical directory fact, never a fake canvas group. */
export class NativeWorkspaces {
  private readonly pendingTitles=new Map<string,string>();
  private readonly dirtyTitles=new Set<string>();
  constructor(private readonly ctx:Context){
    ctx.on('agent/created',({agent})=>{
      const title=this.pendingTitles.get(agent.id);if(!title)return;
      void this.rename(agent.id,title).catch(error=>ctx.logger.warn('Deferred Workflow Session title could not be written',error));
    });
    ctx.effect(()=>()=>{this.pendingTitles.clear();this.dirtyTitles.clear();},'visual-workflow.deferred-titles');
  }
  list():WorkflowWorkspaceOption[]{
    const registry=this.ctx.get('workspaceRegistry') as WorkspaceRegistry|undefined;
    return registry?.list().map(workspace=>({id:workspace.id,title:workspace.title,path:workspace.path}))??[];
  }
  async attach(sessionId:string,workspaceId?:string):Promise<void>{
    const registry=this.ctx.get('workspaceRegistry') as WorkspaceRegistry|undefined;if(!registry)return;
    const cwd=(await this.ctx.sessionQuery.readSession(SessionId(sessionId))).session.cwd;
    const path=cwd?await realpath(cwd):undefined;
    const workspace=registry.list().find(item=>workspaceId?item.id===workspaceId:item.sessionIds.includes(SessionId(sessionId))||path&&item.path.toLowerCase()===path.toLowerCase());
    if(workspace)await workspace.attachSession(SessionId(sessionId));
  }
  async rename(sessionId:string,title:string):Promise<boolean>{
    const titles=this.ctx.get('sessionTitle') as SessionTitleService|undefined;if(!titles){this.pendingTitles.set(sessionId,title);return false;}
    const session=this.ctx.sessions.get(SessionId(sessionId));
    if(!session){this.pendingTitles.set(sessionId,title);return false;}
    if(session.snapshotEvents().findLast(event=>event.type==='session/title')?.data.title===title){
      if(this.dirtyTitles.has(sessionId)){if(!await this.ctx.sessions.flush(session))throw new Error('Native Session title has no durability listener');this.dirtyTitles.delete(sessionId);}
      this.pendingTitles.delete(sessionId);return true;
    }
    // Public title service accepts the exact native Session, including owned
    // children. It appends metadata only and never drives another Agent prompt.
    titles.rename(session,title);
    this.dirtyTitles.add(sessionId);
    if(!await this.ctx.sessions.flush(session))throw new Error('Native Session title has no durability listener');
    this.dirtyTitles.delete(sessionId);this.pendingTitles.delete(sessionId);return true;
  }
}
