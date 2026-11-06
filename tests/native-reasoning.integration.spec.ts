import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import SessionStore from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model';
import SessionController from '@deepseek-ai/dsh-api-session-controller';
import SessionQueryEngine from '@deepseek-ai/dsh-session-query';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import LlmRuntime, { LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DshNativeRuntime } from '../src/host/native-runtime.ts';

function runtimeFixture() {
  const calls: unknown[] = [];
  const ctx = {
    sessionController: {
      modelCatalog: async () => ({
        default: { provider: 'fixture', model: 'reasoning-model' },
        routableProviders: ['fixture'], failures: [],
        groups: [{ id: 'fixture', name: 'Fixture', models: [{ id: 'reasoning-model', name: 'Reasoning model', reasoning: {
          efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high',
        } }] }],
      }),
    },
    llm: {
      resolveCallConfig: async (config: unknown) => {
        calls.push(config);
        const effort = (config as { reasoningEffort?: string }).reasoningEffort;
        if (effort !== undefined && !['low', 'high'].includes(effort)) throw new Error('unsupported effort');
        return { ...(config as Record<string, unknown>), ...(effort === undefined ? { reasoningEffort: 'high' } : {}) };
      },
    },
    on: vi.fn(() => () => {}),
    effect: vi.fn(() => () => {}),
  };
  return { runtime: new DshNativeRuntime(ctx as never), calls };
}

describe('native reasoning capability mapping', () => {
  it('exposes adapter-owned efforts and materializes the exact default', async () => {
    const { runtime, calls } = runtimeFixture();
    await expect(runtime.models()).resolves.toMatchObject({ models: [{
      provider: 'fixture', model: 'reasoning-model',
      reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'high' },
    }] });
    await expect(runtime.resolveModel({ provider: 'fixture', model: 'reasoning-model' })).resolves.toEqual({
      provider: 'fixture', model: 'reasoning-model', reasoningEffort: 'high',
    });
    expect(calls).toEqual([{ provider: 'fixture', model: 'reasoning-model' }]);
  });

  it('preflights an explicit effort and rejects unknown values before dispatch', async () => {
    const { runtime, calls } = runtimeFixture();
    await expect(runtime.resolveModel({ provider: 'fixture', model: 'reasoning-model', reasoningEffort: 'low' })).resolves.toEqual({
      provider: 'fixture', model: 'reasoning-model', reasoningEffort: 'low',
    });
    await expect(runtime.resolveModel({ provider: 'fixture', model: 'reasoning-model', reasoningEffort: 'max' })).rejects.toThrow('unsupported effort');
    expect(calls).toEqual([
      { provider: 'fixture', model: 'reasoning-model', reasoningEffort: 'low' },
      { provider: 'fixture', model: 'reasoning-model', reasoningEffort: 'max' },
    ]);
  });
});

class ExactReadQuery extends SessionQueryEngine {
  async searchSessions(): Promise<never> { throw new Error('Search is not used by this fixture'); }
  async searchEvents(): Promise<never> { throw new Error('Search is not used by this fixture'); }
}

/** The native runtime owns routing, validation, event headers, and durable JSONL. */
class ReasoningTransport extends LlmAdapter {
  readonly calls: GenerateOptions[] = [];
  constructor(private readonly effortIds: readonly string[], private readonly defaultEffort?: string) { super(); }
  async listModels(provider: string) { return [
    { provider, id: 'same-model', name: 'Same display name' },
    { provider, id: 'plain-model', name: 'Plain model' },
  ]; }
  async resolveModel(provider: string, model: string) {
    const info = await super.resolveModel(provider, model);
    return { ...info, ...(model === 'plain-model' ? {} : { reasoning: {
      efforts: this.effortIds.map(id => ({ id: ReasoningEffortId(id), name: id })),
      ...(this.defaultEffort === undefined ? {} : { defaultEffort: ReasoningEffortId(this.defaultEffort) }),
    } }) };
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted();
    this.calls.push(options);
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'Recorded native effort.' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Recorded native effort.' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

const nativeContexts: Context[] = [];
const nativeDirectories: string[] = [];
afterEach(async () => {
  for (const ctx of nativeContexts.splice(0).reverse()) await ctx.fiber.dispose();
  for (const directory of nativeDirectories.splice(0)) {
    const absolute = resolve(directory);
    if (!absolute.startsWith(resolve(tmpdir(), 'dsh-reasoning-native-'))) throw new Error('Unexpected fixture cleanup path');
    await rm(absolute, { recursive: true, force: true });
  }
});

async function openNative() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-reasoning-native-'));
  nativeDirectories.push(directory);
  const ctx = new Context();
  nativeContexts.push(ctx);
  await ctx.plugin(TypertRegistry);
  await ctx.plugin(SessionStore);
  await ctx.plugin(AgentRegistry);
  await ctx.plugin(SessionProjections);
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false });
  await ctx.plugin(Tools, { mode: 'native' });
  await ctx.plugin(JsonlPersistence, { root: join(directory, 'sessions'), compression: 'none' });
  await ctx.plugin(ExactReadQuery);
  await ctx.plugin(AgentDefaultModel, { provider: 'reasoning-a', model: 'same-model' });
  const first = new ReasoningTransport(['low', 'high'], 'high');
  const second = new ReasoningTransport(['economy', 'deep'], 'economy');
  ctx.llm.registerAdapter(['reasoning-a'], first);
  ctx.llm.registerAdapter(['reasoning-b'], second);
  ctx.provide('attachments', {
    imageLimits: { maxImageBytes: 1_000_000, maxImagesPerMessage: 10, maxMessageImageBytes: 10_000_000,
      maxImagePixels: 10_000_000, maxImageDimension: 10000, mediaTypes: ['image/png'] },
    admitPromptContent: async (content: unknown) => content,
  });
  ctx.provide('fileUploads', {
    registerAgentResolver: () => () => {},
    bindPrompt: () => ({ commit() {}, [Symbol.dispose]() {} }),
    retirePrompt() {},
  });
  ctx.provide('fs', {});
  ctx.provide('remoteAccess', { allows: () => true });
  ctx.provide('workspaceRegistry', { archivedSessionIds: [], list: () => [], get: () => undefined });
  await ctx.plugin(AgentLoop, {});
  await ctx.plugin(SessionController, { nativeOpen: false });
  return { ctx, directory, first, second, runtime: new DshNativeRuntime(ctx) };
}

describe('released rc.3 reasoning request integration', () => {
  it('routes explicit effort into native provider calls and durable request headers without leaking between task models', async () => {
    const { ctx, directory, runtime, first, second } = await openNative();
    const target = await runtime.create({ cwd: directory });
    const configured = ctx.agentDefaultModel.currentSelection();
    const send = async (requestId: string, model: {provider: string; model: string; reasoningEffort?: string}) => {
      await runtime.submit({ sessionId: target.sessionId, requestId, text: 'Record the current native selection.', model });
      await runtime.waitForIdle(target.sessionId);
      await runtime.flush(target.sessionId);
      return runtime.read(target.sessionId);
    };
    const lowLog = await send('reasoning-low', { provider: 'reasoning-a', model: 'same-model', reasoningEffort: 'low' });
    expect(first.calls.at(-1)?.reasoningEffort).toBe('low');
    expect(lowLog.events.findLast(event => event.type === 'model/selection')?.data).toMatchObject({ reasoningEffort: 'low' });
    expect(lowLog.events.findLast(event => event.type === 'request/header')?.data.header).toMatchObject({ config: { reasoningEffort: 'low' } });
    await send('reasoning-default', { provider: 'reasoning-a', model: 'same-model' });
    expect(first.calls.at(-1)?.reasoningEffort).toBe('high');
    await send('reasoning-other-provider', { provider: 'reasoning-b', model: 'same-model', reasoningEffort: 'deep' });
    expect(second.calls.at(-1)?.reasoningEffort).toBe('deep');
    const plainLog = await send('reasoning-clear', { provider: 'reasoning-b', model: 'plain-model' });
    expect(second.calls.at(-1)?.reasoningEffort).toBeUndefined();
    expect(plainLog.events.findLast(event => event.type === 'request/header')?.data.header).toMatchObject({ config: { provider: 'reasoning-b', model: 'plain-model' } });
    expect((plainLog.events.findLast(event => event.type === 'request/header')?.data.header as {config: Record<string, unknown>}).config.reasoningEffort).toBeUndefined();
    expect(ctx.agentDefaultModel.currentSelection()).toEqual(configured);
  });

  it('rejects efforts outside the exact provider/model capability before native prompt admission', async () => {
    const { directory, runtime, first, second } = await openNative();
    const target = await runtime.create({ cwd: directory });
    const before = await runtime.read(target.sessionId);
    await expect(runtime.submit({ sessionId: target.sessionId, requestId: 'wrong-provider-effort', text: 'Never send this.',
      model: { provider: 'reasoning-b', model: 'same-model', reasoningEffort: 'high' } })).rejects.toThrow(/does not support reasoning effort/);
    await expect(runtime.resolveModel({ provider: 'reasoning-a', model: 'plain-model', reasoningEffort: 'low' })).rejects.toThrow(/does not support reasoning effort/);
    expect(first.calls).toHaveLength(0);
    expect(second.calls).toHaveLength(0);
    expect(await runtime.read(target.sessionId)).toEqual(before);
  });
});
