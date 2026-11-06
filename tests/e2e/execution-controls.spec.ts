import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Workflow } from '../../src/shared/model.ts';
import { addTaskNode, blankPoint, inlineEdit, selectModel, selectWorkflow, taskNode, taskNodes, waitSaved } from './helpers.ts';

test.use({viewport:{width:1700,height:1050},locale:'zh-CN',colorScheme:'dark'});
const keyA=JSON.stringify(['workflow-test','model-a']),keyB=JSON.stringify(['workflow-test','model-b']);
function paths(){const storage=resolve(process.env.WORKFLOW_STORAGE_ROOT!),home=resolve(process.env.WORKFLOW_TEST_DSH_HOME??dirname(storage));expect(home.toLowerCase()).not.toBe(resolve(homedir(),'.dsh').toLowerCase());return{home,storage};}
test.beforeEach(async({page})=>{
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT,'Requires the isolated controls-0.17.0 native fixture');test.setTimeout(120000);paths();
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>dialog.getByRole('button',{name:/^(关闭|Close)$/}).click());
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>dialog.getByRole('button',{name:/^(继续|Continue)$/}).click());
});
async function stored(id:string):Promise<Workflow>{return JSON.parse(await readFile(join(paths().storage,'visual_workflow.json'),'utf8')).tables.workflows[id];}
async function fresh(page:Page,name:string){
  await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');await expect.poll(async()=>await page.getByTestId('workflow-panel').isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if(!await page.getByTestId('workflow-panel').isVisible())await page.getByTestId('workflow-return').click();
  const picker=page.getByTestId('workflow-select'),before=await picker.inputValue();await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(before);
  await page.getByTestId('workflow-name-input').fill(name);await page.getByTestId('workflow-name-input').press('Enter');await waitSaved(page);await selectModel(page,'global-model-picker',keyA);await waitSaved(page);return picker.inputValue();
}
async function add(page:Page,title:string,instruction='CONTROLS_QUICK: reply briefly without tools.'){
  const count=await taskNodes(page).count();await addTaskNode(page);await expect(taskNodes(page)).toHaveCount(count+1);const id=await taskNodes(page).last().getAttribute('data-node-id');if(!id)throw new Error('Missing node identity');
  await inlineEdit(page,id,'title',title);await inlineEdit(page,id,'instruction',instruction);return id;
}
async function move(page:Page,id:string,x:number,y:number){const rect=(await taskNode(page,id).locator('.wf-task-top').boundingBox())!;await page.mouse.move(rect.x+5,rect.y+12);await page.mouse.down();await page.mouse.move(x+5,y+12,{steps:15});await page.mouse.up();await waitSaved(page);}
async function selectBox(page:Page,ids:string[]){const boxes=await Promise.all(ids.map(id=>taskNode(page,id).boundingBox()));const x=Math.min(...boxes.map(box=>box!.x))-18,y=Math.min(...boxes.map(box=>box!.y))-18,right=Math.max(...boxes.map(box=>box!.x+box!.width))+18,bottom=Math.max(...boxes.map(box=>box!.y+box!.height))+18;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(right,bottom,{steps:20});await page.mouse.up();await expect(page.locator('.react-flow__node.selected')).toHaveCount(ids.length);}
async function connect(page:Page,from:string,to:string){const source=(await page.getByTestId(`source-handle-${from}`).boundingBox())!,target=(await page.getByTestId(`target-handle-${to}`).boundingBox())!;await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:16});await page.mouse.up();await waitSaved(page);}
async function changeEffort(page:Page,picker:string,model:string,effort:'low'|'high'|'max'){
  const previous=await page.getByTestId(picker).inputValue();await page.getByTestId(`${picker}-trigger`).click();const menu=page.getByTestId(`${picker}-options`);
  const row=menu.getByRole('option').filter({has:page.locator('span')});let target;
  for(const option of await row.all())if(await option.getAttribute('data-value')===model)target=option;
  if(!target)throw new Error('Missing requested model row');await target.click({button:'right'});
  const panel=page.getByTestId(`${picker}-reasoning-popover`);await expect(panel).toBeVisible();const range=panel.getByRole('slider');await expect(range).toBeEnabled();
  await range.press(effort==='low'?'Home':'End');if(effort==='high')await range.press('ArrowLeft');
  await expect(range).toHaveAttribute('aria-valuetext',new RegExp(effort));await expect(page.getByTestId(picker)).toHaveValue(previous);await waitSaved(page);
  const rect=(await panel.boundingBox())!;expect(rect.x).toBeGreaterThanOrEqual(8);expect(rect.x+rect.width).toBeLessThanOrEqual(1693);expect(rect.y+rect.height).toBeLessThanOrEqual(1043);
  await page.screenshot({path:resolve('../../outputs/screenshots',`controls-${picker.startsWith('node-')?'node':picker}-reasoning.png`)});
  await range.press('Escape');await expect(panel).toHaveCount(0);await expect(menu).toBeVisible();await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);
}
async function events(sessionId:string){const found:string[]=[];async function walk(directory:string,inside=false):Promise<void>{for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const path=join(directory,entry.name);if(entry.isDirectory())await walk(path,inside||entry.name===sessionId);else if(inside&&entry.name.endsWith('.jsonl'))found.push(path);}}await walk(join(paths().home,'sessions'));return(await Promise.all(found.map(file=>readFile(file,'utf8')))).flatMap(text=>text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)));}

test('model context controls persist exact native effort from global, node and planning menus without switching models',async({page})=>{
  await mkdir(resolve('../../outputs/screenshots'),{recursive:true});const workflowId=await fresh(page,'思考程度原生接入'),nodeId=await add(page,'执行模型参数');
  await changeEffort(page,'global-model-picker',keyB,'max');expect((await stored(workflowId)).settings?.model).toEqual({provider:'workflow-test',model:'model-a'});
  expect((await stored(workflowId)).settings?.modelReasoning).toContainEqual({provider:'workflow-test',model:'model-b',reasoningEffort:'max'});
  await changeEffort(page,`node-model-${nodeId}`,keyB,'low');expect((await stored(workflowId)).nodes.find(node=>node.id===nodeId)?.model).toBeUndefined();
  await page.getByTestId('plan-open').click();await changeEffort(page,'plan-model-picker',keyB,'max');await page.getByTestId('plan-panel').getByRole('button',{name:'关闭',exact:true}).click();
  await selectModel(page,'global-model-picker',keyB);await waitSaved(page);await page.getByTestId(`node-run-${nodeId}`).click();
  await expect.poll(async()=>(await stored(workflowId)).executions?.findLast(run=>run.nodeId===nodeId)?.status,{timeout:30000}).toBe('completed');
  const run=(await stored(workflowId)).executions!.findLast(run=>run.nodeId===nodeId)!;expect(run.resolvedModel).toEqual({provider:'workflow-test',model:'model-b',reasoningEffort:'max'});
  await expect.poll(async()=>(await events(run.sessionId)).filter(event=>event.type==='request/header').at(-1)?.data?.header?.config?.reasoningEffort).toBe('max');
  await page.reload();await expect(page.getByTestId('workflow-panel')).toBeVisible();await selectWorkflow(page,workflowId);expect((await stored(workflowId)).settings?.modelReasoning).toContainEqual({provider:'workflow-test',model:'model-b',reasoningEffort:'max'});
});

test('Run selected becomes Pause all, pauses active and queued work, and a new selection restores Run',async({page})=>{
  const workflowId=await fresh(page,'暂停所有与选择切换'),a=await add(page,'慢任务','CONTROLS_SLOW: wait for cancellation.'),b=await add(page,'等待前置'),c=await add(page,'下一组');
  await move(page,a,280,300);await move(page,b,800,300);await move(page,c,1250,650);await connect(page,a,b);await selectBox(page,[a,b]);
  const button=page.getByTestId('run-selected');await expect(button).toContainText('2');await button.click();await expect(button).toHaveAttribute('data-mode','pause');await expect(button).toContainText('暂停所有');
  await expect.poll(async()=>{const executions=(await stored(workflowId)).executions??[];return executions.some(run=>run.nodeId===a&&run.status==='running')&&executions.some(run=>run.nodeId===b&&run.status==='waiting');}).toBe(true);
  await expect(button).toBeEnabled();await page.screenshot({path:resolve('../../outputs/screenshots','controls-pause-all.png')});await button.click();
  await expect.poll(async()=>(await stored(workflowId)).executions?.every(run=>run.status==='cancelled')).toBe(true);expect((await stored(workflowId)).archivedAt).toBeUndefined();await expect(button).toHaveAttribute('data-mode','pause');
  const point=await blankPoint(page);await page.mouse.click(point.x,point.y);await taskNode(page,c).locator('.wf-task-top').click({position:{x:5,y:12}});await expect(button).toHaveAttribute('data-mode','run');await expect(button).toContainText('1');
  const calls=(await readFile(join(paths().home,'model-calls.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));const original=(await stored(workflowId)).executions!;
  expect(calls.some(call=>call.kind==='cancelled'&&call.sessionId===original.find(run=>run.nodeId===a)?.sessionId)).toBe(true);expect(original.find(run=>run.nodeId===b)?.startSeq).toBeUndefined();
});

test('deleting active workflow stops native work and keeps the separate history choice',async({page})=>{
  const workflowId=await fresh(page,'删除时自动停止'),nodeId=await add(page,'删除运行任务','CONTROLS_SLOW: wait for delete cancellation.');await page.getByTestId(`node-run-${nodeId}`).click();
  await expect.poll(async()=>(await stored(workflowId)).executions?.findLast(run=>run.nodeId===nodeId)?.status).toBe('running');
  await page.getByTestId('workflow-picker').click();await page.getByTestId(`delete-workflow-${workflowId}`).click();await page.getByTestId('confirm-delete-workflow').click();
  const dialog=page.getByTestId('delete-workflow-dialog');
  await expect(dialog).toHaveCount(0,{timeout:30000});const history=page.getByTestId('workflow-history-choice');await expect(history).toBeVisible();
  const archived=await stored(workflowId);expect(archived.archivedAt).toBeGreaterThan(0);expect(archived.executions?.every(run=>run.status==='cancelled')).toBe(true);
  await page.screenshot({path:resolve('../../outputs/screenshots','controls-delete-history-choice.png')});await page.getByTestId('keep-workflow-history').click();await expect(history).toHaveCount(0);
  const run=archived.executions![0]!;const log=await events(run.sessionId);expect(log.some(event=>event.type==='turn/end')).toBe(true);
  const calls=(await readFile(join(paths().home,'model-calls.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(calls.some(call=>call.kind==='cancelled'&&call.sessionId===run.sessionId)).toBe(true);
});
