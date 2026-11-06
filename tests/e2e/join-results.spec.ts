import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Workflow } from '../../src/shared/model.ts';
import { focusTask, selectModel, selectWorkflow, taskNodes, waitSaved, waitViewportSettled } from './helpers.ts';

test.use({ viewport: { width: 1800, height: 1100 }, locale: 'zh-CN', colorScheme: 'dark' });
test.beforeEach(async ({ page }) => {
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT || process.env.WORKFLOW_EXPECT_NO_MODEL === '1', 'Requires an explicitly isolated packaged DSH Host with scripts/workflow-model-fixture.mjs.');
  test.setTimeout(180000);
  expect(resolve(process.env.WORKFLOW_STORAGE_ROOT!).toLowerCase()).not.toBe(resolve(homedir(), '.dsh', 'storages').toLowerCase());
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(开始使用|Get started|Get Started)$/ }), async dialog => { await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click(); });
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(预览版说明|Preview.*)$/ }), async dialog => { await dialog.getByRole('button', { name: /^(继续|Continue)$/ }).click(); });
});
async function stored(id: string): Promise<Workflow> {
  return JSON.parse(await readFile(join(process.env.WORKFLOW_STORAGE_ROOT!, 'visual_workflow.json'), 'utf8')).tables.workflows[id];
}
async function canvas(page: Page) {
  await expect.poll(async () => await page.getByTestId('workflow-panel').isVisible() || await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if (!await page.getByTestId('workflow-panel').isVisible()) await page.getByTestId('workflow-return').click();
}
async function openJoinTrace(page: Page, nodeId: string) {
  await focusTask(page, nodeId);
  await page.getByTestId('trace-entry').click();
  const panel = page.getByTestId('trace-panel'); await expect(panel).toBeVisible();
  const inputs = panel.getByTestId('trace-result-inputs'); await expect(inputs).toBeVisible();
  await expect(inputs.locator('summary')).toHaveText('已汇合 3 个上游执行结果');
  await inputs.locator('summary').click();
  await expect(inputs).toHaveAttribute('open', '');
  await expect(inputs.locator('.wf-trace-result-source')).toHaveCount(3);
  return inputs;
}

test('a planned diamond joins independent native results, continues downstream and restores provenance after reload', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.WORKFLOW_ENTRY_URL ?? '/'); await canvas(page);
  const picker = page.getByTestId('workflow-select'), before = await picker.inputValue();
  await page.getByTestId('add-workflow').click(); await expect(picker).not.toHaveValue(before);
  const workflowId = await picker.inputValue();
  await page.getByTestId('workflow-name-input').fill('独立分支汇合验收'); await page.getByTestId('workflow-name-input').press('Enter'); await waitSaved(page);
  await selectModel(page, 'global-model-picker', JSON.stringify(['workflow-test', 'model-a'])); await waitSaved(page);
  await page.getByTestId('plan-open').click();
  await page.getByTestId('plan-goal').fill('JOIN_RESULTS_PLAN: Build the controlled A -> (B, C) -> D -> E graph. LOCAL_FIXTURE only; do not use tools or write files.');
  await expect(page.getByTestId('generate-plan')).toBeEnabled(); await page.getByTestId('generate-plan').click();
  await expect.poll(async () => (await stored(workflowId)).plans?.at(-1)?.status, { timeout: 30000 }).toBe('proposed');
  const proposed = (await stored(workflowId)).plans!.at(-1)!; expect(proposed.tasks).toHaveLength(5);
  await page.getByTestId(`accept-plan-${proposed.id}`).click();
  await expect.poll(async () => (await stored(workflowId)).nodes.length).toBe(5); await expect(taskNodes(page)).toHaveCount(5);
  await page.getByTestId('plan-panel').getByRole('button', { name: '关闭', exact: true }).click(); await waitSaved(page);
  await page.getByTestId('fit-view').click(); await waitViewportSettled(page);
  const graph = await stored(workflowId);
  const nodes = Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(letter => [letter, graph.nodes.find(node => node.title.startsWith(`${letter} ·`))!]));
  expect(graph.edges).toHaveLength(5);
  // Every native admission is triggered through a real visible Run action.
  for (const letter of ['A', 'B', 'C', 'D', 'E']) {
    const node = nodes[letter]!; expect(node).toBeDefined();
    await expect(page.getByTestId(`node-run-${node.id}`)).toBeEnabled(); await page.getByTestId(`node-run-${node.id}`).click();
    await expect.poll(async () => (await stored(workflowId)).executions?.findLast(run => run.nodeId === node.id)?.status, { timeout: 30000 }).toBe('completed');
    await expect(page.getByTestId(`node-status-${node.id}`)).toHaveAttribute('data-state', 'completed');
  }
  const complete = await stored(workflowId), runs = Object.fromEntries(Object.entries(nodes).map(([letter, node]) => [letter, complete.executions!.findLast(run => run.nodeId === node.id)!]));
  expect(runs.B!.sessionId).not.toBe(runs.C!.sessionId);
  expect(runs.D!.sessionId).not.toBe(runs.B!.sessionId); expect(runs.D!.sessionId).not.toBe(runs.C!.sessionId);
  expect(runs.D!.resultInputs).toHaveLength(3);
  expect(new Set(runs.D!.resultInputs!.map(input => input.runId))).toEqual(new Set([runs.A!.runId, runs.B!.runId, runs.C!.runId]));
  expect(runs.E!.status).toBe('completed'); expect(complete.nodes.every(node => node.status === 'completed' && !node.resultStale)).toBe(true);
  const provenance = await openJoinTrace(page, nodes.D!.id);
  for (const input of runs.D!.resultInputs!) {
    const source = provenance.getByTestId(`trace-result-input-${input.runId}`); await expect(source).toContainText(input.sessionId); await expect(source).toContainText(`${input.startSeq}–${input.endSeq}`);
  }
  await page.screenshot({ path: info.outputPath('join-results-provenance.png') });
  const savedRefs = runs.D!.resultInputs;
  await page.reload(); await canvas(page); await selectWorkflow(page, workflowId); await page.getByTestId('fit-view').click(); await waitViewportSettled(page);
  for (const node of Object.values(nodes)) await expect(page.getByTestId(`node-status-${node.id}`)).toHaveAttribute('data-state', 'completed');
  expect((await stored(workflowId)).executions!.find(run => run.runId === runs.D!.runId)!.resultInputs).toEqual(savedRefs);
  const restored = await openJoinTrace(page, nodes.D!.id); await expect(restored).toContainText(runs.B!.sessionId); await expect(restored).toContainText(runs.C!.sessionId);
  await page.screenshot({ path: info.outputPath('join-results-restored.png') });
  expect(errors).toEqual([]);
});
