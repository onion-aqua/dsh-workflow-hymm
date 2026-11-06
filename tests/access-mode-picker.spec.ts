// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessModePicker } from '../src/client/AccessModePicker.tsx';
import { accessModeLabel } from '../src/client/AccessModePicker.tsx';
import { translateZh } from '../src/client/locales.ts';
import type { WorkflowAccessOption } from '../src/shared/model.ts';
let root:Root,container:HTMLDivElement;
const options:WorkflowAccessOption[]=[{id:'read-only',label:'Native read only',sandbox:'read-only',approval:'ask'},{id:'workspace-write',label:'Native workspace',sandbox:'workspace-write',approval:'ask'},{id:'danger-full-access',label:'Native full access',sandbox:'danger-full-access',approval:'never'}];
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
async function render(extra:Partial<Parameters<typeof AccessModePicker>[0]>={}){await act(async()=>root.render(createElement(AccessModePicker,{options,defaultPreset:'workspace-write',onChange:()=>{},...extra})));}
async function select(id:string){await act(async()=>{const select=container.querySelector<HTMLSelectElement>('select')!;select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));});}
async function open(){await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid=access-mode-picker-trigger]')!.click());return document.querySelector<HTMLElement>('[data-testid=access-mode-picker-options]')!;}
async function key(element:Element,key:string){await act(async()=>element.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key})));}
describe('Native access mode picker',()=>{
  it('uses actual native labels and supports following the native default without inventing Auto',async()=>{const onChange=vi.fn();await render({onChange});expect(container.querySelector('[data-testid=access-mode-picker-trigger]')?.textContent).toContain('Native workspace');expect(container.querySelector('option[value=auto]')).toBeNull();await select('read-only');expect(onChange).toHaveBeenLastCalledWith('read-only');await render({value:'read-only',onChange});await select('');expect(onChange).toHaveBeenLastCalledWith(undefined);});
  it('requires the native full access acknowledgment and never applies it when cancelled',async()=>{const onChange=vi.fn();await render({onChange});await select('danger-full-access');expect(onChange).not.toHaveBeenCalled();const apply=document.querySelector<HTMLButtonElement>('[data-testid=access-mode-confirm-apply]')!;expect(apply.disabled).toBe(true);await act(async()=>document.querySelector<HTMLInputElement>('[data-testid=access-mode-acknowledge]')!.click());await act(async()=>apply.click());expect(onChange).toHaveBeenCalledExactlyOnceWith('danger-full-access');expect(document.querySelector('[data-testid=access-mode-confirm]')).toBeNull();await select('danger-full-access');await act(async()=>document.querySelector('[data-testid=access-mode-confirm]')!.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Escape'})));expect(onChange).toHaveBeenCalledOnce();});
  it('retains unavailable selections as disabled rows and blocks an unavailable catalogue',async()=>{await render({value:'auto'});expect(container.querySelector<HTMLOptionElement>('option[value=auto]')?.disabled).toBe(true);await render({options:[]});expect(container.querySelector<HTMLButtonElement>('[data-testid=access-mode-picker-trigger]')!.disabled).toBe(true);});
  it('allows reloading the native catalogue when selection is unavailable and contains async failures',async()=>{const onReload=vi.fn();await render({options:[],error:'Native catalogue disconnected',onReload});const reload=container.querySelector<HTMLButtonElement>('[data-testid=access-mode-picker-reload]')!;expect(reload.disabled).toBe(false);await act(async()=>reload.click());expect(onReload).toHaveBeenCalledOnce();const onChange=vi.fn(async()=>{throw new Error('Preset admission failed');});await render({onChange});await select('read-only');expect(container.querySelector<HTMLButtonElement>('[data-testid=access-mode-picker-trigger]')!.title).toBe('Preset admission failed');});
  it('uses native product wording and distinct shields for registered presets, with an experimental Auto badge',async()=>{
    const native=options.map(option=>({...option,label:option.id}));
    native.push({id:'auto',label:'auto',sandbox:'danger-full-access',approval:'ask'});
    await render({options:native,value:'workspace-write'});const menu=await open();
    const rows=[...menu.querySelectorAll<HTMLButtonElement>('[role=option]')];
    expect(rows.map(row=>row.dataset.value)).toEqual(['','read-only','workspace-write','danger-full-access','auto']);
    expect(rows.slice(1).map(row=>row.textContent)).toEqual(['仅可查看','工作区内修改','完全权限','自动审查EXP']);
    for(const preset of ['read-only','workspace-write','danger-full-access','auto'])expect(menu.querySelector(`[data-value="${preset}"] [data-access-icon="${preset}"]`)).not.toBeNull();
    expect(container.querySelector('[data-testid=access-mode-picker-trigger]')?.textContent).toBe('工作区内修改');
    expect(rows.find(row=>row.dataset.value==='workspace-write')?.getAttribute('aria-selected')).toBe('true');
    expect(rows.find(row=>row.dataset.value==='auto')?.querySelector('sup')?.textContent).toBe('EXP');
  });
  it('keeps customized host preset names and resolves the following-native trigger without raw machine keys',async()=>{
    const native=options.map(option=>({...option,label:option.id}));await render({options:native});
    const trigger=container.querySelector<HTMLButtonElement>('[data-testid=access-mode-picker-trigger]')!;
    expect(trigger.textContent).toBe('工作区内修改');expect(trigger.title).toBe('跟随原生设置 · 工作区内修改');
    expect(accessModeLabel({...native[0]!,label:'Company document viewer'},translateZh)).toBe('Company document viewer');
    expect(accessModeLabel({...native[0]!,id:'custom-read',label:'Custom read'},translateZh)).toBe('Custom read');
    expect(accessModeLabel({...native[0]!,label:'Read Only'},translateZh)).toBe('仅可查看');
  });
  it('navigates the native permission menu with keyboard, restores focus and closes on viewport changes',async()=>{
    const onChange=vi.fn();await render({onChange});const trigger=container.querySelector<HTMLButtonElement>('[data-testid=access-mode-picker-trigger]')!;
    await key(trigger,'ArrowDown');const menu=document.querySelector<HTMLElement>('[data-testid=access-mode-picker-options]')!;
    expect((document.activeElement as HTMLElement).dataset.value).toBe('read-only');
    await key(menu,'End');expect((document.activeElement as HTMLElement).dataset.value).toBe('danger-full-access');
    await key(menu,'Home');expect((document.activeElement as HTMLElement).dataset.value).toBe('');
    await key(menu,'Escape');expect(document.querySelector('[data-testid=access-mode-picker-options]')).toBeNull();expect(document.activeElement).toBe(trigger);
    const opened=await open();await act(async()=>opened.querySelector<HTMLButtonElement>('[data-value="read-only"]')!.click());expect(onChange).toHaveBeenCalledExactlyOnceWith('read-only');
    await open();await act(async()=>window.dispatchEvent(new Event('visual-workflow:viewport-move')));expect(document.querySelector('[data-testid=access-mode-picker-options]')).toBeNull();
  });
});
