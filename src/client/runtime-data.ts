import type * as M from '../shared/model.ts'
import { WORKFLOW_API_VERSION, WORKFLOW_PLUGIN_VERSION } from '../shared/model.ts'
import { WorkflowClient, type ClientResult } from './data.ts'
import type { WorkflowRuntimeProps, TraceCard } from './ui-contract.ts'
import { questionRequestKey } from './ui-contract.ts'
import { changeLayer, changeLayers, executionIsActive, type LayerAction } from './graph.ts'
import { copyGraph, cutGraph, pasteGraph, hideGraphNodes, restoreGraphNodes, duplicateGraph } from './node-clipboard.ts'
import type { CanvasCommand, CanvasCommandContext, WorkflowPanelProps } from './WorkflowPanel.tsx'
import { WorkflowSounds } from './workflow-sounds.ts'
import { sameHistoryGraph } from './graph-history.ts'

export interface WorkflowRuntimeApi {
  contextUsage?(request:M.WorkflowContextRequest):Promise<ClientResult<M.WorkflowContextValue>>
  compactContext?(request:M.WorkflowCompactRequest):Promise<ClientResult<M.WorkflowCompactValue>>
  skills?(request:M.WorkflowContextRequest):Promise<ClientResult<M.WorkflowSkillsValue>>
  accessModes?():Promise<ClientResult<M.WorkflowAccessCatalog>>
  setAccessMode?(request:M.WorkflowAccessModeRequest):Promise<ClientResult<M.WorkflowActionValue>>
  pendingApprovals?(request:M.WorkflowQuestionsRequest):Promise<ClientResult<M.WorkflowApprovalsValue>>
  answerApproval?(request:M.WorkflowAnswerApprovalRequest):Promise<ClientResult<M.WorkflowAnswerQuestionValue>>
  pauseQuestionAutomation?(request:M.WorkflowPauseQuestionRequest):Promise<ClientResult<M.WorkflowAnswerQuestionValue>>
  workspacesList?():Promise<ClientResult<M.WorkflowWorkspacesValue>>
  setWorkspace?(request:M.WorkflowWorkspaceRequest):Promise<ClientResult<M.WorkflowActionValue>>
  organizeSessionNames?(request:M.WorkflowQuestionsRequest):Promise<ClientResult<M.WorkflowOrganizeValue>>
  questions?(request:M.WorkflowQuestionsRequest):Promise<ClientResult<M.WorkflowQuestionsValue>>
  answerQuestion?(request:M.WorkflowAnswerQuestionRequest):Promise<ClientResult<M.WorkflowAnswerQuestionValue>>
  capabilities():Promise<ClientResult<M.WorkflowCapabilitiesValue>>
  models():Promise<ClientResult<M.WorkflowModelsValue>>
  prepareAttachment(request:M.WorkflowPrepareAttachmentRequest):Promise<ClientResult<M.WorkflowPrepareAttachmentValue>>
  attachFiles(request:M.WorkflowPrepareAttachmentRequest & {sessionId:string;receiptIds:string[]}):Promise<ClientResult<M.WorkflowActionValue>>
  preparePlanAttachments(request:M.WorkflowPreparePlanAttachmentsRequest):Promise<ClientResult<M.WorkflowPrepareAttachmentValue>>
  attachPlanFiles(request:M.WorkflowAttachPlanFilesRequest):Promise<ClientResult<M.WorkflowActionValue>>
  delete(request: M.WorkflowDeleteRequest): Promise<ClientResult<M.WorkflowDeleteValue>>
  previewSessionArchive?(request:M.WorkflowSessionArchivePreviewRequest):Promise<ClientResult<M.WorkflowSessionArchivePreviewValue>>
  archiveSessionHistory?(request:M.WorkflowSessionArchiveRequest):Promise<ClientResult<M.WorkflowSessionArchiveValue>>
  batchRun(request: M.WorkflowBatchRunRequest): Promise<ClientResult<M.WorkflowBatchRunValue>>
  catalog(): Promise<ClientResult<M.WorkflowCatalogValue>>
  saveCatalogLayout(request: M.WorkflowCatalogLayoutRequest): Promise<ClientResult<M.WorkflowCatalogLayoutValue>>
  importSession(request: M.WorkflowImportRequest): Promise<ClientResult<M.WorkflowActionValue>>
  approve(request: M.WorkflowApproveRequest): Promise<ClientResult<M.WorkflowActionValue>>
  run(request: M.WorkflowRunRequest): Promise<ClientResult<M.WorkflowActionValue>>
  cancel(request: M.WorkflowCancelRequest): Promise<ClientResult<M.WorkflowActionValue>>
  pauseAll?(request:M.WorkflowPauseRequest):Promise<ClientResult<M.WorkflowActionValue>>
  trace(request: M.WorkflowTraceRequest): Promise<ClientResult<M.WorkflowTraceValue>>
  details(request: M.WorkflowDetailsRequest): Promise<ClientResult<M.WorkflowDetailsValue>>
  generatePlan(request: M.WorkflowPlanRequest): Promise<ClientResult<M.WorkflowActionValue>>
  applyPlan(request: M.WorkflowApplyPlanRequest & { taskIds?: string[] }): Promise<ClientResult<M.WorkflowActionValue>>
  fork(request: M.WorkflowForkRequest): Promise<ClientResult<M.WorkflowActionValue>>
}
interface RuntimeState {
  contextUsage?:M.WorkflowContextValue
  contextLoading?:boolean
  contextError?:string
  compacting?:boolean
  skillOptions?:readonly M.WorkflowSkillOption[]
  skillsLoading?:boolean
  skillsError?:string
  sessionNamingNotice?:string
  accessModes:readonly M.WorkflowAccessOption[]
  defaultAccessMode?:string
  accessModesLoading:boolean
  accessModesError?:string
  workspaceOptions:readonly M.WorkflowWorkspaceOption[]
  workspacesLoading:boolean
  workspacesError?:string
  pendingApprovals:readonly M.WorkflowPendingApproval[]
  submittingApprovalKeys:readonly string[]
  approvalErrors:Readonly<Record<string,string>>
  approvalLoadError?:string
  traces:Readonly<Record<string,TraceCard>>
  pendingQuestions:readonly M.WorkflowPendingQuestion[]
  submittingQuestionKeys:readonly string[]
  questionErrors:Readonly<Record<string,string>>
  questionLoadError?:string
  runtimeReady?:boolean
  models:readonly M.WorkflowModelOption[]
  defaultModel?:M.WorkflowModelIdentity
  modelsLoading:boolean
  modelsError?:string
  sessions: readonly M.SessionRoot[]
  layout: M.CatalogLayout
  catalogLoading: boolean
  catalogMode: boolean
  busy: boolean
  error?: string
  trace?: TraceCard
}
const emptyLayout = (): M.CatalogLayout => ({ revision: 0, positions: {}, viewport: { x: 0, y: 0, zoom: 1 } })
type UploadFile=(sessionId:string,file:File,signal?:AbortSignal,onProgress?:(progress:{loaded:number;total?:number})=>void)=>Promise<ClientResult<{receiptId:string;file:M.WorkflowFileReference}>>

/** Native event processing stays on the Host; this source refreshes its projections. */
export class WorkflowRuntimeClient {
  private state: RuntimeState = { accessModes:[],accessModesLoading:true,workspaceOptions:[],workspacesLoading:true,pendingApprovals:[],submittingApprovalKeys:[],approvalErrors:{},traces:{},pendingQuestions:[],submittingQuestionKeys:[],questionErrors:{},sessions: [], layout: emptyLayout(), catalogLoading: true, catalogMode: true, busy: false,models:[],modelsLoading:true }
  private readonly approvalFlights=new Set<string>()
  private readonly traceRequests=new Map<string,number>()
  private watchedRuns:{workflowId:string;runIds:readonly string[]}|undefined
  private readonly sounds=new WorkflowSounds()
  private readonly observedStates=new Map<string,string>()
  private readonly observedQuestions=new Set<string>()
  private readonly observedApprovals=new Set<string>()
  private soundBaseline=false
  private questionsVersion=0
  private readonly questionFlights=new Set<string>()
  private capabilityFlight?:Promise<void>
  private compatibilityError?:Error
  private connectionVersion=0
  private modelsVersion=0
  private readonly listeners = new Set<() => void>()
  private timer?: ReturnType<typeof setTimeout>
  private layoutTimer?: ReturnType<typeof setTimeout>
  private disposed = false
  private layoutDirty = false
  private layoutFlight = false
  private readonly dirtyRootIds = new Set<string>()
  private readonly dirtyRootZIds = new Set<string>()
  private readonly dirtyRootSizeIds = new Set<string>()
  private readonly dirtyGroupIds = new Set<string>()
  private readonly catalogPast: {before:M.CatalogLayout;after:M.CatalogLayout}[] = []
  private readonly catalogFuture: {before:M.CatalogLayout;after:M.CatalogLayout}[] = []
  private viewportDirty = false
  private catalogVersion = 0
  private selectedRun?: { workflowId: string; runId: string }
  private traceVersion = 0
  private contextTarget:{nodeId?:string;sessionId?:string;planning?:boolean}|null=null
  private contextVersion=0
  private skillsVersion=0
  private contextWorkflowId:string|null=null
  constructor(private readonly api: WorkflowRuntimeApi, private readonly graphs: WorkflowClient,private readonly uploadFile?:UploadFile) {}
  getSnapshot = () => this.state
  get hasUnsavedLayout(): boolean { return this.layoutDirty || this.layoutFlight }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private publish(next: RuntimeState): void { if (!this.disposed) { this.state = next; this.listeners.forEach(listener => listener()) } }
  private current(): M.Workflow {
    const state = this.graphs.getSnapshot()
    const workflow = state.workflows.find(item => item.id === state.activeWorkflowId)
    if (!workflow) throw new Error('请先选择或创建工作流。')
    return workflow
  }
  private value<T>(result: ClientResult<T>): T { if (!result.ok) throw new Error(result.error.message); return result.value }
  private async ensureRuntime():Promise<void>{
    if(this.state.runtimeReady===true)return
    if(this.state.runtimeReady===false&&this.compatibilityError)throw this.compatibilityError
    if(this.capabilityFlight)return this.capabilityFlight
    const version=this.connectionVersion
    const flight=(async()=>{
      try{
        const value=this.value(await this.api.capabilities())
        if(version!==this.connectionVersion)throw new Error('后台连接已变化，请重新点击操作。')
        if(value.apiVersion!==WORKFLOW_API_VERSION||value.pluginVersion!==WORKFLOW_PLUGIN_VERSION||!['batch-run','delete','model-selection','planning','planning-attachments','visual-node-hide'].every(feature=>value.features.includes(feature)))throw new Error('Workflow 前后台版本不一致。请完全退出 DeepSeek Harness（包括托盘后台）并重新启动，然后点击重试。')
        this.publish({...this.state,runtimeReady:true})
      }catch(error){
        if(version!==this.connectionVersion)throw new Error('后台连接已变化，请重新点击操作。')
        this.compatibilityError=new Error(this.isMissingEndpoint(error)?'Workflow 后台尚未加载本次更新。请完全退出 DeepSeek Harness（包括托盘后台）并重新启动，然后点击重试。':this.errorText(error))
        this.publish({...this.state,runtimeReady:false,modelsLoading:false});throw this.compatibilityError
      }
    })()
    this.capabilityFlight=flight
    try{await flight}finally{if(this.capabilityFlight===flight)this.capabilityFlight=undefined}
  }
  reloadModels = async():Promise<void>=>{
    const version=++this.modelsVersion
    this.publish({...this.state,modelsLoading:true,modelsError:undefined})
    try{
      await this.ensureRuntime()
      const value=this.value(await this.api.models())
      if(this.disposed||version!==this.modelsVersion)return
      this.publish({...this.state,models:value.models,defaultModel:value.defaultModel,modelsLoading:false,modelsError:undefined})
    }catch(error){if(version===this.modelsVersion)this.publish({...this.state,modelsLoading:false,modelsError:this.errorText(error)})}
  }
  start(): void { globalThis.document?.addEventListener('pointerdown',this.sounds.unlock);globalThis.document?.addEventListener('keydown',this.sounds.unlock);void this.refresh(true); this.schedule() }
  private schedule(): void {
    if (this.disposed) return
    this.timer = setTimeout(async () => { await this.refresh(); this.schedule() }, 1200)
  }
  async refresh(foreground = false): Promise<void> {
    const version = ++this.catalogVersion
    try {
      await this.ensureRuntime()
      if(foreground||this.state.modelsLoading)await this.reloadModels()
      const result = this.value(await this.api.catalog())
      if (this.disposed || version !== this.catalogVersion) return
      this.publish({ ...this.state, sessions: result.sessions,
        layout: this.layoutDirty || result.layout.revision < this.state.layout.revision ? this.state.layout : result.layout, catalogLoading: false,
        ...(foreground ? { error: undefined } : {}) })
      await this.graphs.refresh()
      if(foreground||this.state.accessModesLoading)await this.reloadAccessModes()
      if(foreground||this.state.workspacesLoading)await this.reloadWorkspaces()
      await this.refreshQuestions()
      await this.refreshApprovals()
      await this.refreshContext()
      this.notifyExecutionSounds()
      if (this.selectedRun && !this.state.busy) await this.readTrace(this.selectedRun.runId, true)
      if(this.watchedRuns?.workflowId===this.graphs.getSnapshot().activeWorkflowId&&!this.state.busy)await Promise.allSettled(this.watchedRuns.runIds.filter(id=>id!==this.selectedRun?.runId).map(id=>this.readTrace(id,true)))
    } catch (error) { if (foreground && version === this.catalogVersion) this.publish({ ...this.state, catalogLoading: false, error: this.errorText(error) }) }
  }
  showCatalog = (): void => { this.selectedRun = undefined; ++this.traceVersion; this.publish({ ...this.state, catalogMode: true, trace: undefined }); void this.refresh(true) }
  showWorkflow = (): void => { this.selectedRun = undefined; ++this.traceVersion; this.publish({ ...this.state, catalogMode: false, trace: undefined }) }
  private contextRequest():M.WorkflowContextRequest{
    const id=this.state.catalogMode?undefined:this.graphs.getSnapshot().activeWorkflowId??undefined
    const branchId=id?this.graphs.getSnapshot().workflows.find(item=>item.id===id)?.activeBranchId:undefined
    return {...(id?{workflowId:id}:{}),...(branchId?{branchId}:{}),...(this.contextTarget??{})}
  }
  selectContextTarget=(target:{nodeId?:string;sessionId?:string;planning?:boolean}|null):void=>{
    const workflowId=this.graphs.getSnapshot().activeWorkflowId
    if(JSON.stringify(target)===JSON.stringify(this.contextTarget)&&workflowId===this.contextWorkflowId)return
    this.contextTarget=target;this.contextWorkflowId=workflowId;++this.contextVersion;++this.skillsVersion
    this.publish({...this.state,contextUsage:undefined,contextError:undefined,contextLoading:true,skillOptions:[],skillsError:undefined})
    void this.refreshContext();void this.reloadSkills()
  }
  refreshContext=async():Promise<void>=>{
    if(!this.api.contextUsage||this.disposed)return
    const request=this.contextRequest(),identity=JSON.stringify(request),version=++this.contextVersion
    try{
      const value=this.value(await this.api.contextUsage(request))
      if(this.disposed||version!==this.contextVersion||identity!==JSON.stringify(this.contextRequest()))return
      this.publish({...this.state,contextUsage:value,contextLoading:false,contextError:undefined})
    }catch(error){if(version===this.contextVersion&&!this.disposed)this.publish({...this.state,contextUsage:undefined,contextLoading:false,contextError:this.errorText(error)})}
  }
  reloadSkills=async():Promise<void>=>{
    if(!this.api.skills||this.disposed)return
    const request=this.contextRequest(),identity=JSON.stringify(request),version=++this.skillsVersion
    this.publish({...this.state,skillsLoading:true,skillsError:undefined})
    try{
      const value=this.value(await this.api.skills(request))
      if(this.disposed||version!==this.skillsVersion||identity!==JSON.stringify(this.contextRequest()))return
      this.publish({...this.state,skillOptions:value.skills,skillsLoading:false,skillsError:undefined})
    }catch(error){if(version===this.skillsVersion&&!this.disposed)this.publish({...this.state,skillsLoading:false,skillsError:this.errorText(error)})}
  }
  compactContext=async():Promise<void>=>{
    if(this.disposed||this.state.compacting||this.state.busy)return
    const request=this.contextRequest(),workflowId=request.workflowId
    const context=this.state.contextUsage
    if(!workflowId||!context?.sessionId||context.readOnly||!context.canCompact||!this.api.compactContext)throw new Error(context?.unavailableReason??'当前没有可压缩的工作流会话。')
    const identity=JSON.stringify(request),operationId=crypto.randomUUID()
    const release=this.graphs.suspendEdits()
    this.publish({...this.state,compacting:true,busy:true,contextError:undefined})
    try{
      await this.ensureRuntime();await this.graphs.flush()
      if(this.graphs.hasUnsaved)throw new Error('请先成功保存当前编辑，再压缩上下文。')
      const latest=this.value(await this.api.contextUsage!(request))
      if(identity!==JSON.stringify(this.contextRequest())||latest.sessionId!==context.sessionId||latest.readOnly||!latest.canCompact)throw new Error('上下文目标或执行状态已经变化，请核对当前会话后重新操作。')
      const result=this.value(await this.api.compactContext({workflowId,sessionId:context.sessionId,operationId}))
      this.graphs.acceptServer(result.workflow)
      if(identity===JSON.stringify(this.contextRequest()))this.publish({...this.state,contextUsage:result.context,contextError:undefined})
    }catch(error){if(identity===JSON.stringify(this.contextRequest()))this.publish({...this.state,contextError:this.errorText(error)});throw error}
    finally{release();this.publish({...this.state,compacting:false,busy:false});void this.refreshContext()}
  }
  refreshQuestions = async():Promise<void>=>{
    if(this.disposed||!this.api.questions||this.state.catalogMode)return
    const workflowId=this.graphs.getSnapshot().activeWorkflowId
    if(!workflowId)return
    const version=++this.questionsVersion
    try{
      const value=this.value(await this.api.questions({workflowId}))
      if(this.disposed||version!==this.questionsVersion||workflowId!==this.graphs.getSnapshot().activeWorkflowId)return
      const questions=value.questions.filter(question=>question.workflowId===workflowId)
      const preferences=this.current().preferences
      for(const question of questions){const key=questionRequestKey(question);if(!this.observedQuestions.has(key)){this.observedQuestions.add(key);this.sounds.play('question',preferences)}}
      this.publish({...this.state,pendingQuestions:questions,questionLoadError:undefined})
    }catch(error){if(!this.disposed&&version===this.questionsVersion&&workflowId===this.graphs.getSnapshot().activeWorkflowId)this.publish({...this.state,questionLoadError:this.errorText(error)})}
  }
  private notifyExecutionSounds():void{
    for(const workflow of this.graphs.getSnapshot().workflows)for(const run of workflow.executions??[]){
      const key=JSON.stringify([workflow.id,run.runId]),previous=this.observedStates.get(key);this.observedStates.set(key,run.status)
      if(this.soundBaseline&&previous&&previous!==run.status&&(run.status==='completed'||run.status==='failed'))this.sounds.play(run.status,workflow.preferences)
    }
    this.soundBaseline=true
  }
  reloadAccessModes=async():Promise<void>=>{
    if(!this.api.accessModes){this.publish({...this.state,accessModesLoading:false});return}
    this.publish({...this.state,accessModesLoading:true,accessModesError:undefined})
    try{const value=this.value(await this.api.accessModes());this.publish({...this.state,accessModes:value.options,defaultAccessMode:value.defaultPreset,accessModesLoading:false})}
    catch(error){this.publish({...this.state,accessModesLoading:false,accessModesError:this.errorText(error)})}
  }
  reloadWorkspaces=async():Promise<void>=>{
    if(!this.api.workspacesList){this.publish({...this.state,workspacesLoading:false});return}
    this.publish({...this.state,workspacesLoading:true,workspacesError:undefined})
    try{const value=this.value(await this.api.workspacesList());this.publish({...this.state,workspaceOptions:value.workspaces,workspacesLoading:false})}
    catch(error){this.publish({...this.state,workspacesLoading:false,workspacesError:this.errorText(error)})}
  }
  selectAccessMode=(presetId:string|undefined)=>this.api.setAccessMode?this.action(()=>this.api.setAccessMode!({workflowId:this.current().id,presetId})):Promise.resolve()
  selectWorkspace=(workspaceId:string|undefined)=>this.api.setWorkspace?this.action(()=>this.api.setWorkspace!({workflowId:this.current().id,workspaceId})):Promise.resolve()
  organizeSessionNames=async()=>{if(!this.api.organizeSessionNames)return;try{const value=this.value(await this.api.organizeSessionNames({workflowId:this.current().id}));this.publish({...this.state,sessionNamingNotice:`已整理 ${value.updatedSessionIds.length} 个对话；${value.deferredSessionIds.length} 个将在自然打开后整理。`});await this.refresh(true)}catch(error){this.publish({...this.state,error:this.errorText(error)})}}
  changePreferences=(preferences:M.WorkflowPreferences)=>{const workflow=this.current();this.graphs.change({...workflow,preferences})}
  testSound=()=>{this.sounds.unlock();setTimeout(()=>this.sounds.play('question',undefined,true),40)}
  watchTraceRuns=(runIds:readonly string[])=>{const workflowId=this.graphs.getSnapshot().activeWorkflowId;this.watchedRuns=workflowId?{workflowId,runIds:[...new Set(runIds)]}:undefined}
  pauseQuestionAutomation=async(question:M.WorkflowPendingQuestion)=>{
    if(!this.api.pauseQuestionAutomation)return
    this.value(await this.api.pauseQuestionAutomation({workflowId:question.workflowId,runId:question.runId,sessionId:question.sessionId,callId:question.callId}));await this.refreshQuestions()
  }
  refreshApprovals=async():Promise<void>=>{
    const workflowId=this.graphs.getSnapshot().activeWorkflowId;if(this.disposed||this.state.catalogMode||!workflowId||!this.api.pendingApprovals)return
    try{
      const value=this.value(await this.api.pendingApprovals({workflowId}));if(workflowId!==this.graphs.getSnapshot().activeWorkflowId)return
      const approvals=value.approvals.filter(item=>item.workflowId===workflowId)
      for(const approval of approvals){const key=this.approvalKey(approval);if(!this.observedApprovals.has(key)){this.observedApprovals.add(key);this.sounds.play('approval',this.current().preferences)}}
      this.publish({...this.state,pendingApprovals:approvals,approvalLoadError:undefined})
    }catch(error){this.publish({...this.state,approvalLoadError:this.errorText(error)})}
  }
  private approvalKey(item:M.WorkflowPendingApproval):string{return JSON.stringify([item.workflowId,item.runId,item.sessionId,item.approvalId])}
  decideApproval=async(approval:M.WorkflowPendingApproval,decision:M.WorkflowApprovalDecision):Promise<void>=>{
    const key=this.approvalKey(approval);if(this.approvalFlights.has(key))return
    if(!this.api.answerApproval)throw new Error('当前后台不支持原生工具审批。')
    this.approvalFlights.add(key);const errors={...this.state.approvalErrors};delete errors[key];this.publish({...this.state,submittingApprovalKeys:[...this.approvalFlights],approvalErrors:errors})
    try{const value=this.value(await this.api.answerApproval({workflowId:approval.workflowId,runId:approval.runId,sessionId:approval.sessionId,approvalId:approval.approvalId,decision}));if(!value.accepted)throw new Error('该审批已失效或已经处理，请刷新核对。')}
    catch(error){this.publish({...this.state,approvalErrors:{...this.state.approvalErrors,[key]:this.errorText(error)}});throw error}
    finally{this.approvalFlights.delete(key);this.publish({...this.state,submittingApprovalKeys:[...this.approvalFlights]});await this.refreshApprovals()}
  }
  answerQuestion = async(question:M.WorkflowPendingQuestion,answers:M.WorkflowQuestionAnswer[]):Promise<void>=>{
    const key=questionRequestKey(question)
    if(this.disposed||this.questionFlights.has(key))return
    if(!this.api.answerQuestion)throw new Error('当前后台不支持在画布回答问题，请更新后台连接。')
    const pending=this.state.pendingQuestions.find(item=>questionRequestKey(item)===key)
    if(!pending||!pending.actionable)throw new Error('该问题已处理或当前不可回答，请刷新后重试。')
    this.questionFlights.add(key);++this.questionsVersion
    const errors={...this.state.questionErrors};delete errors[key]
    this.publish({...this.state,submittingQuestionKeys:[...this.questionFlights],questionErrors:errors})
    try{
      const value=this.value(await this.api.answerQuestion({workflowId:question.workflowId,runId:question.runId,sessionId:question.sessionId,callId:question.callId,answers}))
      if(!value.accepted)throw new Error('回答未被接受，该问题可能已处理。请刷新后核对。')
      this.publish({...this.state,pendingQuestions:this.state.pendingQuestions.map(item=>questionRequestKey(item)===key?{...item,state:'continued',actionable:false}:item)})
    }catch(error){this.publish({...this.state,questionErrors:{...this.state.questionErrors,[key]:this.errorText(error)}});throw error}
    finally{this.questionFlights.delete(key);this.publish({...this.state,submittingQuestionKeys:[...this.questionFlights]});await this.refreshQuestions()}
  }
  private async action(operation: () => Promise<ClientResult<M.WorkflowActionValue>>, select = false, propagateError = false): Promise<void> {
    if (this.disposed || this.state.busy) return
    const release = this.graphs.suspendEdits()
    this.publish({ ...this.state, busy: true, error: undefined })
    try {
      await this.ensureRuntime()
      await this.graphs.flush()
      if (this.graphs.hasUnsaved) throw new Error('请先成功保存当前编辑，再执行任务。')
      const value = this.value(await operation())
      this.graphs.acceptServer(value.workflow, select)
      if (select) this.showWorkflow()
      if (value.runId) { this.selectedRun = { workflowId: value.workflow.id, runId: value.runId }; await this.readTrace(value.runId) }
    } catch (error) { this.publish({ ...this.state, error: this.errorText(error) });if(propagateError)throw error }
    finally { release(); this.publish({ ...this.state, busy: false }) }
  }
  importSession = (sessionId: string) => this.action(() => this.api.importSession({ sessionId }), true)
  approve = (nodeId: string, approved: boolean) => this.action(() => this.api.approve({ workflowId: this.current().id, nodeId, approved }))
  run = (nodeId: string, branchId?: string) => this.action(() => {
    const workflow = this.current()
    const node = workflow.nodes.find(item => item.id === nodeId)
    if (!node) throw new Error('当前任务已不存在。')
    return this.api.run({ workflowId: workflow.id, nodeId, nodeRevision: node.revision, ...(branchId ? { branchId } : {}), operationId: crypto.randomUUID() })
  })
  runNodes = (nodeIds: readonly string[], branchId?: string) => this.action(() => {
    const workflow = this.current()
    const ids = [...new Set(nodeIds)]
    if (!ids.length) throw new Error('请先选择要运行的任务。')
    const nodeRevisions: Record<string, number> = {}
    for (const id of ids) {
      const node = workflow.nodes.find(item => item.id === id)
      if (!node || node.kind === 'session' || node.hidden) throw new Error('所选内容包含不可执行的节点。')
      nodeRevisions[id] = node.revision
    }
    return this.api.batchRun({ workflowId: workflow.id, nodeIds: ids, nodeRevisions, ...(branchId ? { branchId } : {}), operationId: crypto.randomUUID() })
  })
  deleteWorkflow = async (workflowId: string): Promise<boolean> => {
    if (this.disposed || this.state.busy) return false
    const release = this.graphs.suspendEdits()
    this.publish({ ...this.state, busy: true, error: undefined })
    try {
      await this.ensureRuntime()
      await this.graphs.flush()
      if (this.graphs.hasUnsaved) throw new Error('请先成功保存当前编辑，再删除工作流。')
      const workflow = this.graphs.getSnapshot().workflows.find(item => item.id === workflowId)
      if (!workflow) throw new Error('工作流已不存在。')
      let value = this.value(await this.api.delete({ workflowId, expectedRevision: workflow.revision }))
      // A definite CAS rejection has made no deletion. Native progress can
      // advance revision between the click and admission without changing the
      // graph the user reviewed. Retry only that confirmed case, never an
      // unknown transport outcome or another editor's changes.
      for(let retries=0;retries<3&&!value.ok&&value.code==='conflict'&&value.workflow&&sameHistoryGraph(value.workflow,workflow)&&JSON.stringify(value.workflow.viewport)===JSON.stringify(workflow.viewport);retries++){
        this.graphs.acceptServer(value.workflow)
        value=this.value(await this.api.delete({workflowId,expectedRevision:value.workflow.revision}))
      }
      if (!value.ok) {
        if (value.workflow) this.graphs.acceptServer(value.workflow)
        throw new Error(value.code === 'conflict' ? '工作流已在其他窗口更新，请核对后重新删除。' : '工作流已不存在。')
      }
      const wasActive = this.graphs.getSnapshot().activeWorkflowId === workflowId
      this.graphs.removeDeleted(workflowId)
      if (wasActive || this.selectedRun?.workflowId === workflowId) this.showCatalog()
      return true
    } catch (error) { this.publish({ ...this.state, error: this.errorText(error) }); return false }
    finally { release(); this.publish({ ...this.state, busy: false }) }
  }
  previewSessionArchive=async(workflowId:string):Promise<M.WorkflowSessionArchivePreviewValue>=>{
    if(this.disposed||!this.api.previewSessionArchive)throw new Error('当前 Workflow 后台尚未提供原生历史归档。');
    await this.ensureRuntime();return this.value(await this.api.previewSessionArchive({workflowId}));
  }
  archiveSessionHistory=async(preview:M.WorkflowSessionArchivePreviewValue):Promise<M.WorkflowSessionArchiveValue>=>{
    if(this.disposed||this.state.busy||!this.api.archiveSessionHistory)throw new Error('当前无法归档原生历史，请稍后重新检查。');
    const release=this.graphs.suspendEdits();this.publish({...this.state,busy:true,error:undefined});
    try{
      await this.ensureRuntime();
      const value=this.value(await this.api.archiveSessionHistory({workflowId:preview.workflowId,expectedRevision:preview.expectedRevision,sessionIds:[...preview.sessionIds]}));
      await this.refresh(true);return value;
    }finally{release();this.publish({...this.state,busy:false});}
  }
  cancel = (runId: string) => this.action(() => this.api.cancel({ workflowId: this.current().id, runId }))
  pauseAll = () => this.action(() => {
    if(!this.api.pauseAll)throw new Error('当前 Workflow 后台尚未提供暂停所有，请更新并重启应用。')
    return this.api.pauseAll({workflowId:this.current().id})
  })
  uploadFiles = async (nodeId:string,files:File[],signal?:AbortSignal,onProgress?:(progress:{loaded:number;total?:number;index:number;count:number})=>void):Promise<void> => {
    if(this.disposed||this.state.busy)throw new Error('当前有操作正在保存，请稍后上传。')
    if(!files.length)return
    if(!this.uploadFile)throw new Error('原生文件上传服务不可用。')
    const release=this.graphs.suspendEdits(),workflowId=this.current().id
    this.publish({...this.state,busy:true,error:undefined})
    try{
      await this.ensureRuntime()
      await this.graphs.flush()
      if(this.graphs.hasUnsaved)throw new Error('请先保存当前编辑，再上传文件。')
      const workflow=this.current(),node=workflow.nodes.find(item=>item.id===nodeId)
      if(!node||node.kind==='session')throw new Error('该节点不支持添加附件。')
      if(signal?.aborted)throw new Error('上传已取消。')
      const prepared=this.value(await this.api.prepareAttachment({workflowId,nodeId,nodeRevision:node.revision,operationId:crypto.randomUUID()}))
      this.graphs.acceptServer(prepared.workflow)
      const receiptIds:string[]=[]
      for(let index=0;index<files.length;index++){
        if(signal?.aborted)throw new Error('上传已取消。')
        const file=files[index]!
        const uploaded=this.value(await this.uploadFile(prepared.sessionId,file,signal,progress=>onProgress?.({...progress,index,count:files.length})))
        receiptIds.push(uploaded.receiptId)
      }
      if(signal?.aborted)throw new Error('上传已取消。')
      const updated=this.value(await this.api.attachFiles({workflowId,nodeId,nodeRevision:node.revision,sessionId:prepared.sessionId,receiptIds,operationId:crypto.randomUUID()}))
      this.graphs.acceptUserEdit(updated.workflow)
    }catch(error){this.publish({...this.state,error:this.errorText(error)});throw error}
    finally{release();this.publish({...this.state,busy:false})}
  }
  removeFile = async(nodeId:string,fileId:string):Promise<void> => {
    if(this.disposed||this.state.busy)throw new Error('请稍后再修改附件。')
    const workflow=this.current(),node=workflow.nodes.find(item=>item.id===nodeId)
    if(!node||node.kind==='session')throw new Error('该节点不可编辑。')
    if((workflow.executions??[]).some(run=>run.nodeId===nodeId&&executionIsActive(run)))throw new Error('请先停止任务，再修改附件。')
    this.graphs.change({...workflow,nodes:workflow.nodes.map(item=>item.id===nodeId?{...item,attachments:item.attachments?.filter(attachment=>attachment.id!==fileId)}:item)})
    await this.graphs.flush()
    if(this.graphs.hasUnsaved)throw new Error('附件移除尚未保存，请重试。')
  }
  uploadPlanningFiles = async(files:File[],signal?:AbortSignal,onProgress?:Parameters<NonNullable<WorkflowRuntimeProps['onUploadPlanningFiles']>>[2]):Promise<void> => {
    if(this.disposed||this.state.busy)throw new Error('当前有操作正在保存，请稍后上传。')
    if(!files.length)return
    if(!this.uploadFile)throw new Error('原生文件上传服务不可用。')
    const release=this.graphs.suspendEdits(),workflowId=this.current().id
    this.publish({...this.state,busy:true,error:undefined})
    try{
      await this.ensureRuntime();await this.graphs.flush()
      if(this.graphs.hasUnsaved)throw new Error('请先保存当前编辑，再上传文件。')
      if(signal?.aborted)throw new Error('上传已取消。')
      const prepared=this.value(await this.api.preparePlanAttachments({workflowId,operationId:crypto.randomUUID()}))
      this.graphs.acceptServer(prepared.workflow)
      const receiptIds:string[]=[]
      for(let index=0;index<files.length;index++){
        if(signal?.aborted)throw new Error('上传已取消。')
        const uploaded=this.value(await this.uploadFile(prepared.sessionId,files[index]!,signal,progress=>onProgress?.({...progress,index,count:files.length})))
        receiptIds.push(uploaded.receiptId)
      }
      if(signal?.aborted)throw new Error('上传已取消。')
      const updated=this.value(await this.api.attachPlanFiles({workflowId,sessionId:prepared.sessionId,receiptIds,operationId:crypto.randomUUID()}))
      this.graphs.acceptUserEdit(updated.workflow)
    }catch(error){this.publish({...this.state,error:this.errorText(error)});throw error}
    finally{release();this.publish({...this.state,busy:false})}
  }
  removePlanningFile = async(fileId:string):Promise<void> => {
    if(this.disposed||this.state.busy)throw new Error('请稍后再修改附件。')
    const workflow=this.current()
    this.graphs.change({...workflow,planningAttachments:(workflow.planningAttachments??[]).filter(file=>file.id!==fileId)})
    await this.graphs.flush()
    if(this.graphs.hasUnsaved)throw new Error('附件移除尚未保存，请重试。')
  }
  private selectedModel(id:string|undefined):M.WorkflowModelIdentity|undefined{
    if(!id)return undefined
    const option=this.state.models.find(item=>JSON.stringify([item.provider,item.model])===id)
    if(!option)throw new Error('该模型当前不可用，请刷新模型列表。')
    return {provider:option.provider,model:option.model}
  }
  private reasoningModel(id:string|undefined,nodeId?:string):M.WorkflowModelOption|undefined{
    const workflow=this.current()
    const inherited=nodeId?workflow.settings?.model??this.state.defaultModel:this.state.defaultModel
    return id?this.state.models.find(item=>JSON.stringify([item.provider,item.model])===id):inherited&&this.state.models.find(item=>item.provider===inherited.provider&&item.model===inherited.model)
  }
  private reasoningControl=(id:string|undefined,nodeId?:string):import('./ui-contract.ts').ModelReasoningControl|undefined=>{
    const option=this.reasoningModel(id,nodeId),metadata=option?.reasoning
    if(!metadata)return {steps:[],availability:'unknown',unavailableMessage:'此模型的思考档位尚未确认'}
    const workflow=this.current()
    const override=workflow.settings?.modelReasoning?.find(item=>item.provider===option.provider&&item.model===option.model)
    const inherited=nodeId?workflow.settings?.model??this.state.defaultModel:this.state.defaultModel
    const defaultEffort=id===undefined&&inherited?.provider===option.provider&&inherited?.model===option.model?inherited.reasoningEffort:undefined
    const steps=metadata.efforts.map(effort=>({value:effort.id,label:effort.name,description:effort.description}))
    return {steps,value:override?.reasoningEffort??defaultEffort??metadata.defaultEffort??steps[0]?.value,isDefault:!override,availability:steps.length>=2?'available':'unsupported',unavailableMessage:steps.length>=2?undefined:'此模型不支持思考程度调节',highlightLastStep:true}
  }
  private async selectReasoning(id:string|undefined,value:string|undefined,nodeId?:string):Promise<void>{
    if(this.disposed||this.state.busy)throw new Error('当前操作尚未完成，请稍后调整思考档位。')
    const option=this.reasoningModel(id,nodeId)
    if(!option)throw new Error('该模型当前不可用，请刷新模型列表。')
    if(!option.reasoning||option.reasoning.efforts.length<2)throw new Error('该模型没有可调节的原生思考档位。')
    if(value!==undefined&&!option.reasoning.efforts.some(effort=>effort.id===value))throw new Error('该思考档位当前不可用，请刷新模型列表。')
    const workflow=this.current()
    const modelReasoning=(workflow.settings?.modelReasoning??[]).filter(item=>item.provider!==option.provider||item.model!==option.model)
    if(value!==undefined)modelReasoning.push({provider:option.provider,model:option.model,reasoningEffort:value})
    this.graphs.change({...workflow,settings:{generation:workflow.settings?.generation??'suggest',execution:workflow.settings?.execution??'approval',...workflow.settings,modelReasoning}})
    await this.graphs.flush()
    if(this.graphs.hasUnsaved)throw new Error('思考档位尚未保存，请重试。')
  }
  selectGlobalModel = (id:string|undefined):void=>{
    if(this.disposed||this.state.busy)return
    const workflow=this.current(),model=this.selectedModel(id)
    this.graphs.change({...workflow,settings:{generation:workflow.settings?.generation??'suggest',execution:workflow.settings?.execution??'approval',...workflow.settings,model}})
  }
  selectGlobalReasoning = (id:string|undefined,value:string|undefined):Promise<void>=>this.selectReasoning(id,value)
  selectNodeReasoning = (nodeId:string,id:string|undefined,value:string|undefined):Promise<void>=>this.selectReasoning(id,value,nodeId)
  selectSubagentMode = (mode:NonNullable<WorkflowRuntimeProps['subagentMode']>):void=>{
    if(this.disposed||this.state.busy||this.state.catalogMode)return
    if(!['off','on','auto'].includes(mode))return
    const workflow=this.current()
    if((workflow.settings?.subagents??'off')===mode)return
    this.graphs.change({...workflow,settings:{generation:workflow.settings?.generation??'suggest',execution:workflow.settings?.execution??'approval',...workflow.settings,subagents:mode}})
  }
  selectNodeModel = (nodeId:string,id:string|undefined):void=>{
    if(this.disposed||this.state.busy)return
    const workflow=this.current(),node=workflow.nodes.find(item=>item.id===nodeId)
    if(!node||node.kind==='session')throw new Error('该节点的模型不可编辑。')
    if(workflow.executions?.some(run=>run.nodeId===nodeId&&executionIsActive(run)))throw new Error('请先停止任务，再切换该节点的模型。')
    const model=this.selectedModel(id)
    this.graphs.change({...workflow,nodes:workflow.nodes.map(item=>item.id===nodeId?{...item,model}:item)})
  }
  generatePlan = (goal: string, sourceSessionId?: string) => this.action(() => this.api.generatePlan({ workflowId: this.current().id, goal, attachmentIds:(this.current().planningAttachments??[]).map(file=>file.id), ...(sourceSessionId ? { sourceSessionId } : {}), operationId: crypto.randomUUID() }))
  applyPlan = (planId: string, taskIds: readonly string[]) => this.action(() => this.api.applyPlan({ workflowId: this.current().id, planId, accept: true, taskIds: [...taskIds] }))
  rejectPlan = (planId: string) => this.action(() => this.api.applyPlan({ workflowId: this.current().id, planId, accept: false }))
  forkExecution = (runId: string, label: string) => this.action(() => this.api.fork({ workflowId: this.current().id, runId, label, operationId: crypto.randomUUID() }))
  forkSession = async (sessionId: string, label: string): Promise<void> => {
    if (this.state.busy || this.disposed) return
    await this.importSession(sessionId)
    if (this.state.error) return
    if (this.current().sourceSessionId !== sessionId) return
    await this.action(() => this.api.fork({ workflowId: this.current().id, sessionId, label, operationId: crypto.randomUUID() }))
  }
  selectBranch = (branchId: string): void => {
    if (this.state.busy) return
    const workflow = this.current()
    if (!(workflow.branches ?? []).some(branch => branch.id === branchId)) return
    this.graphs.change({ ...workflow, activeBranchId: branchId })
    this.selectedRun = undefined; ++this.traceVersion
    ++this.contextVersion;++this.skillsVersion
    this.publish({ ...this.state, trace: undefined,contextUsage:undefined,contextError:undefined,contextLoading:true,skillOptions:[] })
    void this.refreshContext();void this.reloadSkills()
  }
  readTrace = async (runId: string, background = false): Promise<void> => {
    const workflowId = background && this.selectedRun?.runId===runId ? this.selectedRun.workflowId : this.current().id
    if (!background) { this.selectedRun = { workflowId, runId }; ++this.traceVersion }
    const version = (this.traceRequests.get(runId)??0)+1;this.traceRequests.set(runId,version)
    if (!background&&!this.state.traces[runId]) this.publishTrace({ runId, status: 'unknown', steps: [], loading: true })
    try {
      const { trace } = this.value(await this.api.trace({ workflowId, runId }))
      if (version !== this.traceRequests.get(runId) || this.disposed||workflowId!==this.graphs.getSnapshot().activeWorkflowId) return
      const previous = this.state.traces[runId]?.steps??[]
      this.publishTrace({ runId, status: trace.status, error: trace.error,
        detailsLoadingStepIds: this.state.traces[runId]?.detailsLoadingStepIds??[],
        steps: trace.steps.map(step => {
        const cached = previous.find(item => item.id === step.stepId)
        const unchanged = cached?.status === step.status && cached.eventStartSeq === step.eventStartSeq && cached.eventEndSeq === step.eventEndSeq
        return {
        ...(unchanged ? cached : {}), id: step.stepId, title: step.title, type: step.type,
        actionKind: step.actionKind, target: step.target,
        status: step.status, time: step.timestamp, toolName: step.toolName, eventStartSeq: step.eventStartSeq,
        eventEndSeq: step.eventEndSeq, parentStepId: step.parentStepId,
      } }) })
    } catch (error) { if (version === this.traceRequests.get(runId))this.publishTrace({ runId, status: 'unknown', steps: [], error: this.errorText(error) }) }
  }
  private publishTrace(trace:TraceCard):void{this.publish({...this.state,traces:{...this.state.traces,[trace.runId]:trace},...(this.selectedRun?.runId===trace.runId?{trace}:{})})}
  readStep = async (runId: string, stepId: string): Promise<void> => {
    const workflowId = this.current().id
    const trace = this.state.traces[runId]??(this.state.trace?.runId===runId?this.state.trace:undefined)
    if (!trace || trace.detailsLoadingStepIds?.includes(stepId)) return
    const requestedStep = trace.steps.find(step => step.id === stepId)
    if (!requestedStep) return
    this.publishTrace({ ...trace, detailsLoadingStepIds: [...(trace.detailsLoadingStepIds ?? []), stepId] })
    try {
      const { details } = this.value(await this.api.details({ workflowId, runId, stepId }))
      if (this.disposed||workflowId!==this.graphs.getSnapshot().activeWorkflowId) return
      const current=this.state.traces[runId];if(!current)return
      const currentStep = current.steps.find(step => step.id === stepId)
      if (currentStep?.status !== requestedStep.status || currentStep?.eventStartSeq !== requestedStep.eventStartSeq || currentStep?.eventEndSeq !== requestedStep.eventEndSeq) {
        this.publishTrace({ ...current, detailsLoadingStepIds: current.detailsLoadingStepIds?.filter(id => id !== stepId) })
        return
      }
      this.publishTrace({ ...current,
        detailsLoadingStepIds: current.detailsLoadingStepIds?.filter(id => id !== stepId),
        steps: current.steps.map(step => step.id !== stepId ? step : { ...step,
          unavailable: undefined,
          eventName: details.eventName, input: details.input, command: details.command, output: details.output, error: details.error,
          ...(details.truncated ? { truncated: true } : {}) }) })
    } catch (error) {
      const current=this.state.traces[runId];if(current&&workflowId===this.graphs.getSnapshot().activeWorkflowId)this.publishTrace({...current,detailsLoadingStepIds:current.detailsLoadingStepIds?.filter(id=>id!==stepId),steps:current.steps.map(step=>step.id===stepId?{...step,unavailable:this.errorText(error)}:step)})
    }
  }
  moveRoot = (sessionId: string, position: M.Position): void => {
    this.dirtyRootIds.add(sessionId)
    this.commitLayout({ ...this.state.layout, positions: { ...this.state.layout.positions, [sessionId]: position } })
    this.queueLayout()
  }
  moveRoots = (moves: readonly {sessionId:string;position:M.Position}[]): void => {
    if (this.disposed || this.state.busy || !moves.length) return
    const positions = { ...this.state.layout.positions }
    for (const {sessionId, position} of moves) { positions[sessionId] = position; this.dirtyRootIds.add(sessionId) }
    this.commitLayout({ ...this.state.layout, positions })
    this.queueLayout()
  }
  resizeRoot = (sessionId: string, size: M.NodeSize): void => {
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return
    this.dirtyRootSizeIds.add(sessionId)
    this.commitLayout({ ...this.state.layout, sizes: { ...this.state.layout.sizes, [sessionId]: size } })
    this.queueLayout()
  }
  moveCatalogViewport = (viewport: M.Viewport): void => {
    this.viewportDirty = true
    this.publish({ ...this.state, layout: { ...this.state.layout, viewport } })
    this.queueLayout()
  }
  bringSessionRootToFront = (sessionId: string): void => {
    if (this.disposed || this.state.busy || !this.state.sessions.some(session => session.sessionId === sessionId)) return
    const zIndices = { ...this.state.layout.zIndices }
    const highest = Math.max(0, ...Object.values(zIndices))
    if (highest >= 1_000_000) {
      Object.entries(zIndices).sort((left, right) => left[1] - right[1]).forEach(([id], index) => {
        zIndices[id] = index + 1; this.dirtyRootZIds.add(id)
      })
    }
    zIndices[sessionId] = Math.max(0, ...Object.values(zIndices)) + 1
    this.dirtyRootZIds.add(sessionId)
    this.commitLayout({ ...this.state.layout, zIndices })
    this.queueLayout()
  }
  changeRootLayer = (sessionId: string, action: LayerAction): void => {
    if (this.disposed || this.state.busy || !this.state.sessions.some(session => session.sessionId === sessionId)) return
    const roots = this.state.sessions.map(session => ({ id: session.sessionId, zIndex: this.state.layout.zIndices?.[session.sessionId] }))
    const changed = changeLayer(roots, sessionId, action)
    const zIndices = { ...this.state.layout.zIndices }
    for (const root of changed) {
      const zIndex = root.zIndex ?? 0
      if (zIndices[root.id] !== zIndex) { zIndices[root.id] = zIndex; this.dirtyRootZIds.add(root.id) }
    }
    this.commitLayout({ ...this.state.layout, zIndices })
    this.queueLayout()
  }
  changeRootLayers = (sessionIds:readonly string[],action:LayerAction):void => {
    if(this.disposed||this.state.busy)return
    const ids=sessionIds.filter(id=>this.state.sessions.some(session=>session.sessionId===id));if(!ids.length)return
    const roots=this.state.sessions.map(session=>({id:session.sessionId,zIndex:this.state.layout.zIndices?.[session.sessionId]}))
    const changed=changeLayers(roots,ids,action),zIndices={...this.state.layout.zIndices}
    for(const root of changed){const zIndex=root.zIndex??0;if(zIndices[root.id]!==zIndex){zIndices[root.id]=zIndex;this.dirtyRootZIds.add(root.id)}}
    this.commitLayout({...this.state.layout,zIndices});this.queueLayout()
  }
  private queueLayout(): void {
    this.layoutDirty = true
    if (this.layoutTimer) clearTimeout(this.layoutTimer)
    this.layoutTimer = setTimeout(() => { void this.saveLayout() }, 250)
  }
  private layoutFacts(layout:M.CatalogLayout):string { return JSON.stringify({positions:layout.positions,sizes:layout.sizes??{},zIndices:layout.zIndices??{},groups:layout.groups??[]}) }
  private commitLayout(layout:M.CatalogLayout,record=true):void {
    const before=this.state.layout
    if(record&&this.layoutFacts(before)!==this.layoutFacts(layout)){
      this.catalogPast.push({before:structuredClone(before),after:structuredClone(layout)});if(this.catalogPast.length>80)this.catalogPast.shift();this.catalogFuture.length=0
    }
    this.publish({...this.state,layout})
  }
  changeCatalogGroups = (groups:readonly M.WorkflowGroup[]):void => {
    if(this.disposed||this.state.busy)return
    const raw=groups.map(group=>({...group,nodeIds:group.nodeIds.map(id=>id.startsWith('catalog:')?id.slice(8):id)}))
    const previous=this.state.layout.groups??[]
    for(const id of new Set([...previous.map(group=>group.id),...raw.map(group=>group.id)]))if(JSON.stringify(previous.find(group=>group.id===id))!==JSON.stringify(raw.find(group=>group.id===id)))this.dirtyGroupIds.add(id)
    this.commitLayout({...this.state.layout,groups:raw});this.queueLayout()
  }
  canvasCommand = (command:CanvasCommand,context:CanvasCommandContext):readonly string[]|void => {
    if(this.disposed||this.state.busy)return
    if(this.state.catalogMode){
      if(command!=='undo'&&command!=='redo')throw new Error('原生对话根节点保持原身份；请进入工作流复制或剪切任务。')
      const source=command==='undo'?this.catalogPast:this.catalogFuture,target=command==='undo'?this.catalogFuture:this.catalogPast,entry=source.at(-1)
      if(!entry)return
      const from=command==='undo'?entry.after:entry.before,to=command==='undo'?entry.before:entry.after
      if(this.layoutFacts(this.state.layout)!==this.layoutFacts(from))throw new Error('会话画布已由其他操作更新，无法撤销旧步骤。')
      const live=this.state.layout
      for(const id of new Set([...Object.keys(live.positions),...Object.keys(to.positions)]))if(JSON.stringify(live.positions[id])!==JSON.stringify(to.positions[id]))this.dirtyRootIds.add(id)
      for(const id of new Set([...Object.keys(live.sizes??{}),...Object.keys(to.sizes??{})]))if(JSON.stringify(live.sizes?.[id])!==JSON.stringify(to.sizes?.[id]))this.dirtyRootSizeIds.add(id)
      for(const id of new Set([...Object.keys(live.zIndices??{}),...Object.keys(to.zIndices??{})]))if(live.zIndices?.[id]!==to.zIndices?.[id])this.dirtyRootZIds.add(id)
      for(const id of new Set([...(live.groups??[]).map(group=>group.id),...(to.groups??[]).map(group=>group.id)]))if(JSON.stringify(live.groups?.find(group=>group.id===id))!==JSON.stringify(to.groups?.find(group=>group.id===id)))this.dirtyGroupIds.add(id)
      source.pop();target.push(entry);this.commitLayout({...structuredClone(to),revision:live.revision,viewport:live.viewport},false);this.queueLayout();return
    }
    if(command==='undo'){this.graphs.undo();return}
    if(command==='redo'){this.graphs.redo();return}
    const workflow=this.current()
    if(command==='copy'){copyGraph(workflow,context.nodeIds);return}
    if(command==='cut'){this.graphs.change(cutGraph(workflow,context.nodeIds));return []}
    if(command==='delete'){this.graphs.change(hideGraphNodes(workflow,context.nodeIds));return []}
    if(command==='restore'){this.graphs.change(restoreGraphNodes(workflow));return}
    if(command==='duplicate'){const duplicated=duplicateGraph(workflow,context.nodeIds);this.graphs.change(duplicated.workflow);return duplicated.nodeIds}
    const pasted=pasteGraph(workflow,context.position??{x:100,y:100});this.graphs.change(pasted.workflow);return pasted.nodeIds
  }
  private async saveLayout(): Promise<void> {
    if (this.disposed || this.layoutFlight || !this.layoutDirty) return
    this.layoutFlight = true
    const layout = this.state.layout
    let saveNewer = false
    try {
      const value = this.value(await this.api.saveCatalogLayout({ layout, expectedRevision: layout.revision }))
      if (!value.ok) {
        const positions = { ...value.layout.positions }
        const zIndices = { ...value.layout.zIndices }
        const sizes = { ...value.layout.sizes }
        for (const id of this.dirtyRootIds) {if (this.state.layout.positions[id]) positions[id] = this.state.layout.positions[id]!;else delete positions[id]}
        for (const id of this.dirtyRootZIds) {if (this.state.layout.zIndices?.[id] !== undefined) zIndices[id] = this.state.layout.zIndices[id]!;else delete zIndices[id]}
        for (const id of this.dirtyRootSizeIds) {if (this.state.layout.sizes?.[id]) sizes[id] = this.state.layout.sizes[id]!;else delete sizes[id]}
        const localGroups=(this.state.layout.groups??[]).filter(group=>this.dirtyGroupIds.has(group.id)),claimed=new Set(localGroups.flatMap(group=>group.nodeIds))
        const groups=[...(value.layout.groups??[]).filter(group=>!this.dirtyGroupIds.has(group.id)).map(group=>({...group,nodeIds:group.nodeIds.filter(id=>!claimed.has(id))})).filter(group=>group.nodeIds.length),...localGroups]
        this.publish({ ...this.state, layout: { ...value.layout, positions, zIndices, sizes,groups,
          viewport: this.viewportDirty ? this.state.layout.viewport : value.layout.viewport } })
        throw new Error('会话布局已被其他窗口更新。本地位置和尺寸已保留，点击重试保存。')
      }
      const newer = this.state.layout !== layout
      for (const id of this.dirtyRootIds) if (this.state.layout.positions[id] === layout.positions[id]) this.dirtyRootIds.delete(id)
      for (const id of this.dirtyRootZIds) if (this.state.layout.zIndices?.[id] === layout.zIndices?.[id]) this.dirtyRootZIds.delete(id)
      for (const id of this.dirtyRootSizeIds) if (this.state.layout.sizes?.[id] === layout.sizes?.[id]) this.dirtyRootSizeIds.delete(id)
      for (const id of this.dirtyGroupIds) if (JSON.stringify(this.state.layout.groups?.find(group=>group.id===id))===JSON.stringify(layout.groups?.find(group=>group.id===id))) this.dirtyGroupIds.delete(id)
      if (this.state.layout.viewport === layout.viewport) this.viewportDirty = false
      this.layoutDirty = newer
      this.publish({ ...this.state, layout: newer ? { ...this.state.layout, revision: value.layout.revision } : value.layout })
      saveNewer = newer
    } catch (error) { this.publish({ ...this.state, error: this.errorText(error) }) }
    finally { this.layoutFlight = false }
    if (saveNewer) await this.saveLayout()
  }
  retry = async (): Promise<void> => {this.clearConnection();if (this.layoutDirty) await this.saveLayout(); if (!this.layoutDirty) await this.refresh(true) }
  private clearConnection():void{++this.connectionVersion;++this.modelsVersion;this.capabilityFlight=undefined;this.compatibilityError=undefined;this.publish({...this.state,runtimeReady:undefined})}
  resetConnection = ():void=>{this.clearConnection();void this.refresh(true)}
  presentation(): WorkflowRuntimeProps & Pick<WorkflowPanelProps,'onCanvasCommand'|'canUndo'|'canRedo'|'catalogGroups'|'onChangeCatalogGroups'> {
    const active = this.graphs.getSnapshot().workflows.find(item => item.id === this.graphs.getSnapshot().activeWorkflowId)
    const effectiveModel=active?.settings?.model??this.state.defaultModel
    return {
      contextUsage:this.state.contextUsage,contextLoading:this.state.contextLoading,contextError:this.state.contextError,compacting:this.state.compacting,
      onContextTarget:this.selectContextTarget,onCompactContext:this.api.compactContext?this.compactContext:undefined,
      skillOptions:this.state.skillOptions,skillsLoading:this.state.skillsLoading,skillsError:this.state.skillsError,onReloadSkills:this.reloadSkills,
      traces:this.state.traces,onWatchTraceRuns:this.watchTraceRuns,
      preferences:active?.preferences,onChangePreferences:this.changePreferences,onTestSound:this.testSound,
      accessModes:this.state.accessModes,accessMode:active?.settings?.accessMode,defaultAccessMode:this.state.defaultAccessMode,accessModesLoading:this.state.accessModesLoading,accessModesError:this.state.accessModesError,onSelectAccessMode:this.api.setAccessMode?this.selectAccessMode:undefined,onReloadAccessModes:this.reloadAccessModes,
      workspaceOptions:this.state.workspaceOptions,workspaceId:active?.workspaceId,workspacesLoading:this.state.workspacesLoading,workspacesError:this.state.workspacesError,onSelectWorkspace:this.api.setWorkspace?this.selectWorkspace:undefined,onReloadWorkspaces:this.reloadWorkspaces,
      onOrganizeSessionNames:this.api.organizeSessionNames?this.organizeSessionNames:undefined,
      sessionNamingNotice:this.state.sessionNamingNotice,
      pendingApprovals:this.state.pendingApprovals.filter(item=>item.workflowId===active?.id),submittingApprovalKeys:this.state.submittingApprovalKeys,approvalErrors:this.state.approvalErrors,approvalLoadError:this.state.approvalLoadError,onDecideApproval:this.api.answerApproval?this.decideApproval:undefined,onReloadApprovals:this.refreshApprovals,
      onPauseQuestionAutomation:this.api.pauseQuestionAutomation?this.pauseQuestionAutomation:undefined,
      pendingQuestions:this.state.pendingQuestions.filter(question=>question.workflowId===active?.id),
      submittingQuestionKeys:this.state.submittingQuestionKeys,questionErrors:this.state.questionErrors,questionLoadError:this.state.questionLoadError,
      onReloadQuestions:this.api.questions?this.refreshQuestions:undefined,onAnswerQuestion:this.api.answerQuestion?this.answerQuestion:undefined,
      runtimeReady:this.state.runtimeReady,
      modelOptions:this.state.models.map(item=>({id:JSON.stringify([item.provider,item.model]),label:item.label,provider:item.provider})),modelsLoading:this.state.modelsLoading,modelsError:this.state.modelsError,
      reasoningForOption:this.reasoningControl,onReasoningChange:this.selectGlobalReasoning,reasoningForNodeOption:(nodeId,id)=>this.reasoningControl(id,nodeId),onNodeReasoningChange:this.selectNodeReasoning,
      modelAvailable:!!effectiveModel&&this.state.models.some(item=>item.provider===effectiveModel.provider&&item.model===effectiveModel.model),
      globalModelId:active?.settings?.model?JSON.stringify([active.settings.model.provider,active.settings.model.model]):undefined,
      defaultModelLabel:this.state.defaultModel?(this.state.models.find(item=>item.provider===this.state.defaultModel!.provider&&item.model===this.state.defaultModel!.model)?.label??this.state.defaultModel.model):undefined,
      onSelectGlobalModel:this.selectGlobalModel,onSelectNodeModel:this.selectNodeModel,onReloadModels:this.reloadModels,
      onUploadFiles:this.uploadFiles,onRemoveFile:this.removeFile,
      planningAttachments:active?.planningAttachments??[],onUploadPlanningFiles:this.uploadPlanningFiles,onRemovePlanningFile:this.removePlanningFile,
      onCanvasCommand:this.canvasCommand,
      canUndo:this.state.catalogMode?this.catalogPast.length>0:this.graphs.getSnapshot().canUndo,
      canRedo:this.state.catalogMode?this.catalogFuture.length>0:this.graphs.getSnapshot().canRedo,
      catalogGroups:(this.state.layout.groups??[]).map(group=>({...group,nodeIds:group.nodeIds.map(id=>`catalog:${id}`)})),onChangeCatalogGroups:this.changeCatalogGroups,
      sessionRoots: this.state.sessions.map(session => ({ ...session, status: session.running ? 'running' : 'idle', position: this.state.layout.positions[session.sessionId], zIndex: this.state.layout.zIndices?.[session.sessionId], ...this.state.layout.sizes?.[session.sessionId] })),
      catalogMode: this.state.catalogMode, catalogLoading: this.state.catalogLoading, busy: this.state.busy,
      catalogViewport: this.state.layout.viewport, onMoveCatalogViewport: this.moveCatalogViewport,
      generationMode: active?.settings?.generation, executionMode: active?.settings?.execution,
      subagentMode:active?.settings?.subagents??'off',onChangeSubagentMode:this.selectSubagentMode,
      onChangePolicies: (generation, execution) => { const workflow = this.current(); this.graphs.change({ ...workflow, settings: { ...workflow.settings,generation, execution } }) },
      branches: active?.branches ?? [], activeBranchId: active?.activeBranchId ?? null, executions: active?.executions ?? [],
      plans: (active?.plans ?? []).map(plan => ({ ...plan, submitted:(active?.operations??[]).some(operation=>operation.kind==='plan'&&operation.runId===plan.requestId&&operation.status==='completed'), tasks: plan.tasks.map(task => ({ ...task, dependencies: task.dependsOn })) })),
      approvedNodeIds: (active?.nodes ?? []).filter(node => (active?.approvals ?? []).some(approval => approval.nodeId === node.id && approval.nodeRevision === node.revision && approval.decision === 'approved')).map(node => node.id),
      trace: this.state.trace,
      onShowCatalog: this.showCatalog, onMoveSessionRoot: this.moveRoot, onImportSession: this.importSession,
      onResizeSessionRoot: this.resizeRoot,
      onMoveSessionRoots: this.moveRoots, onDeleteWorkflow: this.deleteWorkflow,
      onPreviewSessionArchive:this.api.previewSessionArchive?this.previewSessionArchive:undefined,onArchiveSessionHistory:this.api.archiveSessionHistory?this.archiveSessionHistory:undefined,
      onBringSessionRootToFront: this.bringSessionRootToFront,
      onChangeSessionRootLayer: this.changeRootLayer,onChangeSessionRootLayers:this.changeRootLayers,
      onSelectBranch: this.selectBranch, onSelectExecution: runId => { void this.readTrace(runId) },
      onReadTrace: this.readTrace, onReadStep: this.readStep,
      onApproveNode: nodeId => this.approve(nodeId, true), onRejectNode: nodeId => this.approve(nodeId, false),
      onRunNode: this.run, onRunNodes: this.runNodes, onCancelExecution: this.cancel, onPauseAll:this.api.pauseAll?this.pauseAll:undefined, onForkExecution: this.forkExecution, onForkSession: this.forkSession,
      onGeneratePlan: this.generatePlan, onApplyPlan: this.applyPlan, onRejectPlan: this.rejectPlan,
    }
  }
  dispose(): void { this.disposed = true; if (this.timer) clearTimeout(this.timer); if (this.layoutTimer) clearTimeout(this.layoutTimer);globalThis.document?.removeEventListener('pointerdown',this.sounds.unlock);globalThis.document?.removeEventListener('keydown',this.sounds.unlock);this.sounds.dispose(); this.listeners.clear(); ++this.traceVersion }
  private isMissingEndpoint(error:unknown):boolean{const text=error instanceof Error?error.message:String(error);return /(?:HTTP\s*404|not found)/i.test(text)&&/visualWorkflow/i.test(text)}
  private errorText(error: unknown): string { return this.isMissingEndpoint(error)?'Workflow 后台尚未加载此功能。请完全退出 DeepSeek Harness（包括托盘后台）后重新启动，再点击重试；本次操作未自动重发。':error instanceof Error ? error.message : String(error) }
}
