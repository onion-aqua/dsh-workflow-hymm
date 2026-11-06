import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { addTaskNode, flowNode, inlineEdit, selectWorkflow, taskNode, taskNodes, waitSaved, waitViewportSettled } from './helpers.ts';

test.use({viewport:{width:1700,height:1050},locale:'zh-CN',colorScheme:'dark'});
test.beforeEach(async({page})=>{
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(关闭|Close)$/}).click();});
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click();});
});
async function open(page:Page,navigate=true){
  if(navigate)await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');
  await expect(page.getByTestId('workflow-panel')).toBeVisible();
}
async function fresh(page:Page,name:string){
  await open(page);const picker=page.getByTestId('workflow-select'),before=await picker.inputValue();
  await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(before);
  await page.getByTestId('workflow-name-input').fill(name);await page.getByTestId('workflow-name-input').press('Enter');await waitSaved(page);return picker.inputValue();
}
async function add(page:Page,title:string,instruction='仅用于界面验收，不执行 Agent。'){
  const count=await taskNodes(page).count();await addTaskNode(page);await expect(taskNodes(page)).toHaveCount(count+1);
  const id=await taskNodes(page).last().getAttribute('data-node-id');if(!id)throw new Error('Missing node identity');
  await inlineEdit(page,id,'title',title);await inlineEdit(page,id,'instruction',instruction);return id;
}
async function move(page:Page,id:string,x:number,y:number){
  const header=await taskNode(page,id).locator('.wf-task-top').boundingBox();if(!header)throw new Error('Missing header');
  await page.mouse.move(header.x+5,header.y+12);await page.mouse.down();await page.mouse.move(x+5,y+12,{steps:12});await page.mouse.up();await waitSaved(page);
}
async function connect(page:Page,source:string,target:string,fromTarget=false){
  const start=await page.getByTestId(fromTarget?`target-handle-${target}`:`source-handle-${source}`).boundingBox(),end=await page.getByTestId(fromTarget?`source-handle-${source}`:`target-handle-${target}`).boundingBox();if(!start||!end)throw new Error('Missing connection handles');
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(end.x+end.width/2,end.y+end.height/2,{steps:18});
  const preview=page.getByTestId('workflow-connection-path');await expect(preview).toBeAttached();
  // A stroked horizontal SVG path is drawable even though its geometry has zero height.
  await expect.poll(()=>preview.evaluate(element=>{const path=element as SVGPathElement,style=getComputedStyle(path);return path.getTotalLength()>0&&style.display!=='none'&&style.visibility==='visible'&&style.stroke!=='none'&&Number.parseFloat(style.strokeWidth)>0&&Number.parseFloat(style.opacity)>0&&Number.parseFloat(style.strokeOpacity)>0;})).toBe(true);
  const previewPath=await preview.getAttribute('d');
  await page.mouse.up();await expect(page.locator('.react-flow__edge')).toHaveCount(1);await expect(page.locator('.react-flow__edge-path')).toHaveAttribute('d',previewPath!);await waitSaved(page);
}
async function aligned(page:Page,source:string,target:string){
  await expect.poll(async()=>{
    const offset=async(id:string)=>taskNode(page,id).evaluate(node=>{const body=node.querySelector('.wf-task-body')!.getBoundingClientRect();const handles=[...node.querySelectorAll('.react-flow__handle')].map(item=>item.getBoundingClientRect());return Math.max(...handles.map(handle=>Math.abs(handle.y+handle.height/2-(body.y+body.height/2))));});
    return Math.max(await offset(source),await offset(target));
  }).toBeLessThan(1.1);
  await expect.poll(async()=>{
    const geometry=await page.locator('.react-flow__edge-path').evaluate(pathElement=>{const path=pathElement as SVGPathElement;const map=(distance:number)=>{const point=path.getPointAtLength(distance);const screen=new DOMPoint(point.x,point.y).matrixTransform(path.getScreenCTM()!);return{x:screen.x,y:screen.y};};return{start:map(0),end:map(path.getTotalLength())};});
    const start=await page.getByTestId(`source-handle-${source}`).boundingBox(),end=await page.getByTestId(`target-handle-${target}`).boundingBox();if(!start||!end)return Infinity;
    return Math.max(Math.abs(geometry.start.x-(start.x+start.width)),Math.abs(geometry.start.y-(start.y+start.height/2)),Math.abs(geometry.end.x-end.x),Math.abs(geometry.end.y-(end.y+end.height/2)));
  }).toBeLessThan(1.5);
}

test('long node text scrolls without zooming the canvas, while blank canvas still zooms',async({page})=>{
  await fresh(page,'节点正文滚动检查');const id=await add(page,'长文本任务',Array.from({length:45},(_,i)=>`第${i+1}行：阅读任务细节时保持画布位置。`).join('\n'));
  await page.getByTestId('fit-view').click();await waitViewportSettled(page);
  const content=taskNode(page,id).locator('.wf-task-content'),bounds=await content.boundingBox();if(!bounds)throw new Error('Missing scroll area');
  const viewport=page.locator('.react-flow__viewport'),before=await viewport.getAttribute('style');
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.wheel(0,300);
  await expect.poll(()=>content.evaluate(element=>element.scrollTop)).toBeGreaterThan(100);await expect(viewport).toHaveAttribute('style',before!);
  await page.mouse.move(1450,800);await page.mouse.wheel(0,180);await expect.poll(()=>viewport.getAttribute('style')).not.toBe(before);await waitViewportSettled(page);
});

test('curve endpoints stay centered on the visible body through resize, drag, zoom and reload',async({page})=>{
  const workflowId=await fresh(page,'端口与曲线几何检查');const source=await add(page,'源任务'),target=await add(page,'后续任务');
  await move(page,source,350,350);await move(page,target,1000,550);await connect(page,source,target);await aligned(page,source,target);
  const grip=await page.getByTestId(`node-resize-${source}`).boundingBox();if(!grip)throw new Error('Missing resize control');
  await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(grip.x+grip.width/2+110,grip.y+grip.height/2+85,{steps:16});await page.mouse.up();await waitSaved(page);await aligned(page,source,target);
  await move(page,target,1050,620);await aligned(page,source,target);
  await page.mouse.move(1450,850);await page.mouse.wheel(0,140);await waitViewportSettled(page);await aligned(page,source,target);
  await page.reload();await open(page,false);await selectWorkflow(page,workflowId);await aligned(page,source,target);
  await expect(flowNode(page,source)).toBeVisible();
});

test('reverse connections stay direct behind endpoint and intervening cards while remaining selectable and persistent',async({page})=>{
  test.setTimeout(90000);
  const workflowId=await fresh(page,'直达反向连线与节点遮挡');const source=await add(page,'右侧源任务'),target=await add(page,'左侧后续任务');
  await move(page,source,1020,500);await move(page,target,350,500);await connect(page,source,target,true);await aligned(page,source,target);
  const path=page.locator('.react-flow__edge-path');
  const verticalExcursion=()=>path.evaluate(element=>{
    const path=element as SVGPathElement,matrix=path.getScreenCTM()!;const screen=(distance:number)=>{const point=path.getPointAtLength(distance);return new DOMPoint(point.x,point.y).matrixTransform(matrix);};
    const start=screen(0),end=screen(path.getTotalLength());let excursion=0;
    for(let i=0;i<=400;i++){const point=screen(path.getTotalLength()*i/400);excursion=Math.max(excursion,Math.min(start.y,end.y)-point.y,point.y-Math.max(start.y,end.y));}
    return excursion;
  });
  // Same-height ports should connect through the canvas rather than make a large trip above the headers.
  await expect.poll(verticalExcursion).toBeLessThan(8);
  const initialPath=await path.getAttribute('d');
  const blocker=await add(page,'连线前方的卡片');await move(page,blocker,690,500);
  await expect(path).toHaveAttribute('d',initialPath!);await aligned(page,source,target);
  const covered=()=>path.evaluate((element,id)=>{
    const path=element as SVGPathElement,matrix=path.getScreenCTM()!,body=document.querySelector(`[data-testid="task-node-${id}"] .wf-task-body`)!.getBoundingClientRect();let inside=0,occluded=0;
    for(let i=1;i<400;i++){const point=path.getPointAtLength(path.getTotalLength()*i/400),screen=new DOMPoint(point.x,point.y).matrixTransform(matrix);
      if(screen.x>body.left+12&&screen.x<body.right-12&&screen.y>body.top+12&&screen.y<body.bottom-12){inside++;if(document.elementFromPoint(screen.x,screen.y)?.closest(`[data-testid="task-node-${id}"]`))occluded++;}}
    return {inside,occluded};
  },blocker);
  await expect.poll(async()=>(await covered()).inside).toBeGreaterThan(15);
  await expect.poll(async()=>{const sample=await covered();return sample.inside-sample.occluded;}).toBe(0);
  const exposedPoint=await path.evaluate(element=>{
    const path=element as SVGPathElement,matrix=path.getScreenCTM()!,length=path.getTotalLength();
    for(let i=20;i<380;i++){const point=path.getPointAtLength(length*i/400),screen=new DOMPoint(point.x,point.y).matrixTransform(matrix);if(document.elementFromPoint(screen.x,screen.y)?.closest('.react-flow__edge'))return {x:screen.x,y:screen.y};}
    return null;
  });
  expect(exposedPoint).not.toBeNull();await page.mouse.click(exposedPoint!.x,exposedPoint!.y);await expect(page.getByTestId('remove-edge')).toBeVisible();await expect(page.locator('.react-flow__edge.selected')).toHaveCount(1);
  // Selection must not lift the connection in front of the card that hides it.
  await expect.poll(async()=>{const sample=await covered();return sample.inside-sample.occluded;}).toBe(0);
  await page.reload();await open(page,false);await selectWorkflow(page,workflowId);await expect(page.locator('.react-flow__edge')).toHaveCount(1);await expect(path).toHaveAttribute('d',initialPath!);await expect.poll(verticalExcursion).toBeLessThan(8);await aligned(page,source,target);
  await expect.poll(async()=>{const sample=await covered();return sample.inside-sample.occluded;}).toBe(0);
  await mkdir(resolve('../../outputs/screenshots'),{recursive:true});await page.screenshot({path:resolve('../../outputs/screenshots/direct-edge-routing-0.10.1.png')});
});
