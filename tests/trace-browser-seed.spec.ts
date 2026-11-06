import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Context } from '@deepseek-ai/cordis';
import SessionStore from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model';
import SessionController from '@deepseek-ai/dsh-api-session-controller';
import SessionQueryEngine from '@deepseek-ai/dsh-session-query';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local';
import FileUploads from '@deepseek-ai/dsh-client-file-upload';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import LlmRuntime, { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { expect, it, vi } from 'vitest';
import { DshNativeRuntime } from '../src/host/native-runtime.ts';
import VisualWorkflowService from '../src/host/service.ts';

// This opt-in integration generator records actual rc.3 Agent/Tools/Session
// events in an isolated home. Only the external LLM transport is controlled.
// The shipping plugin contains neither this adapter nor any invented logs.
const seedRoot = process.env.WORKFLOW_TRACE_SEED_ROOT;
const runFile = promisify(execFile);
const toolError = 'Intentional controlled native tool failure';
const nativeError = 'Intentional controlled native model failure';
class ReadOnlySeedQuery extends SessionQueryEngine {
  async searchSessions(): Promise<never> { throw new Error('Search is unused in native trace seed'); }
  async searchEvents(): Promise<never> { throw new Error('Search is unused in native trace seed'); }
}
class TraceSeedModel extends LlmAdapter {
  constructor(private readonly sample: string, private readonly command: string) { super(); }
  async listModels() { return [{ provider: 'trace-seed', id: 'controlled-model', name: 'Isolated native trace test model' }]; }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted();
    const userIndex = options.messages.findLastIndex(message => message.role === 'user' && 'source' in message && message.source?.kind === 'user');
    const user = options.messages[userIndex];
    const prompt = user?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? '';
    if (prompt.includes('TRACE_NATIVE_FAILURE')) throw new Error(nativeError);
    const tools = options.messages.slice(userIndex + 1).filter(message => message.role === 'tool').length;
    const sequence = [
      { name: 'read', arguments: JSON.stringify({ file_path: this.sample }) },
      { name: 'pwsh', arguments: JSON.stringify({ command: this.command }) },
      { name: 'read', arguments: JSON.stringify({ file_path: this.sample }) },
      { name: 'fixture_error', arguments: '{}' },
      { name: 'read', arguments: JSON.stringify({ file_path: this.sample }) },
      { name: 'pwsh', arguments: JSON.stringify({ command: this.command }) },
    ];
    if (prompt.includes('TRACE_NATIVE_TOOLS') && tools < sequence.length) {
      const call = sequence[tools]!;
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(`trace-call-${tools + 1}`), ...call } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    const text = prompt.includes('TRACE_NATIVE_TOOLS') ? 'Recorded native file reads, PowerShell output, and the controlled tool error.' : 'Original isolated test conversation.';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

it.skipIf(!seedRoot)('seeds browser trace evidence through real native Agent tools and durable Sessions', async () => {
  const directory = resolve(seedRoot!);
  await mkdir(directory, { recursive: true });
  const sample = join(directory, 'trace-sample.txt');
  const sampleText = Array.from({ length: 24 }, (_, index) => `native output line ${String(index + 1).padStart(2, '0')} | actual file content`).join('\n');
  await writeFile(sample, sampleText, 'utf8');
  const command = `Get-Content -LiteralPath '${sample.replaceAll("'", "''")}'`;
  const ctx = new Context();
  try {
    await ctx.plugin(TypertRegistry);
    await ctx.plugin(SessionStore);
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(SessionProjections);
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false });
    await ctx.plugin(Tools, { mode: 'native' });
    await ctx.plugin(JsonlPersistence, { root: join(directory, 'sessions'), compression: 'none' });
    await ctx.plugin(ReadOnlySeedQuery);
    await ctx.plugin(AgentDefaultModel, { provider: 'trace-seed', model: 'controlled-model' });
    ctx.llm.registerAdapter(['trace-seed'], new TraceSeedModel(sample, command));
    await ctx.plugin(LocalAttachmentStore,{dshHome:directory});
    await ctx.plugin(LocalFileSystem,{cwd:directory});
    ctx.provide('connection',{fetch:{register:()=>()=>{}}});
    ctx.provide('commands',{registerFileReceiptResolver:()=>()=>{}});
    await ctx.plugin(FileUploads);
    ctx.provide('remoteAccess', { allows: () => true });
    ctx.provide('workspaceRegistry', { archivedSessionIds: [], list: () => [], get: () => undefined });
    await ctx.plugin(AgentLoop, {});
    await ctx.plugin(SessionController, { nativeOpen: false });
    const output = { schema: { type: 'string' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }] };
    ctx.tools.register({ name: 'read', description: 'Read only the isolated native trace sample', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'], additionalProperties: false }, output,
      execute: async (args, execution) => {
        const file = (args as { file_path: string }).file_path;
        if (file !== sample) throw new Error('Only the isolated sample may be read');
        return readFile(file, { encoding: 'utf8', signal: execution.signal });
      } });
    ctx.tools.register({ name: 'pwsh', description: 'Run the fixed read-only sample command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false }, output,
      execute: async (args, execution) => {
        const value = (args as { command: string }).command;
        if (value !== command) throw new Error('Only the fixed read-only trace command is allowed');
        const result = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', value], { cwd: directory, signal: execution.signal, windowsHide: true, maxBuffer: 2_000_000 });
        return result.stdout;
      } });
    ctx.tools.register({ name: 'fixture_error', description: 'Explicit controlled failure for native error rendering', parameters: { type: 'object', properties: {}, additionalProperties: false }, output,
      execute: async () => { throw new Error(toolError); } });
    const runtime = new DshNativeRuntime(ctx);
    const source = await runtime.create({ cwd: directory });
    await runtime.submit({ sessionId: source.sessionId, requestId: 'trace-browser-original', text: 'ORIGINAL isolated native browser fixture' });
    await runtime.waitForIdle(source.sessionId); await runtime.flush(source.sessionId);
    const original = JSON.stringify(await runtime.read(source.sessionId));
    await ctx.plugin(Storage);
    await ctx.plugin(JsonStorage, { root: join(directory, 'storages') });
    await ctx.plugin(StorageDomain, { backend: 'json' });
    await ctx.plugin(VisualWorkflowService);
    await vi.waitFor(async () => expect((await ctx.visualWorkflow.catalog()).sessions.length).toBeGreaterThan(0));
    const service = ctx.visualWorkflow;
    let workflow = (await service.importSession({ sessionId: source.sessionId })).workflow;
    const nodeId = 'trace-browser-task';
    const saved = await service.save({ workflow: { ...workflow, name: 'Native compact trace browser evidence', viewport: { x: 16, y: 60, zoom: 0.85 }, nodes: [...workflow.nodes,
      { id: nodeId, title: '检查原生执行轨迹', instruction: 'TRACE_NATIVE_TOOLS: Read sample files and display actual recorded command output.', position: { x: 480, y: 120 }, source: 'user', revision: 1, status: 'draft' },
      { id: 'trace-browser-dependent', title: '后续任务', instruction: 'Review the observed results.', position: { x: 880, y: 120 }, source: 'user', revision: 1, status: 'draft' }],
      edges: [{ id: 'trace-browser-edge', source: nodeId, target: 'trace-browser-dependent', type: 'dependency' }] }, expectedRevision: workflow.revision });
    if (!saved.ok) throw new Error('Could not save native browser evidence graph');
    const completed = await service.run({ workflowId: workflow.id, nodeId, operationId: 'trace-browser-completed' });
    await vi.waitFor(async () => expect((await service.get({ id: workflow.id })).workflow!.executions!.find(run => run.runId === completed.runId)).toMatchObject({ status: 'completed', durability: 'durable' }));
    workflow = (await service.get({ id: workflow.id })).workflow!;
    const trace = (await service.trace({ workflowId: workflow.id, runId: completed.runId! })).trace;
    expect(trace.steps.filter(step => step.type === 'command')).toHaveLength(2);
    expect(trace.steps.filter(step => step.type === 'file_operation')).toHaveLength(3);
    const errorStep = trace.steps.find(step => step.toolName === 'fixture_error')!;
    expect(errorStep.status).toBe('failed');
    const commandStep = trace.steps.find(step => step.type === 'command')!;
    expect((await service.details({ workflowId: workflow.id, runId: completed.runId!, stepId: commandStep.stepId })).details.output).toContain('native output line 24');
    const changed = await service.save({ workflow: { ...workflow, nodes: workflow.nodes.map(node => node.id === nodeId ? { ...node, instruction: 'TRACE_NATIVE_FAILURE: Record an actual native model failure.' } : node) }, expectedRevision: workflow.revision });
    if (!changed.ok) throw new Error('Could not prepare native failure run');
    const failed = await service.run({ workflowId: workflow.id, nodeId, operationId: 'trace-browser-failed' });
    await vi.waitFor(async () => expect((await service.get({ id: workflow.id })).workflow!.executions!.find(run => run.runId === failed.runId)).toMatchObject({ status: 'failed', durability: 'durable' }));
    expect(JSON.stringify(await runtime.read(source.sessionId))).toBe(original);
    const manifest = { workflowId: workflow.id, nodeId, completedRunId: completed.runId, failedRunId: failed.runId,
      sourceSessionId: source.sessionId, sessionId: workflow.executions![0]!.sessionId,
      fileTarget: 'trace-sample.txt', commandTarget: 'Get-Content', command, commandOutput: 'native output line 24', toolError, nativeError,
      authority: 'Actual rc.3 AgentLoop, Tools, Controller and JSONL events; external model transport controlled; tool bodies perform real readFile and fixed PowerShell reads.' };
    const manifestPath = resolve(process.env.WORKFLOW_TRACE_FIXTURE ?? 'artifacts/trace-fixture.json');
    await mkdir(resolve(manifestPath, '..'), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    const stored = await readFile(join(directory, 'storages', 'visual_workflow.json'), 'utf8');
    expect(stored).not.toContain('native output line 24'); expect(stored).not.toContain('"arguments"');
  } finally { await ctx.fiber.dispose(); }
}, 60000);
