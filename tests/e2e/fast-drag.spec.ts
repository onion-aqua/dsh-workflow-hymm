import { expect, test, type Page } from '@playwright/test';
import { addTaskNode, selectWorkflow } from './helpers.ts';

test.use({ viewport: { width: 1540, height: 980 }, locale: 'zh-CN', colorScheme: 'dark' });

test.beforeEach(async ({ page }) => {
  await page.addLocatorHandler(page.getByRole('dialog', { name: /^(开始使用|Get started|Get Started)$/ }), async (dialog) => {
    await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click();
  });
});

async function openWorkflow(page: Page,navigate=true): Promise<void> {
  if(navigate)await page.goto(process.env.WORKFLOW_ENTRY_URL ?? '/');
  const panel=page.getByTestId('workflow-panel');
  await expect.poll(async()=>await panel.isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);
  const continueButton = page.getByRole('button', { name: /^(Continue|继续)$/ });
  if (await continueButton.isVisible()) await continueButton.click();
  if(!(await panel.isVisible())){
    if(await page.getByTestId('workflow-return').isVisible())await page.getByTestId('workflow-return').click();
    else await page.getByTestId('workflow-nav').click();
  }
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('add-workflow')).toBeEnabled();
}

async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved', { timeout: 20000 });
}

test('single mousemove drags persist and creating another workflow commits the inline draft', async ({ page }) => {
  await openWorkflow(page);
  const select = page.getByTestId('workflow-select');
  const previousWorkflow = await select.inputValue();
  await page.getByTestId('add-workflow').click();
  await expect.poll(() => select.inputValue()).not.toBe(previousWorkflow);
  const workflowId = await select.inputValue();
  await waitSaved(page);
  await addTaskNode(page);
  const task = page.locator('[data-testid^="task-node-"]').first();
  await expect(task).toBeVisible();
  const id = await task.getAttribute('data-node-id');
  expect(id).toBeTruthy();
  const node = page.locator(`.react-flow__node[data-id="${id}"]`);
  await waitSaved(page);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const before = await node.evaluate(element => (element as HTMLElement).style.transform);
    const box = await task.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 5, box!.y + 20);
    await page.mouse.down();
    // Deliberately emit only one movement before mouseup: fast native drags
    // must commit the final coordinates even without intermediate render frames.
    await page.mouse.move(box!.x + 85, box!.y + 75);
    await page.mouse.up();
    await expect.poll(() => node.evaluate(element => (element as HTMLElement).style.transform)).not.toBe(before);
    await waitSaved(page);
  }
  // Keep a real pointer drag open across the native catalog refresh cadence.
  // Server facts must not snap an unfinished local gesture back to saved coordinates.
  const slowBox=await task.boundingBox();
  await page.mouse.move(slowBox!.x+5,slowBox!.y+20);
  await page.mouse.down();
  await page.mouse.move(slowBox!.x+65,slowBox!.y+55,{steps:5});
  const heldPosition=await node.evaluate(element=>(element as HTMLElement).style.transform);
  await page.waitForTimeout(1700);
  expect(await node.evaluate(element=>(element as HTMLElement).style.transform)).toBe(heldPosition);
  await page.mouse.up();
  await waitSaved(page);
  const persistedPosition = await node.evaluate(element => (element as HTMLElement).style.transform);

  const title = page.getByTestId(`inline-title-${id}`);
  if(!(await title.isVisible()))await task.getByTestId(`node-title-${id}`).click();
  await expect(title).toHaveAttribute('maxlength', '160');
  await title.fill('Creating another workflow preserves this editor draft');
  await page.getByTestId('add-workflow').click();
  await expect.poll(() => select.inputValue()).not.toBe(workflowId);
  await selectWorkflow(page,workflowId);
  await expect(task).toContainText('Creating another workflow preserves this editor draft');
  await waitSaved(page);
  await task.getByTestId(`node-instruction-${id}`).dblclick();
  const instruction=page.getByTestId('editor-text');await expect(instruction).toBeFocused();
  await instruction.fill('This edit was explicitly saved from the large text editor.');
  await instruction.press('Control+Enter');await expect(page.getByTestId('node-text-editor')).toHaveCount(0);await waitSaved(page);
  await page.getByTestId('add-workflow').click();await expect.poll(()=>select.inputValue()).not.toBe(workflowId);
  await selectWorkflow(page,workflowId);await expect(task).toContainText('This edit was explicitly saved');

  await page.reload();
  await openWorkflow(page,false);
  await selectWorkflow(page,workflowId);
  await expect(task).toContainText('Creating another workflow preserves this editor draft');
  await expect(task).toContainText('This edit was explicitly saved');
  await expect.poll(() => node.evaluate(element => (element as HTMLElement).style.transform)).toBe(persistedPosition);
});
