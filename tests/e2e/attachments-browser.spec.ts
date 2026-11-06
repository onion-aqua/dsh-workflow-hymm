import { expect,test,type Page } from '@playwright/test';
import { mkdir,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Workflow } from '../../src/shared/model.ts';
import { addTaskNode, blankPoint,focusTask,inlineEdit,selectWorkflow,taskNode,taskNodes,waitSaved } from './helpers.ts';

test.use({viewport:{width:1540,height:980},locale:'zh-CN',colorScheme:'dark'});
test.beforeEach(async({page})=>{
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(关闭|Close)$/}).click();});
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click();});
});
async function open(page:Page,navigate=true){if(navigate)await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');const panel=page.getByTestId('workflow-panel');await expect.poll(async()=>await panel.isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);if(!(await panel.isVisible()))await page.getByTestId('workflow-return').click();await expect(page.getByTestId('add-workflow')).toBeEnabled();}
async function stored(id:string):Promise<Workflow>{const storageRoot=process.env.WORKFLOW_STORAGE_ROOT??resolve('artifacts/dsh-home/storages');return JSON.parse(await readFile(join(storageRoot,'visual_workflow.json'),'utf8')).tables.workflows[id] as Workflow;}
async function screenshot(page:Page,name:string){const directory=resolve('../../outputs/screenshots');await mkdir(directory,{recursive:true});await page.screenshot({path:join(directory,`attachments-0.7.0-${name}.png`)});}

test('real multi-file upload persists native bytes and node references, restores on refresh, and survives remove undo and task copy',async({page})=>{
  await open(page);const picker=page.getByTestId('workflow-select'),previous=await picker.inputValue();await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(previous);const workflowId=await picker.inputValue();await waitSaved(page);
  await addTaskNode(page);const nodeId=await taskNodes(page).last().getAttribute('data-node-id');if(!nodeId)throw new Error('A task identity is required');
  await inlineEdit(page,nodeId,'title','带原生附件的任务');await inlineEdit(page,nodeId,'instruction','附件仅作界面与持久化验证，不运行 Agent。');
  const files=[{name:'需求说明.txt',mimeType:'text/plain',buffer:Buffer.from('实际浏览器上传：需求与验收内容。\nNative attachment one.','utf8')},{name:'evidence.md',mimeType:'text/markdown',buffer:Buffer.from('# Native upload evidence\nSecond file bytes remain exact.','utf8')}];
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});await page.route('**/api/session/uploadFileBinary?*',async route=>{await gate;await route.continue();});
  try{await page.getByTestId(`file-input-${nodeId}`).setInputFiles(files);await expect(page.getByTestId(`file-upload-progress-${nodeId}`)).toBeVisible();await expect(page.getByTestId(`node-run-${nodeId}`)).toBeDisabled();await expect(taskNode(page,nodeId).locator('.wf-node-files li')).toHaveCount(0);await screenshot(page,'uploading');}finally{release();}
  await expect(taskNode(page,nodeId).locator('.wf-node-files li')).toHaveCount(2);await expect(page.getByTestId(`file-upload-progress-${nodeId}`)).toHaveCount(0);await waitSaved(page);await page.unroute('**/api/session/uploadFileBinary?*');
  const uploaded=(await stored(workflowId)).nodes.find(node=>node.id===nodeId)!.attachments!;expect(uploaded).toHaveLength(2);
  const storageRoot=process.env.WORKFLOW_STORAGE_ROOT??resolve('artifacts/dsh-home/storages');const home=resolve(storageRoot,'..');
  for(const [index,item] of uploaded.entries()){const input=files[index]!;const digest=createHash('sha256').update(input.buffer).digest('hex');expect(item.file).toEqual({attachmentId:`sha256:${digest}`,name:input.name,bytes:input.buffer.length});expect(await readFile(join(home,'attachments','v1','files',digest.slice(0,2),digest,item.file.name))).toEqual(input.buffer);}
  const afterUpload=await stored(workflowId);expect(afterUpload.executions).toEqual([]);expect(afterUpload.branches).toEqual([]);expect(afterUpload.uploadSessionId).toBeTruthy();
  await page.reload();await open(page,false);await selectWorkflow(page,workflowId);await expect(taskNode(page,nodeId).locator('.wf-node-files li')).toHaveCount(2);await screenshot(page,'restored');
  await page.getByTestId(`remove-file-${uploaded[0]!.id}`).click();await expect(taskNode(page,nodeId).locator('.wf-node-files li')).toHaveCount(1);await waitSaved(page);await page.keyboard.press('Control+z');await expect(taskNode(page,nodeId).locator('.wf-node-files li')).toHaveCount(2);await waitSaved(page);
  expect((await stored(workflowId)).nodes.find(node=>node.id===nodeId)!.attachments!.map(item=>item.file)).toEqual(uploaded.map(item=>item.file));
  await focusTask(page,nodeId);await page.keyboard.press('Control+c');const blank=await blankPoint(page,true);await page.mouse.click(blank.x,blank.y);await page.keyboard.press('Control+v');await expect(taskNodes(page)).toHaveCount(2);await waitSaved(page);
  const copied=(await stored(workflowId)).nodes.find(node=>node.id!==nodeId)!;expect(copied.attachments!.map(item=>item.file)).toEqual(uploaded.map(item=>item.file));expect(copied.status).toBe('draft');expect(copied.revision).toBe(1);expect(copied.sourceSessionId).toBeUndefined();
  expect((await stored(workflowId)).executions).toEqual([]);await expect(taskNode(page,copied.id).locator('.wf-node-files li')).toHaveCount(2);await screenshot(page,'copied');
});
