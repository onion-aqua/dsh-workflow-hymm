import {expect,test,type Page} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Workflow} from '../../src/shared/model.ts';
import { addTaskNode, blankPoint,contextMenu,flowNode,inlineEdit,selectWorkflow,taskNode,taskNodes,waitSaved,waitViewportSettled} from './helpers.ts';
test.use({viewport:{width:1700,height:1050},locale:'zh-CN',colorScheme:'dark'});
test.beforeEach(async({page})=>{
 await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(关闭|Close)$/}).click();});
 await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click();});
});
async function open(page:Page,navigate=true){if(navigate)await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');await expect.poll(async()=>await page.getByTestId('workflow-panel').isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);if(!await page.getByTestId('workflow-panel').isVisible())await page.getByTestId('workflow-return').click();}
async function fresh(page:Page,name:string){await open(page);const picker=page.getByTestId('workflow-select'),previous=await picker.inputValue();await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(previous);await page.getByTestId('workflow-name-input').fill(name);await page.getByTestId('workflow-name-input').press('Enter');await waitSaved(page);return picker.inputValue();}
async function add(page:Page,title:string){const count=await taskNodes(page).count();await addTaskNode(page);await expect(taskNodes(page)).toHaveCount(count+1);const id=await taskNodes(page).last().getAttribute('data-node-id');if(!id)throw new Error('Missing task');await inlineEdit(page,id,'title',title);await inlineEdit(page,id,'instruction','界面验收任务，不修改任何文件。');return id;}
async function stored(id:string){const root=process.env.WORKFLOW_STORAGE_ROOT??resolve('artifacts/dsh-home/storages');return JSON.parse(await readFile(join(root,'visual_workflow.json'),'utf8')).tables.workflows[id] as Workflow;}
async function move(page:Page,id:string,x:number,y:number){const h=await taskNode(page,id).locator('.wf-task-top').boundingBox();if(!h)throw new Error('Missing header');await page.mouse.move(h.x+5,h.y+12);await page.mouse.down();await page.mouse.move(x+5,y+12,{steps:15});await page.mouse.up();await waitSaved(page);}
async function box(page:Page,ids:string[]){const boxes=await Promise.all(ids.map(id=>taskNode(page,id).boundingBox()));if(boxes.some(b=>!b))throw new Error('Missing node box');const x=Math.min(...boxes.map(b=>b!.x))-18,y=Math.min(...boxes.map(b=>b!.y))-18,r=Math.max(...boxes.map(b=>b!.x+b!.width))+18,b=Math.max(...boxes.map(b=>b!.y+b!.height))+18;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(r,b,{steps:22});await page.mouse.up();await expect(page.locator('.react-flow__node.selected')).toHaveCount(ids.length);}
async function snapshot(page:Page,name:string){await mkdir(resolve('../../outputs/screenshots'),{recursive:true});await page.screenshot({path:resolve('../../outputs/screenshots',`selection-0.6.0-${name}.png`)});}

test('header is the only task name and double click opens a functional large editor',async({page})=>{
 const workflowId=await fresh(page,'节点标题与文本编辑');const id=await add(page,'资料调研');
 await expect(taskNode(page,id).locator('.wf-task-heading')).toContainText('资料调研');await expect(taskNode(page,id).locator('.wf-task-body h3')).toHaveCount(0);
 const before=await page.locator('.react-flow__viewport').getAttribute('style');await taskNode(page,id).locator('.wf-task-body').dblclick({position:{x:100,y:70}});
 await expect(page.getByTestId('node-text-editor')).toBeVisible();await expect(page.getByTestId('editor-text')).toBeFocused();await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style',before!);
 await page.getByTestId('editor-text').fill('准备调研提纲');await page.getByTestId('editor-text').press('Control+A');await page.getByTestId('editor-bold').click();await expect(page.getByTestId('editor-text').locator('strong')).toHaveText('准备调研提纲');await expect(page.getByTestId('editor-text')).toHaveText('准备调研提纲');
 await page.getByTestId('editor-undo').click();await expect(page.getByTestId('editor-text').locator('strong')).toHaveCount(0);await expect(page.getByTestId('editor-text')).toHaveText('准备调研提纲');await page.getByTestId('editor-redo').click();
 await page.getByTestId('editor-maximize').click();await expect(page.getByRole('dialog',{name:'编辑文本'})).toHaveClass(/is-maximized/);await snapshot(page,'editor');
 await page.getByTestId('editor-save').click();await expect(page.getByTestId('node-text-editor')).toHaveCount(0);await waitSaved(page);expect((await stored(workflowId)).nodes[0]!.instruction).toBe('**准备调研提纲**');
 await taskNode(page,id).locator('.wf-task-body').dblclick({position:{x:100,y:70}});await page.getByTestId('editor-text').fill('不应保存的草稿');await page.getByTestId('editor-cancel').click();
 await page.reload();await open(page,false);await selectWorkflow(page,workflowId);await expect(taskNode(page,id).locator('.wf-node-question strong')).toHaveText('准备调研提纲');await expect(taskNode(page,id)).not.toContainText('不应保存');
});

test('left mouse boxes multiple nodes and group drag persists all positions while middle mouse pans',async({page})=>{
 const workflowId=await fresh(page,'框选与组合移动');const ids=[await add(page,'调研'),await add(page,'设计'),await add(page,'验证')];await move(page,ids[0]!,300,300);await move(page,ids[1]!,750,300);await move(page,ids[2]!,1250,650);
 const viewport=page.locator('.react-flow__viewport'),before=await viewport.getAttribute('style');await box(page,ids.slice(0,2));await expect(viewport).toHaveAttribute('style',before!);await expect(page.getByTestId('run-selected')).toContainText('2');
 await page.waitForTimeout(1500);await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
 const original=(await stored(workflowId)).nodes;const h=await taskNode(page,ids[0]!).locator('.wf-task-top').boundingBox();if(!h)throw new Error('Missing header');await page.mouse.move(h.x+5,h.y+12);await page.mouse.down();await page.mouse.move(h.x+95,h.y+72,{steps:15});await page.mouse.up();await waitSaved(page);
 const after=(await stored(workflowId)).nodes;for(const id of ids.slice(0,2)){const old=original.find(n=>n.id===id)!,next=after.find(n=>n.id===id)!;expect(next.position.x-old.position.x).toBeCloseTo(90,0);expect(next.position.y-old.position.y).toBeCloseTo(60,0);}expect(after.find(n=>n.id===ids[2])!.position).toEqual(original.find(n=>n.id===ids[2])!.position);
 await snapshot(page,'selected');await page.reload();await open(page,false);await selectWorkflow(page,workflowId);expect((await stored(workflowId)).nodes.map(n=>n.position)).toEqual(after.map(n=>n.position));
 const empty=await blankPoint(page,true),transform=await viewport.getAttribute('style');await page.mouse.move(empty.x,empty.y);await page.mouse.down({button:'middle'});await page.mouse.move(empty.x-70,empty.y-45,{steps:12});await page.mouse.up({button:'middle'});await expect.poll(()=>viewport.getAttribute('style')).not.toBe(transform);await waitViewportSettled(page);
});

test('Run selected submits the complete selection atomically and failure has a red dashed border',async({page})=>{
 const workflowId=await fresh(page,'批量执行与错误反馈');const a=await add(page,'第一项任务'),b=await add(page,'第二项任务');await inlineEdit(page,a,'instruction','MODEL_FAILURE First test task, no tools.');await inlineEdit(page,b,'instruction','MODEL_FAILURE Second test task, no tools.');await move(page,a,300,300);await move(page,b,850,300);await box(page,[a,b]);
 if(process.env.WORKFLOW_EXPECT_NO_MODEL==='1'){await expect(page.getByTestId('run-selected')).toBeDisabled();expect((await stored(workflowId)).executions??[]).toEqual([]);await snapshot(page,'no-model');return;}
 await page.getByTestId('run-selected').click();await expect.poll(async()=>(await stored(workflowId)).executions?.length).toBe(2);
 const record=await stored(workflowId);const batch=record.operations!.find(op=>op.kind==='batch-run');expect(batch?.runIds).toHaveLength(2);expect(new Set(record.executions!.map(run=>run.nodeId))).toEqual(new Set([a,b]));
 await expect.poll(async()=>(await stored(workflowId)).executions!.filter(run=>run.status==='failed').length).toBe(2);
 for(const id of [a,b]){await expect(taskNode(page,id)).toHaveClass(/is-failed/);const border=await taskNode(page,id).locator('.wf-task-body').evaluate(element=>({style:getComputedStyle(element).borderStyle,width:parseFloat(getComputedStyle(element).borderTopWidth)}));expect(border.style).toBe('dashed');expect(border.width).toBeGreaterThanOrEqual(2);}
 await snapshot(page,'failed');
});

test('workflow picker archives a confirmed workflow and rejects deletion of waiting work',async({page})=>{
 const workflowId=await fresh(page,'待删除的工作流');await add(page,'保留原生历史');await page.getByTestId('workflow-picker').click();await page.getByTestId(`delete-workflow-${workflowId}`).click();await expect(page.getByTestId('delete-workflow-dialog')).toContainText('原生');await page.getByRole('button',{name:'取消',exact:true}).click();expect((await stored(workflowId)).archivedAt).toBeUndefined();
 await page.getByTestId('workflow-picker').click();await page.getByTestId(`delete-workflow-${workflowId}`).click();await snapshot(page,'delete');await page.getByTestId('confirm-delete-workflow').click();await expect(page.getByTestId('delete-workflow-dialog')).toHaveCount(0);await expect.poll(async()=>(await stored(workflowId)).archivedAt).toBeGreaterThan(0);await expect(page.getByTestId('workflow-history-choice')).toBeVisible();await page.getByTestId('keep-workflow-history').click();await expect(page.getByTestId('workflow-history-choice')).toHaveCount(0);await page.getByTestId('workflow-picker').click();await expect(page.getByTestId(`workflow-option-${workflowId}`)).toHaveCount(0);await page.keyboard.press('Escape');
 await page.reload();await open(page,false);await page.getByTestId('workflow-picker').click();await expect(page.getByTestId(`workflow-option-${workflowId}`)).toHaveCount(0);await page.keyboard.press('Escape');
 const waitingId=await fresh(page,'等待任务不可删除');const a=await add(page,'前置任务'),b=await add(page,'等待任务');await move(page,a,300,300);await move(page,b,850,300);const s=await page.getByTestId(`source-handle-${a}`).boundingBox(),t=await page.getByTestId(`target-handle-${b}`).boundingBox();if(!s||!t)throw new Error('Missing ports');await page.mouse.move(s.x+s.width/2,s.y+s.height/2);await page.mouse.down();await page.mouse.move(t.x+t.width/2,t.y+t.height/2,{steps:12});await page.mouse.up();await waitSaved(page);if(process.env.WORKFLOW_EXPECT_NO_MODEL==="1"){await expect(page.getByTestId(`node-run-${b}`)).toBeDisabled();expect((await stored(waitingId)).executions??[]).toEqual([]);return;}await page.getByTestId(`node-run-${b}`).click();await expect(page.getByTestId(`node-status-${b}`)).toHaveAttribute('data-state','waiting');await page.getByTestId('workflow-picker').click();await page.getByTestId(`delete-workflow-${waitingId}`).click();await page.getByTestId('confirm-delete-workflow').click();await expect(page.getByTestId('delete-workflow-dialog').getByRole('alert')).toBeVisible();expect((await stored(waitingId)).archivedAt).toBeUndefined();
});

test('layer actions move one step, send to back and restore the default after reload',async({page})=>{
 const workflowId=await fresh(page,'节点图层顺序');const a=await add(page,'图层 A'),b=await add(page,'图层 B');await page.getByTestId('fit-view').click();await waitViewportSettled(page);
 await contextMenu(page,a);await page.getByTestId('context-bring-front').click();await waitSaved(page);expect((await stored(workflowId)).nodes.find(n=>n.id===a)!.zIndex).toBeGreaterThan((await stored(workflowId)).nodes.find(n=>n.id===b)!.zIndex??0);
 await contextMenu(page,a);await page.getByTestId('context-layer-down').click();await waitSaved(page);expect((await stored(workflowId)).nodes.find(n=>n.id===a)!.zIndex).toBeLessThan((await stored(workflowId)).nodes.find(n=>n.id===b)!.zIndex??0);
 await contextMenu(page,a);await page.getByTestId('context-layer-up').click();await waitSaved(page);await contextMenu(page,a);await page.getByTestId('context-send-back').click();await waitSaved(page);
 await contextMenu(page,a);await page.getByTestId('context-reset-layer').click();await waitSaved(page);expect((await stored(workflowId)).nodes.find(n=>n.id===a)!.zIndex).toBe(0);
 await page.reload();await open(page,false);await selectWorkflow(page,workflowId);await expect(flowNode(page,a)).toHaveCSS('z-index','0');await contextMenu(page,a);await snapshot(page,'layers');
});
