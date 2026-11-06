import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { focusTask, selectWorkflow, waitViewportSettled } from './helpers.ts';

/** Only an explicitly configured, isolated native controlled-model harness may
 * supply these identities. Browser tests never fabricate product trace rows. */
interface NativeTraceFixture {
  workflowId: string;
  nodeId: string;
  completedRunId: string;
  failedRunId: string;
  fileTarget: string;
  commandTarget: string;
  commandOutput: string;
  toolError: string;
  nativeError: string;
}
let fixture: NativeTraceFixture;
const fixturePath = process.env.WORKFLOW_TRACE_FIXTURE;
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1540, height: 980 }, locale: 'zh-CN', colorScheme: 'dark' });
test.beforeAll(async () => {
  if (fixturePath) fixture = JSON.parse(await readFile(resolve(fixturePath), 'utf8')) as NativeTraceFixture;
});
test.beforeEach(async ({ page }) => {
  test.skip(!fixturePath, 'Requires real native Session events from an isolated controlled-model harness.');
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(开始使用|Get started|Get Started)$/ }), async dialog => {
    await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click();
  });
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(预览版说明|Preview.*)$/ }), async dialog => {
    await dialog.getByRole('button', { name: /^(继续|Continue)$/ }).click();
  });
});

async function openTrace(page: Page, runId: string): Promise<Locator> {
  await page.goto(process.env.WORKFLOW_ENTRY_URL ?? '/');
  const panel = page.getByTestId('workflow-panel');
  await expect.poll(async () => await panel.isVisible() || await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if (!(await panel.isVisible())) await page.getByTestId('workflow-return').click();
  await selectWorkflow(page,fixture.workflowId);
  await expect(page.getByTestId(`task-node-${fixture.nodeId}`)).toBeVisible();
  await waitViewportSettled(page);
  await focusTask(page, fixture.nodeId);
  await page.getByTestId('trace-entry').click();
  const trace = page.getByTestId('trace-panel');
  await expect(trace).toBeVisible();
  await trace.getByTestId('execution-select').selectOption(runId);
  await expect(trace.locator('.wf-trace-loading')).toHaveCount(0);
  await expect.poll(() => trace.locator('.wf-trace-step-heading').count()).toBeGreaterThan(0);
  return trace;
}
function traceStep(trace: Locator, text: string): Locator {
  return trace.locator('.wf-trace-step').filter({ hasText: text }).first();
}
async function geometry(page: Page) {
  return page.locator('.react-flow').evaluate(root => ({
    nodes: [...root.querySelectorAll<HTMLElement>('.react-flow__node')].map(node => ({
      id: node.dataset.id, transform: node.style.transform,
      width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
    })),
    edges: [...root.querySelectorAll('.react-flow__edge-path')].map(edge => edge.getAttribute('d')),
  }));
}
async function screenshot(page: Page, name: string) {
  const path = resolve('../../outputs/screenshots', `trace-compact-${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

test('native tool traces use compact action rows and a single command code area without moving the graph', async ({ page }) => {
  const trace = await openTrace(page, fixture.completedRunId);
  const before = await geometry(page);
  const rows = trace.locator('.wf-trace-step-heading');
  const measurements = await rows.evaluateAll(elements => elements.map(element => ({
    height: element.getBoundingClientRect().height,
    text: element.textContent,
  })));
  expect(measurements.length).toBeGreaterThanOrEqual(3);
  for (const row of measurements) expect(row.height).toBeLessThanOrEqual(34);
  expect((await trace.boundingBox())!.width).toBeGreaterThanOrEqual(500);
  const targetFont = await trace.locator('.wf-trace-target').first().evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(targetFont).toBeGreaterThanOrEqual(11);
  await expect(trace).toContainText(fixture.fileTarget);
  await expect(trace).toContainText(fixture.commandTarget);
  await expect(trace.locator('.wf-trace-step-details')).toHaveCount(0);
  await expect(trace).not.toContainText(/Agent step \d|DO_NOT_DISPLAY_REASONING/);
  await screenshot(page, 'collapsed');
  const command = traceStep(trace, fixture.commandTarget);
  await command.locator('.wf-trace-step-heading').click();
  await expect(command.locator('.wf-trace-shell')).toHaveCount(1);
  await expect(command.locator('pre.wf-trace-shell-code')).toContainText(fixture.commandOutput);
  const codeFont = await command.locator('pre.wf-trace-shell-code').evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(codeFont).toBeGreaterThanOrEqual(11);
  await expect(command.locator('.wf-trace-step-details > pre')).toHaveCount(0);
  await expect(command.locator('.wf-trace-more')).not.toHaveAttribute('open', '');
  expect(await geometry(page)).toEqual(before);
  await screenshot(page, 'command-expanded');
  const panelPath = resolve('../../outputs/screenshots/trace-compact-panel.png');
  await mkdir(dirname(panelPath), { recursive: true });
  await trace.screenshot({ path: panelPath });
  await command.locator('.wf-trace-more > summary').click();
  await expect(command.locator('.wf-trace-more')).toHaveAttribute('open', '');
  expect(await geometry(page)).toEqual(before);
  await command.locator('.wf-trace-step-heading').click();
  await expect(command.locator('.wf-trace-step-details')).toHaveCount(0);
  expect(await geometry(page)).toEqual(before);
});

test('native errors remain readable and execution switching clears old expanded details', async ({ page }) => {
  const trace = await openTrace(page, fixture.completedRunId);
  const failed = trace.locator('.wf-trace-step--failed').first();
  await expect(failed).toBeVisible();
  await failed.locator('.wf-trace-step-heading').click();
  await expect(failed).toContainText(fixture.toolError);
  await screenshot(page, 'tool-error');
  await trace.getByTestId('execution-select').selectOption(fixture.failedRunId);
  await expect(trace.getByTestId('execution-select')).toHaveValue(fixture.failedRunId);
  await expect(trace.locator('.wf-trace-meta .wf-tag')).toHaveText('失败');
  await expect(trace.locator('.wf-trace-step-details')).toHaveCount(0);
  await expect(trace).not.toContainText(fixture.toolError);
  const nativeFailure = trace.locator('.wf-trace-step--failed').last();
  await nativeFailure.locator('.wf-trace-step-heading').click();
  await expect(nativeFailure.locator('pre.is-error')).toContainText(fixture.nativeError);
  await screenshot(page, 'native-failure');
  await trace.getByTestId('execution-select').selectOption(fixture.completedRunId);
  await expect(trace.locator('.wf-trace-meta .wf-tag')).toHaveText('已完成');
  await expect(trace.locator('.wf-trace-step-details')).toHaveCount(0);
  await expect(trace).not.toContainText(fixture.nativeError);
});
