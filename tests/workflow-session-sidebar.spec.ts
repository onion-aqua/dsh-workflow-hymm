// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowSessionSidebar, type WorkflowSessionSidebarProps } from '../src/client/WorkflowSessionSidebar.tsx';
import { translateZh } from '../src/client/locales.ts';
import type { Workflow } from '../src/shared/model.ts';

interface SessionRow { id: string; title: string; updatedAt: number; blank: boolean; running: boolean; retainedBy: { mainView?: number }; origin?: string }
const workflow = (id: string, name = id): Workflow => ({ id, name, schemaVersion: 2, revision: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1, branches: [{ id: `${id}-main`, label: '主线', sessionId: `${id}-session`, nodeIds: [], createdAt: 1 }] });
const session = (id: string, extra: Partial<SessionRow> = {}): SessionRow => ({ id, title: `Native ${id}`, updatedAt: 1, blank: false, running: false, retainedBy: {}, ...extra });
let root: Root, container: HTMLDivElement;
let graphs: { workflows: Workflow[]; loading: boolean; error?: string };
let list: { ids: string[]; byId: Record<string, SessionRow>; phase: string; error?: {message:string} | null };
let native: { items: Array<{ workspaceId: string; title: string; path: string; sessionIds: string[] }>; archivedSessionIds: string[]; pinnedSessionIds: string[]; phase: string };
let statuses: Map<string, { pendingInteraction?: string; running?: boolean; completionUnread?: boolean }>;
let callbacks: ReturnType<typeof actions>;
let wide: boolean, panel: string | null;
function actions() { return { onOpenSession: vi.fn(), onOpenWorkflow: vi.fn(), onUseNativeDirectory: vi.fn(), onPinSession: vi.fn(async (_id: string, _pinned: boolean) => {}), onArchiveSession: vi.fn(async (_id: string, _archived: boolean) => {}), expandSidebar: vi.fn() }; }
function rows(...values: SessionRow[]) { list = { ...list, ids: values.map(row => row.id), byId: Object.fromEntries(values.map(row => [row.id, row])) }; }
function byId(id: string) { return container.querySelector<HTMLElement>(`[data-testid="${id}"]`); }
async function click(element: HTMLElement | null) { expect(element).not.toBeNull(); await act(async () => { element!.click(); await Promise.resolve(); }); }
async function render() {
  const props = {
    t: translateZh, wide, ...callbacks,
    useWorkflow: <T,>(select: (value: typeof graphs) => T) => select(graphs),
    useSessions: <T,>(select: (value: typeof list) => T) => select(list),
    useWorkspaces: <T,>(select: (value: typeof native) => T) => select(native),
    useSessionStatus: <T,>(select: (value: typeof statuses) => T) => select(statuses),
    usePanelInfo: <T,>(select: (value: { activePanelId: typeof panel }) => T) => select({ activePanelId: panel }),
  } as unknown as WorkflowSessionSidebarProps;
  await act(async () => root.render(createElement(WorkflowSessionSidebar, props)));
}
async function search(value: string) {
  const input = byId('sidebar-workflow-search') as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function menu(sessionId: string) { await click(byId(`sidebar-session-${sessionId}`)?.querySelector<HTMLElement>('.wf-directory-row-menu') ?? null); }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  graphs = { workflows: [workflow('a', 'Same name'), workflow('b', 'Same name')], loading: false };
  native = { items: [], archivedSessionIds: [], pinnedSessionIds: [], phase: 'ready' };
  list = { ids: [], byId: {}, phase: 'ready' }; rows(session('a-session'), session('b-session'));
  statuses = new Map(); callbacks = actions(); wide = true; panel = null;
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); vi.restoreAllMocks(); });

describe('Workflow names in the native conversation directory', () => {
  it('keeps equally named workflows distinct, responds to renaming and opens the exact Session or workflow identity', async () => {
    await render();
    const a = byId('sidebar-group-workflow:a')!, b = byId('sidebar-group-workflow:b')!;
    expect(a.querySelector('.wf-directory-group-toggle span')?.textContent).toBe('Same name');
    expect(b.querySelector('.wf-directory-group-toggle span')?.textContent).toBe('Same name');
    await click(a.querySelector('.wf-directory-session-open')); expect(callbacks.onOpenSession).toHaveBeenCalledExactlyOnceWith('a-session');
    await click(byId('sidebar-canvas-b')); expect(callbacks.onOpenWorkflow).toHaveBeenCalledExactlyOnceWith('b');
    graphs = { ...graphs, workflows: [{ ...graphs.workflows[0]!, name: 'Renamed workflow' }, graphs.workflows[1]!] };
    await render(); expect(byId('sidebar-group-workflow:a')?.textContent).toContain('Renamed workflow'); expect(byId('sidebar-group-workflow:b')?.textContent).toContain('Same name');
    expect(byId('sidebar-session-a-session')).not.toBeNull();
  });

  it('retains native workspace membership and loose conversations without guessing from their titles', async () => {
    graphs = { ...graphs, workflows: [{ ...workflow('a', 'Same name'), sourceSessionId: 'imported' }] };
    rows(session('a-session'), session('loose', { title: 'Same name · #4 Looks like a workflow task' }), session('imported'), session('native-workspace-session'));
    native = { ...native, items: [{ workspaceId: 'real', title: 'Real workspace', path: 'C:/actual', sessionIds: ['native-workspace-session', 'imported'] }] };
    await render();
    expect(byId('sidebar-group-workflow:a')?.querySelectorAll('.wf-directory-row')).toHaveLength(1);
    expect(byId('sidebar-group-workspace:real')?.textContent).toContain('Native imported');
    expect(byId('sidebar-group-workspace:real')?.querySelector('.wf-directory-group-toggle')?.getAttribute('title')).toBe('C:/actual');
    expect(byId('sidebar-group-other')?.textContent).toContain('Same name · #4 Looks like a workflow task');
    expect(native.items[0]?.sessionIds).toEqual(['native-workspace-session', 'imported']);
  });

  it('temporarily reveals collapsed matches during search and restores each group expansion state afterwards', async () => {
    await render(); await click(byId('sidebar-group-workflow:a')?.querySelector('.wf-directory-group-toggle') ?? null);
    expect(byId('sidebar-session-a-session')).toBeNull(); expect(byId('sidebar-session-b-session')).not.toBeNull();
    await search('native a-session'); expect(byId('sidebar-session-a-session')).not.toBeNull(); expect(byId('sidebar-group-workflow:b')).toBeNull();
    await search(''); expect(byId('sidebar-session-a-session')).toBeNull(); expect(byId('sidebar-session-b-session')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('dsh-visual-workflow.session-groups.v1')!)).toEqual({ 'workflow:a': false });
    await search('same name'); expect(container.querySelectorAll('.wf-directory-group')).toHaveLength(2);
    await act(async () => byId('sidebar-workflow-search')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect((byId('sidebar-workflow-search') as HTMLInputElement).value).toBe(''); expect(byId('sidebar-session-a-session')).toBeNull();
  });

  it('hides archived rows by default and restores through the real Session id without opening an archived Session', async () => {
    native = { ...native, archivedSessionIds: ['a-session'] }; await render(); expect(byId('sidebar-session-a-session')).toBeNull();
    await click(container.querySelector('[aria-label="显示已归档对话"]')); expect(byId('sidebar-session-a-session')?.className).toContain('is-archived');
    const open = byId('sidebar-session-a-session')?.querySelector<HTMLButtonElement>('.wf-directory-session-open')!;
    expect(open.disabled).toBe(true); await click(open); expect(callbacks.onOpenSession).not.toHaveBeenCalled();
    await menu('a-session'); expect((byId('context-sidebar-open') as HTMLButtonElement).disabled).toBe(true); expect((byId('context-sidebar-pin') as HTMLButtonElement).disabled).toBe(true);
    await click(byId('context-sidebar-archive')); expect(callbacks.onArchiveSession).toHaveBeenCalledExactlyOnceWith('a-session', false);
    native = { ...native, archivedSessionIds: [] }; await render(); expect((byId('sidebar-session-a-session')?.querySelector('.wf-directory-session-open') as HTMLButtonElement).disabled).toBe(false);
    await menu('a-session'); await click(byId('context-sidebar-archive')); expect(callbacks.onArchiveSession).toHaveBeenLastCalledWith('a-session', true);
  });

  it('shows native waiting, running and unread states with the active Session and pinned order', async () => {
    rows(session('a-session', { updatedAt: 9, retainedBy: { mainView: 1 } }), session('b-session', { updatedAt: 2 }), session('loose-old', { updatedAt: 1 }), session('loose-new', { updatedAt: 8, running: true }));
    native = { ...native, pinnedSessionIds: ['loose-old'] };
    statuses = new Map([['a-session', { pendingInteraction: 'question', running: true }], ['b-session', { completionUnread: true }]]); await render();
    expect(byId('sidebar-session-a-session')?.querySelector('.wf-directory-status')?.className).toContain('is-waiting');
    expect(byId('sidebar-session-a-session')?.querySelector('.wf-directory-session-open')?.getAttribute('aria-current')).toBe('page');
    expect(byId('sidebar-session-b-session')?.querySelector('.wf-directory-status')?.className).toContain('is-unread');
    expect(byId('sidebar-session-loose-new')?.querySelector('.wf-directory-status')?.className).toContain('is-running');
    expect([...byId('sidebar-group-other')!.querySelectorAll('.wf-directory-row')].map(item => item.getAttribute('data-testid'))).toEqual(['sidebar-session-loose-old', 'sidebar-session-loose-new']);
    panel = 'visual-workflow'; await render(); expect(byId('sidebar-session-a-session')?.querySelector('[aria-current="page"]')).toBeNull();
    await menu('loose-old'); await click(byId('context-sidebar-pin')); expect(callbacks.onPinSession).toHaveBeenCalledExactlyOnceWith('loose-old', false);
  });

  it('filters native hidden children and plugin-internal contexts while retaining the current blank Session', async () => {
    const a = { ...workflow('a'), uploadSessionId: 'upload', executions: [{ runId: 'child-run', nodeId: 'task', nodeRevision: 1, branchId: 'main', sessionId: 'child', requestId: 'request', status: 'running' as const, turns: [], createdAt: 1, updatedAt: 1, durability: 'pending' as const, subagent: { parentSessionId: 'coordinator', provider: 'fork' as const } }] };
    graphs = { ...graphs, workflows: [a] };
    rows(session('a-session'), session('upload'), session('child', { origin: 'subagent' }), session('coordinator'), session('blank', { blank: true }), session('current-blank', { blank: true, retainedBy: { mainView: 1 } }));
    await render();
    for (const id of ['upload', 'child', 'coordinator', 'blank']) expect(byId(`sidebar-session-${id}`)).toBeNull();
    expect(byId('sidebar-session-current-blank')?.textContent).toContain('新会话');
    expect(byId('sidebar-session-current-blank')?.querySelector('[aria-current="page"]')).not.toBeNull();
  });

  it('exposes loading and errors without presenting an empty result as a complete list', async () => {
    graphs = { ...graphs, loading: true }; await render(); expect(container.querySelector('[role="status"]')?.textContent).toBe(translateZh('loading')); expect(container.textContent).not.toContain('没有匹配的对话');
    graphs = { ...graphs, loading: false }; list = { ...list, phase: 'pending' }; await render(); expect(container.querySelector('[role="status"]')).not.toBeNull();
    list = { ...list, phase: 'ready' }; graphs = { ...graphs, error: 'Workflow catalogue failed' }; await render(); expect(container.querySelector('[role="alert"]')?.textContent).toBe('Workflow catalogue failed');
    await menu('a-session'); callbacks.onArchiveSession.mockRejectedValueOnce(new Error('Native refused active Session')); await click(byId('context-sidebar-archive'));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Native refused active Session'); expect(callbacks.onArchiveSession).toHaveBeenCalledOnce();
  });

  it('keeps native Ctrl+K and Ctrl+O shortcuts usable while the workflow directory is mounted', async () => {
    await render();
    await act(async () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(byId('sidebar-workflow-search'));
    (document.activeElement as HTMLElement)?.blur();
    await act(async () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true })));
    expect(callbacks.onUseNativeDirectory).toHaveBeenCalledOnce();
    const input=byId('sidebar-workflow-search') as HTMLInputElement;
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).not.toBe(input);
  });
  it('offers native directory switching independently of workflow contents and expands a collapsed sidebar', async () => {
    await render(); await click(byId('sidebar-native-directory')); expect(callbacks.onUseNativeDirectory).toHaveBeenCalledOnce();
    await menu('a-session'); await click(byId('context-sidebar-native')); expect(callbacks.onUseNativeDirectory).toHaveBeenCalledTimes(2);
    wide = false; await render(); expect(byId('workflow-session-directory')).toBeNull(); await click(container.querySelector('.wf-directory-rail')); expect(callbacks.expandSidebar).toHaveBeenCalledOnce();
  });
});
