import { expect,test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { addTaskNode, inlineEdit,taskNodes,waitSaved } from './helpers.ts';

test.use({locale:'zh-CN',colorScheme:'dark'});
test('an old Host 404 blocks execution with a restart instruction and a successful retry never replays a mutation',async({page})=>{
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>dialog.getByRole('button',{name:/^(关闭|Close)$/}).click());
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>dialog.getByRole('button',{name:/^(继续|Continue)$/}).click());
  let mutations=0;
  page.on('request',request=>{if(/\/api\/visualWorkflow\/(?:run|batchRun|delete|generatePlan)(?:\?|$)/.test(request.url()))mutations++;});
  await page.route('**/api/visualWorkflow/capabilities',route=>route.fulfill({status:404,body:'Old Host has no capabilities endpoint'}));
  await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');
  await expect(page.getByTestId('workflow-panel')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('完全退出');
  const picker=page.getByTestId('workflow-select'),before=await picker.inputValue();await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(before);const workflowId=await picker.inputValue();
  await addTaskNode(page);const nodeId=await taskNodes(page).last().getAttribute('data-node-id');if(!nodeId)throw new Error('Missing node');
  await inlineEdit(page,nodeId,'title','Compatibility keeps this Draft');await inlineEdit(page,nodeId,'instruction','Do not execute automatically after reconnect.');await waitSaved(page);
  await expect(page.getByTestId(`node-run-${nodeId}`)).toBeDisabled();await expect(page.getByTestId('run-selected')).toBeDisabled();expect(mutations).toBe(0);
  await page.unroute('**/api/visualWorkflow/capabilities');await page.getByTestId('workflow-retry').click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  if(process.env.WORKFLOW_EXPECT_NO_MODEL!=='1')await expect(page.getByTestId(`node-run-${nodeId}`)).toBeEnabled();
  expect(mutations).toBe(0);
  const root=process.env.WORKFLOW_STORAGE_ROOT??resolve('artifacts/dsh-home/storages'),document=JSON.parse(await readFile(join(root,'visual_workflow.json'),'utf8'));
  expect(document.tables.workflows[workflowId].executions??[]).toEqual([]);expect(document.tables.workflows[workflowId].plans??[]).toEqual([]);
});
