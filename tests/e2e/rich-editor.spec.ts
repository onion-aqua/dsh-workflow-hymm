import { expect,test,type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import type { Workflow } from '../../src/shared/model.ts';
import { addTaskNode, inlineEdit,selectWorkflow,taskNode,waitSaved } from './helpers.ts';

test.use({viewport:{width:1550,height:1000},locale:'zh-CN',colorScheme:'dark'});
test.beforeEach(async({page})=>{
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(开始使用|Get started|Get Started)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(关闭|Close)$/}).click();});
  await page.addLocatorHandler(page.getByRole('dialog',{name:/^(预览版说明|Preview.*)$/}),async dialog=>{await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click();});
});
async function open(page:Page,navigate=true){if(navigate)await page.goto(process.env.WORKFLOW_ENTRY_URL??'/');await expect.poll(async()=>await page.getByTestId('workflow-panel').isVisible()||await page.getByTestId('workflow-return').isVisible()).toBe(true);if(!await page.getByTestId('workflow-panel').isVisible())await page.getByTestId('workflow-return').click();}
async function fresh(page:Page){await open(page);const picker=page.getByTestId('workflow-select'),old=await picker.inputValue();await page.getByTestId('add-workflow').click();await expect(picker).not.toHaveValue(old);await addTaskNode(page);const id=await page.locator('[data-testid^="task-node-"]').last().getAttribute('data-node-id');if(!id)throw new Error('Missing task');await waitSaved(page);return {workflowId:await picker.inputValue(),id};}
async function stored(id:string):Promise<Workflow>{const root=process.env.WORKFLOW_STORAGE_ROOT??resolve('artifacts/dsh-home/storages');return JSON.parse(await readFile(join(root,'visual_workflow.json'),'utf8')).tables.workflows[id];}
async function edit(page:Page,id:string){await taskNode(page,id).getByTestId(`node-instruction-${id}`).dblclick();const editor=page.getByTestId('editor-text');await expect(editor).toBeEditable();await expect(editor).toBeFocused();return editor;}

test('visual toolbar applies visible fonts to selected text and Markdown survives save and refresh',async({page})=>{
  const {workflowId,id}=await fresh(page);const editor=await edit(page,id);await editor.fill('准备调研提纲');await editor.press('Control+A');
  await page.getByTestId('editor-bold').click();await expect(editor.locator('strong')).toHaveText('准备调研提纲');await expect(page.getByTestId('editor-bold')).toHaveAttribute('aria-pressed','true');
  await page.getByTestId('editor-italic').click();await expect(editor.locator('em')).toHaveText('准备调研提纲');
  const styles=await editor.locator('strong em,em strong').evaluate(element=>({weight:getComputedStyle(element.closest('strong')!).fontWeight,italic:getComputedStyle(element.closest('em')!).fontStyle}));expect(Number(styles.weight)).toBeGreaterThanOrEqual(600);expect(styles.italic).toBe('italic');
  await page.getByTestId('editor-heading').click();await expect(editor.locator('h2')).toHaveText('准备调研提纲');await page.getByTestId('editor-undo').click();await expect(editor.locator('h2')).toHaveCount(0);await page.getByTestId('editor-redo').click();await expect(editor.locator('h2')).toHaveCount(1);
  await editor.press('Control+Enter');await expect(page.getByTestId('node-text-editor')).toHaveCount(0);await waitSaved(page);const saved=(await stored(workflowId)).nodes.find(node=>node.id===id)!.instruction;expect(saved).toMatch(/^## /);expect(saved).toContain('准备调研提纲');expect(saved).not.toContain('<');
  await page.reload();await open(page,false);await selectWorkflow(page,workflowId);await expect(taskNode(page,id).locator('.wf-node-question h2 strong')).toHaveText('准备调研提纲');
  await edit(page,id);await expect(editor.locator('h2 em')).toHaveText('准备调研提纲');await page.getByTestId('editor-mode-source').click();await expect(page.getByTestId('editor-source')).toHaveValue(saved);await page.getByTestId('editor-mode-visual').click();await page.getByTestId('editor-save').click();await waitSaved(page);expect((await stored(workflowId)).nodes.find(node=>node.id===id)!.instruction).toBe(saved);
});

test('code, lists, safe links and text cut/undo work inside the editor without cutting canvas nodes',async({page})=>{
  const {workflowId,id}=await fresh(page);const editor=await edit(page,id);await editor.fill('文档参考');await editor.press('Control+A');
  await page.getByTestId('editor-code').click();await expect(editor.locator('code')).toHaveText('文档参考');await page.getByTestId('editor-code').click();await page.getByTestId('editor-bullet').click();await expect(editor.locator('ul li')).toHaveText('文档参考');await page.getByTestId('editor-bullet').click();
  await editor.press('Control+A');await editor.press('Control+k');await expect(page.getByTestId('editor-link-url')).toBeFocused();await page.getByTestId('editor-link-url').fill('javascript:alert(1)');await page.getByTestId('editor-link-apply').click();await expect(page.getByTestId('editor-error')).toContainText('仅支持');await expect(editor.locator('a')).toHaveCount(0);
  await page.getByTestId('editor-link-url').fill('https://example.com/docs');await page.getByTestId('editor-link-apply').click();await expect(editor.locator('a')).toHaveText('文档参考');await expect(editor.locator('a')).toHaveAttribute('href','https://example.com/docs');
  await editor.press('Control+A');await editor.press('Control+x');await expect(editor).toHaveText('');await expect(page.locator('[data-testid^="task-node-"]')).toHaveCount(1);await editor.press('Control+z');await expect(editor.locator('a')).toHaveText('文档参考');
  await editor.press('Control+Enter');await waitSaved(page);expect((await stored(workflowId)).nodes.find(node=>node.id===id)!.instruction).toBe('[文档参考](https://example.com/docs)');
});

test('existing source tables, literal HTML and image references round trip safely, and cancel retains saved text',async({page})=>{
  const {workflowId,id}=await fresh(page);const markdown='## 表格\n\n| A | B |\n| --- | --- |\n| **one** | two |\n\n![preview](https://example.com/not-loaded.png)\n\n<script>alert(1)</script>';
  await inlineEdit(page,id,'instruction',markdown);let requests=0;page.on('request',request=>{if(request.url().includes('not-loaded.png'))requests++;});const editor=await edit(page,id);await expect(editor.locator('table')).toHaveCount(1);await expect(editor.locator('strong')).toHaveText('one');await expect(editor.locator('img[src],script,iframe')).toHaveCount(0);await expect(editor).toContainText('<script>alert(1)</script>');
  await page.getByTestId('editor-save').click();await waitSaved(page);expect((await stored(workflowId)).nodes.find(node=>node.id===id)!.instruction).toBe(markdown);expect(requests).toBe(0);
  await edit(page,id);await editor.fill('不保存的草稿');await page.getByTestId('editor-cancel').click();await waitSaved(page);expect((await stored(workflowId)).nodes.find(node=>node.id===id)!.instruction).toBe(markdown);
});
