import { splitEndpoint } from "./router.js";

export const BUILTIN_LAYOUT_CAPABILITIES = Object.freeze({
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

const CAPABILITY_LABELS = {
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

export function assertLayoutCapabilities(capabilities, required, layoutName) {
  const unsupported = required.filter((capability) => !capabilities[capability]);
  if (unsupported.length) {
    throw new Error(`${layoutName} layout cannot draw ${unsupported.map((item) => CAPABILITY_LABELS[item] ?? item).join(", ")}`);
  }
}

export function collectLayoutRequirements(document) {
  const required = new Set();
  const owners = new Map();
  const nodeIds = new Set();
  const connected = new Set();
  const pairs = new Map();
  const connections = [];
  const visit = (statements, container = "document") => {
    for (const statement of statements) {
      if (["lane", "group", "frame"].includes(statement.type)) required.add("nestedNodes");
      if (statement.id) {
        owners.set(statement.id, container);
        if (["node", "participant", "branch", "leaf"].includes(statement.type)) nodeIds.add(statement.id);
      }
      if (statement.at) required.add("fixedPositions");
      if (statement.size) required.add("fixedDimensions");
      if (statement.type === "connection") {
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

export function createLayoutAdapter(definition) {
  if (!definition?.name || typeof definition.layoutDocument !== "function") {
    throw new TypeError("layout adapter requires a name and layoutDocument function");
  }
  return Object.freeze({
    name: definition.name,
    capabilities: Object.freeze({ ...definition.capabilities }),
    layoutDocument: definition.layoutDocument,
  });
}

export function layoutWithAdapter(adapter, context, sections, options) {
  const required = collectLayoutRequirements(context.state.document);
  assertLayoutCapabilities(adapter.capabilities, required, adapter.name);
  const request = Object.freeze({ context, sections, options: Object.freeze({ ...options }), required });
  const response = adapter.layoutDocument(request);
  const bottom = typeof response === "number" ? response : response?.bottom;
  if (!Number.isFinite(bottom)) throw new Error(`${adapter.name} layout returned an invalid bottom coordinate`);
  if (response?.routes !== undefined) {
    if (!adapter.capabilities.edgeRouting) throw new Error(`${adapter.name} layout returned routes without edgeRouting capability`);
    if (!Array.isArray(response.routes)) throw new Error(`${adapter.name} layout returned invalid routes`);
    for (const route of response.routes) {
      const valid = Number.isInteger(route?.connectionIndex)
        && Number.isInteger(route?.segmentIndex ?? 0)
        && Array.isArray(route?.points)
        && route.points.length >= 2
        && route.points.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite));
      if (!valid) throw new Error(`${adapter.name} layout returned invalid route geometry`);
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

export function createSceneGraph(document, options) {
  const graph = {
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
    sequenceCount: 0,
    frameMembership: new Map(),
    containerMembership: new Map(),
    frameLocks: new Map(),
    canvas: { left: 70, right: 70 + options.diagramWidth, top: 30 },
    annotationGutter: options.annotationGutterWidth
      ? { x: 70 + options.contentWidth + 30, width: options.annotationGutterWidth - 30 }
      : null,
  };
  graph.registerGenerated = (id, semantic, origin = document.origin ?? null) => {
    if (graph.objects.has(id)) return graph.objects.get(id);
    const record = { id, semantic, origin, bounds: null, generated: true };
    graph.objects.set(id, record);
    graph.origins.set(id, origin);
    return record;
  };
  graph.place = (id, bounds, semantic) => {
    const record = graph.objects.get(id) ?? graph.registerGenerated(id, semantic);
    record.bounds = bounds;
    graph.bounds.set(id, bounds);
    return record;
  };
  graph.addVisual = (visual) => {
    const sourceId = visual.source ?? visual.node?.semanticId ?? visual.id;
    const origin = graph.origins.get(sourceId) ?? document.origin ?? null;
    graph.registerGenerated(visual.id ?? visual.node?.id, visual, origin);
    const style = visual.type === "node" && !visual.style
      ? graph.styles?.resolveNode(visual.node)
      : visual.style;
    graph.visuals.push({ ...visual, ...(style ? { style } : {}), origin });
  };
  return graph;
}
