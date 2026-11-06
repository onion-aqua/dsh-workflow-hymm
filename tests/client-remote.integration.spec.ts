// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis';
import * as GatewayClient from '@deepseek-ai/dsh-api-gateway/client';
import { installConnection } from '@deepseek-ai/dsh-client-connection/client';
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';
import * as TypertClient from '@deepseek-ai/dsh-typert-registry/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as WorkflowPlugin from '../src/client/index.tsx';
import type { WorkflowClient } from '../src/client/data.ts';
import type { Workflow } from '../src/shared/model.ts';
import { WORKFLOW_API_VERSION, WORKFLOW_PLUGIN_VERSION } from '../src/shared/model.ts';

interface PanelBindings { hooks: { workflow: WorkflowClient } }
interface SlotOptions { name: string; key?: string; id?: string; inject?: () => PanelBindings }

/** Only the presentation registries are fixtures; Cordis and Remote stay real. */
class PresentationSlots extends Service {
  readonly entries = new Map<string, SlotOptions>();
  constructor(ctx: Context) { super(ctx, 'slots'); }
  inject(_name: string, callback: () => unknown): () => void {
    callback();
    return () => {};
  }
  register(options: SlotOptions): () => void {
    const key = `${options.name}:${options.key ?? options.id}`;
    this.entries.set(key, options);
    return this.ctx.effect(() => () => { this.entries.delete(key); });
  }
}
class PresentationLocale extends Service {
  readonly namespaces = new Set<string>();
  constructor(ctx: Context) { super(ctx, 'locale'); }
  register(namespace: string): () => void {
    this.namespaces.add(namespace);
    return () => { this.namespaces.delete(namespace); };
  }
  bind(): (key: string) => string { return key => key; }
}
class PresentationLayout extends Service {
  constructor(ctx: Context) { super(ctx, 'layout'); }
  selectPanel = vi.fn();
}
class PresentationWorkspace extends Service {
  constructor(ctx: Context) { super(ctx, 'uiWorkspace'); }
  openSession = vi.fn();
}

const contexts: Context[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose();
  vi.unstubAllGlobals();
  document.head.querySelectorAll('[data-dsh-visual-workflow]').forEach(element => element.remove());
});

describe('Workflow native Client Remote assembly', () => {
  it('mounts the generated child namespace before panel injection, calls it, and withdraws it on unload', async () => {
    const ctx = new Context();
    contexts.push(ctx);
    vi.stubGlobal('__WORKFLOW_CSS__', '.workflow-integration-fixture {}');
    await ctx.plugin(TypertClient);

    // The explicit local carrier is a supported Connection composition seam.
    // It records real generated Remote invocation arguments without HTTP/UI.
    const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = [];
    let saved: Workflow | undefined;
    const rpc: ClientConnectionRpc = {
      async call(channel, endpoint, payload) {
        calls.push({ channel, endpoint, payload });
        const args = (payload as { args: { request?: { name?: string; workflow?: Workflow; expectedRevision?: number } } }).args;
        if (endpoint === 'visualWorkflow/capabilities') return {ok:true,value:{pluginVersion:WORKFLOW_PLUGIN_VERSION,apiVersion:WORKFLOW_API_VERSION,features:['batch-run','delete','model-selection','planning','planning-attachments','visual-node-hide','user-questions']}};
        if (endpoint === 'visualWorkflow/models') return {ok:true,value:{models:[]}};
        if (endpoint === 'visualWorkflow/list') return { ok: true, value: { workflows: saved ? [saved] : [] } };
        if (endpoint === 'visualWorkflow/catalog') return { ok: true, value: { sessions: [], layout: { revision: 0, positions: {}, viewport: { x: 0, y: 0, zoom: 1 } } } };
        if (endpoint === 'visualWorkflow/create') {
          saved = { id: 'workflow-integration', name: args.request!.name!, schemaVersion: 1, revision: 1,
            nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 };
          return { ok: true, value: { workflow: saved } };
        }
        if (endpoint === 'visualWorkflow/save') {
          saved = { ...args.request!.workflow!, revision: args.request!.expectedRevision! + 1, updatedAt: 2 };
          return { ok: true, value: { ok: true, workflow: saved } };
        }
        throw new Error(`Unexpected fixture endpoint: ${endpoint}`);
      },
      open: async function* () { /* No streaming methods participate in Phase 1. */ },
    };
    await ctx.plugin({ name: 'integration-connection', apply: child => installConnection(child, {
      interactions: 'none', transport: { rpc, ownsHost: true },
    }) });
    await ctx.plugin(GatewayClient);
    const slots = new PresentationSlots(ctx);
    const locale = new PresentationLocale(ctx);
    new PresentationLayout(ctx);
    new PresentationWorkspace(ctx);
    ctx.provide('fileUpload',{upload:vi.fn()});

    expect(ctx.get('remote.visualWorkflow')).toBeUndefined();
    // This is the actual plugin apply(), including awaited $mount and the
    // real ctx.inject(['remote.visualWorkflow']) dependency, with no DI mock.
    const owner = ctx.plugin(WorkflowPlugin);
    await owner;
    expect(ctx.get('remote.visualWorkflow')).toBeDefined();
    expect([...slots.entries.keys()].sort()).toEqual(['main:visual-workflow', 'shell.overlay:visual-workflow', 'sidebar.panellist:visual-workflow']);
    expect(locale.namespaces.has('visualWorkflow')).toBe(true);
    expect(document.head.querySelectorAll('[data-dsh-visual-workflow]')).toHaveLength(1);

    const client = slots.entries.get('shell.overlay:visual-workflow')!.inject!().hooks.workflow;
    await vi.waitFor(() => expect(client.getSnapshot().loading).toBe(false));
    expect(client.getSnapshot().workflows).toEqual([]);
    await client.create('Integration plan');
    const created = client.getSnapshot().workflows[0]!;
    client.change({ ...created, name: 'Edited integration plan', viewport: { x: 42, y: -9, zoom: 0.8 } });
    await client.flush();
    expect(client.getSnapshot()).toMatchObject({ saveState: 'saved', workflows: [{ name: 'Edited integration plan', revision: 2 }] });
    const writes = calls.filter(call => /\/(create|save)$/.test(call.endpoint));
    expect(writes.map(call => call.endpoint)).toEqual(['visualWorkflow/create', 'visualWorkflow/save']);
    expect(calls.some(call => call.endpoint === 'visualWorkflow/catalog')).toBe(true);
    expect(calls.every(call => call.channel === '/api')).toBe(true);
    expect(writes[0]!.payload).toEqual({ args: { request: { name: 'Integration plan' } } });
    expect(writes[1]!.payload).toMatchObject({ args: { request: { expectedRevision: 1, workflow: { viewport: { x: 42, y: -9, zoom: 0.8 } } } } });

    let retainedList!: () => ReturnType<typeof ctx.remote.visualWorkflow.list>;
    await ctx.inject(['remote', 'remote.visualWorkflow'], child => { retainedList = child.remote.visualWorkflow.list; });
    await owner.dispose();
    const unloadedCallCount = calls.length;
    expect(ctx.get('remote.visualWorkflow')).toBeUndefined();
    expect(slots.entries.size).toBe(0);
    expect(locale.namespaces.size).toBe(0);
    expect(document.head.querySelectorAll('[data-dsh-visual-workflow]')).toHaveLength(0);
    const withdrawn = await retainedList();
    expect(withdrawn).toMatchObject({ ok: false, error: { code: 'gateway/internal' } });
    if (!withdrawn.ok) expect(withdrawn.error.message).toContain('no longer mounted');
    expect(calls).toHaveLength(unloadedCallCount);

    // Re-enabling the same bundle must create a fresh complete namespace and
    // reload its data, rather than collide with an abandoned contribution.
    const restarted = ctx.plugin(WorkflowPlugin);
    await restarted;
    const nextClient = slots.entries.get('shell.overlay:visual-workflow')!.inject!().hooks.workflow;
    await vi.waitFor(() => expect(nextClient.getSnapshot().loading).toBe(false));
    expect(nextClient.getSnapshot().workflows[0]).toMatchObject({ name: 'Edited integration plan', revision: 2 });
    expect(calls.length).toBeGreaterThan(unloadedCallCount);
    await restarted.dispose();
    expect(ctx.get('remote.visualWorkflow')).toBeUndefined();
  });
});
