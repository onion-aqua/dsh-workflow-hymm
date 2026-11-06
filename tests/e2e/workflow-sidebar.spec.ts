import {expect,test,type Page} from '@playwright/test';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import type {Workflow} from '../../src/shared/model.ts';
import {addTaskNode,inlineEdit,selectModel,taskNodes,waitSaved} from './helpers.ts';

test.use({viewport:{width:1440,height:950},locale:'zh-CN',colorScheme:'dark'});
test.beforeEach(async({page})=>{
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT,'Requires an isolated packaged Host and the local workflow-test model.');
  test.setTimeout(120000);
  expect(resolve(process.env.WORKFLOW_STORAGE_ROOT!).toLowerCase()).not.toBe(resolve(homedir(),'.dsh','storages').toLowerCase());
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>dialog.getByRole('button',{name:/^(关闭|Close)$/}).click());
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>dialog.getByRole('button',{name:/^(继续|Continue)$/}).click());
});
async function stored(id:string):Promise<Workflow>{return JSON.parse(await readFile(join(process.env.WORKFLOW_STORAGE_ROOT!,'visual_workflow.json'),'utf8')).tables.workflows[id];}
async function fresh(page:Page,name:string){
  if(!await page.getByTestId('workflow-panel').isVisible())await page.getByTestId('workflow-return').click();
  const picker=page.getByTestId('workflow-select'),previous=await picker.inputValue();
  await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(previous);
  await page.getByTestId('workflow-name-input').fill(name);await page.getByTestId('workflow-name-input').press('Enter');await waitSaved(page);
  await selectModel(page,'global-model-picker',JSON.stringify(['workflow-test','model-a']));await waitSaved(page);
  await addTaskNode(page);const id=(await taskNodes(page).last().getAttribute('data-node-id'))!;
  await inlineEdit(page,id,'title','目录测试任务');await inlineEdit(page,id,'instruction','CONTROLS_QUICK: reply briefly without tools.');
  await page.getByTestId(`node-run-${id}`).click();const workflowId=await picker.inputValue();
  await expect.poll(async()=>(await stored(workflowId)).executions?.at(-1)?.status).toBe('completed');return {workflowId,nodeId:id};
}
async function historyHashes(){
  const home=process.env.WORKFLOW_TEST_DSH_HOME??dirname(process.env.WORKFLOW_STORAGE_ROOT!);
  const root=join(home,'sessions'),result:Record<string,string>={};
  for(const path of await readdir(root,{recursive:true}))if(path.endsWith('.jsonl'))result[path]=createHash('sha256').update(await readFile(join(root,path))).digest('hex');
  return result;
}
test('native directory groups main, branch and planning by Workflow ID, follows renames and restores the original browser',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');
  await expect.poll(async()=>await page.getByTestId('workflow-panel').isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);
  const a=await fresh(page,'同名目录测试');
  await page.getByTestId(`node-run-${a.nodeId}`).click();
  await expect.poll(async()=>{const runs=(await stored(a.workflowId)).executions??[];return runs.length===2&&runs.every(run=>run.status==='completed');}).toBe(true);
  await page.getByTestId('plan-open').click();await page.getByTestId('plan-goal').fill('Design one small review task for this directory test.');await page.getByTestId('generate-plan').click();
  await expect.poll(async()=>(await stored(a.workflowId)).plans?.at(-1)?.status).toBe('proposed');
  await page.getByTestId('plan-panel').getByRole('button',{name:'关闭',exact:true}).click();
  const b=await fresh(page,'同名目录测试');await page.getByTestId('original-style').click();
  const directory=page.getByTestId('workflow-session-directory'),groupA=page.getByTestId(`sidebar-group-workflow:${a.workflowId}`),groupB=page.getByTestId(`sidebar-group-workflow:${b.workflowId}`);
  await expect(directory).toBeVisible();await expect(groupA).toBeVisible();await expect(groupB).toBeVisible();
  const before=await stored(a.workflowId),owned=new Set([...(before.executions??[]).map(run=>run.sessionId),...(before.plans??[]).map(plan=>plan.sessionId)]);
  // Repeated runs may intentionally reuse the same native Session; grouping
  // is by distinct Session identity, so two executions plus one plan can be
  // represented by two rows.
  expect(owned.size).toBe(2);for(const id of owned)await expect(groupA.getByTestId(`sidebar-session-${id}`)).toHaveCount(1);
  expect(await groupA.textContent()).toContain('规划');
  const hashes=await historyHashes();
  await groupA.locator('.wf-directory-group-toggle').click();await expect(groupA.locator('.wf-directory-rows')).toHaveCount(0);
  await page.reload();await expect(directory).toBeVisible();await expect(groupA.locator('.wf-directory-rows')).toHaveCount(0);
  await page.getByTestId('sidebar-workflow-search').fill('同名目录测试');await expect(groupA.locator('.wf-directory-rows')).toBeVisible();await expect(groupB).toBeVisible();
  await page.getByTestId('sidebar-workflow-search').fill('');await groupA.locator('.wf-directory-group-toggle').click();
  await page.getByTestId(`sidebar-canvas-${a.workflowId}`).click();await expect(page.getByTestId('workflow-select')).toHaveValue(a.workflowId);
  await page.getByTestId('workflow-name-input').fill('按工作流归类');await page.getByTestId('workflow-name-input').press('Enter');await waitSaved(page);
  await page.getByTestId('original-style').click();await expect(groupA.locator('.wf-directory-group-toggle')).toContainText('按工作流归类');await expect(groupB.locator('.wf-directory-group-toggle')).toContainText('同名目录测试');
  expect(await historyHashes()).toEqual(hashes);
  await page.screenshot({path:info.outputPath('workflow-session-directory.png')});
  const first=[...owned][0]!;await groupA.getByTestId(`sidebar-session-${first}`).locator('.wf-directory-session-open').click();
  await expect(groupA.getByTestId(`sidebar-session-${first}`).locator('.wf-directory-session-open')).toHaveAttribute('aria-current','page');
  await page.getByTestId('sidebar-native-directory').click();await expect(directory).toHaveCount(0);
  await expect(page.getByRole('tree',{name:'会话'})).toBeVisible();
  await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByTestId('workflow-sidebar-enable').click();await expect(directory).toBeVisible();await expect(groupA).toBeVisible();
  await page.setViewportSize({width:780,height:720});await expect(directory).toBeVisible();
  const bounds=(await directory.boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(780);
  await page.screenshot({path:info.outputPath('workflow-session-directory-compact.png')});
  expect(errors).toEqual([]);
});
