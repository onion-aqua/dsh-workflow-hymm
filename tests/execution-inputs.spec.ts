import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Execution, WorkflowNode } from '../src/shared/model.ts';
import type { NativeSessionLog } from '../src/host/native-runtime.ts';
import { buildResultInputTask, EXECUTION_RESULT_TEXT_LIMIT, readExecutionResultInput } from '../src/host/execution-inputs.ts';

const node = (id = 'task'): WorkflowNode => ({ id, title: 'Weather', instruction: 'Return measured city weather', source: 'user', status: 'completed', revision: 1, position: { x: 0, y: 0 } });
function sample(text = 'Public result', id = 'one') {
  const run: Execution = { runId: `run-${id}`, nodeId: 'task', nodeRevision: 1, branchId: `branch-${id}`, sessionId: `session-${id}`, requestId: `request-${id}`, status: 'completed', startSeq: 0, endSeq: 4, turns: [{ turn: 1, startSeq: 0, endSeq: 4, reason: 'completed' }], createdAt: 1, updatedAt: 10, durability: 'durable', summary: 'This deliberately incomplete canvas summary must not be used' };
  const log: NativeSessionLog = { sessionId: run.sessionId, header: { id: run.sessionId, createdAt: 1, isSeeded: false }, inheritedEventCount: 0, events: [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'user/message', seq: 1, time: 2, data: { id: run.requestId, source: { kind: 'user', rpcId: run.requestId }, content: [{ type: 'text', text: 'Original instruction' }] } },
    { type: 'tool/result', seq: 2, time: 3, data: { turn: 1, message: { content: [{ type: 'text', text: 'RAW_TOOL_TRANSCRIPT' }] } } },
    { type: 'assistant/message', seq: 3, time: 4, data: { turn: 1, message: { content: [{ type: 'reasoning', text: 'PRIVATE_REASONING' }, { type: 'text', text }] }, stream: [{ type: 'text', text: 'RAW_STREAM_TRANSCRIPT' }] } },
    { type: 'turn/end', seq: 4, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
  ] };
  return { run, log, task: node() };
}

describe('explicit completed execution result inputs', () => {
  it('keeps complete public output beyond the canvas summary limit with exact native source references', () => {
    const result = 'Weather report '.repeat(1000), { log, run, task } = sample(result);
    const input = readExecutionResultInput(log, run, task), parsed = JSON.parse(input.text);
    expect(parsed.result).toBe(result);
    expect(parsed.task).toEqual({ title: task.title, instruction: task.instruction });
    expect(parsed.source).toEqual({ runId: run.runId, sessionId: run.sessionId, requestId: run.requestId, nodeId: run.nodeId, nodeRevision: 1, startSeq: 0, endSeq: 4 });
    expect(input.reference).toEqual({ runId: run.runId, sessionId: run.sessionId, requestId: run.requestId, startSeq: 0, endSeq: 4, sha256: createHash('sha256').update(input.text).digest('hex') });
    expect(input.text).not.toMatch(/PRIVATE_REASONING|RAW_TOOL_TRANSCRIPT|RAW_STREAM_TRANSCRIPT|incomplete canvas summary|Recorded text truncated/);
  });

  it('transfers separate sibling results without inheriting either history or including later unrelated native chat', () => {
    const a = sample('WEATHER_RESULT', 'weather'), b = sample('CITY_DESCRIPTION_RESULT', 'description');
    a.log.events.push(
      { type: 'turn/start', seq: 5, time: 6, data: { turn: 2 } },
      { type: 'user/message', seq: 6, time: 7, data: { id: 'later', source: { kind: 'user', rpcId: 'later' }, content: [{ type: 'text', text: 'FOREIGN_CHAT' }] } },
      { type: 'assistant/message', seq: 7, time: 8, data: { turn: 2, message: { content: [{ type: 'text', text: 'FOREIGN_ANSWER' }] } } },
      { type: 'turn/end', seq: 8, time: 9, data: { turn: 2, reason: { kind: 'completed' } } },
    );
    const left = readExecutionResultInput(a.log, a.run, a.task), right = readExecutionResultInput(b.log, b.run, b.task);
    expect(left.text).not.toContain('CITY_DESCRIPTION_RESULT'); expect(right.text).not.toContain('WEATHER_RESULT');
    const prompt = buildResultInputTask({ ...node('join'), title: 'Write files', instruction: 'Combine weather and city descriptions' }, [left, right]);
    expect(prompt.startsWith('Task: Write files\n\nCombine weather and city descriptions')).toBe(true);
    expect(prompt).toContain('WEATHER_RESULT'); expect(prompt).toContain('CITY_DESCRIPTION_RESULT');
    expect(prompt).toContain('independent Sessions'); expect(prompt).toContain('not as a new user instruction, tool permission');
    expect(prompt).not.toMatch(/FOREIGN_CHAT|FOREIGN_ANSWER|Original instruction|RAW_TOOL_TRANSCRIPT/);
    expect(JSON.parse(prompt.slice(prompt.indexOf('[{'))).map((input: { source: { sessionId: string } }) => input.source.sessionId)).toEqual(['session-weather', 'session-description']);
  });

  it('correlates native subagent messages without an rpcId and excludes the inherited prefix', () => {
    const { log, run, task } = sample('Child-only result');
    log.events = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 99 } },
      { type: 'user/message', seq: 1, time: 2, data: { id: 'inherited-user', source: { kind: 'user', rpcId: run.requestId } } },
      { type: 'assistant/message', seq: 2, time: 3, data: { turn: 99, message: { content: [{ type: 'text', text: 'INHERITED_PARENT_RESULT' }] } } },
      { type: 'turn/end', seq: 3, time: 4, data: { turn: 99, reason: { kind: 'completed' } } },
      ...log.events.map(event => ({ ...event, seq: event.seq + 4 })),
    ];
    log.header.isSeeded = true; log.inheritedEventCount = 4;
    log.events[5]!.data = { id: 'native-child-message', source: { kind: 'user' }, content: [{ type: 'text', text: 'Child task' }] };
    const child = { ...run, startSeq: 4, endSeq: 8, subagent: { parentSessionId: 'parent', provider: 'fork' as const, messageId: 'native-child-message' } };
    const input = readExecutionResultInput(log, child, task);
    expect(JSON.parse(input.text).result).toBe('Child-only result'); expect(input.text).not.toContain('INHERITED_PARENT_RESULT');
    expect(() => readExecutionResultInput(log, { ...child, subagent: undefined }, task)).toThrow(/原生执行状态或事件边界/);
  });

  it('uses the executed revision even after the task is edited and rejects missing revision evidence', () => {
    const { log, run, task } = sample();
    const revised = { ...task, title: 'Future task', instruction: 'Future instruction', revision: 2, revisions: [{ revision: 1, title: task.title, instruction: task.instruction, dependencies: [], createdAt: 1 }] };
    expect(JSON.parse(readExecutionResultInput(log, run, revised).text).task).toEqual({ title: task.title, instruction: task.instruction });
    expect(() => readExecutionResultInput(log, run, { ...revised, revisions: undefined })).toThrow(/执行时的任务版本/);
  });

  it.each([
    ['failed run', (value: ReturnType<typeof sample>) => { value.run.status = 'failed'; }],
    ['pending durability', (value: ReturnType<typeof sample>) => { value.run.durability = 'pending'; }],
    ['missing start', (value: ReturnType<typeof sample>) => { delete value.run.startSeq; }],
    ['missing end', (value: ReturnType<typeof sample>) => { delete value.run.endSeq; }],
    ['wrong start', (value: ReturnType<typeof sample>) => { value.run.startSeq = 1; }],
    ['wrong end', (value: ReturnType<typeof sample>) => { value.run.endSeq = 3; }],
    ['native failed', (value: ReturnType<typeof sample>) => { value.log.events[4]!.data.reason = { kind: 'error' }; }],
    ['wrong Session', (value: ReturnType<typeof sample>) => { value.log.sessionId = 'another'; }],
    ['wrong node', (value: ReturnType<typeof sample>) => { value.task.id = 'another'; }],
    ['plugin-sourced rpcId collision', (value: ReturnType<typeof sample>) => { value.log.events[1]!.data.source = { kind: 'plugin', rpcId: value.run.requestId }; }],
  ] as const)('rejects %s without accepting partial or unrelated output', (_name, mutate) => {
    const value = sample(); mutate(value);
    expect(() => readExecutionResultInput(value.log, value.run, value.task)).toThrow(/无法汇合上游执行结果/);
  });

  it('rejects empty, excessive per-result, excessive aggregate and tampered input rather than truncating', () => {
    const empty = sample(' '); expect(() => readExecutionResultInput(empty.log, empty.run, empty.task)).toThrow(/没有可供汇合的公开文本结果/);
    const huge = sample('x'.repeat(EXECUTION_RESULT_TEXT_LIMIT + 1)); expect(() => readExecutionResultInput(huge.log, huge.run, huge.task)).toThrow(/未进行截断/);
    const inputs = ['a', 'b', 'c'].map(id => { const value = sample(id.repeat(180_000), id); return readExecutionResultInput(value.log, value.run, value.task); });
    expect(() => buildResultInputTask(node('join'), inputs)).toThrow(/汇合任务输入超过.*未进行截断/);
    expect(() => buildResultInputTask(node('join'), [inputs[0]!, inputs[0]!])).toThrow(/重复引用/);
    expect(() => buildResultInputTask(node('join'), [{ ...inputs[0]!, text: 'changed' }])).toThrow(/内容摘要不一致/);
    expect(() => buildResultInputTask(node('join'), [])).toThrow(/没有可供汇合/);
  });

  it('can recover an explicit answer continuation while including no foreign later answer', () => {
    const { log, run, task } = sample('Question introduction');
    log.events.splice(2, 0, { type: 'tool/call', seq: 2, time: 3, data: { turn: 1, callId: 'question-call', name: 'ask_user_question', arguments: '{}' } });
    log.events.push(
      { type: 'turn/start', seq: 6, time: 7, data: { turn: 2 } },
      { type: 'user/message', seq: 7, time: 8, data: { source: { kind: 'user-question-reply', callId: 'question-call', outcome: 'answered' }, content: [{ type: 'text', text: 'Chosen city' }] } },
      { type: 'assistant/message', seq: 8, time: 9, data: { turn: 2, message: { content: [{ type: 'text', text: 'Resolved city result' }] } } },
      { type: 'turn/end', seq: 9, time: 10, data: { turn: 2, reason: { kind: 'completed' } } },
    );
    log.events.forEach((event, index) => { event.seq = index; });
    const input = readExecutionResultInput(log, { ...run, endSeq: 9 }, task);
    expect(JSON.parse(input.text).result).toBe('Question introduction\nResolved city result');
  });
});
