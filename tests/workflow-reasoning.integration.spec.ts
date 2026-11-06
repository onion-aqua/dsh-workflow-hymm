import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import { afterEach, describe, expect, it } from 'vitest';
import VisualWorkflowService from '../src/host/service.ts';
import type { NativeEvent, NativeRuntime, NativeSessionLog } from '../src/host/native-runtime.ts';
import type { Workflow, WorkflowModelIdentity } from '../src/shared/model.ts';

const contexts: Context[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function open(runtime: NativeRuntime) {
  const root = await mkdtemp(join(tmpdir(), 'workflow-reasoning-'));
  roots.push(root);
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(Storage);
  await ctx.plugin(JsonStorage, { root });
  await ctx.plugin(StorageDomain, { backend: 'json' });
  await ctx.plugin(VisualWorkflowService);
  const service = ctx.visualWorkflow;
  Reflect.set(service, 'native', runtime);
  return service;
}

function runtimeFixture() {
  const calls: WorkflowModelIdentity[] = [];
  const options = [
    { provider: 'provider-a', model: 'same-model', label: 'Provider A / Same', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } },
    { provider: 'provider-b', model: 'same-model', label: 'Provider B / Same', reasoning: { efforts: [{ id: 'economy', name: 'Economy' }, { id: 'deep', name: 'Deep' }], defaultEffort: 'economy' } },
  ];
  const runtime = {
    models: async () => ({ models: options, defaultModel: { provider: 'provider-a', model: 'same-model' } }),
    resolveModel: async (selection?: WorkflowModelIdentity) => {
      const resolved = selection ?? { provider: 'provider-a', model: 'same-model' };
      const available = options.find(option => option.provider === resolved.provider && option.model === resolved.model);
      if (!available) throw new Error('Selected native model is unavailable');
      const supported = available.reasoning.efforts.some(effort => effort.id === resolved.reasoningEffort);
      if (resolved.reasoningEffort !== undefined && !supported) throw new Error(`does not support reasoning effort ${resolved.reasoningEffort}`);
      calls.push(structuredClone(resolved));
      return structuredClone(resolved);
    },
  } as unknown as NativeRuntime;
  return { runtime, calls, options };
}

function workflowWithSettings(): Workflow {
  const now = Date.now();
  return {
    id: 'workflow-test', name: 'Reasoning test', schemaVersion: 2, revision: 1, nodes: [], edges: [],
    viewport: { x: 0, y: 0, zoom: 1 }, createdAt: now, updatedAt: now,
    settings: { generation: 'suggest', execution: 'approval', model: { provider: 'provider-a', model: 'same-model' },
      modelReasoning: [
        { provider: 'provider-a', model: 'same-model', reasoningEffort: 'high' },
        { provider: 'provider-b', model: 'same-model', reasoningEffort: 'deep' },
      ] },
  };
}

describe('workflow reasoning preference resolution', () => {
  it('exposes native effort metadata through the workflow model catalog', async () => {
    const { runtime, options } = runtimeFixture();
    const service = await open(runtime);
    await expect(service.models()).resolves.toEqual({ models: options, defaultModel: { provider: 'provider-a', model: 'same-model' } });
  });

  it('matches modelReasoning by provider and model before resolving a workflow model', async () => {
    const { runtime, calls } = runtimeFixture();
    const service = await open(runtime);
    const resolve = Reflect.get(service, 'resolveWorkflowModel') as (workflow: Workflow, node?: { model?: WorkflowModelIdentity }) => Promise<WorkflowModelIdentity>;
    const workflow = workflowWithSettings();
    await expect(resolve.call(service, workflow)).resolves.toEqual({ provider: 'provider-a', model: 'same-model', reasoningEffort: 'high' });
    await expect(resolve.call(service, { ...workflow, settings: { ...workflow.settings!, model: { provider: 'provider-b', model: 'same-model' } } })).resolves.toEqual({ provider: 'provider-b', model: 'same-model', reasoningEffort: 'deep' });
    expect(calls).toEqual([
      { provider: 'provider-a', model: 'same-model', reasoningEffort: 'high' },
      { provider: 'provider-b', model: 'same-model', reasoningEffort: 'deep' },
    ]);
  });

  it('does not accept a preference for an unavailable effort on an exact provider route', async () => {
    const { runtime } = runtimeFixture();
    const service = await open(runtime);
    const resolve = Reflect.get(service, 'resolveWorkflowModel') as (workflow: Workflow) => Promise<WorkflowModelIdentity>;
    const workflow = workflowWithSettings();
    workflow.settings!.modelReasoning = [{ provider: 'provider-a', model: 'same-model', reasoningEffort: 'deep' }];
    await expect(resolve.call(service, workflow)).rejects.toThrow(/does not support reasoning effort/);
  });

  it('keeps admitted waiting efforts frozen while new Run, batch and planning use the new exact-route preference', async () => {
    const { runtime: base } = runtimeFixture();
    const logs = new Map<string, NativeSessionLog>();
    const prompts: Array<{ sessionId: string; requestId: string; text: string; model?: WorkflowModelIdentity }> = [];
    let next = 0;
    const runRuntime = {
      ...base,
      catalog: async () => [...logs.values()].map(log => ({ sessionId: log.sessionId, title: log.sessionId, updatedAt: 1, running: false, blank: !log.events.length })),
      create: async (request: { sessionId?: string }) => {
        const sessionId = request.sessionId ?? `run-session-${++next}`;
        logs.set(sessionId, { sessionId, header: { id: sessionId, createdAt: 1, isSeeded: false }, inheritedEventCount: 0, events: [] });
        return { sessionId };
      },
      read: async (sessionId: string) => structuredClone(logs.get(sessionId) ?? { sessionId, header: { id: sessionId, createdAt: 1, isSeeded: false }, inheritedEventCount: 0, events: [] }),
      fork: async (request: { sessionId: string; atSeq: number }) => {
        const source = logs.get(request.sessionId)!;
        const sessionId = `fork-session-${++next}`;
        logs.set(sessionId, { sessionId, header: { ...source.header, id: sessionId, parentSession: source.sessionId, isSeeded: true }, inheritedEventCount: request.atSeq + 1, events: structuredClone(source.events.filter(event => event.seq <= request.atSeq)) });
        return { sessionId, inheritedEventCount: request.atSeq + 1 };
      },
      submit: async (request: { sessionId: string; requestId: string; text: string; model?: WorkflowModelIdentity }) => {
        prompts.push(structuredClone(request));
        const log = logs.get(request.sessionId)!;
        const turn = log.events.filter(event => event.type === 'turn/start').length + 1;
        const text = request.text.startsWith('You are drafting') ? JSON.stringify({ tasks: [{ id: 'draft', title: 'Draft', instruction: 'Review only', dependsOn: [] }] }) : 'done';
        for (const [type, data] of [
          ['turn/start', { turn }],
          ['user/message', { id: request.requestId, source: { kind: 'user', rpcId: request.requestId }, content: [{ type: 'text', text: request.text }] }],
          ['assistant/message', { turn, step: 1, message: { content: [{ type: 'text', text }] } }],
          ['turn/end', { turn, reason: { kind: 'completed' } }],
        ] as Array<[string, Record<string, unknown>]>) log.events.push({ type, seq: log.events.length, time: log.events.length + 1, data });
      },
      flush: async () => {}, isRunning: () => false, waitForIdle: async () => {}, cancel: async () => 'none' as const,
      protectPlanning: () => {},
      subscribe: (_listener: (sessionId: string, event: NativeEvent) => void) => () => {},
    } as unknown as NativeRuntime;
    const service = await open(runRuntime);
    const created = await service.create({ name: 'Frozen model run' });
    const node = (id: string) => ({ id, title: id, instruction: `Run ${id} with the selected native effort.`, source: 'user' as const, status: 'draft' as const, revision: 1, position: { x: 0, y: 0 } });
    const saved = await service.save({ workflow: { ...created.workflow, settings: { ...created.workflow.settings!, model: { provider: 'provider-a', model: 'same-model' }, modelReasoning: [{ provider: 'provider-a', model: 'same-model', reasoningEffort: 'high' }], }, nodes: [node('task'), node('downstream'), node('batch-task')], edges: [{ id: 'dependency', source: 'task', target: 'downstream', type: 'dependency' }] }, expectedRevision: created.workflow.revision });
    if (!saved.ok) throw new Error('workflow save conflict');
    const queued = await service.run({ workflowId: saved.workflow.id, nodeId: 'downstream', operationId: 'frozen-reasoning-queue' });
    expect(queued.workflow.executions![0]).toMatchObject({ status: 'waiting', resolvedModel: { provider: 'provider-a', model: 'same-model', reasoningEffort: 'high' } });
    const changed = await service.save({ workflow: { ...queued.workflow, settings: { ...queued.workflow.settings!, modelReasoning: [{ provider: 'provider-a', model: 'same-model', reasoningEffort: 'low' }] } }, expectedRevision: queued.workflow.revision });
    if (!changed.ok) throw new Error('workflow save conflict');
    expect(changed.workflow.executions![0]).toMatchObject({ status: 'waiting', resolvedModel: { reasoningEffort: 'high' } });
    await service.run({ workflowId: saved.workflow.id, nodeId: 'task', operationId: 'new-reasoning-run' });
    expect(prompts.map(prompt => prompt.model?.reasoningEffort)).toEqual(['low', 'high']);
    await service.batchRun({ workflowId: saved.workflow.id, nodeIds: ['batch-task'], nodeRevisions: { 'batch-task': 1 }, operationId: 'new-reasoning-batch' });
    expect(prompts.at(-1)?.model?.reasoningEffort).toBe('low');
    const plan = await service.generatePlan({ workflowId: saved.workflow.id, goal: 'Plan a review task', operationId: 'new-reasoning-plan' });
    expect(prompts.at(-1)?.model?.reasoningEffort).toBe('low');
    expect(plan.workflow.plans!.find(item => item.id === plan.planId)?.resolvedModel).toMatchObject({ reasoningEffort: 'low' });
  });
});
