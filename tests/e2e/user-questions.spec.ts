import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Workflow } from '../../src/shared/model.ts';
import { addTaskNode, inlineEdit, selectModel, selectWorkflow, taskNode, taskNodes, waitSaved } from './helpers.ts';

test.use({ viewport:{width:1700,height:1050},locale:'zh-CN',colorScheme:'dark' });
const model=JSON.stringify(['workflow-test','model-a']);
function storageRoot():string{
  if(!process.env.WORKFLOW_STORAGE_ROOT)throw new Error('Question tests require an isolated native Host');
  const root=resolve(process.env.WORKFLOW_STORAGE_ROOT);
  expect(root.toLowerCase()).not.toBe(resolve(homedir(),'.dsh','storages').toLowerCase());return root;
}
async function stored(id:string):Promise<Workflow>{return JSON.parse(await readFile(join(storageRoot(),'visual_workflow.json'),'utf8')).tables.workflows[id];}
test.beforeEach(async({page})=>{
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT,'Requires the isolated packaged Host and local fixture model');
  test.setTimeout(90000);
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(关闭|Close)$/}).click();});
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click();});
});
async function create(page:Page,multi=false):Promise<{id:string;nodeId:string;before:unknown}>{
  await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');
  await expect.poll(async()=>await page.getByTestId('workflow-panel').isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if(!await page.getByTestId('workflow-panel').isVisible())await page.getByTestId('workflow-return').click();
  const picker=page.getByTestId('workflow-select'),previous=await picker.inputValue();
  await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(previous);
  const id=await picker.inputValue();
  await selectModel(page,'global-model-picker',model);await waitSaved(page);
  await addTaskNode(page);
  const nodeId=(await taskNodes(page).last().getAttribute('data-node-id'))!;
  await inlineEdit(page,nodeId,'title',multi?'真实原生多题测试':'真实原生提问测试');
  await inlineEdit(page,nodeId,'instruction',`WORKFLOW_QUESTION_TEST ${multi?'MULTI':''}: use the local question fixture only.`);
  const snapshot=await stored(id),node=snapshot.nodes.find(node=>node.id===nodeId)!;
  const before={position:node.position,width:node.width,height:node.height,edges:snapshot.edges};
  await page.getByTestId(`node-run-${nodeId}`).click();
  await expect(page.getByTestId('question-panel')).toBeVisible({timeout:25000});
  return {id,nodeId,before};
}
async function assertComplete(id:string,nodeId:string):Promise<Workflow>{
  await expect.poll(async()=> (await stored(id)).executions?.findLast(run=>run.nodeId===nodeId)?.status,{timeout:25000}).toBe('completed');
  const workflow=await stored(id),run=workflow.executions!.findLast(run=>run.nodeId===nodeId)!;
  expect(run.summary).toContain('WORKFLOW_QUESTION_ANSWER_RECEIVED');return workflow;
}
test('real native question appears automatically, survives refresh, and resumes without changing the graph',async({page})=>{
  const {id,nodeId,before}=await create(page);
  const panel=page.getByTestId('question-panel');
  await expect(panel).toContainText('请选择本地测试的城市范围');
  await expect(taskNode(page,nodeId)).toHaveClass(/is-awaiting-answer/);
  await expect.poll(async()=>(await stored(id)).executions?.at(-1)?.status).toBe('waiting_answer');
  await page.screenshot({path:'artifacts/0.14.0-question-pending.png'});
  await page.reload();await selectWorkflow(page,id);await expect(panel).toBeVisible();
  await panel.getByRole('radio',{name:/杭州 \+ 宁波/}).check();
  await panel.getByTestId('question-submit').click();
  await expect(panel).toHaveCount(0);
  const workflow=await assertComplete(id,nodeId),node=workflow.nodes.find(node=>node.id===nodeId)!;
  expect({position:node.position,width:node.width,height:node.height,edges:workflow.edges}).toEqual(before);
  expect(workflow.executions!.at(-1)!.summary).toContain('杭州 + 宁波');
  expect(JSON.stringify(workflow)).not.toContain('请选择本地测试的城市范围');
});
test('native multi-question answers support custom text, multiple choices, and all-skip',async({page})=>{
  const {id,nodeId}=await create(page,true),panel=page.getByTestId('question-panel');
  await panel.getByTestId('question-custom-city-scope').click();
  await panel.getByTestId('question-custom-input-city-scope').fill('仅测试绍兴');
  await panel.getByRole('checkbox',{name:/温度/}).check();
  await panel.getByRole('checkbox',{name:/湿度/}).check();
  await panel.getByTestId('question-submit').click();await expect(panel).toHaveCount(0);
  const completed=await assertComplete(id,nodeId);
  expect(completed.executions!.at(-1)!.summary).toContain('仅测试绍兴');
  expect(completed.executions!.at(-1)!.summary).toContain('温度');
  const second=await create(page,true);
  await page.getByTestId('question-panel').getByTestId('question-skip-all').click();
  // Skip settles the full batch with explicit empty native answers.
  const visible=page.getByTestId('question-panel');
  await expect(visible).toHaveCount(0);await assertComplete(second.id,second.nodeId);
});
test('a pending panel can be collapsed and reopened without answering or closing its native wait',async({page})=>{
  const {id,nodeId}=await create(page),panel=page.getByTestId('question-panel');
  await panel.getByTestId('question-close').click();await expect(panel).toBeHidden();
  await expect(taskNode(page,nodeId)).toHaveClass(/is-awaiting-answer/);
  await page.getByTestId('question-inbox').click();await expect(panel).toBeVisible();
  await panel.getByRole('radio',{name:/仅杭州/}).check();
  await panel.getByTestId('question-submit').click();await assertComplete(id,nodeId);
});
