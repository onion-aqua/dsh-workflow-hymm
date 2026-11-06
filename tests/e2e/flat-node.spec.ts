import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Workflow } from '../../src/shared/model.ts';
import { addTaskNode, flowNode, focusTask, inlineEdit, selectWorkflow, taskNode, taskNodes, waitSaved, waitViewportSettled } from './helpers.ts';

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
async function fresh(page: Page, name: string) {
  await open(page);
  const picker = page.getByTestId('workflow-select'), previous = await picker.inputValue();
  await page.getByTestId('add-workflow').click();
  await expect.poll(() => picker.inputValue()).not.toBe(previous);
  await page.getByTestId('workflow-name-input').fill(name);
  await page.getByTestId('workflow-name-input').press('Enter');
  await waitSaved(page);
  return picker.inputValue();
}
async function add(page: Page, title: string) {
  const before = await taskNodes(page).count();
  await addTaskNode(page);
  await expect(taskNodes(page)).toHaveCount(before + 1);
  const id = await taskNodes(page).last().getAttribute('data-node-id');
  if (!id) throw new Error('Task identity is required');
  await inlineEdit(page, id, 'title', title);
  await inlineEdit(page, id, 'instruction', '界面验收任务：仅返回文本，不调用工具，不修改文件。');
  return id;
}
async function stored(id: string): Promise<Workflow> {
  const root = process.env.WORKFLOW_STORAGE_ROOT ?? resolve('artifacts/dsh-home/storages');
  return JSON.parse(await readFile(join(root, 'visual_workflow.json'), 'utf8')).tables.workflows[id] as Workflow;
}
async function screenshot(page: Page, name: string) {
  const directory = resolve('../../outputs/screenshots');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `flat-node-${name}.png`) });
}
async function connect(page: Page, from: string, to: string) {
  const source = await page.getByTestId(`source-handle-${from}`).boundingBox(), target = await page.getByTestId(`target-handle-${to}`).boundingBox();
  if (!source || !target) throw new Error('Both native flow handles must be visible');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await waitSaved(page);
}

test('flat task surfaces resize through the actual handle and restore dimensions and edges after reload', async ({ page }) => {
  const workflowId = await fresh(page, '任务工作流 · 缩放与连线');
  const first = await add(page, '可调整大小的任务'), second = await add(page, '依赖节点');
  await page.getByTestId('fit-view').click();
  await waitViewportSettled(page);
  await connect(page, first, second);
  await focusTask(page, first);
  const before = await taskNode(page, first).boundingBox();
  const handle = await page.getByTestId(`node-resize-${first}`).boundingBox();
  if (!before || !handle) throw new Error('Selected task must expose its resize control');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 140, handle.y + handle.height / 2 + 95, { steps: 20 });
  await page.mouse.up();
  await expect.poll(async () => (await taskNode(page, first).boundingBox())!.width).toBeGreaterThan(before.width + 60);
  await waitSaved(page);
  const saved = (await stored(workflowId)).nodes.find(node => node.id === first)!;
  expect(saved.width).toBeGreaterThan(300); expect(saved.height).toBeGreaterThan(210);
  const surface = await taskNode(page, first).evaluate(element => ({ background: getComputedStyle(element).backgroundImage, shadow: getComputedStyle(element).boxShadow }));
  expect(surface).toEqual({ background: 'none', shadow: 'none' });
  await page.reload(); await open(page, false); await selectWorkflow(page, workflowId);
  await expect.poll(() => flowNode(page, first).evaluate(element => Number.parseFloat((element as HTMLElement).style.width))).toBe(saved.width);
  await expect.poll(() => flowNode(page, first).evaluate(element => Number.parseFloat((element as HTMLElement).style.height))).toBe(saved.height);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  expect((await stored(workflowId)).nodes.find(node => node.id === first)!.width).toBe(saved.width);
  await page.getByTestId('auto-layout').click();await waitViewportSettled(page);
  await screenshot(page, 'resized');
});

test('a downstream Run click persists waiting without approval and Stop cancels the unsubmitted intent', async ({ page }) => {
  const workflowId = await fresh(page, '依赖任务等待队列');
  const first = await add(page, '前置任务尚未运行'), later = await add(page, '等待依赖的下游任务');
  await page.getByTestId('fit-view').click(); await waitViewportSettled(page); await connect(page, first, later);
  await expect(page.getByTestId('approve-node')).toHaveCount(0);
  await expect(page.getByTestId(`node-run-${later}`)).toBeEnabled();
  await page.getByTestId(`node-run-${later}`).click();
  await expect(page.getByTestId(`node-status-${later}`)).toHaveAttribute('data-state', 'waiting');
  await expect(taskNode(page, later)).toHaveClass(/is-waiting/);
  await expect(taskNode(page, later).locator('.wf-running-perimeter')).toHaveCount(0);
  const queued = await stored(workflowId), intent = queued.executions!.find(run => run.nodeId === later)!;
  expect(intent).toMatchObject({ status: 'waiting', turns: [] });
  expect(intent.startSeq).toBeUndefined(); expect(intent.authorizationFingerprint).toBeTruthy();
  await page.reload(); await open(page, false); await selectWorkflow(page, workflowId);
  await expect(page.getByTestId(`node-status-${later}`)).toHaveAttribute('data-state', 'waiting');
  await page.getByTestId(`node-stop-${later}`).click();
  await expect(page.getByTestId(`node-status-${later}`)).toHaveAttribute('data-state', 'cancelled');
  expect((await stored(workflowId)).executions!.find(run => run.runId === intent.runId)!.startSeq).toBeUndefined();
  await expect(page.getByTestId(`node-run-${later}`)).toBeEnabled();
  await screenshot(page, 'waiting-cancelled');
});

test('native Session root cards persist resized dimensions independently of their Session', async ({page})=>{
  await open(page);await selectWorkflow(page,'');await page.getByTestId('fit-view').click();await waitViewportSettled(page);
  const card=page.locator('[data-testid^="session-node-"]').first();await expect(card).toBeVisible();
  const sessionId=await card.getAttribute('data-session-id');if(!sessionId)throw new Error('A real native Session root is required');
  const id=`catalog:${sessionId}`,handle=await page.getByTestId(`node-resize-${id}`).boundingBox();if(!handle)throw new Error('Root resize handle is required');
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+80,handle.y+handle.height/2+55,{steps:14});await page.mouse.up();
  const storageRoot=process.env.WORKFLOW_STORAGE_ROOT??resolve('artifacts/dsh-home/storages');
  const size=async()=>JSON.parse(await readFile(join(storageRoot,'visual_workflow.json'),'utf8')).tables.catalog_layout.root.sizes?.[sessionId] as {width:number;height:number}|undefined;
  await expect.poll(async()=> (await size())?.width??0).toBeGreaterThan(300);const saved=(await size())!;
  await page.reload();await open(page,false);await selectWorkflow(page,'');
  await expect.poll(()=>flowNode(page,id).evaluate(element=>Number.parseFloat((element as HTMLElement).style.width))).toBe(saved.width);
  await expect.poll(()=>flowNode(page,id).evaluate(element=>Number.parseFloat((element as HTMLElement).style.height))).toBe(saved.height);
});

test('the custom workflow picker supports keyboard selection and keeps list selection in sync', async ({ page }) => {
  const first = await fresh(page, '产品开发计划'), firstNode = await add(page, '整理需求与依赖');
  await page.getByTestId('add-workflow').click();
  await expect(page.getByTestId('workflow-select')).not.toHaveValue(first);
  const second = await page.getByTestId('workflow-select').inputValue();
  await page.getByTestId('workflow-name-input').fill('资料调研'); await page.getByTestId('workflow-name-input').press('Enter'); await waitSaved(page);
  const picker = page.getByTestId('workflow-picker');
  await expect(picker).toHaveAttribute('role', 'combobox');
  await picker.click();
  const listbox = page.getByTestId('workflow-picker-options');
  await expect(listbox).toHaveAttribute('role', 'listbox');
  await expect(page.getByTestId(`workflow-option-${second}`)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(page.getByTestId('workflow-select')).toHaveValue('');
  await selectWorkflow(page, first);
  await expect(taskNode(page, firstNode)).toBeVisible();
  await picker.click(); await page.keyboard.press('Escape');
  await expect(listbox).toHaveCount(0);
  await expect(page.getByTestId('workflow-select')).toHaveValue(first);
  await picker.click();
  await expect(page.getByTestId(`workflow-option-${first}`)).toHaveAttribute('aria-selected', 'true');
  await screenshot(page, 'picker');
});

test('the Plan composer preflights missing models and reports an actual provider failure', async ({ page }) => {
  const workflowId = await fresh(page, '任务规划');
  await page.getByTestId('plan-open').click();
  const panel = page.getByTestId('plan-panel'), composer = page.getByTestId('plan-goal');
  await expect(panel).toBeVisible(); await expect(composer).toBeVisible();
  await screenshot(page, 'plan-welcome');
  await composer.fill('Draft only a read-only repository audit plan.');
  await page.getByTestId('plan-new-chat').click();
  await expect(composer).toHaveValue('');
  if(process.env.WORKFLOW_EXPECT_NO_MODEL==='1'){
    await composer.fill('Create a short proposed task plan without executing tools.');await expect(page.getByTestId('generate-plan')).toBeDisabled();await expect(page.getByTestId('planning-availability')).toContainText(/模型|model|配置/i);expect((await stored(workflowId)).plans??[]).toEqual([]);expect((await stored(workflowId)).nodes).toEqual([]);await screenshot(page,'plan-no-model');return;
  }
  await composer.fill('MODEL_FAILURE Create a short proposed task plan without executing tools.');
  await expect(page.getByTestId('generate-plan')).toBeEnabled();
  await page.getByTestId('generate-plan').click();
  await expect.poll(async () => (await stored(workflowId)).plans?.[0]?.status, { timeout: 30000 }).toBe('failed');
  await expect(panel).toContainText(/模型|model|provider|配置|失败|failed/i);
  expect((await stored(workflowId)).nodes).toEqual([]);
  await screenshot(page, 'plan-chat');
});

test('the isolated stylesheet fixture animates the running perimeter without adding effects to idle cards', async ({ page }) => {
  // This is a declared component/CSS fixture, separate from the product Host.
  // Native HOLD integration tests prove the real Agent running lifecycle.
  const css = await readFile(resolve('src/client/styles.css'), 'utf8');
  await page.setContent('<main class="dsh-workflow"><article class="wf-task is-running" data-fixture="running"><svg class="wf-running-perimeter"><rect x="1" y="1" width="298" height="208" pathLength="100"/></svg></article><article class="wf-task is-waiting" data-fixture="waiting"></article><article class="wf-task" data-fixture="idle"></article></main>');
  await page.addStyleTag({ content: css });
  const running = page.locator('[data-fixture="running"] .wf-running-perimeter rect');
  const animation = await running.evaluate(element => ({ name: getComputedStyle(element).animationName, duration: getComputedStyle(element).animationDuration, stroke: getComputedStyle(element).stroke }));
  expect(animation.name).not.toBe('none'); expect(Number.parseFloat(animation.duration)).toBeGreaterThan(0);
  const channels = animation.stroke.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  expect(channels).toHaveLength(3);
  expect(channels!.every(value => value >= 235 && value <= 255)).toBe(true);
  await expect(page.locator('[data-fixture="waiting"] .wf-running-perimeter')).toHaveCount(0);
  await expect(page.locator('[data-fixture="idle"] .wf-running-perimeter')).toHaveCount(0);
});
