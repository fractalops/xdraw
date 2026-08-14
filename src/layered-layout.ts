import { anchor, box } from "./geometry.ts";
import { ROUTING_CLEARANCE } from "./clearances.ts";
import { inferredSides, routeConnection, splitEndpoint } from "./router.ts";
import { BUILTIN_LAYOUT_CAPABILITIES, createLayoutAdapter } from "./scene.ts";
import type {
  AdapterRoute,
  LayoutCapabilities,
  LayoutRequest,
  LayoutResponse,
} from "./layout-contracts.ts";
import type { Bounds, Route, Point } from "./foundation-contracts.ts";
import type { ConnectionStatement, NodeStatement, SemanticStatement } from "./semantic-contracts.ts";

export const LAYERED_LAYOUT_CAPABILITIES: LayoutCapabilities = Object.freeze({
  ...BUILTIN_LAYOUT_CAPABILITIES,
  nestedNodes: false,
  fixedPositions: false,
  fixedDimensions: false,
  edgeRouting: true,
});

function isNode(statement: SemanticStatement): statement is NodeStatement {
  return statement.type === "node";
}

function isConnection(statement: SemanticStatement): statement is ConnectionStatement {
  return statement.type === "connection";
}

function requiredBounds(boundsById: ReadonlyMap<string, Bounds>, id: string): Bounds {
  const bounds = boundsById.get(id);
  if (!bounds) throw new Error(`layered layout references unplaced node: ${id}`);
  return bounds;
}

function ranksFor(
  nodes: readonly NodeStatement[],
  connections: readonly ConnectionStatement[],
): Map<string, number> {
  const ids = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  const incoming = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  for (const connection of connections) {
    for (let index = 0; index < connection.nodes.length - 1; index += 1) {
      const from = splitEndpoint(connection.nodes[index], ids).id;
      const to = splitEndpoint(connection.nodes[index + 1], ids).id;
      if (!ids.has(from) || !ids.has(to) || from === to) continue;
      outgoing.get(from)?.push(to);
      incoming.set(to, (incoming.get(to) ?? 0) + 1);
    }
  }
  const rank = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (id === undefined) break;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const target of outgoing.get(id) ?? []) {
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(id) ?? 0) + 1));
      incoming.set(target, (incoming.get(target) ?? 0) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  const fallbackRank = Math.max(0, ...rank.values()) + 1;
  for (const node of nodes) if (!seen.has(node.id)) rank.set(node.id, fallbackRank);
  return rank;
}

function layoutLayered({ context, sections, options }: Readonly<LayoutRequest>): LayoutResponse {
  const { state } = context;
  const registerBounds = (id: string, bounds: Bounds): void => {
    if (state.bounds.has(id)) throw new Error(`duplicate semantic id: ${id}`);
    state.place(id, bounds);
  };
  const unsupported = sections.filter((statement) => !isNode(statement));
  if (unsupported.length) {
    throw new Error(`layered layout cannot place top-level ${unsupported[0].type} sections`);
  }
  const nodes = sections.filter(isNode);
  const connections = state.document.statements.filter(isConnection);
  const ranks = ranksFor(nodes, connections);
  const layers = Map.groupBy(nodes, (node) => ranks.get(node.id) ?? 0);
  const nodeWidth = 240;
  const minimumGap = ROUTING_CLEARANCE.endpoint * 2 + ROUTING_CLEARANCE.channel * 2;
  const requestedColumnGap = options.columnGap ?? 100;
  const requestedRowGap = options.gap ?? 36;
  const columnGap = Math.max(minimumGap, requestedColumnGap);
  const rowGap = Math.max(minimumGap, requestedRowGap);
  if (columnGap !== requestedColumnGap || rowGap !== requestedRowGap) {
    state.diagnostics?.warn(
      "XD2001",
      `layout gap ${Math.min(requestedColumnGap, requestedRowGap)} was raised to ${minimumGap} so connectors remain visible`,
    );
  }
  let bottom = options.startY;
  if (context.preparedLayeredBounds) {
    const prepared = context.preparedLayeredBounds;
    for (const node of nodes) {
      const placement = prepared.get(node.id);
      if (!placement) throw new Error(`ELK placement omitted node: ${node.id}`);
      const bounds = box(
        (options.x ?? 0) + placement.x,
        options.startY + placement.y,
        placement.width,
        placement.height,
      );
      registerBounds(node.id, bounds);
      state.nodeIds.add(node.id);
      state.addVisual({ type: "node", id: node.id, source: node.semanticId, node, bounds });
      bottom = Math.max(bottom, bounds.y + bounds.height + rowGap);
    }
  } else {
    for (const [rank, layer] of [...layers].sort(([leftRank], [rightRank]) => leftRank - rightRank)) {
      let y = options.startY;
      for (const node of layer) {
        const height = state.measurer.measureNode(node, nodeWidth);
        const bounds = box((options.x ?? 0) + rank * (nodeWidth + columnGap), y, nodeWidth, height);
        registerBounds(node.id, bounds);
        state.nodeIds.add(node.id);
        state.addVisual({ type: "node", id: node.id, source: node.semanticId, node, bounds });
        y += height + rowGap;
        bottom = Math.max(bottom, y);
      }
    }
  }
  const routes: AdapterRoute[] = [];
  const routedScene = {
    bounds: state.bounds,
    nodeIds: state.nodeIds,
    containers: state.containers,
    routes: [] as Route[],
    labelBounds: state.labelBounds,
  };
  connections.forEach((connection, connectionIndex) => {
    for (let segmentIndex = 0; segmentIndex < connection.nodes.length - 1; segmentIndex += 1) {
      const from = splitEndpoint(connection.nodes[segmentIndex], state.bounds);
      const to = splitEndpoint(connection.nodes[segmentIndex + 1], state.bounds);
      const fromBounds = requiredBounds(state.bounds, from.id);
      const toBounds = requiredBounds(state.bounds, to.id);
      const inferred = inferredSides(fromBounds, toBounds);
      const startSide = from.side ?? inferred.startSide;
      const endSide = to.side ?? inferred.endSide;
      const fromRank = ranks.get(from.id) ?? 0;
      const toRank = ranks.get(to.id) ?? 0;
      let points: Route;
      if (context.preparedLayeredBounds || Math.abs(toRank - fromRank) > 1) {
        points = routeConnection(
          routedScene,
          from.id,
          to.id,
          fromBounds,
          toBounds,
          startSide,
          endSide,
          { avoidEndpointInteriors: true },
        );
      } else {
        const start = anchor[startSide](fromBounds);
        const end = anchor[endSide](toBounds);
        const middleX = start[0] + (end[0] - start[0]) / 2;
        const firstTurn: Point = [middleX, start[1]];
        const secondTurn: Point = [middleX, end[1]];
        points = [start, firstTurn, secondTurn, end];
        routedScene.routes.push(points);
      }
      routes.push({
        connectionIndex,
        segmentIndex,
        points,
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
