import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { addTaskNode, contextMenu, inlineEdit, taskNode, taskNodes, waitSaved, waitViewportSettled } from './helpers.ts';

test.use({viewport:{width:1700,height:1050},locale:'zh-CN',colorScheme:'dark'});
test.beforeEach(async({page})=>{
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(关闭|Close)$/}).click();});
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click();});
});
async function fresh(page:Page,name:string){
  await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');
  await expect.poll(async()=>await page.getByTestId('workflow-panel').isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if(!await page.getByTestId('workflow-panel').isVisible())await page.getByTestId('workflow-return').click();
  const picker=page.getByTestId('workflow-select'),previous=await picker.inputValue();
  await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(previous);
  await page.getByTestId('workflow-name-input').fill(name);await page.getByTestId('workflow-name-input').press('Enter');await waitSaved(page);
}
async function add(page:Page,title:string,instruction:string){
  const before=await taskNodes(page).count();await addTaskNode(page);await expect(taskNodes(page)).toHaveCount(before+1);
  const id=await taskNodes(page).last().getAttribute('data-node-id');if(!id)throw new Error('Missing new task identity');
  await inlineEdit(page,id,'title',title);await inlineEdit(page,id,'instruction',instruction);return id;
}
async function snapshot(page:Page,name:string){await mkdir(resolve('../../outputs/screenshots'),{recursive:true});await page.screenshot({path:resolve('../../outputs/screenshots',`unified-0.11.0-${name}.png`)});}
async function onScreen(locator:Locator){
  await expect(locator).toBeVisible();
  expect(await locator.evaluate(element=>{const r=element.getBoundingClientRect();return r.left>=-1&&r.right<=window.innerWidth+1&&r.top>=-1&&r.bottom<=window.innerHeight+1;})).toBe(true);
}
async function unobstructed(locator:Locator){
  await onScreen(locator);
  expect(await locator.evaluate(element=>{const r=element.getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return top===element||Boolean(top&&element.contains(top));})).toBe(true);
}
async function rounded(locator:Locator,minimum:number){expect(await locator.evaluate(element=>parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThanOrEqual(minimum);}
async function pill(locator:Locator){expect(await locator.evaluate(element=>{const r=element.getBoundingClientRect(),style=getComputedStyle(element);return parseFloat(style.borderTopLeftRadius)>=Math.min(r.width,r.height)/2-1&&(!CSS.supports('corner-shape','round')||['round','superellipse(1)'].includes(style.getPropertyValue('corner-shape')));})).toBe(true);}

// This is a real Host tour: readable task content, menus, editor and controls
// remain usable while the unified visual treatment is applied. No Agent runs.
test('unified dark surfaces keep editing and floating menus usable and produce reviewable screenshots',async({page})=>{
  test.setTimeout(90000);const mutations:string[]=[];
  page.on('request',request=>{if(/\/api\/visualWorkflow\/(?:run|batchRun|generatePlan)(?:\?|$)/.test(request.url()))mutations.push(request.url().split('?')[0]!);});
  await fresh(page,'设计验收 · 统一深色画布');
  const first=await add(page,'整理项目需求','## 项目需求\n\n**目标**：让任务结构与执行过程清晰可读。\n\n- 汇总输入资料\n- 确认验收标准');
  const second=await add(page,'检查并交付','检查节点样式、菜单和编辑器，保留原生执行与会话历史。');
  await page.getByTestId('fit-view').click();await waitViewportSettled(page);
  await expect(taskNode(page,first).locator('.wf-node-question strong')).toHaveText('目标');
  await expect(taskNode(page,second).getByTestId(`node-title-${second}`)).toHaveText('检查并交付');
  const tones=await page.getByTestId('workflow-canvas').evaluate((canvas,id)=>{
    const channels=(value:string)=>value.match(/[\d.]+/g)!.slice(0,3).map(Number);
    const bg=channels(getComputedStyle(canvas).backgroundColor),card=channels(getComputedStyle(document.querySelector(`[data-testid="task-node-${id}"] .wf-task-body`)!).backgroundColor);
    return {background:Math.max(...bg),card:Math.max(...card),neutral:Math.max(...card)-Math.min(...card)};
  },first);
  // Broad contrast/neutrality gates, without binding the design to exact RGB values.
  expect(tones.background).toBeLessThan(40);expect(tones.card).toBeGreaterThan(tones.background);expect(tones.card).toBeLessThan(85);expect(tones.neutral).toBeLessThanOrEqual(16);
  await rounded(taskNode(page,first).locator('.wf-task-body'),16);await pill(page.locator('.wf-view-toggle'));
  await pill(page.locator('.wf-tool-dock'));await pill(page.getByTestId('node-create-toggle'));
  await snapshot(page,'canvas');
  await page.getByTestId('workflow-picker').click();await expect(page.getByTestId('workflow-picker-options')).toBeVisible();await onScreen(page.getByTestId('workflow-picker-options'));await snapshot(page,'workflow-menu');await page.keyboard.press('Escape');
  await expect(page.getByTestId(`node-model-${first}-trigger`)).toBeEnabled();await page.getByTestId(`node-model-${first}-trigger`).click();const models=page.getByTestId(`node-model-${first}-options`);await onScreen(models);await expect(models.getByRole('option',{selected:true})).toHaveCount(1);await snapshot(page,'model-menu');await page.keyboard.press('Escape');
  await page.getByTestId('plan-open').click();const plan=page.getByTestId('plan-panel');await onScreen(plan);await plan.getByTestId('plan-goal').fill('先梳理需求，再检查交付标准。');await expect(plan.getByTestId('generate-plan')).toBeEnabled();await snapshot(page,'planning');await plan.getByRole('button',{name:'关闭',exact:true}).click();
  await taskNode(page,first).getByTestId(`node-instruction-${first}`).dblclick();await expect(page.getByTestId('editor-text')).toBeEditable();await expect(page.getByTestId('editor-text').locator('h2')).toHaveText('项目需求');await onScreen(page.getByRole('dialog',{name:'编辑文本',exact:true}));await snapshot(page,'editor');await page.getByTestId('editor-cancel').click();
  await contextMenu(page,first);await onScreen(page.getByTestId('workflow-context-menu'));await expect(page.getByTestId('context-rename')).toBeEnabled();await snapshot(page,'context');await page.keyboard.press('Escape');
  await page.locator('.wf-view-toggle').getByRole('button',{name:'列表',exact:true}).click();await expect(page.locator('.wf-list-rows>button')).toHaveCount(2);await snapshot(page,'list');await page.locator('.wf-list-view').getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'工作流设置',exact:true}).click();await onScreen(page.locator('.wf-settings-sheet'));await snapshot(page,'settings');await page.locator('.wf-settings-sheet').getByRole('button',{name:'关闭',exact:true}).click();
  await expect(taskNodes(page)).toHaveCount(2);await waitSaved(page);expect(mutations).toEqual([]);
});

test('1024px canvas keeps top actions and menus in view without horizontal overflow',async({page})=>{
  test.setTimeout(60000);await page.setViewportSize({width:1024,height:768});await fresh(page,'窄窗口也能使用的工作流');
  await add(page,'窄窗口任务','检查工作流菜单、模型选择、视图切换和规划面板。');await page.getByTestId('fit-view').click();await waitViewportSettled(page);
  const panel=page.getByTestId('workflow-panel'),top=page.locator('.wf-studio-top');
  expect(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
  expect(await top.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
  for(const id of ['workflow-picker','add-workflow','global-model-picker-trigger','run-selected','original-style'])await unobstructed(page.getByTestId(id));
  await page.getByTestId('workflow-picker').click();await onScreen(page.getByTestId('workflow-picker-options'));await page.keyboard.press('Escape');
  await page.getByTestId('global-model-picker-trigger').click();await onScreen(page.getByTestId('global-model-picker-options'));await page.keyboard.press('Escape');
  await page.locator('.wf-view-toggle').getByRole('button',{name:'列表',exact:true}).click();await expect(page.locator('.wf-list-view')).toBeVisible();await page.locator('.wf-list-view').getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByTestId('plan-open').click();await onScreen(page.getByTestId('plan-panel'));await onScreen(page.getByTestId('plan-model-picker-trigger'));await onScreen(page.getByTestId('generate-plan'));await snapshot(page,'narrow-planning');await page.getByTestId('plan-panel').getByRole('button',{name:'关闭',exact:true}).click();await snapshot(page,'narrow-canvas');
});
