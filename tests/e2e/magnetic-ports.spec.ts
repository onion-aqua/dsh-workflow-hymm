import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Workflow } from '../../src/shared/model.ts';
import { addTaskNode, blankPoint, inlineEdit, selectWorkflow, taskNode, taskNodes, waitSaved, waitViewportSettled } from './helpers.ts';

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
  const directory = process.env.WORKFLOW_STORAGE_ROOT;
  if (!directory) throw new Error('Magnetic port regression requires explicitly isolated storage');
  return JSON.parse(await readFile(join(directory, 'visual_workflow.json'), 'utf8')).tables.workflows[id];
}
async function add(page: Page, title: string) {
  const count = await taskNodes(page).count();
  await addTaskNode(page); await expect(taskNodes(page)).toHaveCount(count + 1);
  const id = await taskNodes(page).last().getAttribute('data-node-id');
  if (!id) throw new Error('Expected actual persisted task identity');
  await inlineEdit(page, id, 'title', title);
  await inlineEdit(page, id, 'instruction', '只检查连接点磁吸与连线交互，不运行模型。');
  return id;
}
async function move(page: Page, id: string, x: number, y: number) {
  const box = await taskNode(page, id).locator('.wf-task-top').boundingBox();
  if (!box) throw new Error('Expected node header');
  await page.mouse.move(box.x + 5, box.y + 12); await page.mouse.down();
  await page.mouse.move(x + 5, y + 12, { steps: 12 }); await page.mouse.up(); await waitSaved(page);
}
async function geometry(handle: Locator) {
  return handle.evaluate(element => {
    const rect = element.getBoundingClientRect(), dot = element.querySelector('.wf-magnetic-port-dot')!.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, dx: dot.x + dot.width / 2 - rect.x - rect.width / 2, dy: dot.y + dot.height / 2 - rect.y - rect.height / 2 };
  });
}
async function leave(page: Page, handle: Locator) {
  const blank = await blankPoint(page, true); await page.mouse.move(blank.x, blank.y);
  await expect(handle).not.toHaveClass(/is-magnetic/);
  await expect.poll(async () => { const value = await geometry(handle); return Math.hypot(value.dx, value.dy); }).toBeLessThan(0.6);
}
async function near(page: Page, handle: Locator, side: -1 | 1, distance = 18, offsetY = 0) {
  const before = await geometry(handle), center = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  await page.mouse.move(center.x + side * 42, center.y);
  await page.mouse.move(center.x + side * distance, center.y + offsetY, { steps: 5 });
  await expect(handle).toHaveClass(/is-magnetic/);
  await expect.poll(async () => (await geometry(handle)).dx * side).toBeGreaterThan(5.2);
  const after = await geometry(handle);
  expect(Math.hypot(after.dx, after.dy)).toBeLessThanOrEqual(8.7);
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeLessThan(0.1);
  expect(after.width).toBeCloseTo(before.width, 3); expect(after.height).toBeCloseTo(before.height, 3);
  await expect(handle.locator('.wf-magnetic-port-dot')).toHaveCSS('pointer-events', 'none');
  return { x: center.x + side * distance, y: center.y + offsetY, displacement: Math.hypot(after.dx, after.dy) };
}
async function moveOntoDot(page: Page, handle: Locator) {
  const dot = await handle.locator('.wf-magnetic-port-dot').boundingBox();
  if (!dot) throw new Error('Expected attracted port dot');
  const point = { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 };
  await page.mouse.move(point.x, point.y);
  return point;
}
async function endpointsAligned(page: Page, sourceId: string, targetId: string) {
  await expect.poll(async () => {
    const endpoints = await page.locator('.react-flow__edge-path').evaluate(element => {
      const path = element as SVGPathElement, matrix = path.getScreenCTM()!;
      const start = path.getPointAtLength(0), end = path.getPointAtLength(path.getTotalLength());
      const from = new DOMPoint(start.x, start.y).matrixTransform(matrix), to = new DOMPoint(end.x, end.y).matrixTransform(matrix);
      return { sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y };
    });
    const source = await page.getByTestId(`source-handle-${sourceId}`).boundingBox(), target = await page.getByTestId(`target-handle-${targetId}`).boundingBox();
    if (!source || !target) return Infinity;
    return Math.max(Math.abs(endpoints.sourceX - source.x - source.width), Math.abs(endpoints.sourceY - source.y - source.height / 2), Math.abs(endpoints.targetX - target.x), Math.abs(endpoints.targetY - target.y - target.height / 2));
  }).toBeLessThan(1.5);
}

test('magnetic port dots follow nearby mouse input without moving anchors and retain drag, zoom, right-click and persistence behavior', async ({ page }) => {
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT, 'Requires an explicitly isolated packaged host.'); test.setTimeout(90000);
  expect(resolve(process.env.WORKFLOW_STORAGE_ROOT!)).not.toBe(resolve(homedir(), '.dsh', 'storages'));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const picker = page.getByTestId('workflow-select'), previous = await picker.inputValue();
  await page.getByTestId('add-workflow').click(); await expect(picker).not.toHaveValue(previous);
  const workflowId = await picker.inputValue(), sourceId = await add(page, '磁吸源节点'), targetId = await add(page, '磁吸目标节点');
  await move(page, sourceId, 350, 350); await move(page, targetId, 1000, 550);
  const source = page.getByTestId(`source-handle-${sourceId}`), target = page.getByTestId(`target-handle-${targetId}`);
  await expect(source).toHaveClass(/wf-magnetic-port/); await expect(target).toHaveClass(/wf-magnetic-port/);
  await leave(page, source); await waitSaved(page);
  const beforeHover = await stored(workflowId);
  const atOne = await near(page, source, 1); await leave(page, source);
  expect(await stored(workflowId)).toEqual(beforeHover);

  // Start 18 screen pixels away, without precision aiming at the visual dot.
  // Only this nearest port expands; inactive ports keep short edges reachable.
  await near(page, source, 1); const endBox = await target.boundingBox();
  if (!endBox) throw new Error('Expected target handle');
  await page.mouse.down(); await page.mouse.move(endBox.x + endBox.width / 2 - 18, endBox.y + endBox.height / 2, { steps: 18 });
  await expect(page.getByTestId('workflow-connection-path')).toBeAttached(); await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1); await waitSaved(page); await leave(page, source);
  const connected = await stored(workflowId), path = await page.locator('.react-flow__edge-path').getAttribute('d');
  expect(connected.edges).toMatchObject([{ source: sourceId, target: targetId }]);
  expect(connected.nodes.map(node => node.position)).toEqual(beforeHover.nodes.map(node => node.position));
  await near(page, target, -1, 18, -16); await expect(page.locator('.react-flow__edge-path')).toHaveAttribute('d', path!);
  await endpointsAligned(page, sourceId, targetId); await leave(page, target); expect(await stored(workflowId)).toEqual(connected);

  // Native zoom controls move through real viewport persistence, with no injected CSS or graph data.
  for (let index = 0; index < 3; index++) await page.locator('.react-flow__controls-zoomout').click();
  await waitViewportSettled(page);
  const scaled = await stored(workflowId); expect(scaled.viewport.zoom).toBeLessThan(0.75); expect(scaled.viewport.zoom).toBeGreaterThan(0.3);
  const scaledPath = await page.locator('.react-flow__edge-path').getAttribute('d'), atScale = await near(page, source, 1, 18, -16);
  expect(Math.abs(atScale.displacement - atOne.displacement)).toBeLessThan(1.5);
  await expect(page.locator('.react-flow__edge-path')).toHaveAttribute('d', scaledPath!); await endpointsAligned(page, sourceId, targetId);
  await leave(page, source); expect(await stored(workflowId)).toEqual(scaled);

  await near(page, target, -1, 18, -16); const rightClick = await moveOntoDot(page, target); await page.mouse.click(rightClick.x, rightClick.y, { button: 'right' });
  await expect(page.getByTestId('workflow-context-menu')).toBeVisible(); await expect(page.getByTestId('context-disconnect-port')).toBeEnabled();
  await page.getByTestId('context-disconnect-port').click(); await expect(page.locator('.react-flow__edge')).toHaveCount(0); await waitSaved(page);
  const disconnected = await stored(workflowId); expect(disconnected.nodes.map(node => node.position)).toEqual(beforeHover.nodes.map(node => node.position));
  expect(disconnected.executions ?? []).toEqual([]); expect(disconnected.operations ?? []).toEqual([]);

  // A foreground card covers this port: its invisible dot must not attract.
  const coveredPort = await geometry(source), coveredCenter = { x: coveredPort.x + coveredPort.width / 2, y: coveredPort.y + coveredPort.height / 2 };
  await move(page, targetId, coveredCenter.x - 80, coveredCenter.y - 70);
  const offNode = await blankPoint(page, true); await page.mouse.click(offNode.x, offNode.y);
  await expect.poll(() => source.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return element.ownerDocument.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('[data-node-id]')?.getAttribute('data-node-id');
  })).toBe(targetId);
  await page.mouse.move(coveredCenter.x + 42, coveredCenter.y); await page.mouse.move(coveredCenter.x + 18, coveredCenter.y, { steps: 5 });
  await expect(source).not.toHaveClass(/is-magnetic/);
  await page.getByTestId('canvas-undo').click(); await waitSaved(page);
  await expect.poll(async () => (await stored(workflowId)).nodes.map(node => node.position)).toEqual(disconnected.nodes.map(node => node.position));

  // A collapsed card can be shorter than the normal click circle at 10% zoom.
  // The active hit circle must grow vertically even when the card is tiny.
  await page.getByTestId(`node-collapse-${sourceId}`).click(); await expect(taskNode(page, sourceId)).toHaveClass(/is-collapsed/);
  for (let index = 0; index < 20 && (await stored(workflowId)).viewport.zoom > 0.105; index++) {
    await page.locator('.react-flow__controls-zoomout').click(); await waitViewportSettled(page);
  }
  const tiny = await stored(workflowId); expect(tiny.viewport.zoom).toBeGreaterThanOrEqual(0.099); expect(tiny.viewport.zoom).toBeLessThanOrEqual(0.105);
  // Clear the focused-node trace button so the diagonal probe reaches canvas,
  // rather than the floating control (which correctly takes pointer priority).
  const empty = await blankPoint(page, true); await page.mouse.click(empty.x, empty.y);
  const tinyBox = await source.boundingBox(); if (!tinyBox) throw new Error('Expected tiny collapsed port');
  const tinyCenter = { x: tinyBox.x + tinyBox.width / 2, y: tinyBox.y + tinyBox.height / 2 };
  // Probe above the source: below it, the neighboring target is actually closer.
  await page.mouse.move(tinyCenter.x + 42, tinyCenter.y - 42); await page.mouse.move(tinyCenter.x + 16, tinyCenter.y - 16, { steps: 5 });
  await expect(source).toHaveClass(/is-magnetic/);
  await expect.poll(async () => { const value = await geometry(source); return Math.hypot(value.dx, value.dy); }).toBeGreaterThan(0.15);
  await expect.poll(async () => { const value = await geometry(source); return Math.hypot(value.dx / 22, value.dy / 22); }).toBeLessThan(1);
  await leave(page, source); expect(await stored(workflowId)).toEqual(tiny);

  await page.mouse.move(tinyCenter.x + 18, tinyCenter.y - 10);
  await expect(source).toHaveClass(/is-magnetic/);
  const tinyTarget = await target.boundingBox(); if (!tinyTarget) throw new Error('Expected tiny target');
  await page.mouse.down(); await page.mouse.move(tinyTarget.x + tinyTarget.width / 2, tinyTarget.y + tinyTarget.height / 2, { steps: 18 });
  await expect(page.getByTestId('workflow-connection-path')).toBeAttached(); await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1); await waitSaved(page);
  await page.mouse.click(tinyTarget.x + tinyTarget.width / 2, tinyTarget.y + tinyTarget.height / 2, { button: 'right' });
  await page.getByTestId('context-disconnect-port').click(); await expect(page.locator('.react-flow__edge')).toHaveCount(0); await waitSaved(page);

  // A nearby header button takes priority over the expanded port at 10% zoom.
  await page.mouse.move(tinyCenter.x + 18, tinyCenter.y - 10); await expect(source).toHaveClass(/is-magnetic/);
  const collapse = page.getByTestId(`node-collapse-${sourceId}`), collapseBox = await collapse.boundingBox();
  if (!collapseBox) throw new Error('Expected compact header button');
  await page.mouse.move(collapseBox.x + collapseBox.width / 2, collapseBox.y + collapseBox.height / 2);
  await expect(source).not.toHaveClass(/is-magnetic/); await collapse.click();
  await expect(taskNode(page, sourceId)).not.toHaveClass(/is-collapsed/);

  // Screen-space admission is equally forgiving at maximum zoom.
  for (let index = 0; index < 20 && (await stored(workflowId)).viewport.zoom < 1.99; index++) {
    await page.locator('.react-flow__controls-zoomin').click(); await waitViewportSettled(page);
  }
  expect((await stored(workflowId)).viewport.zoom).toBeGreaterThanOrEqual(1.99);
  const largeSource = await source.boundingBox(), largeTarget = await target.boundingBox();
  if (!largeSource || !largeTarget) throw new Error('Expected large ports');
  await page.mouse.move(largeSource.x + largeSource.width / 2 + 18, largeSource.y + largeSource.height / 2 - 10);
  await expect(source).toHaveClass(/is-magnetic/);
  await page.mouse.down(); await page.mouse.move(largeTarget.x + largeTarget.width / 2 - 18, largeTarget.y + largeTarget.height / 2, { steps: 18 });
  await expect(page.getByTestId('workflow-connection-path')).toBeAttached(); await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1); await waitSaved(page);
  await endpointsAligned(page, sourceId, targetId);
  await page.mouse.click(largeTarget.x + largeTarget.width / 2, largeTarget.y + largeTarget.height / 2, { button: 'right' });
  await page.getByTestId('context-disconnect-port').click(); await expect(page.locator('.react-flow__edge')).toHaveCount(0); await waitSaved(page);
  await page.reload(); await open(page, false); await selectWorkflow(page, workflowId);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0); await leave(page, source); expect((await stored(workflowId)).nodes.map(node => node.position)).toEqual(beforeHover.nodes.map(node => node.position));
  expect(errors).toEqual([]);
});
