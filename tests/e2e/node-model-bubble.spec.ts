import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Workflow } from '../../src/shared/model.ts';
import { addTaskNode, blankPoint, focusTask, inlineEdit, selectModel, selectWorkflow, taskNode, taskNodes, waitSaved, waitViewportSettled } from './helpers.ts';

test.use({ viewport: { width: 1700, height: 1050 }, locale: 'zh-CN', colorScheme: 'dark' });
const modelB = { provider: 'workflow-test', model: 'model-b' };
const keyB = JSON.stringify([modelB.provider, modelB.model]);

test.beforeEach(async ({ page }) => {
  test.skip(process.env.WORKFLOW_EXPECT_NO_MODEL === '1', 'Requires only the registered local model catalog.');
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(开始使用|Get started|Get Started)$/ }), async dialog => {
    await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click();
  });
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(预览版说明|Preview.*)$/ }), async dialog => {
    await dialog.getByRole('button', { name: /^(继续|Continue)$/ }).click();
  });
});

async function open(page: Page, navigate = true) {
  if (navigate) await page.goto(process.env.WORKFLOW_ENTRY_URL ?? '/');
  await expect.poll(async () => await page.getByTestId('workflow-panel').isVisible() || await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if (!await page.getByTestId('workflow-panel').isVisible()) await page.getByTestId('workflow-return').click();
}

async function fresh(page: Page) {
  await open(page);
  const picker = page.getByTestId('workflow-select'), previous = await picker.inputValue();
  await page.getByTestId('add-workflow').click();
  await expect(picker).not.toHaveValue(previous);
  await page.getByTestId('workflow-name-input').fill('节点模型独立气泡');
  await page.getByTestId('workflow-name-input').press('Enter');
  await waitSaved(page);
  await addTaskNode(page);
  await expect(taskNodes(page)).toHaveCount(1);
  const id = await taskNodes(page).last().getAttribute('data-node-id');
  if (!id) throw new Error('Missing task identity');
  await inlineEdit(page, id, 'title', '模型气泡与执行过程');
  await inlineEdit(page, id, 'instruction', '模型选择独立放在节点右下方。正文不再为模型栏预留空间，本测试不会执行 Agent。');
  return { workflowId: await picker.inputValue(), id };
}

async function stored(id: string): Promise<Workflow> {
  const directory = process.env.WORKFLOW_STORAGE_ROOT ?? resolve('artifacts/dsh-home/storages');
  return JSON.parse(await readFile(join(directory, 'visual_workflow.json'), 'utf8')).tables.workflows[id];
}

async function move(page: Page, id: string, x: number, y: number) {
  const header = await taskNode(page, id).locator('.wf-task-top').boundingBox();
  if (!header) throw new Error('Missing task header');
  await page.mouse.move(header.x + 5, header.y + 12);
  await page.mouse.down();
  await page.mouse.move(x + 5, y + 12, { steps: 12 });
  await page.mouse.up();
  await waitSaved(page);
}

async function clear(page: Page) {
  const point = await blankPoint(page, true);
  await page.mouse.click(point.x, point.y);
}

async function attached(page: Page, id: string) {
  const bubble = taskNode(page, id).locator('.wf-node-model-bubble');
  await expect(bubble).toBeVisible();
  const geometry = await taskNode(page, id).evaluate(element => {
    const body = element.querySelector<HTMLElement>('.wf-task-body')!;
    const bubble = element.querySelector<HTMLElement>('.wf-node-model-bubble')!;
    const content = body.querySelector<HTMLElement>('.wf-task-content')!;
    const articleRect = element.getBoundingClientRect(), bodyRect = body.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect(), contentRect = content.getBoundingClientRect();
    return {
      outsideBody: !body.contains(bubble), directChild: bubble.parentElement === element,
      scale: articleRect.width / (element as HTMLElement).offsetWidth,
      bodyBottom: bodyRect.bottom, bodyRight: bodyRect.right, bodyHeight: bodyRect.height,
      bubbleTop: bubbleRect.top, bubbleRight: bubbleRect.right,
      bodyPaddingBottom: Number.parseFloat(getComputedStyle(body).paddingBottom), contentHeight: contentRect.height,
    };
  });
  expect(geometry.outsideBody).toBe(true);
  expect(geometry.directChild).toBe(true);
  expect(geometry.bubbleTop).toBeGreaterThan(geometry.bodyBottom);
  expect(Math.abs(geometry.bubbleRight - geometry.bodyRight)).toBeLessThan(1.6);
  expect(Math.abs(geometry.bubbleTop - geometry.bodyBottom - 12 * geometry.scale)).toBeLessThan(2);
  // The body must offer its height to text rather than retaining the old 33px model footer reservation.
  expect(geometry.bodyPaddingBottom).toBeLessThan(2);
  expect(geometry.bodyHeight - geometry.contentHeight).toBeLessThan(3 * geometry.scale);
  await expect(taskNode(page, id).locator('.wf-task-body .wf-model-picker')).toHaveCount(0);
  await separated(bubble, page.getByTestId(`node-resize-${id}`));
}

async function separated(first: Locator, second: Locator) {
  const a = await first.boundingBox(), b = await second.boundingBox();
  if (!a || !b) throw new Error('Both controls must be visible for an overlap check');
  const intersectionWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const intersectionHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  expect(intersectionWidth * intersectionHeight).toBeLessThan(1);
}

async function bubbleReceivesPointer(page: Page, id: string) {
  expect(await taskNode(page, id).locator('.wf-node-model-bubble').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit?.closest('.wf-model-picker') && element.contains(hit) && !hit.closest('.wf-group-border'));
  })).toBe(true);
}

async function boundedMenu(page: Page, id: string) {
  const menu = page.getByTestId(`node-model-${id}-options`);
  await page.getByTestId(`node-model-${id}-trigger`).click();
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(element => element.parentElement === document.body)).toBe(true);
  const bounds = await menu.boundingBox(), viewport = page.viewportSize();
  if (!bounds || !viewport) throw new Error('Missing model-menu or viewport geometry');
  expect(bounds.x).toBeGreaterThanOrEqual(7);
  expect(bounds.y).toBeGreaterThanOrEqual(7);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 7);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 7);
  await expect(menu.getByRole('option', { selected: true })).toHaveAttribute('data-value', keyB);
  return menu;
}

test('the task model bubble stays outside and right-aligned through focus, resize, drag, zoom, collapse and persisted reload without running', async ({ page }) => {
  test.setTimeout(90000);
  const submissions: string[] = [];
  page.on('request', request => {
    if (/\/api\/visualWorkflow\/(?:run|batchRun|plan)(?:\?|$)/.test(request.url())) submissions.push(request.url());
  });
  const { workflowId, id } = await fresh(page);
  await move(page, id, 400, 260);
  await clear(page);
  await expect(taskNode(page, id)).not.toHaveClass(/is-focused|is-selected/);
  await expect(page.getByTestId('trace-entry')).toHaveCount(0);
  await expect(page.getByTestId(`node-model-${id}`)).toHaveValue('');
  await attached(page, id);

  await focusTask(page, id);
  await expect(page.getByTestId('trace-entry')).toBeVisible();
  await separated(taskNode(page, id).locator('.wf-node-model-bubble'), page.getByTestId('trace-entry'));
  await selectModel(page, `node-model-${id}`, keyB);
  await waitSaved(page);
  await expect.poll(async () => (await stored(workflowId)).nodes.find(node => node.id === id)?.model).toEqual(modelB);
  await boundedMenu(page, id);
  await page.keyboard.press('Escape');

  const beforeMove = await taskNode(page, id).boundingBox();
  await move(page, id, 620, 330);
  expect((await taskNode(page, id).boundingBox())!.x).toBeGreaterThan(beforeMove!.x + 100);
  await attached(page, id);
  const beforeResize = await taskNode(page, id).boundingBox(), grip = await page.getByTestId(`node-resize-${id}`).boundingBox();
  if (!beforeResize || !grip) throw new Error('Missing task resize geometry');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 110, grip.y + grip.height / 2 + 85, { steps: 16 });
  await page.mouse.up();
  await expect.poll(async () => (await taskNode(page, id).boundingBox())!.width).toBeGreaterThan(beforeResize.width + 60);
  await waitSaved(page);
  await attached(page, id);
  await separated(taskNode(page, id).locator('.wf-node-model-bubble'), page.getByTestId('trace-entry'));

  const viewport = page.locator('.react-flow__viewport'), beforeZoom = await viewport.getAttribute('style');
  const movingMenu = await boundedMenu(page, id);
  const point = await blankPoint(page, true);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, 160);
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(beforeZoom);
  await expect(movingMenu).toHaveCount(0);
  await waitViewportSettled(page);
  await attached(page, id);
  await bubbleReceivesPointer(page, id);
  await boundedMenu(page, id);
  await page.keyboard.press('Escape');
  await separated(taskNode(page, id).locator('.wf-node-model-bubble'), page.getByTestId('trace-entry'));

  await page.getByTestId(`node-collapse-${id}`).click();
  await expect(taskNode(page, id)).toHaveClass(/is-collapsed/);
  await expect(taskNode(page, id).locator('.wf-node-model-bubble')).toHaveCount(0);
  await expect(page.getByTestId(`node-model-${id}`)).toHaveCount(0);
  await page.getByTestId(`node-collapse-${id}`).click();
  await expect(taskNode(page, id)).not.toHaveClass(/is-collapsed/);
  await attached(page, id);
  await expect(page.getByTestId(`node-model-${id}`)).toHaveValue(keyB);
  await waitSaved(page);
  const saved = (await stored(workflowId)).nodes.find(node => node.id === id)!;

  await page.reload();
  await open(page, false);
  await selectWorkflow(page, workflowId);
  await expect(taskNodes(page)).toHaveCount(1);
  await expect(page.getByTestId(`node-model-${id}`)).toHaveValue(keyB);
  await attached(page, id);
  expect((await stored(workflowId)).nodes.find(node => node.id === id)).toEqual(saved);
  await focusTask(page, id);
  await separated(taskNode(page, id).locator('.wf-node-model-bubble'), page.getByTestId('trace-entry'));
  // Move near the right edge so the portal must respect the browser boundary.
  const taskBounds = await taskNode(page, id).boundingBox();
  if (!taskBounds) throw new Error('Missing restored task geometry');
  await move(page, id, 1700 - taskBounds.width - 28, 270);
  await attached(page, id);
  const menu = await boundedMenu(page, id);
  await mkdir(resolve('../../outputs/screenshots'), { recursive: true });
  await page.screenshot({ path: resolve('../../outputs/screenshots/model-bubble-0.11.2.png') });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(submissions).toEqual([]);
  const final = await stored(workflowId);
  expect(final.executions ?? []).toEqual([]);
  expect(final.nodes.find(node => node.id === id)?.model).toEqual(modelB);
});

test('a two-task group leaves its model bubbles above the bottom border and lets each picker receive clicks', async ({ page }) => {
  const submissions: string[] = [];
  page.on('request', request => {
    if (/\/api\/visualWorkflow\/(?:run|batchRun|plan)(?:\?|$)/.test(request.url())) submissions.push(request.url());
  });
  const { workflowId, id: a } = await fresh(page);
  await addTaskNode(page);
  await expect(taskNodes(page)).toHaveCount(2);
  const b = await taskNodes(page).last().getAttribute('data-node-id');
  if (!b) throw new Error('Missing second task identity');
  await inlineEdit(page, b, 'title', '分组中的第二个模型气泡');
  await move(page, a, 330, 320);
  await move(page, b, 850, 320);
  await clear(page);
  await taskNode(page, a).locator('.wf-task-body').click({ position: { x: 35, y: 45 } });
  await page.keyboard.down('Shift');
  await taskNode(page, b).locator('.wf-task-body').click({ position: { x: 35, y: 45 } });
  await page.keyboard.up('Shift');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await page.getByTestId('group-selection').click();
  await waitSaved(page);
  await expect.poll(async () => (await stored(workflowId)).groups?.length).toBe(1);
  const group = (await stored(workflowId)).groups![0]!;
  expect(new Set(group.nodeIds)).toEqual(new Set([a, b]));
  await clear(page);

  for (const id of [a, b]) {
    await attached(page, id);
    const frame = await page.getByTestId(`node-group-${group.id}`).boundingBox();
    const bubble = await taskNode(page, id).locator('.wf-node-model-bubble').boundingBox();
    const scale = await taskNode(page, id).evaluate(element => element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth);
    if (!frame || !bubble) throw new Error('Missing group or model-bubble geometry');
    expect(frame.y + frame.height - bubble.y - bubble.height).toBeGreaterThan(8 * scale);
    await bubbleReceivesPointer(page, id);
    await page.getByTestId(`node-model-${id}-trigger`).click();
    await expect(page.getByTestId(`node-model-${id}-options`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(`node-model-${id}-options`)).toHaveCount(0);
  }
  expect(submissions).toEqual([]);
  expect((await stored(workflowId)).executions ?? []).toEqual([]);
});
