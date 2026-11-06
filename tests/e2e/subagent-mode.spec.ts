import { expect, test, type Page } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Execution, Workflow } from '../../src/shared/model.ts';
import { addTaskNode, blankPoint, focusTask, inlineEdit, selectBranch, selectModel, selectWorkflow, taskNode, taskNodes, waitSaved } from './helpers.ts';

test.use({ viewport: { width: 1700, height: 1050 }, locale: 'zh-CN', colorScheme: 'dark' });
const localModel = { provider: 'workflow-test', model: 'model-a' };
const localModelKey = JSON.stringify([localModel.provider, localModel.model]);

function storageRoot(): string {
  if (!process.env.WORKFLOW_STORAGE_ROOT) throw new Error('Native subagent browser tests require explicitly isolated storage');
  return resolve(process.env.WORKFLOW_STORAGE_ROOT);
}
function sessionsRoot(): string { return resolve(process.env.WORKFLOW_SESSION_ROOT ?? join(storageRoot(), '..', 'sessions')); }

test.beforeEach(async ({ page }) => {
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT || process.env.WORKFLOW_EXPECT_NO_MODEL === '1', 'Requires an isolated packaged Host with the workflow-test local native adapter.');
  test.setTimeout(90000);
  expect(storageRoot().toLowerCase()).not.toBe(resolve(homedir(), '.dsh', 'storages').toLowerCase());
  expect(sessionsRoot().toLowerCase()).not.toBe(resolve(homedir(), '.dsh', 'sessions').toLowerCase());
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(开始使用|Get started|Get Started)$/ }), async dialog => { await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click(); });
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(预览版说明|Preview.*)$/ }), async dialog => { await dialog.getByRole('button', { name: /^(继续|Continue)$/ }).click(); });
});

async function open(page: Page, navigate = true): Promise<void> {
  if (navigate) await page.goto(process.env.WORKFLOW_ENTRY_URL ?? '/');
  await expect.poll(async () => await page.getByTestId('workflow-panel').isVisible() || await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if (!await page.getByTestId('workflow-panel').isVisible()) await page.getByTestId('workflow-return').click();
  await expect(page.getByTestId('add-workflow')).toBeEnabled();
}
async function stored(id: string): Promise<Workflow> {
  return JSON.parse(await readFile(join(storageRoot(), 'visual_workflow.json'), 'utf8')).tables.workflows[id] as Workflow;
}
async function createWorkflow(page: Page, name: string): Promise<string> {
  await open(page);
  const picker = page.getByTestId('workflow-select'), previous = await picker.inputValue();
  await page.getByTestId('add-workflow').click();
  await expect(picker).not.toHaveValue(previous);
  await page.getByTestId('workflow-name-input').fill(name);
  await page.getByTestId('workflow-name-input').press('Enter');
  await waitSaved(page);
  const id = await picker.inputValue();
  // Always choose the test transport through its visible UI before Run. The
  // test never inherits a personal or paid model from the Host defaults.
  await expect.poll(() => page.getByTestId('global-model-picker').locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toContain(localModelKey);
  await selectModel(page, 'global-model-picker', localModelKey);
  await waitSaved(page);
  expect((await stored(id)).settings?.model).toEqual(localModel);
  return id;
}
async function addTask(page: Page, title: string, token: string, x: number, y: number): Promise<string> {
  const count = await taskNodes(page).count();
  await addTaskNode(page);
  await expect(taskNodes(page)).toHaveCount(count + 1);
  const id = await taskNodes(page).last().getAttribute('data-node-id');
  if (!id) throw new Error('Expected a new UI task identity');
  await inlineEdit(page, id, 'title', title);
  await inlineEdit(page, id, 'instruction', `SUBAGENT_PARALLEL_TEST ${token}: reply briefly without tools or file changes.`);
  const header = await taskNode(page, id).locator('.wf-task-top').boundingBox();
  if (!header) throw new Error('Expected a draggable task header');
  await page.mouse.move(header.x + 5, header.y + 12);
  await page.mouse.down();
  await page.mouse.move(x + 5, y + 12, { steps: 12 });
  await page.mouse.up();
  await waitSaved(page);
  return id;
}
async function chooseMode(page: Page, workflowId: string, mode: 'off' | 'on' | 'auto'): Promise<void> {
  await page.getByTestId('subagent-mode-trigger').click();
  await page.getByTestId(`subagent-mode-${mode}`).click();
  await expect(page.getByTestId('subagent-mode-menu')).toHaveCount(0);
  await waitSaved(page);
  await expect.poll(async () => (await stored(workflowId)).settings?.subagents ?? 'off').toBe(mode);
}
async function runSelected(page: Page, ids: readonly string[]): Promise<void> {
  const point = await blankPoint(page, true);
  await page.mouse.click(point.x, point.y);
  for (const [index, id] of ids.entries()) {
    if (index) await page.keyboard.down('Shift');
    try { await taskNode(page, id).locator('.wf-task-body').click({ position: { x: 35, y: 45 } }); }
    finally { if (index) await page.keyboard.up('Shift'); }
  }
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(ids.length);
  await expect(page.getByTestId('run-selected')).toContainText(String(ids.length));
  await expect(page.getByTestId('run-selected')).toBeEnabled();
  await page.getByTestId('run-selected').click();
}
async function simultaneous(workflowId: string, ids: readonly string[], childCount: number): Promise<Workflow> {
  let observed: Workflow | undefined;
  await expect.poll(async () => {
    const snapshot = await stored(workflowId), runs = snapshot.executions ?? [];
    const ready = runs.length === ids.length && ids.every(id => runs.some(run => run.nodeId === id)) &&
      runs.every(run => run.status === 'running') && runs.filter(run => run.subagent).length === childCount &&
      runs.filter(run => run.subagent).every(run => Boolean(run.subagent?.messageId));
    if (ready) observed = snapshot;
    return ready;
  }, { timeout: 20000, intervals: [25, 50, 100] }).toBe(true);
  if (!observed) throw new Error('Expected one native storage snapshot containing all active executions');
  return observed;
}
async function completed(workflowId: string, count: number): Promise<Workflow> {
  await expect.poll(async () => {
    const runs = (await stored(workflowId)).executions ?? [];
    return runs.length === count && runs.every(run => run.status === 'completed' && run.durability === 'durable');
  }, { timeout: 30000, intervals: [100, 200, 400] }).toBe(true);
  return stored(workflowId);
}
interface NativeRecord { type: string; id?: string; parentSession?: string; origin?: string; data?: unknown }
async function nativeSession(id: string): Promise<{ path: string; records: NativeRecord[]; raw: string }> {
  const entries = await readdir(sessionsRoot(), { recursive: true, withFileTypes: true });
  const file = entries.filter(entry => entry.isFile() && basename(entry.parentPath) === id && entry.name.endsWith('.jsonl')).sort((a, b) => b.name.localeCompare(a.name))[0];
  if (!file) throw new Error(`Native JSONL Session ${id} was not materialized under the isolated session root`);
  const path = join(file.parentPath, file.name), raw = await readFile(path, 'utf8');
  return { path, raw, records: raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as NativeRecord) };
}
async function readTrace(page: Page, run: Execution): Promise<void> {
  await selectBranch(page, run.branchId);
  await waitSaved(page);
  await focusTask(page, run.nodeId);
  await page.getByTestId('trace-entry').click();
  const trace = page.getByTestId('trace-panel');
  await expect(trace).toBeVisible();
  await expect(trace.locator('.wf-trace-header .wf-tag')).toHaveClass(/wf-tag--completed/);
  await expect(trace.locator('.wf-trace-step-heading').first()).toBeVisible();
  await expect(trace.locator('.wf-trace-terminal code')).toHaveText('completed');
  await page.getByTestId('trace-close').click();
}

test('mode defaults off, keyboard selection persists, and On runs two real native child Agents concurrently', async ({ page }) => {
  const workflowId = await createWorkflow(page, '子智能体开启与真实并行');
  await expect(page.getByTestId('subagent-mode-trigger')).toContainText('关闭');
  expect((await stored(workflowId)).settings?.subagents ?? 'off').toBe('off');
  await page.getByTestId('subagent-mode-trigger').focus();
  await page.keyboard.press('Enter');
  const menu = page.getByTestId('subagent-mode-menu');
  await expect(menu.getByRole('menuitemradio')).toHaveCount(3);
  await expect(page.getByTestId('subagent-mode-off')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('End');
  await expect(page.getByTestId('subagent-mode-auto')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByTestId('subagent-mode-off')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('subagent-mode-on')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await waitSaved(page);
  await expect.poll(async () => (await stored(workflowId)).settings?.subagents).toBe('on');
  await page.reload();
  await open(page, false);
  await selectWorkflow(page, workflowId);
  await expect(page.getByTestId('subagent-mode-trigger')).toContainText('开启');
  await expect(page.getByTestId('global-model-picker')).toHaveValue(localModelKey);

  const a = await addTask(page, '独立子任务 A', 'CHILD_ONLY_A', 330, 330);
  const b = await addTask(page, '独立子任务 B', 'CHILD_ONLY_B', 900, 330);
  expect((await stored(workflowId)).edges).toEqual([]);
  await runSelected(page, [a, b]);
  const active = await simultaneous(workflowId, [a, b], 2), activeRuns = active.executions!;
  expect(new Set(activeRuns.map(run => run.sessionId)).size).toBe(2);
  expect(new Set(activeRuns.map(run => run.subagent!.parentSessionId)).size).toBe(2);
  expect(activeRuns.every(run => run.subagent?.provider === 'fork' && run.admissionPolicies?.subagents === 'on')).toBe(true);
  expect(activeRuns.every(run => run.resolvedModel?.provider === localModel.provider && run.resolvedModel.model === localModel.model)).toBe(true);
  const done = await completed(workflowId, 2);
  const childPaths: string[] = [];
  for (const run of done.executions!) {
    const child = await nativeSession(run.sessionId), parent = await nativeSession(run.subagent!.parentSessionId);
    childPaths.push(child.path);
    expect(child.records[0]).toMatchObject({ type: 'session', id: run.sessionId, origin: 'subagent', parentSession: run.subagent!.parentSessionId });
    expect(child.raw).toContain(JSON.stringify(run.subagent!.messageId));
    expect(child.raw).toContain(run.nodeId === a ? 'CHILD_ONLY_A' : 'CHILD_ONLY_B');
    expect(child.raw).not.toContain(run.nodeId === a ? 'CHILD_ONLY_B' : 'CHILD_ONLY_A');
    expect(parent.records[0]?.id).toBe(run.subagent!.parentSessionId);
    expect(parent.records.some(record => record.type === 'turn/start')).toBe(false);
    await readTrace(page, run);
  }
  expect(new Set(childPaths).size).toBe(2);
  expect((await stored(workflowId)).executions).toHaveLength(2);
});

test('Auto runs a normal Agent with one independent native child and never executes an unselected task', async ({ page }) => {
  const workflowId = await createWorkflow(page, '子智能体自动决定与用户选择范围');
  await chooseMode(page, workflowId, 'auto');
  const a = await addTask(page, '自动模式主任务', 'AUTO_MAIN_A', 330, 300);
  const b = await addTask(page, '自动模式独立任务', 'AUTO_PARALLEL_B', 900, 300);
  const untouched = await addTask(page, '未选择任务不得执行', 'MUST_NOT_RUN_C', 600, 640);
  expect((await stored(workflowId)).edges).toEqual([]);
  await runSelected(page, [a, b]);
  const active = await simultaneous(workflowId, [a, b], 1);
  expect(active.executions!.filter(run => !run.subagent)).toHaveLength(1);
  expect(active.executions!.filter(run => run.subagent)).toHaveLength(1);
  expect(new Set(active.executions!.map(run => run.sessionId)).size).toBe(2);
  expect(active.executions!.every(run => run.admissionPolicies?.subagents === 'auto')).toBe(true);
  expect(active.executions!.some(run => run.nodeId === untouched)).toBe(false);
  const done = await completed(workflowId, 2);
  for (const run of done.executions!) {
    expect(run.resolvedModel).toEqual(localModel);
    if (run.subagent) expect((await nativeSession(run.sessionId)).records[0]).toMatchObject({ id: run.sessionId, origin: 'subagent', parentSession: run.subagent.parentSessionId });
    await readTrace(page, run);
  }
  // Compare results in the manual overview. A child history prefix can omit
  // its independent sibling and display a derived approval state instead.
  const overview = done.branches?.find(branch => branch.automatic !== true);
  if (!overview) throw new Error('Expected a manual overview branch for the completed batch');
  await selectBranch(page, overview.id);
  await waitSaved(page);
  await expect.poll(async () => (await stored(workflowId)).activeBranchId).toBe(overview.id);
  for (const id of [a, b]) await expect(page.getByTestId(`node-status-${id}`)).toHaveAttribute('data-state', 'completed');
  await expect(page.getByTestId(`node-status-${untouched}`)).toHaveAttribute('data-state', 'draft');
  const beforeOff = await stored(workflowId);
  await chooseMode(page, workflowId, 'off');
  const afterOff = await stored(workflowId);
  expect(afterOff.executions).toEqual(beforeOff.executions);
  expect(afterOff.nodes).toEqual(beforeOff.nodes);
  expect(afterOff.executions!.some(run => run.nodeId === untouched)).toBe(false);
  expect(afterOff.settings?.subagents).toBe('off');
});
