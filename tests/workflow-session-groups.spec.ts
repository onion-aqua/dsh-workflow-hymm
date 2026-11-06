import { describe, expect, it } from 'vitest';
import type { Branch, Execution, Workflow, WorkflowNode, WorkflowPlan } from '../src/shared/model.ts';
import { deriveWorkflowSessionGroups } from '../src/client/workflow-session-groups.ts';

const workflow = (id: string, extra: Partial<Workflow> = {}): Workflow => ({ id, name: `Workflow ${id}`, schemaVersion: 2, revision: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1, ...extra });
const branch = (id: string, sessionId: string, extra: Partial<Branch> = {}): Branch => ({ id, sessionId, label: id, nodeIds: [], createdAt: 1, ...extra });
const node = (id: string, extra: Partial<WorkflowNode> = {}): WorkflowNode => ({ id, title: id, instruction: '', revision: 1, status: 'draft', source: 'user', position: { x: 0, y: 0 }, ...extra });
const execution = (sessionId: string, extra: Partial<Execution> = {}): Execution => ({ runId: `run-${sessionId}`, sessionId, nodeId: 'a', nodeRevision: 1, branchId: 'main', requestId: 'request', status: 'completed', durability: 'durable', turns: [], createdAt: 1, updatedAt: 1, ...extra });
const plan = (sessionId: string): WorkflowPlan => ({ id: `plan-${sessionId}`, sessionId, goal: 'Test', requestId: 'request-plan', status: 'accepted', tasks: [], createdAt: 1 });

describe('workflow conversation display groups', () => {
  it('groups native main, fork and planning identities under the current workflow name without mutating metadata', () => {
    const item = workflow('first', {
      name: '测试1', nodes: [node('a', { displayId: 4 })],
      branches: [branch('main', 'root-session'), branch('fork', 'fork-session', { parentBranchId: 'main', sourceSessionId: 'root-session', forkFromNodeId: 'a' })],
      executions: [execution('root-session'), execution('fork-session', { branchId: 'fork' })], plans: [plan('plan-session')],
    });
    const before = structuredClone(item);
    const visible = ['fork-session', 'ordinary-session', 'plan-session', 'root-session'];
    const result = deriveWorkflowSessionGroups([item], visible);
    expect(result.groups).toEqual([{ workflowId: 'first', title: '测试1', sessions: [
      { sessionId: 'fork-session', kind: 'branch', branchId: 'fork', branchLabel: 'fork', nodeId: 'a', displayId: 4 },
      { sessionId: 'plan-session', kind: 'planning', planId: 'plan-plan-session' },
      { sessionId: 'root-session', kind: 'main', branchId: 'main', branchLabel: 'main', nodeId: 'a', displayId: 4 },
    ] }]);
    expect(result.ungroupedSessionIds).toEqual(['ordinary-session']);
    expect(item).toEqual(before);
    const renamed = deriveWorkflowSessionGroups([{ ...item, name: 'Renamed workflow' }], visible);
    expect(renamed.groups[0]?.title).toBe('Renamed workflow');
    expect(renamed.groups[0]?.workflowId).toBe('first');
    expect(renamed.groups[0]?.sessions).toEqual(result.groups[0]?.sessions);
  });

  it('keeps imported or shared sources, utility references and unknown Sessions in the native list', () => {
    const first = workflow('first', { sourceSessionId: 'imported', nodes: [node('source-node', { kind: 'session', sourceSessionId: 'source-node-session' })],
      branches: [branch('child', 'child-session', { sourceSessionId: 'imported' }), branch('legacy-source', 'imported')],
      utilityNodes: [{ id: 'utility', title: 'Files', position: { x: 0, y: 0 }, width: 400, height: 400, sessionId: 'utility-session' }],
      operations: [{ id: 'fork-operation', kind: 'fork', status: 'completed', sourceSessionId: 'operation-source', childSessionId: 'child-session', createdAt: 1 }],
    });
    const shared = workflow('second', { sourceSessionId: 'child-session' });
    const visible = ['imported', 'source-node-session', 'child-session', 'operation-source', 'utility-session', 'unrelated'];
    expect(deriveWorkflowSessionGroups([first, shared], visible)).toEqual({ groups: [], ungroupedSessionIds: visible });
  });

  it('keeps equally named workflows distinct and leaves multiply claimed Sessions ungrouped', () => {
    const a = workflow('a', { name: 'Same title', branches: [branch('a-root', 'a-session'), branch('a-ambiguous', 'ambiguous')] });
    const b = workflow('b', { name: 'Same title', plans: [plan('b-session')], branches: [branch('b-ambiguous', 'ambiguous')] });
    const result = deriveWorkflowSessionGroups([a, b], ['b-session', 'ambiguous', 'a-session', 'a-session']);
    expect(result.groups.map(group => [group.workflowId, group.title, group.sessions.map(item => item.sessionId)])).toEqual([
      ['a', 'Same title', ['a-session']], ['b', 'Same title', ['b-session']],
    ]);
    expect(result.ungroupedSessionIds).toEqual(['ambiguous']);
  });

  it('does not resurrect invisible sessions or empty groups and returns archived workflow history to native rows', () => {
    const visible = ['kept-history', 'ordinary'];
    const items = [workflow('archived', { archivedAt: 2, branches: [branch('old', 'kept-history')] }), workflow('empty'), workflow('hidden', { branches: [branch('hidden', 'not-visible')] })];
    expect(deriveWorkflowSessionGroups(items, visible)).toEqual({ groups: [], ungroupedSessionIds: visible });
    expect(deriveWorkflowSessionGroups(items, [])).toEqual({ groups: [], ungroupedSessionIds: [] });
  });

  it('deduplicates repeated linear executions and retains the latest task identity', () => {
    const item = workflow('linear', { branches: [branch('main', 'session')], nodes: [node('a', { displayId: 1 }), node('b', { displayId: 2 })],
      executions: [execution('session'), execution('session', { runId: 'second', nodeId: 'b', createdAt: 2 }), execution('session', { runId: 'older-but-updated', createdAt: 1, updatedAt: 5 })],
    });
    expect(deriveWorkflowSessionGroups([item], ['session']).groups[0]?.sessions).toEqual([
      { sessionId: 'session', kind: 'main', branchId: 'main', branchLabel: 'main', nodeId: 'b', displayId: 2 },
    ]);
  });

  it('accounts for Host-created operation and upload contexts without claiming referenced sources', () => {
    const item = workflow('host-owned', { uploadSessionId: 'upload', operations: [
      { id: 'fork', kind: 'fork', status: 'pending', sourceSessionId: 'external-source', childSessionId: 'new-child', createdAt: 1 },
      { id: 'planning', kind: 'plan', status: 'pending', childSessionId: 'new-plan', createdAt: 1 },
    ] });
    const result = deriveWorkflowSessionGroups([item], ['upload', 'new-child', 'new-plan', 'external-source']);
    expect(result.groups[0]?.sessions).toEqual([
      { sessionId: 'upload', kind: 'auxiliary' }, { sessionId: 'new-child', kind: 'auxiliary' }, { sessionId: 'new-plan', kind: 'planning' },
    ]);
    expect(result.ungroupedSessionIds).toEqual(['external-source']);
  });
});
