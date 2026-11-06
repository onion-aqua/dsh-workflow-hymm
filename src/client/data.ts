import type { Workflow, WorkflowCreateValue, WorkflowListValue, WorkflowSaveValue } from '../shared/model.ts'
import { replayGraph, sameHistoryGraph, type GraphHistoryEntry } from './graph-history.ts'

export type ClientResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } }
export interface WorkflowApi {
  list(): Promise<ClientResult<WorkflowListValue>>
  create(request: { name: string }): Promise<ClientResult<WorkflowCreateValue>>
  save(request: { workflow: Workflow; expectedRevision: number }): Promise<ClientResult<WorkflowSaveValue>>
}
export interface WorkflowSnapshot {
  workflows: readonly Workflow[]
  activeWorkflowId: string | null
  loading: boolean
  saveState: 'saved' | 'saving' | 'error'
  error?: string
  canUndo?: boolean
  canRedo?: boolean
}
export interface WorkflowMessages { conflict(): string; missing(): string }

/** Object-layer source: server records, optimistic edits and one serial writer. */
export class WorkflowClient {
  private snapshot: WorkflowSnapshot = { workflows: [], activeWorkflowId: null, loading: true, saveState: 'saved' }
  private readonly listeners = new Set<() => void>()
  private readonly committed = new Map<string, Workflow>()
  private readonly pending = new Map<string, Workflow>()
  private readonly saving = new Map<string, Workflow>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private flight: Promise<void> | undefined
  private disposed = false
  private loadVersion = 0
  private editLocks = 0
  private readonly deletedIds = new Set<string>()
  private readonly past = new Map<string, GraphHistoryEntry[]>()
  private readonly future = new Map<string, GraphHistoryEntry[]>()
  private replaying = false

  constructor(private readonly api: WorkflowApi, private readonly debounceMs = 220, private readonly messages: WorkflowMessages = {
    conflict: () => 'Save conflict: the server workflow changed. Local edits were retained.',
    missing: () => 'The server workflow no longer exists. Local edits were retained.',
  }) {}
  getSnapshot = (): WorkflowSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private publish(next: WorkflowSnapshot): void {
    if (this.disposed) return
    const id=next.activeWorkflowId
    this.snapshot = {...next,canUndo:!!id&&!!this.past.get(id)?.length,canRedo:!!id&&!!this.future.get(id)?.length}
    for (const listener of [...this.listeners]) listener()
  }
  private setWorkflow(workflow: Workflow): readonly Workflow[] {
    const exists = this.snapshot.workflows.some(item => item.id === workflow.id)
    return exists ? this.snapshot.workflows.map(item => item.id === workflow.id ? workflow : item) : [...this.snapshot.workflows, workflow]
  }
  get hasUnsaved(): boolean { return this.pending.size > 0 || this.flight !== undefined }
  /** Native graph mutations and local editing must not race whole-graph saves. */
  suspendEdits(): () => void {
    ++this.editLocks
    let released = false
    return () => { if (!released) { released = true; --this.editLocks } }
  }
  /** Update execution metadata without overwriting a newer unsaved local graph. */
  acceptServer(workflow: Workflow, select = false): void {
    if (this.disposed || this.deletedIds.has(workflow.id)) return
    const baseline=this.committed.get(workflow.id)
    if ((baseline?.revision ?? -1) > workflow.revision) return
    ++this.loadVersion
    const draft = this.pending.get(workflow.id)
    // Concurrent editable changes retain the old CAS baseline. Native-only
    // projections can safely advance it without admitting another editor's graph.
    const admittedDraft=this.saving.get(workflow.id)
    const conflict=Boolean(draft&&baseline&&!sameEditable(workflow,baseline)&&(!admittedDraft||!sameEditable(workflow,admittedDraft)))
    if(!conflict)this.committed.set(workflow.id, structuredClone(workflow))
    const visible = draft ? mergeEditableDraft(workflow,draft,baseline??draft) : workflow
    if (draft) this.pending.set(workflow.id, visible)
    this.publish({ ...this.snapshot, workflows: this.setWorkflow(visible),
      activeWorkflowId: select ? workflow.id : this.snapshot.activeWorkflowId, loading: false,
      ...(conflict?{saveState:'error' as const,error:this.messages.conflict()}: {}) })
    if (select) { try { globalThis.localStorage?.setItem('dsh-visual-workflow.active', workflow.id) } catch {} }
  }
  /** Native validation may admit an editable attachment transaction without a graph save. */
  acceptUserEdit(workflow:Workflow):void {
    const before=this.snapshot.workflows.find(item=>item.id===workflow.id)
    if(before&&!sameHistoryGraph(before,workflow)){
      const entries=this.past.get(workflow.id)??[];entries.push({before:structuredClone(before),after:structuredClone(workflow)})
      if(entries.length>80)entries.shift();this.past.set(workflow.id,entries);this.future.delete(workflow.id)
    }
    this.acceptServer(workflow)
  }
  /** A successful metadata deletion must never be undone by a delayed poll. */
  removeDeleted(id: string): void {
    ++this.loadVersion
    this.deletedIds.add(id)
    this.pending.delete(id)
    this.committed.delete(id)
    this.past.delete(id);this.future.delete(id)
    const workflows = this.snapshot.workflows.filter(workflow => workflow.id !== id)
    const activeWorkflowId = this.snapshot.activeWorkflowId === id ? workflows[0]?.id ?? null : this.snapshot.activeWorkflowId
    this.publish({ ...this.snapshot, workflows, activeWorkflowId, loading: false, saveState: this.pending.size ? 'saving' : 'saved', error: undefined })
    try { if (activeWorkflowId) globalThis.localStorage?.setItem('dsh-visual-workflow.active', activeWorkflowId); else globalThis.localStorage?.removeItem('dsh-visual-workflow.active') } catch {}
  }
  async refresh(): Promise<void> {
    if (this.disposed || this.hasUnsaved) return
    const version = this.loadVersion
    try {
      const result = await this.api.list()
      if (!result.ok || this.disposed || this.hasUnsaved || version !== this.loadVersion) return
      const ids = new Set(result.value.workflows.map(workflow => workflow.id))
      for (const workflow of this.snapshot.workflows) if (!ids.has(workflow.id)) this.removeDeleted(workflow.id)
      for (const workflow of result.value.workflows) this.acceptServer(workflow)
    } catch { /* The next mutation or foreground retry reports transport failure. */ }
  }

  async load(): Promise<void> {
    if (this.disposed || this.hasUnsaved) return
    const version = ++this.loadVersion
    this.publish({ ...this.snapshot, loading: true, error: undefined })
    try {
      const result = await this.api.list()
      if (this.disposed || version !== this.loadVersion || this.hasUnsaved) return
      if (!result.ok) throw new Error(result.error.message)
      const workflows = result.value.workflows.filter(workflow => !this.deletedIds.has(workflow.id))
      this.committed.clear()
      for (const workflow of workflows) this.committed.set(workflow.id, workflow)
      let preferred: string | null = null
      try { preferred = globalThis.localStorage?.getItem('dsh-visual-workflow.active') ?? null } catch { /* Storage can be unavailable in a carrier. */ }
      const chosen = this.snapshot.activeWorkflowId ?? preferred
      this.publish({ workflows,
        activeWorkflowId: workflows.some(item => item.id === chosen) ? chosen : workflows[0]?.id ?? null,
        loading: false, saveState: 'saved' })
    } catch (error) {
      if (version === this.loadVersion) this.publish({ ...this.snapshot, loading: false, saveState: 'error', error: this.errorText(error) })
    }
  }
  select = (id: string): void => {
    if (this.editLocks) return
    if (!this.snapshot.workflows.some(item => item.id === id)) return
    try { globalThis.localStorage?.setItem('dsh-visual-workflow.active', id) } catch { /* Only a viewing preference. */ }
    this.publish({ ...this.snapshot, activeWorkflowId: id })
  }
  create = async (name: string): Promise<void> => {
    if (this.disposed || this.editLocks) return
    ++this.loadVersion
    try {
      const result = await this.api.create({ name })
      if (!result.ok) throw new Error(result.error.message)
      if (this.disposed) return
      this.committed.set(result.value.workflow.id, result.value.workflow)
      ++this.loadVersion
      const failedSave = this.hasUnsaved && this.snapshot.saveState === 'error'
      this.publish({ ...this.snapshot, workflows: this.setWorkflow(result.value.workflow), activeWorkflowId: result.value.workflow.id,
        loading: false, saveState: failedSave ? 'error' : this.hasUnsaved ? 'saving' : 'saved',
        error: failedSave ? this.snapshot.error : undefined })
      this.select(result.value.workflow.id)
    } catch (error) { this.publish({ ...this.snapshot, loading: false, saveState: 'error', error: this.errorText(error) }) }
  }
  change = (workflow: Workflow): void => {
    if (this.disposed || this.editLocks || !this.committed.has(workflow.id)) return
    ++this.loadVersion
    const next = pruneDraftMembership(structuredClone(workflow))
    const before=this.snapshot.workflows.find(item=>item.id===workflow.id)
    if(before&&!this.replaying&&!sameHistoryGraph(before,next)){
      const entries=this.past.get(next.id)??[];entries.push({before:structuredClone(before),after:structuredClone(next)});
      if(entries.length>80)entries.shift();this.past.set(next.id,entries);this.future.delete(next.id)
    }
    this.pending.set(next.id, next)
    this.publish({ ...this.snapshot, workflows: this.setWorkflow(next), loading: false, saveState: 'saving', error: undefined })
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, this.debounceMs)
  }
  undo = (): void => { this.travelHistory(false) }
  redo = (): void => { this.travelHistory(true) }
  private travelHistory(redo:boolean):void{
    if(this.disposed||this.editLocks)return
    const id=this.snapshot.activeWorkflowId,current=this.snapshot.workflows.find(item=>item.id===id)
    if(!id||!current)return
    const source=(redo?this.future:this.past).get(id),entry=source?.at(-1)
    if(!entry)return
    try{
      const next=replayGraph(current,redo?entry.before:entry.after,redo?entry.after:entry.before)
      source!.pop();const target=(redo?this.past:this.future).get(id)??[];target.push(entry);(redo?this.past:this.future).set(id,target)
      this.replaying=true;try{this.change(next)}finally{this.replaying=false}
    }catch(error){this.publish({...this.snapshot,error:this.errorText(error)})}
  }
  rename = (id: string, name: string): void => {
    const workflow = this.snapshot.workflows.find(item => item.id === id)
    if (workflow) this.change({ ...workflow, name })
  }
  retry = async (): Promise<void> => {
    if (this.pending.size || this.flight) {
      this.publish({ ...this.snapshot, saveState: 'saving', error: undefined })
      await this.flush()
    } else await this.load()
  }
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    if (this.disposed) return
    if (this.flight) return this.flight
    const run = async () => {
      while (!this.disposed && this.pending.size) {
        const [id, draft] = this.pending.entries().next().value!
        this.pending.delete(id)
        const baseline = this.committed.get(id)!
        try {
          this.saving.set(id,draft)
          const result = await this.api.save({ workflow: pruneDraftMembership({ ...draft, revision: baseline.revision }), expectedRevision: baseline.revision })
          if (!result.ok) throw new Error(result.error.message)
          if (!result.value.ok) {
            if (result.value.code === 'conflict' && result.value.workflow && sameEditable(result.value.workflow, baseline)) {
              this.committed.set(id, result.value.workflow)
              if (!this.pending.has(id)) this.pending.set(id, draft)
              continue
            }
            throw new Error(result.value.code === 'conflict' ? this.messages.conflict() : this.messages.missing())
          }
          const server=(this.committed.get(id)?.revision??-1)>result.value.workflow.revision?this.committed.get(id)!:result.value.workflow
          this.committed.set(id, server)
          const newer = this.pending.get(id)
          const visible = newer ? mergeEditableDraft(server,newer,draft) : server
          if (newer) this.pending.set(id, visible)
          this.publish({ ...this.snapshot, workflows: this.setWorkflow(visible), saveState: this.pending.size ? 'saving' : 'saved', error: undefined })
        } catch (error) {
          // A newer local edit owns the retry; an older failed request must not
          // replace it. Never silently adopt a conflicting server revision.
          if (!this.pending.has(id)) this.pending.set(id, draft)
          this.publish({ ...this.snapshot, saveState: 'error', error: this.errorText(error) })
          break
        } finally { if(this.saving.get(id)===draft)this.saving.delete(id) }
      }
    }
    this.flight = run()
    try { await this.flight } finally { this.flight = undefined }
  }
  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.listeners.clear()
  }
  private errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
}

/** Native execution updates may advance aggregate revision without graph edits. */
function sameEditable(left: Workflow, right: Workflow): boolean {
  return sameHistoryGraph(left,right)&&JSON.stringify(left.viewport)===JSON.stringify(right.viewport)
}

/** A pending graph owns its editable changes; all other facts come from the current Host. */
function mergeEditableDraft(server:Workflow,draft:Workflow,baseline:Workflow):Workflow{
  const equal=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right)
  const nodeValue=(node:Workflow['nodes'][number],key:'title'|'instruction'|'position'|'width'|'height'|'zIndex'|'attachments'|'model'|'hidden')=>key==='width'?node.width??300:key==='height'?node.height??210:key==='zIndex'?node.zIndex??0:key==='attachments'?node.attachments??[]:key==='model'?node.model??null:key==='hidden'?node.hidden??false:node[key]
  const nodes=draft.nodes.map(node=>{
    const live=server.nodes.find(item=>item.id===node.id),before=baseline.nodes.find(item=>item.id===node.id)
    if(!live)return node
    const result={...live}
    for(const key of ['title','instruction','position','width','height','zIndex','attachments','model','hidden'] as const)if(!before||!equal(nodeValue(node,key),nodeValue(before,key)))Object.assign(result,{[key]:structuredClone(node[key])})
    return result
  })
  const draftIds=new Set(draft.nodes.map(node=>node.id)),baselineIds=new Set(baseline.nodes.map(node=>node.id))
  nodes.push(...server.nodes.filter(node=>!draftIds.has(node.id)&&!baselineIds.has(node.id)))
  return pruneDraftMembership({...server,nodes,
    name:equal(draft.name,baseline.name)?server.name:draft.name,
    settings:equal(draft.settings,baseline.settings)?server.settings:draft.settings,
    preferences:equal(draft.preferences,baseline.preferences)?server.preferences:draft.preferences,
    utilityNodes:equal(draft.utilityNodes??[],baseline.utilityNodes??[])?server.utilityNodes:draft.utilityNodes,
    planningAttachments:equal(draft.planningAttachments??[],baseline.planningAttachments??[])?server.planningAttachments:draft.planningAttachments,
    viewport:equal(draft.viewport,baseline.viewport)?server.viewport:draft.viewport,
    edges:equal(draft.edges,baseline.edges)?server.edges:draft.edges,
    groups:equal(draft.groups??[],baseline.groups??[])?server.groups:draft.groups,
    activeBranchId:equal(draft.activeBranchId,baseline.activeBranchId)?server.activeBranchId:draft.activeBranchId})
}

/** A draft may remove visual tasks; never send a branch member pointing at a removed node. */
function pruneDraftMembership(workflow:Workflow):Workflow{
  const ids=new Set(workflow.nodes.map(node=>node.id))
  return {...workflow,...(workflow.branches?{branches:workflow.branches.map(branch=>({...branch,nodeIds:branch.nodeIds.filter(id=>ids.has(id))}))}:{})}
}
