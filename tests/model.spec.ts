import { describe, expect, it } from 'vitest';
import { graphProblem, layoutWorkflow } from '../src/shared/model.ts';
import type { Workflow, WorkflowEdge, WorkflowNode } from '../src/shared/model.ts';
import { workflowSchema } from '../src/host/validation.ts';

function node(id: string): WorkflowNode {
  return { id, title: id, instruction: '', source: 'user', status: 'draft', revision: 1, position: { x: 0, y: 0 } };
}
function edge(source: string, target: string, id = `${source}-${target}`): WorkflowEdge {
  return { id, source, target, type: 'dependency' };
}
function graph(): Workflow {
  return {
    id: 'workflow-test', name: 'Example', schemaVersion: 1, revision: 1,
    nodes: ['a', 'b', 'c'].map(node), edges: [edge('a', 'b'), edge('b', 'c')],
    viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1,
  };
}

describe('workflow graph invariants', () => {
  it('accepts dependency chains and disconnected draft nodes', () => {
    const workflow = graph();
    workflow.nodes.push(node('d'));
    expect(graphProblem(workflow.nodes, workflow.edges)).toBeNull();
    expect(workflowSchema.parse(workflow)).toEqual(workflow);
  });

  it.each([
    { edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')], problem: 'dependency-cycle' },
    { edges: [edge('a', 'missing')], problem: 'missing-endpoint' },
    { edges: [edge('a', 'a')], problem: 'self-dependency' },
    { edges: [edge('a', 'b', 'one'), edge('a', 'b', 'two')], problem: 'duplicate-dependency' },
    { edges: [edge('a', 'b', 'same'), edge('b', 'c', 'same')], problem: 'duplicate-edge-id' },
  ])('rejects $problem without accepting a damaged graph', ({ edges, problem }) => {
    expect(graphProblem(graph().nodes, edges)).toBe(problem);
    expect(workflowSchema.safeParse({ ...graph(), edges }).success).toBe(false);
  });

  it('rejects duplicate node identities and non-finite viewport data', () => {
    const workflow = graph();
    expect(graphProblem([...workflow.nodes, node('a')], workflow.edges)).toBe('duplicate-node-id');
    expect(workflowSchema.safeParse({ ...workflow, viewport: { x: Infinity, y: 0, zoom: 1 } }).success).toBe(false);
    expect(workflowSchema.safeParse({ ...workflow, viewport: { x: 0, y: 0, zoom: 0 } }).success).toBe(false);
  });

  it('keeps the Phase 1 durable payload free of fabricated execution logs', () => {
    expect(workflowSchema.safeParse({ ...graph(), sessions: [] }).success).toBe(false);
    expect(workflowSchema.safeParse({ ...graph(), nodes: [{ ...node('a'), status: 'completed', logs: ['fake'] }] }).success).toBe(false);
  });

  it('places dependencies left to right without changing node or edge identity', () => {
    const workflow = graph();
    const result = layoutWorkflow(workflow);
    expect(result.nodes.map(item => item.id)).toEqual(workflow.nodes.map(item => item.id));
    expect(result.edges).toBe(workflow.edges);
    expect(result.nodes[0]!.position.x).toBeLessThan(result.nodes[1]!.position.x);
    expect(result.nodes[1]!.position.x).toBeLessThan(result.nodes[2]!.position.x);
    expect(workflow.nodes.every(item => item.position.x === 0)).toBe(true);
    expect(layoutWorkflow(result)).toEqual(result);
  });
});
