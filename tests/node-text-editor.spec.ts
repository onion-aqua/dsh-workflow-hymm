// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeTextEditor, type NodeTextEditorProps } from '../src/client/NodeTextEditor.tsx';
import { MarkdownContent, safeMarkdownHref } from '../src/client/MarkdownContent.tsx';
import { translateZh } from '../src/client/locales.ts';

let root:Root;let container:HTMLDivElement;
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const rect=()=>({left:0,right:0,top:0,bottom:0,width:0,height:0,x:0,y:0,toJSON:()=>({})});
  if(!Range.prototype.getBoundingClientRect)Range.prototype.getBoundingClientRect=rect;
  if(!Range.prototype.getClientRects)Range.prototype.getClientRects=()=>[] as unknown as DOMRectList;
  if(!HTMLElement.prototype.scrollIntoView)HTMLElement.prototype.scrollIntoView=()=>{};
  container=document.createElement('div');container.className='dsh-workflow';document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
const defaults:NodeTextEditorProps={title:'TEST node title',instruction:'TEST instruction',onSave:()=>{},onClose:()=>{},t:translateZh};
const editor=()=>container.querySelector<HTMLDivElement>('[data-testid="editor-text"]')!;
const instance=()=>(editor() as HTMLDivElement&{editor:Editor}).editor;
const source=()=>container.querySelector<HTMLTextAreaElement>('[data-testid="editor-source"]')!;
const button=(id:string)=>container.querySelector<HTMLButtonElement>(`[data-testid="editor-${id}"]`)!;
const render=(extra:Partial<NodeTextEditorProps>={})=>act(async()=>{root.render(createElement(NodeTextEditor,{...defaults,...extra}));await new Promise(resolve=>setTimeout(resolve,25));});
const click=(id:string)=>act(async()=>button(id).click());
const key=(key:string,extra:KeyboardEventInit={})=>act(async()=>editor().dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key,...extra})));
const select=(start:number,end:number)=>act(async()=>{instance().commands.setTextSelection({from:start+1,to:end+1});});
const typeText=(value:string)=>act(async()=>{instance().commands.setContent({type:'doc',content:[{type:'paragraph',content:value?[{type:'text',text:value}]:[]}]});});
const sourceText=(value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(source(),value);source().dispatchEvent(new Event('input',{bubbles:true}));});

describe('Visual Markdown node editor',()=>{
  it('visibly formats selected text and saves portable Markdown with local undo/redo',async()=>{
    const onSave=vi.fn();await render({instruction:'one two',onSave});
    expect(editor().getAttribute('contenteditable')).toBe('true');expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    await select(0,3);await click('bold');expect(editor().querySelector('strong')?.textContent).toBe('one');expect(editor().textContent).toBe('one two');expect(button('bold').getAttribute('aria-pressed')).toBe('true');
    await click('undo');expect(editor().querySelector('strong')).toBeNull();await click('redo');expect(editor().querySelector('strong')?.textContent).toBe('one');
    await select(4,7);await click('italic');expect(editor().querySelector('em')?.textContent).toBe('two');
    await key('Enter',{ctrlKey:true});expect(onSave).toHaveBeenCalledExactlyOnceWith('**one** *two*');
  });
  it('applies real headings, list items, code and links without inserting marker characters',async()=>{
    await render({instruction:'one two'});await select(0,3);await click('heading');expect(editor().querySelector('h2')?.textContent).toBe('one two');
    await click('heading');await click('bullet');expect(editor().querySelector('ul li')?.textContent).toBe('one two');await click('bullet');
    await select(4,7);await click('code');expect(editor().querySelector('code')?.textContent).toBe('two');await click('code');
    await select(0,3);await click('link');const url=container.querySelector<HTMLInputElement>('[data-testid="editor-link-url"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(url,'https://example.com/docs');url.dispatchEvent(new Event('input',{bubbles:true}));});
    await click('link-apply');expect(editor().querySelector('a')?.textContent).toBe('one');expect(editor().querySelector('a')?.getAttribute('href')).toBe('https://example.com/docs');
  });
  it('preserves exact untouched Markdown and switches to an editable source view without losing tables or images',async()=>{
    const markdown='## Title\n\n| A | B |\n| --- | --- |\n| **one** | [two](https://example.com) |\n\n![photo](https://example.com/no-fetch.png)';
    const onSave=vi.fn();await render({instruction:markdown,onSave});expect(editor().querySelector('table')).not.toBeNull();expect(editor().querySelector('img[src]')).toBeNull();expect(editor().querySelector('.wf-markdown-image')?.textContent).toContain('photo');
    await click('save');expect(onSave).toHaveBeenLastCalledWith(markdown);
    await click('mode-source');expect(source().value).toBe(markdown);await sourceText(markdown+'\n\nnew paragraph');await click('mode-visual');expect(editor().querySelectorAll('table')).toHaveLength(1);expect(editor().textContent).toContain('new paragraph');
    await click('mode-source');expect(source().value).toBe(markdown+'\n\nnew paragraph');await click('undo');expect(source().value).toBe(markdown+'\n\nnew paragraph');
    // A visual edit serializes through the native table/image Markdown extensions.
    await click('mode-visual');await act(async()=>{instance().commands.insertContentAt(instance().state.doc.content.size,{type:'paragraph',content:[{type:'text',text:'end'}]});});await click('save');
    const saved=onSave.mock.lastCall![0] as string;expect(saved).toMatch(/\| A\s+\| B\s+\|/);expect(saved).toContain('![photo](https://example.com/no-fetch.png)');expect(saved).toContain('end');
  });
  it('rejects a formatting transaction over 20,000 Markdown characters without corrupting history',async()=>{
    const text='a'.repeat(20000);const onSave=vi.fn();await render({instruction:text,onSave});await select(0,4);await click('bold');
    expect(editor().textContent).toBe(text);expect(editor().querySelector('strong')).toBeNull();expect(button('undo').disabled).toBe(true);expect(container.querySelector('[role="alert"]')?.textContent).toBe(translateZh('editorTooLong'));
    await typeText('a'.repeat(19996));await select(0,4);await click('bold');expect(editor().querySelector('strong')?.textContent).toBe('aaaa');await click('save');expect(onSave).toHaveBeenCalledExactlyOnceWith('**aaaa**'+'a'.repeat(19992));
  });
  it('preserves task checkboxes and reference image destinations after visual edits',async()=>{
    const onSave=vi.fn();await render({instruction:'- [x] finished\n- [ ] remaining\n\n![diagram][asset]\n\n[asset]: https://example.com/image.png "Diagram"',onSave});
    expect(editor().querySelectorAll('input[type="checkbox"]')).toHaveLength(2);expect(editor().querySelectorAll('input:checked')).toHaveLength(1);
    await act(async()=>{instance().commands.insertContentAt(instance().state.doc.content.size,{type:'paragraph',content:[{type:'text',text:'added'}]});});await click('save');
    const saved=onSave.mock.lastCall![0] as string;expect(saved).toContain('- [x] finished');expect(saved).toContain('- [ ] remaining');expect(saved).toContain('![diagram](https://example.com/image.png "Diagram")');
  });
  it('preserves unsaved content through refreshed props, conflict errors, IME shortcuts and cancel',async()=>{
    const onSave=vi.fn(),onClose=vi.fn();await render({instruction:'original',onSave,onClose});await select(0,8);await click('bold');
    await render({instruction:'new server revision',error:'TEST revision conflict',onSave,onClose});
    expect(editor().querySelector('strong')?.textContent).toBe('original');expect(container.querySelector('[role="alert"]')?.textContent).toBe('TEST revision conflict');
    await key('Escape',{isComposing:true});await key('Enter',{ctrlKey:true,isComposing:true});expect(onClose).not.toHaveBeenCalled();expect(onSave).not.toHaveBeenCalled();
    await key('Escape');expect(onClose).toHaveBeenCalledOnce();expect(onSave).not.toHaveBeenCalled();
  });
  it('traps focus, restores it on unmount, maximizes and changes editor font zoom',async()=>{
    const previous=document.createElement('button');document.body.append(previous);previous.focus();await render();
    // Tiptap focuses in requestAnimationFrame; wait for mounting autofocus to
    // finish before moving focus through the modal's own keyboard controls.
    await vi.waitFor(()=>expect(document.activeElement).toBe(editor()));
    await click('maximize');expect(container.querySelector('.wf-text-editor.is-maximized')).not.toBeNull();await click('maximize');expect(container.querySelector('.wf-text-editor.is-maximized')).toBeNull();
    await click('font-increase');expect(container.querySelector<HTMLElement>('.wf-rich-editor-wrap')?.style.fontSize).toBe('15px');await click('font-decrease');expect(container.querySelector<HTMLElement>('.wf-rich-editor-wrap')?.style.fontSize).toBe('14px');
    const first=button('maximize'),last=button('save');await act(async()=>{first.focus();first.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Tab',shiftKey:true}));});expect(document.activeElement).toBe(last);
    await act(async()=>last.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Tab'})));expect(document.activeElement).toBe(first);
    await act(async()=>root.render(null));expect(document.activeElement).toBe(previous);previous.remove();
  });
  it('keeps source/running text read only while allowing inspection and closing',async()=>{
    const onSave=vi.fn(),onClose=vi.fn();await render({readOnly:true,onSave,onClose});expect(editor().getAttribute('contenteditable')).toBe('false');expect(button('bold').disabled).toBe(true);expect(button('save')).toBeNull();
    await select(0,4);await key('b',{ctrlKey:true});expect(editor().querySelector('strong')).toBeNull();expect(editor().textContent).toBe(defaults.instruction);
    await click('mode-source');expect(source().readOnly).toBe(true);await key('Enter',{ctrlKey:true});expect(onSave).not.toHaveBeenCalled();await click('cancel');expect(onClose).toHaveBeenCalledOnce();
  });
  it('retains the draft after asynchronous failures and blocks duplicate saves',async()=>{
    let rejectSave:(error:Error)=>void=()=>{};const onSave=vi.fn(()=>new Promise<void>((_resolve,reject)=>{rejectSave=reject;}));
    await render({onSave});await select(0,4);await click('bold');await click('save');expect(button('save').disabled).toBe(true);expect(editor().getAttribute('contenteditable')).toBe('false');await key('Enter',{ctrlKey:true});expect(onSave).toHaveBeenCalledOnce();
    await act(async()=>rejectSave(new Error('TEST save conflict')));expect(button('save').disabled).toBe(false);expect(editor().querySelector('strong')?.textContent).toBe('TEST');expect(container.querySelector('[role="alert"]')?.textContent).toBe('TEST save conflict');
  });
  it('never creates executable raw HTML, active unsafe links, or remote image elements',async()=>{
    const markdown='<img src="https://example.com/tracker" onerror="alert(1)">\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29) ![secret](https://example.com/secret)';
    const onSave=vi.fn();await render({instruction:markdown,onSave});expect(editor().querySelector('img[src],script,iframe,object')).toBeNull();expect(editor().querySelector('a[href^="javascript:"]')).toBeNull();expect(editor().textContent).toContain('<script>alert(1)</script>');
    expect(()=>instance().state.doc.check()).not.toThrow();await act(async()=>{instance().commands.insertContentAt(instance().state.doc.content.size,{type:'paragraph',content:[{type:'text',text:'safe edit'}]});});await click('save');expect(onSave.mock.lastCall![0]).toContain('safe edit');
    await act(async()=>root.render(createElement(MarkdownContent,{source:markdown})));expect(container.querySelector('img,script,iframe,object,a[href^="javascript:"]')).toBeNull();expect(container.textContent).toContain('<img');
    expect(safeMarkdownHref('javascript:alert(1)')).toBeNull();expect(safeMarkdownHref('data:text/html,hi')).toBeNull();expect(safeMarkdownHref('file:///C:/private')).toBeNull();expect(safeMarkdownHref(' https://example.com ')).toBe('https://example.com');
  });
});
