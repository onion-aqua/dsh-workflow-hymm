// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowNode, WorkflowPendingQuestion } from '../src/shared/model.ts';
const harness=vi.hoisted(()=>({nodes:[] as any[],viewport:{x:0,y:0,zoom:1}}));
vi.mock('@xyflow/react',()=>({useNodes:()=>harness.nodes,useViewport:()=>harness.viewport}));
import { CanvasQuestions } from '../src/client/CanvasQuestions.tsx';
import { translateZh } from '../src/client/locales.ts';
import type { WorkflowRuntimeProps } from '../src/client/ui-contract.ts';

let root:Root,container:HTMLDivElement;
const task=(id:string):WorkflowNode=>({id,title:`Native task ${id}`,instruction:'TEST question task',source:'user',status:'waiting_answer',revision:1,position:{x:180,y:200}});
const request=(nodeId='a',callId='call'):WorkflowPendingQuestion=>({workflowId:'workflow',runId:`run-${nodeId}`,nodeId,sessionId:`session-${nodeId}`,callId,createdAt:1,state:'open',actionable:true,questions:[{id:'q',question:`Native question ${nodeId}`,options:[{label:'One'},{label:'Two'}]}]});
const size={width:1500,height:950};
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});harness.nodes=[{id:'a',position:{x:180,y:200},width:300,height:210},{id:'b',position:{x:750,y:200},width:300,height:210}];harness.viewport={x:0,y:0,zoom:1};container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
async function render(runtime:WorkflowRuntimeProps,reveal?:{nodeId:string;token:number}){await act(async()=>root.render(createElement(CanvasQuestions,{runtime,tasks:[task('a'),task('b')],size,reveal,t:translateZh})));}
const visible=()=>[...container.querySelectorAll('.wf-question-position')].filter(panel=>!panel.hasAttribute('hidden'));

describe('Canvas questions and focus independence',()=>{
  it('opens real questions without focusing or changing graph coordinates and preserves drafts across polling',async()=>{
    const outside=document.createElement('textarea');document.body.append(outside);outside.focus();const before=structuredClone(harness.nodes);await render({pendingQuestions:[request()],onAnswerQuestion:async()=>{}});expect(visible()).toHaveLength(1);expect(document.activeElement).toBe(outside);expect(harness.nodes).toEqual(before);const second=container.querySelectorAll<HTMLInputElement>('.wf-question-option input')[1]!;await act(async()=>second.click());await render({pendingQuestions:[{...request(),createdAt:5}],onAnswerQuestion:async()=>{}});expect(container.querySelectorAll<HTMLInputElement>('.wf-question-option input')[1]!.checked).toBe(true);expect(harness.nodes).toEqual(before);outside.remove();
  });
  it('keeps questions available when their node is outside the current branch and never pans to it',async()=>{
    const before={...harness.viewport};harness.nodes=[];await render({pendingQuestions:[request()],onAnswerQuestion:async()=>{}});expect(visible()).toHaveLength(1);expect(container.textContent).toContain('其他分支');expect(container.textContent).toContain('Native task a');expect(harness.viewport).toEqual(before);
  });
  it('hides locally without discarding its answer and reopens from a node reminder or inbox',async()=>{
    const runtime={pendingQuestions:[request()],onAnswerQuestion:async()=>{}};await render(runtime);await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid=question-close]')!.click());expect(visible()).toHaveLength(0);expect(container.querySelector('[data-testid=question-panel]')).not.toBeNull();await render(runtime,{nodeId:'a',token:1});expect(visible()).toHaveLength(1);await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid=question-close]')!.click());await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid=question-inbox]')!.click());expect(visible()).toHaveLength(1);
  });
  it('renders independent simultaneous requests and retains existing panels on refresh errors',async()=>{
    await render({pendingQuestions:[request('a','first'),request('b','second')],questionLoadError:'Native read interrupted',onAnswerQuestion:async()=>{}});expect(visible()).toHaveLength(2);expect(container.querySelectorAll('[data-testid=question-panel]')).toHaveLength(2);expect(container.textContent).toContain('Native read interrupted');const positions=visible().map(element=>(element as HTMLElement).style.cssText);expect(positions[0]).not.toBe(positions[1]);
  });
});
