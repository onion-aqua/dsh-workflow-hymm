// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {WorkflowHistoryChoice} from '../src/client/WorkflowHistoryChoice.tsx';
import {WorkflowPicker} from '../src/client/WorkflowPicker.tsx';
import {translateZh} from '../src/client/locales.ts';
import type {WorkflowSessionArchivePreviewValue,WorkflowSessionArchiveValue} from '../src/shared/model.ts';

let root:Root,container:HTMLDivElement;
const preview:WorkflowSessionArchivePreviewValue={workflowId:'one',expectedRevision:3,available:true,sessionIds:['owned-a','owned-b'],protectedCount:1,alreadyArchivedCount:0};
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
async function click(id:string){await act(async()=>{document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click();await Promise.resolve();});}
const props=()=>({workflow:{id:'one',name:'项目计划'},t:translateZh,onClose:vi.fn(),onPreview:vi.fn(async()=>preview),onArchive:vi.fn(async():Promise<WorkflowSessionArchiveValue>=>({archivedSessionIds:['owned-a','owned-b'],failedSessionIds:[],skippedSessionIds:[]}))});
async function render(value:ReturnType<typeof props>){await act(async()=>{root.render(createElement(WorkflowHistoryChoice,value));await Promise.resolve();});}

describe('Independent native history choice',()=>{
  it('asks only after successful workflow removal and defaults to keeping all history',async()=>{
    const onDelete=vi.fn(async()=>true),onPreview=vi.fn(async()=>preview),onArchive=vi.fn();
    await act(async()=>root.render(createElement(WorkflowPicker,{options:[{id:'one',name:'项目计划'}],value:'one',onSelect:vi.fn(),onDelete,onPreviewSessionArchive:onPreview,onArchiveSessionHistory:onArchive,t:translateZh})));
    await click('workflow-picker');await click('delete-workflow-one');
    expect(onPreview).not.toHaveBeenCalled();expect(onArchive).not.toHaveBeenCalled();
    await click('confirm-delete-workflow');
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('one');expect(onPreview).toHaveBeenCalledExactlyOnceWith('one');
    expect(document.querySelector('[data-testid=workflow-history-choice]')?.textContent).toContain('原始历史文件仍由 DSH 保留');
    expect(document.activeElement).toBe(document.querySelector('[data-testid=keep-workflow-history]'));
    await click('keep-workflow-history');expect(onArchive).not.toHaveBeenCalled();expect(document.querySelector('[data-testid=workflow-history-choice]')).toBeNull();
  });
  it('submits only the reviewed native Session set after a second explicit click and blocks duplicate clicks',async()=>{
    const value=props();let finish!:(value:Awaited<ReturnType<typeof value.onArchive>>)=>void;
    value.onArchive=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));await render(value);
    expect(document.querySelector('[data-testid=history-archive-count]')?.textContent).toContain('2');
    expect(document.querySelector('[data-testid=workflow-history-choice]')?.textContent).toContain('1 条来源、共享或活动对话');
    await click('confirm-archive-history');await click('confirm-archive-history');expect(value.onArchive).toHaveBeenCalledExactlyOnceWith(preview);
    await act(async()=>finish({archivedSessionIds:['owned-a','owned-b'],failedSessionIds:[],skippedSessionIds:[]}));expect(value.onClose).toHaveBeenCalledOnce();
  });
  it('keeps native history on Escape or outside dismissal without submitting any archive request',async()=>{
    const value=props();await render(value);await act(async()=>document.querySelector('[data-testid=workflow-history-choice]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(value.onClose).toHaveBeenCalledOnce();expect(value.onArchive).not.toHaveBeenCalled();
  });
  it('disables archive when there are no eligible Sessions or no native service',async()=>{
    const value=props();value.onPreview.mockResolvedValue({...preview,available:false,sessionIds:[],reason:'Native archive unavailable'});await render(value);
    expect(document.querySelector<HTMLButtonElement>('[data-testid=confirm-archive-history]')?.disabled).toBe(true);
    expect(document.querySelector('[data-testid=workflow-history-choice]')?.textContent).toContain('Native archive unavailable');await click('keep-workflow-history');expect(value.onArchive).not.toHaveBeenCalled();
  });
  it('does not replay an uncertain write; only an explicit recheck restores the choice',async()=>{
    const value=props();value.onArchive.mockRejectedValueOnce(new Error('Response lost'));await render(value);await click('confirm-archive-history');
    expect(document.querySelector('[role=alert]')?.textContent).toContain('不会自动重试');expect(value.onArchive).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-testid=confirm-archive-history]')).toBeNull();expect(value.onPreview).toHaveBeenCalledOnce();
    await click('history-archive-recheck');expect(value.onPreview).toHaveBeenCalledTimes(2);expect(value.onArchive).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLButtonElement>('[data-testid=confirm-archive-history]')?.disabled).toBe(false);
  });
  it('reports partial results and preserves failed or skipped history for a fresh decision',async()=>{
    const value=props();value.onArchive.mockResolvedValueOnce({archivedSessionIds:['owned-a'],failedSessionIds:['owned-b'],skippedSessionIds:[]});await render(value);await click('confirm-archive-history');
    expect(value.onClose).not.toHaveBeenCalled();expect(document.querySelector('[data-testid=history-archive-result]')?.textContent).toContain('已归档 1 条');expect(value.onArchive).toHaveBeenCalledOnce();
    await click('keep-workflow-history');expect(value.onClose).toHaveBeenCalledOnce();expect(value.onArchive).toHaveBeenCalledOnce();
  });
});
