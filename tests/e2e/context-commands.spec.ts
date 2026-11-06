import {expect,test,type Page} from '@playwright/test';
import {readFile,readdir} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {homedir} from 'node:os';
import type {Workflow} from '../../src/shared/model.ts';
import { addTaskNode, blankPoint,inlineEdit,selectModel,selectWorkflow,taskNode,taskNodes,waitSaved} from './helpers.ts';

test.use({viewport:{width:1700,height:1050},locale:'zh-CN',colorScheme:'dark'});
test.beforeEach(async({page})=>{
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT,'Requires an explicitly isolated local native Host');
  expect(resolve(process.env.WORKFLOW_STORAGE_ROOT!)).not.toBe(resolve(homedir(),'.dsh/storages'));
  test.setTimeout(90000);
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(关闭|Close)$/}).click();});
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click();});
});
async function stored(id:string):Promise<Workflow>{return JSON.parse(await readFile(join(process.env.WORKFLOW_STORAGE_ROOT!,'visual_workflow.json'),'utf8')).tables.workflows[id];}
async function open(page:Page){await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');await expect.poll(async()=>await page.getByTestId('workflow-panel').isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);if(!await page.getByTestId('workflow-panel').isVisible())await page.getByTestId('workflow-return').click();}
async function fresh(page:Page){await open(page);const picker=page.getByTestId('workflow-select'),before=await picker.inputValue();await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(before);await selectModel(page,'global-model-picker',JSON.stringify(['workflow-test','model-a']));await waitSaved(page);return picker.inputValue();}
async function add(page:Page,title:string,instruction:string){const count=await taskNodes(page).count();await addTaskNode(page);await expect(taskNodes(page)).toHaveCount(count+1);const id=(await taskNodes(page).last().getAttribute('data-node-id'))!;await inlineEdit(page,id,'title',title);await inlineEdit(page,id,'instruction',instruction);return id;}
async function composer(page:Page,id:string){await taskNode(page,id).locator('.wf-task-body').click({position:{x:35,y:45}});await expect(page.getByTestId('node-composer-input')).toBeVisible();return page.getByTestId('node-composer-input');}
async function events(sessionId:string){const entries=await readdir(process.env.WORKFLOW_SESSION_ROOT!,{recursive:true,withFileTypes:true});const file=entries.find(entry=>entry.isFile()&&basename(entry.parentPath)===sessionId&&entry.name.endsWith('.jsonl'));if(!file)throw new Error('Native fixture Session was not materialized');return (await readFile(join(file.parentPath,file.name),'utf8')).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}

test('capacity reads native occupancy and /compact creates a native checkpoint without running another task',async({page},testInfo)=>{
  const id=await fresh(page),node=await add(page,'上下文与原生技能','WORKFLOW_CONTEXT_TEST');
  await page.getByTestId(`node-run-${node}`).click();await expect.poll(async()=>(await stored(id)).executions!.at(-1)?.status).toBe('completed');
  await page.getByTestId('context-capacity-trigger').click();await expect(page.getByTestId('context-token-count')).toContainText('128');await expect(page.getByTestId('compact-context')).toBeEnabled();await page.getByTestId('context-capacity-trigger').click();
  const input=await composer(page,node);await input.fill('/skills workflow-browser');await input.press('ArrowDown');await expect(page.getByTestId('slash-option-skill-workflow-browser-skill')).toBeVisible();await page.getByTestId('slash-option-skill-workflow-browser-skill').click();await expect(input).toHaveValue('/workflow-browser-skill ');await input.fill('/workflow-browser-skill WORKFLOW_CONTEXT_TEST');await page.getByTestId('node-composer-run').click();
  await expect.poll(async()=>(await stored(id)).executions!.length).toBe(2);await expect.poll(async()=>(await stored(id)).executions!.at(-1)?.status).toBe('completed');
  const before=await stored(id),latest=before.executions!.at(-1)!,nativeBefore=await events(latest.sessionId);expect(nativeBefore.some(event=>event.type==='user/message'&&event.data.source?.kind==='skill-invocation')).toBe(true);
  const edit=await composer(page,node);await edit.fill('/compact');await expect(page.getByTestId('slash-option-compact')).toBeVisible();await edit.press('Enter');
  await expect.poll(async()=>(await stored(id)).operations!.filter(operation=>operation.kind==='compact'&&operation.status==='completed').length).toBe(1);
  expect((await stored(id)).executions).toHaveLength(2);const nativeAfter=await events(latest.sessionId);expect(nativeAfter.some(event=>event.type==='compaction/end'&&!event.data.error)).toBe(true);expect(nativeAfter.filter(event=>event.type==='user/message'&&event.data.source?.kind==='user').length).toBe(nativeBefore.filter(event=>event.type==='user/message'&&event.data.source?.kind==='user').length);
  await page.getByTestId('context-capacity-trigger').click();await expect(page.getByTestId('context-capacity-popover')).toContainText('上次压缩');await page.screenshot({path:testInfo.outputPath('context-after-native-compact.png')});
  await page.reload();await open(page);await selectWorkflow(page,id);await expect(page.getByTestId('context-capacity-value')).not.toHaveText('—');expect((await stored(id)).executions).toHaveLength(2);
});

test('planning slash skills use real catalog and /compact has no target before a planning Session exists',async({page},testInfo)=>{
  const id=await fresh(page);await page.getByTestId('plan-open').click();const input=page.getByTestId('plan-goal');await expect(input).toBeVisible();
  await input.fill('/skills workflow-browser');await expect(page.getByTestId('slash-option-skill-workflow-browser-skill')).toBeVisible();await page.screenshot({path:testInfo.outputPath('native-skill-menu.png')});await page.getByTestId('slash-option-skill-workflow-browser-skill').click();await expect(input).toHaveValue('/workflow-browser-skill ');
  await input.fill('/compact');await expect(page.getByTestId('slash-option-compact')).toHaveAttribute('aria-disabled','true');await input.press('Enter');expect((await stored(id)).plans).toEqual([]);expect((await stored(id)).executions).toEqual([]);await expect(page.getByTestId('slash-command-feedback')).toBeVisible();
});

test('context ring and menus remain usable at 780px and unknown capacity stays unknown',async({page},testInfo)=>{
  await fresh(page);await page.setViewportSize({width:780,height:1000});const trigger=page.getByTestId('context-capacity-trigger');await expect(trigger).toBeVisible();await expect(page.getByTestId('context-capacity-value')).toHaveText('—');
  expect(await trigger.evaluate(element=>{const r=element.getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.right<=innerWidth&&r.left>=0&&(top===element||!!top&&element.contains(top));})).toBe(true);
  await trigger.click();await expect(page.getByTestId('compact-context')).toBeDisabled();await page.screenshot({path:testInfo.outputPath('context-capacity-780.png')});
});
