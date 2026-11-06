// @vitest-environment jsdom
import {act,createElement,useRef,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {useSlashCommands} from '../src/client/SlashCommands.tsx';
import {NodeComposer,type NodeComposerProps} from '../src/client/NodeComposer.tsx';
import {PlanSheet} from '../src/client/WorkflowSheets.tsx';
import type {WorkflowRuntimeProps} from '../src/client/ui-contract.ts';
import type {WorkflowContextValue} from '../src/shared/model.ts';
import {translateZh} from '../src/client/locales.ts';
let root:Root,container:HTMLDivElement;
const context:WorkflowContextValue={sessionId:'private-target',label:'TEST target',source:'pressure',canCompact:true,compacting:false,readOnly:false};
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callback(0);return 1;});});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const element=<T extends HTMLElement=HTMLElement>(id:string)=>document.querySelector<T>(`[data-testid="${id}"]`)!;
async function input(value:string,id='test-input'){await act(async()=>{const target=element<HTMLTextAreaElement>(id);target.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(target,value);target.setSelectionRange(value.length,value.length);target.dispatchEvent(new Event('input',{bubbles:true}));});}
const key=(value:string,extra:KeyboardEventInit={},id='test-input')=>act(async()=>element(id).dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...extra})));
const click=(id:string)=>act(async()=>element<HTMLButtonElement>(id).click());
type HookOptions=Parameters<typeof useSlashCommands>[0];
function Harness(props:Partial<HookOptions>&{initial?:string;onSubmit?:()=>void}){const [value,setValue]=useState(props.initial??''),ref=useRef<HTMLTextAreaElement>(null);const slash=useSlashCommands({value,onChange:setValue,input:ref,maxLength:20000,t:translateZh,...props});return createElement('div',{},createElement('textarea',{'data-testid':'test-input',ref,value,onChange:slash.onChange,onSelect:slash.onSelect,onFocus:slash.onFocus,onBlur:slash.onBlur,onCompositionStart:slash.onCompositionStart,onCompositionEnd:slash.onCompositionEnd,onKeyDown:(event:React.KeyboardEvent<HTMLTextAreaElement>)=>{if(slash.onKeyDown(event))return;if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&!slash.interceptSubmit())props.onSubmit?.();}}),slash.menu,slash.feedback,createElement('button',{'data-testid':'test-submit',onClick:()=>{if(!slash.interceptSubmit())props.onSubmit?.();}},'submit'));}
const render=(extra:Partial<HookOptions>&{initial?:string;onSubmit?:()=>void}={})=>act(async()=>root.render(createElement(Harness,extra)));
describe('Task-local slash command input',()=>{
  it('handles a standalone compact line without sending it or clearing existing body text, and prevents duplicate compaction',async()=>{
    let finish!:()=>void;const onCompact=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;})),onSubmit=vi.fn();await render({canCompact:true,onCompact,onSubmit});await input('Keep this exact task.\n/compact');await key('Enter');expect(onCompact).toHaveBeenCalledOnce();expect(onSubmit).not.toHaveBeenCalled();expect(element<HTMLTextAreaElement>('test-input').value).toBe('Keep this exact task.\n');await input('Keep this exact task.\n/compact');await click('test-submit');expect(onCompact).toHaveBeenCalledOnce();await act(async()=>finish());
  });
  it('requires a real compact target, treats arguments as invalid, and never submits reserved commands as task prompts',async()=>{
    const onSubmit=vi.fn(),onCompact=vi.fn(async()=>{});await render({onSubmit,onCompact,canCompact:false,compactUnavailable:'No planning Session yet'});await input('/compact');await key('Enter');expect(element('slash-command-feedback').textContent).toContain('No planning Session yet');expect(element<HTMLTextAreaElement>('test-input').value).toBe('/compact');expect(onSubmit).not.toHaveBeenCalled();expect(onCompact).not.toHaveBeenCalled();
    await render({onSubmit,onCompact,canCompact:true});await input('My body\n/compact unexpected');await click('test-submit');expect(element('slash-command-feedback').textContent).toContain('不接受参数');expect(onSubmit).not.toHaveBeenCalled();expect(onCompact).not.toHaveBeenCalled();
  });
  it('opens native skill search, filters names and descriptions, and inserts only the actual skill name',async()=>{
    const onReloadSkills=vi.fn(async()=>{}),onSubmit=vi.fn();const skills=[{name:'code-review',description:'Review the current code'},{name:'native-docs',description:'Read native documentation'}];await render({skills,onReloadSkills,onSubmit});await input('/skills review');expect(onReloadSkills).toHaveBeenCalledOnce();expect(document.querySelectorAll('[role=option]')).toHaveLength(1);await key('Enter');expect(element<HTMLTextAreaElement>('test-input').value).toBe('/code-review ');expect(onSubmit).not.toHaveBeenCalled();expect(element('slash-command-menu')).toBeNull();await key('Enter');expect(onSubmit).toHaveBeenCalledOnce();
  });
  it('supports keyboard navigation, Escape and composition without running commands or losing the draft',async()=>{
    const onCompact=vi.fn(async()=>{}),onSubmit=vi.fn();await render({skills:[{name:'alpha'},{name:'beta'}],onCompact,onSubmit,canCompact:true});await input('/');await key('ArrowDown');expect(element('slash-option-skills').getAttribute('aria-selected')).toBe('true');await key('Enter');expect(element<HTMLTextAreaElement>('test-input').value).toBe('/skills ');await key('End');await key('ArrowUp');expect(element('slash-option-skill-alpha').getAttribute('aria-selected')).toBe('true');await key('Escape');expect(element('slash-command-menu')).toBeNull();expect(element<HTMLTextAreaElement>('test-input').value).toBe('/skills ');
    await input('/compact');await key('Enter',{isComposing:true});expect(onCompact).not.toHaveBeenCalled();expect(onSubmit).not.toHaveBeenCalled();expect(element<HTMLTextAreaElement>('test-input').value).toBe('/compact');
  });
  it('shows native skill loading, empty and errors and blocks insertions beyond the length limit',async()=>{
    const onReloadSkills=vi.fn(async()=>{});await render({skillsLoading:true,onReloadSkills});await input('/skills');expect(element('slash-command-menu').textContent).toContain('正在读取');await render({onReloadSkills,skillsError:'Native skills offline'});expect(element('slash-command-menu').textContent).toContain('Native skills offline');await render({onReloadSkills});expect(element('slash-command-menu').textContent).toContain('没有匹配');
    await render({skills:[{name:'very-long-native-skill'}],maxLength:12});await input('Body\n/skills');await key('Enter');expect(element('slash-command-feedback').textContent).toContain('长度上限');expect(element<HTMLTextAreaElement>('test-input').value).toBe('Body\n/skills');
  });
  it('does not execute unknown slash commands or intercept ordinary task text',async()=>{
    const onCompact=vi.fn(async()=>{}),onSubmit=vi.fn();await render({onCompact,onSubmit,canCompact:true});await input('/not-a-native-command');await key('Enter');expect(onCompact).not.toHaveBeenCalled();expect(onSubmit).not.toHaveBeenCalled();expect(element('slash-command-menu').textContent).toContain('未找到');await input('Explain the /compact option as text.');await key('Enter');expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe('Composer integration',()=>{
  it('routes node Enter to compaction and skill selection without admitting an Agent run',async()=>{
    const onRun=vi.fn(),onCommit=vi.fn(()=>true),onCompactContext=vi.fn(async()=>{});const props:NodeComposerProps={node:{id:'task',title:'TEST task',instruction:'',source:'user',status:'draft',revision:1,position:{x:0,y:0}},instruction:'',readOnly:false,busy:false,onChangeInstruction:()=>{},onCommit,onRun,onClose:()=>{},onExpand:()=>{},onSelectModel:()=>{},contextUsage:context,onCompactContext,skillOptions:[{name:'native-code-review'}],t:translateZh};
    function Composer(){const [value,setValue]=useState('');return createElement(NodeComposer,{...props,instruction:value,onChangeInstruction:setValue});}await act(async()=>root.render(createElement(Composer)));
    await input('Preserved task\n/compact','node-composer-input');await key('Enter',{},'node-composer-input');expect(onCompactContext).toHaveBeenCalledOnce();expect(onRun).not.toHaveBeenCalled();expect(onCommit).not.toHaveBeenCalled();expect(element<HTMLTextAreaElement>('node-composer-input').value).toBe('Preserved task\n');await input('/skills review','node-composer-input');await key('Enter',{},'node-composer-input');expect(element<HTMLTextAreaElement>('node-composer-input').value).toBe('/native-code-review ');expect(onRun).not.toHaveBeenCalled();
  });
  it('keeps planning source selection separate from the current planning compact target',async()=>{
    const onGeneratePlan=vi.fn(),onCompactContext=vi.fn(async()=>{});const runtime:WorkflowRuntimeProps={contextUsage:{...context,sessionId:undefined,canCompact:false,unavailableReason:'No private planning Session'},onCompactContext,onGeneratePlan,sessionRoots:[{sessionId:'original-source',title:'Original immutable source',updatedAt:1}]};await act(async()=>root.render(createElement(PlanSheet,{runtime,selectedSessionId:'original-source',t:translateZh,onClose:()=>{},onBeforeAction:()=>true})));
    await input('Existing planning body\n/compact','plan-goal');await key('Enter',{},'plan-goal');expect(onCompactContext).not.toHaveBeenCalled();expect(onGeneratePlan).not.toHaveBeenCalled();expect(element('slash-command-feedback').textContent).toContain('No private planning Session');
    await act(async()=>root.render(createElement(PlanSheet,{runtime:{...runtime,contextUsage:context},selectedSessionId:'original-source',t:translateZh,onClose:()=>{},onBeforeAction:()=>true})));await key('Enter',{},'plan-goal');expect(onCompactContext).toHaveBeenCalledOnce();expect(onGeneratePlan).not.toHaveBeenCalled();expect(element<HTMLTextAreaElement>('plan-goal').value).toBe('Existing planning body\n');expect(element<HTMLSelectElement>('plan-source').value).toBe('original-source');
  });
  it('does not submit planning text while IME composition is active even if the key lacks isComposing',async()=>{
    const onGeneratePlan=vi.fn();await act(async()=>root.render(createElement(PlanSheet,{runtime:{onGeneratePlan},t:translateZh,onClose:()=>{},onBeforeAction:()=>true})));await input('正在输入的中文','plan-goal');
    await act(async()=>element('plan-goal').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
    await key('Enter',{},'plan-goal');expect(onGeneratePlan).not.toHaveBeenCalled();
    await act(async()=>element('plan-goal').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
    await key('Enter',{},'plan-goal');expect(onGeneratePlan).toHaveBeenCalledExactlyOnceWith('正在输入的中文',undefined);
  });
});
