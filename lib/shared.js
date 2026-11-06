// src/shared/layout.ts
var width = (node) => node.width ?? 300;
var height = (node) => node.height ?? 210;
var origin = { x: 100, y: 100 };
var columnGap = 106;
var rowGap = 80;
function layoutDependencyNodes(nodes, edges) {
  if (!nodes.length) return [];
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) return [...nodes];
  const parents = new Map(nodes.map((node) => [node.id, []])), children = new Map(nodes.map((node) => [node.id, []]));
  const incoming = new Map(nodes.map((node) => [node.id, 0])), depth = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    parents.get(edge.target).push(edge.source);
    children.get(edge.source).push(edge.target);
    incoming.set(edge.target, incoming.get(edge.target) + 1);
  }
  const ready = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  for (let index = 0; index < ready.length; index++) for (const child of children.get(ready[index])) {
    depth.set(child, Math.max(depth.get(child), depth.get(ready[index]) + 1));
    incoming.set(child, incoming.get(child) - 1);
    if (incoming.get(child) === 0) ready.push(child);
  }
  if (ready.length !== nodes.length) return [...nodes];
  const layers = Array.from({ length: Math.max(...depth.values()) + 1 }, () => []);
  for (const node of nodes) layers[depth.get(node.id)].push(node);
  const ranks = /* @__PURE__ */ new Map();
  const indexLayer = (layer) => layer.forEach((node, index) => ranks.set(node.id, index));
  layers.forEach(indexLayer);
  const order = (layer, neighbours) => {
    const scores = new Map(layer.map((node, index) => {
      const adjacent = neighbours.get(node.id);
      return [node.id, adjacent.length ? adjacent.reduce((sum, id) => sum + ranks.get(id), 0) / adjacent.length : index];
    }));
    const previous = new Map(layer.map((node, index) => [node.id, index]));
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
    for (const node of layer) {
      positions.set(node.id, { x, y });
      y += height(node) + rowGap;
    }
    x += Math.max(...layer.map(width)) + columnGap;
  }
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) }));
}

// src/shared/model.ts
var WORKFLOW_PLUGIN_VERSION = "0.18.0";
var WORKFLOW_API_VERSION = 3;
function graphProblem(nodes, edges) {
  const ids = /* @__PURE__ */ new Set();
  for (const node of nodes) {
    if (ids.has(node.id)) return "duplicate-node-id";
    ids.add(node.id);
  }
  const edgeIds = /* @__PURE__ */ new Set();
  const pairs = /* @__PURE__ */ new Set();
  const next = /* @__PURE__ */ new Map();
  const incoming = /* @__PURE__ */ new Map();
  for (const id of ids) {
    next.set(id, []);
    incoming.set(id, 0);
  }
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) return "duplicate-edge-id";
    edgeIds.add(edge.id);
    if (!ids.has(edge.source) || !ids.has(edge.target)) return "missing-endpoint";
    if (edge.source === edge.target) return "self-dependency";
    const pair = JSON.stringify([edge.source, edge.target]);
    if (pairs.has(pair)) return "duplicate-dependency";
    pairs.add(pair);
    next.get(edge.source).push(edge.target);
    incoming.set(edge.target, incoming.get(edge.target) + 1);
  }
  const ready = [...ids].filter((id) => incoming.get(id) === 0);
  let visited = 0;
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index];
    visited++;
    for (const target of next.get(id)) {
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) ready.push(target);
    }
  }
  return visited === ids.size ? null : "dependency-cycle";
}
function layoutWorkflow(workflow) {
  if (graphProblem(workflow.nodes, workflow.edges)) return workflow;
  return { ...workflow, nodes: layoutDependencyNodes(workflow.nodes, workflow.edges) };
}
export {
  WORKFLOW_API_VERSION,
  WORKFLOW_PLUGIN_VERSION,
  graphProblem,
  layoutWorkflow
};
