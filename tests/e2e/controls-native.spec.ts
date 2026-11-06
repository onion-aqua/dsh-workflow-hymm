import {expect,test,type Locator,type Page} from '@playwright/test';
import {readFile,readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import type {Workflow} from '../../src/shared/model.ts';
import { addTaskNode, inlineEdit,selectModel,selectWorkflow,taskNode,taskNodes,waitSaved} from './helpers.ts';
test.use({viewport:{width:1700,height:1050},locale:'zh-CN',colorScheme:'dark'});
function root(){const value=process.env.WORKFLOW_STORAGE_ROOT;if(!value)throw new Error('Native control tests need isolated storage');expect(resolve(value).toLowerCase()).not.toBe(resolve(homedir(),'.dsh/storages').toLowerCase());return value;}
async function stored(id:string):Promise<Workflow>{return JSON.parse(await readFile(join(root(),'visual_workflow.json'),'utf8')).tables.workflows[id];}
test.beforeEach(async({page})=>{
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT,'Requires the isolated local model Host');test.setTimeout(90000);
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(关闭|Close)$/}).click();});
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click();});
});
async function fresh(page:Page,token:string){
  await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');await expect(page.getByTestId('workflow-panel')).toBeVisible();
  const picker=page.getByTestId('workflow-select'),before=await picker.inputValue();await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(before);const id=await picker.inputValue();
  await page.getByTestId('workflow-name-input').fill('权限与提醒集成');await page.getByTestId('workflow-name-input').press('Enter');
  await selectModel(page,'global-model-picker',JSON.stringify(['workflow-test','model-a']));await selectModel(page,'access-mode-picker','workspace-write');await waitSaved(page);
  await addTaskNode(page);const nodeId=(await taskNodes(page).last().getAttribute('data-node-id'))!;await inlineEdit(page,nodeId,'title','安全原生测试');await inlineEdit(page,nodeId,'instruction',token);
  return {id,nodeId};
}
async function nativeEvents(sessionId:string){
  const sessionRoot=process.env.WORKFLOW_SESSION_ROOT!;const entries=await readdir(sessionRoot,{recursive:true,withFileTypes:true});const file=entries.find(entry=>entry.isFile()&&basename(entry.parentPath)===sessionId&&entry.name.endsWith('.jsonl'));if(!file)throw new Error('Missing isolated native JSONL');return (await readFile(join(file.parentPath,file.name),'utf8')).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
}
async function blueReminder(locator:Locator,property:'color'|'borderTopColor'='color'){
  await expect(locator).toBeVisible();
  const [red,green,blue]=await locator.evaluate((element,key)=>getComputedStyle(element)[key].match(/[\d.]+/g)!.slice(0,3).map(Number),property);
  expect(blue!,`${await locator.getAttribute('class')} ${property} uses the reminder blue`).toBeGreaterThan(red!+12);
  expect(blue!).toBeGreaterThan(green!+10);
}
test('permission menu uses native labels, distinct shield icons and a compact experimental badge',async({page},testInfo)=>{
  const {id}=await fresh(page,'Permission presentation only; do not execute.');
  const trigger=page.getByTestId('access-mode-picker-trigger');await expect(trigger).toContainText('工作区内修改');await trigger.click();
  const menu=page.getByTestId('access-mode-picker-options');await expect(menu).toBeVisible();
  for(const [value,label] of [['read-only','仅可查看'],['workspace-write','工作区内修改'],['danger-full-access','完全权限']]){
    const row=menu.locator(`[role="option"][data-value="${value}"]`);await expect(row).toBeVisible();await expect(row).toContainText(label!);
    await expect(row.locator(`[data-access-icon="${value}"]`)).toBeVisible();
  }
  const auto=menu.locator('[role="option"][data-value="auto"]');
  if(await auto.count())await expect(auto.locator('sup')).toHaveText('EXP');
  await expect(menu.getByRole('option').filter({hasText:'workspace-write'})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('native-permission-menu.png')});
  await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(trigger).toBeFocused();
  expect((await stored(id)).executions??[]).toHaveLength(0);
});
test('native permissions pin future execution, approvals allow once/reject, and native names use stable numbers',async({page})=>{
  const {id,nodeId}=await fresh(page,'WORKFLOW_APPROVAL_TEST');await page.getByTestId(`node-run-${nodeId}`).click();
  const panel=page.getByTestId('approval-panel');await expect(panel).toBeVisible({timeout:25000});await expect(panel).toContainText('Review controlled zero-side-effect fixture');
  await expect(taskNode(page,nodeId)).toHaveClass(/is-awaiting-answer/);await expect(page.getByTestId(`node-status-${nodeId}`)).toHaveAttribute('data-state','waiting_approval');
  await blueReminder(panel,'borderTopColor');await blueReminder(panel.locator('.wf-approval-header'));await blueReminder(page.getByTestId('approval-inbox'));await blueReminder(page.getByTestId('approval-inbox'),'borderTopColor');await blueReminder(page.getByTestId(`node-status-${nodeId}`));
  expect((await stored(id)).executions!.at(-1)!.resolvedAccessMode).toBe('workspace-write');
  await panel.getByTestId('approval-allow').click();await expect(panel).toHaveCount(0);await expect.poll(async()=>(await stored(id)).executions!.at(-1)!.status).toBe('completed');
  const done=await stored(id),run=done.executions!.at(-1)!;expect(run.summary).toContain('WORKFLOW_APPROVAL_EXECUTED');expect(done.nodes[0]!.displayId).toBe(1);
  const events=await nativeEvents(run.sessionId);expect(JSON.stringify(events)).toContain('权限与提醒集成 · #1 安全原生测试');expect(events.some(event=>event.type==='approval/decided'&&event.data.outcome==='allowed-once')).toBe(true);
  await page.getByTestId(`node-run-${nodeId}`).click();await expect(panel).toBeVisible();await panel.getByTestId('approval-reject').click();await expect(panel).toHaveCount(0);await expect.poll(async()=>(await stored(id)).executions!.at(-1)!.endSeq).toBeDefined();
  const rejected=(await stored(id)).executions!.at(-1)!;const rejectedEvents=await nativeEvents(rejected.sessionId);expect(rejectedEvents.some(event=>event.type==='approval/decided'&&event.data.outcome==='rejected')).toBe(true);
});
test('automatic question continuation counts down only for explicit recommendations and saves sound preferences',async({page})=>{
  const {id,nodeId}=await fresh(page,'WORKFLOW_QUESTION_TEST');await page.getByRole('button',{name:'工作流设置',exact:true}).click();
  await page.getByTestId('question-timeout-enabled').check();await page.getByTestId('question-timeout-seconds').fill('15');await page.getByTestId('sounds-enabled').check();await waitSaved(page);
  const settings=page.getByTestId('settings-sheet');await settings.getByRole('button',{name:'关闭',exact:true}).click();await expect(settings).toHaveCount(0);
  await page.getByTestId(`node-run-${nodeId}`).click();const panel=page.getByTestId('question-panel');await expect(panel).toBeVisible();await expect(panel.getByTestId('question-auto-countdown')).toContainText('自动继续');
  await blueReminder(panel,'borderTopColor');await blueReminder(panel.locator('.wf-question-header'));await blueReminder(page.getByTestId('question-inbox'));await blueReminder(page.getByTestId('question-inbox'),'borderTopColor');await blueReminder(panel.getByTestId('question-auto-countdown'));await blueReminder(page.getByTestId(`node-status-${nodeId}`));
  await page.screenshot({path:'artifacts/0.15.0-blue-question.png'});await expect(panel).toHaveCount(0,{timeout:25000});await expect.poll(async()=>(await stored(id)).executions!.at(-1)!.status).toBe('completed');
  const workflow=await stored(id);expect(workflow.executions!.at(-1)!.summary).toContain('仅杭州（推荐）');expect(workflow.preferences?.sounds?.enabled).toBe(true);
  await page.reload();await selectWorkflow(page,id);await page.getByRole('button',{name:'工作流设置',exact:true}).click();await expect(page.getByTestId('question-timeout-enabled')).toBeChecked();await expect(page.getByTestId('sounds-enabled')).toBeChecked();
});
