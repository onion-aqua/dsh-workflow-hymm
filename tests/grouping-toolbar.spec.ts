// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasGroups } from '../src/client/GroupingToolbar.tsx';
import { translateZh } from '../src/client/locales.ts';

let root:Root,container:HTMLDivElement;let frames:Map<number,FrameRequestCallback>;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});frames=new Map();let nextFrame=0;vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++nextFrame,callback);return nextFrame;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));container=document.createElement('div');document.body.append(container);root=createRoot(container);Object.defineProperty(HTMLElement.prototype,'setPointerCapture',{configurable:true,value:vi.fn()});Object.defineProperty(HTMLElement.prototype,'hasPointerCapture',{configurable:true,value:()=>false});Object.defineProperty(HTMLElement.prototype,'releasePointerCapture',{configurable:true,value:vi.fn()});});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
function pointer(type:string,x=10,y=10){return new PointerEvent(type,{pointerId:1,pointerType:'mouse',button:0,clientX:x,clientY:y,bubbles:true,cancelable:true});}
const group={id:'group',title:'TEST Group',nodeIds:['a','b']};
const callbacks=()=>({onSelect:vi.fn(()=>true),onRename:vi.fn(),onUngroup:vi.fn(),onDragStart:vi.fn(()=>true),onDragMove:vi.fn(),onDragEnd:vi.fn()});
async function render(actions:ReturnType<typeof callbacks>){await act(async()=>root.render(createElement(CanvasGroups,{groups:[group],nodes:[{id:'a',position:{x:10,y:20}},{id:'b',position:{x:400,y:20}}],selectedNodeIds:new Set<string>(),busy:false,viewport:{x:0,y:0,zoom:.5},...actions,t:translateZh})));}

describe('Group title pointer interactions',()=>{
  it('keeps ordinary clicks uncaptured so double-click rename remains reachable and does not save positions',async()=>{
    const actions=callbacks();await render(actions);const title=container.querySelector<HTMLElement>('[data-testid="group-title-group"]')!;await act(async()=>{title.dispatchEvent(pointer('pointerdown'));title.dispatchEvent(pointer('pointerup'));});expect(HTMLElement.prototype.setPointerCapture).not.toHaveBeenCalled();expect(actions.onDragEnd).toHaveBeenCalledExactlyOnceWith(true);expect(actions.onDragMove).not.toHaveBeenCalled();
    await act(async()=>title.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));expect(container.querySelector('[data-testid="group-name-input-group"]')).not.toBeNull();expect(document.activeElement).toBe(container.querySelector('input'));
  });
  it('tracks a drag beyond the label, captures after movement and converts screen distance through zoom',async()=>{
    const actions=callbacks();await render(actions);const title=container.querySelector<HTMLElement>('[data-testid="group-title-group"]')!;await act(async()=>title.dispatchEvent(pointer('pointerdown',10,10)));await act(async()=>document.dispatchEvent(pointer('pointermove',60,35)));expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledExactlyOnceWith(1);expect(actions.onDragMove).not.toHaveBeenCalled();expect(frames.size).toBe(1);await act(async()=>document.dispatchEvent(pointer('pointerup',60,35)));expect(actions.onDragMove).toHaveBeenCalledExactlyOnceWith({x:100,y:50});expect(actions.onDragEnd).toHaveBeenCalledExactlyOnceWith(false);expect(frames.size).toBe(0);
    await act(async()=>document.dispatchEvent(pointer('pointermove',120,100)));expect(actions.onDragMove).toHaveBeenCalledTimes(1);
  });
});
