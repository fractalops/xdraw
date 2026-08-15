import { splitEndpoint } from "../routing/endpoints.ts";
import { attachRichNodePlan, planMeasuredRichNode } from "../nodes/rich-nodes.ts";
import type {
  AdapterRoute,
  LayoutAdapter,
  LayoutAdapterDefinition,
  LayoutCapabilities,
  LayoutCapability,
  LayoutContext,
  LayoutOptions,
  LayoutResponse,
  LayoutResult,
  SceneGraph,
  SceneGraphOptions,
} from "../contracts/layout.ts";
import type { ConnectionStatement, SemanticDocument, SemanticStatement } from "../contracts/semantic.ts";
import type { Point } from "../contracts/foundation.ts";

export const BUILTIN_LAYOUT_CAPABILITIES: LayoutCapabilities = Object.freeze({
  nestedNodes: true,
  explicitPorts: true,
  crossContainerEdges: true,
  fixedPositions: true,
  fixedDimensions: true,
  edgeRouting: false,
  selfEdges: false,
  multiEdges: true,
  labels: true,
  disconnectedComponents: true,
});

const CAPABILITY_LABELS: Record<LayoutCapability, string> = {
  crossContainerEdges: "connections across containers",
  disconnectedComponents: "unconnected nodes",
  edgeRouting: "automatic connector routing",
  explicitPorts: "explicit connection ports",
  fixedDimensions: "explicit node sizes",
  fixedPositions: "explicit node placement",
  labels: "connection labels",
  multiEdges: "multiple connections between the same nodes",
  nestedNodes: "nested containers",
  selfEdges: "self-connections",
};

export function assertLayoutCapabilities(
  capabilities: LayoutCapabilities,
  required: readonly LayoutCapability[],
  layoutName: string,
): void {
  const unsupported = required.filter((capability) => !capabilities[capability]);
  if (unsupported.length) {
    throw new Error(`${layoutName} layout cannot draw ${unsupported.map((item) => CAPABILITY_LABELS[item]).join(", ")}`);
  }
}

function isConnection(statement: SemanticStatement): statement is ConnectionStatement {
  return statement.type === "connection" && Array.isArray(statement.nodes);
}

export function collectLayoutRequirements(document: SemanticDocument): LayoutCapability[] {
  const required = new Set<LayoutCapability>();
  const owners = new Map<string, string>();
  const nodeIds = new Set<string>();
  const connected = new Set<string>();
  const pairs = new Map<string, number>();
  const connections: ConnectionStatement[] = [];
  const visit = (statements: SemanticStatement[], container = "document"): void => {
    for (const statement of statements) {
      if (["lane", "group", "frame", "section"].includes(statement.type)) required.add("nestedNodes");
      if (statement.id) {
        owners.set(statement.id, container);
        if (["node", "participant", "branch", "leaf"].includes(statement.type)) nodeIds.add(statement.id);
      }
      if (statement.at) required.add("fixedPositions");
      if (statement.size) required.add("fixedDimensions");
      if (isConnection(statement)) {
        connections.push(statement);
        if (statement.label) required.add("labels");
      }
      if (statement.statements) visit(statement.statements, statement.id ?? container);
    }
  };
  visit(document.statements);
  for (const connection of connections) {
    const endpoints = connection.nodes.map((endpoint) => splitEndpoint(endpoint, nodeIds));
    const ids = endpoints.map((endpoint) => endpoint.id);
    if (endpoints.some((endpoint) => endpoint.side)) required.add("explicitPorts");
    if (ids.some((id, index) => index > 0 && id === ids[index - 1])) required.add("selfEdges");
    ids.forEach((id) => connected.add(id));
    for (let index = 0; index < ids.length - 1; index += 1) {
      if (owners.get(ids[index]) !== owners.get(ids[index + 1])) required.add("crossContainerEdges");
      const pair = `${ids[index]}->${ids[index + 1]}`;
      pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
    }
  }
  if ([...pairs.values()].some((count) => count > 1)) required.add("multiEdges");
  if ([...nodeIds].some((id) => !connected.has(id))) required.add("disconnectedComponents");
  return [...required].sort();
}

export function createLayoutAdapter(definition: LayoutAdapterDefinition): LayoutAdapter {
  if (!definition?.name || typeof definition.layoutDocument !== "function") {
    throw new TypeError("layout adapter requires a name and layoutDocument function");
  }
  return Object.freeze({
    name: definition.name,
    capabilities: Object.freeze({ ...definition.capabilities }),
    layoutDocument: definition.layoutDocument,
  });
}

function isPoint(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function isAdapterRoute(value: unknown): value is AdapterRoute {
  if (!value || typeof value !== "object") return false;
  const route = value as Partial<AdapterRoute>;
  return Number.isInteger(route.connectionIndex)
    && Number.isInteger(route.segmentIndex ?? 0)
    && Array.isArray(route.points)
    && route.points.length >= 2
    && route.points.every(isPoint);
}

function topLevelConnections(document: SemanticDocument): ConnectionStatement[] {
  return document.statements.filter(isConnection);
}

function routeHasOwner(route: AdapterRoute, connections: readonly ConnectionStatement[]): boolean {
  const connection = connections[route.connectionIndex];
  const segmentIndex = route.segmentIndex ?? 0;
  return route.connectionIndex >= 0
    && segmentIndex >= 0
    && Boolean(connection)
    && segmentIndex < (connection?.nodes.length ?? 1) - 1;
}

function validatedResponse(adapter: LayoutAdapter, response: unknown): LayoutResponse {
  if (typeof response === "number") {
    if (!Number.isFinite(response)) throw new Error(`${adapter.name} layout returned an invalid bottom coordinate`);
    return response;
  }
  if (!response || typeof response !== "object") {
    throw new Error(`${adapter.name} layout returned an invalid bottom coordinate`);
  }
  const candidate = response as { bottom?: unknown; routes?: unknown };
  if (typeof candidate.bottom !== "number" || !Number.isFinite(candidate.bottom)) {
    throw new Error(`${adapter.name} layout returned an invalid bottom coordinate`);
  }
  if (candidate.routes !== undefined) {
    if (!adapter.capabilities.edgeRouting) {
      throw new Error(`${adapter.name} layout returned routes without edgeRouting capability`);
    }
    if (!Array.isArray(candidate.routes) || !candidate.routes.every(isAdapterRoute)) {
      throw new Error(`${adapter.name} layout returned invalid route geometry`);
    }
  }
  const routes = candidate.routes;
  return routes ? { bottom: candidate.bottom, routes } : { bottom: candidate.bottom };
}

export function layoutWithAdapter(
  adapter: LayoutAdapter,
  context: LayoutContext,
  sections: readonly SemanticStatement[],
  options: LayoutOptions,
): Readonly<LayoutResult> {
  const required = collectLayoutRequirements(context.state.document);
  assertLayoutCapabilities(adapter.capabilities, required, adapter.name);
  const request = Object.freeze({
    context,
    sections: Object.freeze([...sections]),
    options: Object.freeze({ ...options }),
    required: Object.freeze([...required]),
  });
  const response = validatedResponse(adapter, adapter.layoutDocument(request));
  const bottom = typeof response === "number" ? response : response.bottom;
  if (typeof response !== "number" && response.routes) {
    const connections = topLevelConnections(context.state.document);
    for (const route of response.routes) {
      if (!routeHasOwner(route, connections)) {
        throw new Error(`${adapter.name} layout returned a route without a matching connection segment`);
      }
      const key = `${route.connectionIndex}:${route.segmentIndex ?? 0}`;
      if (context.state.adapterRoutes.has(key)) throw new Error(`${adapter.name} layout returned duplicate route ${key}`);
      context.state.adapterRoutes.set(key, route.points);
    }
  }
  return Object.freeze({
    bottom,
    required,
    placements: context.state.bounds,
    visuals: context.state.visuals,
  });
}

export function createSceneGraph(document: SemanticDocument, options: SceneGraphOptions): SceneGraph {
  const graph: SceneGraph = {
    document,
    measurer: options.measurer,
    styles: options.styles,
    capabilities: BUILTIN_LAYOUT_CAPABILITIES,
    objects: new Map([...document.objects].map(([id, semantic]) => [id, {
      id,
      semantic,
      origin: document.origins.get(id) ?? null,
      bounds: null,
      generated: false,
    }])),
    origins: new Map(document.origins),
    bounds: new Map(),
    nodeIds: new Set(),
    containers: [],
    routes: [],
    adapterRoutes: new Map(),
    connections: [],
    annotations: [],
    diagnostics: options.diagnostics,
    labelBounds: [],
    visuals: [],
    frameMembership: new Map(),
    containerMembership: new Map(),
    frameLocks: new Map(),
    canvas: { left: 70, right: 70 + options.diagramWidth, top: 30 },
    annotationGutter: options.annotationGutterWidth
      ? { x: 70 + options.contentWidth + 30, width: options.annotationGutterWidth - 30 }
      : null,
    registerGenerated(id, semantic, origin = document.origin ?? null) {
      const existing = graph.objects.get(id);
      if (existing) return existing;
      const record = { id, semantic, origin, bounds: null, generated: true };
      graph.objects.set(id, record);
      graph.origins.set(id, origin);
      return record;
    },
    place(id, bounds, semantic) {
      const record = graph.objects.get(id) ?? graph.registerGenerated(id, semantic);
      record.bounds = bounds;
      graph.bounds.set(id, bounds);
      return record;
    },
    addVisual(visual) {
      const sourceId = visual.source ?? (visual.type === "node" ? visual.node.semanticId : undefined) ?? visual.id;
      const origin = graph.origins.get(sourceId) ?? document.origin ?? null;
      graph.registerGenerated(visual.id, visual, origin);
      if (visual.type === "node") {
        const style = visual.style ?? graph.styles?.resolveNode(visual.node);
        if (!style) throw new Error(`node visual '${visual.id}' requires a style resolver`);
        const nodeVisual = { ...visual, style, origin };
        attachRichNodePlan(nodeVisual, planMeasuredRichNode(
          graph.measurer,
          visual.node,
          visual.bounds.width,
          style,
        ));
        graph.visuals.push(nodeVisual);
      } else {
        graph.visuals.push({ ...visual, origin });
      }
    },
  };
  return graph;
}
