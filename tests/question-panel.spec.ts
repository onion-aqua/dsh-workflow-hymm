// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionPanel } from '../src/client/QuestionPanel.tsx';
import { translateZh } from '../src/client/locales.ts';
import type { WorkflowPendingQuestion } from '../src/shared/model.ts';

let root:Root,container:HTMLDivElement;
const request:WorkflowPendingQuestion={workflowId:'workflow',runId:'run',nodeId:'node',sessionId:'native-session',callId:'native-call',state:'open',actionable:true,createdAt:1,questions:[{id:'direction',question:'Which direction?',header:'Direction',options:[{label:'Explore',description:'Read the current code'},{label:'Build',description:'Implement the feature'}]},{id:'checks',question:'Which checks?',options:[{label:'Unit'},{label:'Browser'}],multiSelect:true}]};
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
const element=<T extends Element=HTMLElement>(id:string)=>container.querySelector<T>(`[data-testid="${id}"]`)!;
async function render(extra:Partial<Parameters<typeof QuestionPanel>[0]>={}){await act(async()=>root.render(createElement(QuestionPanel,{question:request,nodeTitle:'TEST native task',onClose:()=>{},onAnswer:async()=>{},t:translateZh,...extra})));}
async function click(target:Element){await act(async()=>(target as HTMLElement).click());}
async function type(id:string,value:string){await act(async()=>{const input=element<HTMLTextAreaElement>(id);Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}

describe('Native question panel',()=>{
  it('keeps a native timed question answerable after the Agent continued',async()=>{
    const onAnswer=vi.fn(async()=>{}),continued={...request,state:'continued' as const,actionable:true};await render({question:continued,onAnswer});expect(container.textContent).toContain('仍可补充回答');expect(element<HTMLButtonElement>('question-skip-all').disabled).toBe(false);await click(element('question-skip-all'));expect(onAnswer).toHaveBeenCalledExactlyOnceWith(continued,[{id:'direction',selected:[]},{id:'checks',selected:[]}]);expect(container.textContent).toContain('回答已提交');
  });
  it('shows actual native prompts, submits original labels for single and multiple choices, and preserves the full request route',async()=>{
    const onAnswer=vi.fn(async()=>{});await render({onAnswer});expect(element('question-panel').getAttribute('data-call-id')).toBe('native-call');expect(container.textContent).toContain('Which direction?');expect(container.textContent).toContain('Read the current code');expect(element<HTMLButtonElement>('question-submit').disabled).toBe(true);
    await click(element('question-item-direction').querySelectorAll('input')[1]!);for(const input of element('question-item-checks').querySelectorAll('input'))await click(input);await click(element('question-submit'));expect(onAnswer).toHaveBeenCalledExactlyOnceWith(request,[{id:'direction',selected:['Build']},{id:'checks',selected:['Unit','Browser']}]);expect(container.textContent).toContain('回答已提交');
  });
  it('retains a custom answer after failure, updates without stealing focus, and retries once without losing input',async()=>{
    const onAnswer=vi.fn().mockRejectedValueOnce(new Error('Native delivery failed')).mockResolvedValue(undefined);await render({onAnswer});await click(element('question-custom-direction'));await type('question-custom-input-direction','My exact native answer');await click(element('question-skip-checks'));const input=element<HTMLTextAreaElement>('question-custom-input-direction');input.focus();await render({onAnswer,question:{...request,createdAt:2}});expect(document.activeElement).toBe(input);expect(input.value).toBe('My exact native answer');await click(element('question-submit'));expect(container.textContent).toContain('Native delivery failed');expect(input.value).toBe('My exact native answer');await click(element('question-submit'));expect(onAnswer).toHaveBeenCalledTimes(2);expect(onAnswer.mock.calls[1]).toEqual([{...request,createdAt:2},[{id:'direction',selected:[],custom:'My exact native answer'},{id:'checks',selected:[]}]]);
  });
  it('skips the complete native batch with empty selections and never invents skip labels',async()=>{
    const onAnswer=vi.fn(async()=>{});await render({onAnswer});await click(element('question-skip-all'));expect(onAnswer).toHaveBeenCalledExactlyOnceWith(request,[{id:'direction',selected:[]},{id:'checks',selected:[]}]);
  });
  it('does not auto focus or submit a nonactionable question',async()=>{
    const outside=document.createElement('input');document.body.append(outside);outside.focus();const onAnswer=vi.fn(async()=>{});await render({onAnswer});expect(document.activeElement).toBe(outside);await render({onAnswer,question:{...request,state:'continued',actionable:false}});expect(element<HTMLButtonElement>('question-submit').disabled).toBe(true);expect(container.textContent).toContain('当前无法在画布提交');await click(element('question-skip-all'));expect(onAnswer).not.toHaveBeenCalled();expect(document.activeElement).toBe(outside);outside.remove();
  });
  it('locks only the submitting batch and prevents duplicate keyboard or click submission',async()=>{
    let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;}),onAnswer=vi.fn(()=>wait);await render({onAnswer});await click(element('question-skip-direction'));await click(element('question-skip-checks'));await click(element('question-submit'));await act(async()=>element('question-panel').dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',ctrlKey:true})));await click(element('question-skip-all'));expect(onAnswer).toHaveBeenCalledOnce();expect(element<HTMLButtonElement>('question-submit').disabled).toBe(true);await act(async()=>release());
  });
  it('keeps native text safe and preserves composition and normal textarea Enter behavior',async()=>{
    const onAnswer=vi.fn(async()=>{}),onClose=vi.fn();await render({question:{...request,questions:[{id:'text',question:'<script>window.questionInjected=true</script> **Native**'}]},onAnswer,onClose});expect(container.querySelector('script')).toBeNull();await click(element('question-custom-text'));await type('question-custom-input-text','IME draft');const input=element('question-custom-input-text');for(const key of ['Enter','Escape'])await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key,ctrlKey:true,isComposing:true})));expect(onAnswer).not.toHaveBeenCalled();expect(onClose).not.toHaveBeenCalled();const enter=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter'});await act(async()=>input.dispatchEvent(enter));expect(enter.defaultPrevented).toBe(false);expect(onAnswer).not.toHaveBeenCalled();
  });
});
