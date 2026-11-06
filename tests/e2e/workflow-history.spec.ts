import {expect,test,type Page} from '@playwright/test';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
import type {Execution,Workflow} from '../../src/shared/model.ts';
import {addTaskNode,inlineEdit,selectModel,selectWorkflow,taskNodes,waitSaved,waitViewportSettled} from './helpers.ts';

test.use({viewport:{width:1700,height:1050},locale:'zh-CN',colorScheme:'dark'});
test.beforeEach(async({page})=>{
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT||process.env.WORKFLOW_EXPECT_NO_MODEL==='1','Requires isolated native Host storage and the local workflow-test model fixture.');
  test.setTimeout(120000);isolation();
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(关闭|Close)$/}).click();});
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click();});
});

function isolation(){
  const storage=resolve(process.env.WORKFLOW_STORAGE_ROOT!),home=resolve(process.env.WORKFLOW_TEST_DSH_HOME??dirname(storage));
  expect(storage.toLowerCase()).not.toBe(resolve(homedir(),'.dsh','storages').toLowerCase());
  expect(home.toLowerCase()).not.toBe(resolve(homedir(),'.dsh').toLowerCase());
  expect(resolve(home,'storages').toLowerCase()).toBe(storage.toLowerCase());
  return{storage,home};
}
async function stored(id:string):Promise<Workflow>{return JSON.parse(await readFile(join(isolation().storage,'visual_workflow.json'),'utf8')).tables.workflows[id];}
async function open(page:Page,navigate=true){
  if(navigate)await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');
  await expect.poll(async()=>await page.getByTestId('workflow-panel').isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if(!await page.getByTestId('workflow-panel').isVisible())await page.getByTestId('workflow-return').click();
}
async function fresh(page:Page,name:string){
  await open(page);const picker=page.getByTestId('workflow-select'),before=await picker.inputValue();
  await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(before);
  await page.getByTestId('workflow-name-input').fill(name);await page.getByTestId('workflow-name-input').press('Enter');await waitSaved(page);
  return picker.inputValue();
}
async function addTask(page:Page,title:string){
  const before=await taskNodes(page).count();await addTaskNode(page);await expect(taskNodes(page)).toHaveCount(before+1);
  const id=await taskNodes(page).last().getAttribute('data-node-id');if(!id)throw new Error('Missing task identity');
  await inlineEdit(page,id,'title',title);await inlineEdit(page,id,'instruction','WORKFLOW_HISTORY_ARCHIVE_FIXTURE: reply briefly without tools or file changes.');return id;
}
async function runTask(page:Page,workflowId:string,nodeId:string):Promise<Execution>{
  await selectModel(page,'global-model-picker',JSON.stringify(['workflow-test','model-a']));
  await page.getByTestId(`node-run-${nodeId}`).click();
  await expect.poll(async()=>{const run=(await stored(workflowId)).executions?.findLast(item=>item.nodeId===nodeId);return run?.status==='completed'&&run.durability==='durable';},{timeout:30000}).toBe(true);
  return (await stored(workflowId)).executions!.findLast(item=>item.nodeId===nodeId)!;
}
async function archiveWorkflow(page:Page,workflowId:string){
  await page.getByTestId('workflow-picker').click();await page.getByTestId(`delete-workflow-${workflowId}`).click();
  const confirmation=page.getByTestId('delete-workflow-dialog'),choice=page.getByTestId('workflow-history-choice');
  await expect(confirmation).toBeVisible();await page.getByTestId('confirm-delete-workflow').click();
  await expect.poll(async()=>await choice.isVisible()||await confirmation.getByRole('alert').isVisible()).toBe(true);
  if(await confirmation.getByRole('alert').isVisible()){
    // A final native metadata update can race the first confirmation. Review the
    // exact CAS conflict and accepted current snapshot before one fresh click.
    await expect(confirmation.getByRole('alert')).toContainText('工作流已在其他窗口更新');
    expect((await stored(workflowId)).archivedAt).toBeUndefined();
    await page.getByTestId('confirm-delete-workflow').click();
  }
  await expect(page.getByTestId('delete-workflow-dialog')).toHaveCount(0);await expect.poll(async()=>(await stored(workflowId)).archivedAt??0).toBeGreaterThan(0);
  await expect(choice).toBeVisible();await expect(choice.getByTestId('keep-workflow-history')).toBeFocused();
  await expect(choice.getByTestId('history-archive-count')).toBeVisible();return choice;
}
async function nativeFiles(sessionId:string){
  const root=join(isolation().home,'sessions'),found:string[]=[];
  async function walk(directory:string,inside=false):Promise<void>{
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(entry.isSymbolicLink())continue;const file=join(directory,entry.name);
      if(entry.isDirectory())await walk(file,inside||entry.name===sessionId);
      else if(inside&&/\.jsonl(?:\.zstd)?$/.test(entry.name))found.push(file);
    }
  }
  await walk(root);expect(found.length,'The native Session must have durable log bytes').toBeGreaterThan(0);
  return Object.fromEntries(await Promise.all(found.sort().map(async file=>[relative(root,file),createHash('sha256').update(await readFile(file)).digest('hex')])));
}

test('deleting a workflow asks separately and the default keep choice preserves native catalog history and Session bytes',async({page})=>{
  const workflowId=await fresh(page,'保留原生历史测试'),nodeId=await addTask(page,'历史保留任务'),run=await runTask(page,workflowId,nodeId);
  const original=await stored(workflowId),bytes=await nativeFiles(run.sessionId);
  const choice=await archiveWorkflow(page,workflowId);await expect(choice.getByTestId('history-archive-count')).toContainText('1');
  await choice.getByTestId('keep-workflow-history').click();await expect(choice).toHaveCount(0);
  await selectWorkflow(page,'');await expect(page.getByTestId(`session-node-${run.sessionId}`)).toBeAttached();
  expect(await nativeFiles(run.sessionId)).toEqual(bytes);expect((await stored(workflowId)).executions).toEqual(original.executions);
  await page.reload();await open(page,false);await selectWorkflow(page,'');
  await expect(page.getByTestId(`session-node-${run.sessionId}`)).toBeAttached();
  await page.getByTestId('workflow-picker').click();await expect(page.getByTestId(`workflow-option-${workflowId}`)).toHaveCount(0);await page.keyboard.press('Escape');
});

test('confirming native history archive hides only the owned fork while protecting its source and retaining both Session logs',async({page})=>{
  const sourceWorkflow=await fresh(page,'原始来源保护测试'),sourceTask=await addTask(page,'原始对话来源'),source=await runTask(page,sourceWorkflow,sourceTask);
  await selectWorkflow(page,'');const sourceCard=page.getByTestId(`session-node-${source.sessionId}`);await expect(sourceCard).toBeAttached();
  await page.getByTestId('fit-view').click();await waitViewportSettled(page);await sourceCard.locator('.wf-task-top').click({button:'right'});
  await expect(page.getByTestId('context-import-session')).toBeEnabled();await page.getByTestId('context-import-session').click();
  await expect(page.getByTestId('workflow-select')).not.toHaveValue('');const workflowId=await page.getByTestId('workflow-select').inputValue();
  expect(workflowId).not.toBe(sourceWorkflow);await waitSaved(page);const imported=await stored(workflowId);expect(imported.sourceSessionId).toBe(source.sessionId);
  const childTask=await addTask(page,'独立分支历史'),root=imported.nodes.find(node=>node.kind==='session')!;
  const start=await page.getByTestId(`source-handle-${root.id}`).boundingBox(),end=await page.getByTestId(`target-handle-${childTask}`).boundingBox();
  if(!start||!end)throw new Error('Imported source and task require visible native ports');
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(end.x+end.width/2,end.y+end.height/2,{steps:15});await page.mouse.up();await waitSaved(page);
  const child=await runTask(page,workflowId,childTask);expect(child.sessionId).not.toBe(source.sessionId);
  const original=await stored(workflowId),sourceBytes=await nativeFiles(source.sessionId),childBytes=await nativeFiles(child.sessionId);
  const choice=await archiveWorkflow(page,workflowId);await expect(choice.getByTestId('history-archive-count')).toContainText('1');
  await expect(choice).toContainText('保留');await expect(choice.getByTestId('confirm-archive-history')).toBeEnabled();await choice.getByTestId('confirm-archive-history').click();await expect(choice).toHaveCount(0);
  await selectWorkflow(page,'');await expect(page.getByTestId(`session-node-${child.sessionId}`)).toHaveCount(0);await expect(page.getByTestId(`session-node-${source.sessionId}`)).toBeAttached();
  expect(await nativeFiles(source.sessionId)).toEqual(sourceBytes);expect(await nativeFiles(child.sessionId)).toEqual(childBytes);
  const archived=await stored(workflowId);expect(archived.executions).toEqual(original.executions);expect(archived.sourceSessionId).toBe(source.sessionId);expect(archived.branches).toEqual(original.branches);
  await page.reload();await open(page,false);await selectWorkflow(page,'');
  await expect(page.getByTestId(`session-node-${child.sessionId}`)).toHaveCount(0);await expect(page.getByTestId(`session-node-${source.sessionId}`)).toBeAttached();
});
