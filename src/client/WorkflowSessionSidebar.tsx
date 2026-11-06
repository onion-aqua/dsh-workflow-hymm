import {useEffect,useMemo,useRef,useState} from 'react';
import type {InjectFace,PropsRuntime} from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {SessionId} from '@deepseek-ai/dsh-session/types';
import type {WorkflowClient} from './data.ts';
import type {Workflow} from '../shared/model.ts';
import type {Translate} from './locales.ts';
import {deriveWorkflowSessionGroups,type WorkflowSessionEntry} from './workflow-session-groups.ts';
import {ContextMenu,type ContextAction} from './ContextMenu.tsx';
import {Icon} from './icons.tsx';
import './workflow-session-sidebar.css';

export interface WorkflowSidebarBindings {
  hooks:{workflow:WorkflowClient};
  onOpenSession:(id:string)=>void;
  onOpenWorkflow:(id:string)=>void;
  onUseNativeDirectory:()=>void;
  onPinSession:(id:string,pinned:boolean)=>Promise<void>;
  onArchiveSession:(id:string,archived:boolean)=>Promise<void>;
}
export type WorkflowSessionSidebarProps=PropsRuntime<'sidebar.workspaces'>&InjectFace<WorkflowSidebarBindings>&{t:Translate};
interface DisplayRow {id:string;title:string;entry?:WorkflowSessionEntry}
interface DisplayGroup {key:string;title:string;workflowId?:string;path?:string;rows:DisplayRow[]}
const expansionKey='dsh-visual-workflow.session-groups.v1';
function readExpansion():Record<string,boolean>{try{const value=JSON.parse(localStorage.getItem(expansionKey)??'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
function entryTitle(workflow:Workflow,entry:WorkflowSessionEntry,nativeTitle:string,t:Translate):string{
  if(entry.kind==='planning')return `${t('sidebarPlanning')} · ${workflow.plans?.find(plan=>plan.id===entry.planId)?.goal.trim().split('\n')[0]||nativeTitle}`;
  const task=workflow.nodes.find(node=>node.id===entry.nodeId);
  const taskTitle=task?`${entry.displayId?`#${entry.displayId} `:''}${task.title}`:nativeTitle;
  return entry.kind==='branch'?`${entry.branchLabel||t('sidebarBranch')} · ${taskTitle}`:taskTitle;
}

/** A visual Session directory. No virtual Workspace is submitted to native APIs. */
export function WorkflowSessionSidebar(props:WorkflowSessionSidebarProps){
  const {t}=props,graphs=props.useWorkflow(state=>state),list=props.useSessions(state=>state),native=props.useWorkspaces(state=>state);
  const statuses=props.useSessionStatus(state=>state),panel=props.usePanelInfo(state=>state.activePanelId);
  const [search,setSearch]=useState(''),[showArchived,setShowArchived]=useState(false),[expanded,setExpanded]=useState(readExpansion);
  const [menu,setMenu]=useState<{id:string;x:number;y:number}>(),[busy,setBusy]=useState<string>(),[error,setError]=useState('');
  const container=useRef<HTMLElement>(null),searchInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    const isEditable=(target:EventTarget|null)=>{const element=target as Element|null;return !!element?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]');};
    const shortcut=(event:KeyboardEvent)=>{
      if(event.isComposing||event.altKey||event.shiftKey||(!event.ctrlKey&&!event.metaKey)||isEditable(event.target))return;
      const key=event.key.toLocaleLowerCase();
      if(key==='k'){
        event.preventDefault();event.stopPropagation();setSearch('');searchInput.current?.focus({preventScroll:true});
      }else if(key==='o'){
        event.preventDefault();event.stopPropagation();props.onUseNativeDirectory();
      }
    };
    document.addEventListener('keydown',shortcut,true);return()=>document.removeEventListener('keydown',shortcut,true);
  },[props.onUseNativeDirectory]);
  const archived=new Set<string>(native.archivedSessionIds),pinned=new Set<string>(native.pinnedSessionIds);
  const current=Object.values(list.byId).find(session=>(session.retainedBy.mainView??0)>0)?.id;
  const groups=useMemo(()=>{
    // Hide only internal contexts with an explicit plugin-owned identity.
    const internal=new Set<string>();
    for(const workflow of graphs.workflows){
      if(workflow.uploadSessionId)internal.add(workflow.uploadSessionId);
      for(const run of workflow.executions??[])if(run.subagent)internal.add(run.subagent.parentSessionId);
    }
    const ids=list.ids.filter(id=>{const row=list.byId[id];return row&&row.origin!=='subagent'&&!internal.has(id)&&(!row.blank||id===current)&&(!archived.has(id)||showArchived);})
      .sort((a,b)=>Number(pinned.has(b))-Number(pinned.has(a))||list.byId[b]!.updatedAt-list.byId[a]!.updatedAt||a.localeCompare(b));
    const projection=deriveWorkflowSessionGroups(graphs.workflows,ids);
    const title=(id:string)=>list.byId[id as SessionId]?.blank?t('sidebarNewSession'):list.byId[id as SessionId]?.title||t('sidebarUntitled');
    const result:DisplayGroup[]=projection.groups.map(group=>({key:`workflow:${group.workflowId}`,title:group.title,workflowId:group.workflowId,rows:group.sessions.map(entry=>({id:entry.sessionId,entry,title:entryTitle(graphs.workflows.find(item=>item.id===group.workflowId)!,entry,title(entry.sessionId),t)}))}));
    const remaining=new Set(projection.ungroupedSessionIds);
    for(const workspace of native.items){
      const members=new Set<string>(workspace.sessionIds),rows=ids.filter(id=>remaining.has(id)&&members.has(id)).map(id=>({id,title:title(id)}));
      rows.forEach(row=>remaining.delete(row.id));
      if(rows.length||!showArchived)result.push({key:`workspace:${workspace.workspaceId}`,title:workspace.title==='default-workspace'?t('sidebarDefaultWorkspace'):workspace.title,path:workspace.path,rows});
    }
    if(remaining.size)result.push({key:'other',title:t('sidebarOtherConversations'),rows:ids.filter(id=>remaining.has(id)).map(id=>({id,title:title(id)}))});
    return result;
  },[graphs.workflows,list,native,showArchived,current,t]);
  const query=search.trim().toLocaleLowerCase();
  const visible=groups.map(group=>({...group,rows:query&&!group.title.toLocaleLowerCase().includes(query)?group.rows.filter(row=>`${row.title} ${list.byId[row.id as SessionId]?.title??''}`.toLocaleLowerCase().includes(query)):group.rows})).filter(group=>!query||group.rows.length);
  const toggle=(key:string)=>setExpanded(previous=>{const next={...previous,[key]:previous[key]===false};try{localStorage.setItem(expansionKey,JSON.stringify(next));}catch{}return next;});
  const action=async(id:string,run:()=>void|Promise<void>)=>{if(busy)return;setBusy(id);setError('');try{await run();}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(undefined);}};
  const showMenu=(id:string,x:number,y:number)=>{const bounds=container.current?.getBoundingClientRect();if(bounds)setMenu({id,x:x-bounds.left,y:y-bounds.top});};
  const menuActions:ContextAction[]=menu?[
    {id:'sidebar-open',label:t('openConversation'),icon:'chat',disabled:archived.has(menu.id),onSelect:()=>props.onOpenSession(menu.id)},
    {id:'sidebar-pin',label:t(pinned.has(menu.id)?'sidebarUnpin':'sidebarPin'),icon:pinned.has(menu.id)?'unpin':'pin',disabled:!!busy||archived.has(menu.id),onSelect:()=>{void action(menu.id,()=>props.onPinSession(menu.id,!pinned.has(menu.id)));}},
    {id:'sidebar-copy-id',label:t('sidebarCopyId'),icon:'copy',onSelect:()=>{void action(menu.id,()=>navigator.clipboard.writeText(menu.id));}},
    {id:'sidebar-archive',label:t(archived.has(menu.id)?'sidebarRestore':'sidebarArchive'),icon:'list',disabled:!!busy,onSelect:()=>{void action(menu.id,()=>props.onArchiveSession(menu.id,!archived.has(menu.id)));}},
    {id:'sidebar-native',label:t('sidebarNativeDirectory'),icon:'panel',separatorBefore:true,onSelect:()=>props.onUseNativeDirectory()},
  ]:[];
  if(!props.wide)return <button className="wf-directory-rail" title={t('sidebarWorkflowDirectory')} aria-label={t('sidebarWorkflowDirectory')} onClick={props.expandSidebar}><Icon name="list" size={19}/></button>;
  const loading=graphs.loading||list.phase!=='ready'||native.phase!=='ready';
  return <section className="wf-session-directory" ref={container} data-testid="workflow-session-directory" aria-label={t('sidebarWorkflowDirectory')}>
    <header><span>{t('sidebarWorkflowDirectory')}</span><button title={t('sidebarNativeDirectory')} aria-label={t('sidebarNativeDirectory')} data-testid="sidebar-native-directory" onClick={props.onUseNativeDirectory}><Icon name="panel" size={15}/></button></header>
    <div className="wf-directory-search"><Icon name="search" size={14}/><input ref={searchInput} value={search} onChange={event=>setSearch(event.target.value)} placeholder={t('sidebarSearch')} aria-label={t('sidebarSearch')} data-testid="sidebar-workflow-search" onKeyDown={event=>{if(event.key==='Escape')setSearch('');}}/><button className={showArchived?'is-active':''} title={t('sidebarShowArchived')} aria-label={t('sidebarShowArchived')} aria-pressed={showArchived} onClick={()=>setShowArchived(value=>!value)}><Icon name="list" size={14}/></button></div>
    {(error||native.error||graphs.error)&&<p className="wf-directory-error" role="alert">{error||native.error?.message||graphs.error}</p>}
    <div className="wf-directory-groups" data-testid="workflow-session-groups">
      {loading?<p className="wf-directory-empty" role="status">{t('loading')}</p>:visible.length===0?<p className="wf-directory-empty">{t('sidebarNoConversations')}</p>:visible.map(group=>{
        const isExpanded=!!query||expanded[group.key]!==false;
        return <div key={group.key} className="wf-directory-group" data-group-key={group.key} data-testid={`sidebar-group-${group.key}`}>
          <div className="wf-directory-group-heading"><button className="wf-directory-group-toggle" aria-expanded={isExpanded} title={group.path??group.title} onClick={()=>toggle(group.key)}><Icon name="chevron" size={12} style={{transform:isExpanded?'rotate(0deg)':'rotate(-90deg)'}}/><Icon name={group.workflowId?'workflow':'list'} size={15}/><span>{group.title}</span><small>{group.rows.length}</small></button>{group.workflowId&&<button title={t('sidebarOpenCanvas')} aria-label={`${t('sidebarOpenCanvas')} ${group.title}`} data-testid={`sidebar-canvas-${group.workflowId}`} onClick={()=>props.onOpenWorkflow(group.workflowId!)}><Icon name="arrow" size={13}/></button>}</div>
          {isExpanded&&<div className="wf-directory-rows">{group.rows.map(row=>{
            const state=statuses.get(row.id as SessionId),active=panel===null&&current===row.id,isArchived=archived.has(row.id);
            const waiting=!!state?.pendingInteraction,running=state?.running??list.byId[row.id as SessionId]?.running,unread=state?.completionUnread;
            const statusLabel=waiting?t('sidebarWaiting'):running?t('running'):unread?t('sidebarUnread'):'';
            return <div key={row.id} className={`wf-directory-row ${active?'is-current':''} ${isArchived?'is-archived':''}`} data-testid={`sidebar-session-${row.id}`} onContextMenu={event=>{event.preventDefault();showMenu(row.id,event.clientX,event.clientY);}}>
              <button className="wf-directory-session-open" disabled={isArchived} aria-current={active?'page':undefined} title={`${row.title}${statusLabel?` · ${statusLabel}`:''}`} onClick={()=>props.onOpenSession(row.id)} onKeyDown={event=>{if((event.shiftKey&&event.key==='F10')||event.key==='ContextMenu'){event.preventDefault();const bounds=event.currentTarget.getBoundingClientRect();showMenu(row.id,bounds.left,bounds.bottom);}}}>
                <span className={`wf-directory-status ${waiting?'is-waiting':running?'is-running':unread?'is-unread':''}`} title={statusLabel||undefined} aria-label={statusLabel||undefined}>{!statusLabel&&(pinned.has(row.id)?<Icon name="pin" size={12}/>:<Icon name={row.entry?.kind==='planning'?'sparkles':row.entry?.kind==='branch'?'branch':'chat'} size={13}/>)}</span><span className="wf-directory-session-title">{row.title}</span>
              </button><button className="wf-directory-row-menu" title={t('sidebarSessionActions')} aria-label={`${t('sidebarSessionActions')} ${row.title}`} onClick={event=>{const bounds=event.currentTarget.getBoundingClientRect();showMenu(row.id,bounds.left,bounds.bottom);}}><Icon name="more" size={14}/></button>
            </div>;
          })}</div>}
        </div>;
      })}
    </div>
    {menu&&container.current&&<ContextMenu container={container.current} x={menu.x} y={menu.y} actions={menuActions} onClose={()=>setMenu(undefined)}/>}
  </section>;
}
