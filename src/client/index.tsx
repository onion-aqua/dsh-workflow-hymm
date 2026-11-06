import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-file-upload/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { Translate } from './locales.ts'
import { zh, en } from './locales.ts'
import { TYPERT_REMOTE } from '../../lib/typert.remote-client.js'
import { WorkflowClient } from './data.ts'
import { WorkflowRuntimeClient, type WorkflowRuntimeApi } from './runtime-data.ts'
import { WorkflowPanel } from './WorkflowPanel.tsx'
import { WorkflowSessionSidebar, type WorkflowSidebarBindings } from './WorkflowSessionSidebar.tsx'
import { installWorkflowSidebar } from './workflow-sidebar-registration.ts'
import { createNativeUtilityBridge, openNativeUtilitySurface, type NativeUtilityBridge, type NativeUtilityServices, type UtilitySource } from './native-utility.ts'
import '@xyflow/react/dist/style.css'
import './styles.css'

declare const __WORKFLOW_CSS__: string
const PANEL = 'visual-workflow'
const NS = 'visualWorkflow'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { visualWorkflow: keyof typeof zh }
}
interface Bindings {
  hooks: { workflow: WorkflowClient; runtime: WorkflowRuntimeClient; utility:UtilitySource<{error?:string}> }
  runtime: WorkflowRuntimeClient
  nativeUtilityBridge:NativeUtilityBridge
  original(): void
  canvas(): void
  openSession(sessionId: string): void
  select(id: string): void
  create(): void
  change: WorkflowClient['change']
  rename: WorkflowClient['rename']
  retry(): void
}
type MainProps = InjectFace<Bindings> & { t: Translate }
function WorkflowMain(props: MainProps): React.ReactElement {
  const state = props.useWorkflow(state => state)
  const runtime = props.useRuntime(state => state)
  const utility = props.useUtility(state=>state)
  return <WorkflowPanel {...state} {...props.runtime.presentation()} nativeUtilityBridge={props.nativeUtilityBridge} error={utility.error ?? runtime.error ?? state.error}
    onSelectWorkflow={props.select} onCreateWorkflow={props.create} onOriginalStyle={props.original} onOpenSession={props.openSession}
    onChangeWorkflow={props.change} onRenameWorkflow={props.rename} onRetry={props.retry} t={props.t} />
}
function MainPlaceholder(): React.ReactElement { return <div aria-hidden="true" /> }
function WorkflowOverlay(props: MainProps & GlobalStandardProps): React.ReactElement | null {
  const selected = props.usePanelInfo(state => state.activePanelId)
  if (selected !== PANEL) return <button className="wf-native-return" data-testid="workflow-return" onClick={props.canvas}>画布</button>
  return <div className="wf-fullscreen" data-testid="workflow-fullscreen"><WorkflowMain {...props}/></div>
}
function WorkflowIcon({ size = 20 }: { size: number }): React.ReactElement {
  return <svg data-testid="workflow-nav" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <rect x="2.5" y="3" width="7" height="6" rx="1.5"/><rect x="14.5" y="15" width="7" height="6" rx="1.5"/>
    <path d="M6 9v7a2 2 0 0 0 2 2h6.5M9.5 6H16a2 2 0 0 1 2 2v7"/><circle cx="18" cy="6" r="2.5"/>
  </svg>
}
export const inject = ['slots', 'remote', 'locale', 'layout', 'uiWorkspace', 'fileUpload']
/** All contributions use the current rc.3 effect-owned public registries. */
export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'visual-workflow.locales')
  try { await ctx.remote.$mount(TYPERT_REMOTE) }
  catch (error) { console.error('Workflow remote registration failed', error); throw error }
  await ctx.inject([...inject, 'remote.visualWorkflow'], mountPanel)
}
/** The generated namespace is a Cordis child Service and must be injected. */
function mountPanel(ctx: Context): void {
  const client = new WorkflowClient(ctx.remote.visualWorkflow, 220, {
    conflict: () => ctx.locale.bind(NS)('conflictError'),
    missing: () => ctx.locale.bind(NS)('missingError'),
  })
  const runtime = new WorkflowRuntimeClient(ctx.remote.visualWorkflow as WorkflowRuntimeApi, client,
    (sessionId,file,signal,progress)=>ctx.fileUpload.upload(sessionId as Parameters<Context['fileUpload']['upload']>[0],file,file.name,signal,progress))
  const original = () => {
    try { localStorage.setItem('dsh-visual-workflow.mode', 'native') } catch {}
    ctx.layout.selectPanel(null)
  }
  const canvas = () => {
    try { localStorage.setItem('dsh-visual-workflow.mode', 'canvas') } catch {}
    ctx.layout.selectPanel(PANEL as MainPanelId)
  }
  // Resource tools are optional capabilities; missing providers must not disable Workflow.
  const nativeSidebar=()=>ctx.get('sidebarRight') as (NonNullable<NativeUtilityServices['sidebarRight']>&{
    mounted:UtilitySource<string|undefined>;openResource(address:string):void;openTab(kind:string,options?:{params?:{url?:string}}):void;
  })|undefined
  const lifetime=new AbortController()
  let utilityState:{error?:string}={};const utilityListeners=new Set<()=>void>()
  const utilityFeedback={getSnapshot:()=>utilityState,subscribe:(listener:()=>void)=>{utilityListeners.add(listener);return()=>{utilityListeners.delete(listener)}}}
  const setUtilityError=(error?:unknown)=>{utilityState=error?{error:error instanceof Error?error.message:String(error)}:{};for(const listener of utilityListeners)listener()}
  const showSession=(sessionId:string)=>{original();ctx.uiWorkspace.openSession(sessionId as Parameters<Context['uiWorkspace']['openSession']>[0])}
  const openNative=async(sessionId:string,open:()=>void)=>{
    const sidebar=nativeSidebar()
    if(!sidebar)throw new Error('当前 DSH 未提供原生资源界面。')
    setUtilityError()
    try{await openNativeUtilitySurface(sessionId,{mounted:sidebar.mounted,showSession},open,lifetime.signal)}
    catch(error){if(!lifetime.signal.aborted){canvas();setUtilityError(error)}throw error}
  }
  const nativeUtilityBridge=createNativeUtilityBridge({
    get workspaceFiles(){return ctx.get('remote.workspaceFiles') as NativeUtilityServices['workspaceFiles']},
    get webTerminals(){return ctx.get('webTerminals') as NativeUtilityServices['webTerminals']},get sidebarRight(){return nativeSidebar()},
    get sidebarRightTabs(){return ctx.get('sidebarRightTabs') as NativeUtilityServices['sidebarRightTabs']},
    get openNativeResource(){return nativeSidebar()?(sessionId:string,address:string)=>openNative(sessionId,()=>nativeSidebar()!.openResource(address)):undefined},
    get openNativeTool(){return nativeSidebar()?(sessionId:string,kind:string)=>openNative(sessionId,()=>nativeSidebar()!.openTab(kind)):undefined},
    get openNativeBrowser(){return nativeSidebar()?(sessionId:string,url:string)=>openNative(sessionId,()=>nativeSidebar()!.openTab('browser',{params:{url}})):undefined},
  })
  for(const service of ['remote.workspaceFiles','webTerminals','sidebarRight','sidebarRightTabs'])void ctx.inject([service],child=>{
    nativeUtilityBridge.refreshCapabilities();utilityState={...utilityState};for(const listener of utilityListeners)listener()
    child.effect(()=>()=>{nativeUtilityBridge.refreshCapabilities();utilityState={...utilityState};for(const listener of utilityListeners)listener()},`visual-workflow.optional-${service}`)
  })
  const bindings: Bindings = { hooks: { workflow: client, runtime,utility:utilityFeedback }, nativeUtilityBridge, runtime, original, canvas,
    openSession: sessionId => { original(); ctx.uiWorkspace.openSession(sessionId as Parameters<Context['uiWorkspace']['openSession']>[0]) },
    select: id => { if (runtime.getSnapshot().busy) return; runtime.showWorkflow(); client.select(id) },
    create: () => { if (runtime.getSnapshot().busy) return; void client.create(ctx.locale.bind(NS)('newWorkflowName')).then(() => runtime.showWorkflow()) },
    change: client.change, rename: client.rename, retry: () => {setUtilityError();void client.retry(); void runtime.retry() } }
  let groupedDirectory = true
  try { groupedDirectory = localStorage.getItem('dsh-visual-workflow.directory-mode') !== 'native' } catch {}
  const directory = installWorkflowSidebar(ctx, {
    component: WorkflowSessionSidebar,
    initiallyEnabled: groupedDirectory,
    menuLabel: () => ctx.locale.bind(NS)('sidebarGroupByWorkflow'),
    onEnabledChange: enabled => { try { localStorage.setItem('dsh-visual-workflow.directory-mode', enabled ? 'workflow' : 'native') } catch {} },
    inject: () => ({
      hooks: { workflow: client }, onOpenSession: bindings.openSession,
      onOpenWorkflow: id => { if (runtime.getSnapshot().busy) return; bindings.select(id); canvas() },
      onUseNativeDirectory: () => directory.useNativeDirectory(),
      onPinSession: (id,pinned) => pinned ? ctx.uiWorkspace.pinSession(id as Parameters<Context['uiWorkspace']['pinSession']>[0]) : ctx.uiWorkspace.unpinSession(id as Parameters<Context['uiWorkspace']['unpinSession']>[0]),
      onArchiveSession: (id,archived) => archived ? ctx.uiWorkspace.archiveSession(id as Parameters<Context['uiWorkspace']['archiveSession']>[0]) : ctx.uiWorkspace.unarchiveSession(id as Parameters<Context['uiWorkspace']['unarchiveSession']>[0]),
    } satisfies WorkflowSidebarBindings),
  })
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshVisualWorkflow = 'true'
    style.textContent = __WORKFLOW_CSS__
    document.head.append(style)
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      if (client.hasUnsaved || runtime.hasUnsavedLayout) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', protectUnsaved)
    return () => { lifetime.abort();nativeUtilityBridge.dispose();utilityListeners.clear();style.remove(); window.removeEventListener('beforeunload', protectUnsaved); runtime.dispose(); client.dispose() }
  }, 'visual-workflow.client-lifetime')
  ctx.slots.inject('main', () => {
    const dispose = ctx.slots.register({ name: 'main', key: PANEL, locale: NS }, MainPlaceholder)
    queueMicrotask(() => { try { if (localStorage.getItem('dsh-visual-workflow.mode') !== 'native') canvas() } catch {} })
    return dispose
  })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: PANEL,
    order: 100, locale: NS, inject: () => bindings }, WorkflowOverlay))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL, order: 5, locale: NS, label: () => ctx.locale.bind(NS)('workspace'),
  }, WorkflowIcon))
  ctx.on('connection/reset', () => { void client.retry(); runtime.resetConnection() })
  void client.load()
  runtime.start()
}
