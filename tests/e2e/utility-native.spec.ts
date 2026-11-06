import {expect,test,type Locator,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createServer,type Server} from 'node:http';
import {homedir} from 'node:os';
import {join,relative,resolve,sep} from 'node:path';
import type {Workflow} from '../../src/shared/model.ts';
import { addTaskNode, addUtilityNode, inlineEdit,selectModel,selectWorkflow,taskNodes,waitSaved} from './helpers.ts';

test.use({viewport:{width:1700,height:1050},locale:'zh-CN',colorScheme:'dark'});
const fileName='utility-native-fixture.txt',fileMarker='UTILITY_NATIVE_FILE_MARKER';
let web:Server|undefined,webUrl='';
function isolation(){
  const storage=process.env.WORKFLOW_STORAGE_ROOT,cwd=process.env.WORKFLOW_UTILITY_CWD;
  if(!storage||!cwd)throw new Error('Utility native tests require WORKFLOW_STORAGE_ROOT and WORKFLOW_UTILITY_CWD.');
  expect(resolve(storage).toLowerCase()).not.toBe(resolve(homedir(),'.dsh','storages').toLowerCase());
  const underArtifacts=relative(resolve('artifacts'),resolve(cwd));expect(underArtifacts!==''&&!underArtifacts.startsWith(`..${sep}`)&&underArtifacts!=='..'&&!resolve(cwd).startsWith('\\\\')).toBe(true);
  return{storage,cwd};
}
async function stored(id:string):Promise<Workflow>{return JSON.parse(await readFile(join(isolation().storage,'visual_workflow.json'),'utf8')).tables.workflows[id];}
async function canvas(page:Page,navigate=true){if(navigate)await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');await expect.poll(async()=>await page.getByTestId('workflow-panel').isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);if(!await page.getByTestId('workflow-panel').isVisible())await page.getByTestId('workflow-return').click();await expect(page.getByTestId('workflow-panel')).toBeVisible();}

test.beforeEach(async({page})=>{
  test.skip(!process.env.WORKFLOW_STORAGE_ROOT||!process.env.WORKFLOW_UTILITY_CWD||process.env.WORKFLOW_EXPECT_NO_MODEL==='1','Requires an explicitly isolated packaged Host, workspace fixture and local model adapter.');test.setTimeout(120000);
  isolation();await expect(readFile(join(isolation().cwd,fileName),'utf8')).resolves.toContain(fileMarker);
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(关闭|Close)$/}).click();});
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click();});
});
test.afterEach(async({page})=>{const close=page.getByTestId('utility-close-terminal');if(await close.count()){const utility=close.first().locator('xpath=ancestor::article[contains(@class,"wf-utility")]');if(await utility.getAttribute('data-focused')==='false')await utility.locator('.wf-utility-activation').click({timeout:5000}).catch(()=>{});await close.first().click({timeout:5000}).catch(()=>{});}if(web){await new Promise<void>((resolve,reject)=>web!.close(error=>error?reject(error):resolve()));web=undefined;}});

/** A mounted xterm is not proof that its native Shell can accept the first command. */
async function readyPowerShellInput(node:Locator):Promise<Locator>{
  const input=node.locator('.xterm-helper-textarea');await expect(input).toBeAttached();
  // xterm reflects disableStdin as textarea.readOnly; require the writable state.
  await expect(input).toBeEditable({timeout:20000});
  await expect(node.getByTestId('utility-terminal-screen')).toContainText(/PS\s+[^>]*>\s*$/,{timeout:20000});
  await input.focus();await expect(input).toBeFocused();return input;
}

async function createWithSession(page:Page){
  await canvas(page);const picker=page.getByTestId('workflow-select'),before=await picker.inputValue();await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(before);const workflowId=await picker.inputValue();
  await page.getByRole('button',{name:'工作流设置',exact:true}).click();await expect(page.getByTestId('workspace-picker')).toBeAttached();await expect.poll(()=>page.getByTestId('workspace-picker').locator('option').allTextContents()).toContainEqual(expect.stringContaining('Workflow工具测试'));const workspaceId=await page.getByTestId('workspace-picker').locator('option').filter({hasText:'Workflow工具测试'}).getAttribute('value');expect(workspaceId).toBeTruthy();await selectModel(page,'workspace-picker',workspaceId!);await waitSaved(page);await page.getByRole('button',{name:'工作流设置',exact:true}).click();
  await selectModel(page,'global-model-picker',JSON.stringify(['workflow-test','model-a']));await addTaskNode(page);const taskId=(await taskNodes(page).last().getAttribute('data-node-id'))!;
  await inlineEdit(page,taskId,'title','隔离原生资源测试');await inlineEdit(page,taskId,'instruction','WORKFLOW_UTILITY_BOOTSTRAP: reply briefly without tools or file changes.');await page.getByTestId(`node-run-${taskId}`).click();
  await expect.poll(async()=>(await stored(workflowId)).executions?.at(-1)?.status,{timeout:30000}).toBe('completed');const run=(await stored(workflowId)).executions!.at(-1)!;
  await addUtilityNode(page);await waitSaved(page);const utility=(await stored(workflowId)).utilityNodes!.at(-1)!;const node=page.getByTestId(`utility-node-${utility.id}`);await expect(node).toBeVisible();
  const selector=node.getByTestId(`utility-session-${utility.id}`);await selector.selectOption(run.sessionId);await waitSaved(page);
  return{workflowId,utilityId:utility.id,sessionId:run.sessionId,node};
}

test('utility uses real workspace files and a Session-owned PTY that survives refresh without starting another shell',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const{workflowId,utilityId,sessionId,node}=await createWithSession(page);
  expect(await node.locator('.react-flow__handle').count()).toBe(0);await expect(node.getByTestId('utility-workspace-files')).toBeVisible();
  await expect(node.locator('.wf-utility-file-list button').filter({hasText:fileName})).toBeVisible();await node.locator('.wf-utility-file-list button').filter({hasText:fileName}).click();await expect(node.locator('pre')).toHaveText(fileMarker);
  expect((await stored(workflowId)).nodes).toHaveLength(1);expect((await stored(workflowId)).executions).toHaveLength(1);expect(JSON.stringify(await stored(workflowId))).not.toContain(fileMarker);
  await node.getByTestId(`utility-tab-terminal-${utilityId}`).click();await expect(node.getByTestId('utility-start-terminal')).toBeVisible();expect((await stored(workflowId)).utilityNodes?.find(item=>item.id===utilityId)?.terminal).toBeUndefined();
  await node.getByRole('button',{name:'加载 Shell',exact:true}).click();const shell=node.getByRole('combobox',{name:'Shell'});await expect(shell).toBeVisible();const choices=await shell.locator('option').evaluateAll(options=>options.map(option=>({path:(option as HTMLOptionElement).value,title:option.textContent??''})));const powerShell=choices.find(item=>/pwsh|powershell/i.test(item.path+' '+item.title));expect(powerShell,'The isolated Host must expose a real PowerShell for this PTY regression.').toBeDefined();await shell.selectOption(powerShell!.path);
  await node.getByTestId('utility-start-terminal').click();await expect(node.getByTestId('utility-close-terminal')).toBeVisible();await expect.poll(async()=>(await stored(workflowId)).utilityNodes?.find(item=>item.id===utilityId)?.terminal?.id).toBeTruthy();const binding=(await stored(workflowId)).utilityNodes!.find(item=>item.id===utilityId)!.terminal!;expect(binding.sessionId).toBe(sessionId);
  const proof=String(Date.now()),marker=`UTILITY_PTY_${proof}`;const input=await readyPowerShellInput(node);await input.pressSequentially(`$global:workflowUtilityProof='${proof}'; [Console]::WriteLine(('UTILITY_PTY_' + $global:workflowUtilityProof))`,{delay:10});await input.press('Enter');await expect(node.getByTestId('utility-terminal-screen')).toContainText(marker,{timeout:20000});await waitSaved(page);
  await page.reload();await canvas(page,false);await selectWorkflow(page,workflowId);const restored=page.getByTestId(`utility-node-${utilityId}`);await expect(restored.getByTestId('utility-close-terminal')).toBeVisible();expect((await stored(workflowId)).utilityNodes!.find(item=>item.id===utilityId)!.terminal).toEqual(binding);await expect(restored.getByTestId(`utility-session-${utilityId}`)).toBeDisabled();
  await restored.locator('.wf-utility-activation').click();await expect(restored).toHaveAttribute('data-focused','true');const restoredInput=await readyPowerShellInput(restored);await restoredInput.pressSequentially(`[Console]::WriteLine(('RESTORED_' + $global:workflowUtilityProof))`,{delay:10});await restoredInput.press('Enter');await expect(restored.getByTestId('utility-terminal-screen')).toContainText(`RESTORED_${proof}`,{timeout:20000});
  await restored.getByTestId('utility-close-terminal').click();await expect(restored.getByTestId('utility-start-terminal')).toBeVisible();await waitSaved(page);expect((await stored(workflowId)).utilityNodes!.find(item=>item.id===utilityId)!.terminal).toBeUndefined();expect((await stored(workflowId)).executions).toHaveLength(1);expect(errors).toEqual([]);
});

test('utility browser embeds a local page and native registry entries open working tools',async({page})=>{
  web=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end('<!doctype html><title>Utility local browser fixture</title><main>UTILITY_LOCAL_BROWSER_MARKER</main>');});await new Promise<void>(resolve=>web!.listen(0,'127.0.0.1',resolve));const address=web.address();if(!address||typeof address==='string')throw new Error('Missing local fixture port');webUrl=`http://127.0.0.1:${address.port}/`;
  const{workflowId,utilityId,node}=await createWithSession(page);await node.getByTestId(`utility-tab-tools-${utilityId}`).click();await expect(node.locator('.wf-utility-tool-entry')).not.toHaveCount(0);const filesEntry=node.locator('.wf-utility-tool-entry').filter({hasText:'工作区文件'}).first();await expect(filesEntry).toBeVisible();await filesEntry.getByRole('button').click();await expect(node.getByTestId('utility-workspace-files')).toBeVisible();await node.getByTestId(`utility-tab-browser-${utilityId}`).click();await expect(node.locator('.wf-utility-browser')).toBeVisible();
  await node.getByRole('textbox',{name:'网页地址',exact:true}).fill(webUrl);await node.getByRole('button',{name:'前往',exact:true}).click();await expect(node.frameLocator('iframe').getByText('UTILITY_LOCAL_BROWSER_MARKER',{exact:true})).toBeVisible();await expect(node.locator('iframe')).toHaveAttribute('sandbox','allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  const nativeFallback=node.getByRole('button',{name:'在原生界面打开',exact:true});if(await nativeFallback.count()){await nativeFallback.click();await expect(page.getByTestId('workflow-panel')).toHaveCount(0);await expect(page.getByTestId('workflow-return')).toBeVisible();await expect(page.frameLocator(`iframe[src="${webUrl}"]`).getByText('UTILITY_LOCAL_BROWSER_MARKER',{exact:true})).toBeVisible({timeout:20000});await page.getByTestId('workflow-return').click();}else{await expect(node.locator('.wf-utility-browser-note')).toContainText('部分站点禁止内嵌');}
  await expect(page.getByTestId(`utility-node-${utilityId}`)).toBeVisible();expect((await stored(workflowId)).executions).toHaveLength(1);
});
