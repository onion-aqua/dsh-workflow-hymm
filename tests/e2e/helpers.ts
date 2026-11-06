import { expect, type Locator, type Page } from '@playwright/test';

export function taskNodes(page: Page): Locator { return page.locator('[data-testid^="task-node-"]'); }
export function taskNode(page: Page, id: string): Locator { return page.getByTestId(`task-node-${id}`); }
export function flowNode(page: Page, id: string): Locator { return page.locator(`.react-flow__node[data-id="${id}"]`); }
/** Open the shared creation menu, then use its visible task/utility choice. */
export async function addTaskNode(page: Page): Promise<void> {
  await openNodeCreation(page);
  await page.getByTestId('add-node').click();
}
export async function addUtilityNode(page: Page): Promise<void> {
  await openNodeCreation(page);
  await page.getByTestId('add-utility-node').click();
}
async function openNodeCreation(page: Page): Promise<void> {
  if (!await page.getByTestId('node-create-menu').isVisible()) await page.getByTestId('node-create-toggle').click();
  await expect(page.getByTestId('node-create-menu')).toBeVisible();
}
export async function selectWorkflow(page: Page, id: string): Promise<void> {
  await page.getByTestId('workflow-picker').click();
  await expect(page.getByTestId('workflow-picker-options')).toBeVisible();
  await page.getByTestId(`workflow-option-${id || 'catalog'}`).click();
  await expect(page.getByTestId('workflow-select')).toHaveValue(id);
}
/** Follow the visible branch listbox; the native select is only a hidden compatibility bridge. */
export async function selectBranch(page: Page, id: string): Promise<void> {
  await page.getByTestId('branch-picker-trigger').click();
  const menu = page.getByTestId('branch-picker-options');
  await expect(menu).toBeVisible();
  await menu.getByTestId(`branch-option-${id}`).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('branch-select')).toHaveValue(id);
  await waitSaved(page);
}
export async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved', { timeout: 20000 });
}
export async function waitViewportSettled(page: Page): Promise<void> {
  let previous: string | undefined, stable = 0;
  await expect.poll(async () => {
    const current = await page.locator('.react-flow__viewport').evaluate(element => (element as HTMLElement).style.transform);
    stable = current === previous ? stable + 1 : 0;
    previous = current;
    return stable;
  }, { intervals: [70, 70, 70, 70] }).toBeGreaterThanOrEqual(3);
  await waitSaved(page);
}
export async function inlineEdit(page: Page, id: string, field: 'title' | 'instruction', text: string, commit: 'blur' | 'Control+Enter' | 'Escape' = 'Control+Enter') {
  const task = taskNode(page, id);
  if(field==='instruction'){
    await task.getByTestId(`node-instruction-${id}`).dblclick();
    const visual=page.getByTestId('editor-text');await expect(visual).toBeVisible();await expect(visual).toBeEditable();
    // This helper edits persisted Markdown spelling. Dedicated visual-editor
    // browser tests exercise selecting text and toolbar commands on the canvas.
    await page.getByTestId('editor-mode-source').click();
    const editor=page.getByTestId('editor-source');await expect(editor).toBeVisible();await expect(editor).toBeEditable();
    await editor.fill(text);
    if(commit==='blur')await page.getByTestId('editor-save').click();else await editor.press(commit);
    await expect(page.getByTestId('node-text-editor')).toHaveCount(0);await waitSaved(page);return;
  }
  const editor = page.getByTestId(`inline-${field}-${id}`);
  if (!(await editor.isVisible())) await task.getByTestId(`node-${field}-${id}`).click();
  await expect(editor).toBeVisible();
  await editor.fill(text);
  if (commit === 'blur') await page.getByTestId('workflow-name-input').click();
  else await editor.press(commit);
  await expect(editor).toHaveCount(0);
  await waitSaved(page);
}
export async function focusTask(page: Page, id: string): Promise<void> {
  // Right-click a stable non-text header point so focus never starts renaming.
  await contextMenu(page,id);
  await page.keyboard.press('Escape');
  await expect(taskNode(page, id)).toHaveClass(/is-focused/);
}
export async function inspectorFor(page: Page, id: string): Promise<void> {
  await focusTask(page, id);
  if (!(await page.getByTestId('inspector').isVisible())) await page.getByTestId('inspector-toggle').click();
  await expect(page.getByTestId('inspector')).toBeVisible();
}
export async function blankPoint(page: Page, bottomRight = false): Promise<{ x: number; y: number }> {
  const point = await page.getByTestId('workflow-canvas').evaluate((canvas, reverse) => {
    const rect = canvas.getBoundingClientRect();
    const candidates = [[18, 18], [rect.width - 22, 110], [22, rect.height / 2], [rect.width - 25, rect.height / 2], [rect.width / 2, rect.height - 24], [rect.width - 16, rect.height - 16]];
    for (const [dx, dy] of reverse ? candidates.reverse() : candidates) {
      const x = rect.left + dx!, y = rect.top + dy!;
      if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
    }
    return null;
  }, bottomRight);
  if (!point) throw new Error('Test needs a genuinely blank canvas point');
  return point;
}
export async function contextMenu(page: Page, id: string): Promise<Locator> {
  await taskNode(page, id).locator('.wf-task-top').click({ button: 'right', position: { x: 5, y: 12 } });
  const menu = page.getByTestId('workflow-context-menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** Choose through the same visible menu used by people, never the hidden compatibility select. */
export async function selectModel(page:Page,testId:string,value:string|undefined):Promise<void>{
  await page.getByTestId(`${testId}-trigger`).click();
  const menu=page.getByTestId(`${testId}-options`);await expect(menu).toBeVisible();
  const choices=menu.getByRole('option');let match:Locator|undefined;
  for(const choice of await choices.all())if(await choice.getAttribute('data-value')===(value??'')){match=choice;break;}
  if(!match)throw new Error(`Model menu ${testId} has no requested choice`);
  await match.click();await expect(menu).toHaveCount(0);await expect(page.getByTestId(testId)).toHaveValue(value??'');
}
