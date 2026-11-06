import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Workflow } from '../../src/shared/model.ts';
import { addTaskNode, blankPoint, contextMenu, flowNode, focusTask, inlineEdit, inspectorFor, selectWorkflow, taskNode, taskNodes, waitSaved, waitViewportSettled } from './helpers.ts';

test.use({ viewport: { width: 1540, height: 980 }, locale: 'zh-CN', colorScheme: 'dark' });
test.beforeEach(async ({ page }) => {
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(开始使用|Get started|Get Started)$/ }), async dialog => {
    await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click();
  });
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(预览版说明|Preview.*)$/ }), async dialog => {
    await dialog.getByRole('button', { name: /^(继续|Continue)$/ }).click();
  });
});

async function open(page: Page, navigate = true) {
  if (navigate) await page.goto(process.env.WORKFLOW_ENTRY_URL ?? '/');
  const panel = page.getByTestId('workflow-panel');
  await expect.poll(async () => await panel.isVisible() || await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if (!(await panel.isVisible())) await page.getByTestId('workflow-return').click();
  await expect(page.getByTestId('add-workflow')).toBeEnabled();
}
async function fresh(page: Page) {
  await open(page);
  const picker = page.getByTestId('workflow-select');
  const previous = await picker.inputValue();
  await page.getByTestId('add-workflow').click();
  await expect.poll(() => picker.inputValue()).not.toBe(previous);
  await waitSaved(page);
  await expect(taskNodes(page)).toHaveCount(0);
  return picker.inputValue();
}
async function add(page: Page, title = 'Inline task', instruction = 'A user-authored instruction') {
  const before = await taskNodes(page).count();
  await addTaskNode(page);
  await expect(taskNodes(page)).toHaveCount(before + 1);
  const id = await taskNodes(page).last().getAttribute('data-node-id');
  if (!id) throw new Error('A new task requires a domain identity');
  await inlineEdit(page, id, 'title', title);
  await inlineEdit(page, id, 'instruction', instruction);
  return id;
}
async function restore(page: Page, workflowId: string) {
  await page.reload();
  await open(page, false);
  await selectWorkflow(page,workflowId);
}
async function stored(workflowId: string): Promise<Workflow> {
  const root = process.env.WORKFLOW_STORAGE_ROOT ?? resolve('artifacts/dsh-home/storages');
  const document = JSON.parse(await readFile(join(root, 'visual_workflow.json'), 'utf8')) as { tables: { workflows: Record<string, Workflow> } };
  const workflow = document.tables.workflows[workflowId];
  if (!workflow) throw new Error('The isolated native Host must have durably saved this Workflow');
  return workflow;
}
async function screenshot(page: Page, name: string) {
  const directory = resolve('../../outputs/screenshots');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `inline-context-${name}.png`) });
}

test('header title edits in place and body double-click opens a private editor; save persists and Escape cancels both', async ({ page }) => {
  const workflowId = await fresh(page);
  const id = await add(page);
  await expect(page.getByTestId('inspector')).toHaveCount(0);
  const position = await flowNode(page, id).evaluate(element => (element as HTMLElement).style.transform);
  await inlineEdit(page, id, 'title', 'Saved by blur', 'blur');
  await inlineEdit(page, id, 'instruction', 'Saved by Ctrl+Enter\nSecond instruction line');
  await taskNode(page, id).getByTestId(`node-title-${id}`).click();
  const title = page.getByTestId(`inline-title-${id}`);
  await expect(title).toBeFocused();
  await title.fill('Cancelled title');
  await title.press('Escape');
  await expect(title).toHaveCount(0);
  await inlineEdit(page,id,'instruction','Cancelled instruction','Escape');
  await expect(taskNode(page, id).getByTestId(`node-title-${id}`)).toHaveText('Saved by blur');
  await expect(taskNode(page, id)).toContainText('Saved by Ctrl+Enter');
  await expect(taskNode(page, id)).not.toContainText('Cancelled');
  expect(await flowNode(page, id).evaluate(element => (element as HTMLElement).style.transform)).toBe(position);
  await restore(page, workflowId);
  await expect(taskNode(page, id)).toContainText('Saved by blur');
  await expect(taskNode(page, id)).toContainText('Second instruction line');
  await expect(taskNode(page, id)).not.toContainText('Cancelled');
  await taskNode(page, id).getByTestId(`node-instruction-${id}`).click();
  await expect(page.getByTestId('node-text-editor')).toHaveCount(0);
  await taskNode(page, id).getByTestId(`node-instruction-${id}`).dblclick();
  await expect(page.getByTestId('editor-text')).toBeFocused();
  await page.getByTestId('editor-text').click({ button: 'right' });
  await expect(page.getByTestId('workflow-context-menu')).toHaveCount(0); // Native text editing context stays native.
  await page.keyboard.press('Escape');
  if (await page.getByTestId('editor-text').isVisible()) await page.getByTestId('editor-text').press('Escape');
  await screenshot(page, 'inline-edit');
});

test('header drag and dependency handles still work after inline edits; rename uses the inline title', async ({ page }) => {
  const workflowId = await fresh(page);
  const first = await add(page, 'Drag from header');
  const second = await add(page, 'Dependency destination');
  await page.getByTestId('fit-view').click();
  await waitViewportSettled(page);
  await expect.poll(() => taskNode(page, first).isVisible()).toBe(true);
  const before = await flowNode(page, first).evaluate(element => (element as HTMLElement).style.transform);
  const header = await taskNode(page, first).locator('.wf-task-top').boundingBox();
  if (!header) throw new Error('Task header is required for dragging');
  await page.mouse.move(header.x + 5, header.y + 13);
  await page.mouse.down();
  await page.mouse.move(header.x + 75, header.y + 58, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => flowNode(page, first).evaluate(element => (element as HTMLElement).style.transform)).not.toBe(before);
  await waitSaved(page);
  const output = await page.getByTestId(`source-handle-${first}`).boundingBox();
  const input = await page.getByTestId(`target-handle-${second}`).boundingBox();
  if (!output || !input) throw new Error('Both dependency handles must remain visible');
  await page.mouse.move(output.x + output.width / 2, output.y + output.height / 2);
  await page.mouse.down();
  await page.mouse.move(input.x + input.width / 2, input.y + input.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await waitSaved(page);
  const menu = await contextMenu(page, first);
  await menu.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await expect(page.getByTestId(`inline-title-${first}`)).toBeFocused();
  await inlineEdit(page, first, 'title', 'Renamed in the canvas');
  await restore(page, workflowId);
  await expect(taskNode(page, first)).toContainText('Renamed in the canvas');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('node and canvas context menus stay inside the canvas and close with Escape or outside clicks', async ({ page }) => {
  await fresh(page);
  const id = await add(page, 'Context actions');
  let menu = await contextMenu(page, id);
  await expect(menu.getByRole('menuitem', { name: '创建副本', exact: true })).toBeEnabled();
  await expect(menu.getByRole('menuitem', { name: '任务详情', exact: true })).toBeEnabled();
  await screenshot(page, 'node-menu');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  const point = await blankPoint(page, true);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  menu = page.getByTestId('workflow-context-menu');
  await expect(menu).toBeVisible();
  const canvas = await page.getByTestId('workflow-canvas').boundingBox();
  const box = await menu.boundingBox();
  expect(canvas).not.toBeNull(); expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(canvas!.x);
  expect(box!.y).toBeGreaterThanOrEqual(canvas!.y);
  expect(box!.x + box!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(canvas!.y + canvas!.height + 1);
  await screenshot(page, 'menu-edge');
  await focusTask(page, id);
  await expect(menu).toHaveCount(0);
  menu = await contextMenu(page, id);
  const blank = await blankPoint(page);
  await page.mouse.click(blank.x, blank.y);
  await expect(menu).toHaveCount(0);
});

test('duplicate and copy/paste create only fresh Draft task text and never copy native identities or approval', async ({ page }) => {
  const workflowId = await fresh(page);
  const original = await add(page, 'Copy this task', 'Preserve only the user task text');
  await expect(page.getByTestId(`node-run-${original}`)).toBeEnabled();
  await expect(page.getByTestId('approve-node')).toHaveCount(0);
  const before = await stored(workflowId);
  await (await contextMenu(page, original)).getByRole('menuitem', { name: '创建副本', exact: true }).click();
  await expect(taskNodes(page)).toHaveCount(2);
  await page.keyboard.press('Escape');
  await waitSaved(page);
  await (await contextMenu(page, original)).getByRole('menuitem', { name: '复制节点', exact: true }).click();
  const blank = await blankPoint(page, true);
  await page.mouse.click(blank.x, blank.y, { button: 'right' });
  await page.getByTestId('workflow-context-menu').getByRole('menuitem', { name: '粘贴节点', exact: true }).click();
  await expect(taskNodes(page)).toHaveCount(3);
  await page.keyboard.press('Escape');
  await waitSaved(page);
  const workflow = await stored(workflowId);
  const copies = workflow.nodes.filter(node => node.id !== original);
  expect(copies).toHaveLength(2);
  for (const copy of copies) {
    expect(copy).toMatchObject({ instruction: 'Preserve only the user task text', status: 'draft', revision: 1 });
    expect(copy.title).toContain('Copy this task');
    expect(copy.sourceSessionId).toBeUndefined();
    expect(copy.answerSummary).toBeUndefined();
    expect(copy.originPlanId).toBeUndefined();
    expect(workflow.executions?.some(run => run.nodeId === copy.id)).toBe(false);
    expect(workflow.approvals?.some(approval => approval.nodeId === copy.id)).toBe(false);
  }
  expect(workflow.executions).toEqual(before.executions);
  expect(workflow.branches).toEqual(before.branches);
  expect(workflow.plans).toEqual(before.plans);
  await restore(page, workflowId);
  await expect(taskNodes(page)).toHaveCount(3);
  await screenshot(page, 'draft-copies');
});

test('removing a draft hides incident dependencies and layer order persists across reload', async ({ page }) => {
  const workflowId = await fresh(page);
  const first = await add(page, 'Foreground task');
  const second = await add(page, 'Draft to delete');
  await page.getByTestId('fit-view').click();
  await waitViewportSettled(page);
  const output = await page.getByTestId(`source-handle-${first}`).boundingBox();
  const input = await page.getByTestId(`target-handle-${second}`).boundingBox();
  if (!output || !input) throw new Error('Need two visible dependency handles');
  await page.mouse.move(output.x + output.width / 2, output.y + output.height / 2);
  await page.mouse.down();
  await page.mouse.move(input.x + input.width / 2, input.y + input.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await waitSaved(page);
  await (await contextMenu(page, first)).getByRole('menuitem', { name: '图层置顶', exact: true }).click();
  await waitSaved(page);
  const raised = (await stored(workflowId)).nodes.find(node => node.id === first)!;
  expect(raised.zIndex).toBeGreaterThan(0);
  await restore(page, workflowId);
  expect((await stored(workflowId)).nodes.find(node => node.id === first)!.zIndex).toBe(raised.zIndex);
  const blank = await blankPoint(page);
  await page.mouse.click(blank.x, blank.y);
  expect(Number(await flowNode(page, first).evaluate(element => (element as HTMLElement).style.zIndex))).toBe(raised.zIndex);
  await (await contextMenu(page, second)).getByRole('menuitem', { name: '从画布移除', exact: true }).click();
  await expect(taskNodes(page)).toHaveCount(1);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await waitSaved(page);
  await restore(page, workflowId);
  await expect(taskNode(page, second)).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  const hidden=await stored(workflowId);expect(hidden.edges).toHaveLength(1);expect(hidden.nodes.find(node=>node.id===second)?.hidden).toBe(true);await page.getByTestId('restore-hidden').click();await expect(taskNode(page,second)).toBeVisible();await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('source roots remain protected while completed execution cards can be hidden and restored with their history', async ({ page }) => {
  await open(page);
  await selectWorkflow(page,'');
  await page.getByTestId('auto-layout').click();await waitViewportSettled(page);
  const roots = page.locator('[data-testid^="session-node-"]');
  await expect.poll(() => roots.count()).toBeGreaterThan(0);
  await roots.first().locator('.wf-task-top').click({ button: 'right', position: { x: 5, y: 12 } });
  const menu = page.getByTestId('workflow-context-menu');
  await expect(menu.getByRole('menuitem', { name: '从画布移除', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  const workflowId = await fresh(page);
  const instruction='MODEL_FAILURE Reply without tools.';
  const id = await add(page, 'Native execution history', instruction);
  if(process.env.WORKFLOW_EXPECT_NO_MODEL==='1'){await expect(page.getByTestId(`node-run-${id}`)).toBeDisabled();expect((await stored(workflowId)).executions??[]).toEqual([]);return;}
  await page.getByTestId(`node-run-${id}`).click();
  await expect(page.getByTestId(`node-status-${id}`)).toHaveAttribute('data-state','failed', { timeout: 30000 });
  await expect((await contextMenu(page, id)).getByRole('menuitem', { name: '从画布移除', exact: true })).toBeEnabled();
  const before = await stored(workflowId);
  expect(before.executions).toHaveLength(1);
  const sourceSession = before.executions![0]!.sessionId;
  await page.getByTestId('workflow-context-menu').getByRole('menuitem', { name: '创建副本', exact: true }).click();
  await page.keyboard.press('Escape');
  await waitSaved(page);
  await (await contextMenu(page, id)).getByRole('menuitem', { name: '复制节点', exact: true }).click();
  const blank = await blankPoint(page, true);
  await page.mouse.click(blank.x, blank.y, { button: 'right' });
  await page.getByTestId('workflow-context-menu').getByRole('menuitem', { name: '粘贴节点', exact: true }).click();
  await page.keyboard.press('Escape');
  await waitSaved(page);
  const after = await stored(workflowId);
  expect(after.executions).toEqual(before.executions);
  expect(after.branches!.map(branch => ({ id: branch.id, sessionId: branch.sessionId })))
    .toEqual(before.branches!.map(branch => ({ id: branch.id, sessionId: branch.sessionId })));
  expect(after.executions![0]!.sessionId).toBe(sourceSession);
  for (const copy of after.nodes.filter(node => node.id !== id)) {
    expect(copy).toMatchObject({ status: 'draft', revision: 1, instruction });
    expect(copy.answerSummary).toBeUndefined();
    expect(copy.sourceSessionId).toBeUndefined();
    expect(after.approvals!.some(approval => approval.nodeId === copy.id)).toBe(false);
    expect(after.executions!.some(run => run.nodeId === copy.id)).toBe(false);
  }
  await expect(taskNodes(page)).toHaveCount(3);
  await (await contextMenu(page,id)).getByRole('menuitem',{name:'从画布移除',exact:true}).click();await expect(taskNode(page,id)).toHaveCount(0);await waitSaved(page);const hidden=await stored(workflowId);expect(hidden.executions).toEqual(after.executions);expect(hidden.branches).toEqual(after.branches);expect(hidden.nodes.find(node=>node.id===id)?.hidden).toBe(true);await page.getByTestId('restore-hidden').click();await expect(taskNode(page,id)).toBeVisible();expect((await stored(workflowId)).executions).toEqual(after.executions);
});
