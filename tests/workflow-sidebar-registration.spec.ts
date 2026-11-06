// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Context } from '@deepseek-ai/cordis';
import { describe, expect, it, vi } from 'vitest';
import { SlotCore, type StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { installWorkflowSidebar } from '../src/client/workflow-sidebar-registration.ts';

/** Real released registry with the service's declaration-lifetime adapter. */
function fixture() {
  const core = new SlotCore(), effects = new Set<() => void>();
  core.register({name:'root',children:{
    'sidebar.workspaces':{kind:'single',scope:'root'},
    'sidebar.panellist.actions':{kind:'list',scope:'root'},
  }} as any, (()=>null) as any);
  core.register({name:'sidebar.panellist.actions',id:'native-action',order:1}, ()=>null);
  const ctx = {
    effect(effect:()=>()=>void) { const stop=effect();effects.add(stop);return stop; },
    slots: {
      inject(name:string, callback:()=>()=>void) {
        let cleanup:undefined|(()=>void);
        const sync=()=>{if(core.specDynamic(name)){cleanup??=callback();}else{cleanup?.();cleanup=undefined;}};
        const unsubscribe=core.subscribeDeclaration(name,sync);sync();
        return ()=>{unsubscribe();cleanup?.();cleanup=undefined;};
      },
      register: core.register.bind(core),
    },
  } as unknown as Context;
  const native = () => {
    const stop=core.register({name:'sidebar.workspaces',children:{
      'sidebar.workspaces.session.menu.item':{kind:'list',scope:'root'},
    }} as any, (()=>null) as any);
    const entry=core.entries('sidebar.workspaces').find(item=>item.children)!;
    core.register({name:'sidebar.workspaces.session.menu.item',id:'pin',order:100},()=>null);
    return {entry,stop};
  };
  return {core,ctx,native,dispose(){for(const stop of effects)stop();}};
}
const winner=(core:SlotCore):StoredEntry|undefined=>core.entriesOfSlot('sidebar.workspaces')[0];

describe('workflow sidebar registration lifetime',()=>{
  it('waits for the native child declaration before shadowing and leaves native children intact',()=>{
    const fx=fixture(),registration=installWorkflowSidebar(fx.ctx,{component:()=>null,inject:()=>({})});
    expect(fx.core.entries('sidebar.workspaces')).toEqual([]);
    const native=fx.native(),children=fx.core.entries('sidebar.workspaces.session.menu.item');
    expect(winner(fx.core)?.options.priority).toBe(-10);
    expect(fx.core.entries('sidebar.workspaces')).toContain(native.entry);
    expect(winner(fx.core)?.children).toBeUndefined();
    registration.useNativeDirectory();
    expect(winner(fx.core)).toBe(native.entry);
    expect(fx.core.entries('sidebar.workspaces.session.menu.item')).toBe(children);
    registration.setEnabled(true);registration.setEnabled(true);
    expect(fx.core.entries('sidebar.workspaces')).toHaveLength(2);
    expect(winner(fx.core)?.options.priority).toBe(-10);
    registration.dispose();registration.setEnabled(true);
    expect(winner(fx.core)).toBe(native.entry);
    expect(fx.core.entries('sidebar.workspaces.session.menu.item')).toBe(children);
    expect(fx.core.entries('sidebar.panellist.actions').map(item=>item.options.id)).toEqual(['native-action']);
    native.stop();fx.dispose();
  });
  it('retains native mode across native plugin reloads, and re-enables only on an explicit action',()=>{
    const fx=fixture(),changed=vi.fn();
    const registration=installWorkflowSidebar(fx.ctx,{component:()=>null,inject:()=>({}),initiallyEnabled:false,onEnabledChange:changed});
    let native=fx.native();expect(winner(fx.core)).toBe(native.entry);
    native.stop();native=fx.native();expect(winner(fx.core)).toBe(native.entry);
    registration.setEnabled(true);expect(changed).toHaveBeenCalledExactlyOnceWith(true);
    native.stop();expect(winner(fx.core)).toBeUndefined();
    native=fx.native();expect(winner(fx.core)?.options.priority).toBe(-10);
    registration.useNativeDirectory();expect(changed).toHaveBeenLastCalledWith(false);
    expect(winner(fx.core)).toBe(native.entry);
    fx.dispose();native.stop();
  });
  it('lets the native More menu re-enable workflow grouping after the user returns to the native directory',async()=>{
    Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
    const fx=fixture(),native=fx.native(),dismiss=vi.fn();
    const registration=installWorkflowSidebar(fx.ctx,{component:()=>null,inject:()=>({}),initiallyEnabled:false,menuLabel:()=> '按工作流分组'});
    const entry=fx.core.entries('sidebar.panellist.actions').find(item=>item.options.id==='visual-workflow.group-directory')!;
    const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
    try{
      await act(async()=>root.render(createElement(entry.component as any,{onDismiss:dismiss})));
      const button=container.querySelector<HTMLButtonElement>('[data-testid=workflow-sidebar-enable]')!;
      expect(button.textContent).toBe('按工作流分组');expect(button.getAttribute('aria-checked')).toBe('false');
      await act(async()=>button.click());expect(registration.enabled).toBe(true);expect(dismiss).toHaveBeenCalledOnce();
      expect(winner(fx.core)?.options.priority).toBe(-10);expect(button.getAttribute('aria-checked')).toBe('true');
      await act(async()=>registration.useNativeDirectory());expect(winner(fx.core)).toBe(native.entry);
    }finally{await act(async()=>root.unmount());container.remove();fx.dispose();native.stop();}
  });
  it('withdraws its own contributions on fiber cleanup without disposing the native browser',()=>{
    const fx=fixture(),native=fx.native();
    const registration=installWorkflowSidebar(fx.ctx,{component:()=>null,inject:()=>({})});
    expect(fx.core.entries('sidebar.panellist.actions').map(item=>item.options.id)).toContain('visual-workflow.group-directory');
    fx.dispose();registration.dispose();registration.setEnabled(false);registration.setEnabled(true);
    expect(winner(fx.core)).toBe(native.entry);
    expect(fx.core.entries('sidebar.panellist.actions').map(item=>item.options.id)).toEqual(['native-action']);
    native.stop();
  });
 });
