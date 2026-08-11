import { anchor, box } from "./layout.js";
import { inferredSides, splitEndpoint } from "./router.js";
import { BUILTIN_LAYOUT_CAPABILITIES, createLayoutAdapter } from "./scene.js";

export const LAYERED_LAYOUT_CAPABILITIES = Object.freeze({
  ...BUILTIN_LAYOUT_CAPABILITIES,
  nestedNodes: false,
  fixedPositions: false,
  fixedDimensions: false,
  edgeRouting: true,
});

function ranksFor(nodes, connections) {
  const ids = new Set(nodes.map((node) => node.id));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  for (const connection of connections) {
    for (let index = 0; index < connection.nodes.length - 1; index += 1) {
      const from = splitEndpoint(connection.nodes[index], ids).id;
      const to = splitEndpoint(connection.nodes[index + 1], ids).id;
      if (!ids.has(from) || !ids.has(to) || from === to) continue;
      outgoing.get(from).push(to);
      incoming.set(to, incoming.get(to) + 1);
    }
  }
  const rank = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const target of outgoing.get(id)) {
      rank.set(target, Math.max(rank.get(target), rank.get(id) + 1));
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  const fallbackRank = Math.max(0, ...rank.values()) + 1;
  for (const node of nodes) if (!seen.has(node.id)) rank.set(node.id, fallbackRank);
  return rank;
}

function layoutLayered({ context, sections, options }) {
  const { state, registerBounds } = context;
  const nodes = sections.filter((section) => section.type === "node");
  const connections = state.document.statements.filter((statement) => statement.type === "connection");
  const ranks = ranksFor(nodes, connections);
  const layers = Map.groupBy(nodes, (node) => ranks.get(node.id));
  const nodeWidth = 240;
  const columnGap = options.columnGap ?? 100;
  const rowGap = options.gap ?? 36;
  let bottom = options.startY;
  for (const [rank, layer] of [...layers].sort(([left], [right]) => left - right)) {
    let y = options.startY;
    for (const node of layer) {
      const height = state.measurer.measureNode(node, nodeWidth);
      const bounds = box(options.x + rank * (nodeWidth + columnGap), y, nodeWidth, height);
      registerBounds(state, node.id, bounds);
      state.nodeIds.add(node.id);
      state.addVisual({ type: "node", id: node.id, source: node.semanticId, node, bounds });
      y += height + rowGap;
      bottom = Math.max(bottom, y);
    }
  }
  const routes = [];
  connections.forEach((connection, connectionIndex) => {
    for (let segmentIndex = 0; segmentIndex < connection.nodes.length - 1; segmentIndex += 1) {
      const from = splitEndpoint(connection.nodes[segmentIndex], state.bounds);
      const to = splitEndpoint(connection.nodes[segmentIndex + 1], state.bounds);
      const fromBounds = state.bounds.get(from.id);
      const toBounds = state.bounds.get(to.id);
      const inferred = inferredSides(fromBounds, toBounds);
      const start = anchor[from.side ?? inferred.startSide](fromBounds);
      const end = anchor[to.side ?? inferred.endSide](toBounds);
      const middleX = start[0] + (end[0] - start[0]) / 2;
      routes.push({
        connectionIndex,
        segmentIndex,
        points: [start, [middleX, start[1]], [middleX, end[1]], end],
      });
    }
  });
  return { bottom, routes };
}

export const LAYERED_LAYOUT = createLayoutAdapter({
  name: "layered",
  capabilities: LAYERED_LAYOUT_CAPABILITIES,
  layoutDocument: layoutLayered,
});
