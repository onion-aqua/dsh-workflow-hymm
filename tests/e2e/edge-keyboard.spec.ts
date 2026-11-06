import { expect, test, type Page } from '@playwright/test';
import { addTaskNode, inlineEdit, selectWorkflow, taskNodes, waitSaved, waitViewportSettled } from './helpers.ts';

test.use({ viewport: { width: 1540, height: 980 }, locale: 'zh-CN', colorScheme: 'dark' });
test.beforeEach(async ({ page }) => {
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(开始使用|Get started|Get Started)$/ }), async dialog => { await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click(); });
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(预览版说明|Preview.*)$/ }), async dialog => { await dialog.getByRole('button', { name: /^(继续|Continue)$/ }).click(); });
});
async function open(page: Page, navigate = true) {
  if (navigate) await page.goto(process.env.WORKFLOW_ENTRY_URL ?? '/');
  const panel = page.getByTestId('workflow-panel');
  await expect.poll(async () => await panel.isVisible() || await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if (!(await panel.isVisible())) await page.getByTestId('workflow-return').click();
  await expect(page.getByTestId('add-workflow')).toBeEnabled();
}
async function add(page: Page, title: string) {
  const count = await taskNodes(page).count();
  await addTaskNode(page);
  await expect(taskNodes(page)).toHaveCount(count + 1);
  const id = await taskNodes(page).last().getAttribute('data-node-id');
  if (!id) throw new Error('A real persisted task identity is required');
  await inlineEdit(page, id, 'title', title);
  await inlineEdit(page, id, 'instruction', '隔离画布键盘交互验收，不调用模型。');
  return id;
}
async function connect(page: Page, sourceId: string, targetId: string, count: number) {
  const source = await page.getByTestId(`source-handle-${sourceId}`).boundingBox(), target = await page.getByTestId(`target-handle-${targetId}`).boundingBox();
  if (!source || !target) throw new Error('Both actual node handles must be visible');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(count);
  await waitSaved(page);
}

test('keyboard edge selection opens its actions, switches without stale deselection, cancels with Escape and persists Delete', async ({ page }) => {
  await open(page);
  const picker = page.getByTestId('workflow-select'), previous = await picker.inputValue();
  await page.getByTestId('add-workflow').click();
  await expect.poll(() => picker.inputValue()).not.toBe(previous);
  const workflowId = await picker.inputValue();
  const first = await add(page, '键盘曲线起点'), second = await add(page, '键盘曲线中间点'), third = await add(page, '键盘曲线终点');
  await page.getByTestId('fit-view').click(); await waitViewportSettled(page);
  await connect(page, first, second, 1); await connect(page, second, third, 2);
  const edges = page.locator('.react-flow__edge'), firstId = await edges.nth(0).getAttribute('data-id'), secondId = await edges.nth(1).getAttribute('data-id');
  const edgeOne = page.locator(`.react-flow__edge[data-id="${firstId}"]`), edgeTwo = page.locator(`.react-flow__edge[data-id="${secondId}"]`);
  // Equal-size task nodes created in one row have a truly horizontal path.
  // Its invisible 20px interaction stroke must work on both sides, including
  // Chrome's zero-height SVG geometry case. No test-only CSS is injected.
  const horizontal = await edgeOne.locator('.react-flow__edge-interaction').evaluate(element => {
    const path = element as SVGPathElement, length = path.getTotalLength();
    const points = [0, 0.25, 0.5, 0.75, 1].map(fraction => path.getPointAtLength(length * fraction));
    const middle = points[2]!, screen = new DOMPoint(middle.x, middle.y).matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y, verticalSpan: Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y)) };
  });
  expect(horizontal.verticalSpan).toBeLessThan(0.1);
  for (const offset of [-6, 6]) {
    await page.mouse.click(horizontal.x, horizontal.y + offset);
    await expect(edgeOne).toHaveClass(/selected/);
    await expect(page.getByTestId('remove-edge')).toBeVisible();
    await edgeOne.focus(); await edgeOne.press('Escape');
    await expect(edgeOne).not.toHaveClass(/selected/);
    await expect(page.getByTestId('remove-edge')).toHaveCount(0);
  }
  await edgeOne.focus(); await edgeOne.press('Enter');
  await expect(edgeOne).toHaveClass(/selected/); await expect(page.getByTestId('remove-edge')).toBeVisible();
  await edgeTwo.focus(); await edgeTwo.press('Enter');
  await expect(edgeTwo).toHaveClass(/selected/); await expect(edgeOne).not.toHaveClass(/selected/);
  await edgeTwo.press('Escape');
  await expect(edgeTwo).not.toHaveClass(/selected/); await expect(page.getByTestId('remove-edge')).toHaveCount(0);
  await page.keyboard.press('Delete'); await expect(edges).toHaveCount(2);
  await edgeTwo.focus(); await edgeTwo.press('Enter'); await expect(page.getByTestId('remove-edge')).toBeVisible();
  await edgeTwo.press('Delete');
  await expect(edges).toHaveCount(1); await expect(edgeOne).toHaveCount(1); await expect(edgeTwo).toHaveCount(0); await waitSaved(page);
  await page.reload(); await open(page, false); await selectWorkflow(page, workflowId);
  await expect(edges).toHaveCount(1); await expect(edgeOne).toHaveCount(1); await expect(edgeTwo).toHaveCount(0);
});
