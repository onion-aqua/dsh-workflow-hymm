import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { addTaskNode, inlineEdit, selectWorkflow, taskNodes } from './helpers.ts';

test.use({viewport:{width:1540,height:980},locale:'zh-CN',colorScheme:'dark'});
let registrationErrors:string[]=[];
test.beforeEach(async({page})=>{
  registrationErrors=[];
  page.on('console',message=>{const text=message.text();if(/unknown.slot|unknown.*slot|visualWorkflow.*(?:not found|not available|not mounted|Unknown remote)/i.test(text))registrationErrors.push(text);});
  page.on('pageerror',error=>registrationErrors.push(error.message));
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>{
    await dialog.getByRole('button',{name:/^(关闭|Close)$/}).click();
  });
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>{
    await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click();
  });
});
test.afterEach(()=>expect(registrationErrors).toEqual([]));
async function openCanvas(page:Page,navigate=true){
  if(navigate)await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');
  const panel=page.getByTestId('workflow-panel');
  const returnButton=page.getByTestId('workflow-return');
  await expect.poll(async()=>await panel.isVisible()||await returnButton.isVisible()).toBe(true);
  if(!(await panel.isVisible()))await returnButton.click();
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('add-workflow')).toBeEnabled();
}
async function saved(page:Page){await expect(page.getByTestId('save-state')).toHaveAttribute('data-state','saved',{timeout:20000});}
async function createTask(page:Page,title:string){
  await addTaskNode(page);
  const id=await taskNodes(page).last().getAttribute('data-node-id');
  if(!id)throw new Error('Task identity is required');
  await inlineEdit(page,id,'title',title);
  await inlineEdit(page,id,'instruction','TEST UI runtime smoke. Reply briefly without tools or file changes.');
  await saved(page);
  return id;
}

test('native conversations remain root cards and each current task revision can be authorized by its own Run button',async({page})=>{
  await openCanvas(page);
  await selectWorkflow(page,'');
  const roots=page.locator('[data-testid^="session-node-"]');
  await expect.poll(()=>roots.count()).toBeGreaterThan(0);
  expect(await page.getByTestId('plan-open').isDisabled()).toBe(true);
  const sourceId=await roots.first().getAttribute('data-session-id');
  expect(sourceId).toBeTruthy();
  const source=page.getByTestId(`session-node-${sourceId}`);
  await source.click();
  await expect(page.getByTestId('trace-entry')).toHaveCount(0);
  await page.getByTestId('original-style').click();
  await expect(page.getByTestId('workflow-panel')).toHaveCount(0);
  await expect(page.getByTestId('workflow-return')).toBeVisible();
  await page.getByTestId('workflow-return').click();
  await expect(source).toBeVisible();
  await source.click();
  await source.getByRole('button',{name:'进入工作流',exact:true}).click();
  await expect(page.getByTestId('workflow-select')).not.toHaveValue('');
  await expect(page.getByTestId('plan-open')).toBeEnabled();
  await expect(source).toBeVisible();
  const taskId=await createTask(page,'TEST UI imported source approval');
  if(process.env.WORKFLOW_EXPECT_NO_MODEL==='1')await expect(page.getByTestId(`node-run-${taskId}`)).toBeDisabled();else await expect(page.getByTestId(`node-run-${taskId}`)).toBeEnabled();
  await expect(page.getByTestId('approve-node')).toHaveCount(0);
  await inlineEdit(page,taskId,'instruction','TEST changed instruction is ready for a new explicit Run click.');
  await saved(page);
  if(process.env.WORKFLOW_EXPECT_NO_MODEL==='1')await expect(page.getByTestId(`node-run-${taskId}`)).toBeDisabled();else await expect(page.getByTestId(`node-run-${taskId}`)).toBeEnabled();
  await expect(source).toBeVisible();
  await mkdir('artifacts/screenshots',{recursive:true});
  await page.screenshot({path:'artifacts/screenshots/phase2-4-canvas.png'});
});

test('missing native model disables execution before creating a Session or Execution',async({page})=>{
  test.skip(process.env.WORKFLOW_EXPECT_NO_MODEL!=='1','Only run against an explicitly unconfigured isolated native host.');
  await openCanvas(page);
  const picker=page.getByTestId('workflow-select');
  const previous=await picker.inputValue();
  await page.getByTestId('add-workflow').click();
  await expect.poll(()=>picker.inputValue()).not.toBe(previous);
  await saved(page);
  const taskId=await createTask(page,'TEST UI actual execution failure');
  await expect(page.getByTestId(`node-run-${taskId}`)).toBeDisabled();await expect(page.getByTestId(`node-status-${taskId}`)).toHaveAttribute('data-state','draft');
  const document=JSON.parse(await readFile(join(process.env.WORKFLOW_STORAGE_ROOT??resolve('artifacts/dsh-home/storages'),'visual_workflow.json'),'utf8'));const workflow=document.tables.workflows[await picker.inputValue()];expect(workflow.executions??[]).toEqual([]);expect(workflow.operations??[]).toEqual([]);
  await page.screenshot({path:'artifacts/screenshots/phase2-4-no-model.png'});
});
