import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Workflow } from '../../src/shared/model.ts';
import { addTaskNode, addUtilityNode, blankPoint, taskNode, taskNodes, waitSaved } from './helpers.ts';

test.use({ viewport: { width: 1700, height: 1050 }, locale: 'zh-CN', colorScheme: 'dark' });

let localWeb: Server | undefined;
test.beforeEach(async ({ page }) => {
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT, 'Requires an explicitly isolated Host storage root.');
  expect(resolve(process.env.WORKFLOW_STORAGE_ROOT!).toLowerCase()).not.toBe(resolve(homedir(), '.dsh', 'storages').toLowerCase());
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(开始使用|Get started|Get Started)$/ }), async dialog => { await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click(); });
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(预览版说明|Preview.*)$/ }), async dialog => { await dialog.getByRole('button', { name: /^(继续|Continue)$/ }).click(); });
});
test.afterEach(async () => {
  if (localWeb) { await new Promise<void>((done, reject) => localWeb!.close(error => error ? reject(error) : done())); localWeb = undefined; }
});

async function stored(id: string): Promise<Workflow> {
  return JSON.parse(await readFile(join(process.env.WORKFLOW_STORAGE_ROOT!, 'visual_workflow.json'), 'utf8')).tables.workflows[id];
}
async function fresh(page: Page): Promise<string> {
  await page.goto(process.env.WORKFLOW_ENTRY_URL ?? '/');
  await expect.poll(async () => await page.getByTestId('workflow-panel').isVisible() || await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if (!await page.getByTestId('workflow-panel').isVisible()) await page.getByTestId('workflow-return').click();
  const picker = page.getByTestId('workflow-select'), before = await picker.inputValue();
  await page.getByTestId('add-workflow').click(); await expect(picker).not.toHaveValue(before); await waitSaved(page);
  return picker.inputValue();
}
async function clear(page: Page): Promise<void> { const point = await blankPoint(page, true); await page.mouse.click(point.x, point.y); }
async function newUtility(page: Page, workflowId: string) {
  await addUtilityNode(page); await waitSaved(page);
  const utility = (await stored(workflowId)).utilityNodes!.at(-1)!;
  const node = page.getByTestId(`utility-node-${utility.id}`); await expect(node).toBeVisible();
  return { id: utility.id, node };
}
async function dragAt(page: Page, locator: Locator, dx: number, dy: number) {
  const box = await locator.boundingBox(); if (!box) throw new Error('Missing visible pointer target');
  const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 14 }); await page.mouse.up();
}
async function clickAt(page: Page, locator: Locator) {
  const box = await locator.boundingBox(); if (!box) throw new Error('Missing visible pointer target');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function position(workflowId: string, utilityId: string) {
  return (await stored(workflowId)).utilityNodes!.find(node => node.id === utilityId)!.position;
}

test('unfocused utility body drags without activating controls; one click focuses and the next operates', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const workflowId = await fresh(page), { id, node } = await newUtility(page, workflowId);
  const browserTab = node.getByTestId(`utility-tab-browser-${id}`);
  await clear(page); await expect(node).not.toHaveClass(/is-selected/);
  const before = await position(workflowId, id);
  await dragAt(page, browserTab, 90, 70);
  await expect.poll(() => position(workflowId, id)).toEqual({ x: before.x + 90, y: before.y + 70 });
  await expect(node).not.toHaveClass(/is-selected/);
  expect((await stored(workflowId)).utilityNodes!.find(item => item.id === id)!.activeTool).toBe('files');

  await clickAt(page, browserTab); await expect(node).toHaveClass(/is-selected/);
  expect((await stored(workflowId)).utilityNodes!.find(item => item.id === id)!.activeTool).toBe('files');
  await browserTab.click(); await expect(node.locator('.wf-utility-browser')).toBeVisible(); await waitSaved(page);
  expect((await stored(workflowId)).utilityNodes!.find(item => item.id === id)!.activeTool).toBe('browser');
  await node.getByRole('textbox', { name: '网页地址', exact: true }).fill('https://example.test/utility-draft');

  const headerBefore = await position(workflowId, id);
  await dragAt(page, node.locator('.wf-utility-drag-space'), 40, 20);
  await expect.poll(() => position(workflowId, id)).toEqual({ x: headerBefore.x + 40, y: headerBefore.y + 20 });
  await expect(node).toHaveClass(/is-selected/);

  await clear(page); await expect(node).not.toHaveClass(/is-selected/);
  const title = node.getByTestId(`utility-title-${id}`), oldTitle = await title.inputValue();
  await clickAt(page, title); await expect(node).toHaveClass(/is-selected/); await expect(title).not.toBeFocused();
  await title.fill(`${oldTitle} edited`); await waitSaved(page);

  await addTaskNode(page); const taskId = await taskNodes(page).last().getAttribute('data-node-id');
  if (!taskId) throw new Error('Missing task');
  const newTitle = page.getByTestId(`inline-title-${taskId}`); if (await newTitle.isVisible()) await newTitle.press('Enter');
  await waitSaved(page); await taskNode(page, taskId).locator('.wf-task-top').click({ position: { x: 5, y: 12 } });
  await expect(node).not.toHaveClass(/is-selected/);
  const utilityBefore = await position(workflowId, id);
  await dragAt(page, node.locator('.wf-utility-body'), -50, 40);
  await expect.poll(() => position(workflowId, id)).toEqual({ x: utilityBefore.x - 50, y: utilityBefore.y + 40 });
  await expect(node).not.toHaveClass(/is-selected/);
  await page.screenshot({ path: testInfo.outputPath('utility-unfocused-drag.png') });
  expect(errors).toEqual([]);
});

test('blurred iframe is shielded from clicks and drags while focused iframe retains its live page', async ({ page }, testInfo) => {
  localWeb = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html><body style="margin:0;background:#242424;color:#eee"><button id="counter" style="margin:20px;width:200px;height:60px" onclick="this.textContent=String(Number(this.textContent)+1)">0</button></body></html>');
  });
  await new Promise<void>(done => localWeb!.listen(0, '127.0.0.1', done));
  const address = localWeb.address(); if (!address || typeof address === 'string') throw new Error('Missing local browser fixture port');
  const workflowId = await fresh(page), { id, node } = await newUtility(page, workflowId);
  await node.getByTestId(`utility-tab-browser-${id}`).click();
  await node.getByRole('textbox', { name: '网页地址', exact: true }).fill(`http://127.0.0.1:${address.port}/`);
  await node.getByRole('button', { name: '前往', exact: true }).click();
  const counter = node.frameLocator('iframe').locator('#counter'); await expect(counter).toHaveText('0');
  await counter.click(); await expect(counter).toHaveText('1');
  await clear(page); await expect(node).not.toHaveClass(/is-selected/);

  const before = await position(workflowId, id);
  await dragAt(page, node.locator('iframe'), 65, 45);
  await expect.poll(() => position(workflowId, id)).toEqual({ x: before.x + 65, y: before.y + 45 });
  await expect(node).not.toHaveClass(/is-selected/); await expect(counter).toHaveText('1');
  await clickAt(page, counter); await expect(node).toHaveClass(/is-selected/); await expect(counter).toHaveText('1');
  await counter.click(); await expect(counter).toHaveText('2');

  const firstPosition = await position(workflowId, id);
  const second = await newUtility(page, workflowId);
  await expect(second.node).toHaveClass(/is-selected/); await expect(node).not.toHaveClass(/is-selected/);
  await expect(counter).toHaveText('2'); expect(await position(workflowId, id)).toEqual(firstPosition);
  await page.screenshot({ path: testInfo.outputPath('utility-iframe-focus-shield.png') });
});
