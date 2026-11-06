// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ContextCapacity} from '../src/client/ContextCapacity.tsx';
import type {WorkflowContextValue} from '../src/shared/model.ts';
import {translateZh} from '../src/client/locales.ts';
let root:Root,container:HTMLDivElement;
const usage:WorkflowContextValue={sessionId:'native-task-session',label:'TEST task #3',usedTokens:2500,capacityTokens:10000,source:'projected',canCompact:true,compacting:false,readOnly:false};
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
const element=<T extends HTMLElement=HTMLElement>(id:string)=>container.querySelector<T>(`[data-testid="${id}"]`)!;
const render=(extra:Partial<Parameters<typeof ContextCapacity>[0]>={})=>act(async()=>root.render(createElement(ContextCapacity,{contextUsage:usage,onCompactContext:async()=>{},t:translateZh,...extra})));
const click=(id:string)=>act(async()=>element<HTMLButtonElement>(id).click());
describe('Native context capacity control',()=>{
  it('keeps unavailable measurements unknown and explains the real target and diagnostic',async()=>{
    await render({contextUsage:{...usage,usedTokens:undefined,capacityTokens:undefined,source:'unavailable',configurationIssue:'Native input model has no contextWindow',unavailableReason:'Native pressure is not available'}});
    expect(element('context-capacity-value').textContent).toBe('—');expect(container.textContent).not.toContain('0%');await click('context-capacity-trigger');
    expect(element('context-token-count').textContent).toBe('— / —');expect(element('context-target-label').textContent).toBe(usage.label);expect(element('context-configuration').textContent).toContain('no contextWindow');
    await render({contextUsage:{...usage,usedTokens:500,capacityTokens:undefined}});expect(element('context-capacity-value').textContent).toBe('—');expect(element('context-token-count').textContent).toBe('500 / —');
  });
  it('renders native token ratio and its estimate source without confusing it with billing usage',async()=>{
    await render({contextUsage:{...usage,summaryModel:{provider:'native',model:'summary-model'},lastCompactedAt:1000}});expect(element('context-capacity-value').textContent).toBe('25%');expect(container.querySelector('.wf-context-progress')?.getAttribute('stroke-dasharray')).toBe('25 100');
    await click('context-capacity-trigger');expect(element('context-token-count').textContent).toBe('2,500 / 10,000');expect(element('context-usage-source').textContent).toContain('估计');expect(container.textContent).toContain('native / summary-model');
    await render({contextUsage:{...usage,usedTokens:12500,source:'pressure'}});expect(element('context-capacity-value').textContent).toBe('125%');expect(container.querySelector('.wf-context-progress')?.getAttribute('stroke-dasharray')).toBe('100 100');expect(element('context-usage-source').textContent).not.toContain('估计');
  });
  it('never enables compaction for a source Session or a missing target',async()=>{
    const onCompactContext=vi.fn(async()=>{});await render({contextUsage:{...usage,readOnly:true},onCompactContext});await click('context-capacity-trigger');expect(element<HTMLButtonElement>('compact-context').disabled).toBe(true);await click('compact-context');expect(onCompactContext).not.toHaveBeenCalled();
    await render({contextUsage:{...usage,sessionId:undefined},onCompactContext});expect(element<HTMLButtonElement>('compact-context').disabled).toBe(true);
  });
  it('submits one explicit native compaction, displays progress and preserves failures for retry',async()=>{
    let reject!:(error:Error)=>void;const onCompactContext=vi.fn(()=>new Promise<void>((_resolve,rejectPromise)=>{reject=rejectPromise;}));await render({onCompactContext});await click('context-capacity-trigger');await click('compact-context');await click('compact-context');expect(onCompactContext).toHaveBeenCalledOnce();expect(element<HTMLButtonElement>('compact-context').disabled).toBe(true);expect(element('compact-context').textContent).toContain('正在压缩');
    await act(async()=>reject(new Error('Native summary model unavailable')));expect(container.querySelector('[role=alert]')?.textContent).toContain('Native summary model unavailable');expect(element<HTMLButtonElement>('compact-context').disabled).toBe(false);
    await render({contextUsage:{...usage,sessionId:'another-session'},onCompactContext:async()=>{}});expect(container.querySelector('[role=alert]')).toBeNull();
  });
});
