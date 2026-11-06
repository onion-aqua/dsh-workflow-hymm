import {expect,test,type Locator,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import type {Workflow} from '../../src/shared/model.ts';
import {addTaskNode,blankPoint,focusTask,inlineEdit,taskNode,taskNodes,waitSaved,waitViewportSettled} from './helpers.ts';

test.use({viewport:{width:1700,height:1050},locale:'zh-CN',colorScheme:'dark'});
test.beforeEach(async({page})=>{
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT,'Requires explicitly isolated native Host storage.');
  expect(resolve(process.env.WORKFLOW_STORAGE_ROOT!).toLowerCase()).not.toBe(resolve(homedir(),'.dsh','storages').toLowerCase());
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(关闭|Close)$/}).click();});
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click();});
});

async function fresh(page:Page){
  await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');
  await expect.poll(async()=>await page.getByTestId('workflow-panel').isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);
  if(!await page.getByTestId('workflow-panel').isVisible())await page.getByTestId('workflow-return').click();
  const picker=page.getByTestId('workflow-select'),before=await picker.inputValue();
  await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(before);await waitSaved(page);
  return picker.inputValue();
}
async function stored(id:string):Promise<Workflow>{
  return JSON.parse(await readFile(join(process.env.WORKFLOW_STORAGE_ROOT!,'visual_workflow.json'),'utf8')).tables.workflows[id];
}
async function drag(page:Page,handle:Locator,dx:number,dy:number){
  const box=await handle.boundingBox();if(!box)throw new Error('Expected visible drag header');
  // Stay on the text portion of a trace header, away from its action buttons.
  const x=box.x+Math.min(65,box.width/4),y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:16});await page.mouse.up();
}
async function add(page:Page,title:string,x:number,y:number){
  const count=await taskNodes(page).count();await addTaskNode(page);await expect(taskNodes(page)).toHaveCount(count+1);
  const id=await taskNodes(page).last().getAttribute('data-node-id');if(!id)throw new Error('Missing task identity');
  await inlineEdit(page,id,'title',title);
  const header=taskNode(page,id).locator('.wf-task-top'),box=await header.boundingBox();if(!box)throw new Error('Missing task header');
  // Use its empty leading grip so moving a task never starts title editing.
  await page.mouse.move(box.x+5,box.y+12);await page.mouse.down();await page.mouse.move(x+5,y+12,{steps:16});await page.mouse.up();
  await waitSaved(page);return id;
}
async function showTrace(page:Page,id:string){
  await focusTask(page,id);await page.getByTestId('trace-entry').click();
  const panel=page.getByTestId(`trace-position-${id}`);await expect(panel.getByTestId('trace-empty')).toBeVisible();
  await stablePanel(panel);return panel;
}
async function stablePanel(panel:Locator){
  let previous='',stable=0;
  await expect.poll(async()=>{const r=await panel.boundingBox();if(!r)return 0;const next=JSON.stringify([r.x,r.y,r.width,r.height].map(value=>Math.round(value*10)));stable=next===previous?stable+1:0;previous=next;return stable;},{intervals:[60,60,60,60]}).toBeGreaterThanOrEqual(3);
}
async function snapshot(panel:Locator){
  return panel.evaluate(element=>{
    const canvas=element.closest('.dsh-workflow')!.querySelector('.wf-canvas')!,viewport=canvas.querySelector('.react-flow__viewport')!;
    const bounds=element.getBoundingClientRect(),origin=canvas.getBoundingClientRect(),matrix=new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    return {x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,canvasX:origin.x,canvasY:origin.y,canvasWidth:origin.width,canvasHeight:origin.height,
      viewport:{x:matrix.e,y:matrix.f,zoom:matrix.a},world:{x:(bounds.x-origin.x-matrix.e)/matrix.a,y:(bounds.y-origin.y-matrix.f)/matrix.d,width:bounds.width/matrix.a,height:bounds.height/matrix.d}};
  });
}
function sameWorld(actual:Awaited<ReturnType<typeof snapshot>>,expected:Awaited<ReturnType<typeof snapshot>>){
  for(const key of ['x','y','width','height'] as const)expect(Math.abs(actual.world[key]-expected.world[key]),`Pinned canvas ${key} stays constant`).toBeLessThanOrEqual(2/actual.viewport.zoom);
}
async function pan(page:Page,dx:number,dy:number){
  const point=await page.getByTestId('workflow-canvas').evaluate((canvas,delta)=>{
    const r=canvas.getBoundingClientRect();
    // Keep both pointer endpoints inside the browser even for a large offscreen pan.
    for(let y=r.top+120;y<r.bottom-35;y+=70)for(let x=r.left+90;x<r.right-35;x+=70){
      if(x+delta.dx<8||x+delta.dx>innerWidth-8||y+delta.dy<8||y+delta.dy>innerHeight-8)continue;
      if(document.elementFromPoint(x,y)?.classList.contains('react-flow__pane'))return{x,y};
    }
    return null;
  },{dx,dy});
  if(!point)throw new Error('A canvas pan needs a clear starting point and in-window endpoints');
  await page.mouse.move(point.x,point.y);await page.mouse.down({button:'middle'});
  await page.mouse.move(point.x+dx,point.y+dy,{steps:18});await page.mouse.up({button:'middle'});await waitViewportSettled(page);
}

test('a pinned execution panel belongs to canvas coordinates through pan, zoom, dragging and leaving the visible viewport',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const workflowId=await fresh(page),id=await add(page,'画布坐标固定',330,190),panel=await showTrace(page,id);
  await page.getByRole('button',{name:'Zoom Out',exact:true}).click();await waitViewportSettled(page);await stablePanel(panel);
  const headerFontBeforePin=await panel.locator('.wf-trace-header').evaluate(element=>getComputedStyle(element).fontSize);
  const beforePin=await snapshot(panel);await page.getByTestId(`trace-pin-${id}`).click();await stablePanel(panel);
  await expect(panel).toHaveAttribute('data-coordinate-space','canvas');
  const pinned=await snapshot(panel);
  expect(pinned.viewport.zoom).toBeLessThan(1);
  expect(await panel.locator('.wf-trace-header').evaluate(element=>getComputedStyle(element).fontSize)).toBe(headerFontBeforePin);
  for(const key of ['x','y','width','height'] as const)expect(Math.abs(pinned[key]-beforePin[key]),`Pinning does not jump ${key}`).toBeLessThanOrEqual(1.5);
  await pan(page,120,70);const panned=await snapshot(panel);sameWorld(panned,pinned);
  expect(Math.abs((panned.x-pinned.x)-(panned.viewport.x-pinned.viewport.x))).toBeLessThanOrEqual(2);
  expect(Math.abs((panned.y-pinned.y)-(panned.viewport.y-pinned.viewport.y))).toBeLessThanOrEqual(2);
  await page.getByRole('button',{name:'Zoom Out',exact:true}).click();await page.getByRole('button',{name:'Zoom Out',exact:true}).click();await waitViewportSettled(page);
  const zoomed=await snapshot(panel);expect(zoomed.viewport.zoom).toBeLessThan(.8);sameWorld(zoomed,pinned);
  expect(Math.abs(zoomed.width/pinned.width-zoomed.viewport.zoom/pinned.viewport.zoom)).toBeLessThan(.01);
  await drag(page,panel.locator('.wf-trace-header'),84,49);await stablePanel(panel);
  const moved=await snapshot(panel);
  expect(Math.abs(moved.world.x-zoomed.world.x-84/zoomed.viewport.zoom)).toBeLessThanOrEqual(2/zoomed.viewport.zoom);
  expect(Math.abs(moved.world.y-zoomed.world.y-49/zoomed.viewport.zoom)).toBeLessThanOrEqual(2/zoomed.viewport.zoom);
  const graphBeforePan=(await stored(workflowId)).nodes;
  const offscreenY=-Math.ceil(moved.y-moved.canvasY+160);
  await pan(page,-1100,offscreenY);const outside=await snapshot(panel);sameWorld(outside,moved);
  expect(outside.x).toBeLessThan(outside.canvasX-50);expect(outside.y).toBeLessThan(outside.canvasY-100);
  await expect(panel).toHaveCount(1);await expect(page.getByTestId(`trace-pin-${id}`)).toHaveAttribute('aria-pressed','true');
  // Pan back by the observed viewport delta; the pin must return to its prior canvas point.
  await pan(page,moved.viewport.x-outside.viewport.x,moved.viewport.y-outside.viewport.y);const returned=await snapshot(panel);sameWorld(returned,moved);
  await expect(panel.getByTestId('trace-empty')).toBeVisible();
  expect((await stored(workflowId)).nodes).toEqual(graphBeforePan);expect((await stored(workflowId)).executions??[]).toHaveLength(0);expect(errors).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('pinned-to-canvas-after-pan-zoom.png')});
});

test('two canvas pins stay independent and unpinning keeps the visible position before normal focus dismissal',async({page},testInfo)=>{
  const workflowId=await fresh(page),a=await add(page,'独立固定 A',280,160),b=await add(page,'独立固定 B',1050,160);
  const panelA=await showTrace(page,a);await page.getByTestId(`trace-pin-${a}`).click();await stablePanel(panelA);
  const panelB=await showTrace(page,b);await page.getByTestId(`trace-pin-${b}`).click();await stablePanel(panelB);
  const a0=await snapshot(panelA),b0=await snapshot(panelB);
  await pan(page,-70,65);sameWorld(await snapshot(panelA),a0);sameWorld(await snapshot(panelB),b0);
  const bBeforeDrag=await snapshot(panelB);await drag(page,panelA.locator('.wf-trace-header'),75,45);await stablePanel(panelA);sameWorld(await snapshot(panelB),bBeforeDrag);
  await focusTask(page,a);const beforeUnpin=await snapshot(panelA);await page.getByTestId(`trace-pin-${a}`).click();await stablePanel(panelA);
  const unpinned=await snapshot(panelA);for(const key of ['x','y','width','height'] as const)expect(Math.abs(unpinned[key]-beforeUnpin[key])).toBeLessThanOrEqual(1.5);
  await expect(panelA).toHaveAttribute('data-coordinate-space','screen');
  await expect(page.getByTestId(`trace-pin-${a}`)).toHaveAttribute('aria-pressed','false');
  const point=await blankPoint(page,true);await page.mouse.click(point.x,point.y);await expect(panelA).toHaveCount(0);await expect(panelB).toBeVisible();
  await panelB.getByTestId('trace-close').click();await expect(panelB).toHaveCount(0);expect((await stored(workflowId)).executions??[]).toHaveLength(0);
  await page.screenshot({path:testInfo.outputPath('canvas-pins-unpinned-and-closed.png')});
});
