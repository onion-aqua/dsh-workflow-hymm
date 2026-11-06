import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowClient } from '../src/client/data.ts';
import type { ClientResult, WorkflowApi } from '../src/client/data.ts';
import type { Workflow, WorkflowListValue, WorkflowSaveValue } from '../src/shared/model.ts';

function workflow(id = 'workflow-one', name = 'Original'): Workflow {
  return { id, name, schemaVersion: 1, revision: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 };
}
function ok<T>(value: T): ClientResult<T> { return { ok: true, value }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function apiFor(initial = workflow()) {
  return {
    list: vi.fn<WorkflowApi['list']>(async () => ok({ workflows: [structuredClone(initial)] })),
    create: vi.fn<WorkflowApi['create']>(async request => ok({ workflow: workflow('workflow-two', request.name) })),
    save: vi.fn<WorkflowApi['save']>(async request => ok({ ok: true, workflow: { ...request.workflow, revision: request.expectedRevision + 1, updatedAt: 2 } })),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  const preferences = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => preferences.get(key) ?? null, setItem: (key: string, value: string) => { preferences.set(key, value); } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Workflow client autosave coordination', () => {
  it('withdraws workflows archived in another window and rejects older delayed records',async()=>{
    const api=apiFor();const client=new WorkflowClient(api);await client.load();api.list.mockResolvedValueOnce(ok({workflows:[]}));await client.refresh();
    expect(client.getSnapshot()).toMatchObject({workflows:[],activeWorkflowId:null});client.acceptServer({...workflow(),revision:20});expect(client.getSnapshot().workflows).toEqual([]);client.dispose();
  });
  it('rebases a graph edit over native execution metadata without overwriting that metadata', async () => {
    const api = apiFor();
    const server = { ...workflow(), revision: 4, operations: [{ id:'operation-one', kind:'fork' as const, status:'completed' as const, createdAt:2, childSessionId:'native-child' }] };
    api.save.mockResolvedValueOnce(ok({ ok:false, code:'conflict', workflow:server }));
    const client = new WorkflowClient(api); await client.load();
    client.change({ ...workflow(), name:'Local graph edit' }); await client.flush();
    expect(api.save.mock.calls.map(([request])=>request.expectedRevision)).toEqual([1,4]);
    expect(client.getSnapshot().workflows[0]).toMatchObject({revision:5,name:'Local graph edit'});
    expect(client.hasUnsaved).toBe(false); client.dispose();
  });

  it('retains an unsaved graph when a newer authoritative execution snapshot arrives', async () => {
    const api=apiFor(); const client=new WorkflowClient(api); await client.load();
    client.change({...workflow(),name:'Pending graph'});
    client.acceptServer({...workflow(),revision:3,plans:[{id:'plan-native',goal:'Native proposal',sessionId:'plan-session',requestId:'request',status:'proposed',tasks:[],createdAt:2}]});
    expect(client.getSnapshot().workflows[0]).toMatchObject({name:'Pending graph',revision:3,plans:[{id:'plan-native'}]});
    await client.flush(); expect(api.save.mock.calls[0]![0].expectedRevision).toBe(3);
    client.dispose();
  });
  it('coalesces local drag edits while preserving their latest coordinates', async () => {
    const api = apiFor();
    const client = new WorkflowClient(api, 50);
    await client.load();
    const record = client.getSnapshot().workflows[0]!;
    client.change({ ...record, viewport: { x: 10, y: 0, zoom: 1 } });
    client.change({ ...record, viewport: { x: 35, y: -4, zoom: 0.8 } });
    await vi.advanceTimersByTimeAsync(49);
    expect(api.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save.mock.calls[0]![0].workflow.viewport).toEqual({ x: 35, y: -4, zoom: 0.8 });
    expect(client.getSnapshot().saveState).toBe('saved');
    expect(client.hasUnsaved).toBe(false);
    client.dispose();
  });

  it('serializes an edit made during an in-flight save against the new server revision', async () => {
    const api = apiFor();
    const first = deferred<ClientResult<WorkflowSaveValue>>();
    api.save.mockImplementationOnce(() => first.promise);
    const client = new WorkflowClient(api, 50);
    await client.load();
    const record = client.getSnapshot().workflows[0]!;
    client.change({ ...record, name: 'First edit' });
    const flight = client.flush();
    client.change({ ...record, name: 'Newer edit', viewport: { x: 77, y: 42, zoom: 0.9 } });
    expect(api.save).toHaveBeenCalledTimes(1);
    first.resolve(ok({ ok: true, workflow: { ...record, name: 'First edit', revision: 2 } }));
    await flight;
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(api.save.mock.calls[1]![0]).toMatchObject({ expectedRevision: 2, workflow: { revision: 2, name: 'Newer edit', viewport: { x: 77, y: 42, zoom: 0.9 } } });
    expect(client.getSnapshot().workflows[0]).toMatchObject({ revision: 3, name: 'Newer edit' });
    expect(client.hasUnsaved).toBe(false);
    client.dispose();
  });

  it('keeps the newest local edit after offline failure and retries it without reloading old server data', async () => {
    const api = apiFor();
    const first = deferred<ClientResult<WorkflowSaveValue>>();
    api.save.mockImplementationOnce(() => first.promise);
    const client = new WorkflowClient(api, 50);
    await client.load();
    const record = client.getSnapshot().workflows[0]!;
    client.change({ ...record, name: 'Older request' });
    const flight = client.flush();
    client.change({ ...record, name: 'Unsaved latest edit' });
    first.resolve({ ok: false, error: { message: 'offline' } });
    await flight;
    expect(client.getSnapshot()).toMatchObject({ saveState: 'error', error: 'offline' });
    expect(client.getSnapshot().workflows[0]!.name).toBe('Unsaved latest edit');
    expect(client.hasUnsaved).toBe(true);
    await client.retry();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.save.mock.calls[1]![0]).toMatchObject({ expectedRevision: 1, workflow: { name: 'Unsaved latest edit' } });
    expect(client.getSnapshot()).toMatchObject({ saveState: 'saved' });
    expect(client.hasUnsaved).toBe(false);
    client.dispose();
  });

  it('retains local drafts on conflict and never adopts a server revision merely to overwrite it', async () => {
    const api = apiFor();
    api.save.mockResolvedValue(ok({ ok: false, code: 'conflict', workflow: { ...workflow(), name: 'Other editor', revision: 5 } }));
    const client = new WorkflowClient(api);
    await client.load();
    client.change({ ...client.getSnapshot().workflows[0]!, name: 'My draft' });
    await client.flush();
    expect(client.getSnapshot().saveState).toBe('error');
    expect(client.getSnapshot().workflows[0]).toMatchObject({ name: 'My draft', revision: 1 });
    await client.retry();
    expect(api.save.mock.calls.map(([request]) => request.expectedRevision)).toEqual([1, 1]);
    expect(client.hasUnsaved).toBe(true);
    client.dispose();
  });

  it('does not let an older list response erase a successfully created workflow', async () => {
    const api = apiFor();
    const listing = deferred<ClientResult<WorkflowListValue>>();
    api.list.mockImplementationOnce(() => listing.promise);
    const client = new WorkflowClient(api);
    const loading = client.load();
    await client.create('Created while loading');
    listing.resolve(ok({ workflows: [] }));
    await loading;
    expect(client.getSnapshot()).toMatchObject({ loading: false, activeWorkflowId: 'workflow-two' });
    expect(client.getSnapshot().workflows).toEqual([workflow('workflow-two', 'Created while loading')]);
    client.change({ ...client.getSnapshot().workflows[0]!, name: 'Still editable' });
    await client.flush();
    expect(api.save).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it('keeps a failed draft visible when creating or selecting another workflow', async () => {
    const api = apiFor();
    api.save.mockResolvedValueOnce({ ok: false, error: { message: 'offline save' } });
    const client = new WorkflowClient(api);
    await client.load();
    client.change({ ...client.getSnapshot().workflows[0]!, name: 'Needs retry' });
    await client.flush();
    await client.create('Another workflow');
    expect(client.getSnapshot().workflows.find(item => item.id === 'workflow-one')?.name).toBe('Needs retry');
    expect(client.getSnapshot().saveState).toBe('error');
    expect(client.getSnapshot().error).toBe('offline save');
    client.select('workflow-one');
    expect(client.getSnapshot().activeWorkflowId).toBe('workflow-one');
    await client.retry();
    expect(client.getSnapshot().saveState).toBe('saved');
    expect(client.hasUnsaved).toBe(false);
    client.dispose();
  });

  it('leaves loading after a failed create and can retry an invalidated initial list', async () => {
    const api = apiFor();
    const listing = deferred<ClientResult<WorkflowListValue>>();
    api.list.mockImplementationOnce(() => listing.promise);
    api.create.mockResolvedValueOnce({ ok: false, error: { message: 'creation offline' } });
    const client = new WorkflowClient(api);
    const initialLoad = client.load();
    await client.create('Unable to create');
    listing.resolve(ok({ workflows: [] }));
    await initialLoad;
    expect(client.getSnapshot()).toMatchObject({ loading: false, saveState: 'error', error: 'creation offline' });
    await client.retry();
    expect(client.getSnapshot()).toMatchObject({ loading: false, saveState: 'saved', activeWorkflowId: 'workflow-one' });
    expect(client.getSnapshot().workflows).toEqual([workflow()]);
    client.dispose();
  });

  it('ignores a stale reload after optimistic edits and does not publish late saves after disposal', async () => {
    const api = apiFor();
    const listing = deferred<ClientResult<WorkflowListValue>>();
    const saving = deferred<ClientResult<WorkflowSaveValue>>();
    const client = new WorkflowClient(api);
    await client.load();
    api.list.mockImplementationOnce(() => listing.promise);
    const reload = client.load();
    client.change({ ...client.getSnapshot().workflows[0]!, name: 'Optimistic draft' });
    listing.resolve(ok({ workflows: [workflow('workflow-one', 'Old response')] }));
    await reload;
    expect(client.getSnapshot().workflows[0]!.name).toBe('Optimistic draft');
    api.save.mockImplementationOnce(() => saving.promise);
    const flight = client.flush();
    const notifications = vi.fn();
    client.subscribe(notifications);
    const before = client.getSnapshot();
    client.dispose();
    saving.resolve(ok({ ok: true, workflow: { ...workflow(), name: 'Saved late', revision: 2 } }));
    await flight;
    expect(client.getSnapshot()).toBe(before);
    expect(notifications).not.toHaveBeenCalled();
    client.change({ ...workflow(), name: 'Disposed edit' });
    await client.create('Disposed create');
    await client.load();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.create).not.toHaveBeenCalled();
    expect(api.list).toHaveBeenCalledTimes(2);
  });
});
