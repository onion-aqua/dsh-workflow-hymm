var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : Symbol.for("Symbol." + name);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __decoratorStart = (base) => [, , , __create(base?.[__knownSymbol("metadata")] ?? null)];
var __decoratorStrings = ["class", "method", "getter", "setter", "accessor", "field", "value", "get", "set"];
var __expectFn = (fn) => fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn;
var __decoratorContext = (kind, name, done, metadata, fns) => ({ kind: __decoratorStrings[kind], name, metadata, addInitializer: (fn) => done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null)) });
var __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
var __runInitializers = (array, flags, self, value) => {
  for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++) flags & 1 ? fns[i].call(self) : value = fns[i].call(self, value);
  return value;
};
var __decorateElement = (array, flags, name, decorators, target, extra) => {
  var fn, it, done, ctx, access, k = flags & 7, s = !!(flags & 8), p = !!(flags & 16);
  var j = k > 3 ? array.length + 1 : k ? s ? 1 : 2 : 0, key = __decoratorStrings[k + 5];
  var initializers = k > 3 && (array[j - 1] = []), extraInitializers = array[j] || (array[j] = []);
  var desc = k && (!p && !s && (target = target.prototype), k < 5 && (k > 3 || !p) && __getOwnPropDesc(k < 4 ? target : { get [name]() {
    return __privateGet(this, extra);
  }, set [name](x) {
    return __privateSet(this, extra, x);
  } }, name));
  k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name) : __name(target, name);
  for (var i = decorators.length - 1; i >= 0; i--) {
    ctx = __decoratorContext(k, name, done = {}, array[3], extraInitializers);
    if (k) {
      ctx.static = s, ctx.private = p, access = ctx.access = { has: p ? (x) => __privateIn(target, x) : (x) => name in x };
      if (k ^ 3) access.get = p ? (x) => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get) : (x) => x[name];
      if (k > 2) access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => x[name] = y;
    }
    it = (0, decorators[i])(k ? k < 4 ? p ? extra : desc[key] : k > 4 ? void 0 : { get: desc.get, set: desc.set } : target, ctx), done._ = 1;
    if (k ^ 4 || it === void 0) __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? p ? extra = it : desc[key] = it : target = it);
    else if (typeof it !== "object" || it === null) __typeError("Object expected");
    else __expectFn(fn = it.get) && (desc.get = fn), __expectFn(fn = it.set) && (desc.set = fn), __expectFn(fn = it.init) && initializers.unshift(fn);
  }
  return k || __decoratorMetadata(array, target), desc && __defProp(target, name, desc), p ? k ^ 4 ? extra : desc : target;
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function") __typeError("Object expected");
    var dispose, inner;
    if (async) dispose = value[__knownSymbol("asyncDispose")];
    if (dispose === void 0) {
      dispose = value[__knownSymbol("dispose")];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") __typeError("Object not disposable");
    if (inner) dispose = function() {
      try {
        inner.call(this);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  };
  var fail2 = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e);
  var next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0]) return Promise.resolve(result).then(next, (e) => (fail2(e), next()));
      } catch (e) {
        fail2(e);
      }
    }
    if (hasError) throw error;
  };
  return next();
};

// src/host/service.ts
import { createHash, randomUUID } from "node:crypto";
import { Service } from "@deepseek-ai/cordis";
import { SessionId as SessionId6 } from "@deepseek-ai/dsh-session";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { z as z2 } from "zod";

// src/shared/layout.ts
var width = (node2) => node2.width ?? 300;
var height = (node2) => node2.height ?? 210;
var origin = { x: 100, y: 100 };
var columnGap = 106;
var rowGap = 80;
var bottomOverflow = 40;
var obstacleGap = 40;
function layoutDependencyNodes(nodes, edges) {
  if (!nodes.length) return [];
  const ids = new Set(nodes.map((node2) => node2.id));
  if (ids.size !== nodes.length) return [...nodes];
  const parents = new Map(nodes.map((node2) => [node2.id, []])), children = new Map(nodes.map((node2) => [node2.id, []]));
  const incoming = new Map(nodes.map((node2) => [node2.id, 0])), depth = new Map(nodes.map((node2) => [node2.id, 0]));
  for (const edge2 of edges) {
    if (!ids.has(edge2.source) || !ids.has(edge2.target)) continue;
    parents.get(edge2.target).push(edge2.source);
    children.get(edge2.source).push(edge2.target);
    incoming.set(edge2.target, incoming.get(edge2.target) + 1);
  }
  const ready = nodes.filter((node2) => incoming.get(node2.id) === 0).map((node2) => node2.id);
  for (let index = 0; index < ready.length; index++) for (const child of children.get(ready[index])) {
    depth.set(child, Math.max(depth.get(child), depth.get(ready[index]) + 1));
    incoming.set(child, incoming.get(child) - 1);
    if (incoming.get(child) === 0) ready.push(child);
  }
  if (ready.length !== nodes.length) return [...nodes];
  const layers = Array.from({ length: Math.max(...depth.values()) + 1 }, () => []);
  for (const node2 of nodes) layers[depth.get(node2.id)].push(node2);
  const ranks = /* @__PURE__ */ new Map();
  const indexLayer = (layer) => layer.forEach((node2, index) => ranks.set(node2.id, index));
  layers.forEach(indexLayer);
  const order = (layer, neighbours) => {
    const scores = new Map(layer.map((node2, index) => {
      const adjacent = neighbours.get(node2.id);
      return [node2.id, adjacent.length ? adjacent.reduce((sum, id2) => sum + ranks.get(id2), 0) / adjacent.length : index];
    }));
    const previous = new Map(layer.map((node2, index) => [node2.id, index]));
    layer.sort((a, b) => scores.get(a.id) - scores.get(b.id) || previous.get(a.id) - previous.get(b.id));
    indexLayer(layer);
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let layer = 1; layer < layers.length; layer++) order(layers[layer], parents);
    for (let layer = layers.length - 2; layer >= 0; layer--) order(layers[layer], children);
  }
  const positions = /* @__PURE__ */ new Map();
  let x = origin.x;
  for (const layer of layers) {
    let y = origin.y;
    for (const node2 of layer) {
      positions.set(node2.id, { x, y });
      y += height(node2) + rowGap;
    }
    x += Math.max(...layer.map(width)) + columnGap;
  }
  return nodes.map((node2) => ({ ...node2, position: positions.get(node2.id) }));
}
function placeNewDependencyNodes(nodes, edges, existing) {
  const arranged = layoutDependencyNodes(nodes, edges);
  if (!arranged.length || !existing.length) return arranged;
  const blocked = [];
  for (const node2 of arranged) for (const other of existing) {
    if (node2.position.x >= other.position.x + width(other) + obstacleGap || node2.position.x + width(node2) + obstacleGap <= other.position.x) continue;
    blocked.push({ start: other.position.y - node2.position.y - height(node2) - bottomOverflow - obstacleGap, end: other.position.y + height(other) + bottomOverflow + obstacleGap - node2.position.y });
  }
  blocked.sort((a, b) => a.start - b.start || a.end - b.end);
  let dy = 0;
  for (const interval of blocked) {
    if (interval.start >= dy) break;
    if (interval.end > dy) dy = interval.end;
  }
  return dy ? arranged.map((node2) => ({ ...node2, position: { x: node2.position.x, y: node2.position.y + dy } })) : arranged;
}

// src/shared/model.ts
var WORKFLOW_PLUGIN_VERSION = "0.17.3";
var WORKFLOW_API_VERSION = 3;
function graphProblem(nodes, edges) {
  const ids = /* @__PURE__ */ new Set();
  for (const node2 of nodes) {
    if (ids.has(node2.id)) return "duplicate-node-id";
    ids.add(node2.id);
  }
  const edgeIds = /* @__PURE__ */ new Set();
  const pairs = /* @__PURE__ */ new Set();
  const next = /* @__PURE__ */ new Map();
  const incoming = /* @__PURE__ */ new Map();
  for (const id2 of ids) {
    next.set(id2, []);
    incoming.set(id2, 0);
  }
  for (const edge2 of edges) {
    if (edgeIds.has(edge2.id)) return "duplicate-edge-id";
    edgeIds.add(edge2.id);
    if (!ids.has(edge2.source) || !ids.has(edge2.target)) return "missing-endpoint";
    if (edge2.source === edge2.target) return "self-dependency";
    const pair = JSON.stringify([edge2.source, edge2.target]);
    if (pairs.has(pair)) return "duplicate-dependency";
    pairs.add(pair);
    next.get(edge2.source).push(edge2.target);
    incoming.set(edge2.target, incoming.get(edge2.target) + 1);
  }
  const ready = [...ids].filter((id2) => incoming.get(id2) === 0);
  let visited = 0;
  for (let index = 0; index < ready.length; index++) {
    const id2 = ready[index];
    visited++;
    for (const target of next.get(id2)) {
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) ready.push(target);
    }
  }
  return visited === ids.size ? null : "dependency-cycle";
}

// src/host/validation.ts
import { z } from "zod";
var id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
var reference = z.string().min(1).max(512);
var coordinate = z.number().finite().min(-1e7).max(1e7);
var timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
var seq = z.number().int().nonnegative();
var position = z.object({ x: coordinate, y: coordinate }).strict();
var zIndex = z.number().int().min(0).max(1e6);
var viewport = z.object({ x: coordinate, y: coordinate, zoom: z.number().finite().min(0.05).max(4) }).strict();
var status = z.enum(["draft", "waiting", "ready", "running", "waiting_answer", "completed", "failed", "blocked", "cancelled", "interrupted", "unknown"]);
var width2 = z.number().finite().min(220).max(1600);
var height2 = z.number().finite().min(140).max(1200);
var nodeSize = z.object({ width: width2, height: height2 }).strict();
var modelIdentitySchema = z.object({ provider: z.string().trim().min(1).max(512), model: z.string().trim().min(1).max(512), reasoningEffort: z.string().trim().min(1).max(128).optional() }).strict();
var fileReference = z.object({ attachmentId: reference, name: z.string().min(1).max(1024), bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
var nodeAttachment = z.object({ id, file: fileReference, createdAt: timestamp }).strict();
var attachments = z.array(nodeAttachment).max(100).superRefine((items, ctx) => {
  if (new Set(items.map((item) => item.id)).size !== items.length) ctx.addIssue({ code: "custom", message: "duplicate attachment identity" });
});
var nodeRevision = z.object({ revision: z.number().int().positive(), title: z.string().trim().min(1).max(160), instruction: z.string().max(2e4), dependencies: z.array(id), createdAt: timestamp, attachments: attachments.optional(), model: modelIdentitySchema.optional() }).strict();
var node = z.object({
  id,
  displayId: z.number().int().positive().max(1e9).optional(),
  title: z.string().trim().min(1).max(160),
  instruction: z.string().max(2e4),
  source: z.enum(["user", "agent"]),
  status,
  revision: z.number().int().positive(),
  position,
  zIndex: zIndex.optional(),
  width: width2.optional(),
  height: height2.optional(),
  hidden: z.boolean().optional(),
  kind: z.enum(["task", "session"]).optional(),
  sourceSessionId: reference.optional(),
  answerSummary: z.string().max(4e3).optional(),
  resultStale: z.boolean().optional(),
  branchIds: z.array(id).optional(),
  revisions: z.array(nodeRevision).optional(),
  originPlanId: id.optional(),
  attachments: attachments.optional(),
  model: modelIdentitySchema.optional()
}).strict();
var edge = z.object({ id, source: id, target: id, type: z.literal("dependency") }).strict();
var group = z.object({ id, title: z.string().trim().min(1).max(128), nodeIds: z.array(id).min(1).max(1e3) }).strict();
var catalogGroup = z.object({ id, title: z.string().trim().min(1).max(128), nodeIds: z.array(reference).min(1).max(1e3) }).strict();
var branch = z.object({ id, label: z.string().min(1).max(160), sessionId: reference, sourceSessionId: reference.optional(), parentBranchId: id.optional(), forkFromNodeId: id.optional(), forkBoundarySeq: seq.optional(), nodeIds: z.array(id), createdAt: timestamp, automatic: z.boolean().optional() }).strict();
var turn = z.object({ turn: seq, startSeq: seq, endSeq: seq.optional(), reason: z.string().max(128).optional() }).strict();
var workflowSettingsSchema = z.object({ generation: z.enum(["manual", "suggest", "dynamic"]), execution: z.enum(["manual", "approval", "auto"]), model: modelIdentitySchema.optional(), modelReasoning: z.array(modelIdentitySchema.extend({ reasoningEffort: z.string().trim().min(1).max(128) })).max(500).refine((items) => new Set(items.map((item) => JSON.stringify([item.provider, item.model]))).size === items.length, "duplicate model reasoning selection").optional(), subagents: z.enum(["off", "on", "auto"]).optional(), accessMode: reference.optional() }).strict();
var preferences = z.object({ questionTimeout: z.object({ enabled: z.boolean(), seconds: z.number().int().min(15).max(3600) }).strict().optional(), sounds: z.object({ enabled: z.boolean(), completed: z.boolean(), failed: z.boolean(), question: z.boolean(), approval: z.boolean() }).strict().optional() }).strict();
var utilityNode = z.object({ id, title: z.string().trim().min(1).max(160), position, width: z.number().finite().min(300).max(2400), height: z.number().finite().min(220).max(1600), sessionId: reference.optional(), activeTool: z.enum(["files", "terminal", "browser", "tools"]).optional(), terminal: z.object({ id: reference, sessionId: reference, contentId: reference }).strict().optional() }).strict();
var execution = z.object({ runId: id, nodeId: id, nodeRevision: z.number().int().positive(), branchId: id, sessionId: reference, requestId: reference, status, startSeq: seq.optional(), endSeq: seq.optional(), turns: z.array(turn), createdAt: timestamp, updatedAt: timestamp, summary: z.string().max(4e3).optional(), error: z.string().max(4e3).optional(), terminalReason: z.string().max(128).optional(), durability: z.enum(["pending", "durable", "needs-reconcile"]), admissionPolicies: workflowSettingsSchema.optional(), authorizationFingerprint: z.string().max(128).optional(), waitingReason: z.enum(["prerequisites", "stale_prerequisites", "branch_busy", "subagent_capacity", "subagent_unavailable"]).optional(), subagent: z.object({ parentSessionId: reference, provider: z.literal("fork"), messageId: reference.optional() }).strict().optional(), inputRunIds: z.array(id).max(1e3).optional(), resolvedModel: modelIdentitySchema.optional(), resolvedAccessMode: reference.optional() }).strict();
var approval = z.object({ id, nodeId: id, nodeRevision: z.number().int().positive(), fingerprint: z.string().max(128), decision: z.enum(["approved", "rejected"]), createdAt: timestamp, resolvedModel: modelIdentitySchema.optional(), resolvedAccessMode: reference.optional() }).strict();
var planTaskSchema = z.object({ id, title: z.string().trim().min(1).max(160), instruction: z.string().max(2e4), dependsOn: z.array(id).max(100), dependencyUnspecified: z.boolean().optional() }).strict();
var generatedPlanTaskSchema = planTaskSchema.omit({ dependencyUnspecified: true }).extend({ dependsOn: planTaskSchema.shape.dependsOn.optional() }).transform((task) => ({ ...task, dependsOn: task.dependsOn ?? [], ...task.dependsOn === void 0 ? { dependencyUnspecified: true } : {} }));
var structuredPlanSchema = z.object({ tasks: z.array(generatedPlanTaskSchema).min(1).max(100) }).strict().superRefine((value, ctx) => {
  const problem = graphProblem(value.tasks, value.tasks.flatMap((task) => task.dependsOn.map((source) => ({ id: `${source}-${task.id}`, source, target: task.id, type: "dependency" }))));
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});
var plan = z.object({ id, goal: z.string().min(1).max(2e4), sessionId: reference, requestId: reference, status: z.enum(["running", "proposed", "accepted", "rejected", "failed", "needs-reconcile"]), tasks: z.array(planTaskSchema), createdAt: timestamp, error: z.string().max(4e3).optional(), triggerRunId: id.optional(), resolvedModel: modelIdentitySchema.optional(), attachments: attachments.optional() }).strict();
var operation = z.object({ id, kind: z.enum(["run", "fork", "plan", "batch-run", "prepare-attachment", "attach", "prepare-plan-attachments", "attach-plan-files", "compact"]), status: z.enum(["pending", "completed", "failed", "needs-reconcile"]), createdAt: timestamp, nodeId: id.optional(), runId: id.optional(), sourceSessionId: reference.optional(), childSessionId: reference.optional(), atSeq: seq.optional(), error: z.string().max(4e3).optional(), triggerRunId: id.optional(), nodeIds: z.array(id).optional(), runIds: z.array(id).optional(), attachmentId: id.optional() }).strict();
var workflowSchema = z.object({
  id,
  name: z.string().trim().min(1).max(128),
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  nodes: z.array(node).max(1e3),
  edges: z.array(edge).max(3e3),
  groups: z.array(group).max(1e3).optional(),
  viewport,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: timestamp.optional(),
  sourceSessionId: reference.optional(),
  uploadSessionId: reference.optional(),
  attachmentReferences: z.array(nodeAttachment).max(1e4).optional(),
  planningAttachments: attachments.optional(),
  activeBranchId: id.optional(),
  branches: z.array(branch).optional(),
  executions: z.array(execution).optional(),
  approvals: z.array(approval).optional(),
  plans: z.array(plan).optional(),
  operations: z.array(operation).optional(),
  settings: workflowSettingsSchema.optional(),
  preferences: preferences.optional(),
  utilityNodes: z.array(utilityNode).max(30).optional(),
  nodeSerials: z.record(id, z.number().int().positive().max(1e9)).optional(),
  nextDisplayId: z.number().int().positive().max(1000000001).optional(),
  workspaceId: reference.optional(),
  organizeNativeNames: z.boolean().optional()
}).strict().superRefine((workflow, ctx) => {
  const problem = graphProblem(workflow.nodes, workflow.edges);
  if (problem) ctx.addIssue({ code: "custom", path: ["edges"], message: problem });
  if (workflow.updatedAt < workflow.createdAt) ctx.addIssue({ code: "custom", path: ["updatedAt"], message: "updatedAt precedes createdAt" });
  const nodes = new Set(workflow.nodes.map((node2) => node2.id));
  const groupIds = /* @__PURE__ */ new Set();
  const groupedNodes = /* @__PURE__ */ new Set();
  for (const item of workflow.groups ?? []) {
    if (groupIds.has(item.id) || nodes.has(item.id)) ctx.addIssue({ code: "custom", path: ["groups"], message: "group identity is duplicated or conflicts with a node" });
    groupIds.add(item.id);
    for (const nodeId of item.nodeIds) {
      if (!nodes.has(nodeId)) ctx.addIssue({ code: "custom", path: ["groups"], message: "group member must be an existing node; nested groups are unsupported" });
      if (groupedNodes.has(nodeId)) ctx.addIssue({ code: "custom", path: ["groups"], message: "each node may belong to only one group without duplicate membership" });
      groupedNodes.add(nodeId);
    }
  }
  const branchIds = /* @__PURE__ */ new Set();
  const branchSessions = /* @__PURE__ */ new Set();
  for (const item of workflow.branches ?? []) {
    if (branchIds.has(item.id) || branchSessions.has(item.sessionId)) ctx.addIssue({ code: "custom", message: "duplicate branch identity/session" });
    branchIds.add(item.id);
    branchSessions.add(item.sessionId);
    if (item.nodeIds.some((id2) => !nodes.has(id2))) ctx.addIssue({ code: "custom", message: "branch has missing node" });
    if (workflow.sourceSessionId === item.sessionId) ctx.addIssue({ code: "custom", message: "source session cannot be writable branch" });
  }
  for (const run of workflow.executions ?? []) {
    if (!nodes.has(run.nodeId) || !branchIds.has(run.branchId)) ctx.addIssue({ code: "custom", message: "execution has missing node/branch" });
    if (run.subagent) {
      const owner = workflow.branches?.find((branch2) => branch2.id === run.branchId);
      if (run.sessionId === run.subagent.parentSessionId || run.subagent.parentSessionId === workflow.sourceSessionId || owner?.sessionId !== run.sessionId || owner.sourceSessionId !== run.subagent.parentSessionId) ctx.addIssue({ code: "custom", message: "subagent execution must reference its distinct child Session and private coordinator" });
    }
  }
  if (workflow.uploadSessionId && (workflow.uploadSessionId === workflow.sourceSessionId || branchSessions.has(workflow.uploadSessionId))) ctx.addIssue({ code: "custom", message: "upload Session must be independent of source and execution branches" });
});
var getRequestSchema = z.object({ id }).strict();
var createRequestSchema = z.object({ name: z.string().trim().min(1).max(128) }).strict();
var deleteRequestSchema = z.object({ workflowId: id, expectedRevision: z.number().int().positive() }).strict();
var pauseRequestSchema = z.object({ workflowId: id }).strict();
var saveRequestSchema = z.object({ workflow: workflowSchema, expectedRevision: z.number().int().positive() }).strict().superRefine((request, ctx) => {
  if (request.workflow.revision !== request.expectedRevision) ctx.addIssue({ code: "custom", path: ["expectedRevision"], message: "revision does not match expectedRevision" });
});
var catalogLayoutSchema = z.object({ revision: z.number().int().nonnegative(), positions: z.record(reference, position), viewport, zIndices: z.record(reference, zIndex).optional(), sizes: z.record(reference, nodeSize).optional(), groups: z.array(catalogGroup).max(1e3).optional() }).strict().superRefine((layout, ctx) => {
  const groupIds = /* @__PURE__ */ new Set();
  const groupedNodes = /* @__PURE__ */ new Set();
  for (const item of layout.groups ?? []) {
    if (groupIds.has(item.id)) ctx.addIssue({ code: "custom", path: ["groups"], message: "duplicate catalog group identity" });
    groupIds.add(item.id);
    for (const nodeId of item.nodeIds) {
      if (groupedNodes.has(nodeId)) ctx.addIssue({ code: "custom", path: ["groups"], message: "each Session may belong to only one group without duplicate membership" });
      groupedNodes.add(nodeId);
    }
  }
  for (const groupId of groupIds) if (groupedNodes.has(groupId)) ctx.addIssue({ code: "custom", path: ["groups"], message: "nested catalog groups are unsupported" });
});
var catalogLayoutRequestSchema = z.object({ layout: catalogLayoutSchema, expectedRevision: z.number().int().nonnegative() }).strict();
var importRequestSchema = z.object({ sessionId: reference }).strict();
var prepareAttachmentRequestSchema = z.object({ workflowId: id, nodeId: id, nodeRevision: z.number().int().positive(), operationId: id }).strict();
var attachRequestSchema = prepareAttachmentRequestSchema.extend({ sessionId: reference, receiptId: reference }).strict();
var attachFilesRequestSchema = prepareAttachmentRequestSchema.extend({ sessionId: reference, receiptIds: z.array(reference).min(1).max(100) }).strict().superRefine((request, ctx) => {
  if (new Set(request.receiptIds).size !== request.receiptIds.length) ctx.addIssue({ code: "custom", path: ["receiptIds"], message: "duplicate upload receipt" });
});
var preparePlanAttachmentsRequestSchema = z.object({ workflowId: id, operationId: id }).strict();
var attachPlanFilesRequestSchema = preparePlanAttachmentsRequestSchema.extend({ sessionId: reference, receiptIds: z.array(reference).min(1).max(100) }).strict().superRefine((request, ctx) => {
  if (new Set(request.receiptIds).size !== request.receiptIds.length) ctx.addIssue({ code: "custom", path: ["receiptIds"], message: "duplicate upload receipt" });
});
var approveRequestSchema = z.object({ workflowId: id, nodeId: id, approved: z.boolean() }).strict();
var runRequestSchema = z.object({ workflowId: id, nodeId: id, nodeRevision: z.number().int().positive().optional(), branchId: id.optional(), operationId: id }).strict();
var batchRunRequestSchema = z.object({ workflowId: id, nodeIds: z.array(id).min(1).max(1e3), nodeRevisions: z.record(id, z.number().int().positive()), branchId: id.optional(), operationId: id }).strict().superRefine((request, ctx) => {
  if (new Set(request.nodeIds).size !== request.nodeIds.length) ctx.addIssue({ code: "custom", path: ["nodeIds"], message: "duplicate selected node" });
  if (request.nodeIds.some((nodeId) => request.nodeRevisions[nodeId] === void 0) || Object.keys(request.nodeRevisions).some((nodeId) => !request.nodeIds.includes(nodeId))) ctx.addIssue({ code: "custom", path: ["nodeRevisions"], message: "versions must match the selected node IDs exactly" });
});
var traceRequestSchema = z.object({ workflowId: id, runId: id }).strict();
var detailsRequestSchema = z.object({ workflowId: id, runId: id, stepId: reference }).strict();
var questionsRequestSchema = z.object({ workflowId: id }).strict();
var answerQuestionRequestSchema = z.object({ workflowId: id, runId: id, sessionId: reference, callId: reference, answers: z.array(z.object({ id: reference, selected: z.array(z.string().max(1e4)).max(100), custom: z.string().max(2e4).optional() }).strict()).min(1).max(100) }).strict();
var pauseQuestionRequestSchema = z.object({ workflowId: id, runId: id, sessionId: reference, callId: reference }).strict();
var answerApprovalRequestSchema = z.object({ workflowId: id, runId: id, sessionId: reference, approvalId: reference, decision: z.enum(["allowed-once", "rejected"]) }).strict();
var accessModeRequestSchema = z.object({ workflowId: id, presetId: reference.optional() }).strict();
var workspaceRequestSchema = z.object({ workflowId: id, workspaceId: reference.optional() }).strict();
var contextRequestSchema = z.object({ workflowId: id.optional(), branchId: id.optional(), nodeId: id.optional(), sessionId: reference.optional(), planning: z.boolean().optional() }).strict().superRefine((request, ctx) => {
  if ((request.nodeId || request.branchId) && !request.workflowId) ctx.addIssue({ code: "custom", path: ["workflowId"], message: "A node or branch context requires a workflow" });
});
var compactRequestSchema = z.object({ workflowId: id, sessionId: reference, operationId: id }).strict();
var planRequestSchema = z.object({ workflowId: id, goal: z.string().trim().min(1).max(2e4), sourceSessionId: reference.optional(), operationId: id, attachmentIds: z.array(id).max(100).optional() }).strict().superRefine((request, ctx) => {
  if (request.attachmentIds && new Set(request.attachmentIds).size !== request.attachmentIds.length) ctx.addIssue({ code: "custom", path: ["attachmentIds"], message: "duplicate planning attachment identity" });
});
var applyPlanRequestSchema = z.object({ workflowId: id, planId: id, accept: z.boolean(), taskIds: z.array(id).optional() }).strict();
var forkRequestSchema = z.object({ workflowId: id, runId: id.optional(), sessionId: reference.optional(), atSeq: seq.optional(), label: z.string().trim().min(1).max(160), operationId: id }).strict();

// src/host/native-runtime.ts
import { SessionId } from "@deepseek-ai/dsh-session";
import { boundContextSummary, createUserMessage, ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import { setSandboxMode } from "@deepseek-ai/dsh-sandbox-policy";

// src/host/compaction-history.ts
var object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var seq2 = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
var same = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);
var controlSources = /* @__PURE__ */ new Set(["model-selection", "runtime-context", "working-directory", "ptc-mode", "tool-registry", "user-approval", "system-prompt", "plan-mode", "skill-catalog", "time-context"]);
function transactions(log) {
  const events = log.events, bySeq = new Map(events.map((event) => [event.seq, event]));
  const starts = /* @__PURE__ */ new Map(), ends = /* @__PURE__ */ new Map(), summaries = /* @__PURE__ */ new Map(), surfaceBefore = /* @__PURE__ */ new Map();
  let nodes = [];
  for (const event of events) {
    const id2 = event.data.compactionId, map = event.type === "compaction/start" ? starts : event.type === "compaction/end" ? ends : event.type === "compaction/summary" ? summaries : void 0;
    if (map && typeof id2 === "string" && id2) map.set(id2, [...map.get(id2) ?? [], event]);
    if (event.type === "user/message" && object(event.data.source).kind === "compact-checkpoint") surfaceBefore.set(event.seq, nodes);
    const operation2 = object(event).surfaceOp;
    if (operation2 === "append") nodes = [...nodes, event.seq];
    else if (object(operation2).op === "replace") {
      const start = nodes.indexOf(Number(object(operation2).startSeq)), end = nodes.indexOf(Number(object(operation2).endSeq));
      if (start < 0 || end < start) nodes = [];
      else nodes = [...nodes.slice(0, start), event.seq, ...nodes.slice(end + 1)];
    }
  }
  const valid = [];
  for (let index = 1; index < events.length; index++) {
    const checkpoint = events[index], summary = events[index - 1];
    if (checkpoint.type !== "user/message" || summary.type !== "compaction/summary" || checkpoint.seq !== summary.seq + 1) continue;
    const source = object(checkpoint.data.source), id2 = source.compactionId;
    if (source.kind !== "compact-checkpoint" || typeof id2 !== "string" || summary.data.compactionId !== id2) continue;
    const owners = starts.get(id2), closers = ends.get(id2);
    if (owners?.length !== 1 || closers?.length !== 1 || summaries.get(id2)?.length !== 1) continue;
    const start = owners[0], end = closers[0];
    if (start.seq >= summary.seq || end.seq <= checkpoint.seq || end.data.error !== void 0 || start.data.turn !== end.data.turn || start.data.turn !== null && !seq2(start.data.turn)) continue;
    if ([start.data.sourceCommandId, summary.data.sourceCommandId, end.data.sourceCommandId].some((command) => command !== source.sourceCommandId)) continue;
    const shadowed = summary.data.shadowedSeqs, range = object(summary.data.shadowedRange), surface = object(object(checkpoint).surfaceOp), references = object(checkpoint).sourceEventSeqs;
    if (!Array.isArray(shadowed) || !shadowed.length || !shadowed.every(seq2) || new Set(shadowed).size !== shadowed.length || !seq2(range.start) || !seq2(range.end)) continue;
    if (shadowed[0] !== range.start || shadowed.at(-1) !== range.end || shadowed.some((value) => value >= start.seq || !bySeq.has(value))) continue;
    const current = surfaceBefore.get(checkpoint.seq) ?? [], first = current.indexOf(range.start), last = current.indexOf(range.end);
    if (first < 0 || last < first || !same(shadowed, current.slice(first, last + 1))) continue;
    if (surface.op !== "replace" || surface.startSeq !== range.start || surface.endSeq !== range.end || !Array.isArray(references) || !same(references, [start.seq, summary.seq, ...shadowed])) continue;
    let turn2, validBracket = true;
    for (const event of events) {
      if (event.seq > end.seq) break;
      if (event.type === "turn/start") {
        if (event.seq > start.seq) validBracket = false;
        turn2 = seq2(event.data.turn) ? event.data.turn : void 0;
      }
      if (event.seq === start.seq && (start.data.turn === null && turn2 !== void 0 || start.data.turn !== null && turn2 !== start.data.turn)) validBracket = false;
      if (event.type === "turn/end") {
        if (event.seq > start.seq && event.seq < end.seq) validBracket = false;
        turn2 = void 0;
      }
    }
    if (!validBracket) continue;
    valid.push({ checkpoint: checkpoint.seq, end: end.seq, turn: start.data.turn });
  }
  return valid;
}
function verifiedCompactionCheckpoints(log) {
  return new Set(transactions(log).map((item) => item.checkpoint));
}
function compactionContinuationBoundary(log, completedTurnEndSeq) {
  const boundary = log.events.find((event) => event.seq === completedTurnEndSeq);
  if (boundary?.type !== "turn/end" || object(boundary.data.reason).kind !== "completed") return completedTurnEndSeq;
  const validated = transactions(log), checkpoints = new Set(validated.map((item) => item.checkpoint)), ends = new Set(validated.filter((item) => item.turn === null).map((item) => item.end));
  let result = completedTurnEndSeq;
  for (const event of log.events) {
    if (event.seq <= completedTurnEndSeq) continue;
    if (event.type === "turn/start") break;
    if (event.type === "user/message" && !checkpoints.has(event.seq) && !controlSources.has(String(object(event.data.source).kind))) break;
    if (ends.has(event.seq)) result = event.seq;
  }
  return result;
}

// src/host/native-runtime.ts
var questionControlSources = /* @__PURE__ */ new Set(["model-selection", "runtime-context", "working-directory", "ptc-mode", "tool-registry", "user-approval", "compact-checkpoint", "system-prompt", "plan-mode"]);
function completedBoundary(log, requested) {
  const eligible = log.events.filter((event) => event.type === "turn/end" && record(event.data.reason).kind === "completed");
  if (requested !== void 0) {
    if (!Number.isSafeInteger(requested) || requested < 0 || !eligible.some((event) => event.seq === requested || compactionContinuationBoundary(log, event.seq) === requested)) {
      throw new Error("Fork requires an existing completed turn/end event boundary");
    }
    return requested;
  }
  return eligible.at(-1)?.seq;
}
var DshNativeRuntime = class {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.on("agent/created", ({ agent }) => {
      if (this.planningSessions.has(agent.id)) this.protectPlanningAgent(agent);
      const permission = this.subagentSandboxModes.get(agent.id);
      if (permission) {
        if (agent.session.header.origin !== "subagent" || agent.session.header.parentSession !== permission.parentSessionId) throw new Error("The reserved Workflow child does not match its native permission owner.");
        setSandboxMode(agent.session, permission.mode);
      }
    });
    ctx.on("session/event", (session, event) => {
      if (event.type !== "turn/end") return;
      const agent = ctx.agents.get(session.id);
      if (!agent) return;
      const selection = this.selectedModels.get(agent);
      if (!selection?.current) return;
      if (selection.owningTurn === event.data.turn) {
        selection.current = void 0;
        selection.assembled = void 0;
        selection.owningTurn = void 0;
        selection.questionCallId = void 0;
      }
    });
    ctx.on("user-questions/request", async (request, next) => {
      const agent = request.agent;
      if (!agent || !this.questionOwner) return next();
      const callId = request.wait?.callId ?? this.legacyQuestionCallId(agent, request.questions);
      if (!callId || !await this.questionOwner(agent.id, callId)) return next();
      if (request.signal?.aborted) throw request.signal.reason;
      if (this.ctx.agents.get(agent.id) !== agent || !this.ctx.agents.roots().includes(agent)) return next();
      const key = this.questionKey(agent.id, callId);
      if (this.questionWaits.has(key)) return next();
      return new Promise((resolve, reject) => {
        const event = agent.session.snapshotEvents().findLast((item) => item.type === "tool/call" && item.data.callId === callId || item.type === "tool/ptc-dispatch-start" && item.data.subCallId === callId);
        const abort = () => {
          wait.release();
          reject(request.signal?.reason ?? new Error("The native question wait was aborted."));
        };
        const wait = { agent, callId, questions: structuredClone(request.questions), createdAt: event?.time ?? Date.now(), signal: request.signal, resolve, reject, release: () => {
          request.signal?.removeEventListener("abort", abort);
          if (this.questionWaits.get(key) === wait) this.questionWaits.delete(key);
          this.notifyQuestionState(agent.id);
        } };
        this.questionWaits.set(key, wait);
        request.signal?.addEventListener("abort", abort, { once: true });
        this.notifyQuestionState(agent.id);
        if (request.signal?.aborted) abort();
      });
    }, { prepend: true });
    ctx.effect(() => () => {
      for (const wait of [...this.questionWaits.values()]) {
        wait.release();
        wait.reject(new Error("The Workflow question interface was disposed."));
      }
      this.questionListeners.clear();
    }, "visual-workflow.question-waits");
  }
  static inject = ["sessionController", "sessionQuery", "sessions", "agents", "tools", "attachments", "fileUploads", "agentDefaultModel", "llm", "systemPrompt"];
  planningAgents = /* @__PURE__ */ new WeakSet();
  planningSessions = /* @__PURE__ */ new Set();
  planningReadPaths = /* @__PURE__ */ new Map();
  selectedModels = /* @__PURE__ */ new WeakMap();
  subagentActivations = /* @__PURE__ */ new Map();
  subagentStarts = /* @__PURE__ */ new Map();
  subagentSandboxModes = /* @__PURE__ */ new Map();
  subagentsStopping = false;
  questionOwner;
  questionWaits = /* @__PURE__ */ new Map();
  questionListeners = /* @__PURE__ */ new Set();
  setQuestionOwner(owns) {
    this.questionOwner = owns;
  }
  pendingQuestionReplies(sessionId) {
    const agent = this.ctx.agents.get(SessionId(sessionId));
    if (!agent) return [];
    return [...agent.inbox.nextStep, ...agent.inbox.nextTurn].flatMap((message) => {
      const source = record(message.source);
      return source.kind === "user-question-reply" && source.outcome === "answered" && typeof source.callId === "string" ? [source.callId] : [];
    });
  }
  questionKey(sessionId, callId) {
    return `${sessionId}\0${callId}`;
  }
  notifyQuestionState(sessionId) {
    const notification = { type: "workflow/question-state", seq: -1, time: Date.now(), data: {} };
    for (const listener of this.questionListeners) try {
      listener(sessionId, notification);
    } catch (error) {
      this.ctx.logger.error("Workflow question state listener failed", error);
    }
  }
  legacyQuestionCallId(agent, questions) {
    const unresolved = /* @__PURE__ */ new Map();
    for (const event of agent.session.ownEvents()) {
      if ((event.type === "tool/call" || event.type === "tool/ptc-dispatch-start") && event.data.name === "ask_user_question") {
        try {
          const args = event.type === "tool/call" ? JSON.parse(event.data.arguments) : record(event.data.arguments);
          const items = normalizeQuestionItems(args.questions);
          const callId = event.type === "tool/call" ? event.data.callId : event.data.subCallId;
          if (items) unresolved.set(callId, items);
        } catch {
        }
      } else if (event.type === "tool/result") unresolved.delete(event.data.message.toolCallId);
      else if (event.type === "tool/ptc-dispatch") unresolved.delete(event.data.subCallId);
    }
    const signature = (items) => JSON.stringify(items.map((item) => ({ id: item.id, question: item.question, header: item.header, detail: item.detail, options: item.options, multiSelect: item.multiSelect ?? false })));
    const matches = [...unresolved].filter(([, items]) => signature(items) === signature(questions));
    return matches.length === 1 ? matches[0][0] : void 0;
  }
  questionInboxBlocked(agent, callId) {
    return !!agent && [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some((message) => {
      const source = record(message.source);
      if (source.kind === "user-question-reply") return true;
      return typeof source.kind !== "string" || !questionControlSources.has(source.kind);
    });
  }
  async questions(sessionId) {
    if (!this.ctx.get("userQuestions")) return [];
    const observation = await this.ctx.sessionQuery.observeSession(SessionId(sessionId), { projectionMode: "all" });
    try {
      const view = record(record(observation.projections?.values).userQuestions), rows = Array.isArray(view.active) ? view.active : [], result = /* @__PURE__ */ new Map();
      const agent = this.ctx.agents.get(SessionId(sessionId)), liveRoot = agent ? this.ctx.agents.roots().includes(agent) : observation.header.origin !== "subagent";
      for (const value of rows) {
        const row = record(value), callId = typeof row.callId === "string" ? row.callId : void 0, items = normalizeQuestionItems(row.questions);
        if (!callId || !items || !["open", "continued"].includes(String(row.state))) continue;
        const wait = this.questionWaits.get(this.questionKey(sessionId, callId)), foreground = !!wait && !wait.signal?.aborted && wait.agent === agent;
        const event = observation.events.find((item) => item.seq >= observation.inheritedEventCount && (item.type === "tool/call" && item.data.callId === callId || item.type === "tool/ptc-dispatch" && item.data.subCallId === callId));
        result.set(callId, { sessionId, callId, questions: items, state: row.state, actionable: liveRoot && !this.questionInboxBlocked(agent, callId) && (row.state === "continued" || foreground), createdAt: event?.time ?? wait?.createdAt ?? observation.header.createdAt });
      }
      for (const wait of this.questionWaits.values()) if (wait.agent.id === sessionId && !wait.signal?.aborted && wait.agent === agent && !result.has(wait.callId)) result.set(wait.callId, { sessionId, callId: wait.callId, questions: structuredClone(wait.questions), state: "open", actionable: liveRoot && !this.questionInboxBlocked(agent, wait.callId), createdAt: wait.createdAt });
      return [...result.values()];
    } finally {
      observation[Symbol.dispose]();
    }
  }
  async answerQuestion(sessionId, callId, answers, resume) {
    const service = this.ctx.get("userQuestions");
    if (!service || !this.questionOwner || !await this.questionOwner(sessionId, callId)) return false;
    const question = (await this.questions(sessionId)).find((item) => item.callId === callId);
    if (!question?.actionable) return false;
    const named = new Set(answers.map((answer) => answer.id));
    if (named.size !== answers.length || answers.length !== question.questions.length || question.questions.some((item) => !named.has(item.id))) throw new Error("A native question answer must name each question exactly once.");
    for (const answer of answers) {
      const item = question.questions.find((item2) => item2.id === answer.id);
      if (new Set(answer.selected).size !== answer.selected.length || item.multiSelect !== true && answer.selected.length > 1 || answer.selected.some((label) => !item.options?.some((option) => option.label === label))) throw new Error("A native question answer contains an invalid option selection.");
    }
    const key = this.questionKey(sessionId, callId), wait = this.questionWaits.get(key);
    if (wait) {
      if (!await this.questionOwner(sessionId, callId) || this.questionWaits.get(key) !== wait || wait.signal?.aborted || this.ctx.agents.get(wait.agent.id) !== wait.agent || this.questionInboxBlocked(wait.agent, callId)) return false;
      wait.release();
      wait.resolve({ answers: structuredClone(answers) });
      return true;
    }
    if (question.state !== "continued") return false;
    const resolved = await this.ctx.sessionController.resolveAgent(SessionId(sessionId));
    if ("error" in resolved) throw resolved.error;
    const fresh = (await this.questions(sessionId)).find((item) => item.callId === callId);
    if (fresh?.state !== "continued" || !fresh.actionable) return false;
    const model = resume ? await this.resolveModel(resume.model) : void 0;
    if (!await this.questionOwner(sessionId, callId)) return false;
    if (this.ctx.agents.get(resolved.agent.id) !== resolved.agent || !this.ctx.agents.roots().includes(resolved.agent) || this.questionInboxBlocked(resolved.agent, callId)) return false;
    if (model && resume) this.selectAgentModel(resolved.agent, model, resume.requestId, callId);
    const clear = () => {
      const selection = this.selectedModels.get(resolved.agent);
      if (selection?.questionCallId === callId && selection.requestId === resume?.requestId) {
        selection.current = void 0;
        selection.assembled = void 0;
        selection.owningTurn = void 0;
        selection.questionCallId = void 0;
      }
    };
    try {
      const accepted = service.answer(resolved.agent, callId, { answers: structuredClone(answers) });
      if (accepted) this.notifyQuestionState(sessionId);
      else clear();
      return accepted;
    } catch (error) {
      clear();
      throw error;
    }
  }
  protectPlanning(sessionId, files) {
    if (files !== void 0) {
      const paths = /* @__PURE__ */ new Set();
      for (const file of files) {
        const ref = { ...file, attachmentId: file.attachmentId };
        const path = this.ctx.attachments.fileHostPath?.(ref);
        if (!path) throw new Error(`Planning attachment ${file.name} has no native readable file path in this environment.`);
        paths.add(path);
      }
      this.planningReadPaths.set(sessionId, paths);
    }
    this.planningSessions.add(sessionId);
    const agent = this.ctx.agents.get(SessionId(sessionId));
    if (agent) this.protectPlanningAgent(agent);
  }
  protectPlanningAgent(agent) {
    if (this.planningAgents.has(agent)) return;
    agent.ctx.tools.presentAs("native");
    agent.ctx.tools.guard((execution2) => {
      const path = record(execution2.arguments).file_path;
      if (execution2.name === "read" && !execution2.parent && execution2.agent === agent && typeof path === "string" && this.planningReadPaths.get(agent.id)?.has(path)) return void 0;
      return "Workflow plan generation cannot execute tools before plan approval; only its uploaded read-only planning files may be read";
    });
    this.planningAgents.add(agent);
  }
  async models() {
    const catalog = await this.ctx.sessionController.modelCatalog();
    const models = catalog.groups.flatMap((group2) => group2.models.map((model) => ({
      provider: group2.id,
      model: model.id,
      label: `${group2.name} / ${model.name}`,
      ...model.reasoning === void 0 ? {} : { reasoning: {
        efforts: model.reasoning.efforts.map((effort) => ({ id: effort.id, name: effort.name, ...effort.description === void 0 ? {} : { description: effort.description } })),
        ...model.reasoning.defaultEffort === void 0 ? {} : { defaultEffort: model.reasoning.defaultEffort }
      } }
    })));
    const selected = catalog.default;
    const defaultModel = models.some((model) => model.provider === selected.provider && model.model === selected.model) ? {
      provider: selected.provider,
      model: selected.model,
      ...selected.reasoningEffort === void 0 ? {} : { reasoningEffort: selected.reasoningEffort }
    } : void 0;
    return { models, ...defaultModel ? { defaultModel } : {} };
  }
  async listModels() {
    return (await this.models()).models;
  }
  async getDefaultModel() {
    return (await this.models()).defaultModel;
  }
  async resolveModel(selection) {
    const catalog = await this.models();
    const requested = selection ?? catalog.defaultModel;
    if (!requested) throw new Error("No available default model is configured in DSH. Choose an available model before running or planning.");
    const model = catalog.models.find((model2) => model2.provider === requested.provider && model2.model === requested.model);
    if (!model) throw new Error(`Model ${requested.provider}/${requested.model} is not currently available. Choose an available DSH model.`);
    const resolved = await this.ctx.llm.resolveCallConfig({
      provider: model.provider,
      model: model.model,
      ...requested.reasoningEffort === void 0 ? {} : { reasoningEffort: ReasoningEffortId(requested.reasoningEffort) }
    });
    return {
      provider: resolved.provider,
      model: resolved.model,
      ...resolved.reasoningEffort === void 0 ? {} : { reasoningEffort: String(resolved.reasoningEffort) }
    };
  }
  selectAgentModel(agent, model, requestId, questionCallId) {
    let selected = this.selectedModels.get(agent);
    if (selected) {
      selected.current = { ...model };
      selected.requestId = requestId;
      selected.questionCallId = questionCallId;
      selected.owningTurn = void 0;
      selected.assembled = void 0;
    } else {
      const state = { current: { ...model }, requestId, questionCallId };
      selected = state;
      this.selectedModels.set(agent, state);
      agent.ctx.on("agent/inbox/claimed", ({ message, turn: turn2 }) => {
        const source = record(message.source);
        const owns = state.questionCallId ? source.kind === "user-question-reply" && source.callId === state.questionCallId : source.kind === "user" && source.rpcId === state.requestId;
        if (owns && state.current) {
          state.owningTurn = turn2;
          agent.session.append("model/selection", { ...state.current });
        }
      });
      const ownsOpenTurn = () => {
        if (state.owningTurn === void 0) return false;
        const last = agent.session.snapshotEvents().findLast((event) => event.type === "turn/start" || event.type === "turn/end");
        return last?.type === "turn/start" && last.data.turn === state.owningTurn;
      };
      agent.ctx.on("system-prompt/assemble", async (_assembly, _context, next) => {
        const choice = ownsOpenTurn() ? state.current : void 0;
        const assembly = await next();
        state.assembled = choice;
        if (!choice) return assembly;
        return { ...assembly, variables: { ...assembly.variables, provider: choice.provider, model: choice.model } };
      }, { prepend: true });
      agent.ctx.on("agent/request", async ({ turn: turn2 }, next) => {
        const config = await next();
        const choice = state.owningTurn === turn2 ? state.assembled ?? state.current : void 0;
        if (!choice) return config;
        const { reasoningEffort: _inheritedEffort, ...rest } = config;
        return {
          ...rest,
          provider: choice.provider,
          model: choice.model,
          ...choice.reasoningEffort === void 0 ? {} : { reasoningEffort: ReasoningEffortId(choice.reasoningEffort) }
        };
      }, { prepend: true });
      agent.ctx.on("agent/pre-step", async ({ messages, signal, step, turn: turn2 }, next) => {
        const decision = await next();
        if (decision.kind === "reject" || signal.aborted || decision.messages.length === 0 && (step === 1 || messages.length > 0)) return decision;
        const choice = state.owningTurn === turn2 ? state.assembled ?? state.current : void 0;
        const previous = agent.session.requestHeader()?.config;
        if (!choice || !previous || previous.provider === choice.provider && previous.model === choice.model) return decision;
        const before = `${previous.provider}/${previous.model}`, after = `${choice.provider}/${choice.model}`;
        const notice = createUserMessage({ content: [{ type: "text", text: `[model changed: assistant turns above this point were generated by ${before}; the session continues with ${after}]` }], source: { kind: "model-selection", form: "notice", summary: boundContextSummary(`${before} \u2192 ${after}`) } });
        return { ...decision, messages: [...decision.messages, notice] };
      }, { prepend: true });
    }
  }
  async catalog(signal = new AbortController().signal) {
    const { items } = await this.ctx.sessionController.list({}, signal);
    return Promise.all(items.map(async (item) => {
      signal.throwIfAborted();
      const projectedTitle = item.projections?.values.title;
      const title = typeof projectedTitle === "string" ? projectedTitle : (await this.ctx.sessionQuery.readTitle(SessionId(item.sessionId), signal).catch(() => void 0))?.title;
      return {
        sessionId: item.sessionId,
        title: title || item.sessionId,
        updatedAt: item.updatedAt,
        running: item.running,
        blank: item.blank,
        ...item.parentSessionId ? { parentSessionId: item.parentSessionId } : {},
        ...item.cwd ? { cwd: item.cwd } : {},
        ...item.formatStatus ? { formatStatus: item.formatStatus } : {}
      };
    }));
  }
  async read(sessionId) {
    const snapshot = await this.ctx.sessionQuery.readSession(SessionId(sessionId));
    return {
      sessionId: snapshot.session.id,
      header: { ...snapshot.session },
      inheritedEventCount: snapshot.inheritedEventCount,
      events: snapshot.events
    };
  }
  async create(options = {}) {
    if (options.sessionId) {
      const present = await this.catalog();
      if (present.some((item) => item.sessionId === options.sessionId)) throw new Error("Refusing to reuse an existing source Session");
    }
    return this.ctx.sessionController.create({
      ...options,
      ...options.sessionId ? { sessionId: SessionId(options.sessionId) } : { sessionId: void 0 }
    });
  }
  async fork(request) {
    if (this.ctx.sessions.get(SessionId(request.sessionId))) await this.flush(request.sessionId);
    const source = await this.read(request.sessionId);
    completedBoundary(source, request.atSeq);
    const result = await this.ctx.sessionController.fork({ sessionId: SessionId(request.sessionId), atSeq: request.atSeq, allowMigration: false });
    if (result.sessionId === request.sessionId) throw new Error("Native fork returned the source Session identity");
    return { sessionId: result.sessionId, inheritedEventCount: request.atSeq + 1 };
  }
  /** Optional native capability: ordinary execution still works when it is absent. */
  supportsSubagents() {
    const provider = this.ctx.get("subagents")?.getProvider("fork");
    return !!provider && provider.inheritsParentContext && typeof provider.prepareContinuable === "function" && provider.capabilities.agentOptions;
  }
  async startSubagent(request) {
    const subagents = this.ctx.get("subagents");
    if (!subagents || !this.supportsSubagents()) throw new Error("The native rc.3 fork subagent provider is unavailable.");
    if (this.subagentsStopping) throw new Error("Workflow native subagents are stopping.");
    if (!request.text.trim() || !request.childSessionId || request.parentSessionId === request.childSessionId) throw new Error("A native subagent requires a nonempty task and an independent reserved child Session.");
    if (this.subagentActivations.has(request.childSessionId) || this.subagentStarts.has(request.childSessionId)) throw new Error("This native child Session already has an owned activation.");
    const model = await this.resolveModel(request.model);
    const content = [{ type: "text", text: request.text }];
    for (const file of request.files ?? []) {
      const ref = { ...file, attachmentId: file.attachmentId };
      let bytes = 0;
      for await (const chunk of this.ctx.attachments.readFileStream(ref)) {
        bytes += chunk.byteLength;
        if (!Number.isSafeInteger(bytes) || bytes > ref.bytes) throw new Error("Native subagent attachment length does not match its verified reference.");
      }
      if (bytes !== ref.bytes) throw new Error("Native subagent attachment length does not match its verified reference.");
      content.push({ type: "file", attachment: ref });
    }
    const resolved = await this.ctx.sessionController.resolveAgent(SessionId(request.parentSessionId));
    if ("error" in resolved) throw resolved.error;
    const parent = resolved.agent;
    if (parent.status !== "idle" || parent.inbox.nextStep.length || parent.inbox.nextTurn.length) throw new Error("The private subagent coordinator must be idle before native delegation.");
    if (this.subagentsStopping) throw new Error("Workflow native subagents are stopping.");
    if (this.subagentActivations.has(request.childSessionId) || this.subagentStarts.has(request.childSessionId)) throw new Error("This native child Session already has an owned activation.");
    let sandboxMode;
    if (request.accessMode) {
      const permissions = this.ctx.get("permissionPresets");
      if (request.accessMode === "auto") throw new Error("Native automatic approval review requires an ordinary Session; owned child Agents retain approval=never.");
      if (!permissions?.catalog().options.some((option) => option.value === request.accessMode)) throw new Error("The selected native permission preset is not currently available for this child.");
      sandboxMode = permissions.resolve(request.accessMode).sandbox;
    }
    const controller = new AbortController();
    const maxDepth = subagents.resolveMaxDepth();
    if (sandboxMode) this.subagentSandboxModes.set(request.childSessionId, { parentSessionId: request.parentSessionId, mode: sandboxMode });
    let flight;
    try {
      flight = subagents.startActivation({ provider: "fork", label: request.label || "Workflow task", childId: SessionId(request.childSessionId), delivery: "caller", signal: controller.signal, request: { parent, prompt: content, agentOptions: { provider: model.provider, model: model.model, ...model.reasoningEffort === void 0 ? {} : { reasoningEffort: ReasoningEffortId(model.reasoningEffort) } }, ...maxDepth === void 0 ? {} : { maxDepth } } });
    } catch (error) {
      this.subagentSandboxModes.delete(request.childSessionId);
      throw error;
    }
    const pending = { controller, flight };
    this.subagentStarts.set(request.childSessionId, pending);
    try {
      const activation = await flight;
      if (this.subagentsStopping) {
        await activation.dispose();
        throw new Error("Workflow stopped while the native child was being admitted.");
      }
      this.subagentActivations.set(request.childSessionId, activation);
      void activation.result.catch((error) => {
        this.ctx.logger.error("Workflow native subagent settlement failed", error);
      }).finally(() => {
        if (this.subagentActivations.get(request.childSessionId) === activation) this.subagentActivations.delete(request.childSessionId);
      }).catch(() => {
      });
      if (activation.childId !== request.childSessionId || !activation.messageId) {
        await activation.dispose();
        throw new Error("The native provider did not retain the reserved child identity and initial message.");
      }
      return { messageId: activation.messageId };
    } finally {
      if (this.subagentStarts.get(request.childSessionId) === pending) this.subagentStarts.delete(request.childSessionId);
      this.subagentSandboxModes.delete(request.childSessionId);
    }
  }
  async cancelSubagent(childSessionId) {
    const owned = this.subagentActivations.get(childSessionId);
    if (owned) {
      await owned.dispose();
      return;
    }
    const pending = this.subagentStarts.get(childSessionId);
    if (pending) {
      pending.controller.abort(new Error("Workflow native subagent startup was cancelled."));
      await pending.flight.then((activation) => activation.dispose(), () => {
      });
      return;
    }
    const subagents = this.ctx.get("subagents");
    const child = this.ctx.agents.get(SessionId(childSessionId));
    const parentId = child?.session.header.parentSession;
    const parent = parentId ? this.ctx.agents.get(parentId) : void 0;
    if (!subagents || !child || child.session.header.origin !== "subagent" || !parent) throw new Error("No live native subagent activation and coordinator are available to cancel; no Session was resumed.");
    subagents.interrupt(child.id, { kind: "ancestor", agent: parent });
    await child.whenIdle();
  }
  async disposeSubagents() {
    this.subagentsStopping = true;
    const starts = [...this.subagentStarts.values()];
    for (const pending of starts) pending.controller.abort(new Error("Workflow native subagents are stopping."));
    const outcomes = await Promise.allSettled([...this.subagentActivations.values()].map((activation) => activation.dispose()).concat(starts.map((pending) => pending.flight.then((activation) => activation.dispose(), () => {
    }))));
    this.subagentActivations.clear();
    this.subagentSandboxModes.clear();
    const errors = outcomes.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, "Native Workflow subagents could not all be released.");
  }
  async resolveUploadedFile(sessionId, receiptId) {
    const resolved = await this.ctx.sessionController.resolveAgent(SessionId(sessionId));
    if ("error" in resolved) throw resolved.error;
    const file = this.ctx.fileUploads.resolve(resolved.agent, receiptId);
    if (!file) throw new Error("File was not uploaded for this Session, or its upload receipt has expired. Upload the file again.");
    return { attachmentId: String(file.attachmentId), name: file.name, bytes: file.bytes };
  }
  async submit(request) {
    if (!request.text.trim() || !request.requestId) throw new Error("Execution needs a nonempty prompt and persisted request ID");
    let selectedAgent;
    if (request.model) {
      const resolved = await this.ctx.sessionController.resolveAgent(SessionId(request.sessionId));
      if ("error" in resolved) throw resolved.error;
      selectedAgent = resolved.agent;
      const owns = (message) => {
        const source = record(message.source);
        return source.kind === "user" && source.rpcId === request.requestId;
      };
      if (selectedAgent.session.snapshotEvents().some((event) => event.type === "user/message" && owns(event.data)) || [...selectedAgent.inbox.nextStep, ...selectedAgent.inbox.nextTurn].some(owns)) return;
      if (selectedAgent.status === "running") throw new Error("Wait for the current native execution to finish before selecting the next task model.");
    }
    if (request.planning) {
      this.protectPlanning(request.sessionId, request.files ?? []);
      const resolved = await this.ctx.sessionController.resolveAgent(SessionId(request.sessionId));
      if ("error" in resolved) throw resolved.error;
      this.protectPlanningAgent(resolved.agent);
    }
    const content = [{ type: "text", text: request.text }];
    for (const file of request.files ?? []) {
      const ref = { ...file, attachmentId: file.attachmentId };
      const uploaded = await this.ctx.fileUploads.uploadStream({ sessionId: SessionId(request.sessionId), name: ref.name, data: this.ctx.attachments.readFileStream(ref) });
      if (uploaded.file.attachmentId !== ref.attachmentId || uploaded.file.bytes !== ref.bytes || uploaded.file.name !== ref.name) throw new Error("Native attachment changed while preparing this execution.");
      content.push({ type: "file", receiptId: uploaded.receiptId });
    }
    if (request.model) {
      const chosen = await this.resolveModel(request.model);
      this.selectAgentModel(selectedAgent, chosen, request.requestId);
    }
    try {
      await this.ctx.sessionController.prompt({
        sessionId: SessionId(request.sessionId),
        requestId: request.requestId,
        mode: "queue",
        content,
        ...request.clientTimeZone ? { clientTimeZone: request.clientTimeZone } : {}
      }, new AbortController().signal);
    } catch (error) {
      const selection = selectedAgent && this.selectedModels.get(selectedAgent);
      if (selection?.requestId === request.requestId) {
        selection.current = void 0;
        selection.assembled = void 0;
        selection.owningTurn = void 0;
      }
      throw error;
    }
  }
  async cancel(sessionId, requestId) {
    const id2 = SessionId(sessionId);
    const agent = this.ctx.agents.get(id2);
    if (!agent) return "none";
    if (!requestId) {
      this.ctx.sessionController.cancel({ sessionId: id2 });
      return "active";
    }
    const queued = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].filter((message) => message.source.kind === "user" && "rpcId" in message.source && message.source.rpcId === requestId);
    let removed = false;
    for (const message of queued) {
      try {
        await this.ctx.sessionController.updateQueue({ sessionId: id2, itemId: message.id, action: { kind: "remove" } });
        removed = true;
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "session/queue-item-not-found") throw error;
      }
    }
    const events = agent.session.snapshotEvents();
    const start = events.findLastIndex((event) => event.type === "turn/start");
    if (start < 0 || events.slice(start).some((event) => event.type === "turn/end")) return removed ? "queued" : "none";
    const ownsOpenTurn = events.slice(start).some((event) => event.type === "user/message" && event.data.source.kind === "user" && "rpcId" in event.data.source && event.data.source.rpcId === requestId);
    if (ownsOpenTurn) {
      this.ctx.sessionController.cancel({ sessionId: id2 });
      return "active";
    }
    return removed ? "queued" : "none";
  }
  async flush(sessionId) {
    const session = this.ctx.sessions.get(SessionId(sessionId));
    if (session && !await this.ctx.sessions.flush(session)) throw new Error("Session has no native durability listener");
  }
  subscribe(listener) {
    const dispose = this.ctx.on("session/event", (session, event) => listener(session.id, event));
    this.questionListeners.add(listener);
    return () => {
      this.questionListeners.delete(listener);
      void dispose();
    };
  }
  isRunning(sessionId) {
    const agent = this.ctx.agents.get(SessionId(sessionId));
    return !!agent && (agent.status === "running" || agent.inbox.nextStep.length > 0 || agent.inbox.nextTurn.length > 0);
  }
  async waitForIdle(sessionId) {
    await this.ctx.agents.get(SessionId(sessionId))?.whenIdle();
  }
};
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function normalizeQuestionItems(value) {
  if (!Array.isArray(value) || !value.length) return;
  const result = [];
  for (const item of value) {
    const row = record(item);
    if (typeof row.id !== "string" || typeof row.question !== "string") return;
    const options = Array.isArray(row.options) ? row.options.map((value2) => record(value2)) : void 0;
    if (options?.some((option) => typeof option.label !== "string" || option.description !== void 0 && typeof option.description !== "string")) return;
    result.push({ id: row.id, question: row.question, ...typeof row.detail === "string" ? { detail: row.detail } : {}, ...typeof row.header === "string" ? { header: row.header } : {}, ...options ? { options: options.map((option) => ({ label: option.label, ...typeof option.description === "string" ? { description: option.description } : {} })) } : {}, ...typeof row.multiSelect === "boolean" ? { multiSelect: row.multiSelect } : typeof row.multi_select === "boolean" ? { multiSelect: row.multi_select } : {} });
  }
  return new Set(result.map((item) => item.id)).size === result.length ? result : void 0;
}

// src/host/trace-projector.ts
var DETAIL_LIMIT = 2e5;
var SUMMARY_LIMIT = 4e3;
var TARGET_LIMIT = 240;
var object2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var string = (value) => typeof value === "string" ? value : void 0;
var number = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
var reasonKind = (event) => string(object2(event.data.reason).kind);
function observableText(content) {
  if (!Array.isArray(content)) return "";
  return content.map((item) => object2(item)).filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n");
}
function requestIdOf(message) {
  const source = object2(object2(message).source);
  return source.kind === "user" ? string(source.rpcId) : void 0;
}
function contentOf(event) {
  return object2(event.data.message).content ?? event.data.content;
}
function ownedTurns(log, identity) {
  const turns = /* @__PURE__ */ new Set();
  const questions = /* @__PURE__ */ new Set();
  let turn2;
  const lower = Math.max(log.inheritedEventCount, identity.startSeq ?? 0);
  for (const event of log.events) {
    if (event.seq < lower) continue;
    if (event.type === "turn/start") turn2 = number(event.data.turn);
    const source = object2(event.data.source);
    if (event.type === "user/message" && (requestIdOf(event.data) === identity.requestId || identity.messageId !== void 0 && source.kind === "user" && event.data.id === identity.messageId || source.kind === "user-question-reply" && source.outcome === "answered" && questions.has(String(source.callId))) && turn2 !== void 0) turns.add(turn2);
    if (turn2 !== void 0 && turns.has(turn2) && event.data.name === "ask_user_question") {
      const callId = event.type === "tool/call" ? string(event.data.callId) : event.type === "tool/ptc-dispatch-start" || event.type === "tool/ptc-dispatch" ? string(event.data.subCallId) : void 0;
      if (callId) questions.add(callId);
    }
    if (event.type === "turn/end") turn2 = void 0;
  }
  return turns;
}
function eventTurn(event, current) {
  return number(event.data.turn) ?? current;
}
function terminalStatus(reason) {
  switch (reason) {
    case "completed":
      return "completed";
    case "aborted":
      return "cancelled";
    case "blocked":
      return "blocked";
    case "interrupted":
    case "forked":
      return "interrupted";
    case "error":
    case "max-tokens":
      return "failed";
    default:
      return "unknown";
  }
}
function toolType(name) {
  if (["bash", "pwsh"].includes(name)) return "command";
  if (["read", "read_image", "write", "edit", "str_replace_editor"].includes(name)) return "file_operation";
  return "tool_call";
}
function titleForTool(name) {
  return name || "Tool invocation";
}
function bounded(text, limit) {
  const suffix = "\n[Recorded text truncated in this view]";
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - suffix.length))}${suffix.slice(0, limit)}` : text;
}
function toolArguments(raw) {
  if (typeof raw !== "string") return object2(raw);
  try {
    return object2(JSON.parse(raw));
  } catch {
    return {};
  }
}
function targetPreview(value) {
  if (typeof value !== "string") return void 0;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return void 0;
  if (text.length <= TARGET_LIMIT) return text;
  let end = TARGET_LIMIT - 1;
  if (text.charCodeAt(end - 1) >= 55296 && text.charCodeAt(end - 1) <= 56319) end--;
  return `${text.slice(0, end).trimEnd()}\u2026`;
}
function toolAction(name, raw, declarations) {
  const args = toolArguments(raw);
  let actionKind = "tool";
  let value;
  if (name === "read" || name === "read_image") {
    actionKind = "read";
    value = args.file_path;
  } else if (name === "edit" || name === "write") {
    actionKind = name;
    value = args.file_path;
  } else if (name === "bash" || name === "pwsh") {
    actionKind = "command";
    value = args.command;
  } else if (name === "str_replace_editor") {
    if (args.command === "view") actionKind = "read";
    else if (args.command === "create") actionKind = "write";
    else if (args.command === "str_replace" || args.command === "insert") actionKind = "edit";
    if (actionKind !== "tool") value = args.path;
  } else if (name === "web_search" || name === "web_fetch") {
    actionKind = name === "web_search" ? "search" : "fetch";
    const field = name === "web_search" ? "query" : "url";
    const properties = object2(object2(declarations.get(name)?.parameters).properties);
    if (object2(properties[field]).type === "string") value = args[field];
  }
  const target = targetPreview(value);
  return { actionKind, ...target ? { target } : {} };
}
function projectExecution(log, identity) {
  const turns = ownedTurns(log, identity);
  const steps = /* @__PURE__ */ new Map();
  const result = { status: "queued", turns: [...turns], steps: [], assistantText: "", cursor: log.events.at(-1)?.seq ?? -1 };
  let currentTurn;
  let currentStep;
  let lastTerminal;
  let declarations = /* @__PURE__ */ new Map();
  const prefix = `${identity.runId}:`;
  const lower = Math.max(log.inheritedEventCount, identity.startSeq ?? 0);
  const put = (id2, event, fields) => {
    const prior = steps.get(id2);
    const next = { ...fields, stepId: id2, eventStartSeq: prior?.eventStartSeq ?? event.seq, timestamp: prior?.timestamp ?? event.time };
    if (prior) Object.assign(prior, fields);
    else steps.set(id2, next);
    return steps.get(id2);
  };
  for (const event of log.events) {
    if (event.type === "request/header") {
      const tools = object2(event.data.header).tools;
      declarations = new Map(Array.isArray(tools) ? tools.map(object2).filter((tool) => typeof tool.name === "string").map((tool) => [tool.name, tool]) : []);
    }
    if (event.seq < lower) continue;
    if (event.type === "turn/start") {
      currentTurn = number(event.data.turn);
      currentStep = void 0;
    }
    if (event.type === "step/start") currentStep = number(event.data.step);
    const turn2 = eventTurn(event, currentTurn);
    if (turn2 !== void 0 && turns.has(turn2)) {
      if (result.startSeq === void 0) result.startSeq = event.seq;
      result.status = "running";
      const stepNumber = number(event.data.step) ?? currentStep;
      const agentStepId = `${prefix}step:${turn2}:${stepNumber}`;
      const data = event.data;
      if (event.type === "step/start") put(agentStepId, event, { type: "agent_step", title: `Agent step ${String(stepNumber)}`, status: "running" });
      if (event.type === "step/end") {
        const existing = steps.get(agentStepId);
        if (existing) {
          existing.eventEndSeq = event.seq;
          existing.status = "completed";
        }
      }
      if (event.type === "assistant/message") result.assistantText += `${result.assistantText ? "\n" : ""}${observableText(contentOf(event))}`;
      if (event.type === "tool/call") {
        const callId = string(data.callId);
        const name = string(data.name) ?? "";
        if (callId) put(`${prefix}tool:${callId}`, event, { type: toolType(name), title: titleForTool(name), status: "running", toolName: name, callId, parentStepId: agentStepId, ...toolAction(name, data.arguments, declarations) });
      }
      if (event.type === "tool/result") {
        const message = object2(data.message);
        const callId = string(message.toolCallId) ?? string(object2(message.source).callId);
        if (callId) {
          const id2 = `${prefix}tool:${callId}`;
          const prior = steps.get(id2);
          const next = put(id2, event, {
            type: prior?.type ?? "tool_call",
            title: prior?.title ?? "Tool result",
            status: message.isError === true ? "failed" : "completed",
            callId,
            ...prior?.toolName ? { toolName: prior.toolName } : {},
            parentStepId: agentStepId
          });
          next.eventEndSeq = event.seq;
        }
      }
      if (event.type === "tool/ptc-dispatch-start" || event.type === "tool/ptc-dispatch") {
        const callId = string(data.subCallId);
        const name = string(data.name) ?? "";
        const parent = string(data.parentCallId);
        if (callId) {
          const next = put(`${prefix}ptc:${callId}`, event, {
            type: toolType(name),
            title: titleForTool(name),
            status: event.type === "tool/ptc-dispatch-start" ? "running" : data.isError === true ? "failed" : "completed",
            toolName: name,
            callId,
            ...toolAction(name, data.arguments, declarations),
            ...parent ? { parentStepId: steps.has(`${prefix}ptc:${parent}`) ? `${prefix}ptc:${parent}` : `${prefix}tool:${parent}` } : {}
          });
          if (event.type === "tool/ptc-dispatch") next.eventEndSeq = event.seq;
        }
      }
      if (event.type === "approval/asked") {
        const approvalId = string(data.id);
        if (approvalId) put(`${prefix}approval:${approvalId}`, event, {
          type: "approval",
          title: `Approval: ${string(data.toolName) ?? "tool"}`,
          status: "waiting_approval",
          ...string(data.toolName) ? { toolName: string(data.toolName) } : {},
          ...string(data.callId) ? { callId: string(data.callId) } : {},
          parentStepId: agentStepId
        });
      }
      if (event.type === "approval/decided") {
        const approval2 = steps.get(`${prefix}approval:${String(data.id)}`);
        if (approval2) {
          approval2.eventEndSeq = event.seq;
          approval2.status = data.outcome === "allowed-once" ? "completed" : data.outcome === "rejected" || data.outcome === "unavailable" ? "blocked" : data.outcome === "cancelled" ? "cancelled" : "unknown";
        }
      }
      if (event.type === "turn/end") {
        lastTerminal = event;
        result.endSeq = event.seq;
        result.terminalReason = reasonKind(event);
        result.status = terminalStatus(result.terminalReason);
        if (result.status === "failed") put(`${prefix}error:${event.seq}`, event, { type: "error", title: "Execution error", status: "failed", eventEndSeq: event.seq });
      }
    }
    if (event.type === "turn/end") {
      currentTurn = void 0;
      currentStep = void 0;
    }
  }
  if (turns.size && lastTerminal && log.events.some((event) => event.seq > lastTerminal.seq && event.type === "turn/start" && turns.has(Number(event.data.turn)))) {
    delete result.endSeq;
    delete result.terminalReason;
    result.status = identity.running ? "running" : "unknown";
  }
  if (turns.size && !lastTerminal) result.status = identity.running ? "running" : "unknown";
  if (result.status === "running" && [...steps.values()].some((step) => step.type === "approval" && step.status === "waiting_approval")) result.status = "waiting_approval";
  for (const step of steps.values()) {
    if (step.status === "running" || step.status === "waiting_approval") {
      if (result.endSeq !== void 0) step.status = result.status === "completed" ? "unknown" : result.status;
      else if (!identity.running && turns.size) step.status = "unknown";
    }
  }
  result.steps = [...steps.values()].sort((a, b) => a.eventStartSeq - b.eventStartSeq || a.stepId.localeCompare(b.stepId));
  result.assistantText = bounded(result.assistantText, SUMMARY_LIMIT);
  return result;
}
function assistantTextForRequest(log, requestId) {
  const turns = ownedTurns(log, { runId: "", requestId });
  return bounded(log.events.filter((event) => event.type === "assistant/message" && turns.has(Number(event.data.turn))).map((event) => observableText(contentOf(event))).join("\n"), DETAIL_LIMIT);
}
function readTraceStepDetails(log, projection, stepId) {
  const step = projection.steps.find((item) => item.stepId === stepId);
  if (!step) throw new Error("Execution step does not belong to this native event projection");
  const first = log.events.find((event) => event.seq === step.eventStartSeq);
  const last = log.events.find((event) => event.seq === step.eventEndSeq);
  if (!first) throw new Error("Referenced native event is unavailable");
  const detail = {
    eventName: first.type,
    time: first.time,
    status: step.status,
    truncated: false,
    ...step.toolName ? { toolName: step.toolName } : {}
  };
  if (first.type === "tool/call" || first.type === "tool/ptc-dispatch-start" || first.type === "tool/ptc-dispatch") {
    const raw = first.data.arguments;
    detail.input = typeof raw === "string" ? raw : raw === void 0 ? void 0 : JSON.stringify(raw, null, 2);
    if (step.type === "command") {
      let args = object2(raw);
      if (typeof raw === "string") {
        try {
          args = object2(JSON.parse(raw));
        } catch {
        }
      }
      detail.command = string(args.command) ?? string(args.cmd);
    }
  }
  if (last?.type === "tool/result") {
    detail.output = observableText(object2(last.data.message).content);
    const error = object2(last.data.error);
    if (Object.keys(error).length) detail.error = string(error.reason) ?? string(error.code) ?? string(error.name);
  }
  if (last?.type === "tool/ptc-dispatch" || first.type === "tool/ptc-dispatch") {
    const result = last?.type === "tool/ptc-dispatch" ? last : first;
    detail.output = observableText(result.data.content);
    if (result.data.isError === true) detail.error = string(object2(result.data.error).reason) ?? string(object2(result.data.error).message) ?? "Tool reported failure";
  }
  if (first.type === "approval/asked") {
    detail.input = string(first.data.reason);
    detail.output = last?.type === "approval/decided" ? string(last.data.outcome) : void 0;
  }
  if (first.type === "turn/end") {
    const reason = object2(first.data.reason);
    const error = object2(reason.error);
    detail.error = string(error.message) ?? string(reason.kind);
  }
  for (const key of ["input", "command", "output", "error"]) {
    const value = detail[key];
    if (value && value.length > DETAIL_LIMIT) {
      detail[key] = bounded(value, DETAIL_LIMIT);
      detail.truncated = true;
    }
  }
  return detail;
}

// src/host/storage-retry.ts
import { win32 } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
function isWorkflowRenameBeforeCommit(error, platform = process.platform) {
  if (platform !== "win32" || !(error instanceof Error)) return false;
  const failure = error;
  if (!["EPERM", "EACCES", "EBUSY"].includes(failure.code ?? "") || failure.syscall !== "rename" || typeof failure.path !== "string" || typeof failure.dest !== "string") return false;
  if (!win32.isAbsolute(failure.path) || !win32.isAbsolute(failure.dest) || win32.basename(failure.dest) !== "visual_workflow.json") return false;
  if (!/^\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i.test(win32.basename(failure.path))) return false;
  return win32.normalize(win32.dirname(failure.path)).toLowerCase() === win32.normalize(win32.dirname(failure.dest)).toLowerCase();
}
async function updateWorkflowMetadata(table, id2, transform, options = {}) {
  let baseline, lastFailure;
  for (let attempt = 0; ; attempt++) {
    try {
      return await table.update(id2, (current) => {
        if (baseline !== void 0 && current.revision !== baseline) throw lastFailure;
        baseline = current.revision;
        return transform(current);
      });
    } catch (error) {
      if (attempt >= 2 || baseline === void 0 || !isWorkflowRenameBeforeCommit(error, options.platform) || table.get(id2)?.revision !== baseline) throw error;
      lastFailure = error;
      await (options.wait ?? pause)(attempt === 0 ? 25 : 75);
      if (table.get(id2)?.revision !== baseline) throw error;
    }
  }
}

// src/host/planning.ts
function buildPlanningInstruction(goal) {
  return `You are drafting a proposed task plan for a native Agent that will perform the user's requested work.

Planning objective:
- Deliver the outcome in Current user goal directly. A workflow is the Agent's execution sequence for that outcome. Preserve the user's task type, requested deliverable, scope, ordering and language.
- Use the smallest useful plan. Usually 1-5 executable tasks are sufficient; use more only when the user's explicit scope requires distinct steps. The schema limit of 100 tasks is a ceiling, not a target.
- Write short, outcome-oriented titles and actionable instructions in the user's language. Each task must perform useful work and return its actual result, evidence or artifact. Combine routine setup, formatting and checks into that task.
- Lookup, weather, research and analysis requests should produce lookup, research and analysis actions using the Agent's existing native capabilities. A request to query information does not request a new application, API integration project, reusable module, implementation specification, test suite or README. Propose software development artifacts only when the user actually requests building or changing software. When a necessary native capability is unavailable, report that limitation or ask for the required information instead of expanding the goal into a replacement software project.
- Resolve material ambiguities explicitly. Keep a necessary clarification in the first affected task; require user clarification before proceeding when the available context cannot determine the answer. Do not silently invent a city list, date, location or definition, and do not split a simple ambiguity into an unrelated requirements project.
- Current user goal defines the task. Inherited conversation history and attachments can supply relevant facts and constraints; do not turn an unrelated earlier project into this goal's deliverable.

Dependencies:
- Every task MUST include dependsOn. Use [] only for independently runnable tasks. Use prerequisite task ids when a task must wait. Preserve explicit "first ... then ..." requirements with dependency edges, not merely list order.
- For example, "\u5148\u67E5\u8BE2\u676D\u5DDE\u5929\u6C14\uFF0C\u7136\u540E\u67E5\u8BE2\u5B81\u6CE2\u5929\u6C14" is a two-task query plan: {"tasks":[{"id":"task-1","title":"\u67E5\u8BE2\u676D\u5DDE\u5929\u6C14","instruction":"\u67E5\u8BE2\u676D\u5DDE\u5F53\u524D\u5929\u6C14\uFF0C\u8FD4\u56DE\u67E5\u8BE2\u65F6\u95F4\u3001\u5929\u6C14\u3001\u6E29\u5EA6\u548C\u53EF\u6838\u5B9E\u7684\u6570\u636E\u6765\u6E90\u3002","dependsOn":[]},{"id":"task-2","title":"\u67E5\u8BE2\u5B81\u6CE2\u5929\u6C14","instruction":"\u4E0A\u4E00\u6B65\u5B8C\u6210\u540E\u67E5\u8BE2\u5B81\u6CE2\u5F53\u524D\u5929\u6C14\uFF0C\u8FD4\u56DE\u67E5\u8BE2\u65F6\u95F4\u3001\u5929\u6C14\u3001\u6E29\u5EA6\u548C\u6570\u636E\u6765\u6E90\uFF0C\u5E76\u7B80\u8981\u6C47\u603B\u4E24\u6B21\u67E5\u8BE2\u7ED3\u679C\u3002","dependsOn":["task-1"]}]}. This is an example of granularity and ordering; use the actual cities and constraints from Current user goal.
- Use unique ASCII ids, references only to tasks in this plan, and no cycles. Preserve necessary parallel branches; do not manufacture dependencies just to fill a chain.

Planning-stage permissions:
Do not execute the proposed tasks or modify files now. You may use the native read tool only to inspect attached uploaded files at their supplied read-only paths. Other files, commands, writes, delegation and code execution are forbidden before plan approval. If an attachment cannot be read by the native read tool, report that limitation without claiming to have inspected its contents. These are planning-stage restrictions; future task instructions should describe the actual requested work with the native capabilities available at execution time.

Output:
Return only one JSON object of this exact shape: {"tasks":[{"id":"task-1","title":"short title in the user's language","instruction":"actual work to perform and requested result","dependsOn":[]}]}. Use 1-100 tasks. Accepted plans create Draft tasks. Each task runs only after its own explicit user Run click; accepting a plan never runs its tasks.

Before returning, check that every proposed task is necessary for the requested outcome, the task type and language match the goal, and the graph preserves the requested order. Remove unrequested development deliverables and redundant meta-planning steps.

Current user goal:
${goal}`;
}

// src/host/workflow-identity.ts
function assignNodeNumbers(workflow) {
  const ledger = { ...workflow.nodeSerials }, used = new Set(Object.values(ledger));
  let next = Math.max(1, workflow.nextDisplayId ?? 1, ...Object.values(ledger).map((value) => value + 1));
  const nodes = workflow.nodes.map((node2) => {
    let displayId = ledger[node2.id];
    if (displayId === void 0) {
      if (node2.displayId !== void 0 && !used.has(node2.displayId)) {
        displayId = node2.displayId;
      } else {
        while (used.has(next)) next++;
        displayId = next++;
      }
      ledger[node2.id] = displayId;
      used.add(displayId);
      next = Math.max(next, displayId + 1);
    }
    return { ...node2, displayId };
  });
  return { ...workflow, nodes, nodeSerials: ledger, nextDisplayId: next };
}
function taskCaption(node2) {
  return `#${node2.displayId ?? "?"} ${node2.title.replace(/\s+/g, " ").trim().slice(0, 46) || "\u4EFB\u52A1"}`;
}
function branchCaption(from, label) {
  const summary = label.replace(/\s+/g, " ").trim().slice(0, 38);
  return from ? `\u4ECE ${taskCaption(from)} \u5F00\u59CB\u5206\u652F${summary && summary !== from.title ? ` \xB7 ${summary}` : ""}` : `\u4E3B\u7EBF \xB7 ${summary || "\u4EFB\u52A1"}`;
}
function nativeSessionCaption(workflow, node2, branchLabel) {
  const scope = branchLabel && branchLabel.startsWith("\u4ECE ") ? ` \xB7 ${branchLabel}` : "";
  return `${workflow.name.replace(/\s+/g, " ").trim().slice(0, 38)}${scope} \xB7 ${taskCaption(node2)}`.slice(0, 160);
}

// src/host/native-controls.ts
import { SessionId as SessionId2 } from "@deepseek-ai/dsh-session";
var object3 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var NativeControls = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.stop = ctx.on("approval/request", async (request, next) => {
      if (this.stopped || !this.owner) return next();
      const approval2 = this.unsettled(request.agent.session.ownEvents()).filter((item) => item.data.toolName === request.toolName && item.data.callId === request.callId);
      if (approval2.length !== 1) return next();
      const event = approval2[0], approvalId = String(event.data.id), sessionId = request.agent.id;
      if (!await this.owner(sessionId, request.callId, approvalId)) return next();
      if (this.stopped) return next();
      if (request.signal?.aborted) return "cancelled";
      if (this.ctx.get("agents")?.get(request.agent.id) !== request.agent) return next();
      const key = this.key(sessionId, approvalId);
      if (this.waits.has(key)) return next();
      return new Promise((resolve) => {
        const abort = () => {
          wait.release();
          resolve("cancelled");
        };
        const wait = { agent: request.agent, approval: this.present(sessionId, event, request.agent.session.ownEvents(), true, request), signal: request.signal, resolve, release: () => {
          request.signal?.removeEventListener("abort", abort);
          if (this.waits.get(key) === wait) this.waits.delete(key);
          this.notify(sessionId);
        } };
        this.waits.set(key, wait);
        request.signal?.addEventListener("abort", abort, { once: true });
        this.notify(sessionId);
        if (request.signal?.aborted) abort();
      });
    }, { prepend: true });
  }
  owner;
  waits = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  stop;
  stopped = false;
  available() {
    return !!this.ctx.get("permissionPresets");
  }
  setApprovalOwner(owns) {
    this.owner = owns;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  key(sessionId, approvalId) {
    return `${sessionId}\0${approvalId}`;
  }
  notify(sessionId) {
    for (const listener of this.listeners) try {
      listener(sessionId);
    } catch (error) {
      this.ctx.logger.error("Workflow native approval notification failed", error);
    }
  }
  async catalogAccessModes() {
    const service = this.ctx.get("permissionPresets");
    if (!service) return { options: [], defaultPreset: "" };
    const catalog = await service.catalog();
    return { options: catalog.options.map((option) => {
      const { sandbox, approval: approval2 } = service.resolve(option.value);
      return { id: option.value, label: option.name, ...option.description ? { description: option.description } : {}, sandbox, approval: approval2 };
    }), defaultPreset: catalog.defaultPreset };
  }
  async applyAccessMode(sessionId, preset) {
    if (this.stopped) throw new Error("Workflow native controls are stopping.");
    const service = this.ctx.get("permissionPresets");
    if (!service) throw new Error("Native permission presets are unavailable in this DSH profile.");
    if (!(await this.catalogAccessModes()).options.some((option) => option.id === preset)) throw new Error("The selected native permission preset is not currently available.");
    const resolved = await this.ctx.sessionController.resolveAgent(SessionId2(sessionId));
    if ("error" in resolved) throw resolved.error;
    service.set(resolved.agent.session, preset);
    const session = this.ctx.sessions.get(SessionId2(sessionId));
    if (session && !await this.ctx.sessions.flush(session)) throw new Error("The native access mode could not be durably stored.");
  }
  unsettled(events) {
    const pending = /* @__PURE__ */ new Map();
    for (const event of events) {
      if (event.type === "approval/asked") pending.set(event.data.id, event);
      else if (event.type === "approval/decided") pending.delete(event.data.id);
    }
    return [...pending.values()];
  }
  present(sessionId, event, events, actionable, request) {
    const call = events.findLast((item) => item.seq < event.seq && (item.type === "tool/call" && item.data.callId === event.data.callId || item.type === "tool/ptc-dispatch-start" && item.data.subCallId === event.data.callId));
    let args;
    if (call?.type === "tool/call") {
      try {
        args = JSON.parse(call.data.arguments);
      } catch {
        args = call.data.arguments;
      }
    } else if (call?.type === "tool/ptc-dispatch-start") args = call.data.arguments;
    const command = object3(args).command, input = args === void 0 ? void 0 : typeof args === "string" ? args : JSON.stringify(args, null, 2);
    return { sessionId, approvalId: event.data.id, ...event.data.callId ? { callId: event.data.callId } : {}, toolName: event.data.toolName, ...request?.reason ?? event.data.reason ? { reason: request?.reason ?? event.data.reason } : {}, ...typeof command === "string" ? { command: command.slice(0, 24e3) } : {}, ...input !== void 0 ? { input: input.slice(0, 24e3) } : {}, actionable, createdAt: event.time };
  }
  async approvals(sessionId) {
    if (!this.ctx.get("approval")) return [];
    const observation = await this.ctx.sessionQuery.observeSession(SessionId2(sessionId), { projectionMode: "none" });
    try {
      const own = observation.events.filter((event) => event.seq >= observation.inheritedEventCount), agent = this.ctx.get("agents")?.get(SessionId2(sessionId));
      return this.unsettled(own).map((event) => {
        const wait = this.waits.get(this.key(sessionId, event.data.id)), actionable = !!wait && !wait.signal?.aborted && wait.agent === agent;
        return this.present(sessionId, event, own, actionable);
      });
    } finally {
      observation[Symbol.dispose]();
    }
  }
  async answerApproval(sessionId, approvalId, decision) {
    if (decision !== "allowed-once" && decision !== "rejected") throw new Error("A native tool approval supports Allow once or Reject.");
    const key = this.key(sessionId, approvalId), wait = this.waits.get(key);
    if (!wait || !this.owner || this.stopped) return false;
    if (!await this.owner(sessionId, wait.approval.callId, approvalId) || this.waits.get(key) !== wait || wait.signal?.aborted || this.ctx.get("agents")?.get(wait.agent.id) !== wait.agent) return false;
    if (!this.unsettled(wait.agent.session.ownEvents()).some((event) => event.data.id === approvalId)) return false;
    wait.release();
    wait.resolve(decision);
    return true;
  }
  async dispose() {
    if (this.stopped) return;
    this.stopped = true;
    await this.stop();
    for (const wait of [...this.waits.values()]) {
      wait.release();
      wait.resolve("cancelled");
    }
    this.listeners.clear();
  }
};

// src/host/native-workspaces.ts
import { SessionId as SessionId3 } from "@deepseek-ai/dsh-session";
import { realpath } from "node:fs/promises";
var NativeWorkspaces = class {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.on("agent/created", ({ agent }) => {
      const title = this.pendingTitles.get(agent.id);
      if (!title) return;
      void this.rename(agent.id, title).catch((error) => ctx.logger.warn("Deferred Workflow Session title could not be written", error));
    });
    ctx.effect(() => () => {
      this.pendingTitles.clear();
      this.dirtyTitles.clear();
    }, "visual-workflow.deferred-titles");
  }
  pendingTitles = /* @__PURE__ */ new Map();
  dirtyTitles = /* @__PURE__ */ new Set();
  list() {
    const registry = this.ctx.get("workspaceRegistry");
    return registry?.list().map((workspace) => ({ id: workspace.id, title: workspace.title, path: workspace.path })) ?? [];
  }
  async attach(sessionId, workspaceId) {
    const registry = this.ctx.get("workspaceRegistry");
    if (!registry) return;
    const cwd = (await this.ctx.sessionQuery.readSession(SessionId3(sessionId))).session.cwd;
    const path = cwd ? await realpath(cwd) : void 0;
    const workspace = registry.list().find((item) => workspaceId ? item.id === workspaceId : item.sessionIds.includes(SessionId3(sessionId)) || path && item.path.toLowerCase() === path.toLowerCase());
    if (workspace) await workspace.attachSession(SessionId3(sessionId));
  }
  async rename(sessionId, title) {
    const titles = this.ctx.get("sessionTitle");
    if (!titles) {
      this.pendingTitles.set(sessionId, title);
      return false;
    }
    const session = this.ctx.sessions.get(SessionId3(sessionId));
    if (!session) {
      this.pendingTitles.set(sessionId, title);
      return false;
    }
    if (session.snapshotEvents().findLast((event) => event.type === "session/title")?.data.title === title) {
      if (this.dirtyTitles.has(sessionId)) {
        if (!await this.ctx.sessions.flush(session)) throw new Error("Native Session title has no durability listener");
        this.dirtyTitles.delete(sessionId);
      }
      this.pendingTitles.delete(sessionId);
      return true;
    }
    titles.rename(session, title);
    this.dirtyTitles.add(sessionId);
    if (!await this.ctx.sessions.flush(session)) throw new Error("Native Session title has no durability listener");
    this.dirtyTitles.delete(sessionId);
    this.pendingTitles.delete(sessionId);
    return true;
  }
};

// src/host/native-context.ts
import { SessionId as SessionId4 } from "@deepseek-ai/dsh-session";
import { ManualCompactionError } from "@deepseek-ai/dsh-compaction";
var NativeContextError = class extends Error {
  outcomeKnown = true;
  constructor(message, options) {
    super(message, options);
    this.name = "NativeContextError";
  }
};
var record2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var positive = (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : void 0;
var nonnegative = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : void 0;
var NativeContextControls = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  pending = /* @__PURE__ */ new Set();
  engine(agent) {
    const presets = this.ctx.get("agentPresets");
    return agent ? presets?.serviceFor(agent, "compaction") ?? agent.ctx.get("compaction") ?? this.ctx.get("compaction") : this.ctx.get("compaction");
  }
  measure(agent) {
    return nonnegative(this.ctx.get("tokenMeter")?.measure(agent.session).totalTokens);
  }
  async inspect(sessionId) {
    const observation = await this.ctx.sessionQuery.observeSession(SessionId4(sessionId), { projectionMode: "all" });
    try {
      const agent = this.ctx.get("agents")?.get(SessionId4(sessionId));
      const values = record2(observation.projections?.values), pressure = record2(values.contextPressure), engine = this.engine(agent), config = record2(engine).config;
      const capabilitiesKnown = !!agent || !!engine;
      const projected = nonnegative(pressure.projectedTokens), reported = nonnegative(pressure.pressureTokens), capacityTokens = positive(pressure.contextWindow);
      const events = observation.events;
      let compacting = this.pending.has(sessionId), lastCompactedAt;
      const open = /* @__PURE__ */ new Set();
      for (const event of events) {
        if (event.type === "session/end-seed") open.clear();
        else if (event.type === "compaction/start") open.add(event.data.compactionId);
        else if (event.type === "compaction/end") {
          open.delete(event.data.compactionId);
          if (!event.data.error) lastCompactedAt = event.time;
        }
      }
      compacting ||= open.size > 0;
      const header = events.findLast((event) => event.type === "request/header"), call = record2(record2(header?.data).header), route = record2(call.config);
      const policy = config?.modelPolicies?.find((item) => item.provider === route.provider && item.model === route.model), headroom = policy?.headroomTokens ?? config?.headroomTokens ?? 65536, reserved = nonnegative(route.maxTokens) ?? 0;
      const invalidBudget = !!engine && capacityTokens !== void 0 && capacityTokens - reserved - headroom <= 0;
      const provider = policy?.summarizationProvider ?? config?.summarizationProvider, summary = policy?.summarizationModel ?? config?.summarizationModel;
      const summaryModel = !engine ? void 0 : provider && summary ? { provider, model: summary } : typeof route.provider === "string" && typeof route.model === "string" ? { provider: route.provider, model: route.model } : agent?.options.provider && agent.options.model ? { provider: agent.options.provider, model: agent.options.model } : void 0;
      let usedTokens = projected ?? reported, source = projected !== void 0 ? "projected" : reported !== void 0 ? "pressure" : "unavailable";
      if (usedTokens === void 0 && agent) {
        usedTokens = this.measure(agent);
        if (usedTokens !== void 0) source = "projected";
      }
      const manualAvailable = (!capabilitiesKnown || !!engine) && observation.header.origin !== "subagent" && (!agent || this.ctx.agents.roots().includes(agent) && agent.status === "idle" && !agent.inbox.nextStep.length && !agent.inbox.nextTurn.length) && !compacting;
      return { sessionId, ...usedTokens === void 0 ? {} : { usedTokens }, ...capacityTokens === void 0 ? {} : { capacityTokens }, source, capabilitiesKnown, ...capabilitiesKnown ? { autoAvailable: !!engine && config?.auto !== false && !invalidBudget } : {}, manualAvailable, compacting, ...lastCompactedAt === void 0 ? {} : { lastCompactedAt }, ...summaryModel ? { summaryModel } : {}, ...invalidBudget ? { configurationIssue: `The native ${capacityTokens}-token context leaves no compaction pressure budget after reserving ${reserved} output tokens and ${headroom} compaction headroom tokens.` } : {} };
    } finally {
      observation[Symbol.dispose]();
    }
  }
  async compact(sessionId) {
    if (this.pending.has(sessionId)) throw new Error("Native compaction is already running for this Session.");
    this.pending.add(sessionId);
    try {
      const resolved = await this.ctx.sessionController.resolveAgent(SessionId4(sessionId));
      if ("error" in resolved) throw resolved.error;
      const agent = resolved.agent;
      const preflightFailure = async (message) => {
        if (!await this.ctx.sessions.flush(agent.session)) throw new Error("Native compaction has no durability listener.");
        throw new NativeContextError(message);
      };
      const engine = this.engine(agent);
      if (!engine) return preflightFailure("Native conversation compaction is unavailable in this Agent preset.");
      if (!this.ctx.agents.roots().includes(agent)) return preflightFailure("An owned native child cannot be compacted through ordinary Session controls.");
      if (agent.status !== "idle" || agent.inbox.nextStep.length || agent.inbox.nextTurn.length) return preflightFailure("Wait for the native Session and its queued work before compacting.");
      const beforeTokens = this.measure(agent), beforeSeq = agent.session.seq, signal = new AbortController().signal;
      const presets = this.ctx.get("agentPresets");
      const commands = presets?.serviceFor(agent, "commands") ?? agent.ctx.get("commands") ?? this.ctx.get("commands");
      const failed = async (message, cause) => {
        if (!await this.ctx.sessions.flush(agent.session)) throw new Error("Native compaction has no durability listener.");
        const suffix = agent.session.ownEvents().filter((event) => event.seq >= beforeSeq), starts = suffix.filter((event) => event.type === "compaction/start"), ends = suffix.filter((event) => event.type === "compaction/end");
        if (!suffix.some((event) => event.type === "compaction/summary") && (!starts.length || starts.every((start) => ends.some((end) => end.type === "compaction/end" && start.type === "compaction/start" && end.data.compactionId === start.data.compactionId && typeof end.data.error === "string")))) throw new NativeContextError(message, { cause });
        throw new Error(message, { cause });
      };
      if (commands?.find(agent, "compact")) {
        const execution2 = await commands.execute(agent, "/compact", [], signal);
        if (!execution2) throw new Error("The native compact command did not return an outcome.");
        if (execution2.result.kind !== "success") return failed(execution2.result.text ?? "The native compact command did not complete.");
      } else {
        try {
          await engine.compactNow(agent, signal);
        } catch (error) {
          if (error instanceof ManualCompactionError && error.code !== "persistence" && error.code !== "commit") return failed(error.message, error);
          throw error;
        }
      }
      if (!await this.ctx.sessions.flush(agent.session)) throw new Error("Native compaction has no durability listener.");
      const afterTokens = this.measure(agent), result = agent.session.ownEvents().findLast((event) => event.seq >= beforeSeq && event.type === "compaction/summary");
      return { changed: !!result, ...beforeTokens === void 0 ? {} : { beforeTokens }, ...afterTokens === void 0 ? {} : { afterTokens }, ...result?.type === "compaction/summary" ? { compactionId: String(result.data.compactionId) } : {} };
    } finally {
      this.pending.delete(sessionId);
    }
  }
};

// src/host/native-skills.ts
import { SessionId as SessionId5 } from "@deepseek-ai/dsh-session";
import { isUserInvocable } from "@deepseek-ai/dsh-skill";
var NativeSkillCatalog = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  async list(request = {}) {
    var _stack2 = [];
    try {
      const { signal } = request;
      signal?.throwIfAborted();
      let cwd = request.cwd, scope;
      let registry = this.ctx.get("skills");
      const presets = this.ctx.get("agentPresets");
      let presetId;
      if (request.sessionId) {
        var _stack = [];
        try {
          const observation = __using(_stack, await this.ctx.sessionQuery.observeSession(SessionId5(request.sessionId), signal ? { signal } : void 0));
          signal?.throwIfAborted();
          const values = observation.projections?.values;
          cwd = values?.workingDirectory ?? observation.header.cwd;
          presetId = values?.agentPreset ?? void 0;
          const live = this.ctx.get("agents")?.get(SessionId5(request.sessionId));
          if (live) {
            scope = live;
            registry = presets?.serviceFor(live, "skills") ?? registry;
          }
        } catch (_) {
          var _error = _, _hasError = true;
        } finally {
          __callDispose(_stack, _error, _hasError);
        }
      }
      const lease = __using(_stack2, !scope && presets && request.sessionId ? await presets.acquireScope(presetId) : void 0, true);
      scope ??= lease?.key;
      if (!registry) throw new Error("The native skill registry is unavailable in this DSH composition.");
      const skills = await registry.list({ ...cwd ? { cwd } : {}, ...scope ? { scope } : {}, ...signal ? { signal } : {} });
      signal?.throwIfAborted();
      return skills.filter(isUserInvocable).map((skill) => ({ name: skill.name, description: skill.description, source: skill.source }));
    } catch (_2) {
      var _error2 = _2, _hasError2 = true;
    } finally {
      var _promise = __callDispose(_stack2, _error2, _hasError2);
      _promise && await _promise;
    }
  }
};

// src/host/question-automation.ts
function recommendedAnswers(questions) {
  if (!questions.length) return;
  const answers = [];
  for (const question of questions) {
    const choices = (question.options ?? []).filter((option) => {
      if (/(?:\b(?:not|never)\s+(?:(?:[a-z]+|[（(\[])\s*){0,3}recommended\b|\bunrecommended\b|不\s*推荐)/i.test(option.label)) return false;
      return /(?:（\s*(?:推荐|recommended)\s*）|\(\s*(?:推荐|recommended)\s*\)|\[\s*(?:推荐|recommended)\s*\]|^\s*Recommended\s*[:：]\s*\S)/i.test(option.label);
    });
    if (!choices.length || !question.multiSelect && choices.length !== 1) return;
    answers.push({ id: question.id, selected: choices.map((option) => option.label) });
  }
  return answers;
}

// src/host/service.ts
var initialLayout = { revision: 0, positions: {}, viewport: { x: 0, y: 0, zoom: 1 } };
var workflowDomainSpec = defineDomain({ name: "visual_workflow", version: 1, layout: "single", tables: {
  workflows: domainTable(workflowSchema),
  legacy_backup: domainTable(workflowSchema),
  catalog_layout: domainTable(catalogLayoutSchema)
} });
var RevisionConflict = class extends Error {
  constructor(workflow) {
    super("workflow revision conflict");
    this.workflow = workflow;
  }
};
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw new RemoteError("gateway/bad-request", `Invalid workflow data: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`, {});
  return result.data;
}
function fail(message) {
  throw new RemoteError("gateway/bad-request", message, {});
}
var clone = (value) => structuredClone(value);
var uid = (prefix) => `${prefix}-${randomUUID()}`;
var err = (error) => String(error instanceof Error ? error.message : error).slice(0, 4e3);
function sessionReferences(workflow) {
  return new Set([
    workflow.sourceSessionId,
    workflow.uploadSessionId,
    ...workflow.nodes.map((node2) => node2.sourceSessionId),
    ...workflow.branches?.flatMap((branch2) => [branch2.sessionId, branch2.sourceSessionId]) ?? [],
    ...workflow.executions?.flatMap((run) => [run.sessionId, run.subagent?.parentSessionId]) ?? [],
    ...workflow.plans?.map((plan2) => plan2.sessionId) ?? [],
    ...workflow.operations?.flatMap((operation2) => [operation2.sourceSessionId, operation2.childSessionId]) ?? [],
    ...workflow.utilityNodes?.flatMap((node2) => [node2.sessionId, node2.terminal?.sessionId]) ?? []
  ].filter((id2) => Boolean(id2)));
}
function ownedSessionIds(workflow) {
  return new Set([
    workflow.uploadSessionId,
    ...workflow.branches?.map((branch2) => branch2.sessionId) ?? [],
    ...workflow.executions?.flatMap((run) => [run.sessionId, run.subagent?.parentSessionId]) ?? [],
    ...workflow.plans?.map((plan2) => plan2.sessionId) ?? [],
    ...workflow.operations?.map((operation2) => operation2.childSessionId) ?? []
  ].filter((id2) => Boolean(id2)));
}
var nativeStatus = (value) => value === "queued" ? "ready" : value === "waiting_approval" ? "blocked" : value;
function normalized(workflow) {
  return assignNodeNumbers({ ...workflow, schemaVersion: 2, branches: workflow.branches ?? [], executions: workflow.executions ?? [], approvals: workflow.approvals ?? [], plans: workflow.plans ?? [], operations: workflow.operations ?? [], settings: workflow.settings ?? { generation: "suggest", execution: "approval" } });
}
function dependencies(workflow, nodeId) {
  return workflow.edges.filter((edge2) => edge2.target === nodeId).map((edge2) => edge2.source).sort();
}
function ancestorIds(workflow, nodeId) {
  const seen = /* @__PURE__ */ new Set(), pending = [nodeId];
  while (pending.length) for (const id2 of dependencies(workflow, pending.pop())) if (!seen.has(id2)) {
    seen.add(id2);
    pending.push(id2);
  }
  return [...seen].sort();
}
function attachmentIdentity(items) {
  return (items ?? []).map((item) => ({ id: item.id, file: item.file })).sort((a, b) => a.id.localeCompare(b.id));
}
function knownAttachments(workflow) {
  const known = /* @__PURE__ */ new Map();
  for (const item of [...workflow.attachmentReferences ?? [], ...workflow.planningAttachments ?? [], ...workflow.plans?.flatMap((plan2) => plan2.attachments ?? []) ?? [], ...workflow.nodes.flatMap((node2) => [...node2.attachments ?? [], ...node2.revisions?.flatMap((revision) => revision.attachments ?? []) ?? []])]) known.set(item.id, item);
  return [...known.values()];
}
function retainedAttachments(workflow, old, incoming) {
  if (incoming === void 0) return old?.attachments;
  const known = knownAttachments(workflow);
  return incoming.map((item) => {
    const verified = known.find((candidate) => candidate.id === item.id);
    if (!verified || JSON.stringify(verified) !== JSON.stringify(item)) fail("Attachments must be exact native-verified references already owned by this workflow");
    return verified;
  });
}
function authorizationSettings(settings) {
  if (!settings) return void 0;
  const { modelReasoning: _futurePreferences, ...policies } = settings;
  return policies;
}
function fingerprint(workflow, node2, resolvedModel) {
  return createHash("sha256").update(JSON.stringify({ id: node2.id, revision: node2.revision, title: node2.title, instruction: node2.instruction, model: node2.model, resolvedModel, attachments: attachmentIdentity(node2.attachments), dependencies: ancestorIds(workflow, node2.id).map((id2) => ({ id: id2, revision: workflow.nodes.find((candidate) => candidate.id === id2)?.revision })), settings: authorizationSettings(workflow.settings) })).digest("hex");
}
function revisions(node2, workflow) {
  return node2.revisions?.length ? node2.revisions : [{ revision: node2.revision, title: node2.title, instruction: node2.instruction, dependencies: dependencies(workflow, node2.id), createdAt: workflow.createdAt, attachments: node2.attachments, model: node2.model }];
}
function activeExecution(run) {
  return ["running", "ready", "waiting_answer"].includes(run.status) || run.status === "blocked" && run.endSeq === void 0;
}
function localQueueRecord(run) {
  return run.status === "waiting" || run.terminalReason === "queue-cancelled" || run.terminalReason === "authorization-invalidated" || run.terminalReason === "context-isolation-required" || run.terminalReason === "workflow-deleted" || run.terminalReason === "workflow-paused";
}
function queueAuthorized(workflow, run) {
  const node2 = workflow.nodes.find((item) => item.id === run.nodeId);
  return !!node2 && !!run.resolvedModel && node2.revision === run.nodeRevision && run.authorizationFingerprint === fingerprint(workflow, node2, run.resolvedModel) && workflow.approvals.some((approval2) => approval2.nodeId === node2.id && approval2.nodeRevision === node2.revision && approval2.decision === "approved" && approval2.fingerprint === run.authorizationFingerprint);
}
function invalidateQueue(workflow) {
  const executions = workflow.executions.map((run) => run.status === "waiting" && !queueAuthorized(workflow, run) ? { ...run, status: "cancelled", terminalReason: "authorization-invalidated", error: "The queued task, its prerequisites, or its execution policies changed. Click Run again to authorize the current version.", updatedAt: Date.now() } : run);
  const next = { ...workflow, executions };
  return { ...next, nodes: projectNodes(next) };
}
function manualScope(workflow, branch2) {
  const seen = /* @__PURE__ */ new Set();
  let current = branch2;
  while (current.automatic && current.parentBranchId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = workflow.branches.find((item) => item.id === current.parentBranchId);
    if (!parent) break;
    current = parent;
  }
  return current;
}
function historyContains(workflow, run, branch2, boundary = Infinity) {
  if (run.endSeq === void 0) return false;
  const seen = /* @__PURE__ */ new Set();
  let current = branch2, cap = boundary;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.sessionId === run.sessionId) return run.endSeq <= cap;
    if (!current.parentBranchId || current.forkBoundarySeq === void 0) return false;
    const parent = workflow.branches.find((item) => item.id === current.parentBranchId);
    if (!parent || current.sourceSessionId !== parent.sessionId) return false;
    cap = Math.min(cap, current.forkBoundarySeq);
    current = parent;
  }
  return false;
}
function runVisible(workflow, run, branch2) {
  if (run.branchId === branch2.id) return true;
  const owner = workflow.branches.find((item) => item.id === run.branchId);
  if (!branch2.automatic && owner?.automatic && manualScope(workflow, owner).id === branch2.id) return true;
  return branch2.nodeIds.includes(run.nodeId) && historyContains(workflow, run, branch2);
}
function contextCheck(workflow, branch2) {
  const nodes = new Map(workflow.nodes.map((node2) => [node2.id, node2]));
  const latestByNode = /* @__PURE__ */ new Map(), validity = /* @__PURE__ */ new Map(), checking = /* @__PURE__ */ new Set();
  const latest = (nodeId) => {
    if (!latestByNode.has(nodeId)) latestByNode.set(nodeId, workflow.executions.findLast((run) => run.nodeId === nodeId && run.nodeRevision === nodes.get(nodeId)?.revision && !!branch2 && runVisible(workflow, run, branch2)));
    return latestByNode.get(nodeId);
  };
  const inputs = (nodeId) => dependencies(workflow, nodeId).filter((id2) => nodes.get(id2)?.kind !== "session").flatMap((id2) => {
    const run = latest(id2);
    return run ? [run] : [];
  });
  const current = (run) => {
    if (validity.has(run.runId)) return validity.get(run.runId);
    if (checking.has(run.runId) || run.status !== "completed" || run.durability !== "durable" || run.endSeq === void 0 || run.nodeRevision !== nodes.get(run.nodeId)?.revision) return false;
    const owner = workflow.branches.find((item) => item.id === run.branchId);
    if (!owner) return false;
    checking.add(run.runId);
    const valid = dependencies(workflow, run.nodeId).every((id2) => {
      if (nodes.get(id2)?.kind === "session") return true;
      const required = latest(id2);
      return !!required && (!run.inputRunIds || run.inputRunIds.includes(required.runId)) && historyContains(workflow, required, owner, run.endSeq) && current(required);
    });
    checking.delete(run.runId);
    validity.set(run.runId, valid);
    return valid;
  };
  const ready = (nodeId) => dependencies(workflow, nodeId).every((id2) => nodes.get(id2)?.kind === "session" || !!latest(id2) && current(latest(id2)));
  const stale = (nodeId) => inputs(nodeId).some((run) => run.status === "completed" && !current(run));
  return { latest, inputs, current, ready, stale };
}
function projectNodes(workflow) {
  const branch2 = workflow.branches?.find((item) => item.id === workflow.activeBranchId);
  const check = contextCheck(workflow, branch2);
  return workflow.nodes.map((node2) => {
    if (node2.kind === "session") return node2;
    const run = [...workflow.executions ?? []].reverse().find((run2) => run2.nodeId === node2.id && run2.nodeRevision === node2.revision && (!branch2 || runVisible(workflow, run2, branch2)));
    const approved = workflow.approvals?.some((item) => item.nodeId === node2.id && item.nodeRevision === node2.revision && item.decision === "approved" && item.fingerprint === fingerprint(workflow, node2, item.resolvedModel));
    const { resultStale: _, ...base } = node2;
    return { ...base, status: run?.status ?? (approved ? check.ready(node2.id) ? "ready" : "blocked" : "draft"), answerSummary: run?.summary, ...run?.status === "completed" && !check.current(run) ? { resultStale: true } : {} };
  });
}
function prerequisitesComplete(workflow, nodeId, branch2) {
  return contextCheck(workflow, branch2).ready(nodeId);
}
var policyOperationId = (prefix, identity) => `${prefix}-${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
var _applyPlan_dec, _generatePlan_dec, _fork_dec, _answerQuestion_dec, _answerApproval_dec, _pendingApprovals_dec, _questions_dec, _pauseQuestionAutomation_dec, _details_dec, _trace_dec, _cancel_dec, _batchRun_dec, _run_dec, _approve_dec, _attachPlanFiles_dec, _attachFiles_dec, _attach_dec, _preparePlanAttachments_dec, _prepareAttachment_dec, _importSession_dec, _saveCatalogLayout_dec, _catalog_dec, _save_dec, _archiveSessionHistory_dec, _previewSessionArchive_dec, _delete_dec, _pauseAll_dec, _create_dec, _get_dec, _list_dec, _setWorkspace_dec, _organizeSessionNames_dec, _compactContext_dec, _skills_dec, _contextUsage_dec, _workspacesList_dec, _setAccessMode_dec, _accessModes_dec, _models_dec, _capabilities_dec, _a, _init, _b;
var VisualWorkflowService = class extends (_b = TypertRemoteService) {
  constructor(ctx) {
    super(ctx, "visualWorkflow");
    __runInitializers(_init, 5, this);
    __publicField(this, "records");
    __publicField(this, "layouts");
    __publicField(this, "native");
    __publicField(this, "controls");
    __publicField(this, "workspaces");
    __publicField(this, "contextControls");
    __publicField(this, "skillCatalog");
    __publicField(this, "compactFlights", /* @__PURE__ */ new Set());
    __publicField(this, "sessionArchiveFlights", /* @__PURE__ */ new Map());
    __publicField(this, "autoAnswers", /* @__PURE__ */ new Map());
    __publicField(this, "actionTails", /* @__PURE__ */ new Map());
    __publicField(this, "scheduled", /* @__PURE__ */ new Map());
    __publicField(this, "policyTimers", /* @__PURE__ */ new Map());
    __publicField(this, "policyFlights", /* @__PURE__ */ new Set());
    __publicField(this, "policyAgain", /* @__PURE__ */ new Set());
    /** Prevent event projection and policy timers from writing while a delete
     * first interrupts the native work and then commits the archive tombstone. */
    __publicField(this, "archiveFlights", /* @__PURE__ */ new Set());
    __publicField(this, "pausedPolicies", /* @__PURE__ */ new Set());
    __publicField(this, "recovering", false);
    __publicField(this, "stopped", false);
  }
  async [(_a = Service.init, _capabilities_dec = [Remote], _models_dec = [Remote], _accessModes_dec = [Remote], _setAccessMode_dec = [Remote], _workspacesList_dec = [Remote], _contextUsage_dec = [Remote], _skills_dec = [Remote], _compactContext_dec = [Remote], _organizeSessionNames_dec = [Remote], _setWorkspace_dec = [Remote], _list_dec = [Remote], _get_dec = [Remote], _create_dec = [Remote], _pauseAll_dec = [Remote], _delete_dec = [Remote], _previewSessionArchive_dec = [Remote], _archiveSessionHistory_dec = [Remote], _save_dec = [Remote], _catalog_dec = [Remote], _saveCatalogLayout_dec = [Remote], _importSession_dec = [Remote], _prepareAttachment_dec = [Remote], _preparePlanAttachments_dec = [Remote], _attach_dec = [Remote], _attachFiles_dec = [Remote], _attachPlanFiles_dec = [Remote], _approve_dec = [Remote], _run_dec = [Remote], _batchRun_dec = [Remote], _cancel_dec = [Remote], _trace_dec = [Remote], _details_dec = [Remote], _pauseQuestionAutomation_dec = [Remote], _questions_dec = [Remote], _pendingApprovals_dec = [Remote], _answerApproval_dec = [Remote], _answerQuestion_dec = [Remote], _fork_dec = [Remote], _generatePlan_dec = [Remote], _applyPlan_dec = [Remote], _a)]() {
    this.ctx.effect(() => () => {
      this.stopped = true;
      for (const timer of this.policyTimers.values()) clearTimeout(timer);
      this.policyTimers.clear();
      this.policyAgain.clear();
      for (const state of this.autoAnswers.values()) if (state.timer) clearTimeout(state.timer);
      this.autoAnswers.clear();
    }, "visual-workflow.policy-close");
    const domain = await this.ctx.storageDomain.open(workflowDomainSpec);
    this.ctx.effect(() => () => domain.close(), "visual-workflow.domain-close");
    this.records = domain.table("workflows");
    this.layouts = domain.table("catalog_layout");
    const backups = domain.table("legacy_backup");
    for (const [id2, workflow] of this.records.entries()) if (workflow.schemaVersion === 1) {
      if (!backups.get(id2)) await backups.put(id2, clone(workflow));
      await this.records.put(id2, normalized(workflow));
    }
    this.ctx.inject([...DshNativeRuntime.inject], (ctx) => {
      const runtime = new DshNativeRuntime(ctx);
      this.native = runtime;
      const controls = new NativeControls(ctx);
      this.controls = controls;
      this.workspaces = new NativeWorkspaces(ctx);
      this.contextControls = new NativeContextControls(ctx);
      this.skillCatalog = new NativeSkillCatalog(ctx);
      ctx.on("agent/created", ({ agent }) => {
        for (const [, raw] of this.table().entries()) if (raw.archivedAt === void 0 && raw.organizeNativeNames && raw.sourceSessionId !== agent.id) {
          const workflow = normalized(raw), run = workflow.executions.findLast((item) => item.sessionId === agent.id), node2 = workflow.nodes.find((item) => item.id === run?.nodeId), branch2 = workflow.branches.find((item) => item.sessionId === agent.id);
          const title = node2 && branch2 ? nativeSessionCaption(workflow, node2, branch2.label) : workflow.executions.some((item) => item.subagent?.parentSessionId === agent.id) ? `${workflow.name.slice(0, 80)} \xB7 \u5185\u90E8\u534F\u8C03` : void 0;
          if (title) void this.workspaces?.rename(agent.id, title).catch((error) => ctx.logger.warn("Workflow deferred native naming failed", error));
        }
      });
      controls.setApprovalOwner((sessionId, callId, approvalId) => this.ownsApproval(sessionId, callId, approvalId));
      const stopControls = controls.subscribe((sessionId) => this.schedule(sessionId));
      ctx.effect(() => () => {
        stopControls();
        if (this.controls === controls) this.controls = void 0;
        return controls.dispose();
      }, "visual-workflow.native-controls");
      runtime.setQuestionOwner?.((sessionId, callId) => this.ownsQuestion(sessionId, callId));
      ctx.effect(() => () => runtime.disposeSubagents?.(), "visual-workflow.subagents");
      ctx.on("subagent/end", (info) => this.schedule(info.id));
      ctx.on("subagent/provider-added", () => {
        for (const [id2] of this.table().entries()) this.queuePolicies(id2);
      });
      const dispose = runtime.subscribe((sessionId) => this.schedule(sessionId));
      ctx.effect(() => () => {
        dispose();
        for (const timer of this.scheduled.values()) clearTimeout(timer);
        this.scheduled.clear();
        if (this.native === runtime) this.native = void 0;
      });
      void this.recover().catch((error) => ctx.logger.error("Workflow recovery failed", error));
    });
  }
  owner() {
    const invocation = this.ctx.invocation;
    if (invocation && invocation.peer.principal.kind !== "owner") fail("Workflow Session orchestration is available only to the local owner");
  }
  table() {
    this.owner();
    if (!this.records) throw new Error("Workflow storage is not ready");
    return this.records;
  }
  runtime() {
    this.owner();
    if (!this.native) fail("Native Session runtime is not available in this profile");
    return this.native;
  }
  workflow(id2) {
    const item = this.table().get(id2);
    if (!item || item.archivedAt !== void 0) fail("Workflow no longer exists");
    return normalized(item);
  }
  async write(id2, transform) {
    if (this.archiveFlights.has(id2)) fail("Workflow is stopping native work");
    const saved = await updateWorkflowMetadata(this.table(), id2, (current) => {
      if (this.archiveFlights.has(id2)) fail("Workflow is stopping native work");
      if (current.archivedAt !== void 0) fail("Workflow no longer exists");
      const next = invalidateQueue(normalized(transform(normalized(clone(current)))));
      const previousReferences = sessionReferences(current);
      const archivedSessions = new Set(this.archiveRegistry()?.archivedSessionIds ?? []);
      if ([...sessionReferences(next)].some((id3) => (this.sessionArchiveFlights.has(id3) || archivedSessions.has(id3)) && !previousReferences.has(id3))) fail("This Session is being archived or is already archived; its history cannot be newly referenced");
      return parse(workflowSchema, { ...next, schemaVersion: 2, revision: current.revision + 1, createdAt: current.createdAt, updatedAt: Math.max(Date.now(), current.updatedAt + 1) });
    });
    this.queuePolicies(id2);
    return saved;
  }
  serial(key, action) {
    const previous = this.actionTails.get(key) ?? Promise.resolve();
    const next = previous.then(action, action);
    this.actionTails.set(key, next);
    void next.finally(() => {
      if (this.actionTails.get(key) === next) this.actionTails.delete(key);
    }).catch(() => {
    });
    return next;
  }
  async capabilities() {
    this.owner();
    return { pluginVersion: WORKFLOW_PLUGIN_VERSION, apiVersion: WORKFLOW_API_VERSION, features: ["batch-run", "pause-all", "delete", "native-session-archive", "model-selection", "model-reasoning", "node-model-override", "pinned-execution-model", "planning", "attachments", "planning-attachments", "visual-node-hide", "user-questions"] };
  }
  async models() {
    const value = await this.runtime().models();
    return { models: value.models.map((item) => ({ ...parse(modelIdentitySchema, { provider: item.provider, model: item.model }), label: item.label, ...item.reasoning ? { reasoning: { efforts: item.reasoning.efforts.map((effort) => ({ id: effort.id, name: effort.name, ...effort.description === void 0 ? {} : { description: effort.description } })), ...item.reasoning.defaultEffort === void 0 ? {} : { defaultEffort: item.reasoning.defaultEffort } } } : {} })), ...value.defaultModel ? { defaultModel: parse(modelIdentitySchema, value.defaultModel) } : {} };
  }
  async resolveWorkflowModel(workflow, node2) {
    const runtime = this.runtime();
    const explicit = node2?.model ?? workflow.settings?.model;
    if (!workflow.settings?.modelReasoning?.length) return parse(modelIdentitySchema, await runtime.resolveModel(explicit));
    const selected = explicit ?? (await runtime.models()).defaultModel;
    const preference = selected && explicit?.reasoningEffort === void 0 && workflow.settings?.modelReasoning?.find((item) => item.provider === selected.provider && item.model === selected.model);
    return parse(modelIdentitySchema, await runtime.resolveModel(selected ? { ...selected, ...preference ? { reasoningEffort: preference.reasoningEffort } : {} } : void 0));
  }
  async accessModes() {
    this.owner();
    return this.controls ? this.controls.catalogAccessModes() : { options: [], defaultPreset: "" };
  }
  async resolveAccessMode(workflow) {
    const catalog = await this.accessModes(), mode = workflow.settings?.accessMode ?? catalog.defaultPreset;
    if (mode && !catalog.options.some((option) => option.id === mode)) fail("Selected native access mode is no longer available");
    return mode || void 0;
  }
  workspacePath(workflow) {
    if (!workflow.workspaceId) return;
    const workspace = this.workspaces?.list().find((item) => item.id === workflow.workspaceId);
    if (!workspace) fail("Native workspace no longer exists");
    return workspace.path;
  }
  async setAccessMode(request) {
    const args = parse(accessModeRequestSchema, request);
    return this.serial(args.workflowId, async () => {
      const current = this.workflow(args.workflowId), catalog = await this.accessModes();
      if (args.presetId && !catalog.options.some((option) => option.id === args.presetId)) fail("Native access mode is unavailable");
      const workflow = await this.write(current.id, (item) => ({ ...item, settings: { ...item.settings, accessMode: args.presetId } }));
      return { workflow: clone(workflow) };
    });
  }
  async workspacesList() {
    this.owner();
    return { workspaces: this.workspaces?.list() ?? [] };
  }
  contextTarget(args) {
    this.owner();
    if (!args.workflowId) return { sessionId: args.sessionId, label: args.sessionId ? "\u539F\u751F\u4F1A\u8BDD" : "\u5F53\u524D\u4E0A\u4E0B\u6587", readOnly: true };
    const workflow = this.workflow(args.workflowId), branch2 = workflow.branches.find((item) => item.id === (args.branchId ?? workflow.activeBranchId));
    if (args.branchId && !branch2) fail("The selected context branch does not belong to this workflow");
    const node2 = args.nodeId ? workflow.nodes.find((item) => item.id === args.nodeId) : void 0;
    if (args.nodeId && !node2) fail("The selected context node no longer exists");
    const run = node2 ? workflow.executions.findLast((item) => item.nodeId === node2.id && (!branch2 || runVisible(workflow, item, branch2))) : void 0;
    const plan2 = args.planning ? workflow.plans.at(-1) : void 0;
    const sessionId = args.sessionId ?? (args.planning ? plan2?.sessionId : node2?.sourceSessionId ?? run?.sessionId ?? branch2?.sessionId);
    if (sessionId && ![workflow.sourceSessionId, workflow.uploadSessionId, ...workflow.branches.map((item) => item.sessionId), ...workflow.plans.map((item) => item.sessionId), ...workflow.nodes.map((item) => item.sourceSessionId)].includes(sessionId)) fail("The context Session does not belong to this workflow");
    return { workflow, sessionId, label: args.planning ? "\u4EFB\u52A1\u89C4\u5212\u4F1A\u8BDD" : node2 ? `${node2.displayId ? `#${node2.displayId} \xB7 ` : ""}${node2.title}` : branch2?.label ?? workflow.name, readOnly: !!sessionId && (sessionId === workflow.sourceSessionId || workflow.nodes.some((item) => item.kind === "session" && item.sourceSessionId === sessionId)) };
  }
  async inspectContext(target) {
    const { workflow, sessionId, label, readOnly } = target;
    if (!sessionId) return { label, readOnly, source: "unavailable", canCompact: false, compacting: false, unavailableReason: "\u5C1A\u672A\u5EFA\u7ACB\u4F1A\u8BDD\uFF0C\u8BF7\u5148\u8FD0\u884C\u4EFB\u52A1\u6216\u751F\u6210\u89C4\u5212\u3002" };
    if (!this.contextControls) return { sessionId, label, readOnly, source: "unavailable", canCompact: false, compacting: false, unavailableReason: "\u5F53\u524D DSH \u672A\u63D0\u4F9B\u4E0A\u4E0B\u6587\u670D\u52A1\u3002" };
    const snapshot = await this.contextControls.inspect(sessionId);
    const native = this.runtime();
    const child = workflow?.executions.some((run) => run.sessionId === sessionId && run.subagent);
    const busy = native.isRunning(sessionId) || workflow?.executions.some((run) => run.sessionId === sessionId && (run.status === "waiting" || activeExecution(run) || run.status === "unknown" || run.durability === "needs-reconcile")) || workflow?.plans.some((plan2) => plan2.sessionId === sessionId && ["running", "needs-reconcile"].includes(plan2.status));
    const uncertain = workflow?.operations.some((operation2) => operation2.kind === "compact" && operation2.sourceSessionId === sessionId && ["pending", "needs-reconcile"].includes(operation2.status));
    const questions = await native.questions?.(sessionId) ?? [];
    const approvals = await this.controls?.approvals(sessionId) ?? [];
    const unavailableReason = readOnly ? "\u539F\u59CB\u4F1A\u8BDD\u4FDD\u6301\u53EA\u8BFB\uFF0C\u8BF7\u5728\u5DE5\u4F5C\u6D41\u5206\u652F\u4E2D\u538B\u7F29\u3002" : child ? "\u539F\u751F\u5B50\u667A\u80FD\u4F53\u6682\u4E0D\u652F\u6301\u72EC\u7ACB\u7684\u624B\u52A8\u538B\u7F29\u5165\u53E3\u3002" : snapshot.compacting || uncertain ? "\u538B\u7F29\u6B63\u5728\u6267\u884C\u6216\u4E0A\u6B21\u7ED3\u679C\u9700\u8981\u6838\u5BF9\uFF0C\u4E0D\u80FD\u91CD\u590D\u63D0\u4EA4\u3002" : busy || questions.some((item) => item.actionable) || approvals.some((item) => item.actionable) ? "\u8BF7\u5148\u7ED3\u675F\u5F53\u524D\u4EFB\u52A1\u3001\u7B49\u5F85\u961F\u5217\u3001\u63D0\u95EE\u6216\u6743\u9650\u5BA1\u6279\u3002" : !snapshot.manualAvailable ? "\u5F53\u524D\u539F\u751F\u4F1A\u8BDD\u4E0D\u652F\u6301\u624B\u52A8\u538B\u7F29\u3002" : void 0;
    return { ...snapshot, label, readOnly, canCompact: !!workflow && !unavailableReason, ...unavailableReason ? { unavailableReason } : {} };
  }
  async contextUsage(request) {
    return this.inspectContext(this.contextTarget(parse(contextRequestSchema, request)));
  }
  async skills(request) {
    const target = this.contextTarget(parse(contextRequestSchema, request));
    if (!this.skillCatalog) return { skills: [] };
    const cwd = target.workflow ? this.workspacePath(target.workflow) : void 0;
    return { skills: await this.skillCatalog.list({ sessionId: target.sessionId, cwd }) };
  }
  async compactContext(request) {
    const args = parse(compactRequestSchema, request);
    return this.serial(args.workflowId, async () => {
      const target = this.contextTarget({ workflowId: args.workflowId, sessionId: args.sessionId }), current = target.workflow;
      const existing = current.operations.find((item) => item.id === args.operationId);
      if (existing) {
        if (existing.kind !== "compact" || existing.sourceSessionId !== args.sessionId) fail("The operation identity belongs to another action");
        if (existing.status === "completed") return { workflow: clone(current), context: await this.inspectContext(target), changed: existing.atSeq !== void 0 };
        fail("The previous compaction outcome must be checked in the native Session; it was not resubmitted");
      }
      const context = await this.inspectContext(target);
      if (!context.canCompact) fail(context.unavailableReason ?? "Native compaction is unavailable");
      const key = `${args.workflowId}:${args.sessionId}`;
      if (this.compactFlights.has(key)) fail("Compaction is already running");
      await this.write(current.id, (item) => ({ ...item, operations: [...item.operations, { id: args.operationId, kind: "compact", status: "pending", sourceSessionId: args.sessionId, createdAt: Date.now() }] }));
      this.compactFlights.add(key);
      try {
        const result = await this.contextControls.compact(args.sessionId);
        const log = await this.runtime().read(args.sessionId), end = result.changed ? log.events.findLast((item) => item.type === "compaction/end" && item.data.compactionId === result.compactionId && !item.data.error)?.seq : void 0, verified = verifiedCompactionCheckpoints(log);
        if (result.changed && (end === void 0 || !log.events.some((event) => verified.has(event.seq) && event.seq < end && event.data.source?.compactionId === result.compactionId))) throw new Error("The native compaction result has no verified durable checkpoint; inspect the Session before retrying.");
        const workflow = await this.write(current.id, (item) => ({ ...item, operations: item.operations.map((operation2) => operation2.id === args.operationId ? { ...operation2, status: "completed", atSeq: end } : operation2) }));
        return { workflow: clone(workflow), context: await this.inspectContext({ ...target, workflow }), changed: result.changed };
      } catch (error) {
        if (error instanceof NativeContextError && error.outcomeKnown) await this.write(current.id, (item) => ({ ...item, operations: item.operations.map((operation2) => operation2.id === args.operationId ? { ...operation2, status: "failed", error: err(error) } : operation2) }));
        else await this.operationFailure(current.id, args.operationId, error);
        throw error;
      } finally {
        this.compactFlights.delete(key);
      }
    });
  }
  async organizeSessionNames(request) {
    const { workflowId } = parse(questionsRequestSchema, request);
    return this.serial(workflowId, async () => {
      let workflow = await this.write(workflowId, (item) => ({ ...item, organizeNativeNames: true }));
      const updatedSessionIds = [], deferredSessionIds = [];
      if (!this.workspaces) return { updatedSessionIds, deferredSessionIds };
      if (workflow.branches.some((branch2) => branch2.label === "Main branch" || branch2.label.startsWith("\u8DEF\u5F84 \xB7 "))) workflow = await this.write(workflow.id, (item) => ({ ...item, branches: item.branches.map((branch2) => {
        if (branch2.label === "Main branch") return { ...branch2, label: "\u4E3B\u7EBF" };
        if (!branch2.label.startsWith("\u8DEF\u5F84 \xB7 ")) return branch2;
        const source = item.nodes.find((node2) => node2.id === branch2.forkFromNodeId), target = item.nodes.find((node2) => node2.id === item.executions.find((run) => run.branchId === branch2.id)?.nodeId);
        return { ...branch2, label: branchCaption(source, target?.title ?? branch2.label.slice(5)).slice(0, 160) };
      }) }));
      for (const branch2 of workflow.branches) {
        if (branch2.sessionId === workflow.sourceSessionId) continue;
        const run = workflow.executions.findLast((item) => item.sessionId === branch2.sessionId), node2 = workflow.nodes.find((item) => item.id === run?.nodeId);
        const coordinator = workflow.executions.some((item) => item.subagent?.parentSessionId === branch2.sessionId);
        if (!node2 && !coordinator) continue;
        const updated = await this.workspaces.rename(branch2.sessionId, node2 ? nativeSessionCaption(workflow, node2, branch2.label) : `${workflow.name.slice(0, 80)} \xB7 \u5185\u90E8\u534F\u8C03`);
        await this.workspaces.attach(branch2.sessionId, workflow.workspaceId);
        (updated ? updatedSessionIds : deferredSessionIds).push(branch2.sessionId);
      }
      return { updatedSessionIds, deferredSessionIds };
    });
  }
  async setWorkspace(request) {
    const args = parse(workspaceRequestSchema, request);
    return this.serial(args.workflowId, async () => {
      const current = this.workflow(args.workflowId);
      if (current.sourceSessionId || current.branches.length || current.executions.length || current.plans.length || current.uploadSessionId) fail("Choose the workspace before creating native Sessions; existing Session directories are immutable");
      if (args.workspaceId && !this.workspaces?.list().some((workspace) => workspace.id === args.workspaceId)) fail("Native workspace no longer exists");
      return { workflow: clone(await this.write(current.id, (item) => ({ ...item, workspaceId: args.workspaceId }))) };
    });
  }
  async list() {
    const workflows = [...this.table().entries()].filter(([, workflow]) => workflow.archivedAt === void 0).map(([, workflow]) => {
      const value = normalized(clone(workflow));
      return { ...value, nodes: projectNodes(value) };
    });
    workflows.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return { workflows };
  }
  async get(request) {
    const { id: id2 } = parse(getRequestSchema, request);
    const workflow = this.table().get(id2);
    if (!workflow || workflow.archivedAt !== void 0) return { workflow: null };
    const value = normalized(clone(workflow));
    return { workflow: { ...value, nodes: projectNodes(value) } };
  }
  async create(request) {
    const { name } = parse(createRequestSchema, request), now = Date.now();
    const workflow = normalized({ id: uid("workflow"), name, schemaVersion: 2, revision: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: now, updatedAt: now });
    await this.table().put(workflow.id, workflow);
    return { workflow: clone(workflow) };
  }
  /**
   * Deletion is an explicit user command to stop this canvas. Interrupt every
   * owned native request first, then persist terminal metadata together with
   * the archive tombstone. Source Sessions are immutable and are never
   * cancelled; their references remain available for later history review.
   */
  async stopBeforeArchive(workflow, reason = "workflow-deleted") {
    const runtime = this.native, now = Date.now();
    const sources = new Set([workflow.sourceSessionId, ...workflow.nodes.map((node2) => node2.sourceSessionId)].filter((id2) => !!id2));
    const requests = /* @__PURE__ */ new Map();
    const runsToStop = workflow.executions.filter((run) => run.status === "waiting" || run.status === "ready" || run.status === "running" || run.status === "waiting_answer" || run.status === "blocked" || run.status === "unknown" || run.durability === "needs-reconcile");
    const add = (sessionId, requestId, subagent = false) => {
      if (sources.has(sessionId)) return;
      const item = requests.get(sessionId) ?? { requestIds: /* @__PURE__ */ new Set() };
      if (requestId) item.requestIds.add(requestId);
      item.subagent ||= subagent;
      requests.set(sessionId, item);
    };
    for (const run of runsToStop) if (run.status !== "waiting") add(run.sessionId, run.requestId, !!run.subagent);
    for (const plan2 of workflow.plans.filter((plan3) => plan3.status === "running" || plan3.status === "needs-reconcile")) add(plan2.sessionId, plan2.requestId);
    for (const operation2 of workflow.operations.filter((operation3) => operation3.status === "pending" || operation3.status === "needs-reconcile")) {
      const sessionId = operation2.childSessionId ?? (["run", "compact"].includes(operation2.kind) ? operation2.sourceSessionId : void 0);
      if (sessionId && ownedSessionIds(workflow).has(sessionId)) add(sessionId);
    }
    const stopErrors = /* @__PURE__ */ new Map();
    if (requests.size && !runtime) fail("Native Session runtime is unavailable; the workflow was kept because its tasks could not be stopped");
    if (runtime) for (const [sessionId, request] of requests) {
      try {
        if (request.subagent && runtime.isRunning(sessionId)) {
          if (!runtime.cancelSubagent) throw new Error("Native subagent cancellation is unavailable");
          await runtime.cancelSubagent(sessionId);
        } else {
          for (const requestId of request.requestIds) await runtime.cancel(sessionId, requestId);
          if (runtime.isRunning(sessionId) && !this.protectedHistorySession(workflow, sessionId)) await runtime.cancel(sessionId);
        }
        if (runtime.isRunning(sessionId)) await this.waitForArchiveIdle(runtime, sessionId);
        await runtime.flush(sessionId);
        if (runtime.isRunning(sessionId)) throw new Error("Native work did not stop");
      } catch (error) {
        stopErrors.set(sessionId, err(error));
      }
    }
    if (stopErrors.size) fail(`Unable to stop workflow tasks; the workflow was kept. ${[...stopErrors].map(([id2, message]) => `${id2}: ${message}`).join("; ")}`);
    const stoppedExecutions = workflow.executions.map((run) => {
      const shouldStop = runsToStop.some((candidate) => candidate.runId === run.runId);
      if (!shouldStop) return run;
      return { ...run, status: "cancelled", waitingReason: void 0, terminalReason: run.status === "waiting" ? "queue-cancelled" : reason, updatedAt: now, ...requests.has(run.sessionId) ? { durability: "durable" } : {} };
    });
    const stoppedOperations = workflow.operations.map((operation2) => {
      if (operation2.status !== "pending" && operation2.status !== "needs-reconcile") return operation2;
      return { ...operation2, status: "failed", error: `${reason}. Previous operation outcome: ${operation2.status}${operation2.error ? `; ${operation2.error}` : ""}`.slice(0, 4e3) };
    });
    const stoppedPlans = workflow.plans.map((plan2) => {
      if (plan2.status !== "running" && plan2.status !== "needs-reconcile") return plan2;
      return { ...plan2, status: "failed", error: reason === "workflow-deleted" ? "Stopped while deleting workflow" : "Stopped by Pause all" };
    });
    return { ...workflow, executions: stoppedExecutions, operations: stoppedOperations, plans: stoppedPlans };
  }
  async waitForArchiveIdle(runtime, sessionId) {
    let timer;
    try {
      await Promise.race([runtime.waitForIdle(sessionId), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out while waiting for native cancellation")), 1e4);
      })]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  stopPolicyTimers(workflowId) {
    const timer = this.policyTimers.get(workflowId);
    if (timer) clearTimeout(timer);
    this.policyTimers.delete(workflowId);
    this.policyAgain.delete(workflowId);
    const prefix = `[${JSON.stringify(workflowId)},`;
    for (const [key, state] of this.autoAnswers) if (key.startsWith(prefix)) {
      if (state.timer) clearTimeout(state.timer);
      this.autoAnswers.delete(key);
    }
  }
  async cancelLocalQueue(workflowId, expectedRevision) {
    const workflow = this.workflow(workflowId);
    const unsuppressed = workflow.executions.filter((run) => run.admissionPolicies?.generation === "dynamic" && !workflow.operations.some((operation2) => operation2.id === policyOperationId("dynamic-plan", run.runId)));
    if (!workflow.executions.some((run) => run.status === "waiting") && !unsuppressed.length) return workflow;
    return updateWorkflowMetadata(this.table(), workflowId, (current) => {
      if (current.archivedAt !== void 0) fail("Workflow no longer exists");
      if (expectedRevision !== void 0 && current.revision !== expectedRevision) throw new RevisionConflict(normalized(current));
      const value = normalized(current), now = Math.max(Date.now(), current.updatedAt + 1);
      const suppressed = value.executions.filter((run) => run.admissionPolicies?.generation === "dynamic" && !value.operations.some((operation2) => operation2.id === policyOperationId("dynamic-plan", run.runId))).map((run) => ({ id: policyOperationId("dynamic-plan", run.runId), kind: "plan", status: "failed", triggerRunId: run.runId, error: "Automatic follow-up suppressed by explicit workflow stop", createdAt: now }));
      const next = { ...value, operations: [...value.operations, ...suppressed], executions: value.executions.map((run) => run.status === "waiting" ? { ...run, status: "cancelled", terminalReason: "queue-cancelled", waitingReason: void 0, updatedAt: now } : run) };
      return parse(workflowSchema, { ...next, nodes: projectNodes(next), revision: current.revision + 1, updatedAt: now });
    });
  }
  async pauseAll(request) {
    const { workflowId } = parse(pauseRequestSchema, request);
    return this.serial(workflowId, async () => {
      this.workflow(workflowId);
      this.archiveFlights.add(workflowId);
      this.pausedPolicies.add(workflowId);
      this.stopPolicyTimers(workflowId);
      try {
        const stopping = await this.cancelLocalQueue(workflowId), stopped = await this.stopBeforeArchive(stopping, "workflow-paused");
        const workflow = await updateWorkflowMetadata(this.table(), workflowId, (current) => {
          if (current.archivedAt !== void 0) fail("Workflow no longer exists");
          if (current.revision !== stopping.revision) throw new RevisionConflict(normalized(current));
          const now = Math.max(Date.now(), current.updatedAt + 1);
          return parse(workflowSchema, { ...stopped, nodes: projectNodes(stopped), revision: current.revision + 1, updatedAt: now });
        });
        return { workflow: clone(workflow) };
      } finally {
        this.archiveFlights.delete(workflowId);
      }
    });
  }
  async delete(request) {
    const { workflowId, expectedRevision } = parse(deleteRequestSchema, request);
    return this.serial(workflowId, async () => {
      const existing = this.table().get(workflowId);
      if (!existing || existing.archivedAt !== void 0) return { ok: false, code: "not-found", workflow: null };
      if (existing.revision !== expectedRevision) return { ok: false, code: "conflict", workflow: clone(normalized(existing)) };
      this.archiveFlights.add(workflowId);
      this.pausedPolicies.add(workflowId);
      this.stopPolicyTimers(workflowId);
      try {
        const stopping = await this.cancelLocalQueue(workflowId, expectedRevision);
        const stopped = await this.stopBeforeArchive(stopping);
        await this.table().update(workflowId, (current) => {
          if (current.archivedAt !== void 0) fail("Workflow no longer exists");
          if (current.revision !== stopping.revision) throw new RevisionConflict(normalized(current));
          const item = normalized(stopped);
          const now = Math.max(Date.now(), current.updatedAt + 1);
          return parse(workflowSchema, { ...item, archivedAt: now, revision: current.revision + 1, updatedAt: now });
        });
        this.stopPolicyTimers(workflowId);
        this.pausedPolicies.delete(workflowId);
        return { ok: true, workflowId };
      } catch (error) {
        if (error instanceof RevisionConflict) return { ok: false, code: "conflict", workflow: clone(error.workflow) };
        throw error;
      } finally {
        this.archiveFlights.delete(workflowId);
      }
    });
  }
  archiveRegistry() {
    const registry = this.ctx.get("workspaceRegistry");
    return typeof registry?.archiveSession === "function" ? registry : void 0;
  }
  archivedWorkflow(id2, revision) {
    const item = this.table().get(id2);
    if (!item || item.archivedAt === void 0) fail("Archive the workflow before choosing what to do with its native history");
    if (revision !== void 0 && item.revision !== revision) fail("The archived workflow changed; review its native history again");
    return normalized(item);
  }
  protectedHistorySession(workflow, sessionId) {
    if (workflow.sourceSessionId === sessionId || workflow.nodes.some((node2) => node2.sourceSessionId === sessionId)) return true;
    if (!ownedSessionIds(workflow).has(sessionId)) return true;
    for (const [id2, other] of this.table().entries()) if (id2 !== workflow.id && sessionReferences(other).has(sessionId)) return true;
    return false;
  }
  async historyNeedsAttention(sessionId) {
    const runtime = this.runtime(), questions = await runtime.questions?.(sessionId) ?? [], approvals = await this.controls?.approvals(sessionId) ?? [];
    return questions.some((item) => item.actionable) || approvals.some((item) => item.actionable) || Boolean(runtime.pendingQuestionReplies?.(sessionId).length);
  }
  async sessionArchivePreview(workflowId) {
    const workflow = this.archivedWorkflow(workflowId), registry = this.archiveRegistry();
    if (!registry) return { workflowId, expectedRevision: workflow.revision, available: false, sessionIds: [], protectedCount: 0, alreadyArchivedCount: 0, reason: "This DSH profile does not expose native Session archival. Physical log deletion is not a released API." };
    const runtime = this.runtime(), catalog = await runtime.catalog(), listed = new Map(catalog.map((session) => [session.sessionId, session]));
    const owned = ownedSessionIds(workflow), candidates = /* @__PURE__ */ new Set([...owned, ...[workflow.sourceSessionId, ...workflow.nodes.map((node2) => node2.sourceSessionId)].filter((id2) => Boolean(id2))]);
    const archived = new Set(registry.archivedSessionIds);
    const sessionIds = [];
    let protectedCount = 0, alreadyArchivedCount = 0;
    for (const id2 of [...candidates].sort()) {
      if (this.protectedHistorySession(workflow, id2)) {
        protectedCount++;
        continue;
      }
      if (archived.has(id2)) {
        alreadyArchivedCount++;
        continue;
      }
      const session = listed.get(id2);
      if (!session || session.running || runtime.isRunning(id2) || catalog.some((child) => child.parentSessionId === id2 && !owned.has(child.sessionId)) || await this.historyNeedsAttention(id2)) {
        protectedCount++;
        continue;
      }
      const activity = await this.ctx.waterfall("workspace/session-activity", { sessionId: SessionId6(id2) }, () => Promise.resolve([]));
      if (activity.length) {
        protectedCount++;
        continue;
      }
      sessionIds.push(id2);
    }
    this.archivedWorkflow(workflowId, workflow.revision);
    return { workflowId, expectedRevision: workflow.revision, available: true, sessionIds, protectedCount, alreadyArchivedCount };
  }
  async previewSessionArchive(request) {
    const { workflowId } = parse(questionsRequestSchema, request);
    return this.serial(workflowId, () => this.sessionArchivePreview(workflowId));
  }
  async archiveSessionHistory(request) {
    const args = parse(deleteRequestSchema.extend({ sessionIds: z2.array(z2.string().min(1).max(512)).max(4e3) }), request);
    return this.serial(args.workflowId, async () => {
      const workflow = this.archivedWorkflow(args.workflowId, args.expectedRevision), preview = await this.sessionArchivePreview(workflow.id);
      const requested = [...args.sessionIds].sort();
      if (!preview.available) fail(preview.reason ?? "Native Session archival is unavailable");
      if (new Set(requested).size !== requested.length || JSON.stringify(requested) !== JSON.stringify(preview.sessionIds)) fail("Native history eligibility changed; review the current archive preview before confirming");
      if (requested.some((id2) => this.sessionArchiveFlights.has(id2))) fail("Native history is already being archived");
      const registry = this.archiveRegistry(), runtime = this.runtime();
      for (const id2 of requested) this.sessionArchiveFlights.set(id2, workflow.id);
      const result = { archivedSessionIds: [], failedSessionIds: [], skippedSessionIds: [] };
      const guard = async (sessionId) => {
        const attention = await this.historyNeedsAttention(sessionId), current = this.archivedWorkflow(workflow.id, args.expectedRevision);
        if (this.protectedHistorySession(current, sessionId) || runtime.isRunning(sessionId) || attention) fail("Native history became shared, active or awaiting an answer before archival");
      };
      const stopGuard = this.ctx.on("workspace/session-activity", async (request2, next) => {
        const activity = await next();
        if (this.sessionArchiveFlights.get(request2.sessionId) === workflow.id) await guard(request2.sessionId);
        return activity;
      }, { prepend: true });
      try {
        for (const id2 of requested) {
          try {
            await guard(id2);
          } catch {
            result.skippedSessionIds.push(id2);
            continue;
          }
          try {
            await registry.archiveSession(SessionId6(id2));
            if (!registry.archivedSessionIds.includes(SessionId6(id2))) throw new Error("Native archive durability was not confirmed");
            result.archivedSessionIds.push(id2);
          } catch {
            if (registry.archivedSessionIds.includes(SessionId6(id2))) result.archivedSessionIds.push(id2);
            else result.failedSessionIds.push(id2);
          }
        }
        return result;
      } finally {
        stopGuard();
        for (const id2 of requested) if (this.sessionArchiveFlights.get(id2) === workflow.id) this.sessionArchiveFlights.delete(id2);
      }
    });
  }
  async save(request) {
    const { workflow, expectedRevision } = parse(saveRequestSchema, request);
    const existing = this.table().get(workflow.id);
    if (!existing || existing.archivedAt !== void 0) return { ok: false, code: "not-found", workflow: null };
    try {
      const saved = await this.write(workflow.id, (current) => {
        if (current.revision !== expectedRevision) throw new RevisionConflict(current);
        const incoming = new Map(workflow.nodes.map((node2) => [node2.id, node2]));
        for (const node2 of current.nodes) if (!incoming.has(node2.id) && (node2.kind === "session" || (current.executions ?? []).some((run) => run.nodeId === node2.id))) fail("Executed and Session nodes cannot be deleted");
        const groups = workflow.groups ?? current.groups?.map((group2) => ({ ...group2, nodeIds: group2.nodeIds.filter((nodeId) => incoming.has(nodeId)) })).filter((group2) => group2.nodeIds.length > 0);
        const verifiedReferences = knownAttachments(current);
        const planningAttachments = retainedAttachments(current, { attachments: current.planningAttachments }, workflow.planningAttachments);
        const next = { ...current, name: workflow.name, viewport: workflow.viewport, edges: workflow.edges, groups, settings: workflow.settings ?? current.settings, preferences: workflow.preferences ?? current.preferences, utilityNodes: workflow.utilityNodes ?? current.utilityNodes, planningAttachments, ...verifiedReferences.length ? { attachmentReferences: verifiedReferences } : {} };
        const changed = /* @__PURE__ */ new Set();
        next.nodes = workflow.nodes.map((node2) => {
          const old = current.nodes.find((candidate) => candidate.id === node2.id);
          if (!old) {
            const attachments3 = retainedAttachments(current, void 0, node2.attachments);
            return { id: node2.id, title: node2.title, instruction: node2.instruction, model: node2.model, attachments: attachments3, position: node2.position, zIndex: node2.zIndex, width: node2.width, height: node2.height, hidden: node2.hidden, status: "draft", revision: 1, kind: "task", source: "user", revisions: [{ revision: 1, title: node2.title, instruction: node2.instruction, model: node2.model, attachments: attachments3, dependencies: dependencies(workflow, node2.id), createdAt: Date.now() }] };
          }
          const hidden = node2.hidden ?? old.hidden;
          if (hidden && !old.hidden && ((current.executions ?? []).some((run) => run.nodeId === node2.id && (run.status === "waiting" || activeExecution(run))) || (current.operations ?? []).some((operation2) => ["run", "batch-run"].includes(operation2.kind) && operation2.status === "pending" && (operation2.nodeId === node2.id || operation2.nodeIds?.includes(node2.id))))) fail("Stop waiting or active tasks before hiding their nodes");
          if (old.kind === "session") return { ...old, position: node2.position, zIndex: node2.zIndex ?? old.zIndex, width: node2.width ?? old.width, height: node2.height ?? old.height, hidden };
          const attachments2 = retainedAttachments(current, old, node2.attachments);
          const edited = old.title !== node2.title || old.instruction !== node2.instruction || JSON.stringify(old.model) !== JSON.stringify(node2.model) || JSON.stringify(dependencies(current, node2.id)) !== JSON.stringify(dependencies(workflow, node2.id)) || JSON.stringify(attachmentIdentity(old.attachments)) !== JSON.stringify(attachmentIdentity(attachments2));
          if (!edited) return { ...old, position: node2.position, zIndex: node2.zIndex ?? old.zIndex, width: node2.width ?? old.width, height: node2.height ?? old.height, hidden };
          if ((current.executions ?? []).some((run) => run.nodeId === node2.id && activeExecution(run)) || (current.operations ?? []).some((operation2) => ["run", "batch-run"].includes(operation2.kind) && operation2.status === "pending" && [...operation2.nodeIds ?? [], ...operation2.nodeId ? [operation2.nodeId] : []].some((id2) => id2 === node2.id || dependencies(current, id2).includes(node2.id)))) fail("Cancel the active execution before editing its task or prerequisites");
          changed.add(node2.id);
          const revision = old.revision + 1;
          return { ...old, title: node2.title, instruction: node2.instruction, model: node2.model, attachments: attachments2, position: node2.position, zIndex: node2.zIndex ?? old.zIndex, width: node2.width ?? old.width, height: node2.height ?? old.height, hidden, status: "draft", revision, revisions: [...revisions(old, current), { revision, title: node2.title, instruction: node2.instruction, model: node2.model, attachments: attachments2, dependencies: dependencies(workflow, node2.id), createdAt: Date.now() }] };
        });
        const settingsChanged = JSON.stringify(authorizationSettings(next.settings)) !== JSON.stringify(authorizationSettings(current.settings));
        next.approvals = (current.approvals ?? []).filter((approval2) => !settingsChanged && !changed.has(approval2.nodeId) && incoming.has(approval2.nodeId));
        if (workflow.activeBranchId && (current.branches ?? []).some((branch2) => branch2.id === workflow.activeBranchId)) next.activeBranchId = workflow.activeBranchId;
        next.branches = (current.branches ?? []).map((branch2) => ({ ...branch2, nodeIds: [.../* @__PURE__ */ new Set([...branch2.nodeIds.filter((id2) => incoming.has(id2)), ...branch2.id === next.activeBranchId ? next.nodes.filter((node2) => !current.nodes.some((old) => old.id === node2.id)).map((node2) => node2.id) : []])] }));
        next.nodes = projectNodes(next);
        return next;
      });
      return { ok: true, workflow: clone(saved) };
    } catch (error) {
      if (error instanceof RevisionConflict) return { ok: false, code: "conflict", workflow: clone(error.workflow) };
      throw error;
    }
  }
  async catalog() {
    this.owner();
    const hidden = new Set(this.archiveRegistry()?.archivedSessionIds ?? []);
    for (const [, workflow] of this.table().entries()) {
      if (workflow.uploadSessionId) hidden.add(workflow.uploadSessionId);
      for (const run of workflow.executions ?? []) if (run.subagent) hidden.add(run.subagent.parentSessionId);
      for (const operation2 of workflow.operations ?? []) if (["prepare-attachment", "prepare-plan-attachments"].includes(operation2.kind) && operation2.childSessionId) hidden.add(operation2.childSessionId);
    }
    return { sessions: (await this.runtime().catalog()).filter((session) => !hidden.has(session.sessionId)), layout: clone(this.layouts.get("root") ?? initialLayout) };
  }
  async saveCatalogLayout(request) {
    this.owner();
    const { layout, expectedRevision } = parse(catalogLayoutRequestSchema, request);
    return this.serial("catalog-layout", async () => {
      const current = this.layouts.get("root") ?? initialLayout;
      if (current.revision !== expectedRevision) return { ok: false, layout: clone(current) };
      const next = { ...layout, zIndices: layout.zIndices ?? current.zIndices, sizes: layout.sizes ?? current.sizes, groups: layout.groups ?? current.groups, revision: current.revision + 1 };
      await this.layouts.put("root", next);
      return { ok: true, layout: clone(next) };
    });
  }
  async importSession(request) {
    const { sessionId } = parse(importRequestSchema, request);
    const runtime = this.runtime();
    return this.serial("import", async () => {
      const assertImportable = () => {
        if (this.sessionArchiveFlights.has(sessionId) || this.archiveRegistry()?.archivedSessionIds.includes(SessionId6(sessionId))) fail("This Session is being archived or is already archived; it cannot be imported");
      };
      assertImportable();
      const existing = [...this.table().entries()].map(([, item]) => item).find((item) => item.archivedAt === void 0 && item.sourceSessionId === sessionId);
      if (existing) return { workflow: clone(existing) };
      const source = (await runtime.catalog()).find((item) => item.sessionId === sessionId);
      if (!source) fail("Source Session no longer exists");
      assertImportable();
      const { workflow } = await this.create({ name: source.title.slice(0, 128) });
      const root = { id: uid("session"), kind: "session", sourceSessionId: sessionId, title: source.title.slice(0, 160), instruction: "", source: "user", status: source.running ? "running" : "completed", revision: 1, position: { x: 80, y: 100 } };
      const workspaceId = this.workspaces?.list().find((item) => item.path.toLowerCase() === source.cwd?.toLowerCase())?.id;
      const saved = await this.write(workflow.id, (current) => ({ ...current, sourceSessionId: sessionId, workspaceId, nodes: [root] }));
      return { workflow: clone(saved) };
    });
  }
  attachmentNode(workflow, nodeId, nodeRevision2) {
    const node2 = workflow.nodes.find((item) => item.id === nodeId);
    if (!node2 || node2.kind === "session") fail("Select an editable task for attachments");
    if (node2.revision !== nodeRevision2) fail("Task revision changed while uploading files; refresh the task");
    if (workflow.executions.some((run) => run.nodeId === nodeId && activeExecution(run)) || workflow.operations.some((operation2) => ["run", "batch-run"].includes(operation2.kind) && operation2.status === "pending" && [...operation2.nodeIds ?? [], ...operation2.nodeId ? [operation2.nodeId] : []].some((id2) => id2 === nodeId || dependencies(workflow, id2).includes(nodeId)))) fail("Stop the active task before changing its attachments");
    return node2;
  }
  async prepareAttachment(request) {
    const args = parse(prepareAttachmentRequestSchema, request);
    return this.serial(args.workflowId, async () => {
      this.attachmentNode(this.workflow(args.workflowId), args.nodeId, args.nodeRevision);
      return this.prepareUploadSession(args.workflowId, args.operationId, "prepare-attachment", args.nodeId);
    });
  }
  async preparePlanAttachments(request) {
    const args = parse(preparePlanAttachmentsRequestSchema, request);
    return this.serial(args.workflowId, () => this.prepareUploadSession(args.workflowId, args.operationId, "prepare-plan-attachments"));
  }
  async prepareUploadSession(workflowId, operationId, kind, nodeId) {
    const runtime = this.runtime();
    let current = this.workflow(workflowId);
    const repeated = current.operations.find((operation2) => operation2.id === operationId);
    if (repeated && repeated.kind !== kind) fail("Operation identity is already used by another action");
    if (current.uploadSessionId) {
      await runtime.read(current.uploadSessionId);
      await runtime.flush(current.uploadSessionId);
      return { workflow: clone(current), sessionId: current.uploadSessionId };
    }
    if (repeated) {
      if (!repeated.childSessionId) fail("The attachment Session preparation requires reconciliation");
      await runtime.read(repeated.childSessionId);
      await runtime.flush(repeated.childSessionId);
      current = await this.write(current.id, (item) => ({ ...item, uploadSessionId: repeated.childSessionId, operations: item.operations.map((operation2) => operation2.id === operationId ? { ...operation2, status: "completed" } : operation2) }));
      return { workflow: clone(current), sessionId: repeated.childSessionId };
    }
    const uploadSessionId = randomUUID();
    current = await this.write(current.id, (item) => ({ ...item, operations: [...item.operations, { id: operationId, kind, status: "pending", nodeId, childSessionId: uploadSessionId, createdAt: Date.now() }] }));
    try {
      const created = await runtime.create({ sessionId: uploadSessionId, cwd: this.workspacePath(current) });
      if (created.sessionId !== uploadSessionId) fail("Native upload Session identity changed unexpectedly");
      await runtime.flush(uploadSessionId);
      current = await this.write(current.id, (item) => ({ ...item, uploadSessionId, operations: item.operations.map((operation2) => operation2.id === operationId ? { ...operation2, status: "completed" } : operation2) }));
      return { workflow: clone(current), sessionId: uploadSessionId };
    } catch (error) {
      await this.operationFailure(current.id, operationId, error);
      throw error;
    }
  }
  async attach(request) {
    const args = parse(attachRequestSchema, request);
    return this.attachFilesAction({ ...args, receiptIds: [args.receiptId] });
  }
  async attachFiles(request) {
    return this.attachFilesAction(parse(attachFilesRequestSchema, request));
  }
  async attachFilesAction(args) {
    const runtime = this.runtime();
    return this.serial(args.workflowId, async () => {
      let current = this.workflow(args.workflowId);
      const repeated = current.operations.find((operation2) => operation2.id === args.operationId);
      if (repeated) {
        if (repeated.kind !== "attach") fail("Operation identity is already used by another action");
        return { workflow: clone(current) };
      }
      const node2 = this.attachmentNode(current, args.nodeId, args.nodeRevision);
      if (!current.uploadSessionId || args.sessionId !== current.uploadSessionId) fail("Upload receipt must belong to this workflow's private attachment Session");
      if ((node2.attachments?.length ?? 0) + args.receiptIds.length > 100) fail("A task can contain at most 100 attachments");
      const files = [];
      for (const receiptId of args.receiptIds) files.push(await runtime.resolveUploadedFile(args.sessionId, receiptId));
      const now = Date.now();
      const added = files.map((file) => ({ id: uid("attachment"), file: { attachmentId: file.attachmentId, name: file.name, bytes: file.bytes }, createdAt: now }));
      current = await this.write(current.id, (item) => {
        const target = this.attachmentNode(item, args.nodeId, args.nodeRevision);
        if (item.uploadSessionId !== args.sessionId) fail("Attachment Session changed before admission");
        const attachments2 = [...target.attachments ?? [], ...added], revision = target.revision + 1;
        const updated = { ...target, attachments: attachments2, revision, status: "draft", revisions: [...revisions(target, item), { revision, title: target.title, instruction: target.instruction, model: target.model, attachments: attachments2, dependencies: dependencies(item, target.id), createdAt: now }] };
        return { ...item, nodes: item.nodes.map((node3) => node3.id === target.id ? updated : node3), attachmentReferences: [...knownAttachments(item), ...added], approvals: item.approvals.filter((approval2) => approval2.nodeId !== target.id), operations: [...item.operations, { id: args.operationId, kind: "attach", status: "completed", nodeId: target.id, childSessionId: args.sessionId, attachmentId: added[0].id, createdAt: now }] };
      });
      return { workflow: clone(current) };
    });
  }
  async attachPlanFiles(request) {
    const args = parse(attachPlanFilesRequestSchema, request), runtime = this.runtime();
    return this.serial(args.workflowId, async () => {
      let current = this.workflow(args.workflowId);
      const repeated = current.operations.find((operation2) => operation2.id === args.operationId);
      if (repeated) {
        if (repeated.kind !== "attach-plan-files") fail("Operation identity is already used by another action");
        return { workflow: clone(current) };
      }
      if (!current.uploadSessionId || args.sessionId !== current.uploadSessionId) fail("Upload receipt must belong to this workflow's private attachment Session");
      if ((current.planningAttachments?.length ?? 0) + args.receiptIds.length > 100) fail("A planning draft can contain at most 100 attachments");
      const files = [];
      for (const receiptId of args.receiptIds) files.push(await runtime.resolveUploadedFile(args.sessionId, receiptId));
      const now = Date.now(), added = files.map((file) => ({ id: uid("attachment"), file: { attachmentId: file.attachmentId, name: file.name, bytes: file.bytes }, createdAt: now }));
      current = await this.write(current.id, (item) => {
        if (item.uploadSessionId !== args.sessionId) fail("Attachment Session changed before admission");
        const planningAttachments = [...item.planningAttachments ?? [], ...added];
        if (planningAttachments.length > 100) fail("A planning draft can contain at most 100 attachments");
        return { ...item, planningAttachments, attachmentReferences: [...knownAttachments(item), ...added], operations: [...item.operations, { id: args.operationId, kind: "attach-plan-files", status: "completed", childSessionId: args.sessionId, attachmentId: added[0].id, createdAt: now }] };
      });
      return { workflow: clone(current) };
    });
  }
  async approve(request) {
    const { workflowId, nodeId, approved } = parse(approveRequestSchema, request);
    const saved = await this.write(workflowId, (current) => {
      const node2 = current.nodes.find((item) => item.id === nodeId);
      if (!node2 || node2.kind === "session") fail("Select an editable task");
      if (current.executions.some((run) => run.nodeId === nodeId && activeExecution(run)) || current.operations.some((operation2) => ["run", "batch-run"].includes(operation2.kind) && (operation2.nodeId === nodeId || operation2.nodeIds?.includes(nodeId)) && operation2.status === "pending")) fail("Task is currently executing");
      const approval2 = { id: uid("approval"), nodeId, nodeRevision: node2.revision, fingerprint: fingerprint(current, node2), decision: approved ? "approved" : "rejected", createdAt: Date.now() };
      const next = { ...current, approvals: [...(current.approvals ?? []).filter((item) => item.nodeId !== nodeId), approval2] };
      return { ...next, nodes: projectNodes(next) };
    });
    return { workflow: clone(saved) };
  }
  async run(request) {
    return this.runAction(parse(runRequestSchema, request));
  }
  async batchRun(request) {
    const args = parse(batchRunRequestSchema, request);
    const runtime = this.runtime();
    const result = await this.serial(args.workflowId, async () => {
      if (this.stopped) fail("Workflow plugin is stopping");
      let current = this.workflow(args.workflowId);
      this.pausedPolicies.delete(args.workflowId);
      const repeated = current.operations.find((operation2) => operation2.id === args.operationId);
      if (repeated) {
        if (repeated.kind !== "batch-run") fail("Operation identity is already used by another action");
        return { workflow: clone(current), runIds: repeated.runIds ?? [] };
      }
      if (current.settings.subagents === "on" && (!runtime.supportsSubagents?.() || !runtime.startSubagent || !runtime.cancelSubagent)) fail("\u5F53\u524D DSH \u672A\u63D0\u4F9B\u53EF\u7528\u7684\u539F\u751F\u5B50\u667A\u80FD\u4F53\uFF0C\u8BF7\u9009\u62E9\u5173\u95ED\u6216\u81EA\u52A8\u51B3\u5B9A\u3002");
      let branch2 = current.branches.find((item) => item.id === (args.branchId ?? current.activeBranchId));
      if (args.branchId && !branch2) fail("Selected branch no longer exists");
      const nodes = args.nodeIds.map((nodeId) => {
        const node2 = current.nodes.find((item) => item.id === nodeId);
        if (!node2 || node2.kind === "session") fail("Select editable tasks to execute");
        if (node2.hidden) fail("Restore hidden tasks before running them");
        if (!node2.instruction.trim()) fail(`Task instructions are empty: ${node2.title}`);
        if (args.nodeRevisions[node2.id] !== node2.revision) fail("Task revision changed before batch Run; refresh the selected tasks");
        if (branch2 && node2.branchIds?.length && !node2.branchIds.includes(branch2.id) && !branch2.nodeIds.includes(node2.id)) fail("A selected task does not belong to the selected branch");
        return node2;
      });
      const entries = await Promise.all(nodes.map(async (node2) => {
        const existing = current.executions.findLast((run) => run.nodeId === node2.id && run.nodeRevision === node2.revision && !!branch2 && runVisible(current, run, branch2) && (run.status === "waiting" || activeExecution(run)));
        const resolvedModel = existing?.resolvedModel ?? await this.resolveWorkflowModel(current, node2);
        return { nodeId: node2.id, revision: node2.revision, fingerprint: fingerprint(current, node2, resolvedModel), resolvedModel, existing, runId: existing?.runId ?? uid("run"), requestId: existing?.requestId ?? uid("workflow-request"), operationId: uid("batch-item") };
      }));
      const runIds = entries.map((entry) => entry.runId);
      const resolvedAccessMode = await this.resolveAccessMode(current);
      current = await this.write(current.id, (item) => {
        for (const entry of entries) {
          const node2 = item.nodes.find((node3) => node3.id === entry.nodeId);
          if (!node2 || fingerprint(item, node2, entry.resolvedModel) !== entry.fingerprint) fail("Selected tasks changed before batch authorization");
        }
        return { ...item, operations: [...item.operations, { id: args.operationId, kind: "batch-run", status: entries.every((entry) => entry.existing) ? "completed" : "pending", createdAt: Date.now(), nodeIds: args.nodeIds, runIds, sourceSessionId: branch2?.sessionId ?? item.sourceSessionId }] };
      });
      if (entries.every((entry) => entry.existing)) return { workflow: clone(current), runIds };
      try {
        if (!branch2) {
          branch2 = await this.newBranch(current, current.sourceSessionId, void 0, "\u4E3B\u7EBF", args.operationId);
          current = this.workflow(current.id);
        }
        const now = Date.now();
        current = await this.write(current.id, (item) => {
          for (const entry of entries) {
            const node2 = item.nodes.find((node3) => node3.id === entry.nodeId);
            if (!node2 || node2.kind === "session" || !node2.instruction.trim() || fingerprint(item, node2, entry.resolvedModel) !== entry.fingerprint) fail("Selected tasks or policies changed while preparing the batch Session");
            if (node2.branchIds?.length && !node2.branchIds.includes(branch2.id) && !branch2.nodeIds.includes(node2.id)) fail("Selected task branch membership changed");
          }
          const added = entries.filter((entry) => !entry.existing);
          const executions = added.map((entry) => ({ runId: entry.runId, nodeId: entry.nodeId, nodeRevision: entry.revision, branchId: branch2.id, sessionId: branch2.sessionId, requestId: entry.requestId, status: "waiting", turns: [], createdAt: now, updatedAt: now, durability: "pending", admissionPolicies: clone(item.settings), resolvedModel: entry.resolvedModel, resolvedAccessMode, authorizationFingerprint: entry.fingerprint }));
          const approvals = added.map((entry) => ({ id: uid("batch-authorization"), nodeId: entry.nodeId, nodeRevision: entry.revision, fingerprint: entry.fingerprint, resolvedModel: entry.resolvedModel, decision: "approved", createdAt: now }));
          const operations = added.map((entry) => ({ id: entry.operationId, kind: "run", status: "completed", createdAt: now, nodeId: entry.nodeId, runId: entry.runId, sourceSessionId: branch2.sessionId }));
          return { ...item, approvals: [...item.approvals.filter((approval2) => !added.some((entry) => entry.nodeId === approval2.nodeId)), ...approvals], executions: [...item.executions, ...executions], operations: [...item.operations.map((operation2) => operation2.id === args.operationId ? { ...operation2, status: "completed" } : operation2), ...operations], branches: item.branches.map((item2) => item2.id === branch2.id ? { ...item2, nodeIds: [.../* @__PURE__ */ new Set([...item2.nodeIds, ...args.nodeIds])] } : item2) };
        });
        return { workflow: clone(current), runIds };
      } catch (error) {
        await this.operationFailure(current.id, args.operationId, error);
        throw error;
      }
    });
    await this.dispatchQueue(args.workflowId);
    return { ...result, workflow: clone(this.workflow(args.workflowId)) };
  }
  async runAction(args) {
    const runtime = this.runtime();
    const result = await this.serial(args.workflowId, async () => {
      if (this.stopped) fail("Workflow plugin is stopping");
      let current = this.workflow(args.workflowId);
      this.pausedPolicies.delete(args.workflowId);
      const repeated = current.operations.find((item) => item.id === args.operationId);
      if (repeated) {
        if (repeated.kind !== "run") fail("Operation identity is already used by another action");
        return { workflow: clone(current), runId: repeated.runId };
      }
      if (current.settings.subagents === "on" && (!runtime.supportsSubagents?.() || !runtime.startSubagent || !runtime.cancelSubagent)) fail("\u5F53\u524D DSH \u672A\u63D0\u4F9B\u53EF\u7528\u7684\u539F\u751F\u5B50\u667A\u80FD\u4F53\uFF0C\u8BF7\u9009\u62E9\u5173\u95ED\u6216\u81EA\u52A8\u51B3\u5B9A\u3002");
      const node2 = current.nodes.find((item) => item.id === args.nodeId);
      if (!node2 || node2.kind === "session") fail("Select a task to execute");
      if (!node2.instruction.trim()) fail("Task instructions are empty");
      if (node2.hidden) fail("Restore hidden tasks before running them");
      if (args.nodeRevision !== void 0 && args.nodeRevision !== node2.revision) fail("Task revision changed before Run; refresh and run the current version");
      let branch2 = current.branches.find((item) => item.id === (args.branchId ?? current.activeBranchId));
      if (args.branchId && !branch2) fail("Selected branch no longer exists");
      if (branch2 && node2.branchIds?.length && !node2.branchIds.includes(branch2.id) && !branch2.nodeIds.includes(node2.id)) fail("Task does not belong to the selected branch");
      const existing = current.executions.find((run) => run.nodeId === node2.id && run.nodeRevision === node2.revision && !!branch2 && runVisible(current, run, branch2) && (run.status === "waiting" || activeExecution(run)));
      if (existing) {
        current = await this.write(current.id, (item) => ({ ...item, operations: [...item.operations, { id: args.operationId, kind: "run", status: "completed", createdAt: Date.now(), nodeId: node2.id, runId: existing.runId, sourceSessionId: existing.sessionId }] }));
        return { workflow: clone(current), runId: existing.runId };
      }
      const resolvedModel = await this.resolveWorkflowModel(current, node2);
      const resolvedAccessMode = await this.resolveAccessMode(current);
      const authorizationFingerprint = fingerprint(current, node2, resolvedModel);
      const runId = uid("run"), requestId = uid("workflow-request");
      current = await this.write(current.id, (item) => {
        const admitted = item.nodes.find((task) => task.id === node2.id);
        if (!admitted || fingerprint(item, admitted, resolvedModel) !== authorizationFingerprint) fail("Task or policies changed while resolving the selected model; click Run again");
        return { ...item, operations: [...item.operations, { id: args.operationId, kind: "run", status: "pending", createdAt: Date.now(), nodeId: node2.id, runId, sourceSessionId: branch2?.sessionId ?? item.sourceSessionId }] };
      });
      try {
        if (!branch2) {
          branch2 = await this.newBranch(current, current.sourceSessionId, void 0, "\u4E3B\u7EBF", args.operationId);
          current = this.workflow(current.id);
        }
        const now = Date.now();
        const execution2 = { runId, nodeId: node2.id, nodeRevision: node2.revision, branchId: branch2.id, sessionId: branch2.sessionId, requestId, status: "waiting", turns: [], createdAt: now, updatedAt: now, durability: "pending", admissionPolicies: clone(current.settings), resolvedModel, resolvedAccessMode, authorizationFingerprint };
        current = await this.write(current.id, (item) => {
          const admitted = item.nodes.find((task) => task.id === node2.id);
          if (!admitted || fingerprint(item, admitted, resolvedModel) !== authorizationFingerprint) fail("Task or policies changed while preparing the native Session; click Run again");
          const approval2 = { id: uid("run-authorization"), nodeId: node2.id, nodeRevision: node2.revision, fingerprint: authorizationFingerprint, resolvedModel, decision: "approved", createdAt: now };
          return { ...item, approvals: [...item.approvals.filter((candidate) => candidate.nodeId !== node2.id), approval2], executions: [...item.executions, execution2], operations: item.operations.map((operation2) => operation2.id === args.operationId ? { ...operation2, status: "completed" } : operation2), branches: item.branches.map((entry) => entry.id === branch2.id ? { ...entry, nodeIds: [.../* @__PURE__ */ new Set([...entry.nodeIds, node2.id])] } : entry) };
        });
        return { workflow: clone(current), runId };
      } catch (error) {
        await this.operationFailure(current.id, args.operationId, error);
        throw error;
      }
    });
    await this.dispatchQueue(args.workflowId);
    return { ...result, workflow: clone(this.workflow(args.workflowId)) };
  }
  async cancel(request) {
    const { workflowId, runId } = parse(traceRequestSchema, request);
    return this.serial(workflowId, async () => {
      const current = this.workflow(workflowId);
      const run = current.executions.find((item) => item.runId === runId);
      if (!run) fail("Execution not found");
      if (run.status === "waiting") {
        const workflow = await this.write(workflowId, (item) => ({ ...item, executions: item.executions.map((execution2) => execution2.runId === runId ? { ...execution2, status: "cancelled", terminalReason: "queue-cancelled", waitingReason: void 0, updatedAt: Date.now() } : execution2) }));
        return { workflow: clone(workflow), runId };
      }
      if (run.sessionId === current.sourceSessionId) fail("Source Session is read only");
      const outcome = run.subagent ? (await this.runtime().cancelSubagent(run.sessionId), "active") : await this.runtime().cancel(run.sessionId, run.requestId);
      if (outcome === "queued") {
        await this.runtime().flush(run.sessionId);
        await this.write(workflowId, (item) => {
          const next = { ...item, executions: item.executions.map((execution2) => execution2.runId === runId ? { ...execution2, status: "cancelled", terminalReason: "queue-removed", durability: "durable", updatedAt: Date.now() } : execution2) };
          return { ...next, nodes: projectNodes(next) };
        });
      } else await this.reconcileSession(run.sessionId);
      return { workflow: clone(this.workflow(workflowId)), runId };
    });
  }
  async trace(request) {
    const { workflowId, runId } = parse(traceRequestSchema, request);
    const current = this.workflow(workflowId);
    const run = current.executions.find((item) => item.runId === runId);
    if (!run) fail("Execution not found");
    if (localQueueRecord(run) || run.terminalReason === "queue-removed") return { trace: { runId, sessionId: run.sessionId, status: run.status, startSeq: run.startSeq, endSeq: run.endSeq, steps: [], summary: run.summary, terminalReason: run.terminalReason, error: run.error } };
    const log = await this.runtime().read(run.sessionId);
    const projection = this.project(log, run);
    const questions = await this.runtime().questions?.(run.sessionId) ?? [];
    const waiting = projection.endSeq === void 0 && questions.some((question) => question.actionable && question.state === "open" && this.questionBelongs(log, run, question.callId));
    return { trace: { runId, sessionId: run.sessionId, status: waiting ? "waiting_answer" : nativeStatus(projection.status), startSeq: projection.startSeq, endSeq: projection.endSeq, steps: projection.steps.map((step) => ({ ...step, status: nativeStatus(step.status) })), summary: projection.assistantText, terminalReason: projection.terminalReason } };
  }
  async details(request) {
    const { workflowId, runId, stepId } = parse(detailsRequestSchema, request);
    const current = this.workflow(workflowId);
    const run = current.executions.find((item) => item.runId === runId);
    if (!run) fail("Execution not found");
    if (localQueueRecord(run)) fail("The waiting request has no native execution steps");
    const log = await this.runtime().read(run.sessionId), projection = this.project(log, run);
    const details = readTraceStepDetails(log, projection, stepId);
    return { details: { ...details, stepId, timestamp: details.time, status: nativeStatus(details.status) } };
  }
  /** Verify a question against the exact owned native tool occurrence, not the
   * canvas selection or a caller-supplied Session. Later unrelated user work
   * makes late steering unsafe even if the native projection still retains it. */
  questionBelongs(log, run, callId) {
    if (localQueueRecord(run) || ["cancelled", "failed", "interrupted"].includes(run.status)) return false;
    const projection = this.project(log, run);
    const step = projection.steps.find((item) => item.callId === callId && item.toolName === "ask_user_question");
    if (!step) return false;
    const ownQuestions = new Set(projection.steps.filter((item) => item.toolName === "ask_user_question").map((item) => item.callId));
    return !log.events.some((event) => {
      if (event.seq <= step.eventStartSeq || event.type !== "user/message") return false;
      const source = event.data.source && typeof event.data.source === "object" ? event.data.source : void 0;
      if (source && ["model-selection", "runtime-context", "tool-registry", "skill-catalog", "time-context"].includes(String(source.kind))) return false;
      return !(source?.kind === "user-question-reply" && source.outcome === "answered" && ownQuestions.has(String(source.callId)));
    });
  }
  questionRunSafe(workflow, log, run) {
    const index = workflow.executions.findIndex((item) => item.runId === run.runId);
    const settled = this.project(log, run).endSeq !== void 0;
    if (workflow.executions.slice(index + 1).some((item) => item.sessionId === run.sessionId && (activeExecution(item) || item.status === "unknown" || item.durability === "needs-reconcile" || settled && item.status === "waiting"))) return false;
    return !workflow.operations.some((operation2) => operation2.status === "pending" && ["run", "batch-run"].includes(operation2.kind) && operation2.sourceSessionId === run.sessionId && operation2.runId !== run.runId && !operation2.runIds?.includes(run.runId));
  }
  async ownsQuestion(sessionId, callId) {
    const log = await this.runtime().read(sessionId);
    for (const [, raw] of this.table().entries()) if (raw.archivedAt === void 0 && raw.sourceSessionId !== sessionId) {
      const workflow = normalized(raw);
      if (workflow.executions.some((run) => run.sessionId === sessionId && workflow.branches.some((branch2) => branch2.id === run.branchId && branch2.sessionId === sessionId) && this.questionRunSafe(workflow, log, run) && this.questionBelongs(log, run, callId))) return true;
    }
    return false;
  }
  automationKey(question) {
    return JSON.stringify([question.workflowId, question.runId, question.sessionId, question.callId]);
  }
  automateQuestions(workflow, questions) {
    if (this.archiveFlights.has(workflow.id) || this.pausedPolicies.has(workflow.id)) return questions;
    const policy = workflow.preferences?.questionTimeout, prefix = `[${JSON.stringify(workflow.id)},`, live = new Set(questions.map((question) => this.automationKey(question)));
    for (const [key, state] of this.autoAnswers) if (key.startsWith(prefix) && (!live.has(key) || !policy?.enabled)) {
      if (state.timer) clearTimeout(state.timer);
      this.autoAnswers.delete(key);
    }
    return questions.map((question) => {
      const answers = recommendedAnswers(question.questions);
      if (!policy?.enabled || question.state !== "open" || !question.actionable || !answers) return question;
      const key = this.automationKey(question), signature = JSON.stringify([question.questions, policy.seconds]);
      let state = this.autoAnswers.get(key);
      if (state?.signature !== signature) {
        if (state?.timer) clearTimeout(state.timer);
        state = { at: Date.now() + policy.seconds * 1e3, signature, paused: false };
        this.autoAnswers.set(key, state);
      }
      if (!state.paused && !state.timer) {
        const active = state;
        state.timer = setTimeout(() => {
          active.timer = void 0;
          active.paused = true;
          if (this.stopped || this.archiveFlights.has(workflow.id) || this.pausedPolicies.has(workflow.id)) return;
          void (async () => {
            const current = this.workflow(workflow.id);
            if (!current.preferences?.questionTimeout?.enabled || current.preferences.questionTimeout.seconds !== policy.seconds) return;
            await this.answerQuestion({ workflowId: question.workflowId, runId: question.runId, sessionId: question.sessionId, callId: question.callId, answers });
          })().catch((error) => this.ctx.logger.warn("Workflow recommended answer was not accepted", error));
        }, Math.max(0, state.at - Date.now()));
      }
      return { ...question, autoContinueAt: state.at, ...state.paused ? { autoContinuePaused: true } : {} };
    });
  }
  async pauseQuestionAutomation(request) {
    const args = parse(pauseQuestionRequestSchema, request), pending = (await this.questions({ workflowId: args.workflowId })).questions.find((question) => question.runId === args.runId && question.sessionId === args.sessionId && question.callId === args.callId);
    if (!pending) return { accepted: false };
    const key = this.automationKey(pending), state = this.autoAnswers.get(key);
    if (state) {
      state.paused = true;
      if (state.timer) clearTimeout(state.timer);
      state.timer = void 0;
    }
    return { accepted: true };
  }
  async questions(request) {
    const { workflowId } = parse(questionsRequestSchema, request), workflow = this.workflow(workflowId), runtime = this.runtime();
    if (!runtime.questions) return { questions: [] };
    const questions = [];
    for (const sessionId of new Set(workflow.executions.map((run) => run.sessionId))) {
      if (sessionId === workflow.sourceSessionId) continue;
      const pending = await runtime.questions(sessionId);
      if (!pending.length) continue;
      const log = await runtime.read(sessionId);
      for (const question of pending) {
        if (question.sessionId !== sessionId) continue;
        const run = workflow.executions.find((item) => item.sessionId === sessionId && this.questionRunSafe(workflow, log, item) && this.questionBelongs(log, item, question.callId));
        if (run && workflow.branches.some((branch2) => branch2.id === run.branchId && branch2.sessionId === sessionId)) questions.push({ ...question, workflowId, runId: run.runId, nodeId: run.nodeId });
      }
    }
    return { questions: this.automateQuestions(workflow, questions) };
  }
  approvalBelongs(log, run, approvalId, callId) {
    if (localQueueRecord(run) || ["cancelled", "failed", "interrupted"].includes(run.status)) return false;
    const projection = this.project(log, run), step = projection.steps.find((item) => item.type === "approval" && item.stepId === `${run.runId}:approval:${approvalId}` && item.callId === callId);
    return !!step && projection.endSeq === void 0 && step.eventEndSeq === void 0;
  }
  async ownsApproval(sessionId, callId, approvalId) {
    const log = await this.runtime().read(sessionId);
    for (const [, raw] of this.table().entries()) if (raw.archivedAt === void 0 && raw.sourceSessionId !== sessionId) {
      const workflow = normalized(raw);
      if (workflow.executions.some((run) => run.sessionId === sessionId && workflow.branches.some((branch2) => branch2.id === run.branchId && branch2.sessionId === sessionId) && this.approvalBelongs(log, run, approvalId, callId))) return true;
    }
    return false;
  }
  async pendingApprovals(request) {
    const { workflowId } = parse(questionsRequestSchema, request), workflow = this.workflow(workflowId), approvals = [];
    if (!this.controls) return { approvals };
    for (const sessionId of new Set(workflow.executions.map((run) => run.sessionId))) {
      if (sessionId === workflow.sourceSessionId) continue;
      const pending = await this.controls.approvals(sessionId);
      if (!pending.length) continue;
      const log = await this.runtime().read(sessionId);
      for (const approval2 of pending) {
        const run = workflow.executions.find((item) => item.sessionId === sessionId && this.approvalBelongs(log, item, approval2.approvalId, approval2.callId));
        if (run) approvals.push({ ...approval2, workflowId, runId: run.runId, nodeId: run.nodeId });
      }
    }
    return { approvals };
  }
  async answerApproval(request) {
    const args = parse(answerApprovalRequestSchema, request);
    return this.serial(args.workflowId, async () => {
      const workflow = this.workflow(args.workflowId), run = workflow.executions.find((item) => item.runId === args.runId);
      if (!run || run.sessionId !== args.sessionId || run.sessionId === workflow.sourceSessionId) fail("Approval does not belong to this Execution Session");
      const pending = (await this.pendingApprovals({ workflowId: args.workflowId })).approvals.find((approval2) => approval2.runId === run.runId && approval2.sessionId === args.sessionId && approval2.approvalId === args.approvalId && approval2.actionable);
      if (!pending || !this.controls) return { accepted: false };
      const accepted = await this.controls.answerApproval(args.sessionId, args.approvalId, args.decision);
      if (accepted) await this.reconcileSession(args.sessionId);
      return { accepted };
    });
  }
  async answerQuestion(request) {
    const args = parse(answerQuestionRequestSchema, request);
    return this.serial(args.workflowId, async () => {
      const workflow = this.workflow(args.workflowId), run = workflow.executions.find((item) => item.runId === args.runId);
      if (!run || run.sessionId !== args.sessionId || run.sessionId === workflow.sourceSessionId) fail("Question does not belong to this execution Session");
      const runtime = this.runtime();
      if (!runtime.questions || !runtime.answerQuestion) return { accepted: false };
      const pending = (await this.questions({ workflowId: args.workflowId })).questions.find((question) => question.runId === args.runId && question.sessionId === args.sessionId && question.callId === args.callId && question.actionable);
      if (!pending) return { accepted: false };
      if (args.answers.length !== pending.questions.length || new Set(args.answers.map((answer) => answer.id)).size !== args.answers.length || args.answers.some((answer) => !pending.questions.some((question) => question.id === answer.id))) fail("Answers must match every native question exactly once");
      for (const answer of args.answers) {
        const question = pending.questions.find((question2) => question2.id === answer.id);
        if (new Set(answer.selected).size !== answer.selected.length || !question.multiSelect && answer.selected.length > 1 || answer.selected.some((label) => !question.options?.some((option) => option.label === label))) fail("Select only the original native question options");
      }
      const accepted = await runtime.answerQuestion(args.sessionId, args.callId, args.answers, run.resolvedModel ? { model: run.resolvedModel, requestId: run.requestId } : void 0);
      if (accepted) await this.reconcileSession(args.sessionId);
      return { accepted };
    });
  }
  async fork(request) {
    const args = parse(forkRequestSchema, request);
    this.runtime();
    return this.serial(args.workflowId, async () => {
      let current = this.workflow(args.workflowId);
      const repeated = current.operations.find((item) => item.id === args.operationId);
      if (repeated) return { workflow: clone(current), branchId: current.branches.find((item) => item.sessionId === repeated.childSessionId)?.id };
      const run = args.runId ? current.executions.find((item) => item.runId === args.runId) : void 0;
      if (args.runId && (!run || run.status !== "completed" || run.endSeq === void 0 || run.durability !== "durable")) fail("Fork requires a completed durable execution");
      const source = run?.sessionId ?? args.sessionId ?? current.sourceSessionId;
      if (!source) fail("Select an existing source Session");
      if (!run && source !== current.sourceSessionId && !current.branches.some((branch2) => branch2.sessionId === source)) fail("Source Session does not belong to this workflow");
      const sourceLog = await this.runtime().read(source), completed = run?.endSeq ?? completedBoundary(sourceLog, args.atSeq);
      const atSeq = completed === void 0 ? void 0 : args.atSeq === void 0 ? compactionContinuationBoundary(sourceLog, completed) : completed;
      if (atSeq === void 0) fail("The source has no completed native turn boundary");
      current = await this.write(current.id, (item) => ({ ...item, operations: [...item.operations, { id: args.operationId, kind: "fork", status: "pending", createdAt: Date.now(), sourceSessionId: source, atSeq, nodeId: run?.nodeId }] }));
      try {
        const branch2 = await this.newBranch(current, source, atSeq, args.label, args.operationId, run);
        return { workflow: clone(this.workflow(current.id)), branchId: branch2.id };
      } catch (error) {
        await this.operationFailure(current.id, args.operationId, error);
        throw error;
      }
    });
  }
  async generatePlan(request) {
    return this.generatePlanAction(parse(planRequestSchema, request));
  }
  async generatePlanAction(args, triggerRunId) {
    const runtime = this.runtime();
    return this.serial(args.workflowId, async () => {
      if (triggerRunId && this.pausedPolicies.has(args.workflowId)) fail("Workflow policies are paused");
      if (triggerRunId && this.stopped) fail("Workflow plugin is stopping");
      let current = this.workflow(args.workflowId);
      const repeated = current.operations.find((item) => item.id === args.operationId);
      if (repeated) return { workflow: clone(current), planId: current.plans.find((plan2) => plan2.requestId === repeated.runId)?.id };
      const trigger = triggerRunId ? current.executions.find((run) => run.runId === triggerRunId) : void 0;
      if (triggerRunId && (!trigger || current.settings.generation !== "dynamic" || trigger.admissionPolicies?.generation !== "dynamic" || trigger.status !== "completed" || trigger.durability !== "durable" || trigger.endSeq === void 0)) fail("Dynamic suggestions require a durably completed execution admitted in Dynamic mode");
      const source = args.sourceSessionId ?? current.sourceSessionId;
      if (source && !(await runtime.catalog()).some((session) => session.sessionId === source)) fail("Selected planning Session no longer exists");
      const selectAttachments = (item) => {
        if (triggerRunId) return [];
        const draft = item.planningAttachments ?? [];
        return args.attachmentIds === void 0 ? draft : args.attachmentIds.map((id2) => draft.find((attachment) => attachment.id === id2) ?? fail("A selected planning attachment is no longer in this draft; upload or select it again"));
      };
      const attachments2 = clone(selectAttachments(current));
      const modelSelection = current.settings.model;
      const resolvedModel = await this.resolveWorkflowModel(current);
      const planId = uid("plan"), requestId = uid("plan-request");
      current = await this.write(current.id, (item) => {
        if (triggerRunId && item.settings.generation !== "dynamic") fail("Planning policy changed before admission");
        if (JSON.stringify(item.settings.model) !== JSON.stringify(modelSelection)) fail("Workflow model changed before plan generation; submit the goal again");
        if (JSON.stringify(selectAttachments(item)) !== JSON.stringify(attachments2)) fail("Planning attachments changed before admission; submit the goal again");
        return { ...item, operations: [...item.operations, { id: args.operationId, kind: "plan", status: "pending", createdAt: Date.now(), sourceSessionId: source, runId: requestId, ...triggerRunId ? { triggerRunId } : {} }] };
      });
      try {
        const branch2 = await this.newBranch(current, source, trigger?.endSeq, "Planning context", args.operationId, void 0, false);
        current = this.workflow(current.id);
        const plan2 = { id: planId, goal: args.goal, sessionId: branch2.sessionId, requestId, status: "running", tasks: [], createdAt: Date.now(), resolvedModel, attachments: attachments2, ...triggerRunId ? { triggerRunId } : {} };
        current = await this.write(current.id, (item) => {
          if (JSON.stringify(selectAttachments(item)) !== JSON.stringify(attachments2)) fail("Planning attachments changed while preparing the planning Session; submit the goal again");
          if (JSON.stringify(item.settings.model) !== JSON.stringify(modelSelection)) fail("Workflow model changed while preparing the planning Session; submit the goal again");
          return { ...item, plans: [...item.plans, plan2] };
        });
        runtime.protectPlanning(branch2.sessionId, attachments2.map((attachment) => attachment.file));
        const instruction = buildPlanningInstruction(args.goal);
        if (triggerRunId && this.stopped) fail("Workflow plugin stopped before dynamic planning submission");
        await runtime.submit({ sessionId: branch2.sessionId, requestId, text: instruction, planning: true, model: resolvedModel, files: attachments2.map((attachment) => attachment.file) });
        const submittedIds = new Set(attachments2.map((attachment) => attachment.id));
        await this.write(current.id, (item) => ({ ...item, planningAttachments: (item.planningAttachments ?? []).filter((attachment) => !submittedIds.has(attachment.id)), operations: item.operations.map((operation2) => operation2.id === args.operationId ? { ...operation2, status: "completed" } : operation2) }));
        this.finishPlanLater(current.id, planId);
        return { workflow: clone(this.workflow(current.id)), planId };
      } catch (error) {
        await this.operationFailure(current.id, args.operationId, error);
        throw error;
      }
    });
  }
  async applyPlan(request) {
    const args = parse(applyPlanRequestSchema, request);
    const saved = await this.write(args.workflowId, (current) => {
      const plan2 = current.plans.find((item) => item.id === args.planId);
      if (!plan2 || plan2.status !== "proposed") fail("No proposed plan is available");
      if (!args.accept) return { ...current, plans: current.plans.map((item) => item.id === plan2.id ? { ...item, status: "rejected" } : item) };
      const selected = new Set(args.taskIds ?? plan2.tasks.map((task) => task.id));
      if (!selected.size) fail("Select at least one proposed task");
      if ([...selected].some((id2) => !plan2.tasks.some((task) => task.id === id2))) fail("Selected task is not in this plan");
      const tasks = plan2.tasks.filter((task) => selected.has(task.id));
      if (tasks.some((task) => task.dependsOn.some((id2) => !selected.has(id2)))) fail("Accept prerequisite tasks together with dependent tasks");
      const ids = new Map(tasks.map((task) => [task.id, uid("node")]));
      const nodes = tasks.map((task) => ({ id: ids.get(task.id), title: task.title, instruction: task.instruction, source: "agent", status: "draft", revision: 1, position: { x: 0, y: 0 }, originPlanId: plan2.id, branchIds: current.activeBranchId ? [current.activeBranchId] : [] }));
      const edges = tasks.flatMap((task) => task.dependsOn.map((dependency) => ({ id: uid("edge"), source: ids.get(dependency), target: ids.get(task.id), type: "dependency" })));
      if (graphProblem([...current.nodes, ...nodes], [...current.edges, ...edges])) fail("Plan would produce an invalid graph");
      return { ...current, nodes: [...current.nodes, ...placeNewDependencyNodes(nodes, edges, current.nodes)], edges: [...current.edges, ...edges], plans: current.plans.map((item) => item.id === plan2.id ? { ...item, status: "accepted" } : item), branches: current.branches.map((branch2) => branch2.id === current.activeBranchId ? { ...branch2, nodeIds: [...branch2.nodeIds, ...nodes.map((node2) => node2.id)] } : branch2) };
    });
    return { workflow: clone(saved), planId: args.planId };
  }
  branchBusy(workflow, branch2) {
    return this.compactFlights.has(`${workflow.id}:${branch2.sessionId}`) || workflow.operations.some((operation2) => operation2.kind === "compact" && operation2.sourceSessionId === branch2.sessionId && ["pending", "needs-reconcile"].includes(operation2.status)) || this.runtime().isRunning(branch2.sessionId) || workflow.executions.some((run) => run.branchId === branch2.id && (activeExecution(run) || run.status === "unknown" || run.durability === "needs-reconcile"));
  }
  /** Resolve late: a user can queue children before their parent's durable endSeq exists. */
  async routeQueuedExecution(workflow, run, forceCoordinator = false) {
    const runtime = this.runtime(), branch2 = workflow.branches.find((item) => item.id === run.branchId), scope = manualScope(workflow, branch2);
    const required = dependencies(workflow, run.nodeId).flatMap((id2) => {
      const node2 = workflow.nodes.find((item) => item.id === id2);
      if (node2?.kind === "session") return [];
      const execution2 = workflow.executions.findLast((item) => item.nodeId === id2 && item.nodeRevision === node2?.revision && runVisible(workflow, item, branch2));
      return execution2 ? [execution2] : [];
    });
    const candidates = required.filter((candidate) => {
      const owner = workflow.branches.find((item) => item.id === candidate.branchId);
      return required.every((item) => historyContains(workflow, item, owner, candidate.endSeq));
    });
    const predecessor = candidates.at(-1);
    const reject = async (message) => {
      const saved2 = await this.write(workflow.id, (item) => ({ ...item, executions: item.executions.map((candidate) => candidate.runId === run.runId ? { ...candidate, status: "failed", durability: "durable", terminalReason: "context-isolation-required", error: message, waitingReason: void 0, updatedAt: Date.now() } : candidate) }));
      return saved2.executions.find((item) => item.runId === run.runId);
    };
    if (required.length && !predecessor) return reject("\u4EFB\u52A1\u4F9D\u8D56\u6765\u81EA\u4E0D\u540C\u7684\u72EC\u7ACB\u4F1A\u8BDD\uFF0C\u5F53\u524D\u539F\u751F Fork \u65E0\u6CD5\u5408\u5E76\u8FD9\u4E9B\u5386\u53F2\u3002\u8BF7\u5148\u9009\u62E9\u5355\u4E00\u8DEF\u5F84\uFF0C\u6216\u5EFA\u7ACB\u660E\u786E\u7684\u6C47\u603B\u4EFB\u52A1\u540E\u518D\u8FDE\u63A5\uFF1B\u672C\u6B21\u672A\u5411 Agent \u63D0\u4EA4\u3002");
    const allowed = /* @__PURE__ */ new Set();
    const visit = (id2) => {
      for (const dependency of dependencies(workflow, id2)) if (!allowed.has(dependency)) {
        allowed.add(dependency);
        visit(dependency);
      }
    };
    visit(run.nodeId);
    const baseline = scope.sourceSessionId && scope.forkBoundarySeq !== void 0 ? await runtime.read(scope.sourceSessionId) : void 0;
    const requestId = (event) => {
      if (event.type !== "user/message") return;
      const source = event.data.source;
      return typeof source?.rpcId === "string" ? source.rpcId : typeof event.data.id === "string" ? event.data.id : void 0;
    };
    const baselineIds = new Set(baseline?.events.filter((event) => event.seq <= scope.forkBoundarySeq).map(requestId).filter(Boolean));
    const owned = new Map(workflow.executions.flatMap((item) => [[item.requestId, item], ...item.subagent?.messageId ? [[item.subagent.messageId, item]] : []]));
    const clean = (log, boundary = Infinity) => {
      const checkpoints = verifiedCompactionCheckpoints(log);
      const questionOwners = /* @__PURE__ */ new Map();
      if (log.events.some((event) => event.type === "user/message" && event.data.source?.kind === "user-question-reply")) {
        for (const owner of workflow.executions) {
          const projection = projectExecution({ ...log, inheritedEventCount: 0 }, { runId: owner.runId, requestId: owner.requestId, messageId: owner.subagent?.messageId, startSeq: owner.startSeq });
          for (const step of projection.steps) if (step.toolName === "ask_user_question" && step.callId) {
            const previous = questionOwners.get(step.callId);
            questionOwners.set(step.callId, previous === null || previous && previous.owner.runId !== owner.runId ? null : { owner, seq: step.eventStartSeq });
          }
        }
      }
      return !log.events.some((event) => {
        if (event.seq > boundary || event.type !== "user/message") return false;
        const source = event.data.source;
        if (source && ["model-selection", "runtime-context", "tool-registry", "skill-catalog", "time-context"].includes(String(source.kind))) return false;
        if (checkpoints.has(event.seq)) return false;
        if (source?.kind === "skill-invocation") {
          const start = log.events.findLast((item) => item.seq < event.seq && item.type === "turn/start");
          const input = start && log.events.find((item) => item.seq > start.seq && item.seq < event.seq && item.type === "user/message" && requestId(item) && owned.has(requestId(item)));
          const skillOwner = input ? owned.get(requestId(input)) : void 0;
          if (skillOwner && (allowed.has(skillOwner.nodeId) || required.length === 0 && skillOwner.nodeId === run.nodeId)) return false;
        }
        const id2 = requestId(event);
        if (id2 && baselineIds.has(id2)) return false;
        const reply = source?.kind === "user-question-reply" && source.outcome === "answered" ? questionOwners.get(String(source.callId)) : void 0;
        const owner = reply && reply.seq < event.seq ? reply.owner : id2 ? owned.get(id2) : void 0;
        return !owner || !allowed.has(owner.nodeId) && !(required.length === 0 && owner.nodeId === run.nodeId);
      });
    };
    const atTail = (log, boundary) => {
      const latest = completedBoundary(log);
      return latest !== void 0 && compactionContinuationBoundary(log, latest) === boundary && !log.events.some((event) => event.seq > boundary && (event.type === "turn/start" || event.type === "user/message"));
    };
    let target;
    if (predecessor) {
      const owner = workflow.branches.find((item) => item.id === predecessor.branchId);
      const sourceBranch = historyContains(workflow, predecessor, branch2, predecessor.endSeq) ? branch2 : owner, sourceLog = await runtime.read(sourceBranch.sessionId), boundary = compactionContinuationBoundary(sourceLog, predecessor.endSeq);
      if (!clean(sourceLog, boundary)) return reject("\u524D\u9A71\u6267\u884C\u7684\u539F\u751F\u5386\u53F2\u5DF2\u7ECF\u5305\u542B\u5176\u4ED6\u4EFB\u52A1\u8DEF\u5F84\uFF0C\u65E0\u6CD5\u901A\u8FC7 Fork \u5220\u9664\u4E2D\u95F4\u4E0A\u4E0B\u6587\u3002\u8BF7\u4ECE\u5E72\u51C0\u5206\u652F\u91CD\u65B0\u8FD0\u884C\u524D\u9A71\uFF1B\u5DF2\u6709\u804A\u5929\u8BB0\u5F55\u4FDD\u6301\u539F\u6837\uFF0C\u672C\u6B21\u672A\u5411 Agent \u63D0\u4EA4\u3002");
      const fanOut = workflow.edges.filter((edge2) => edge2.source === predecessor.nodeId).length > 1;
      for (const candidate of forceCoordinator ? [] : [branch2, owner]) {
        if (manualScope(workflow, candidate).id !== scope.id || fanOut && candidate.id === owner.id || this.branchBusy(workflow, candidate) || workflow.executions.some((item) => item.subagent && item.sessionId === candidate.sessionId)) continue;
        const log = candidate.id === sourceBranch.id ? sourceLog : await runtime.read(candidate.sessionId);
        if (historyContains(workflow, predecessor, candidate) && atTail(log, boundary) && clean(log)) {
          target = candidate;
          break;
        }
      }
      if (!target) target = await this.forkQueuedContext(workflow, run, sourceBranch.sessionId, boundary, predecessor);
    } else {
      const log = await runtime.read(branch2.sessionId);
      if (!forceCoordinator && clean(log)) target = branch2;
      else target = await this.forkQueuedContext(workflow, run, scope.forkBoundarySeq === void 0 ? void 0 : scope.sourceSessionId, scope.forkBoundarySeq, void 0, scope);
    }
    const targetLog = await runtime.read(target.sessionId);
    if (!clean(targetLog) || predecessor && (!historyContains(this.workflow(workflow.id), predecessor, target) || !atTail(targetLog, compactionContinuationBoundary(targetLog, predecessor.endSeq)))) return reject("\u5DF2\u51C6\u5907\u7684\u5206\u652F\u4F1A\u8BDD\u5185\u5BB9\u53D1\u751F\u53D8\u5316\uFF0C\u65E0\u6CD5\u786E\u8BA4\u4E0A\u4E0B\u6587\u9694\u79BB\uFF1B\u672C\u6B21\u672A\u5411 Agent \u63D0\u4EA4\u3002\u8BF7\u4ECE\u5E72\u51C0\u5386\u53F2\u91CD\u65B0\u521B\u5EFA\u5206\u652F\u3002");
    const saved = await this.write(workflow.id, (item) => ({ ...item, ...branch2.automatic && item.activeBranchId === branch2.id ? { activeBranchId: target.id } : {}, executions: item.executions.map((candidate) => candidate.runId === run.runId ? { ...candidate, branchId: target.id, sessionId: target.sessionId, updatedAt: Date.now() } : candidate), branches: item.branches.map((candidate) => candidate.id === target.id ? { ...candidate, nodeIds: [.../* @__PURE__ */ new Set([...candidate.nodeIds, run.nodeId])] } : candidate) }));
    return saved.executions.find((item) => item.runId === run.runId);
  }
  async forkQueuedContext(workflow, run, source, atSeq, predecessor, scope) {
    const operationId = `route-${run.runId}`, previous = workflow.operations.find((item) => item.id === operationId);
    if (previous) {
      const prepared = workflow.branches.find((item) => item.sessionId === previous.childSessionId);
      if (previous.status === "completed" && prepared) return prepared;
      fail("Automatic context Fork requires reconciliation; it was not repeated");
    }
    const current = await this.write(workflow.id, (item) => ({ ...item, operations: [...item.operations, { id: operationId, kind: "fork", status: "pending", createdAt: Date.now(), runId: run.runId, nodeId: run.nodeId, sourceSessionId: source, atSeq }] }));
    try {
      const title = workflow.nodes.find((item) => item.id === run.nodeId).title;
      return await this.newBranch(current, source, atSeq, branchCaption(predecessor ? workflow.nodes.find((node2) => node2.id === predecessor.nodeId) : void 0, title).slice(0, 160), operationId, predecessor, true, true, scope);
    } catch (error) {
      await this.operationFailure(workflow.id, operationId, error);
      throw error;
    }
  }
  /** Auto is a graph decision over explicitly requested work, with no model call. */
  useSubagent(workflow, run) {
    const mode = run.admissionPolicies?.subagents ?? "off";
    if (run.resolvedAccessMode === "auto") return false;
    if (mode === "off" || !this.runtime().supportsSubagents?.()) return false;
    if (mode === "on") return true;
    const branch2 = workflow.branches.find((item) => item.id === run.branchId);
    if (!this.branchBusy(workflow, branch2)) return false;
    const scope = manualScope(workflow, branch2), ancestors = new Set(ancestorIds(workflow, run.nodeId));
    const active = workflow.executions.filter((other) => activeExecution(other) && manualScope(workflow, workflow.branches.find((b) => b.id === other.branchId)).id === scope.id);
    return active.length > 0 && active.every((other) => other.nodeId !== run.nodeId && !ancestors.has(other.nodeId) && !ancestorIds(workflow, other.nodeId).includes(run.nodeId));
  }
  async prepareSubagent(workflow, run) {
    const parent = workflow.branches.find((branch3) => branch3.id === run.branchId);
    if (parent.sessionId === workflow.sourceSessionId) fail("A source Session cannot coordinate a subagent");
    const log = await this.runtime().read(parent.sessionId), completed = completedBoundary(log), boundary = completed === void 0 ? void 0 : compactionContinuationBoundary(log, completed);
    const childId = randomUUID();
    const branch2 = { id: uid("branch"), label: `\u5B50\u667A\u80FD\u4F53 \xB7 ${taskCaption(workflow.nodes.find((node2) => node2.id === run.nodeId))}`.slice(0, 160), sessionId: childId, sourceSessionId: parent.sessionId, parentBranchId: parent.id, forkBoundarySeq: boundary, nodeIds: [...parent.nodeIds], createdAt: Date.now(), automatic: true };
    const saved = await this.write(workflow.id, (item) => {
      const queued = item.executions.find((candidate) => candidate.runId === run.runId);
      if (!queued || queued.status !== "waiting" || !queueAuthorized(item, queued) || !prerequisitesComplete(item, queued.nodeId, parent)) fail("Task changed before native child admission");
      const inputRunIds = contextCheck(item, parent).inputs(queued.nodeId).map((input) => input.runId);
      return { ...item, ...parent.automatic && item.activeBranchId === parent.id ? { activeBranchId: branch2.id } : {}, branches: [...item.branches, branch2], executions: item.executions.map((candidate) => candidate.runId === run.runId ? { ...candidate, status: "ready", waitingReason: void 0, inputRunIds, startSeq: (boundary ?? -1) + 1, branchId: branch2.id, sessionId: childId, subagent: { parentSessionId: parent.sessionId, provider: "fork" }, updatedAt: Date.now() } : candidate), operations: item.operations.map((operation2) => operation2.kind === "run" && operation2.runId === run.runId ? { ...operation2, status: "pending", sourceSessionId: parent.sessionId, childSessionId: childId } : operation2) };
    });
    return saved.executions.find((candidate) => candidate.runId === run.runId);
  }
  async dispatchQueue(workflowId) {
    if (this.stopped || this.recovering || !this.native) return;
    await this.serial(workflowId, async () => {
      if (this.table().get(workflowId)?.archivedAt !== void 0) return;
      for (; ; ) {
        let current = this.workflow(workflowId);
        if (current.executions.some((run2) => run2.status === "waiting" && !queueAuthorized(current, run2))) current = await this.write(workflowId, (item) => item);
        let selected, delegated = false;
        const reasons = /* @__PURE__ */ new Map();
        for (const run2 of current.executions.filter((run3) => run3.status === "waiting")) {
          const branch3 = current.branches.find((item) => item.id === run2.branchId);
          if (!branch3) continue;
          const check = contextCheck(current, branch3);
          if (!check.ready(run2.nodeId)) {
            reasons.set(run2.runId, check.stale(run2.nodeId) ? "stale_prerequisites" : "prerequisites");
            continue;
          }
          if (run2.admissionPolicies?.subagents === "on" && !this.runtime().supportsSubagents?.()) {
            reasons.set(run2.runId, "subagent_unavailable");
            continue;
          }
          const child = this.useSubagent(current, run2);
          if (child && current.executions.filter((item) => item.subagent && (activeExecution(item) || item.status === "unknown" || item.durability === "needs-reconcile" || this.runtime().isRunning(item.sessionId))).length >= 3) {
            reasons.set(run2.runId, "subagent_capacity");
            continue;
          }
          if (!child && this.branchBusy(current, branch3)) {
            reasons.set(run2.runId, "branch_busy");
            continue;
          }
          selected = run2;
          delegated = child;
          break;
        }
        if ([...reasons].some(([id2, reason]) => current.executions.find((run2) => run2.runId === id2)?.waitingReason !== reason)) current = await this.write(workflowId, (item) => ({ ...item, executions: item.executions.map((run2) => reasons.has(run2.runId) ? { ...run2, waitingReason: reasons.get(run2.runId) } : run2) }));
        if (!selected || this.stopped) return;
        let run = await this.routeQueuedExecution(current, selected, delegated);
        current = this.workflow(workflowId);
        if (run.status !== "waiting") {
          continue;
        }
        if (this.stopped) return;
        if (delegated) {
          run = await this.prepareSubagent(current, run);
          current = this.workflow(workflowId);
        }
        const branch2 = current.branches.find((item) => item.id === run.branchId);
        const operation2 = current.operations.find((item) => item.kind === "run" && item.runId === run.runId);
        if (!operation2) fail("Queued execution has no durable operation identity");
        const log = await this.runtime().read(run.subagent?.parentSessionId ?? run.sessionId);
        if (this.stopped) return;
        let admitted = false;
        current = await this.write(workflowId, (item) => {
          const queued = item.executions.find((candidate) => candidate.runId === run.runId);
          const busy = this.branchBusy({ ...item, executions: run.subagent ? item.executions.filter((candidate) => candidate.runId !== run.runId) : item.executions }, branch2);
          if (!queued || queued.status !== "waiting" && !(run.subagent && queued.status === "ready") || !queueAuthorized(item, queued) || !prerequisitesComplete(item, queued.nodeId, branch2) || busy) return item;
          admitted = true;
          const inputRunIds = contextCheck(item, branch2).inputs(queued.nodeId).map((input) => input.runId);
          return { ...item, executions: item.executions.map((candidate) => candidate.runId === run.runId ? { ...candidate, status: "ready", waitingReason: void 0, inputRunIds, startSeq: ((run.subagent ? completedBoundary(log) : log.events.at(-1)?.seq) ?? -1) + 1, updatedAt: Date.now() } : candidate), operations: item.operations.map((candidate) => candidate.id === operation2.id ? { ...candidate, status: "pending", sourceSessionId: run.subagent?.parentSessionId ?? run.sessionId, ...run.subagent ? { childSessionId: run.sessionId } : {} } : candidate) };
        });
        if (!admitted || this.stopped) return;
        const node2 = current.nodes.find((item) => item.id === run.nodeId);
        try {
          const task = { text: `Task: ${node2.title}

${node2.instruction}`, files: node2.attachments?.map((attachment) => attachment.file), model: run.resolvedModel };
          if (run.subagent) {
            const receipt = await this.runtime().startSubagent({ ...task, parentSessionId: run.subagent.parentSessionId, childSessionId: run.sessionId, label: taskCaption(node2), accessMode: run.resolvedAccessMode });
            await this.write(workflowId, (item) => ({ ...item, executions: item.executions.map((candidate) => candidate.runId === run.runId ? { ...candidate, subagent: { ...candidate.subagent, messageId: receipt.messageId } } : candidate) }));
          } else {
            if (run.resolvedAccessMode) await this.controls?.applyAccessMode(run.sessionId, run.resolvedAccessMode);
            await this.runtime().submit({ ...task, sessionId: run.sessionId, requestId: run.requestId });
          }
          if (this.workspaces) try {
            await this.workspaces.rename(run.sessionId, nativeSessionCaption(current, node2, branch2.label));
            await this.workspaces.attach(run.sessionId, current.workspaceId);
          } catch (error) {
            this.ctx.logger.warn("Workflow native Session label or workspace could not be updated", error);
          }
          await this.write(workflowId, (item) => ({ ...item, operations: item.operations.map((candidate) => candidate.id === operation2.id ? { ...candidate, status: "completed" } : candidate) }));
          await this.reconcileSession(run.sessionId);
        } catch (error) {
          await this.operationFailure(workflowId, operation2.id, error);
          throw error;
        }
      }
    });
  }
  queuePolicies(workflowId) {
    if (this.stopped || this.recovering || !this.native || this.archiveFlights.has(workflowId) || this.pausedPolicies.has(workflowId)) return;
    if (this.table().get(workflowId)?.archivedAt !== void 0) return;
    if (this.policyFlights.has(workflowId)) {
      this.policyAgain.add(workflowId);
      return;
    }
    if (this.policyTimers.has(workflowId)) return;
    this.policyTimers.set(workflowId, setTimeout(() => {
      this.policyTimers.delete(workflowId);
      if (this.stopped || this.recovering || !this.native) return;
      this.policyFlights.add(workflowId);
      void this.advancePolicies(workflowId).catch((error) => this.ctx.logger.error("Workflow policy requires attention", error)).finally(() => {
        this.policyFlights.delete(workflowId);
        if (this.policyAgain.delete(workflowId)) this.queuePolicies(workflowId);
      });
    }, 25));
  }
  /** Only explicitly clicked Run requests advance; proposals stay inert. */
  async advancePolicies(workflowId) {
    if (this.stopped || !this.native || this.archiveFlights.has(workflowId) || this.pausedPolicies.has(workflowId)) return;
    if (this.table().get(workflowId)?.archivedAt !== void 0) return;
    let current = this.workflow(workflowId);
    if (current.settings.generation === "dynamic") {
      const completed = current.executions.filter((run) => run.admissionPolicies?.generation === "dynamic" && run.status === "completed" && run.durability === "durable" && run.endSeq !== void 0);
      for (const run of completed) {
        current = this.workflow(workflowId);
        if (current.settings.generation !== "dynamic") break;
        const operationId = policyOperationId("dynamic-plan", run.runId);
        if (current.operations.some((operation2) => operation2.id === operationId)) continue;
        const task = current.nodes.find((node2) => node2.id === run.nodeId);
        const goal = `Review this successfully completed task and propose only necessary follow-up tasks for user review. Do not repeat existing tasks. Do not execute or approve anything.

Completed task: ${task?.title ?? run.nodeId}
Task instructions: ${task?.instruction ?? ""}
Observable result: ${run.summary ?? ""}
Existing task titles: ${current.nodes.filter((node2) => node2.kind !== "session").map((node2) => node2.title).join("; ")}`.slice(0, 2e4);
        await this.generatePlanAction({ workflowId, goal, sourceSessionId: run.sessionId, operationId }, run.runId);
      }
    }
    await this.dispatchQueue(workflowId);
  }
  async newBranch(workflow, source, atSeq, label, operationId, run, attach = true, automatic = false, scope) {
    const runtime = this.runtime();
    let child;
    let boundary = atSeq;
    if (this.stopped) fail("Workflow plugin is stopping");
    if (source) {
      const log = await runtime.read(source);
      if (this.stopped) fail("Workflow plugin is stopping");
      boundary = completedBoundary(log, atSeq);
      if (boundary === void 0) {
        if (log.events.length) fail("Source Session has no safe completed turn boundary");
        child = await runtime.create({ cwd: log.header.cwd, agentPreset: log.header.agentPreset });
      } else child = await runtime.fork({ sessionId: source, atSeq: boundary });
    } else {
      const base = scope ? await runtime.read(scope.sessionId) : void 0;
      child = await runtime.create({ sessionId: randomUUID(), ...base ? { cwd: base.header.cwd, agentPreset: base.header.agentPreset } : { cwd: this.workspacePath(workflow) } });
    }
    if (child.sessionId === source || workflow.branches.some((branch3) => branch3.sessionId === child.sessionId)) fail("Native child Session identity is not independent");
    const parent = workflow.branches.find((branch3) => branch3.sessionId === source);
    const shared = run ? workflow.nodes.filter((node2) => node2.kind === "session" || workflow.executions.some((execution2) => execution2.nodeId === node2.id && execution2.status === "completed" && execution2.endSeq !== void 0 && (!!parent && historyContains(workflow, execution2, parent, boundary)))).map((node2) => node2.id) : workflow.nodes.filter((node2) => node2.kind === "session").map((node2) => node2.id);
    const displayLabel = run && !automatic ? branchCaption(workflow.nodes.find((node2) => node2.id === run.nodeId), label).slice(0, 160) : label;
    const branch2 = { id: uid("branch"), label: displayLabel, sessionId: child.sessionId, sourceSessionId: source, parentBranchId: parent?.id ?? scope?.id, forkFromNodeId: run?.nodeId, forkBoundarySeq: boundary, nodeIds: shared, createdAt: Date.now(), ...automatic ? { automatic: true } : {} };
    await this.write(workflow.id, (current) => {
      const next = { ...current, ...attach ? { ...!automatic ? { activeBranchId: branch2.id } : {}, branches: [...current.branches, branch2] } : {}, operations: current.operations.map((operation2) => operation2.id === operationId ? { ...operation2, childSessionId: child.sessionId, status: operation2.kind === "fork" ? "completed" : operation2.status } : operation2) };
      next.nodes = projectNodes(next);
      return next;
    });
    return branch2;
  }
  project(log, run) {
    const projection = projectExecution(log, { runId: run.runId, requestId: run.requestId, messageId: run.subagent?.messageId, startSeq: run.startSeq, running: this.runtime().isRunning(run.sessionId) });
    const replies = this.runtime().pendingQuestionReplies?.(run.sessionId) ?? [];
    if (replies.some((callId) => projection.steps.some((step) => step.toolName === "ask_user_question" && step.callId === callId))) return { ...projection, status: "queued", endSeq: void 0, terminalReason: void 0 };
    return run.durability === "needs-reconcile" && !projection.turns.length ? { ...projection, status: "unknown" } : projection;
  }
  schedule(sessionId) {
    if (this.scheduled.has(sessionId)) return;
    this.scheduled.set(sessionId, setTimeout(() => {
      this.scheduled.delete(sessionId);
      void this.reconcileSession(sessionId).catch((error) => this.ctx.logger.error("Workflow event projection failed", error));
    }, 80));
  }
  async reconcileSession(sessionId) {
    const runtime = this.runtime();
    for (const [workflowId, raw] of this.table().entries()) {
      if (raw.archivedAt !== void 0 || this.archiveFlights.has(workflowId)) continue;
      const workflow = normalized(raw), runs = workflow.executions.filter((run) => run.sessionId === sessionId);
      if (!runs.length) continue;
      const log = await runtime.read(sessionId), questions = await runtime.questions?.(sessionId) ?? [];
      let changed = false;
      const projected = /* @__PURE__ */ new Map();
      for (const run of runs) {
        if (localQueueRecord(run) || run.terminalReason === "queue-removed" || run.subagent && !run.subagent.messageId && run.status === "ready" && workflow.operations.some((operation2) => operation2.runId === run.runId && operation2.status === "pending")) continue;
        const projection = this.project(log, run);
        const status2 = projection.endSeq === void 0 && questions.some((question) => question.actionable && question.state === "open" && this.questionBelongs(log, run, question.callId)) ? "waiting_answer" : nativeStatus(projection.status);
        let durability = run.durability;
        if (projection.endSeq !== void 0) {
          await runtime.flush(sessionId);
          durability = "durable";
        } else if (!runtime.isRunning(sessionId) && status2 === "unknown") durability = "needs-reconcile";
        const turns = projection.turns.map((turnNumber) => {
          const start = log.events.find((event) => event.type === "turn/start" && event.data.turn === turnNumber);
          const end = log.events.find((event) => event.type === "turn/end" && event.data.turn === turnNumber);
          return { turn: turnNumber, startSeq: start?.seq ?? projection.startSeq ?? 0, endSeq: end?.seq, reason: end && typeof end.data.reason === "object" && end.data.reason !== null ? String(end.data.reason.kind ?? "unknown") : void 0 };
        });
        const next = { ...run, status: status2, startSeq: projection.startSeq ?? run.startSeq, endSeq: projection.endSeq, turns, summary: projection.assistantText, terminalReason: projection.terminalReason, durability };
        if (JSON.stringify({ ...run, updatedAt: 0 }) !== JSON.stringify({ ...next, updatedAt: 0 })) {
          changed = true;
          projected.set(run.runId, { ...next, updatedAt: Date.now() });
        }
      }
      if (changed && !this.archiveFlights.has(workflowId) && this.table().get(workflowId)?.archivedAt === void 0) await this.write(workflowId, (current) => {
        const executions = current.executions.map((run) => projected.get(run.runId) ?? run);
        const next = { ...current, executions };
        return { ...next, nodes: projectNodes(next) };
      });
      this.queuePolicies(workflowId);
    }
  }
  async operationFailure(workflowId, operationId, error) {
    await this.write(workflowId, (current) => ({ ...current, operations: current.operations.map((operation2) => operation2.id === operationId ? { ...operation2, status: "needs-reconcile", error: err(error) } : operation2), executions: current.executions.map((run) => current.operations.some((operation2) => operation2.id === operationId && operation2.runId === run.runId) ? { ...run, status: "unknown", durability: "needs-reconcile", error: err(error) } : run), plans: current.plans.map((plan2) => current.operations.some((operation2) => operation2.id === operationId && operation2.kind === "plan" && operation2.runId === plan2.requestId) ? { ...plan2, status: "needs-reconcile", error: err(error) } : plan2) }));
  }
  finishPlanLater(workflowId, planId) {
    let settling;
    const unchanged = (plan2) => plan2.id === planId && plan2.status === settling?.status && plan2.error === settling?.error;
    void (async () => {
      const plan2 = this.workflow(workflowId).plans.find((item) => item.id === planId);
      if (!plan2) return;
      settling = plan2;
      const runtime = this.runtime();
      await runtime.waitForIdle(plan2.sessionId);
      if (this.archiveFlights.has(workflowId) || this.table().get(workflowId)?.archivedAt !== void 0) return;
      await runtime.flush(plan2.sessionId);
      const log = await runtime.read(plan2.sessionId);
      const projection = projectExecution(log, { runId: plan2.id, requestId: plan2.requestId, running: runtime.isRunning(plan2.sessionId) });
      if (projection.status !== "completed") throw new Error(`Planning request did not complete successfully (${projection.status})`);
      const text = assistantTextForRequest(log, plan2.requestId);
      const content = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      const parsed = parse(structuredPlanSchema, JSON.parse(content));
      if (this.archiveFlights.has(workflowId) || this.table().get(workflowId)?.archivedAt !== void 0) return;
      if (!this.table().get(workflowId)?.plans?.some(unchanged)) return;
      await this.write(workflowId, (current) => ({ ...current, plans: current.plans.map((item) => unchanged(item) ? { ...item, status: "proposed", tasks: parsed.tasks, error: void 0 } : item) }));
    })().catch(async (error) => {
      if (this.archiveFlights.has(workflowId) || this.table().get(workflowId)?.archivedAt !== void 0 || !this.table().get(workflowId)?.plans?.some(unchanged)) return;
      try {
        await this.write(workflowId, (current) => ({ ...current, plans: current.plans.map((item) => unchanged(item) ? { ...item, status: "failed", error: err(error) } : item) }));
      } catch {
        this.ctx.logger.error("Workflow plan settlement failed", error);
      }
    });
  }
  async recover() {
    this.recovering = true;
    try {
      const sessions = /* @__PURE__ */ new Set();
      for (const [, raw] of this.table().entries()) for (const plan2 of normalized(raw).plans) this.runtime().protectPlanning(plan2.sessionId, plan2.attachments?.map((attachment) => attachment.file));
      for (const [id2, raw] of this.table().entries()) {
        if (raw.archivedAt !== void 0) continue;
        const workflow = normalized(raw);
        for (const run of workflow.executions) sessions.add(run.sessionId);
        if (workflow.operations.some((operation2) => operation2.status === "pending")) await this.write(id2, (current) => {
          const uncertain = new Set(current.operations.filter((operation2) => (operation2.kind === "run" || operation2.kind === "fork") && operation2.status === "pending").map((operation2) => operation2.runId));
          const uncertainForks = new Set(current.operations.filter((operation2) => operation2.kind === "fork" && operation2.status === "pending").map((operation2) => operation2.runId));
          const error = "Host restarted before the native admission outcome was durably confirmed; it was not resubmitted";
          return { ...current, operations: current.operations.map((operation2) => operation2.status === "pending" ? { ...operation2, status: "needs-reconcile", error } : operation2), executions: current.executions.map((run) => uncertain.has(run.runId) && (run.status !== "waiting" || uncertainForks.has(run.runId)) ? { ...run, status: "unknown", durability: "needs-reconcile", error } : run) };
        });
        for (const plan2 of workflow.plans) {
          const omittedDependencies = plan2.status === "failed" && /^Invalid workflow data: tasks\.\d+\.dependsOn: Invalid input: expected array, received undefined(?:; tasks\.\d+\.dependsOn: Invalid input: expected array, received undefined)*$/.test(plan2.error ?? "") && workflow.operations.some((operation2) => operation2.kind === "plan" && operation2.runId === plan2.requestId && operation2.status === "completed");
          if (plan2.status === "running" || omittedDependencies) this.finishPlanLater(id2, plan2.id);
        }
      }
      for (const session of sessions) try {
        await this.reconcileSession(session);
      } catch (error) {
        this.ctx.logger.error("Workflow execution requires reconciliation", error);
      }
    } finally {
      this.recovering = false;
      for (const [id2] of this.table().entries()) this.queuePolicies(id2);
    }
  }
};
_init = __decoratorStart(_b);
__decorateElement(_init, 1, "capabilities", _capabilities_dec, VisualWorkflowService);
__decorateElement(_init, 1, "models", _models_dec, VisualWorkflowService);
__decorateElement(_init, 1, "accessModes", _accessModes_dec, VisualWorkflowService);
__decorateElement(_init, 1, "setAccessMode", _setAccessMode_dec, VisualWorkflowService);
__decorateElement(_init, 1, "workspacesList", _workspacesList_dec, VisualWorkflowService);
__decorateElement(_init, 1, "contextUsage", _contextUsage_dec, VisualWorkflowService);
__decorateElement(_init, 1, "skills", _skills_dec, VisualWorkflowService);
__decorateElement(_init, 1, "compactContext", _compactContext_dec, VisualWorkflowService);
__decorateElement(_init, 1, "organizeSessionNames", _organizeSessionNames_dec, VisualWorkflowService);
__decorateElement(_init, 1, "setWorkspace", _setWorkspace_dec, VisualWorkflowService);
__decorateElement(_init, 1, "list", _list_dec, VisualWorkflowService);
__decorateElement(_init, 1, "get", _get_dec, VisualWorkflowService);
__decorateElement(_init, 1, "create", _create_dec, VisualWorkflowService);
__decorateElement(_init, 1, "pauseAll", _pauseAll_dec, VisualWorkflowService);
__decorateElement(_init, 1, "delete", _delete_dec, VisualWorkflowService);
__decorateElement(_init, 1, "previewSessionArchive", _previewSessionArchive_dec, VisualWorkflowService);
__decorateElement(_init, 1, "archiveSessionHistory", _archiveSessionHistory_dec, VisualWorkflowService);
__decorateElement(_init, 1, "save", _save_dec, VisualWorkflowService);
__decorateElement(_init, 1, "catalog", _catalog_dec, VisualWorkflowService);
__decorateElement(_init, 1, "saveCatalogLayout", _saveCatalogLayout_dec, VisualWorkflowService);
__decorateElement(_init, 1, "importSession", _importSession_dec, VisualWorkflowService);
__decorateElement(_init, 1, "prepareAttachment", _prepareAttachment_dec, VisualWorkflowService);
__decorateElement(_init, 1, "preparePlanAttachments", _preparePlanAttachments_dec, VisualWorkflowService);
__decorateElement(_init, 1, "attach", _attach_dec, VisualWorkflowService);
__decorateElement(_init, 1, "attachFiles", _attachFiles_dec, VisualWorkflowService);
__decorateElement(_init, 1, "attachPlanFiles", _attachPlanFiles_dec, VisualWorkflowService);
__decorateElement(_init, 1, "approve", _approve_dec, VisualWorkflowService);
__decorateElement(_init, 1, "run", _run_dec, VisualWorkflowService);
__decorateElement(_init, 1, "batchRun", _batchRun_dec, VisualWorkflowService);
__decorateElement(_init, 1, "cancel", _cancel_dec, VisualWorkflowService);
__decorateElement(_init, 1, "trace", _trace_dec, VisualWorkflowService);
__decorateElement(_init, 1, "details", _details_dec, VisualWorkflowService);
__decorateElement(_init, 1, "pauseQuestionAutomation", _pauseQuestionAutomation_dec, VisualWorkflowService);
__decorateElement(_init, 1, "questions", _questions_dec, VisualWorkflowService);
__decorateElement(_init, 1, "pendingApprovals", _pendingApprovals_dec, VisualWorkflowService);
__decorateElement(_init, 1, "answerApproval", _answerApproval_dec, VisualWorkflowService);
__decorateElement(_init, 1, "answerQuestion", _answerQuestion_dec, VisualWorkflowService);
__decorateElement(_init, 1, "fork", _fork_dec, VisualWorkflowService);
__decorateElement(_init, 1, "generatePlan", _generatePlan_dec, VisualWorkflowService);
__decorateElement(_init, 1, "applyPlan", _applyPlan_dec, VisualWorkflowService);
__decoratorMetadata(_init, VisualWorkflowService);
__publicField(VisualWorkflowService, "inject", ["storageDomain"]);
var service_default = VisualWorkflowService;
export {
  VisualWorkflowService,
  service_default as default
};
//# sourceMappingURL=index.js.map
