// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeFileAttachments, type NodeFileUploadProgress, type UploadNodeFiles } from '../src/client/NodeFileAttachments.tsx';
import { translateZh } from '../src/client/locales.ts';
import type { WorkflowNodeAttachment } from '../src/shared/model.ts';

let root:Root;let container:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
const nodeId='file-task';
const uploaded:WorkflowNodeAttachment={id:'native-file-1',file:{attachmentId:`sha256:${'a'.repeat(64)}`,name:'verified.txt',bytes:15},createdAt:1};
type Props=Parameters<typeof NodeFileAttachments>[0];
const render=(props:Partial<Props>={})=>act(async()=>root.render(createElement(NodeFileAttachments,{nodeId,t:translateZh,...props})));
async function choose(files:File[]){await act(async()=>{const input=container.querySelector('input')!;Object.defineProperty(input,'files',{value:files,configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));});}
const button=(id:string)=>container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

describe('Native-backed task file UI',()=>{
  it('transfers an ordered multi-file selection with progress and renders only confirmed native references',async()=>{
    let report:((progress:NodeFileUploadProgress)=>void)|undefined;let complete!:()=>void;
    const onUploadFiles=vi.fn<UploadNodeFiles>((_id,_files,_signal,onProgress)=>{report=onProgress;return new Promise<void>(resolve=>{complete=resolve;});});const onBusyChange=vi.fn();
    await render({onUploadFiles,onBusyChange});expect(container.querySelector('input')?.multiple).toBe(true);
    const files=[new File(['first bytes'],'first.txt'),new File(['second bytes'],'second.txt')];await choose(files);
    expect(onUploadFiles.mock.calls[0]?.slice(0,2)).toEqual([nodeId,files]);expect(onUploadFiles.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);
    expect(container.querySelectorAll('li')).toHaveLength(0);expect(onBusyChange).toHaveBeenLastCalledWith(true);expect(button(`attach-files-${nodeId}`).disabled).toBe(true);
    await act(async()=>report?.({loaded:6,total:12,index:1,count:2}));expect(container.querySelector('[role="status"]')?.textContent).toContain('2/2');expect(container.querySelector('[role="status"]')?.textContent).toContain('second.txt');expect(container.querySelector('progress')?.value).toBe(6);
    await act(async()=>complete());expect(onBusyChange).toHaveBeenLastCalledWith(false);expect(container.querySelectorAll('li')).toHaveLength(0);
    await render({onUploadFiles,attachments:[uploaded]});expect(container.querySelector('li')?.textContent).toContain('verified.txt');expect(container.querySelector('li')?.textContent).toContain('15 B');
  });
  it('keeps failed Files retryable without pretending they were attached and cancels with AbortSignal',async()=>{
    let reject!: (cause:Error)=>void;let signal:AbortSignal|undefined;
    const onUploadFiles=vi.fn<UploadNodeFiles>((_id,_files,uploadSignal)=>{signal=uploadSignal;return new Promise<void>((_resolve,no)=>{reject=no;uploadSignal?.addEventListener('abort',()=>no(new Error('aborted')),{once:true});});});
    await render({onUploadFiles});const file=new File(['bytes'],'retry.txt');await choose([file]);await act(async()=>reject(new Error('Native upload failed')));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Native upload failed');expect(container.querySelectorAll('li')).toHaveLength(0);
    await act(async()=>button(`retry-upload-${nodeId}`).click());expect(onUploadFiles.mock.calls[1]?.[1]).toEqual([file]);await act(async()=>button(`cancel-upload-${nodeId}`).click());expect(signal?.aborted).toBe(true);expect(container.querySelector('[role="alert"]')?.textContent).toContain('上传已取消');
  });
  it('removes by native reference identity and preserves read-only source or active attachments',async()=>{
    const onRemoveFile=vi.fn(async()=>{});await render({attachments:[uploaded],onRemoveFile});await act(async()=>button(`remove-file-${uploaded.id}`).click());expect(onRemoveFile).toHaveBeenCalledExactlyOnceWith(nodeId,uploaded.id);
    expect(container.querySelectorAll('li')).toHaveLength(1); // Host props own successful metadata updates.
    await render({attachments:[uploaded],readOnly:true,onRemoveFile});expect(container.querySelector('input')).toBeNull();expect(button(`remove-file-${uploaded.id}`)).toBeNull();expect(container.querySelector('li')?.textContent).toContain('verified.txt');
    await render({readOnly:true});expect(container.childElementCount).toBe(0);
  });
  it('aborts an unfinished transfer on unmount and releases the node interaction lock',async()=>{
    let signal:AbortSignal|undefined;const onBusyChange=vi.fn();const onUploadFiles=vi.fn<UploadNodeFiles>(async(_id,_files,value)=>{signal=value;await new Promise<void>(resolve=>value?.addEventListener('abort',()=>resolve(),{once:true}));});
    await render({onUploadFiles,onBusyChange});await choose([new File(['bytes'],'pending.txt')]);expect(signal?.aborted).toBe(false);await act(async()=>root.render(null));expect(signal?.aborted).toBe(true);expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it('lets canvas undo and clipboard shortcuts reach the panel from a file button without propagating its activation key',async()=>{
    const onKeyDown=vi.fn();await act(async()=>root.render(createElement('div',{onKeyDown},createElement(NodeFileAttachments,{nodeId,t:translateZh,attachments:[uploaded],onRemoveFile:async()=>{}}))));
    const remove=button(`remove-file-${uploaded.id}`);for(const key of ['z','y','c','v','x'])await act(async()=>remove.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key,ctrlKey:true})));
    expect(onKeyDown).toHaveBeenCalledTimes(5);await act(async()=>remove.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter'})));expect(onKeyDown).toHaveBeenCalledTimes(5);
  });
  it('opens the task editor from blank attachment-wrapper space while keeping file items and upload controls isolated',async()=>{
    const onDoubleClick=vi.fn();await act(async()=>root.render(createElement('div',{onDoubleClick},createElement(NodeFileAttachments,{nodeId,t:translateZh,attachments:[uploaded],onRemoveFile:async()=>{},onUploadFiles:async()=>{}}))));
    const wrapper=container.querySelector<HTMLElement>(`[data-testid="node-files-${nodeId}"]`)!;await act(async()=>wrapper.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));expect(onDoubleClick).toHaveBeenCalledOnce();
    for(const target of [container.querySelector('li')!,button(`attach-files-${nodeId}`),button(`remove-file-${uploaded.id}`),container.querySelector('input')!])await act(async()=>target.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));
    expect(onDoubleClick).toHaveBeenCalledOnce();
  });
});
