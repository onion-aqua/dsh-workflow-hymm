import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Workflow } from '../../src/shared/model.ts';
import { addTaskNode, blankPoint, inlineEdit, selectModel, selectWorkflow, taskNode, taskNodes, waitSaved, waitViewportSettled } from './helpers.ts';

test.use({viewport:{width:1700,height:1050},locale:'zh-CN',colorScheme:'dark'});
test.beforeEach(async({page})=>{
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(关闭|Close)$/}).click();});
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click();});
});
async function open(page:Page,navigate=true){if(navigate)await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');await expect.poll(async()=>await page.getByTestId('workflow-panel').isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);if(!await page.getByTestId('workflow-panel').isVisible())await page.getByTestId('workflow-return').click();}
async function fresh(page:Page,name:string){await open(page);const picker=page.getByTestId('workflow-select'),previous=await picker.inputValue();await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(previous);await page.getByTestId('workflow-name-input').fill(name);await page.getByTestId('workflow-name-input').press('Enter');await waitSaved(page);return picker.inputValue();}
async function add(page:Page,title:string,instruction:string){const before=await taskNodes(page).count();await addTaskNode(page);await expect(taskNodes(page)).toHaveCount(before+1);const id=await taskNodes(page).last().getAttribute('data-node-id');if(!id)throw new Error('Missing task identity');await inlineEdit(page,id,'title',title);await inlineEdit(page,id,'instruction',instruction);return id;}
async function stored(id:string):Promise<Workflow>{const root=process.env.WORKFLOW_STORAGE_ROOT??resolve('artifacts/dsh-home/storages');return JSON.parse(await readFile(join(root,'visual_workflow.json'),'utf8')).tables.workflows[id];}
async function move(page:Page,id:string,x:number,y:number){const header=await taskNode(page,id).locator('.wf-task-top').boundingBox();if(!header)throw new Error('Missing task header');await page.mouse.move(header.x+5,header.y+12);await page.mouse.down();await page.mouse.move(x+5,y+12,{steps:12});await page.mouse.up();await waitSaved(page);}
const composer=(page:Page)=>page.locator('.wf-node-composer');
const input=(page:Page)=>page.getByTestId('node-composer-input');
async function clickTask(page:Page,id:string){await taskNode(page,id).getByTestId(`node-instruction-${id}`).click({position:{x:12,y:12}});await expect(composer(page)).toBeVisible();}
async function blank(page:Page){const point=await blankPoint(page,true);await page.mouse.click(point.x,point.y);}
async function snapshot(page:Page,name:string){await mkdir(resolve('../../outputs/screenshots'),{recursive:true});await page.screenshot({path:resolve('../../outputs/screenshots',`node-composer-0.11.1-${name}.png`)});}
async function withinViewport(locator:Locator){await expect(locator).toBeVisible();expect(await locator.evaluate(element=>{const rect=element.getBoundingClientRect();return rect.left>=-1&&rect.right<=window.innerWidth+1&&rect.top>=-1&&rect.bottom<=window.innerHeight+1;})).toBe(true);}
function submissions(page:Page){const requests:string[]=[];page.on('request',request=>{if(/\/api\/visualWorkflow\/(?:run|batchRun)(?:\?|$)/.test(request.url()))requests.push(request.url().split('?')[0]!);});return requests;}

test('single task clicks open an unfocused bottom composer whose edits save to the correct node on switching, close, blank and Escape',async({page})=>{
  test.setTimeout(90000);const requests=submissions(page),workflowId=await fresh(page,'节点底部输入与草稿归属');
  const a=await add(page,'调研任务 A','A 原始要求'),b=await add(page,'验证任务 B','B 原始要求');await move(page,a,300,240);await move(page,b,900,240);await blank(page);
  await clickTask(page,a);await expect(composer(page)).toContainText('调研任务 A');await expect(input(page)).toHaveValue('A 原始要求');await expect(input(page)).not.toBeFocused();await expect(taskNode(page,a)).toHaveClass(/is-selected/);
  await input(page).fill('A 修改后的要求，只属于任务 A。');await clickTask(page,b);await expect(input(page)).toHaveValue('B 原始要求');await expect(composer(page)).toContainText('验证任务 B');await waitSaved(page);
  let workflow=await stored(workflowId);expect(workflow.nodes.find(node=>node.id===a)?.instruction).toBe('A 修改后的要求，只属于任务 A。');expect(workflow.nodes.find(node=>node.id===b)?.instruction).toBe('B 原始要求');
  await input(page).fill('B 通过关闭按钮保存。');await page.getByTestId('node-composer-close').click();await expect(composer(page)).toHaveCount(0);await waitSaved(page);expect((await stored(workflowId)).nodes.find(node=>node.id===b)?.instruction).toBe('B 通过关闭按钮保存。');
  await clickTask(page,b);await input(page).fill('B 点击画布空白保存。');await blank(page);await expect(composer(page)).toHaveCount(0);await waitSaved(page);expect((await stored(workflowId)).nodes.find(node=>node.id===b)?.instruction).toBe('B 点击画布空白保存。');
  await clickTask(page,a);await input(page).fill('A 使用 Escape 保存并收起。');await input(page).press('Escape');await expect(composer(page)).toHaveCount(0);await waitSaved(page);workflow=await stored(workflowId);expect(workflow.nodes.find(node=>node.id===a)?.instruction).toBe('A 使用 Escape 保存并收起。');expect(workflow.nodes.find(node=>node.id===b)?.instruction).toBe('B 点击画布空白保存。');expect(workflow.nodes.map(node=>node.title)).toEqual(['调研任务 A','验证任务 B']);expect(workflow.executions??[]).toEqual([]);expect(requests).toEqual([]);
  await clickTask(page,a);await expect(input(page)).toHaveValue('A 使用 Escape 保存并收起。');await snapshot(page,'draft-owner');await page.getByTestId('node-composer-close').click();await page.reload();await open(page,false);await selectWorkflow(page,workflowId);await clickTask(page,b);await expect(input(page)).toHaveValue('B 点击画布空白保存。');
});

test('composer text shortcuts, Shift+Enter and IME preserve nodes while double click and expand retain the large editor',async({page})=>{
  const requests=submissions(page),workflowId=await fresh(page,'输入快捷键与大编辑器'),id=await add(page,'保留节点身份','原始正文');await move(page,id,350,220);await blank(page);await clickTask(page,id);
  await input(page).fill('第一行');await input(page).press('End');await input(page).press('Shift+Enter');await input(page).pressSequentially('第二行');await expect(input(page)).toHaveValue('第一行\n第二行');expect(requests).toEqual([]);await expect(taskNodes(page)).toHaveCount(1);
  await input(page).dispatchEvent('compositionstart',{data:'拼'});await input(page).dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true});await input(page).dispatchEvent('compositionend',{data:'拼'});expect(requests).toEqual([]);expect((await stored(workflowId)).executions??[]).toEqual([]);
  await input(page).press('Control+A');await input(page).press('Delete');await expect(input(page)).toHaveValue('');await expect(taskNodes(page)).toHaveCount(1);await input(page).fill('待扩展编辑的正文');await page.getByTestId('node-composer-expand').click();await expect(page.getByTestId('node-text-editor')).toBeVisible();await expect(page.getByTestId('editor-text')).toBeEditable();await expect(page.getByTestId('editor-text')).toContainText('待扩展编辑的正文');await page.getByTestId('editor-cancel').click();await waitSaved(page);expect((await stored(workflowId)).nodes[0]!.instruction).toBe('待扩展编辑的正文');
  await blank(page);await taskNode(page,id).getByTestId(`node-instruction-${id}`).dblclick({position:{x:12,y:12}});await expect(page.getByTestId('node-text-editor')).toBeVisible();await expect(page.getByTestId('editor-text')).toContainText('待扩展编辑的正文');await page.getByTestId('editor-cancel').click();await expect(taskNodes(page)).toHaveCount(1);expect(requests).toEqual([]);
});

test('selection, dragging and read-only Session roots keep the composer closed and a repeated task click can reopen it',async({page})=>{
  const workflowId=await fresh(page,'节点输入不干扰框选拖动'),a=await add(page,'任务 A','交互 A'),b=await add(page,'任务 B','交互 B');await move(page,a,300,240);await move(page,b,900,240);await blank(page);
  await taskNode(page,a).getByTestId(`node-instruction-${a}`).click({modifiers:['Shift'],position:{x:12,y:12}});await expect(composer(page)).toHaveCount(0);await taskNode(page,b).getByTestId(`node-instruction-${b}`).click({modifiers:['Shift'],position:{x:12,y:12}});await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);await expect(composer(page)).toHaveCount(0);
  await blank(page);const boxes=await Promise.all([a,b].map(id=>taskNode(page,id).boundingBox()));const left=Math.min(...boxes.map(rect=>rect!.x))-15,top=Math.min(...boxes.map(rect=>rect!.y))-15,right=Math.max(...boxes.map(rect=>rect!.x+rect!.width))+15,bottom=Math.max(...boxes.map(rect=>rect!.y+rect!.height))+15;
  await page.mouse.move(left,top);await page.mouse.down();await page.mouse.move(right,bottom,{steps:15});await page.mouse.up();await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);await expect(composer(page)).toHaveCount(0);
  await blank(page);const before=(await stored(workflowId)).nodes.find(node=>node.id===a)!.position;await move(page,a,380,290);expect((await stored(workflowId)).nodes.find(node=>node.id===a)!.position).not.toEqual(before);await expect(composer(page)).toHaveCount(0);
  await clickTask(page,a);await page.getByTestId('node-composer-close').click();await expect(composer(page)).toHaveCount(0);await clickTask(page,a);await expect(input(page)).toHaveValue('交互 A');await page.getByTestId('node-composer-close').click();
  await selectWorkflow(page,'');await page.getByTestId('fit-view').click();await waitViewportSettled(page);const roots=page.locator('[data-testid^="session-node-"]');await expect.poll(()=>roots.count()).toBeGreaterThan(0);await roots.first().locator('.wf-task-body').click();await expect(composer(page)).toHaveCount(0);
});

test('1024px composer keeps input, file and model controls within the viewport and persists a native upload without running',async({page})=>{
  await page.setViewportSize({width:1024,height:768});const requests=submissions(page),workflowId=await fresh(page,'窄窗口节点输入'),id=await add(page,'窄窗口任务','保留原始输入');await page.getByTestId('fit-view').click();await waitViewportSettled(page);await clickTask(page,id);
  for(const locator of[composer(page),input(page),page.getByTestId('node-composer-model-trigger'),page.getByTestId('node-composer-run'),page.getByTestId('node-composer-close'),page.getByTestId('node-composer-expand')])await withinViewport(locator);
  expect(await composer(page).evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);await input(page).fill('窄窗口也可编辑并上传资料。');
  const files=page.getByTestId(`file-input-composer-${id}`);await files.setInputFiles({name:'composer-requirements.txt',mimeType:'text/plain',buffer:Buffer.from('NODE_COMPOSER_NATIVE_UPLOAD: read-only test attachment.')});await expect.poll(async()=>(await stored(workflowId)).nodes.find(node=>node.id===id)?.attachments?.length).toBe(1);await expect(composer(page).locator('.wf-node-files li')).toHaveCount(1);await withinViewport(page.getByTestId('node-composer-run'));await snapshot(page,'narrow-files');
  await page.getByTestId('node-composer-close').click();await waitSaved(page);expect((await stored(workflowId)).nodes[0]!.instruction).toBe('窄窗口也可编辑并上传资料。');expect((await stored(workflowId)).executions??[]).toEqual([]);expect(requests).toEqual([]);
});

test('Enter saves the latest composer instruction before one native Run using the selected node model',async({page})=>{
  test.skip(process.env.WORKFLOW_EXPECT_NO_MODEL==='1','Requires the explicitly registered local model transport.');test.setTimeout(90000);const workflowId=await fresh(page,'底部输入原生运行'),id=await add(page,'原生运行验收','运行前旧正文');await move(page,id,350,220);await blank(page);await clickTask(page,id);await expect(page.getByTestId('node-composer-model-trigger')).toBeEnabled();
  const selected={provider:'workflow-test',model:'model-b'};await selectModel(page,'node-composer-model',JSON.stringify([selected.provider,selected.model]));const prompt='NODE_COMPOSER_NATIVE_ENTER: Reply briefly without tools. This exact edited instruction must be saved before Run.';await input(page).fill(prompt);const requests=submissions(page);await input(page).press('Enter');
  await expect.poll(async()=>(await stored(workflowId)).executions?.length).toBe(1);await expect.poll(async()=>(await stored(workflowId)).executions?.[0]?.status,{timeout:30000}).toBe('completed');const workflow=await stored(workflowId),node=workflow.nodes.find(item=>item.id===id)!;expect(node.instruction).toBe(prompt);expect(node.model).toEqual(selected);expect(workflow.executions![0]!.nodeId).toBe(id);expect(workflow.executions![0]!.nodeRevision).toBe(node.revision);expect(workflow.executions![0]!.resolvedModel).toEqual(selected);expect(workflow.executions![0]!.summary).toContain('model-b');expect(requests).toHaveLength(1);await expect(taskNodes(page)).toHaveCount(1);await snapshot(page,'native-run');
});
