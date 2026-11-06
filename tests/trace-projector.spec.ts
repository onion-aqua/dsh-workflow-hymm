import { describe, expect, it } from 'vitest';
import { completedBoundary } from '../src/host/native-runtime.ts';
import type { NativeEvent, NativeSessionLog } from '../src/host/native-runtime.ts';
import { assistantTextForRequest, projectExecution, readTraceStepDetails } from '../src/host/trace-projector.ts';

function log(events: Array<[string, Record<string, unknown>]>, inheritedEventCount = 0): NativeSessionLog {
  return { sessionId: 'native-session', header: { id: 'native-session', createdAt: 1, isSeeded: inheritedEventCount > 0 }, inheritedEventCount,
    events: events.map(([type, data], seq) => ({ type, data, seq, time: 1000 + seq })) };
}
function user(rpcId: string) { return { role: 'user', id: rpcId, source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'User task' }] }; }
function assistant(text = 'Visible answer') { return { turn: 1, step: 1, message: { content: [{ type: 'reasoning', text: 'PRIVATE_REASONING' }, { type: 'text', text }] }, stream: [{ type: 'reasoning', text: 'PRIVATE_STREAM' }] }; }
const options = { runId: 'run-1', requestId: 'request-1', running: false };

describe('native execution trace projection', () => {
  it('keeps truncation notices inside the persisted summary size limit',()=>{
    const native=log([['turn/start',{turn:1}],['user/message',user('request-1')],['assistant/message',assistant('Visible output '.repeat(500))],['turn/end',{turn:1,reason:{kind:'completed'}}]]);
    const summary=projectExecution(native,options).assistantText;
    expect(summary).toHaveLength(4000);expect(summary).toContain('[Recorded text truncated in this view]');
    expect(assistantTextForRequest(native,'request-1')).toHaveLength(7500);
  });
  it('correlates by persisted rpcId, filters reasoning, and keeps command/error details native', () => {
    const native = log([
      ['turn/start', { turn: 1 }], ['user/message', user('request-1')], ['step/start', { turn: 1, step: 1 }],
      ['tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'pwsh', arguments: '{"command":"Get-ChildItem"}' }],
      ['tool/result', { turn: 1, step: 1, message: { toolCallId: 'call-1', isError: true, content: [{ type: 'text', text: 'Recorded output' }] }, error: { code: 'EXIT_1', reason: 'Command failed' } }],
      ['assistant/message', assistant()], ['step/end', { turn: 1, step: 1 }], ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
      ['turn/start', { turn: 2 }], ['user/message', user('other-request')], ['assistant/message', { ...assistant('Other answer'), turn: 2 }],
      ['turn/end', { turn: 2, reason: { kind: 'error', error: { message: 'Other failure' } } }],
    ]);
    const projection = projectExecution(native, options);
    expect(projection).toMatchObject({ status: 'completed', turns: [1], endSeq: 7, assistantText: 'Visible answer' });
    expect(projection.steps).toHaveLength(2);
    expect(projection.steps[1]).toMatchObject({ stepId: 'run-1:tool:call-1', type: 'command', status: 'failed', eventStartSeq: 3, eventEndSeq: 4, actionKind: 'command', target: 'Get-ChildItem' });
    const details = readTraceStepDetails(native, projection, 'run-1:tool:call-1');
    expect(details).toMatchObject({ input: '{"command":"Get-ChildItem"}', command: 'Get-ChildItem', output: 'Recorded output', error: 'Command failed' });
    expect(JSON.stringify({ projection, details })).not.toMatch(/PRIVATE_|Other answer/);
    expect(assistantTextForRequest(native, 'request-1')).toBe('Visible answer');
  });

  it('does not attribute shared inherited events to a child execution', () => {
    const native = log([
      ['turn/start', { turn: 1 }], ['user/message', user('request-1')], ['assistant/message', assistant('Shared source answer')], ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
      ['session/end-seed', { inherited: true }], ['turn/start', { turn: 2 }], ['user/message', user('child-request')],
      ['step/start', { turn: 2, step: 1 }], ['assistant/message', { ...assistant('Child answer'), turn: 2 }], ['step/end', { turn: 2, step: 1 }], ['turn/end', { turn: 2, reason: { kind: 'completed' } }],
    ], 4);
    const projection = projectExecution(native, { runId: 'child', requestId: 'child-request' });
    expect(projection).toMatchObject({ turns: [2], assistantText: 'Child answer', status: 'completed' });
    expect(projectExecution(native, options).steps).toEqual([]);
  });

  it('does not correlate a plugin-sourced message by a coincidental rpcId', () => {
    const native = log([
      ['turn/start', { turn: 1 }], ['user/message', { ...user('request-1'), source: { kind: 'plugin', rpcId: 'request-1' } }],
      ['assistant/message', assistant('Unrelated text')], ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ]);
    expect(projectExecution(native, options)).toMatchObject({ turns: [], assistantText: '', status: 'queued', steps: [] });
    expect(assistantTextForRequest(native, 'request-1')).toBe('');
  });

  it('keeps unavailable native approvals fail closed', () => {
    const native = log([
      ['turn/start', { turn: 1 }], ['user/message', user('request-1')],
      ['approval/asked', { id: 'approval-1', toolName: 'write' }],
      ['approval/decided', { id: 'approval-1', outcome: 'unavailable' }],
    ]);
    expect(projectExecution(native, { ...options, running: true }).steps[0]).toMatchObject({ type: 'approval', status: 'blocked' });
  });

  it('preserves pending approval while running and marks an orphaned observation unknown', () => {
    const native = log([
      ['turn/start', { turn: 1 }], ['user/message', user('request-1')], ['step/start', { turn: 1, step: 1 }],
      ['approval/asked', { id: 'approval-1', toolName: 'write', callId: 'call-1', reason: 'Write requested' }],
    ]);
    expect(projectExecution(native, { ...options, running: true }).status).toBe('waiting_approval');
    const orphaned = projectExecution(native, options);
    expect(orphaned.status).toBe('unknown');
    expect(orphaned.steps.find(step => step.type === 'approval')?.status).toBe('unknown');
    native.events.push({ seq: 4, time: 1004, type: 'approval/decided', data: { id: 'approval-1', outcome: 'allowed-once' } });
    expect(projectExecution(native, { ...options, running: true }).status).toBe('running');
  });

  it.each(['aborted', 'blocked', 'error', 'max-tokens', 'interrupted', 'forked', 'future-reason'])('retains native terminal reason %s without inventing success', reason => {
    const native = log([['turn/start', { turn: 1 }], ['user/message', user('request-1')], ['turn/end', { turn: 1, reason: { kind: reason } }]]);
    const projection = projectExecution(native, options);
    expect(projection.terminalReason).toBe(reason);
    expect(projection.status).not.toBe('completed');
  });

  it('merges native PTC starts/results with stable identities and parent links', () => {
    const native = log([
      ['turn/start', { turn: 1 }], ['user/message', user('request-1')], ['step/start', { turn: 1, step: 1 }],
      ['tool/call', { turn: 1, step: 1, callId: 'root-call', name: 'run_code', arguments: '{}' }],
      ['tool/ptc-dispatch-start', { rootCallId: 'root-call', parentCallId: 'root-call', subCallId: 'sub-1', name: 'read', arguments: { file_path: 'README.md' } }],
      ['tool/ptc-dispatch', { rootCallId: 'root-call', parentCallId: 'root-call', subCallId: 'sub-1', name: 'read', arguments: { file_path: 'README.md' }, content: [{ type: 'text', text: 'Historical file text' }], isError: false }],
      ['step/end', { turn: 1, step: 1 }], ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ]);
    const projection = projectExecution(native, options);
    const sub = projection.steps.find(step => step.callId === 'sub-1')!;
    expect(sub).toMatchObject({ stepId: 'run-1:ptc:sub-1', eventStartSeq: 4, eventEndSeq: 5, parentStepId: 'run-1:tool:root-call', type: 'file_operation', status: 'completed', actionKind: 'read', target: 'README.md' });
    expect(readTraceStepDetails(native, projection, sub.stepId)).toMatchObject({ input: '{\n  "file_path": "README.md"\n}', output: 'Historical file text' });
  });

  it.each([
    ['read', { file_path: 'src/main.ts' }, 'read', 'src/main.ts'],
    ['read_image', { file_path: 'images/diagram.png' }, 'read', 'images/diagram.png'],
    ['edit', { file_path: 'src/main.ts', old_string: 'PRIVATE_OLD', new_string: 'PRIVATE_NEW' }, 'edit', 'src/main.ts'],
    ['write', { file_path: 'notes.txt', content: 'PRIVATE_CONTENT' }, 'write', 'notes.txt'],
    ['bash', { command: 'git\tstatus\n--short', description: 'PRIVATE_DESCRIPTION' }, 'command', 'git status --short'],
    ['pwsh', { command: 'Get-Content README.md' }, 'command', 'Get-Content README.md'],
    ['str_replace_editor', { command: 'view', path: '/repo/a.py' }, 'read', '/repo/a.py'],
    ['str_replace_editor', { command: 'create', path: '/repo/a.py', file_text: 'PRIVATE_CONTENT' }, 'write', '/repo/a.py'],
    ['str_replace_editor', { command: 'str_replace', path: '/repo/a.py', old_str: 'PRIVATE_OLD', new_str: 'PRIVATE_NEW' }, 'edit', '/repo/a.py'],
    ['str_replace_editor', { command: 'insert', path: '/repo/a.py', new_str: 'PRIVATE_NEW' }, 'edit', '/repo/a.py'],
  ])('previews only verified rc.3 %s arguments', (name, args, actionKind, target) => {
    const native = log([
      ['turn/start', { turn: 1 }], ['user/message', user('request-1')], ['step/start', { turn: 1, step: 1 }],
      ['tool/call', { turn: 1, step: 1, callId: 'preview', name, arguments: JSON.stringify({ ...args as object, reasoning: 'PRIVATE_REASONING' }) }],
      ['tool/result', { turn: 1, step: 1, message: { toolCallId: 'preview', content: [{ type: 'text', text: 'PRIVATE_RAW_OUTPUT' }] } }],
      ['assistant/message', assistant()], ['step/end', { turn: 1, step: 1 }], ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ]);
    const projection = projectExecution(native, options);
    expect(projection.steps.find(step => step.callId === 'preview')).toMatchObject({ actionKind, target });
    expect(JSON.stringify(projection)).not.toContain('PRIVATE_');
  });

  it('does not summarize unknown tools, invalid arguments, aliases, or result text', () => {
    const native = log([
      ['turn/start', { turn: 1 }], ['user/message', user('request-1')], ['step/start', { turn: 1, step: 1 }],
      ['tool/call', { turn: 1, step: 1, callId: 'unknown', name: 'custom_tool', arguments: JSON.stringify({ command: 'PRIVATE_COMMAND', file_path: 'PRIVATE_PATH', description: 'PRIVATE_DESCRIPTION', reasoning: 'PRIVATE_REASONING' }) }],
      ['tool/call', { turn: 1, step: 1, callId: 'invalid', name: 'read', arguments: '{"file_path":"PRIVATE_TRUNCATED' }],
      ['tool/call', { turn: 1, step: 1, callId: 'path-alias', name: 'read', arguments: JSON.stringify({ path: 'PRIVATE_WRONG_PARAMETER' }) }],
      ['tool/call', { turn: 1, step: 1, callId: 'command-alias', name: 'pwsh', arguments: JSON.stringify({ cmd: 'PRIVATE_WRONG_PARAMETER' }) }],
      ['tool/call', { turn: 1, step: 1, callId: 'unknown-operation', name: 'str_replace_editor', arguments: JSON.stringify({ command: 'undo_edit', path: 'PRIVATE_UNSUPPORTED_OPERATION' }) }],
      ['tool/result', { turn: 1, step: 1, message: { toolCallId: 'unknown', content: [{ type: 'text', text: 'PRIVATE_RAW_OUTPUT' }] } }],
      ['assistant/message', assistant()], ['step/end', { turn: 1, step: 1 }], ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ]);
    const projection = projectExecution(native, options);
    for (const step of projection.steps.filter(step => step.callId)) expect(step.target).toBeUndefined();
    expect(projection.steps.find(step => step.callId === 'unknown')).toMatchObject({ title: 'custom_tool', actionKind: 'tool' });
    expect(JSON.stringify(projection)).not.toContain('PRIVATE_');
  });

  it('only previews web query/url when the native request declares those exact string parameters', () => {
    const webTools = [
      { name: 'web_search', description: 'Externally declared test search tool', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
      { name: 'web_fetch', description: 'Externally declared test fetch tool', parameters: { type: 'object', properties: { url: { type: 'string' } } } },
    ];
    const native = log([
      ['request/header', { header: { tools: webTools } }], // A complete inherited declaration may precede this execution.
      ['turn/start', { turn: 1 }], ['user/message', user('request-1')], ['step/start', { turn: 1, step: 1 }],
      ['tool/call', { turn: 1, step: 1, callId: 'search', name: 'web_search', arguments: JSON.stringify({ query: 'DSH plugin API', prompt: 'PRIVATE_PROMPT' }) }],
      ['tool/call', { turn: 1, step: 1, callId: 'fetch', name: 'web_fetch', arguments: JSON.stringify({ url: 'https://example.test/api', content: 'PRIVATE_CONTENT' }) }],
      ['request/header', { header: {} }], // A later complete snapshot removes the declarations.
      ['tool/call', { turn: 1, step: 1, callId: 'undeclared', name: 'web_search', arguments: JSON.stringify({ query: 'PRIVATE_UNDECLARED' }) }],
      ['request/header', { header: { tools: [{ name: 'web_fetch', parameters: { type: 'object', properties: { url: { type: 'array', items: { type: 'string' } } } } }] } }],
      ['tool/call', { turn: 1, step: 1, callId: 'wrong-schema', name: 'web_fetch', arguments: JSON.stringify({ url: ['PRIVATE_ARRAY'] }) }],
      ['step/end', { turn: 1, step: 1 }], ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ]);
    const projection = projectExecution(native, { ...options, startSeq: 1 });
    expect(projection.steps.find(step => step.callId === 'search')).toMatchObject({ actionKind: 'search', target: 'DSH plugin API' });
    expect(projection.steps.find(step => step.callId === 'fetch')).toMatchObject({ actionKind: 'fetch', target: 'https://example.test/api' });
    expect(projection.steps.find(step => step.callId === 'undeclared')?.target).toBeUndefined();
    expect(projection.steps.find(step => step.callId === 'wrong-schema')?.target).toBeUndefined();
    expect(JSON.stringify(projection)).not.toContain('PRIVATE_');
  });

  it('caps display-only targets at 240 wire characters without breaking surrogate pairs', () => {
    const native = log([
      ['turn/start', { turn: 1 }], ['user/message', user('request-1')], ['step/start', { turn: 1, step: 1 }],
      ['tool/call', { turn: 1, step: 1, callId: 'long-path', name: 'read', arguments: JSON.stringify({ file_path: `${'a'.repeat(238)}😀${'b'.repeat(500)}` }) }],
      ['tool/call', { turn: 1, step: 1, callId: 'long-command', name: 'bash', arguments: JSON.stringify({ command: `  printf\u0000\n${'q'.repeat(700)}  ` }) }],
      ['step/end', { turn: 1, step: 1 }], ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ]);
    const projection = projectExecution(native, options);
    for (const step of projection.steps.filter(step => step.callId)) {
      expect(step.target!.length).toBeLessThanOrEqual(240);
      expect(step.target).toMatch(/…$/);
      expect(step.target).not.toMatch(/[\u0000-\u001f\u007f]/);
    }
    expect(projection.steps.find(step => step.callId === 'long-path')?.target).toBe(`${'a'.repeat(238)}…`);
    const command = projection.steps.find(step => step.callId === 'long-command')!;
    expect(readTraceStepDetails(native, projection, command.stepId).command).toHaveLength(712); // Expanded detail keeps the original recorded command.
  });

  it('only accepts an exact existing completed turn/end for historical forks', () => {
    const native = log([['turn/start', { turn: 1 }], ['turn/end', { turn: 1, reason: { kind: 'error' } }], ['turn/start', { turn: 2 }], ['turn/end', { turn: 2, reason: { kind: 'completed' } }]]);
    expect(completedBoundary(native)).toBe(3);
    expect(completedBoundary(native, 3)).toBe(3);
    for (const seq of [-1, 0, 1, 2, 4, 1.5]) expect(() => completedBoundary(native, seq)).toThrow(/completed/);
  });
});
