// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const harness=vi.hoisted(()=>({nodes:[] as any[],viewport:{x:0,y:0,zoom:1}}));
vi.mock('@xyflow/react',()=>({useNodes:()=>harness.nodes,useViewport:()=>harness.viewport,useReactFlow:()=>({getInternalNode:()=>undefined})}));
import { CanvasTracePanels } from '../src/client/CanvasTracePanels.tsx';
import type { WorkflowRuntimeProps } from '../src/client/ui-contract.ts';
import { translateZh } from '../src/client/locales.ts';

let root:Root,container:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);harness.viewport={x:0,y:0,zoom:1};harness.nodes=['a','b'].map((id,index)=>({id,position:{x:100+index*650,y:100},width:300,height:210,data:{task:{id,displayId:index+1,title:`Native ${id}`,instruction:'Task',kind:'task'},collapsed:false}}));});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
function runtime():WorkflowRuntimeProps{return {executions:['a','b'].map(id=>({runId:`run-${id}`,nodeId:id,nodeRevision:1,branchId:'main',sessionId:`session-${id}`,status:'completed',createdAt:1,updatedAt:1})),traces:{'run-a':{runId:'run-a',status:'completed',steps:[{id:'a',title:'Native A',type:'agent_step',status:'completed'}]},'run-b':{runId:'run-b',status:'completed',steps:[{id:'b',title:'Native B',type:'agent_step',status:'completed'}]}},onWatchTraceRuns:vi.fn(),onReadStep:vi.fn()};}
async function render(extra:Partial<Parameters<typeof CanvasTracePanels>[0]>={}){await act(async()=>root.render(createElement(CanvasTracePanels,{focusedNodeId:null,traceNodeId:null,size:{width:2000,height:1400},selectedRunId:null,runtime:runtime(),pins:{a:{runId:'run-a'},b:{runId:'run-b'}},onOpen:()=>{},onClose:()=>{},onClosePin:()=>{},onTogglePin:()=>{},onSelectRun:()=>{},onSelectPinnedRun:()=>{},t:translateZh,...extra})));}
describe('Pinned execution trace panels',()=>{
  it('keeps two separate native execution traces visible without node focus and watches both run identities',async()=>{
    const adapter=runtime();await render({runtime:adapter});expect(container.querySelectorAll('[data-testid=trace-panel]')).toHaveLength(2);expect(adapter.onWatchTraceRuns).toHaveBeenLastCalledWith(['run-a','run-b']);expect(container.textContent).toContain('#1 · Native a');expect(container.textContent).toContain('#2 · Native b');await render({runtime:adapter,focusedNodeId:'b'});expect(container.querySelectorAll('[data-testid=trace-panel]')).toHaveLength(2);expect(container.querySelectorAll('.wf-trace-loading')).toHaveLength(0);
  });
  it('drags a panel by its header without changing graph geometry or the other pinned panel',async()=>{
    await render();const position=container.querySelector<HTMLElement>('[data-testid=trace-position-a]')!,other=container.querySelector<HTMLElement>('[data-testid=trace-position-b]')!,before={left:parseFloat(position.style.left),top:parseFloat(position.style.top)},otherBefore=other.style.cssText,nodesBefore=structuredClone(harness.nodes);const header=position.querySelector<HTMLElement>('.wf-trace-header')!;await act(async()=>header.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:7,clientX:100,clientY:100,bubbles:true})));await act(async()=>document.dispatchEvent(new PointerEvent('pointermove',{pointerId:7,clientX:180,clientY:150,bubbles:true})));await act(async()=>document.dispatchEvent(new PointerEvent('pointerup',{pointerId:7,bubbles:true})));expect(parseFloat(position.style.left)).toBe(before.left+80);expect(parseFloat(position.style.top)).toBe(before.top+50);expect(other.style.cssText).toBe(otherBefore);expect(harness.nodes).toEqual(nodesBefore);
  });
  it('places its pin on the execution panel and toggles the exact displayed run',async()=>{
    const onTogglePin=vi.fn(),onClosePin=vi.fn();await render({onTogglePin,onClosePin});
    const pin=container.querySelector<HTMLButtonElement>('[data-testid=trace-pin-a]')!;
    expect(pin.parentElement?.getAttribute('data-testid')).toBe('trace-position-a');
    expect(pin.getAttribute('aria-pressed')).toBe('true');expect(pin.getAttribute('aria-label')).toBe('取消固定执行轨迹');
    await act(async()=>pin.click());expect(onTogglePin).toHaveBeenCalledExactlyOnceWith('a','run-a');expect(onClosePin).not.toHaveBeenCalled();
    await act(async()=>pin.parentElement!.querySelector<HTMLButtonElement>('[data-testid=trace-close]')!.click());expect(onClosePin).toHaveBeenCalledExactlyOnceWith('a');
  });
  it('retains dragged coordinates while the same visible execution changes between pinned and unpinned',async()=>{
    const adapter=runtime();await render({runtime:adapter,pins:{},focusedNodeId:'a',traceNodeId:'a',selectedRunId:'run-a'});
    const panel=container.querySelector<HTMLElement>('[data-testid=trace-position-a]')!;
    const header=panel.querySelector<HTMLElement>('.wf-trace-header')!;
    await act(async()=>header.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:9,clientX:100,clientY:100,bubbles:true})));
    await act(async()=>document.dispatchEvent(new PointerEvent('pointermove',{pointerId:9,clientX:220,clientY:150,bubbles:true})));
    await act(async()=>document.dispatchEvent(new PointerEvent('pointerup',{pointerId:9,bubbles:true})));
    const moved={left:panel.style.left,top:panel.style.top};
    await render({runtime:adapter,pins:{a:{runId:'run-a'}},focusedNodeId:'a',traceNodeId:'a',selectedRunId:'run-a'});
    expect(container.querySelector('[data-testid=trace-position-a]')).toBe(panel);expect({left:panel.style.left,top:panel.style.top}).toEqual(moved);
    await render({runtime:adapter,pins:{},focusedNodeId:'a',traceNodeId:'a',selectedRunId:'run-a'});
    expect(container.querySelector('[data-testid=trace-position-a]')).toBe(panel);expect({left:panel.style.left,top:panel.style.top}).toEqual(moved);
    expect(panel.querySelector('[data-testid=trace-pin-a]')?.getAttribute('aria-pressed')).toBe('false');
  });
  it('pins an explicitly selected historical run rather than replacing it with the latest execution',async()=>{
    const adapter=runtime(),onTogglePin=vi.fn();adapter.executions=[...adapter.executions!,{...adapter.executions![0]!,runId:'new-run-a',createdAt:2}];
    await render({runtime:adapter,pins:{},focusedNodeId:'a',traceNodeId:'a',selectedRunId:'run-a',onTogglePin});
    await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid=trace-pin-a]')!.click());
    expect(onTogglePin).toHaveBeenCalledExactlyOnceWith('a','run-a');
  });
  it('positions an unpinned default panel below its execution entry when space permits',async()=>{
    await render({pins:{},focusedNodeId:'a',traceNodeId:'a',selectedRunId:'run-a'});const entry=container.querySelector<HTMLElement>('[data-testid=trace-entry]')!,panel=container.querySelector<HTMLElement>('[data-testid=trace-position-a]')!;expect(parseFloat(panel.style.top)).toBeGreaterThan(parseFloat(entry.style.top));expect(container.querySelectorAll('[data-testid=trace-panel]')).toHaveLength(1);
  });
  it('anchors a dragged pin to canvas coordinates across pan, zoom and viewport resize without clamping it to the screen',async()=>{
    await render({pins:{a:{runId:'run-a'}}});
    const panel=container.querySelector<HTMLElement>('[data-testid=trace-position-a]')!;
    const initial={x:parseFloat(panel.style.left),y:parseFloat(panel.style.top),width:panel.style.width,height:panel.style.maxHeight};
    expect(panel.dataset.coordinateSpace).toBe('canvas');
    harness.viewport={x:-1800,y:-1500,zoom:.5};await render({pins:{a:{runId:'run-a'}},size:{width:1000,height:700}});
    expect(parseFloat(panel.style.left)).toBeCloseTo(initial.x*.5-1800);expect(parseFloat(panel.style.top)).toBeCloseTo(initial.y*.5-1500);
    expect(panel.style.transform).toBe('scale(0.5)');expect(panel.style.width).toBe(initial.width);expect(panel.style.maxHeight).toBe(initial.height);
    harness.viewport={x:0,y:0,zoom:1};await render({pins:{a:{runId:'run-a'}}});
    expect(parseFloat(panel.style.left)).toBe(initial.x);expect(parseFloat(panel.style.top)).toBe(initial.y);
  });
  it('preserves layout at non-unit zoom when pinning, converts pinned drag deltas and unpins without a visual jump',async()=>{
    harness.viewport={x:20,y:30,zoom:.5};
    const adapter=runtime(),focus={runtime:adapter,focusedNodeId:'a',traceNodeId:'a',selectedRunId:'run-a'};
    await render({...focus,pins:{}});const panel=container.querySelector<HTMLElement>('[data-testid=trace-position-a]')!;
    const before={left:panel.style.left,top:panel.style.top,width:panel.style.width,height:panel.style.maxHeight};
    await render({...focus,pins:{a:{runId:'run-a'}}});
    expect({left:panel.style.left,top:panel.style.top,width:panel.style.width,height:panel.style.maxHeight}).toEqual(before);expect(panel.style.transform).toBe('');
    harness.viewport={x:20,y:30,zoom:1};await render({...focus,pins:{a:{runId:'run-a'}}});
    expect(panel.style.transform).toBe('scale(2)');const left=parseFloat(panel.style.left),top=parseFloat(panel.style.top);
    const header=panel.querySelector<HTMLElement>('.wf-trace-header')!;
    await act(async()=>header.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:17,clientX:200,clientY:300,bubbles:true})));
    await act(async()=>document.dispatchEvent(new PointerEvent('pointermove',{pointerId:17,clientX:260,clientY:340,bubbles:true})));
    await act(async()=>document.dispatchEvent(new PointerEvent('pointerup',{pointerId:17,bubbles:true})));
    expect(parseFloat(panel.style.left)).toBeCloseTo(left+60);expect(parseFloat(panel.style.top)).toBeCloseTo(top+40);
    // Move back to its original viewport before testing the floating panel's visibility bounds.
    harness.viewport={x:20,y:30,zoom:.5};await render({...focus,pins:{a:{runId:'run-a'}}});
    const pinned={left:panel.style.left,top:panel.style.top,transform:panel.style.transform,width:panel.style.width};
    await render({...focus,pins:{}});expect({left:panel.style.left,top:panel.style.top,transform:panel.style.transform,width:panel.style.width}).toEqual(pinned);
    expect(panel.dataset.coordinateSpace).toBe('screen');harness.viewport={x:160,y:190,zoom:.7};await render({...focus,pins:{}});
    expect({left:panel.style.left,top:panel.style.top,transform:panel.style.transform,width:panel.style.width}).toEqual(pinned);
  });
});
