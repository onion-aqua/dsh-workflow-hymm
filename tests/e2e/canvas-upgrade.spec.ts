import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Workflow } from '../../src/shared/model.ts';
import { addTaskNode, addUtilityNode, blankPoint, contextMenu, flowNode, focusTask, inlineEdit, selectModel, selectWorkflow, taskNode, taskNodes, waitSaved, waitViewportSettled } from './helpers.ts';

test.use({ viewport: { width: 1700, height: 1050 }, locale: 'zh-CN', colorScheme: 'dark' });
test.beforeEach(async ({ page }) => {
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT, 'Requires an explicitly isolated Host storage root.');
  expect(resolve(process.env.WORKFLOW_STORAGE_ROOT!).toLowerCase()).not.toBe(resolve(homedir(), '.dsh', 'storages').toLowerCase());
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(开始使用|Get started|Get Started)$/ }), async dialog => { await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click(); });
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(预览版说明|Preview.*)$/ }), async dialog => { await dialog.getByRole('button', { name: /^(继续|Continue)$/ }).click(); });
});

async function stored(id: string): Promise<Workflow> {
  const root = process.env.WORKFLOW_STORAGE_ROOT;
  if (!root) throw new Error('Canvas upgrade tests require isolated storage');
  return JSON.parse(await readFile(join(root, 'visual_workflow.json'), 'utf8')).tables.workflows[id];
}
async function open(page: Page, navigate = true) {
  if (navigate) await page.goto(process.env.WORKFLOW_ENTRY_URL ?? '/');
  await expect.poll(async () => await page.getByTestId('workflow-panel').isVisible() || await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if (!await page.getByTestId('workflow-panel').isVisible()) await page.getByTestId('workflow-return').click();
  await expect(page.getByTestId('add-workflow')).toBeEnabled();
}
async function fresh(page: Page, name: string): Promise<string> {
  await open(page);
  const picker = page.getByTestId('workflow-select'), before = await picker.inputValue();
  await page.getByTestId('add-workflow').click();
  await expect(picker).not.toHaveValue(before);
  await page.getByTestId('workflow-name-input').fill(name);
  await page.getByTestId('workflow-name-input').press('Enter');
  await waitSaved(page);
  return picker.inputValue();
}
async function add(page: Page, title: string, instruction = 'Reply briefly without tools or file changes.') {
  const before = await taskNodes(page).count();
  await addTaskNode(page);
  await expect(taskNodes(page)).toHaveCount(before + 1);
  const id = await taskNodes(page).last().getAttribute('data-node-id');
  if (!id) throw new Error('Missing new task identity');
  await inlineEdit(page, id, 'title', title);
  await inlineEdit(page, id, 'instruction', instruction);
  await expect(page.getByTestId(`node-display-id-${id}`)).toHaveText(/^#\d+$/);
  return id;
}
async function drag(page: Page, handle: Locator, dx: number, dy: number, point = { x: 5, y: 12 }) {
  const box = await handle.boundingBox();
  if (!box) throw new Error('Expected a visible drag handle');
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.mouse.down();
  await page.mouse.move(box.x + point.x + dx, box.y + point.y + dy, { steps: 16 });
  await page.mouse.up();
}
async function moveTask(page: Page, id: string, x: number, y: number) {
  const handle = taskNode(page, id).locator('.wf-task-top'), box = await handle.boundingBox();
  if (!box) throw new Error('Expected task header');
  await drag(page, handle, x - box.x, y - box.y);
  await waitSaved(page);
}
async function unobstructed(locator: Locator) {
  await expect(locator).toBeVisible();
  expect(await locator.evaluate(element => {
    const r = element.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.left >= -1 && r.right <= window.innerWidth + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1 && (top === element || Boolean(top && element.contains(top)));
  })).toBe(true);
}
async function chooseBranch(page: Page, id: string) {
  await page.getByTestId('branch-picker-trigger').click();
  const menu = page.getByTestId('branch-picker-options');
  await expect(menu).toBeVisible();
  await unobstructed(page.getByTestId(`branch-option-${id}`));
  await page.getByTestId(`branch-option-${id}`).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('branch-select')).toHaveValue(id);
  await waitSaved(page);
}
async function toolbarFits(page: Page, width: number, includeBranch = false) {
  const top = page.locator('.wf-studio-top');
  expect(await top.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.getByTestId('workflow-panel').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const ids = ['workflow-picker', 'add-workflow', ...(includeBranch ? ['branch-picker-trigger'] : []), 'access-mode-picker-trigger', 'global-model-picker-trigger', 'subagent-mode-trigger', 'run-selected', 'original-style'];
  const controls = ids.map(id => page.getByTestId(id));
  for (const control of controls) await unobstructed(control);
  const boxes = await Promise.all(controls.map(control => control.boundingBox()));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!, overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    expect(overlapWidth > 1 && overlapHeight > 1, `${ids[i]} overlaps ${ids[j]} at ${width}px`).toBe(false);
  }
}

test('native traces open below their entry, drag independently, and two pins retain separate run details outside focus', async ({ page }, testInfo) => {
  test.skip(process.env.WORKFLOW_EXPECT_NO_MODEL === '1', 'Requires the local workflow-test native model fixture.');
  test.setTimeout(120000);
  const workflowId = await fresh(page, '画布升级 · 双原生轨迹');
  const modelA = JSON.stringify(['workflow-test', 'model-a']), modelB = JSON.stringify(['workflow-test', 'model-b']);
  await expect.poll(() => page.getByTestId('global-model-picker').locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toContain(modelA);
  await selectModel(page, 'global-model-picker', modelA);
  await waitSaved(page);
  const a = await add(page, '轨迹 A'), b = await add(page, '轨迹 B');
  await moveTask(page, a, 300, 200);
  await moveTask(page, b, 1050, 200);
  await selectModel(page, `node-model-${b}`, modelB);
  await waitSaved(page);
  const blank = await blankPoint(page, true);
  await page.mouse.click(blank.x, blank.y);
  await taskNode(page, a).locator('.wf-task-body').click({ position: { x: 35, y: 45 } });
  await page.keyboard.down('Shift');
  await taskNode(page, b).locator('.wf-task-body').click({ position: { x: 35, y: 45 } });
  await page.keyboard.up('Shift');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await expect(page.getByTestId('run-selected')).toBeEnabled();
  await page.getByTestId('run-selected').click();
  await expect.poll(async () => {
    const runs = (await stored(workflowId)).executions ?? [];
    return runs.length === 2 && runs.every(run => run.status === 'completed' && run.durability === 'durable');
  }, { timeout: 40000 }).toBe(true);
  const done = await stored(workflowId), runA = done.executions!.find(run => run.nodeId === a)!, runB = done.executions!.find(run => run.nodeId === b)!;
  expect(runA.resolvedModel?.model).toBe('model-a');
  expect(runB.resolvedModel?.model).toBe('model-b');
  expect(runA.sessionId).not.toBe(runB.sessionId);
  const overview = done.branches!.find(branch => branch.automatic !== true)!;
  await chooseBranch(page, overview.id);
  await expect(page.getByTestId('branch-select')).toBeHidden();
  // The visible branch picker supports the same keyboard navigation as other canvas menus.
  await page.getByTestId('branch-picker-trigger').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('branch-picker-options')).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByTestId('branch-picker-options').getByRole('option').last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('branch-picker-trigger')).toBeFocused();
  await expect(page.getByTestId('branch-picker-options')).toHaveCount(0);
  for (const width of [780, 1024, 1280, 1700]) {
    await page.setViewportSize({ width, height: 1050 });
    await toolbarFits(page, width, true);
    await page.getByTestId('branch-picker-trigger').click();
    await unobstructed(page.getByTestId('branch-picker-options'));
    await page.keyboard.press('Escape');
    await page.screenshot({ path: testInfo.outputPath(`toolbar-with-branch-${width}.png`) });
  }

  const detailsRequests: string[] = [];
  page.on('request', request => { if (/\/api\/visualWorkflow\/details(?:\?|$)/.test(request.url())) detailsRequests.push(`${request.url()} ${request.postData() ?? ''}`); });
  await focusTask(page, a);
  await page.getByTestId('trace-entry').click();
  const panelA = page.getByTestId(`trace-position-${a}`), traceA = panelA.getByTestId('trace-panel');
  await expect(traceA.locator('.wf-trace-step-heading').first()).toBeVisible();
  const entryBox = await page.getByTestId('trace-entry').boundingBox(), beforeDrag = await panelA.boundingBox();
  expect(beforeDrag!.y).toBeGreaterThanOrEqual(entryBox!.y + entryBox!.height - 1);
  const geometry = await flowNode(page, a).getAttribute('style');
  await drag(page, traceA.locator('.wf-trace-header'), 130, -55, { x: 72, y: 15 });
  await expect.poll(async () => Math.round((await panelA.boundingBox())!.x - beforeDrag!.x)).toBe(130);
  expect(Math.abs((await panelA.boundingBox())!.y - beforeDrag!.y + 55)).toBeLessThanOrEqual(2);
  expect(await flowNode(page, a).getAttribute('style')).toBe(geometry);
  await expect(page.getByTestId(`node-trace-pin-${a}`)).toHaveCount(0);
  const pinBox = await page.getByTestId(`trace-pin-${a}`).boundingBox(), panelBox = await panelA.boundingBox();
  expect(pinBox!.y + pinBox!.height).toBeLessThanOrEqual(panelBox!.y);
  expect(Math.abs(pinBox!.x + pinBox!.width - panelBox!.x - panelBox!.width)).toBeLessThanOrEqual(1);
  await page.getByTestId(`trace-pin-${a}`).click();
  await expect(page.getByTestId(`trace-pin-${a}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(traceA.locator('.wf-trace-header strong')).toContainText('轨迹 A');
  // Focus B without closing the independent A pin, then pin B as well.
  await focusTask(page, b);
  await expect(traceA).toBeVisible();
  await page.getByTestId('trace-entry').click();
  await page.getByTestId(`trace-pin-${b}`).click();
  const panelB = page.getByTestId(`trace-position-${b}`), traceB = panelB.getByTestId('trace-panel');
  await expect(traceB.locator('.wf-trace-step-heading').first()).toBeVisible();
  const clear = await blankPoint(page, true);
  await page.mouse.click(clear.x, clear.y);
  await expect(page.getByTestId('trace-entry')).toHaveCount(0);
  await expect(page.getByTestId('trace-panel')).toHaveCount(2);
  for (const [trace, run, title] of [[traceA, runA, '轨迹 A'], [traceB, runB, '轨迹 B']] as const) {
    await expect(trace.locator('.wf-trace-header strong')).toContainText(title);
    await expect(trace.locator('.wf-trace-header .wf-tag')).toHaveClass(/wf-tag--completed/);
    await expect(trace.locator('.wf-trace-terminal code')).toHaveText('completed');
    await trace.locator('.wf-trace-step-heading').first().click();
    await expect.poll(() => detailsRequests.some(request => request.includes(run.runId))).toBe(true);
    await trace.locator('.wf-trace-more summary').first().click();
    await expect(trace.locator('.wf-trace-more')).toContainText('step/start');
    await expect(trace.locator('.wf-trace-detail-status.is-error')).toHaveCount(0);
  }
  // Reading B's details must leave A's own expanded native details mounted.
  await expect(traceA.locator('.wf-trace-step-heading').first()).toHaveAttribute('aria-expanded', 'true');
  await expect(traceA.locator('.wf-trace-more')).toContainText('step/start');
  await page.screenshot({ path: testInfo.outputPath('dual-native-pins.png') });
  await traceA.getByTestId('trace-close').click();
  await expect(panelA).toHaveCount(0);
  await expect(traceB).toBeVisible();
  expect((await stored(workflowId)).executions).toEqual(done.executions);
});

test('shortcut hover help, node fade and deletion fragments respect reduced motion', async ({ page }) => {
  const workflowId = await fresh(page, '画布升级 · 交互与动效');
  const shortcut = page.getByTestId('canvas-shortcuts-hover'), tooltip = page.locator('.wf-shortcuts-hover-card');
  await expect(tooltip).toBeHidden();
  await shortcut.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Space');
  await expect(tooltip).toContainText('Delete');
  const shortcutBox = await shortcut.boundingBox(), canvas = await page.getByTestId('workflow-canvas').boundingBox();
  expect(shortcutBox!.x - canvas!.x).toBeLessThan(200);
  expect(canvas!.y + canvas!.height - shortcutBox!.y).toBeLessThan(160);
  await shortcut.click();
  await expect(page.getByTestId('canvas-shortcuts-help')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('canvas-shortcuts-help')).toHaveCount(0);
  const a = await add(page, '淡入与碎片');
  expect(await flowNode(page, a).evaluate(element => getComputedStyle(element).animationName)).toContain('wf-node-appear');
  await contextMenu(page, a);
  await page.evaluate(() => {
    const state = { seen: false, fragments: 0, pointerEvents: '' };
    const observer = new MutationObserver(() => {
      const effect = document.querySelector('[data-testid="node-removal-effect"]');
      if (effect) { state.seen = true; state.fragments = effect.querySelectorAll('.wf-node-fragment').length; state.pointerEvents = getComputedStyle(effect.parentElement!).pointerEvents; }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    (window as unknown as { __canvasMotionProbe: { state: typeof state; observer: MutationObserver } }).__canvasMotionProbe = { state, observer };
  });
  await page.getByTestId('context-delete').click();
  await expect(taskNode(page, a)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __canvasMotionProbe: { state: { seen: boolean } } }).__canvasMotionProbe.state.seen)).toBe(true);
  const motion = await page.evaluate(() => {
    const probe = (window as unknown as { __canvasMotionProbe: { state: { seen: boolean; fragments: number; pointerEvents: string }; observer: MutationObserver } }).__canvasMotionProbe;
    probe.observer.disconnect(); return probe.state;
  });
  expect(motion).toEqual({ seen: true, fragments: 6, pointerEvents: 'none' });
  await expect(page.getByTestId('node-removal-effect')).toHaveCount(0);
  await waitSaved(page);
  expect((await stored(workflowId)).nodes.find(node => node.id === a)?.hidden).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const b = await add(page, '减少动态效果');
  expect(await flowNode(page, b).evaluate(element => getComputedStyle(element).animationDuration)).toBe('0s');
  expect(await page.locator('.wf-node-effects').evaluate(element => getComputedStyle(element).display)).toBe('none');
  await contextMenu(page, b);
  await page.getByTestId('context-delete').click();
  await expect(taskNode(page, b)).toHaveCount(0);
  await expect(page.getByTestId('node-removal-effect')).toHaveCount(0);
});

for (const width of [780, 1024, 1280, 1700]) {
  test(`${width}px toolbar controls remain in view without overlap`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1050 });
    await fresh(page, `画布升级 · ${width}px`);
    await add(page, '响应式操作栏');
    await toolbarFits(page, width);
    await page.getByTestId('global-model-picker-trigger').click();
    await unobstructed(page.getByTestId('global-model-picker-options'));
    await page.keyboard.press('Escape');
    await page.screenshot({ path: testInfo.outputPath(`toolbar-${width}.png`) });
  });
}

test('utility nodes expose no connection ports and preserve dragged/resized geometry after reload', async ({ page }, testInfo) => {
  const workflowId = await fresh(page, '画布升级 · 工具节点几何');
  const task = await add(page, '只向任务节点连线');
  await moveTask(page, task, 260, 220);
  await addUtilityNode(page);
  await expect.poll(async () => (await stored(workflowId)).utilityNodes?.length).toBe(1);
  const utility = (await stored(workflowId)).utilityNodes![0]!, id = utility.id, node = page.getByTestId(`utility-node-${id}`);
  await expect(node).toBeVisible();
  await expect(node.locator('.react-flow__handle')).toHaveCount(0);
  await expect(flowNode(page, id)).not.toHaveClass(/(?:^|\s)connectable(?:\s|$)/);
  await expect(flowNode(page, id)).not.toHaveClass(/(?:^|\s)selectable(?:\s|$)/);
  await expect(page.getByTestId(`utility-tab-files-${id}`)).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId(`utility-title-${id}`).fill('开发工具 · 保留位置与尺寸');
  await waitSaved(page);
  const before = (await stored(workflowId)).utilityNodes![0]!;
  await drag(page, node.locator('.wf-utility-drag'), 115, -90, { x: 8, y: 18 });
  await waitSaved(page);
  await expect.poll(async () => Math.abs((await stored(workflowId)).utilityNodes![0]!.position.x - before.position.x)).toBeGreaterThan(70);
  await expect.poll(async () => Math.abs((await stored(workflowId)).utilityNodes![0]!.position.y - before.position.y)).toBeGreaterThan(50);
  const beforeSize = (await stored(workflowId)).utilityNodes![0]!;
  await drag(page, node.locator('.wf-utility-resize'), 105, 85, { x: 8, y: 8 });
  await waitSaved(page);
  await expect.poll(async () => (await stored(workflowId)).utilityNodes![0]!.width).toBeGreaterThan(beforeSize.width + 60);
  await expect.poll(async () => (await stored(workflowId)).utilityNodes![0]!.height).toBeGreaterThan(beforeSize.height + 50);
  // Dragging a task port onto the utility body must never create a task edge.
  const source = await page.getByTestId(`source-handle-${task}`).boundingBox(), target = await node.boundingBox();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + 24, target!.y + 115, { steps: 18 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  const saved = (await stored(workflowId)).utilityNodes![0]!;
  expect((await stored(workflowId)).edges).toEqual([]);
  expect((await stored(workflowId)).nodes.map(node => node.id)).toEqual([task]);
  await page.reload();
  await open(page, false);
  if (await page.getByTestId('workflow-select').inputValue() !== workflowId) await selectWorkflow(page, workflowId);
  await waitViewportSettled(page);
  await expect(page.getByTestId(`utility-title-${id}`)).toHaveValue(saved.title);
  expect((await stored(workflowId)).utilityNodes![0]).toEqual(saved);
  const dimensions = await flowNode(page, id).evaluate(element => { const el = element as HTMLElement; return { width: el.offsetWidth, height: el.offsetHeight }; });
  expect(dimensions).toEqual({ width: saved.width, height: saved.height });
  await expect(page.getByTestId(`utility-node-${id}`).locator('.react-flow__handle')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('utility-restored-geometry.png') });
});
