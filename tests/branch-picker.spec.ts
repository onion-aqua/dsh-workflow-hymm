// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BranchPicker } from '../src/client/BranchPicker.tsx';
import { translateZh } from '../src/client/locales.ts';
let root:Root,container:HTMLDivElement;
const options=['main','fork'].map(id=>({id,label:`Native ${id}`,sessionId:`session-${id}`,nodeIds:[]}));
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
async function render(extra:Partial<Parameters<typeof BranchPicker>[0]>={}){await act(async()=>root.render(createElement(BranchPicker,{options,value:'main',onSelect:()=>{},t:translateZh,...extra})));}
describe('Unified branch picker',()=>{
  it('uses a custom keyboard listbox and keeps a hidden programmatic bridge',async()=>{
    const onSelect=vi.fn();await render({onSelect});const trigger=container.querySelector<HTMLButtonElement>('[data-testid=branch-picker-trigger]')!;expect(container.querySelector<HTMLSelectElement>('[data-testid=branch-select]')!.hidden).toBe(true);await act(async()=>trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));const menu=container.querySelector('[role=listbox]')!;await act(async()=>menu.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})));expect(document.activeElement?.getAttribute('data-value')).toBe('fork');await act(async()=>(document.activeElement as HTMLButtonElement).click());expect(onSelect).toHaveBeenCalledExactlyOnceWith('fork');expect(container.querySelector('[role=listbox]')).toBeNull();expect(document.activeElement).toBe(trigger);
  });
  it('keeps the menu open when draft saving blocks a branch switch and closes on outside or disabled state',async()=>{
    const onSelect=vi.fn(()=>false);await render({onSelect});await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid=branch-picker-trigger]')!.click());await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid=branch-option-fork]')!.click());expect(container.querySelector('[role=listbox]')).not.toBeNull();await act(async()=>document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));expect(container.querySelector('[role=listbox]')).toBeNull();await render({disabled:true,onSelect});expect(container.querySelector<HTMLButtonElement>('[data-testid=branch-picker-trigger]')!.disabled).toBe(true);
  });
});
