import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Execution, Workflow } from '../../src/shared/model.ts';
import { addTaskNode, blankPoint, focusTask, inlineEdit, inspectorFor, selectBranch, selectModel, selectWorkflow, taskNode, taskNodes, waitSaved } from './helpers.ts';

test.use({ viewport: { width: 1700, height: 1050 }, locale: 'zh-CN', colorScheme: 'dark' });

test.beforeEach(async ({ page }) => {
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(开始使用|Get started|Get Started)$/ }), async dialog => { await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click(); });
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(预览版说明|Preview.*)$/ }), async dialog => { await dialog.getByRole('button', { name: /^(继续|Continue)$/ }).click(); });
});

async function open(page: Page, navigate = true) {
  if (navigate) await page.goto(process.env.WORKFLOW_ENTRY_URL ?? '/');
  await expect.poll(async () => await page.getByTestId('workflow-panel').isVisible() || await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if (!await page.getByTestId('workflow-panel').isVisible()) await page.getByTestId('workflow-return').click();
  await expect(page.getByTestId('add-workflow')).toBeEnabled();
}

async function stored(id: string): Promise<Workflow> {
  const root = process.env.WORKFLOW_STORAGE_ROOT;
  if (!root) throw new Error('Branch execution regression requires an explicitly isolated storage root');
  return JSON.parse(await readFile(join(root, 'visual_workflow.json'), 'utf8')).tables.workflows[id];
}

async function add(page: Page, title: string, instruction: string) {
  const count = await taskNodes(page).count();
  await addTaskNode(page);
  await expect(taskNodes(page)).toHaveCount(count + 1);
  const id = await taskNodes(page).last().getAttribute('data-node-id');
  if (!id) throw new Error('Expected a task identity');
  await inlineEdit(page, id, 'title', title);
  await inlineEdit(page, id, 'instruction', instruction);
  return id;
}

async function move(page: Page, id: string, x: number, y: number) {
  const header = await taskNode(page, id).locator('.wf-task-top').boundingBox();
  if (!header) throw new Error('Expected a visible task header');
  await page.mouse.move(header.x + 5, header.y + 12);
  await page.mouse.down();
  await page.mouse.move(x + 5, y + 12, { steps: 12 });
  await page.mouse.up();
  await waitSaved(page);
}

async function connect(page: Page, source: string, target: string) {
  const before = await page.locator('.react-flow__edge').count();
  const start = await page.getByTestId(`source-handle-${source}`).boundingBox();
  const end = await page.getByTestId(`target-handle-${target}`).boundingBox();
  if (!start || !end) throw new Error('Expected visible native canvas connection handles');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 18 });
  await expect(page.getByTestId('workflow-connection-path')).toBeAttached();
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(before + 1);
  await waitSaved(page);
}

async function inspectExecution(page: Page, nodeId: string, execution: Execution) {
  await inspectorFor(page, nodeId);
  await expect(page.getByTestId('inspector').locator('.wf-context-session-id code')).toHaveText(execution.sessionId);
  await page.getByTestId('inspector-toggle').click();
  await expect(page.getByTestId('inspector')).toHaveCount(0);
  await page.getByTestId('trace-entry').click();
  const trace = page.getByTestId('trace-panel');
  await expect(trace).toBeVisible();
  await expect(trace.locator('.wf-trace-header .wf-tag')).toHaveClass(/wf-tag--completed/);
  await expect(trace.locator('.wf-trace-step-heading').first()).toBeVisible();
  await expect(trace.locator('.wf-trace-terminal code')).toHaveText('completed');
  await page.getByTestId('trace-close').click();
}

test('canvas fan-out creates independent native Sessions and branch-scoped traces survive reload', async ({ page }) => {
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT || process.env.WORKFLOW_EXPECT_NO_MODEL === '1', 'Requires an explicit isolated host with the workflow-test local native adapter.');
  test.setTimeout(120000);
  expect(resolve(process.env.WORKFLOW_STORAGE_ROOT!)).not.toBe(resolve(homedir(), '.dsh', 'storages'));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const picker = page.getByTestId('workflow-select');
  const before = await picker.inputValue();
  await page.getByTestId('add-workflow').click();
  await expect(picker).not.toHaveValue(before);
  const workflowId = await picker.inputValue();
  await page.getByTestId('workflow-name-input').fill('原生分支上下文隔离回归');
  await page.getByTestId('workflow-name-input').press('Enter');
  await waitSaved(page);

  // Explicitly choose the local adapter before any Run; this test never uses
  // whatever paid or personal model might otherwise be configured by default.
  const localModel = JSON.stringify(['workflow-test', 'model-a']);
  await expect.poll(() => page.getByTestId('global-model-picker').locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toContain(localModel);
  await selectModel(page, 'global-model-picker', localModel);
  await waitSaved(page);
  const a = await add(page, '共同前驱 A', 'BROWSER_BRANCH_COMMON_A: reply briefly without tools.');
  await move(page, a, 350, 420);
  const b = await add(page, '独立左路 B', 'BROWSER_BRANCH_LEFT_B: reply briefly without tools.');
  await move(page, b, 980, 230);
  const c = await add(page, '独立右路 C', 'BROWSER_BRANCH_RIGHT_C: reply briefly without tools.');
  await move(page, c, 980, 650);
  await connect(page, a, b);
  await connect(page, a, c);
  expect((await stored(workflowId)).edges.map(edge => [edge.source, edge.target])).toEqual(expect.arrayContaining([[a, b], [a, c]]));

  const blank = await blankPoint(page);
  await page.mouse.click(blank.x, blank.y);
  await page.keyboard.press('Control+a');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(3);
  await expect(page.getByTestId('run-selected')).toContainText('3');
  await expect(page.getByTestId('run-selected')).toBeEnabled();
  await page.getByTestId('run-selected').click();
  await expect.poll(async () => (await stored(workflowId)).executions?.length, { timeout: 30000 }).toBe(3);
  await expect.poll(async () => (await stored(workflowId)).executions!.every(run => run.status === 'completed' && run.durability === 'durable'), { timeout: 30000 }).toBe(true);
  const done = await stored(workflowId);
  const common = done.executions!.find(run => run.nodeId === a)!;
  const left = done.executions!.find(run => run.nodeId === b)!;
  const right = done.executions!.find(run => run.nodeId === c)!;
  expect(new Set([common.sessionId, left.sessionId, right.sessionId]).size).toBe(3);
  for (const run of [left, right]) expect(done.branches!.find(branch => branch.id === run.branchId)).toMatchObject({ automatic: true, sourceSessionId: common.sessionId, forkBoundarySeq: common.endSeq });
  expect(done.activeBranchId).toBe(common.branchId);
  expect(done.branches!.find(branch => branch.id === common.branchId)?.automatic).not.toBe(true);
  await expect(page.getByTestId('branch-select')).toHaveValue(common.branchId);
  for (const id of [a, b, c]) await expect(page.getByTestId(`node-status-${id}`)).toHaveAttribute('data-state', 'completed');
  await inspectExecution(page, b, left);
  await inspectExecution(page, c, right);

  await selectBranch(page, left.branchId);
  await waitSaved(page);
  await expect.poll(async () => (await stored(workflowId)).activeBranchId).toBe(left.branchId);
  await inspectExecution(page, b, left);
  // The card may remain on the canvas. Its sibling execution must not appear
  // in this path's trace history or be offered as the active conversation.
  await focusTask(page, c);
  await page.getByTestId('trace-entry').click();
  await expect(page.getByTestId('trace-panel')).toBeVisible();
  await expect(page.getByTestId('trace-empty')).toBeVisible();
  await expect(page.getByTestId('trace-panel').locator('.wf-trace-step-heading')).toHaveCount(0);
  await expect(page.getByTestId('trace-panel').locator('.wf-trace-terminal')).toHaveCount(0);
  await page.getByTestId('trace-close').click();

  const mapping = done.executions!.map(run => ({ runId: run.runId, requestId: run.requestId, nodeId: run.nodeId, sessionId: run.sessionId, branchId: run.branchId }));
  await page.reload();
  await open(page, false);
  await selectWorkflow(page, workflowId);
  await expect(page.getByTestId('branch-select')).toHaveValue(left.branchId);
  expect((await stored(workflowId)).executions!.map(run => ({ runId: run.runId, requestId: run.requestId, nodeId: run.nodeId, sessionId: run.sessionId, branchId: run.branchId }))).toEqual(mapping);
  await inspectExecution(page, b, left);
  await selectBranch(page, common.branchId);
  await waitSaved(page);
  await inspectExecution(page, c, right);
  expect((await stored(workflowId)).executions).toHaveLength(3);

  // Keep the old trace open while the Host routes an explicitly selected
  // automatic branch to a new native rerun. The panel must replace an execution
  // that is no longer visible, rather than keep a permanent loading indicator.
  await selectBranch(page, left.branchId);
  await waitSaved(page);
  await focusTask(page, b);
  await page.getByTestId('trace-entry').click();
  const trace = page.getByTestId('trace-panel');
  await expect(trace.locator('.wf-trace-header .wf-tag')).toHaveClass(/wf-tag--completed/);
  await expect(trace.locator('.wf-trace-step-heading').first()).toBeVisible();
  await page.getByTestId(`node-run-${b}`).click();
  await expect.poll(async () => (await stored(workflowId)).executions!.filter(run => run.nodeId === b).length).toBe(2);
  await expect.poll(async () => (await stored(workflowId)).executions!.findLast(run => run.nodeId === b)?.status).toBe('completed');
  const rerun = (await stored(workflowId)).executions!.findLast(run => run.nodeId === b)!;
  expect(rerun.runId).not.toBe(left.runId);
  expect(rerun.sessionId).not.toBe(left.sessionId);
  await expect(page.getByTestId('branch-select')).toHaveValue(rerun.branchId);
  await expect(trace).toBeVisible();
  await expect(trace.locator('.wf-trace-loading')).toHaveCount(0);
  await expect(trace.locator('.wf-trace-header .wf-tag')).toHaveClass(/wf-tag--completed/);
  await expect(trace.locator('.wf-trace-step-heading').first()).toBeVisible();
  // This branch has one visible B execution. If history is selectable, it must
  // point to that execution; a single-record view intentionally has no picker.
  if (await trace.getByTestId('execution-select').count()) {
    await expect(trace.getByTestId('execution-select')).toHaveValue(rerun.runId);
    expect(await trace.getByTestId('execution-select').locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).not.toContain(left.runId);
  }
  await page.getByTestId('trace-close').click();
  await inspectExecution(page, b, rerun);
  expect((await stored(workflowId)).executions!.find(run => run.runId === left.runId)).toMatchObject({ sessionId: left.sessionId, status: 'completed' });

  // Editing a shared upstream task invalidates derived results without
  // rewriting their historical completed executions or removing the answers.
  await selectBranch(page, common.branchId);
  await waitSaved(page);
  await inlineEdit(page, a, 'instruction', 'BROWSER_BRANCH_COMMON_A_UPDATED: revised upstream requirement; reply briefly without tools.');
  await expect.poll(async () => (await stored(workflowId)).nodes.filter(node => [b, c].includes(node.id)).every(node => node.resultStale === true)).toBe(true);
  for (const id of [b, c]) {
    await expect(page.getByTestId(`node-status-${id}`)).toHaveAttribute('data-state', 'stale');
    await expect(page.getByTestId(`node-status-${id}`)).toHaveText('结果已过期');
    await expect(taskNode(page, id).locator('.wf-answer-summary')).toBeVisible();
  }
  await inspectorFor(page, b);
  await expect(page.getByTestId('result-stale-notice')).toContainText('重跑');
  await expect(page.getByTestId('inspector').locator('.wf-context-session-id code')).toHaveText(rerun.sessionId);
  expect((await stored(workflowId)).executions!.every(run => run.status === 'completed')).toBe(true);
  await page.getByTestId('inspector-toggle').click();
  expect(errors).toEqual([]);
});
