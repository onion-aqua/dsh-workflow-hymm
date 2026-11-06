import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Workflow } from '../../src/shared/model.ts';
import { addTaskNode, blankPoint, inlineEdit, selectModel, selectWorkflow, taskNode, taskNodes, waitSaved } from './helpers.ts';

test.use({viewport:{width:1700,height:1050},locale:'zh-CN',colorScheme:'dark'});
test.beforeEach(async({page})=>{
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(关闭|Close)$/}).click();});
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click();});
});
async function open(page:Page,navigate=true){if(navigate)await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');await expect.poll(async()=>await page.getByTestId('workflow-panel').isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);if(!await page.getByTestId('workflow-panel').isVisible())await page.getByTestId('workflow-return').click();}
async function fresh(page:Page,name:string){await open(page);const picker=page.getByTestId('workflow-select'),before=await picker.inputValue();await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(before);await page.getByTestId('workflow-name-input').fill(name);await page.getByTestId('workflow-name-input').press('Enter');await waitSaved(page);return picker.inputValue();}
async function add(page:Page,title:string){const count=await taskNodes(page).count();await addTaskNode(page);await expect(taskNodes(page)).toHaveCount(count+1);const id=await taskNodes(page).last().getAttribute('data-node-id');if(!id)throw new Error('Missing task identity');await inlineEdit(page,id,'title',title);await inlineEdit(page,id,'instruction','Reply briefly without tools. This task tests native model selection.');return id;}
async function stored(id:string):Promise<Workflow>{const directory=process.env.WORKFLOW_STORAGE_ROOT??resolve('artifacts/dsh-home/storages');return JSON.parse(await readFile(join(directory,'visual_workflow.json'),'utf8')).tables.workflows[id];}
async function move(page:Page,id:string,x:number,y:number){const header=await taskNode(page,id).locator('.wf-task-top').boundingBox();if(!header)throw new Error('Missing task header');await page.mouse.move(header.x+5,header.y+12);await page.mouse.down();await page.mouse.move(x+5,y+12,{steps:12});await page.mouse.up();await waitSaved(page);}
const modelA={provider:'workflow-test',model:'model-a'},modelB={provider:'workflow-test',model:'model-b'};
const keyA=JSON.stringify([modelA.provider,modelA.model]),keyB=JSON.stringify([modelB.provider,modelB.model]);
async function modelsReady(page:Page){const picker=page.getByTestId('global-model-picker');await expect(picker).toBeEnabled();await expect.poll(()=>picker.locator('option').evaluateAll(items=>items.map(item=>(item as HTMLOptionElement).value))).toEqual(expect.arrayContaining([keyA,keyB]));return picker;}
async function screenshot(page:Page,name:string){await mkdir(resolve('../../outputs/screenshots'),{recursive:true});await page.screenshot({path:resolve('../../outputs/screenshots',`models-planning-${name}.png`)});}

test('global model, inherited node model and explicit node override persist and pin the actual batch execution',async({page})=>{
  test.skip(process.env.WORKFLOW_EXPECT_NO_MODEL==='1','Requires the explicitly registered local dual-model native adapter.');test.setTimeout(90000);
  const workflowId=await fresh(page,'全局模型与节点覆盖'),a=await add(page,'继承全局模型'),b=await add(page,'节点独立模型');await move(page,a,300,330);await move(page,b,850,330);const global=await modelsReady(page);
  await selectModel(page,'global-model-picker',keyA);await expect.poll(async()=>(await stored(workflowId)).settings?.model).toEqual(modelA);await expect(page.getByTestId(`node-model-${a}`)).toHaveValue('');
  await selectModel(page,`node-model-${b}`,keyB);await expect.poll(async()=>(await stored(workflowId)).nodes.find(node=>node.id===b)?.model).toEqual(modelB);
  await selectModel(page,'global-model-picker',keyB);const bLabel=await global.locator('option:checked').textContent();await expect(page.getByTestId(`node-model-${a}`).locator('option:checked')).toContainText(bLabel!.split(' · ')[0]!);await expect(page.getByTestId(`node-model-${b}`)).toHaveValue(keyB);await selectModel(page,`node-model-${b}`,'');await expect.poll(async()=>(await stored(workflowId)).nodes.find(node=>node.id===b)?.model).toBeUndefined();await selectModel(page,`node-model-${b}`,keyB);await expect.poll(async()=>(await stored(workflowId)).nodes.find(node=>node.id===b)?.model).toEqual(modelB);await selectModel(page,'global-model-picker',keyA);await waitSaved(page);
  const bubble=await page.getByTestId(`node-model-${b}-trigger`).boundingBox(),grip=await page.getByTestId(`node-resize-${b}`).boundingBox(),body=await taskNode(page,b).locator('.wf-task-body').boundingBox();expect(bubble).not.toBeNull();expect(grip).not.toBeNull();expect(body).not.toBeNull();expect(bubble!.y).toBeGreaterThan(body!.y+body!.height);expect(bubble!.y>=grip!.y+grip!.height||bubble!.x+bubble!.width<=grip!.x||bubble!.x>=grip!.x+grip!.width).toBe(true);
  await page.reload();await open(page,false);await selectWorkflow(page,workflowId);await modelsReady(page);await expect(page.getByTestId('global-model-picker')).toHaveValue(keyA);await expect(page.getByTestId(`node-model-${a}`)).toHaveValue('');await expect(page.getByTestId(`node-model-${b}`)).toHaveValue(keyB);
  const blank=await blankPoint(page,true);await page.mouse.click(blank.x,blank.y);await taskNode(page,a).locator('.wf-task-body').click({position:{x:35,y:45}});await page.keyboard.down('Shift');await taskNode(page,b).locator('.wf-task-body').click({position:{x:35,y:45}});await page.keyboard.up('Shift');await expect(page.getByTestId('run-selected')).toContainText('2');await expect(page.getByTestId('run-selected')).toBeEnabled();await page.getByTestId('run-selected').click();
  await expect.poll(async()=>(await stored(workflowId)).executions?.length).toBe(2);await expect.poll(async()=>(await stored(workflowId)).executions?.filter(run=>run.status==='completed').length).toBe(2);const runs=(await stored(workflowId)).executions!;expect(runs.find(run=>run.nodeId===a)?.resolvedModel).toEqual(modelA);expect(runs.find(run=>run.nodeId===b)?.resolvedModel).toEqual(modelB);await screenshot(page,'node-models');
});

test('an explicit planning request in manual mode uses the chosen model and only accepted proposals become Draft nodes',async({page})=>{
  test.skip(process.env.WORKFLOW_EXPECT_NO_MODEL==='1','Requires the explicitly registered local native planning adapter.');test.setTimeout(90000);const workflowId=await fresh(page,'原生任务规划与审批');const global=await modelsReady(page);await selectModel(page,'global-model-picker',keyB);await waitSaved(page);await page.getByRole('button',{name:'工作流设置',exact:true}).click();await page.locator('.wf-settings-sheet select').first().selectOption('manual');await expect.poll(async()=>(await stored(workflowId)).settings?.generation).toBe('manual');expect((await stored(workflowId)).settings?.model).toEqual(modelB);await page.getByRole('button',{name:'工作流设置',exact:true}).click();await page.getByTestId('plan-open').click();await expect(page.getByTestId('plan-model-picker')).toHaveValue(keyB);await page.getByTestId('plan-goal').fill('Create a proposed read-only three-task plan with dependencies. Do not execute the tasks.');await expect(page.getByTestId('generate-plan')).toBeEnabled();await page.getByTestId('generate-plan').click();
  await expect.poll(async()=>(await stored(workflowId)).plans?.[0]?.status,{timeout:30000}).toBe('proposed');const proposed=await stored(workflowId),plan=proposed.plans![0]!;expect(plan.tasks.length).toBeGreaterThanOrEqual(2);expect(plan.resolvedModel).toEqual(modelB);expect(proposed.nodes).toEqual([]);expect(proposed.edges).toEqual([]);expect(proposed.executions??[]).toEqual([]);await expect(page.getByTestId(`accept-plan-${plan.id}`)).toBeEnabled();await screenshot(page,'plan-proposed');await page.getByTestId(`accept-plan-${plan.id}`).click();
  await expect.poll(async()=>(await stored(workflowId)).nodes.length).toBe(plan.tasks.length);const accepted=await stored(workflowId);expect(accepted.nodes.every(node=>node.status==='draft'&&node.source==='agent')).toBe(true);expect(accepted.edges.length).toBeGreaterThanOrEqual(1);expect(accepted.executions??[]).toEqual([]);expect(accepted.approvals??[]).toEqual([]);await page.reload();await open(page,false);await selectWorkflow(page,workflowId);await expect(taskNodes(page)).toHaveCount(plan.tasks.length);await screenshot(page,'accepted-drafts');
});

test('omitted native planning dependencies show a review warning, preserve explicit links and never execute on acceptance',async({page})=>{
  test.skip(process.env.WORKFLOW_EXPECT_NO_MODEL==='1','Uses only the registered local model transport.');
  const workflowId=await fresh(page,'规划依赖缺省恢复');await modelsReady(page);await page.getByTestId('plan-open').click();
  await page.getByTestId('plan-goal').fill('PLAN_OMITTED_DEPENDENCIES: Propose a draft plan with an omitted root dependency array and one explicit successor.');
  await page.getByTestId('generate-plan').click();
  await expect.poll(async()=>(await stored(workflowId)).plans?.[0]?.status).toBe('proposed');
  const plan=(await stored(workflowId)).plans![0]!;expect(plan.tasks[0]).toMatchObject({dependsOn:[],dependencyUnspecified:true});expect(plan.tasks[1]!.dependsOn).toEqual(['research']);
  await expect(page.getByTestId(`plan-dependency-warning-${plan.id}`)).toContainText('未返回依赖关系');
  await expect(page.getByTestId(`accept-plan-${plan.id}`)).toHaveText('确认依赖并添加所选');
  expect((await stored(workflowId)).nodes).toEqual([]);expect((await stored(workflowId)).executions).toEqual([]);
  await page.reload();await open(page,false);await selectWorkflow(page,workflowId);await page.getByTestId('plan-open').click();
  await expect(page.getByTestId(`plan-dependency-warning-${plan.id}`)).toBeVisible();
  await page.getByTestId(`accept-plan-${plan.id}`).click();await expect.poll(async()=>(await stored(workflowId)).nodes.length).toBe(2);
  const accepted=await stored(workflowId);expect(accepted.edges).toHaveLength(1);expect(accepted.executions).toEqual([]);expect(accepted.nodes.every(node=>node.status==='draft')).toBe(true);
  await screenshot(page,'missing-dependencies-0.12.3');
});

test('native query proposals keep a compact two-task graph in dependency order and preserve it after reload',async({page})=>{
  test.skip(process.env.WORKFLOW_EXPECT_NO_MODEL==='1','Uses only the explicitly registered local model transport; not a live LLM quality evaluation.');
  const workflowId=await fresh(page,'天气查询目标与依赖布局');await modelsReady(page);await page.getByTestId('plan-open').click();
  await page.getByTestId('plan-goal').fill('PLAN_QUERY_OUTCOME：创建一个先查询浙江省一线城市的天气，然后查询宁波天气的工作流。');
  await page.getByTestId('generate-plan').click();await expect.poll(async()=>(await stored(workflowId)).plans?.[0]?.status).toBe('proposed');
  const plan=(await stored(workflowId)).plans![0]!;expect(plan.tasks.map(task=>task.title)).toEqual(['确认城市范围并查询天气','查询宁波天气并汇总']);
  await page.getByTestId(`accept-plan-${plan.id}`).click();await expect.poll(async()=>(await stored(workflowId)).nodes.length).toBe(2);
  const accepted=await stored(workflowId),first=accepted.nodes.find(node=>node.title===plan.tasks[0]!.title)!,second=accepted.nodes.find(node=>node.title===plan.tasks[1]!.title)!;
  expect(second.position.x).toBeGreaterThan(first.position.x+300);expect(second.position.y).toBe(first.position.y);
  expect(accepted.edges.map(edge=>({source:edge.source,target:edge.target}))).toEqual([{source:first.id,target:second.id}]);expect(accepted.executions).toEqual([]);
  await page.getByTestId('plan-panel').getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'适应画布',exact:true}).click();await waitSaved(page);
  const positions=accepted.nodes.map(node=>node.position);await page.reload();await open(page,false);await selectWorkflow(page,workflowId);await expect(taskNodes(page)).toHaveCount(2);
  expect((await stored(workflowId)).nodes.map(node=>node.position)).toEqual(positions);await screenshot(page,'query-outcome-0.12.4');
});

test('blank context menu creates a node, touching a card selects it, and small pointer jitter does not move it',async({page})=>{
  const workflowId=await fresh(page,'右键新建与碰触框选'),a=await add(page,'触碰选中的任务');await move(page,a,350,330);await expect(page.getByTestId('show-catalog')).toHaveCount(0);await selectWorkflow(page,'');await expect(page.getByTestId('workflow-select')).toHaveValue('');await selectWorkflow(page,workflowId);
  const point=await blankPoint(page,true),before=await taskNodes(page).count();await page.mouse.click(point.x,point.y,{button:'right'});await page.getByTestId('context-add-node').click();await expect(taskNodes(page)).toHaveCount(before+1);const added=await taskNodes(page).last().getAttribute('data-node-id');if(!added)throw new Error('Missing context-created node');await inlineEdit(page,added,'title','右键创建的任务');await waitSaved(page);
  const empty=await blankPoint(page);await page.mouse.click(empty.x,empty.y);const card=await taskNode(page,a).boundingBox();if(!card)throw new Error('Missing card');await page.mouse.move(card.x-18,card.y+card.height-28);await page.mouse.down();await page.mouse.move(card.x+28,card.y+card.height+18,{steps:10});await page.mouse.up();await expect(taskNode(page,a)).toHaveClass(/is-selected/);await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
  const old=(await stored(workflowId)).nodes.find(node=>node.id===a)!.position,header=await taskNode(page,a).locator('.wf-task-top').boundingBox();if(!header)throw new Error('Missing header');await page.mouse.move(header.x+5,header.y+12);await page.mouse.down();await page.mouse.move(header.x+7,header.y+13);await page.mouse.up();await waitSaved(page);expect((await stored(workflowId)).nodes.find(node=>node.id===a)!.position).toEqual(old);
  await page.mouse.move(header.x+5,header.y+12);await page.mouse.down();await page.mouse.move(header.x+65,header.y+47,{steps:12});await page.mouse.up();await expect.poll(async()=>(await stored(workflowId)).nodes.find(node=>node.id===a)!.position).toEqual({x:old.x+60,y:old.y+35});await screenshot(page,'partial-selection');
});


test('planning uploads actual native files, switches models, sends and clears only acknowledged draft references',async({page})=>{
  test.skip(process.env.WORKFLOW_EXPECT_NO_MODEL==='1','Uses only the registered local model transport.');test.setTimeout(90000);
  const workflowId=await fresh(page,'规划文件与模型'),global=await modelsReady(page);await selectModel(page,'global-model-picker',keyA);await waitSaved(page);await page.getByTestId('plan-open').click();
  await selectModel(page,'plan-model-picker',keyB);await expect.poll(async()=>(await stored(workflowId)).settings?.model).toEqual(modelB);
  const text='REAL_PLAN_ATTACHMENT_090: Build an offline Markdown preview with readable task cards.';
  await page.getByTestId('file-input-planning').setInputFiles({name:'planning-requirements.txt',mimeType:'text/plain',buffer:Buffer.from(text)});
  await expect.poll(async()=>(await stored(workflowId)).planningAttachments?.length).toBe(1);const reference=(await stored(workflowId)).planningAttachments![0]!;
  await expect(page.getByTestId(`node-file-${reference.id}`)).toBeVisible();await page.getByTestId('plan-goal').fill('PLAN_NATIVE_ATTACHMENT: Read the uploaded requirements and propose two tasks.');await expect(page.getByTestId('generate-plan')).toBeEnabled();await page.getByTestId('generate-plan').click();
  await expect.poll(async()=>(await stored(workflowId)).plans?.[0]?.status,{timeout:30000}).toBe('proposed');const workflow=await stored(workflowId),plan=workflow.plans![0]!;
  expect(plan.resolvedModel).toEqual(modelB);expect(plan.attachments).toEqual([reference]);expect(plan.tasks[0]!.instruction).toContain(text);expect(workflow.planningAttachments).toEqual([]);expect(workflow.nodes).toEqual([]);expect(workflow.executions??[]).toEqual([]);expect(JSON.stringify(workflow)).not.toContain('receiptId');
  await expect(page.getByTestId('plan-goal')).toHaveValue('');await screenshot(page,'native-planning-attachment');
  await page.reload();await open(page,false);await selectWorkflow(page,workflowId);await page.getByTestId('plan-open').click();await expect(page.getByTestId(`plan-${plan.id}`)).toContainText(text);await expect(page.getByTestId('plan-model-picker')).toHaveValue(keyB);
});
