// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelPicker, modelChoiceAvailable, modelOptionKey } from '../src/client/ModelPicker.tsx';
import { PlanSheet } from '../src/client/WorkflowSheets.tsx';
import type { ModelOption, WorkflowRuntimeProps } from '../src/client/ui-contract.ts';
import { translateZh } from '../src/client/locales.ts';

let root:Root,container:HTMLDivElement;
const first={provider:'provider/one',model:'model:one'},second={provider:'provider/two',model:'model:two'};
const options:ModelOption[]=[{id:modelOptionKey(first)!,label:'TEST Model One',provider:'TEST Provider One'},{id:modelOptionKey(second)!,label:'TEST Model Two',provider:'TEST Provider Two'}];
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
async function renderPicker(extra:Partial<Parameters<typeof ModelPicker>[0]>={}){await act(async()=>root.render(createElement(ModelPicker,{options,defaultLabel:'TEST Native Default',label:'TEST Model',testId:'model',onChange:()=>{},t:translateZh,...extra})));}
async function renderPlan(runtime:WorkflowRuntimeProps,onBeforeAction:()=>boolean|void=()=>{}){await act(async()=>root.render(createElement(PlanSheet,{runtime,t:translateZh,onClose:()=>{},onBeforeAction})));}
const picker=()=>container.querySelector<HTMLSelectElement>('[data-testid="model"]')!;
const composer=()=>container.querySelector<HTMLTextAreaElement>('[data-testid="plan-goal"]')!;
async function typeGoal(text:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(composer(),text);composer().dispatchEvent(new Event('input',{bubbles:true}));});}

describe('Shared model controls and planning readiness',()=>{
  it('passes stable model keys through a custom keyboard menu with a hidden compatibility select',async()=>{
    const onChange=vi.fn();await renderPicker({onChange});expect(picker().value).toBe('');expect(picker().options[0]!.textContent).toBe('TEST Native Default');expect(picker().hidden).toBe(true);expect(picker().getAttribute('aria-hidden')).toBe('true');expect(container.querySelector('[data-testid="model-trigger"]')?.getAttribute('aria-label')).toBe('TEST Model');
    await act(async()=>{picker().value=options[1]!.id;picker().dispatchEvent(new Event('change',{bubbles:true}));});expect(onChange).toHaveBeenCalledExactlyOnceWith(options[1]!.id);
    await renderPicker({value:options[1]!.id,onChange,defaultLabel:'Inherit TEST Model One'});await act(async()=>{picker().value='';picker().dispatchEvent(new Event('change',{bubbles:true}));});expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
  it('opens a portal menu with a selected row, skips disabled models and returns focus after selection or Escape',async()=>{
    const onChange=vi.fn();await renderPicker({onChange,options:[options[0]!,{id:'disabled',label:'TEST blocked',disabled:true},options[1]!]});
    const trigger=container.querySelector<HTMLButtonElement>('[data-testid="model-trigger"]')!;
    await act(async()=>trigger.click());const menu=document.querySelector<HTMLDivElement>('[data-testid="model-options"]')!;expect(menu.parentElement).toBe(document.body);expect(trigger.getAttribute('aria-expanded')).toBe('true');expect(menu.querySelector('[aria-selected="true"]')?.textContent).toBe('TEST Native Default');
    await act(async()=>menu.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'ArrowDown'})));expect(document.activeElement?.getAttribute('data-value')).toBe(options[0]!.id);
    await act(async()=>menu.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'ArrowDown'})));expect(document.activeElement?.getAttribute('data-value')).toBe(options[1]!.id);
    await act(async()=>(document.activeElement as HTMLButtonElement).click());expect(onChange).toHaveBeenLastCalledWith(options[1]!.id);expect(document.querySelector('[data-testid="model-options"]')).toBeNull();expect(document.activeElement).toBe(trigger);
    await act(async()=>trigger.click());await act(async()=>document.querySelector('[data-testid="model-options"]')!.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Escape'})));expect(document.querySelector('[data-testid="model-options"]')).toBeNull();expect(document.activeElement).toBe(trigger);
  });
  it('closes on outside clicks and loading changes without swallowing canvas keys or loading the native select',async()=>{
    await renderPicker();const trigger=container.querySelector<HTMLButtonElement>('[data-testid="model-trigger"]')!;await act(async()=>trigger.click());
    await act(async()=>document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));expect(document.querySelector('[data-testid="model-options"]')).toBeNull();
    await act(async()=>trigger.click());await renderPicker({loading:true});expect(document.querySelector('[data-testid="model-options"]')).toBeNull();expect(trigger.disabled).toBe(true);
  });
  it('puts the planning model immediately before Send within the composer and removes the old top model row',async()=>{
    await renderPlan({modelOptions:options,modelAvailable:true,onSelectGlobalModel:()=>{}});const model=container.querySelector('[data-testid="plan-model-picker-trigger"]')!,send=container.querySelector('[data-testid="generate-plan"]')!;
    expect(model.closest('.wf-plan-composer')).not.toBeNull();expect(model.closest('.wf-plan-submit-controls')).toBe(send.parentElement);expect(container.querySelector('.wf-plan-model')).toBeNull();
  });
  it('keeps unavailable persisted choices visible and disables changes during loading',async()=>{
    await renderPicker({value:'TEST missing option',loading:true});expect(picker().value).toBe('TEST missing option');expect(picker().disabled).toBe(true);expect([...picker().options].find(option=>option.value==='TEST missing option')?.disabled).toBe(true);expect(picker().options[0]!.textContent).toBe(translateZh('modelsLoading'));
  });
  it('offers catalog refresh before an error and even when selection is read only, and prevents duplicate refresh while loading',async()=>{
    const onRetry=vi.fn();await renderPicker({onRetry,disabled:true});const retry=container.querySelector<HTMLButtonElement>('[data-testid="model-retry"]')!;expect(retry).not.toBeNull();expect(retry.title).toBe(translateZh('reloadModels'));expect(retry.disabled).toBe(false);await act(async()=>retry.click());expect(onRetry).toHaveBeenCalledOnce();await renderPicker({onRetry,loading:true});expect(container.querySelector<HTMLButtonElement>('[data-testid="model-retry"]')!.disabled).toBe(true);await renderPicker({onRetry,compact:true});expect(container.querySelector('[data-testid="model-retry"]')).toBeNull();
  });
  it('allows a valid node override without a global default and rejects an unavailable override',()=>{
    expect(modelChoiceAvailable(first,options,false)).toBe(true);expect(modelChoiceAvailable(undefined,options,false)).toBe(false);expect(modelChoiceAvailable({provider:'missing',model:'missing'},options,true)).toBe(false);expect(modelChoiceAvailable(undefined,undefined,undefined)).toBe(true);
  });
  it('allows an explicit user planning request in manual mode and preserves the goal until native admission',async()=>{
    const onGeneratePlan=vi.fn();const runtime:WorkflowRuntimeProps={runtimeReady:true,modelAvailable:true,generationMode:'manual',onGeneratePlan,modelOptions:options};await renderPlan(runtime);await typeGoal('TEST explicit plan');const send=container.querySelector<HTMLButtonElement>('[data-testid="generate-plan"]')!;expect(send.disabled).toBe(false);await act(async()=>send.click());expect(onGeneratePlan).toHaveBeenCalledExactlyOnceWith('TEST explicit plan',undefined);expect(composer().value).toBe('TEST explicit plan');
    await renderPlan({...runtime,plans:[{id:'admitted-plan',goal:'TEST explicit plan',status:'running',tasks:[]}]});expect(composer().value).toBe('');
  });
  it('keeps goal drafts through model loading/errors and disables submission with a real retry action',async()=>{
    const onGeneratePlan=vi.fn(),onReloadModels=vi.fn();await renderPlan({onGeneratePlan,modelsLoading:true,runtimeReady:true});await typeGoal('TEST preserved draft');expect(container.querySelector<HTMLButtonElement>('[data-testid="generate-plan"]')!.disabled).toBe(true);await renderPlan({onGeneratePlan,onReloadModels,modelsError:'TEST native model catalog failure',modelAvailable:false,runtimeReady:true});expect(composer().value).toBe('TEST preserved draft');expect(container.querySelector('[data-testid="planning-availability"]')?.textContent).toContain('TEST native model catalog failure');await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="planning-availability"] button')!.click());expect(onReloadModels).toHaveBeenCalledOnce();expect(onGeneratePlan).not.toHaveBeenCalled();
  });
  it('does not submit when the runtime is incompatible or an unsaved edit blocks the action',async()=>{
    const onGeneratePlan=vi.fn();await renderPlan({onGeneratePlan,runtimeReady:false,modelAvailable:true});await typeGoal('TEST blocked request');expect(container.querySelector<HTMLButtonElement>('[data-testid="generate-plan"]')!.disabled).toBe(true);expect(composer().disabled).toBe(false);await renderPlan({onGeneratePlan,runtimeReady:true,modelAvailable:true},()=>false);await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="generate-plan"]')!.click());expect(onGeneratePlan).not.toHaveBeenCalled();expect(composer().value).toBe('TEST blocked request');
  });
  it('surfaces stale model-selection failures in planning without losing the goal or raising an unhandled event error',async()=>{
    await renderPlan({modelOptions:options,runtimeReady:true,modelAvailable:true,onSelectGlobalModel:()=>{throw new Error('TEST selection became stale');}});await typeGoal('TEST private goal');const select=container.querySelector<HTMLSelectElement>('[data-testid="plan-model-picker"]')!;await act(async()=>{select.value=options[0]!.id;select.dispatchEvent(new Event('change',{bubbles:true}));});expect(container.querySelector('[data-testid="planning-availability"]')?.textContent).toContain('TEST selection became stale');expect(composer().value).toBe('TEST private goal');
  });
  it('opens the model reasoning control from the context menu without selecting the row',async()=>{
    const onChange=vi.fn(),onReasoningChange=vi.fn();
    await renderPicker({onChange,onReasoningChange,reasoningForOption:()=>({steps:[{value:'low',label:'低'},{value:'max',label:'最高'}],value:'low',availability:'available'})});
    const trigger=container.querySelector<HTMLButtonElement>('[data-testid="model-trigger"]')!;
    await act(async()=>trigger.click());
    const option=document.querySelector<HTMLButtonElement>('[data-testid="model-option-0"]')!;
    await act(async()=>option.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2})));
    expect(onChange).not.toHaveBeenCalled();
    const popover=document.querySelector('[data-testid="model-reasoning-popover"]')!;
    expect(popover).not.toBeNull();expect(popover.getAttribute('role')).toBe('dialog');
    const slider=popover.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider.disabled).toBe(false);expect(slider.getAttribute('aria-valuetext')).toBe('低 · low');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(slider,'1');
    await act(async()=>slider.dispatchEvent(new Event('input',{bubbles:true})));
    expect(onReasoningChange).toHaveBeenCalledWith(undefined,'max');
    expect(document.querySelector('[data-testid="model-options"]')).not.toBeNull();
    await act(async()=>popover.querySelector<HTMLButtonElement>('button[aria-label="关闭思考程度"]')!.click());
    expect(document.querySelector('[data-testid="model-reasoning-popover"]')).toBeNull();
  });
  it('opens reasoning with the keyboard, contains slider keys and restores row focus before closing the list',async()=>{
    const onChange=vi.fn();await renderPicker({onChange,onReasoningChange:()=>{},reasoningForOption:()=>({steps:[{value:'low',label:'低'},{value:'high',label:'高'}],value:'low'})});
    await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="model-trigger"]')!.click());
    const row=document.querySelector<HTMLButtonElement>('[data-testid="model-option-1"]')!;
    await act(async()=>row.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'F10',shiftKey:true})));
    const slider=document.querySelector<HTMLInputElement>('[data-testid="model-reasoning-input"]')!;
    expect(slider.disabled).toBe(false);expect(document.activeElement).toBe(slider);
    await act(async()=>slider.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'ArrowDown'})));
    expect(document.activeElement).toBe(slider);expect(onChange).not.toHaveBeenCalled();
    await act(async()=>slider.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Escape'})));
    expect(document.querySelector('[data-testid="model-reasoning-popover"]')).toBeNull();expect(document.activeElement).toBe(row);
    expect(document.querySelector('[data-testid="model-options"]')).not.toBeNull();
    await act(async()=>row.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Escape'})));
    expect(document.querySelector('[data-testid="model-options"]')).toBeNull();
  });
  it('preserves drag changes while save requests are pending and serializes the final native effort',async()=>{
    let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
    const onReasoningChange=vi.fn().mockImplementationOnce(()=>held).mockResolvedValue(undefined);
    await renderPicker({onReasoningChange,reasoningForOption:()=>({steps:[{value:'low',label:'低'},{value:'medium',label:'中'},{value:'high',label:'高'}],value:'low'})});
    await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="model-trigger"]')!.click());
    await act(async()=>document.querySelector('[data-testid="model-option-1"]')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2})));
    const slider=document.querySelector<HTMLInputElement>('[data-testid="model-reasoning-input"]')!;
    const change=async(value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(slider,value);slider.dispatchEvent(new Event('input',{bubbles:true}));});
    await change('1');expect(onReasoningChange).toHaveBeenCalledExactlyOnceWith(options[0]!.id,'medium');expect(slider.disabled).toBe(false);
    await change('0');await change('2');expect(slider.value).toBe('2');expect(onReasoningChange).toHaveBeenCalledTimes(1);
    await act(async()=>release());expect(onReasoningChange.mock.calls).toEqual([[options[0]!.id,'medium'],[options[0]!.id,'high']]);
    await act(async()=>document.querySelector<HTMLButtonElement>('.wf-model-reasoning-footer button')!.click());expect(onReasoningChange).toHaveBeenLastCalledWith(options[0]!.id,undefined);
  });
  it('keeps unknown models unavailable and surfaces rejected saves without closing the menu',async()=>{
    await renderPicker({reasoningForOption:()=>undefined,onReasoningChange:()=>{}});
    await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="model-trigger"]')!.click());
    await act(async()=>document.querySelector('[data-testid="model-option-1"]')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2})));
    expect(document.querySelector<HTMLInputElement>('[data-testid="model-reasoning-input"]')!.disabled).toBe(true);
    await act(async()=>document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));
    expect(document.querySelector('[data-testid="model-reasoning-popover"]')).toBeNull();expect(document.querySelector('[data-testid="model-options"]')).toBeNull();
    await renderPicker({reasoningForOption:()=>({steps:[{value:'low',label:'低'},{value:'high',label:'高'}],value:'low'}),onReasoningChange:()=>{throw new Error('TEST effort failed');}});
    await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="model-trigger"]')!.click());
    await act(async()=>document.querySelector('[data-testid="model-option-1"]')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2})));
    const slider=document.querySelector<HTMLInputElement>('[data-testid="model-reasoning-input"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(slider,'1');slider.dispatchEvent(new Event('input',{bubbles:true}));});
    expect(document.querySelector('.wf-model-reasoning-error')?.textContent).toBe('TEST effort failed');expect(slider.value).toBe('0');expect(slider.disabled).toBe(false);expect(document.querySelector('[data-testid="model-options"]')).not.toBeNull();
  });
  it('discards queued effort writes when the reasoning popover unmounts',async()=>{
    let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
    const onReasoningChange=vi.fn().mockImplementationOnce(()=>held).mockResolvedValue(undefined);
    await renderPicker({onReasoningChange,reasoningForOption:()=>({steps:[{value:'low',label:'低'},{value:'medium',label:'中'},{value:'high',label:'高'}],value:'low'})});
    await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="model-trigger"]')!.click());
    await act(async()=>document.querySelector('[data-testid="model-option-1"]')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2})));
    const slider=document.querySelector<HTMLInputElement>('[data-testid="model-reasoning-input"]')!;
    const change=async(value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(slider,value);slider.dispatchEvent(new Event('input',{bubbles:true}));});
    await change('1');await change('2');expect(onReasoningChange).toHaveBeenCalledTimes(1);
    await act(async()=>root.render(null));
    await act(async()=>release());
    expect(onReasoningChange).toHaveBeenCalledExactlyOnceWith(options[0]!.id,'medium');
  });
});
