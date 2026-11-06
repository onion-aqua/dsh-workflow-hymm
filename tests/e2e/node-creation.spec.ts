import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Workflow } from '../../src/shared/model.ts';
import { addTaskNode, addUtilityNode, blankPoint, flowNode, selectWorkflow, taskNodes, waitSaved, waitViewportSettled } from './helpers.ts';

test.use({ viewport: { width: 1700, height: 1050 }, locale: 'zh-CN', colorScheme: 'dark' });
test.beforeEach(async ({ page }) => {
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT, 'Requires an explicitly isolated Host storage root.');
  expect(resolve(process.env.WORKFLOW_STORAGE_ROOT!).toLowerCase()).not.toBe(resolve(homedir(), '.dsh', 'storages').toLowerCase());
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(开始使用|Get started|Get Started)$/ }), async dialog => { await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click(); });
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(预览版说明|Preview.*)$/ }), async dialog => { await dialog.getByRole('button', { name: /^(继续|Continue)$/ }).click(); });
});

async function stored(id: string): Promise<Workflow> {
  const root = process.env.WORKFLOW_STORAGE_ROOT;
  if (!root) throw new Error('Node creation tests require isolated storage');
  return JSON.parse(await readFile(join(root, 'visual_workflow.json'), 'utf8')).tables.workflows[id];
}
async function open(page: Page, navigate = true) {
  if (navigate) await page.goto(process.env.WORKFLOW_ENTRY_URL ?? '/');
  await expect.poll(async () => await page.getByTestId('workflow-panel').isVisible() || await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if (!await page.getByTestId('workflow-panel').isVisible()) await page.getByTestId('workflow-return').click();
  await expect(page.getByTestId('node-create-toggle')).toBeEnabled();
}
async function fresh(page: Page) {
  await open(page);
  const picker = page.getByTestId('workflow-select'), before = await picker.inputValue();
  await page.getByTestId('add-workflow').click();
  await expect(picker).not.toHaveValue(before);
  await waitSaved(page);
  return picker.inputValue();
}
async function clear(page: Page) { const p = await blankPoint(page, true); await page.mouse.click(p.x, p.y); }
async function finishNewTitle(page: Page) {
  const title = page.locator('[data-testid^="inline-title-"]');
  if (await title.isVisible()) await title.press('Enter');
  await waitSaved(page);
}

test('node creation menu reveals peer choices beside the plus and closes after selection, Escape or outside click', async ({ page }, testInfo) => {
  const mutations: string[] = [];
  page.on('request', request => { if (/\/api\/visualWorkflow\/(?:run|batchRun|generatePlan)(?:\?|$)/.test(request.url())) mutations.push(request.url().split('?')[0]!); });
  const workflowId = await fresh(page), toggle = page.getByTestId('node-create-toggle'), menu = page.getByTestId('node-create-menu');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeHidden();
  await expect(page.locator('.wf-tool-dock>button[data-testid="add-utility-node"]')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId('add-node')).toHaveRole('menuitem');
  await expect(menu.getByTestId('add-utility-node')).toHaveRole('menuitem');
  await expect.poll(async () => {
    const trigger = await toggle.boundingBox(), task = await menu.getByTestId('add-node').boundingBox(), utility = await menu.getByTestId('add-utility-node').boundingBox();
    return Boolean(trigger && task && utility && task.x > trigger.x + trigger.width && utility.x > trigger.x + trigger.width);
  }).toBe(true);
  const triggerBox = await toggle.boundingBox(), taskBox = await menu.getByTestId('add-node').boundingBox(), utilityBox = await menu.getByTestId('add-utility-node').boundingBox();
  expect(triggerBox && taskBox && utilityBox).toBeTruthy();
  expect(taskBox!.x).toBeGreaterThan(triggerBox!.x);
  expect(utilityBox!.x).toBeGreaterThan(triggerBox!.x);
  await page.screenshot({ path: testInfo.outputPath('node-create-options.png') });
  await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.press('ArrowDown'); await expect(menu.getByTestId('add-node')).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(menu.getByTestId('add-utility-node')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(menu).toBeHidden(); await expect(toggle).toBeFocused();
  for (const key of ['Enter', 'Space']) { await toggle.press(key); await expect(menu.getByTestId('add-node')).toBeFocused(); await page.keyboard.press('Escape'); await expect(menu).toBeHidden(); await expect(toggle).toBeFocused(); }
  await toggle.click(); await expect(menu).toBeVisible(); await clear(page); await expect(menu).toBeHidden();
  await addTaskNode(page); await expect(taskNodes(page)).toHaveCount(1); await expect(menu).toBeHidden(); await finishNewTitle(page);
  await addUtilityNode(page); await expect(page.locator('[data-testid^="utility-node-"]')).toHaveCount(1); await expect(menu).toBeHidden(); await waitSaved(page);
  const saved = await stored(workflowId);
  expect(saved.nodes).toHaveLength(1); expect(saved.utilityNodes).toHaveLength(1); expect(saved.edges).toHaveLength(0); expect(saved.executions ?? []).toHaveLength(0);
  expect(mutations).toEqual([]);
});

test('blank canvas creation menu places an unconnectable utility at the clicked flow coordinate after zoom', async ({ page }) => {
  const workflowId = await fresh(page);
  await page.getByRole('button', { name: 'Zoom Out', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom Out', exact: true }).click();
  await waitViewportSettled(page);
  const point = await blankPoint(page, true);
  const expected = await page.getByTestId('workflow-canvas').evaluate((canvas, p) => {
    const rect = canvas.getBoundingClientRect(), viewport = canvas.querySelector('.react-flow__viewport');
    if (!viewport) throw new Error('Missing viewport');
    const m = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    return { x: (p.x - rect.left - m.e) / m.a, y: (p.y - rect.top - m.f) / m.d };
  }, point);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  const menu = page.getByTestId('workflow-context-menu'); await expect(menu).toBeVisible();
  await expect(menu.getByTestId('context-add-node')).toBeEnabled();
  await menu.getByTestId('context-add-utility-node').click(); await expect(menu).toBeHidden(); await waitSaved(page);
  const saved = await stored(workflowId), utility = saved.utilityNodes![0]!;
  expect(saved.utilityNodes).toHaveLength(1); expect(saved.nodes).toHaveLength(0); expect(saved.edges).toHaveLength(0); expect(saved.executions ?? []).toHaveLength(0);
  expect(utility.position.x).toBeCloseTo(Math.round(expected.x), 0);
  expect(utility.position.y).toBeCloseTo(Math.round(expected.y), 0);
  await page.getByTestId('fit-view').click(); await waitViewportSettled(page);
  const node = page.getByTestId(`utility-node-${utility.id}`); await expect(node).toBeVisible();
  await expect(node.locator('.react-flow__handle')).toHaveCount(0);
  await expect(flowNode(page, utility.id)).not.toHaveClass(/(?:^|\s)connectable(?:\s|$)/);
});

test('utility header drag selects the node, saves movement and restores its geometry after refresh', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const workflowId = await fresh(page); await addUtilityNode(page); await waitSaved(page);
  const original = (await stored(workflowId)).utilityNodes![0]!, id = original.id, node = page.getByTestId(`utility-node-${id}`);
  await expect(node).toBeVisible();
  const handle = node.locator('.wf-utility-drag-space'), box = await handle.boundingBox();
  expect(box).toBeTruthy(); expect(box!.width).toBeGreaterThan(80);
  const zoom = await page.locator('.react-flow__viewport').evaluate(e => new DOMMatrixReadOnly(getComputedStyle(e).transform).a);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 150, box!.y + box!.height / 2 + 95, { steps: 16 }); await page.mouse.up();
  await expect(node).toHaveClass(/is-selected/); await waitSaved(page);
  await expect.poll(async () => (await stored(workflowId)).utilityNodes![0]!.position.x).toBeGreaterThan(original.position.x + 80 / zoom);
  const moved = (await stored(workflowId)).utilityNodes![0]!;
  // Browser mouse events round half-pixel header coordinates to device pixels.
  expect(Math.abs(moved.position.x - (original.position.x + 150 / zoom))).toBeLessThanOrEqual(1 / zoom);
  expect(Math.abs(moved.position.y - (original.position.y + 95 / zoom))).toBeLessThanOrEqual(1 / zoom);
  await expect(page.getByTestId('run-selected')).toContainText('0');
  await expect(node.locator('.react-flow__handle')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(node).not.toHaveClass(/is-selected/); await node.locator('.wf-utility-drag-space').click(); await expect(node).toHaveClass(/is-selected/);
  await node.getByTestId(`utility-title-${id}`).fill('与任务平行的多功能节点'); await waitSaved(page);
  expect((await stored(workflowId)).utilityNodes![0]!.position).toEqual(moved.position);
  await node.getByTestId(`utility-tab-browser-${id}`).click(); await waitSaved(page);
  expect((await stored(workflowId)).utilityNodes![0]!.position).toEqual(moved.position);
  await page.screenshot({ path: testInfo.outputPath('utility-selected-and-dragged.png') });
  await page.reload(); await open(page, false); await selectWorkflow(page, workflowId);
  await expect(page.getByTestId(`utility-node-${id}`)).toBeVisible();
  const restored = (await stored(workflowId)).utilityNodes![0]!;
  expect(restored.position).toEqual(moved.position); expect(restored.width).toBe(moved.width); expect(restored.height).toBe(moved.height);
  expect(restored.title).toBe('与任务平行的多功能节点'); expect(restored.activeTool).toBe('browser'); expect((await stored(workflowId)).executions ?? []).toHaveLength(0); expect(errors).toEqual([]);
});

test('node creation controls remain usable with reduced motion in a narrow window', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 900, height: 700 }); await fresh(page);
  await page.getByTestId('node-create-toggle').click(); const menu = page.getByTestId('node-create-menu'); await expect(menu).toBeVisible();
  for (const id of ['add-node', 'add-utility-node']) expect(await menu.getByTestId(id).evaluate(element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })).toBe(true);
  await menu.getByTestId('add-utility-node').click(); await expect(menu).toBeHidden(); await expect(page.locator('[data-testid^="utility-node-"]')).toHaveCount(1); await waitSaved(page);
});
