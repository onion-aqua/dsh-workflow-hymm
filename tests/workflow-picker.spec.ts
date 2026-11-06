// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkflowPicker } from '../src/client/WorkflowPicker.tsx';
import { translateZh } from '../src/client/locales.ts';
let root:Root,container:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
it('offers workflow deletion with a specific reviewable confirmation and retains the catalog entry',async()=>{
  const onDelete=vi.fn(async()=>true),onSelect=vi.fn();
  await act(async()=>root.render(createElement(WorkflowPicker,{options:[{id:'one',name:'项目计划'}],value:'one',onSelect,onDelete,t:translateZh})));
  await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="workflow-picker"]')!.click());
  expect(container.querySelector('[data-testid="delete-workflow-"]')).toBeNull();
  await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="delete-workflow-one"]')!.click());
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('项目计划');expect(onDelete).not.toHaveBeenCalled();
  await act(async()=>document.querySelector<HTMLButtonElement>('[data-testid="confirm-delete-workflow"]')!.click());
  expect(onDelete).toHaveBeenCalledWith('one');expect(document.querySelector('[role="alertdialog"]')).toBeNull();expect(onSelect).not.toHaveBeenCalled();
});
it('allows cancelling deletion and preserves a failed confirmation for retry',async()=>{
  const onDelete=vi.fn(async()=>false);await act(async()=>root.render(createElement(WorkflowPicker,{options:[{id:'one',name:'项目计划'}],value:'one',onSelect:()=>{},onDelete,deleteError:'仍有等待任务',t:translateZh})));
  const ask=async()=>{await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="workflow-picker"]')!.click());await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="delete-workflow-one"]')!.click());};
  await ask();await act(async()=>document.querySelector('[role="alertdialog"]')!.parentElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(onDelete).not.toHaveBeenCalled();await ask();await act(async()=>document.querySelector<HTMLButtonElement>('[data-testid="confirm-delete-workflow"]')!.click());
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();expect(document.querySelector('[role="alert"]')?.textContent).toBe('仍有等待任务');
});
