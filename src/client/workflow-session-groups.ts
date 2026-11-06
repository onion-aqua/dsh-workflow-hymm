import type { Execution, Workflow } from '../shared/model.ts';

/** Display-only membership: these ids are never native Workspace ids. */
export interface WorkflowSessionEntry {
  sessionId: string;
  kind: 'main' | 'branch' | 'planning' | 'auxiliary';
  branchId?: string;
  branchLabel?: string;
  nodeId?: string;
  displayId?: number;
  planId?: string;
}

export interface WorkflowSessionGroup {
  workflowId: string;
  title: string;
  sessions: WorkflowSessionEntry[];
}

export interface WorkflowSessionGroups {
  groups: WorkflowSessionGroup[];
  /** Unclaimed, imported or ambiguous Sessions keep their normal native rows. */
  ungroupedSessionIds: string[];
}

function membership(workflow: Workflow): Map<string, WorkflowSessionEntry> {
  const result = new Map<string, WorkflowSessionEntry>();
  const add = (sessionId: string | undefined, kind: WorkflowSessionEntry['kind'] = 'auxiliary') => {
    if (sessionId && !result.has(sessionId)) result.set(sessionId, { sessionId, kind });
  };
  add(workflow.uploadSessionId);
  for (const operation of workflow.operations ?? []) add(operation.childSessionId, operation.kind === 'plan' ? 'planning' : 'auxiliary');
  for (const branch of workflow.branches ?? []) {
    result.set(branch.sessionId, {
      sessionId: branch.sessionId,
      kind: branch.automatic || branch.parentBranchId || branch.forkFromNodeId || branch.sourceSessionId ? 'branch' : 'main',
      branchId: branch.id,
      branchLabel: branch.label,
    });
  }
  const latest = new Map<string, Execution>();
  for (const execution of workflow.executions ?? []) {
    add(execution.sessionId);
    add(execution.subagent?.parentSessionId);
    if (!latest.has(execution.sessionId) || latest.get(execution.sessionId)!.createdAt <= execution.createdAt) latest.set(execution.sessionId, execution);
  }
  for (const [sessionId, execution] of latest) {
    const node = workflow.nodes.find(node => node.id === execution.nodeId);
    const displayId = node?.displayId ?? workflow.nodeSerials?.[execution.nodeId];
    result.set(sessionId, { ...result.get(sessionId)!, nodeId: execution.nodeId, ...(displayId === undefined ? {} : { displayId }) });
  }
  for (const plan of workflow.plans ?? []) result.set(plan.sessionId, { sessionId: plan.sessionId, kind: 'planning', planId: plan.id });
  return result;
}

/**
 * Partition an already-filtered native Session list using exact Host-owned
 * references. The caller retains native visibility, search and row ordering;
 * nothing reads or rewrites Session logs, titles, directories or memberships.
 * Archived workflows relinquish their display groups, so retained conversations
 * become ordinary native rows. Duplicate claims never hide a conversation.
 */
export function deriveWorkflowSessionGroups(workflows: readonly Workflow[], visibleSessionIds: readonly string[]): WorkflowSessionGroups {
  const sources = new Set<string>();
  for (const workflow of workflows) {
    if (workflow.sourceSessionId) sources.add(workflow.sourceSessionId);
    for (const node of workflow.nodes) if (node.sourceSessionId) sources.add(node.sourceSessionId);
  }
  const groups = new Map<string, WorkflowSessionGroup>();
  const owners = new Map<string, Map<string, WorkflowSessionEntry>>();
  for (const workflow of workflows) {
    if (workflow.archivedAt !== undefined || groups.has(workflow.id)) continue;
    groups.set(workflow.id, { workflowId: workflow.id, title: workflow.name, sessions: [] });
    for (const [id, entry] of membership(workflow)) {
      if (sources.has(id)) continue;
      let claims = owners.get(id);
      if (!claims) owners.set(id, claims = new Map());
      claims.set(workflow.id, entry);
    }
  }
  const ungroupedSessionIds: string[] = [];
  for (const sessionId of new Set(visibleSessionIds)) {
    const claims = owners.get(sessionId);
    if (claims?.size !== 1) { ungroupedSessionIds.push(sessionId); continue; }
    const [workflowId, entry] = claims.entries().next().value!;
    groups.get(workflowId)!.sessions.push(entry);
  }
  return { groups: [...groups.values()].filter(group => group.sessions.length > 0), ungroupedSessionIds };
}
