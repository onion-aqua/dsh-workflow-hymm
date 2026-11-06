import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { addTaskNode, contextMenu, focusTask, inlineEdit, selectWorkflow } from './helpers.ts';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1540, height: 980 }, locale: 'zh-CN', colorScheme: 'dark' });

test.beforeEach(async ({ page }) => {
  // The host can open onboarding asynchronously after any navigation/reload.
  // Handle it when it actually appears instead of racing a one-off isVisible.
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(开始使用|Get started|Get Started)$/ }), async (dialog) => {
    await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click();
  });
});

/** The same tests run against an isolated real DSH web host, never a fake Session. */
async function openWorkflow(page: Page, navigate = true): Promise<void> {
  if (navigate) await page.goto(process.env.WORKFLOW_ENTRY_URL ?? '/');
  const panel = page.getByTestId('workflow-panel');
  await expect.poll(async()=>await panel.isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if (!(await panel.isVisible())) {
    const previewContinue = page.getByRole('button', { name: /^(Continue|继续)$/ });
    if (await previewContinue.isVisible()) {
      await previewContinue.click();
    }
    if(await page.getByTestId('workflow-return').isVisible())await page.getByTestId('workflow-return').click();
    else if(!(await panel.isVisible()))await page.getByTestId('workflow-nav').click();
  }
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('add-workflow')).toBeEnabled();
  await expect(page.getByTestId('save-state')).not.toHaveAttribute('data-state', 'error');
}

async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved', { timeout: 20000 });
}

async function waitViewportSettled(page: Page): Promise<void> {
  let previous: string | undefined;
  let stableSamples = 0;
  await expect.poll(async () => {
    const current = await page.locator('.react-flow__viewport').evaluate(node => (node as HTMLElement).style.transform);
    stableSamples = current === previous ? stableSamples + 1 : 0;
    previous = current;
    return stableSamples;
  }, { intervals: [90, 90, 90, 90] }).toBeGreaterThanOrEqual(3);
  await waitSaved(page);
}

async function newWorkflow(page: Page): Promise<string> {
  await openWorkflow(page);
  const select = page.getByTestId('workflow-select');
  const before = await select.inputValue().catch(() => '');
  await page.getByTestId('add-workflow').click();
  await expect.poll(async () => {
    const current = await select.inputValue();
    return current !== '' && current !== before;
  }).toBe(true);
  await waitSaved(page);
  await expect(taskNodes(page)).toHaveCount(0);
  return select.inputValue();
}

function taskNodes(page: Page): Locator { return page.locator('[data-testid^="task-node-"]'); }
function taskNode(page: Page, id: string): Locator { return page.getByTestId(`task-node-${id}`); }
function flowNode(page: Page, id: string): Locator { return page.locator(`.react-flow__node[data-id="${id}"]`); }

async function addNode(page: Page): Promise<string> {
  const count = await taskNodes(page).count();
  await addTaskNode(page);
  await expect(taskNodes(page)).toHaveCount(count + 1);
  const id = await taskNodes(page).last().getAttribute('data-node-id');
  if (!id) throw new Error('Task node must expose its stable domain identity');
  await waitSaved(page);
  return id;
}

async function dragConnection(page: Page, from: string, to: string): Promise<void> {
  const source = await page.getByTestId(`source-handle-${from}`).boundingBox();
  const target = await page.getByTestId(`target-handle-${to}`).boundingBox();
  if (!source || !target) throw new Error('Both connection handles must be visible');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 16 });
  await page.mouse.up();
}

async function connect(page: Page, from: string, to: string): Promise<void> {
  const closeInspector=page.getByRole('button',{name:'关闭任务详情',exact:true});
  if(await closeInspector.isVisible())await closeInspector.click();
  const before = await page.locator('.react-flow__edge').count();
  await dragConnection(page, from, to);
  await expect(page.locator('.react-flow__edge')).toHaveCount(before + 1);
  await waitSaved(page);
}

async function graphGeometry(page: Page): Promise<unknown> {
  return page.locator('.react-flow').evaluate((root) => ({
    nodes: [...root.querySelectorAll<HTMLElement>('.react-flow__node')].map(node => ({
      id: node.dataset.id,
      transform: node.style.transform,
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
    })),
    edges: [...root.querySelectorAll('.react-flow__edge-path')].map(edge => edge.getAttribute('d')),
  }));
}

async function blankPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.getByTestId('workflow-canvas').evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    const candidates = [[18, 18], [rect.width - 22, 24], [22, rect.height / 2], [rect.width - 25, rect.height / 2], [rect.width / 2, rect.height - 24]];
    for (const [dx, dy] of candidates) {
      const x = rect.left + dx!;
      const y = rect.top + dy!;
      const element = document.elementFromPoint(x, y);
      if (element?.classList.contains('react-flow__pane')) return { x, y };
    }
    return null;
  });
  if (!point) throw new Error('Test needs a genuinely blank canvas point');
  return point;
}

test('creates, edits, drags and connects tasks; reload restores graph and viewport', async ({ page }) => {
  const workflowId = await newWorkflow(page);
  const first = await addNode(page);
  await inlineEdit(page, first, 'title', 'Phase 1 persisted title');
  await inlineEdit(page, first, 'instruction', 'Read the current repository and report the supported plugin APIs.');
  await expect(taskNode(page, first)).toContainText('Phase 1 persisted title');
  await waitSaved(page);
  const second = await addNode(page);
  await page.getByTestId('fit-view').click();
  await waitViewportSettled(page);

  const beforeDrag = await flowNode(page, first).evaluate(node => (node as HTMLElement).style.transform);
  const nodeBox = await taskNode(page, first).boundingBox();
  if (!nodeBox) throw new Error('First task must be visible');
  await page.mouse.move(nodeBox.x + 5, nodeBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + 85, nodeBox.y + 75, { steps: 14 });
  await page.mouse.up();
  await expect.poll(() => flowNode(page, first).evaluate(node => (node as HTMLElement).style.transform)).not.toBe(beforeDrag);
  await waitSaved(page);
  await connect(page, first, second);
  await page.locator('.react-flow__controls-zoomin').click();
  await waitViewportSettled(page);

  const persistedPosition = await flowNode(page, first).evaluate(node => (node as HTMLElement).style.transform);
  const persistedViewport = await page.locator('.react-flow__viewport').evaluate(node => (node as HTMLElement).style.transform);
  await page.reload();
  await openWorkflow(page, false);
  await selectWorkflow(page,workflowId);
  await expect(taskNodes(page)).toHaveCount(2);
  await expect(taskNode(page, first)).toContainText('Phase 1 persisted title');
  await expect(taskNode(page, first)).toContainText('Read the current repository');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect.poll(() => flowNode(page, first).evaluate(node => (node as HTMLElement).style.transform)).toBe(persistedPosition);
  await expect.poll(() => page.locator('.react-flow__viewport').evaluate(node => (node as HTMLElement).style.transform)).toBe(persistedViewport);
  await expect(page.getByTestId('trace-entry')).toHaveCount(0);
  await expect(page.getByTestId('trace-panel')).toHaveCount(0);
});

test('focused trace overlay preserves graph geometry and survives internal interactions', async ({ page }) => {
  await newWorkflow(page);
  const first = await addNode(page);
  const second = await addNode(page);
  await page.getByTestId('fit-view').click();
  await waitViewportSettled(page);
  await connect(page, first, second);
  const point = await blankPoint(page);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('trace-entry')).toHaveCount(0);
  await focusTask(page, first);
  await expect(page.getByTestId('trace-entry')).toHaveCount(1);
  const before = await graphGeometry(page);
  await page.getByTestId('trace-entry').click();
  await expect(page.getByTestId('trace-panel')).toBeVisible();
  await expect(page.getByTestId('trace-empty')).toBeVisible();
  await expect(page.getByTestId('trace-panel').locator('.wf-trace-step')).toHaveCount(0);
  expect(await graphGeometry(page)).toEqual(before);
  await page.getByTestId('trace-empty').click();
  await page.getByTestId('trace-panel').hover();
  await page.mouse.wheel(0, 180);
  await expect(page.getByTestId('trace-panel')).toBeVisible();
  await expect(taskNode(page, first)).toHaveClass(/is-focused/);
  expect(await graphGeometry(page)).toEqual(before);
  await contextMenu(page,first);
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByTestId('trace-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('trace-close').click();
  await expect(page.getByTestId('trace-panel')).toHaveCount(0);
  await expect(page.getByTestId('trace-entry')).toHaveCount(1);
  await expect(taskNode(page, first)).toHaveClass(/is-focused/);
  await page.getByTestId('trace-entry').click();
  await focusTask(page, second);
  await expect(page.getByTestId('trace-panel')).toHaveCount(0);
  await expect(page.getByTestId('trace-entry')).toHaveCount(1);
  await expect(taskNode(page, second)).toHaveClass(/is-focused/);
  const blank = await blankPoint(page);
  await page.mouse.click(blank.x, blank.y);
  await expect(page.getByTestId('trace-entry')).toHaveCount(0);
  await expect(page.getByTestId('trace-panel')).toHaveCount(0);
});

test('workflows retain separate graphs and draft removal persists', async ({ page }) => {
  const firstWorkflow = await newWorkflow(page);
  const node = await addNode(page);
  const select = page.getByTestId('workflow-select');
  await page.getByTestId('add-workflow').click();
  await expect.poll(() => select.inputValue()).not.toBe(firstWorkflow);
  const secondWorkflow = await select.inputValue();
  await expect(taskNodes(page)).toHaveCount(0);
  await selectWorkflow(page,firstWorkflow);
  await expect(taskNode(page, node)).toBeVisible();
  await contextMenu(page,node);
  await page.getByRole('menuitem', { name: '从画布移除', exact: true }).click();
  await expect(taskNodes(page)).toHaveCount(0);
  await waitSaved(page);
  await selectWorkflow(page,secondWorkflow);
  await expect(taskNodes(page)).toHaveCount(0);
  await page.reload();
  await openWorkflow(page, false);
  await selectWorkflow(page,firstWorkflow);
  await expect(taskNodes(page)).toHaveCount(0);
});

test('failed save preserves draft edits and retry persists after the network returns', async ({ page, context }) => {
  const workflowId = await newWorkflow(page);
  await context.setOffline(true);
  await addTaskNode(page);
  await expect(taskNodes(page)).toHaveCount(1);
  const nodeId = await taskNodes(page).first().getAttribute('data-node-id');
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'error', { timeout: 20000 });
  await expect(taskNodes(page)).toHaveCount(1);
  await context.setOffline(false);
  await page.getByTestId('workflow-retry').click();
  await waitSaved(page);
  await page.reload();
  await openWorkflow(page, false);
  await selectWorkflow(page,workflowId);
  await expect(taskNodes(page)).toHaveCount(1);
  await expect(taskNode(page, nodeId!)).toBeVisible();
});

test('auto layout, collapse, invalid links and edge removal work in the real host; trace stays within a small canvas', async ({ page }) => {
  const workflowId = await newWorkflow(page);
  await page.getByTestId('workflow-name-input').fill('代码审计工作流 · Phase 1');
  await page.getByTestId('workflow-name-input').press('Enter');
  const tasks = [
    ['调研插件 API', '只读检查 DSH 0.2.1-rc.3 的插件注册、事件订阅及持久化能力。'],
    ['实现任务画布', '使用原生插件入口实现节点编辑、拖动和依赖连线。'],
    ['构建与验收', '运行构建与测试，刷新后核对节点、连线及布局持久化。'],
  ];
  const ids: string[] = [];
  for (const [title, instruction] of tasks) {
    const id=await addNode(page);ids.push(id);
    await inlineEdit(page, id, 'title', title!);
    await inlineEdit(page, id, 'instruction', instruction!);
    await waitSaved(page);
  }
  await page.getByTestId('fit-view').click();
  await waitViewportSettled(page);
  await connect(page, ids[0]!, ids[1]!);
  await connect(page, ids[1]!, ids[2]!);
  // Actual pointer interactions exercise the graph's duplicate, cycle and self guards.
  await dragConnection(page, ids[0]!, ids[1]!);
  await expect(page.getByRole('status')).toContainText('已有依赖关系');
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await dragConnection(page, ids[2]!, ids[0]!);
  await expect(page.getByRole('status')).toContainText('循环');
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await dragConnection(page, ids[0]!, ids[0]!);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  const beforeLayout = await graphGeometry(page);
  await page.getByTestId('auto-layout').click();
  await waitViewportSettled(page);
  const arranged = await graphGeometry(page);
  expect(arranged).not.toEqual(beforeLayout);
  const positions = await Promise.all(ids.map(id => flowNode(page, id).evaluate(node => (node as HTMLElement).style.transform)));
  const layoutXs = positions.map(value => Number(value.match(/translate\(([-\d.]+)px/)?.[1]));
  expect(layoutXs[0]).toBeLessThan(layoutXs[1]!);
  expect(layoutXs[1]).toBeLessThan(layoutXs[2]!);
  await page.reload();
  await openWorkflow(page, false);
  await selectWorkflow(page,workflowId);
  await expect(taskNodes(page)).toHaveCount(3);
  for (const [index, id] of ids.entries()) {
    await expect.poll(() => flowNode(page, id).evaluate(node => (node as HTMLElement).style.transform)).toBe(positions[index]);
  }

  const firstTask = taskNode(page, ids[0]!);
  const expandedHeight=await firstTask.evaluate(element=>element.getBoundingClientRect().height);
  await focusTask(page, ids[0]!);
  await page.getByTestId(`node-collapse-${ids[0]}`).click();
  await expect(firstTask.getByTestId(`node-instruction-${ids[0]}`)).toContainText(tasks[0]![1]!);
  await expect(firstTask).toHaveClass(/is-collapsed/);
  await expect.poll(()=>firstTask.evaluate(element=>element.getBoundingClientRect().height)).toBeLessThan(expandedHeight);
  await expect(taskNodes(page)).toHaveCount(3);
  await page.getByTestId(`node-collapse-${ids[0]}`).click();
  await expect(firstTask.locator('p')).toContainText(tasks[0]![1]!);

  const edgePoint = await page.locator('.react-flow__edge-interaction').first().evaluate(node => {
    const path = node as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(edgePoint.x, edgePoint.y);
  await expect(page.getByTestId('remove-edge')).toBeVisible();
  await page.getByTestId('remove-edge').click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await waitSaved(page);
  await connect(page, ids[0]!, ids[1]!);

  await page.setViewportSize({ width: 1080, height: 790 });
  await page.getByTestId('auto-layout').click();
  await waitViewportSettled(page);
  await focusTask(page, ids[2]!);
  const geometryBeforeTrace = await graphGeometry(page);
  await page.getByTestId('trace-entry').click();
  await expect(page.getByTestId('trace-empty')).toBeVisible();
  const canvas = await page.getByTestId('workflow-canvas').boundingBox();
  const panel = await page.getByTestId('trace-panel').boundingBox();
  expect(canvas).not.toBeNull(); expect(panel).not.toBeNull();
  expect(panel!.x).toBeGreaterThanOrEqual(canvas!.x);
  expect(panel!.y).toBeGreaterThanOrEqual(canvas!.y);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width + 1);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(canvas!.y + canvas!.height + 1);
  expect(await graphGeometry(page)).toEqual(geometryBeforeTrace);

  await page.setViewportSize({ width: 1740, height: 1040 });
  await page.getByTestId('auto-layout').click();
  await waitViewportSettled(page);
  await page.getByTestId('trace-close').click();
  const blank = await blankPoint(page);
  await page.mouse.click(blank.x, blank.y);
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshots/phase1-canvas.png' });
  await focusTask(page, ids[1]!);
  await page.getByTestId('trace-entry').click();
  await expect(page.getByTestId('trace-empty')).toBeVisible();
  await page.screenshot({ path: 'artifacts/screenshots/phase1-trace-empty.png' });
});
