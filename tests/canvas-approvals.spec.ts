// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowNode, WorkflowPendingApproval } from '../src/shared/model.ts';
const harness=vi.hoisted(()=>({nodes:[] as any[],viewport:{x:0,y:0,zoom:1}}));
vi.mock('@xyflow/react',()=>({useNodes:()=>harness.nodes,useViewport:()=>harness.viewport}));
import { CanvasApprovals, approvalRequestKey } from '../src/client/CanvasApprovals.tsx';
import { translateZh } from '../src/client/locales.ts';
import type { WorkflowRuntimeProps } from '../src/client/ui-contract.ts';
let root:Root,container:HTMLDivElement;
const task=(id:string):WorkflowNode=>({id,title:`Native task ${id}`,instruction:'TEST approval task',source:'user',status:'blocked',revision:1,position:{x:180,y:200}});
const request=(nodeId='a',approvalId='approval'):WorkflowPendingApproval=>({workflowId:'workflow',runId:`run-${nodeId}`,nodeId,sessionId:`session-${nodeId}`,approvalId,toolName:'bash',command:`echo native ${nodeId}`,createdAt:1,actionable:true});
const size={width:1500,height:950};
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});harness.nodes=[{id:'a',position:{x:180,y:200},width:300,height:210},{id:'b',position:{x:750,y:200},width:300,height:210}];harness.viewport={x:0,y:0,zoom:1};container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
async function render(runtime:WorkflowRuntimeProps,reveal?:{nodeId:string;token:number}){await act(async()=>root.render(createElement(CanvasApprovals,{runtime,tasks:[task('a'),task('b')],size,reveal,t:translateZh})));}
const visible=()=>[...container.querySelectorAll<HTMLElement>('.wf-approval-position')].filter(panel=>!panel.hasAttribute('hidden'));
describe('Canvas native approval waits',()=>{
  it('keeps simultaneous branch approvals independent without changing focus, graph or viewport',async()=>{const outside=document.createElement('textarea');document.body.append(outside);outside.focus();const before=structuredClone(harness),onDecideApproval=vi.fn(async()=>{}),first=request('a','first'),second=request('b','second');await render({pendingApprovals:[first,second],onDecideApproval,submittingApprovalKeys:[approvalRequestKey(first)]});expect(visible()).toHaveLength(2);expect(document.activeElement).toBe(outside);expect(harness).toEqual(before);const panels=container.querySelectorAll('[data-testid=approval-panel]');expect(panels[0]!.querySelector<HTMLButtonElement>('[data-testid=approval-allow]')!.disabled).toBe(true);await act(async()=>panels[1]!.querySelector<HTMLButtonElement>('[data-testid=approval-reject]')!.click());expect(onDecideApproval).toHaveBeenCalledExactlyOnceWith(second,'rejected');expect(visible()[0]!.style.cssText).not.toBe(visible()[1]!.style.cssText);outside.remove();});
  it('hides locally, restores by node or inbox and keeps other branches available during read failures',async()=>{const runtime:WorkflowRuntimeProps={pendingApprovals:[request()],onDecideApproval:async()=>{}};await render(runtime);await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid=approval-close]')!.click());expect(visible()).toHaveLength(0);await render(runtime,{nodeId:'a',token:1});expect(visible()).toHaveLength(1);await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid=approval-close]')!.click());await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid=approval-inbox]')!.click());expect(visible()).toHaveLength(1);harness.nodes=[];await render({...runtime,approvalLoadError:'Native connection interrupted'});expect(visible()).toHaveLength(1);expect(container.textContent).toContain('其他分支');expect(container.textContent).toContain('Native connection interrupted');});
});
