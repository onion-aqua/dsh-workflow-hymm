/** Replayable projection of native observable facts. No model reasoning is exposed. */
import type { NativeEvent, NativeSessionLog } from './native-runtime.ts';

export type NativeExecutionStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled' | 'blocked' | 'interrupted' | 'unknown';
export interface NativeTraceStep {
  stepId: string; eventStartSeq: number; eventEndSeq?: number;
  type: 'agent_step' | 'tool_call' | 'command' | 'file_operation' | 'approval' | 'error';
  title: string; status: NativeExecutionStatus; timestamp: number;
  toolName?: string; callId?: string; parentStepId?: string;
  actionKind?: 'read' | 'edit' | 'write' | 'command' | 'search' | 'fetch' | 'tool';
  /** Bounded display-only argument preview, rebuilt from native events on demand. */
  target?: string;
}
export interface NativeExecutionProjection {
  status: NativeExecutionStatus; terminalReason?: string; startSeq?: number; endSeq?: number;
  turns: number[]; steps: NativeTraceStep[]; assistantText: string; cursor: number;
}
export interface NativeProjectionIdentity { runId: string; requestId: string; startSeq?: number; running?: boolean; messageId?:string }
export interface ExecutionStepDetails {
  eventName: string; time: number; status: NativeExecutionStatus;
  toolName?: string; input?: string; command?: string; output?: string; error?: string; truncated: boolean;
}
const DETAIL_LIMIT = 200_000;
const SUMMARY_LIMIT = 4000;
const TARGET_LIMIT = 240;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const reasonKind = (event: NativeEvent): string | undefined => string(object(event.data.reason).kind);

/** Only explicit text blocks are visible; raw streams, reasoning and replay metadata never enter this path. */
export function observableText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.map(item => object(item)).filter(item => item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text as string).join('\n');
}
function requestIdOf(message: unknown): string | undefined {
  const source = object(object(message).source);
  return source.kind === 'user' ? string(source.rpcId) : undefined;
}
function contentOf(event: NativeEvent): unknown { return object(event.data.message).content ?? event.data.content; }
function ownedTurns(log: NativeSessionLog, identity: NativeProjectionIdentity): Set<number> {
  const turns = new Set<number>();
  const questions = new Set<string>();
  let turn: number | undefined;
  const lower = Math.max(log.inheritedEventCount, identity.startSeq ?? 0);
  for (const event of log.events) {
    if (event.seq < lower) continue;
    if (event.type === 'turn/start') turn = number(event.data.turn);
    const source = object(event.data.source);
    if (event.type === 'user/message' && (requestIdOf(event.data) === identity.requestId || identity.messageId !== undefined && source.kind === 'user' && event.data.id === identity.messageId || source.kind === 'user-question-reply' && source.outcome === 'answered' && questions.has(String(source.callId))) && turn !== undefined) turns.add(turn);
    // rc.3 late question replies start another native turn. Only an explicit
    // reply to this execution's own native question may extend its identity.
    if (turn !== undefined && turns.has(turn) && event.data.name === 'ask_user_question') {
      const callId = event.type === 'tool/call' ? string(event.data.callId)
        : event.type === 'tool/ptc-dispatch-start' || event.type === 'tool/ptc-dispatch' ? string(event.data.subCallId) : undefined;
      if (callId) questions.add(callId);
    }
    if (event.type === 'turn/end') turn = undefined;
  }
  return turns;
}
function eventTurn(event: NativeEvent, current: number | undefined): number | undefined { return number(event.data.turn) ?? current; }
function terminalStatus(reason: string | undefined): NativeExecutionStatus {
  switch (reason) {
    case 'completed': return 'completed';
    case 'aborted': return 'cancelled';
    case 'blocked': return 'blocked';
    case 'interrupted': case 'forked': return 'interrupted';
    case 'error': case 'max-tokens': return 'failed';
    default: return 'unknown';
  }
}
function toolType(name: string): NativeTraceStep['type'] {
  if (['bash', 'pwsh'].includes(name)) return 'command';
  if (['read', 'read_image', 'write', 'edit', 'str_replace_editor'].includes(name)) return 'file_operation';
  return 'tool_call';
}
function titleForTool(name: string): string { return name || 'Tool invocation'; }
function bounded(text: string, limit: number): string {
  const suffix='\n[Recorded text truncated in this view]';
  return text.length>limit?`${text.slice(0,Math.max(0,limit-suffix.length))}${suffix.slice(0,limit)}`:text;
}
function toolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return object(raw);
  try { return object(JSON.parse(raw)); } catch { return {}; }
}
function targetPreview(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if (text.length <= TARGET_LIMIT) return text;
  let end = TARGET_LIMIT - 1;
  // Bound the wire string without cutting a UTF-16 surrogate pair in half.
  if (text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
  return `${text.slice(0, end).trimEnd()}…`;
}
function toolAction(name: string, raw: unknown, declarations: ReadonlyMap<string, Record<string, unknown>>): Pick<NativeTraceStep, 'actionKind' | 'target'> {
  const args = toolArguments(raw);
  let actionKind: NativeTraceStep['actionKind'] = 'tool';
  let value: unknown;
  // Released rc.3 tool-fs uses file_path; str_replace_editor alone uses path.
  if (name === 'read' || name === 'read_image') { actionKind = 'read'; value = args.file_path; }
  else if (name === 'edit' || name === 'write') { actionKind = name; value = args.file_path; }
  else if (name === 'bash' || name === 'pwsh') { actionKind = 'command'; value = args.command; }
  else if (name === 'str_replace_editor') {
    if (args.command === 'view') actionKind = 'read';
    else if (args.command === 'create') actionKind = 'write';
    else if (args.command === 'str_replace' || args.command === 'insert') actionKind = 'edit';
    if (actionKind !== 'tool') value = args.path;
  } else if (name === 'web_search' || name === 'web_fetch') {
    actionKind = name === 'web_search' ? 'search' : 'fetch';
    const field = name === 'web_search' ? 'query' : 'url';
    // No web implementation is installed in this rc.3 assembly. Dynamic tools
    // may declare them, so require the exact native request's string schema;
    // never guess a query/url from arbitrary nested arguments or output.
    const properties = object(object(declarations.get(name)?.parameters).properties);
    if (object(properties[field]).type === 'string') value = args[field];
  }
  const target = targetPreview(value);
  return { actionKind, ...(target ? { target } : {}) };
}

/** Rebuild exactly the turns claiming this persisted rpcId; inherited seeds are never counted twice. */
export function projectExecution(log: NativeSessionLog, identity: NativeProjectionIdentity): NativeExecutionProjection {
  const turns = ownedTurns(log, identity);
  const steps = new Map<string, NativeTraceStep>();
  const result: NativeExecutionProjection = { status: 'queued', turns: [...turns], steps: [], assistantText: '', cursor: log.events.at(-1)?.seq ?? -1 };
  let currentTurn: number | undefined;
  let currentStep: number | undefined;
  let lastTerminal: NativeEvent | undefined;
  let declarations = new Map<string, Record<string, unknown>>();
  const prefix = `${identity.runId}:`;
  const lower = Math.max(log.inheritedEventCount, identity.startSeq ?? 0);
  const put = (id: string, event: NativeEvent, fields: Omit<NativeTraceStep, 'stepId' | 'eventStartSeq' | 'timestamp'>) => {
    const prior = steps.get(id);
    const next = { ...fields, stepId: id, eventStartSeq: prior?.eventStartSeq ?? event.seq, timestamp: prior?.timestamp ?? event.time };
    if (prior) Object.assign(prior, fields); else steps.set(id, next);
    return steps.get(id)!;
  };
  for (const event of log.events) {
    if (event.type === 'request/header') {
      // Each native request/header is a complete snapshot, including absence
      // of tools. Fold inherited snapshots too without projecting their steps.
      const tools = object(event.data.header).tools;
      declarations = new Map(Array.isArray(tools) ? tools.map(object).filter(tool => typeof tool.name === 'string')
        .map(tool => [tool.name as string, tool]) : []);
    }
    if (event.seq < lower) continue;
    if (event.type === 'turn/start') { currentTurn = number(event.data.turn); currentStep = undefined; }
    if (event.type === 'step/start') currentStep = number(event.data.step);
    const turn = eventTurn(event, currentTurn);
    if (turn !== undefined && turns.has(turn)) {
      if (result.startSeq === undefined) result.startSeq = event.seq;
      result.status = 'running';
      const stepNumber = number(event.data.step) ?? currentStep;
      const agentStepId = `${prefix}step:${turn}:${stepNumber}`;
      const data = event.data;
      if (event.type === 'step/start') put(agentStepId, event, { type: 'agent_step', title: `Agent step ${String(stepNumber)}`, status: 'running' });
      if (event.type === 'step/end') {
        const existing = steps.get(agentStepId);
        if (existing) { existing.eventEndSeq = event.seq; existing.status = 'completed'; }
      }
      if (event.type === 'assistant/message') result.assistantText += `${result.assistantText ? '\n' : ''}${observableText(contentOf(event))}`;
      if (event.type === 'tool/call') {
        const callId = string(data.callId);
        const name = string(data.name) ?? '';
        if (callId) put(`${prefix}tool:${callId}`, event, { type: toolType(name), title: titleForTool(name), status: 'running', toolName: name, callId, parentStepId: agentStepId, ...toolAction(name, data.arguments, declarations) });
      }
      if (event.type === 'tool/result') {
        const message = object(data.message);
        const callId = string(message.toolCallId) ?? string(object(message.source).callId);
        if (callId) {
          const id = `${prefix}tool:${callId}`;
          const prior = steps.get(id);
          const next = put(id, event, { type: prior?.type ?? 'tool_call', title: prior?.title ?? 'Tool result', status: message.isError === true ? 'failed' : 'completed', callId,
            ...(prior?.toolName ? { toolName: prior.toolName } : {}), parentStepId: agentStepId });
          next.eventEndSeq = event.seq;
        }
      }
      if (event.type === 'tool/ptc-dispatch-start' || event.type === 'tool/ptc-dispatch') {
        const callId = string(data.subCallId);
        const name = string(data.name) ?? '';
        const parent = string(data.parentCallId);
        if (callId) {
          const next = put(`${prefix}ptc:${callId}`, event, { type: toolType(name), title: titleForTool(name), status: event.type === 'tool/ptc-dispatch-start' ? 'running' : data.isError === true ? 'failed' : 'completed', toolName: name, callId,
            ...toolAction(name, data.arguments, declarations),
            ...(parent ? { parentStepId: steps.has(`${prefix}ptc:${parent}`) ? `${prefix}ptc:${parent}` : `${prefix}tool:${parent}` } : {}) });
          if (event.type === 'tool/ptc-dispatch') next.eventEndSeq = event.seq;
        }
      }
      if (event.type === 'approval/asked') {
        const approvalId = string(data.id);
        if (approvalId) put(`${prefix}approval:${approvalId}`, event, { type: 'approval', title: `Approval: ${string(data.toolName) ?? 'tool'}`, status: 'waiting_approval',
          ...(string(data.toolName) ? { toolName: string(data.toolName)! } : {}), ...(string(data.callId) ? { callId: string(data.callId)! } : {}), parentStepId: agentStepId });
      }
      if (event.type === 'approval/decided') {
        const approval = steps.get(`${prefix}approval:${String(data.id)}`);
        if (approval) { approval.eventEndSeq = event.seq; approval.status = data.outcome === 'allowed-once' ? 'completed' : data.outcome === 'rejected' || data.outcome === 'unavailable' ? 'blocked' : data.outcome === 'cancelled' ? 'cancelled' : 'unknown'; }
      }
      if (event.type === 'turn/end') {
        lastTerminal = event; result.endSeq = event.seq; result.terminalReason = reasonKind(event); result.status = terminalStatus(result.terminalReason);
        if (result.status === 'failed') put(`${prefix}error:${event.seq}`, event, { type: 'error', title: 'Execution error', status: 'failed', eventEndSeq: event.seq });
      }
    }
    if (event.type === 'turn/end') { currentTurn = undefined; currentStep = undefined; }
  }
  // Opening a later owned turn invalidates an earlier completion until it settles.
  if (turns.size && lastTerminal && log.events.some(event => event.seq > lastTerminal!.seq && event.type === 'turn/start' && turns.has(Number(event.data.turn)))) {
    delete result.endSeq; delete result.terminalReason; result.status = identity.running ? 'running' : 'unknown';
  }
  if (turns.size && !lastTerminal) result.status = identity.running ? 'running' : 'unknown';
  if (result.status === 'running' && [...steps.values()].some(step => step.type === 'approval' && step.status === 'waiting_approval')) result.status = 'waiting_approval';
  for (const step of steps.values()) {
    if (step.status === 'running' || step.status === 'waiting_approval') {
      if (result.endSeq !== undefined) step.status = result.status === 'completed' ? 'unknown' : result.status;
      else if (!identity.running && turns.size) step.status = 'unknown';
    }
  }
  result.steps = [...steps.values()].sort((a, b) => a.eventStartSeq - b.eventStartSeq || a.stepId.localeCompare(b.stepId));
  result.assistantText = bounded(result.assistantText, SUMMARY_LIMIT);
  return result;
}

/** Complete observable final text for structured plan parsing, never assistant.stream. */
export function assistantTextForRequest(log: NativeSessionLog, requestId: string): string {
  const turns = ownedTurns(log, { runId: '', requestId });
  return bounded(log.events.filter(event => event.type === 'assistant/message' && turns.has(Number(event.data.turn)))
    .map(event => observableText(contentOf(event))).join('\n'), DETAIL_LIMIT);
}

/** Read details from the native events when expanded; callers must not save this response in Workflow JSON. */
export function readTraceStepDetails(log: NativeSessionLog, projection: NativeExecutionProjection, stepId: string): ExecutionStepDetails {
  const step = projection.steps.find(item => item.stepId === stepId);
  if (!step) throw new Error('Execution step does not belong to this native event projection');
  const first = log.events.find(event => event.seq === step.eventStartSeq);
  const last = log.events.find(event => event.seq === step.eventEndSeq);
  if (!first) throw new Error('Referenced native event is unavailable');
  const detail: ExecutionStepDetails = { eventName: first.type, time: first.time, status: step.status, truncated: false,
    ...(step.toolName ? { toolName: step.toolName } : {}) };
  if (first.type === 'tool/call' || first.type === 'tool/ptc-dispatch-start' || first.type === 'tool/ptc-dispatch') {
    const raw = first.data.arguments;
    detail.input = typeof raw === 'string' ? raw : raw === undefined ? undefined : JSON.stringify(raw, null, 2);
    if (step.type === 'command') {
      let args = object(raw);
      if (typeof raw === 'string') { try { args = object(JSON.parse(raw)); } catch { /* Unparsed arguments remain visible as recorded input. */ } }
      detail.command = string(args.command) ?? string(args.cmd);
    }
  }
  if (last?.type === 'tool/result') {
    detail.output = observableText(object(last.data.message).content);
    const error = object(last.data.error);
    if (Object.keys(error).length) detail.error = string(error.reason) ?? string(error.code) ?? string(error.name);
  }
  if (last?.type === 'tool/ptc-dispatch' || first.type === 'tool/ptc-dispatch') {
    const result = last?.type === 'tool/ptc-dispatch' ? last : first;
    detail.output = observableText(result.data.content);
    if (result.data.isError === true) detail.error = string(object(result.data.error).reason) ?? string(object(result.data.error).message) ?? 'Tool reported failure';
  }
  if (first.type === 'approval/asked') {
    detail.input = string(first.data.reason);
    detail.output = last?.type === 'approval/decided' ? string(last.data.outcome) : undefined;
  }
  if (first.type === 'turn/end') {
    const reason = object(first.data.reason); const error = object(reason.error);
    detail.error = string(error.message) ?? string(reason.kind);
  }
  for (const key of ['input', 'command', 'output', 'error'] as const) {
    const value = detail[key];
    if (value && value.length > DETAIL_LIMIT) { detail[key] = bounded(value, DETAIL_LIMIT); detail.truncated = true; }
  }
  return detail;
}
