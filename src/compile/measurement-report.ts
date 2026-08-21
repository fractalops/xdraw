import { isSemanticGeometryStatement } from "../language/geometry-statements.ts";
import { splitEndpoint } from "../routing/endpoints.ts";
import { measureRouteQuality } from "../routing/quality.ts";
import type { Drawing } from "../excalidraw/document.ts";
import type { Bounds, Point, Route } from "../contracts/foundation.ts";
import type { SceneGraph } from "../contracts/layout.ts";
import type {
  AssetMeasurement,
  CompilationMeasurements,
  ConnectorMeasurement,
  ConstraintMeasurement,
  ContainerMeasurement,
  ElementMeasurement,
  LabelMeasurement,
  StrokeMeasurement,
  TextMeasurement,
} from "../contracts/measurements.ts";
import type { DrawingElement, LinearElement, TextElement } from "../contracts/render.ts";
import type { SemanticStatement } from "../contracts/semantic.ts";

const PRECISION = 3;

function number(value: number): number {
  return Number(value.toFixed(PRECISION));
}

function point(value: Point): Point {
  return [number(value[0]), number(value[1])];
}

function bounds(value: Bounds): Bounds {
  return {
    x: number(value.x),
    y: number(value.y),
    width: number(value.width),
    height: number(value.height),
  };
}

function union(items: readonly Bounds[]): Bounds {
  if (!items.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...items.map((item) => item.x));
  const y = Math.min(...items.map((item) => item.y));
  return bounds({
    x,
    y,
    width: Math.max(...items.map((item) => item.x + item.width)) - x,
    height: Math.max(...items.map((item) => item.y + item.height)) - y,
  });
}

function length(points: readonly Point[]): number {
  return number(points.slice(1).reduce((total, current, index) => (
    total + Math.hypot(current[0] - points[index][0], current[1] - points[index][1])
  ), 0));
}

function semanticKind(value: unknown): string {
  if (!value || typeof value !== "object" || !("type" in value) || typeof value.type !== "string") return "element";
  if (value.type === "node" && "kind" in value && typeof value.kind === "string") return value.kind;
  return value.type;
}

function elementMeasurements(state: SceneGraph): ElementMeasurement[] {
  const visualById = new Map(state.visuals.map((visual) => [visual.id, visual]));
  const result: ElementMeasurement[] = [];
  for (const [id, record] of state.objects) {
    const measured = state.bounds.get(id) ?? record.bounds;
    if (!measured) continue;
    const visual = visualById.get(id);
    result.push({
      id,
      kind: semanticKind(record.semantic),
      bounds: bounds(measured),
      center: point([measured.x + measured.width / 2, measured.y + measured.height / 2]),
      ...(state.containerMembership.get(id) ? { container: state.containerMembership.get(id) } : {}),
      ...(state.frameMembership.get(id) ? { frame: state.frameMembership.get(id) } : {}),
      ...(record.generated ? { generated: true as const } : {}),
      ...(visual?.transform?.angle ? { angle: number(visual.transform.angle) } : {}),
    });
  }
  return result;
}

function strokeMeasurements(state: SceneGraph): StrokeMeasurement[] {
  const result: StrokeMeasurement[] = [];
  for (const [id, values] of state.strokePoints) {
    if (!values.length) continue;
    const measured = state.bounds.get(id) ?? union(values.map(([x, y]) => ({ x, y, width: 0, height: 0 })));
    const start = values[0];
    const end = values.at(-1)!;
    result.push({
      id,
      bounds: bounds(measured),
      start: point(start),
      end: point(end),
      length: length(values),
      points: values.length,
      closed: Math.hypot(start[0] - end[0], start[1] - end[1]) <= 1,
    });
  }
  return result;
}

function isLinear(element: DrawingElement): element is LinearElement {
  return element.type === "arrow" || element.type === "line";
}

function absoluteRoute(element: LinearElement): Route {
  return element.points.map(([x, y]): Point => [x + element.x, y + element.y]) as Route;
}

function connectorMeasurements(state: SceneGraph, drawing: Drawing): ConnectorMeasurement[] {
  const result: ConnectorMeasurement[] = [];
  for (const element of drawing.elements.filter(isLinear)) {
    const match = /^document:connection:(\d+):(\d+)$/u.exec(element.id);
    if (!match) continue;
    const connection = state.connections[Number(match[1])];
    const segment = Number(match[2]);
    if (!connection || segment >= connection.nodes.length - 1) continue;
    const from = splitEndpoint(connection.nodes[segment], state.bounds).id;
    const to = splitEndpoint(connection.nodes[segment + 1], state.bounds).id;
    const route = absoluteRoute(element);
    const obstacles = [...state.nodeIds]
      .filter((id) => id !== from && id !== to)
      .map((id) => state.bounds.get(id))
      .filter((item): item is Bounds => item !== undefined);
    const quality = measureRouteQuality([route], obstacles);
    result.push({
      id: element.id,
      from,
      to,
      route: route.map(point) as Route,
      length: length(route),
      bends: quality.bends,
      obstacleIntersections: quality.obstacleIntersections,
    });
  }
  return result;
}

function isText(element: DrawingElement): element is TextElement {
  return element.type === "text";
}

function projectOntoSegment(value: Point, start: Point, end: Point): { distance: number; point: Point } {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const squared = dx * dx + dy * dy;
  if (squared === 0) return { distance: Math.hypot(value[0] - start[0], value[1] - start[1]), point: start };
  const ratio = Math.max(0, Math.min(1, ((value[0] - start[0]) * dx + (value[1] - start[1]) * dy) / squared));
  const projected: Point = [start[0] + ratio * dx, start[1] + ratio * dy];
  return { distance: Math.hypot(value[0] - projected[0], value[1] - projected[1]), point: projected };
}

function labelSide(value: Point, projected: Point, start: Point, end: Point): LabelMeasurement["side"] {
  return Math.abs(end[0] - start[0]) >= Math.abs(end[1] - start[1])
    ? value[1] < projected[1] ? "above" : "below"
    : value[0] < projected[0] ? "left" : "right";
}

function labelMeasurements(drawing: Drawing, connectors: readonly ConnectorMeasurement[]): LabelMeasurement[] {
  const routes = new Map(connectors.map((connector) => [connector.id, connector.route]));
  const result: LabelMeasurement[] = [];
  for (const element of drawing.elements.filter(isText)) {
    const match = /^(document:connection:\d+:\d+):(label|start-label|end-label)$/u.exec(element.id);
    if (!match) continue;
    const route = routes.get(match[1]);
    if (!route) continue;
    const center: Point = [element.x + element.width / 2, element.y + element.height / 2];
    const projections = route.slice(0, -1).map((start, index) => projectOntoSegment(center, start, route[index + 1]));
    const routeSegment = projections.findIndex(({ distance }) => distance === Math.min(...projections.map((item) => item.distance)));
    const start = route[routeSegment];
    const end = route[routeSegment + 1];
    result.push({
      id: element.id,
      connector: match[1],
      position: match[2] === "start-label" ? "start" : match[2] === "end-label" ? "end" : "middle",
      bounds: bounds(element),
      text: element.text,
      lines: element.text.split("\n").length,
      routeSegment,
      side: labelSide(center, projections[routeSegment].point, start, end),
    });
  }
  return result;
}

function containerMeasurements(state: SceneGraph): ContainerMeasurement[] {
  const children = new Map<string, string[]>();
  for (const [child, parent] of state.containerMembership) {
    const items = children.get(parent) ?? [];
    items.push(child);
    children.set(parent, items);
  }
  return state.containers.flatMap((id): ContainerMeasurement[] => {
    const own = state.bounds.get(id);
    if (!own) return [];
    const childBounds = (children.get(id) ?? [])
      .map((child) => state.bounds.get(child))
      .filter((item): item is Bounds => item !== undefined);
    const content = childBounds.length ? union(childBounds) : undefined;
    const available = number(own.height);
    const required = content ? number(content.y + content.height - own.y) : 0;
    return [{
      id,
      bounds: bounds(own),
      children: childBounds.length,
      ...(content ? { contentBounds: content } : {}),
      available,
      required,
      slack: number(available - required),
    }];
  });
}

function textMeasurements(drawing: Drawing): TextMeasurement[] {
  return drawing.elements.filter(isText).map((element) => ({
    id: element.id,
    bounds: bounds(element),
    text: element.text,
    lines: element.text.split("\n").length,
    fontSize: number(element.fontSize),
  }));
}

function collectConstraints(statements: readonly SemanticStatement[], state: SceneGraph, result: ConstraintMeasurement[]): void {
  for (const statement of statements) {
    if (isSemanticGeometryStatement(statement)) {
      const values: Record<string, string | number | Point> = {};
      if (statement.mode !== undefined) values.mode = statement.mode;
      if (statement.axis !== undefined) values.axis = statement.axis;
      if (statement.by !== undefined) values.by = point(statement.by);
      if (statement.degrees !== undefined) values.degrees = number(statement.degrees);
      if (statement.grid !== undefined) values.grid = number(statement.grid);
      result.push({
        type: statement.type,
        elements: [...statement.ids],
        values,
        resolvedBounds: Object.fromEntries(statement.ids.flatMap((id) => {
          const measured = state.bounds.get(id);
          return measured ? [[id, bounds(measured)]] : [];
        })),
      });
    }
    if (statement.statements) collectConstraints(statement.statements, state, result);
  }
}

function dataUrlBytes(value: string): number {
  const comma = value.indexOf(",");
  if (comma < 0) return 0;
  const payload = value.slice(comma + 1);
  if (!value.slice(0, comma).endsWith(";base64")) return new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(payload.length * 3 / 4) - padding);
}

function assetMeasurements(drawing: Drawing): AssetMeasurement[] {
  return Object.values(drawing.files).map((file) => ({
    id: file.id,
    mimeType: file.mimeType,
    bytes: dataUrlBytes(file.dataURL),
    uses: drawing.elements.filter((element) => element.type === "image" && element.fileId === file.id)
      .map((element) => ({ id: element.id, bounds: bounds(element) })),
  }));
}

export function measureCompilation(state: SceneGraph, drawing: Drawing): CompilationMeasurements {
  const elements = elementMeasurements(state);
  const strokes = strokeMeasurements(state);
  const connectors = connectorMeasurements(state, drawing);
  const labels = labelMeasurements(drawing, connectors);
  const containers = containerMeasurements(state);
  const constraints: ConstraintMeasurement[] = [];
  collectConstraints(state.document.statements, state, constraints);
  const renderedByKind: Record<string, number> = {};
  for (const element of drawing.elements) renderedByKind[element.type] = (renderedByKind[element.type] ?? 0) + 1;
  const diagnostics = { error: 0, warning: 0, remark: 0 };
  for (const item of drawing.diagnostics) diagnostics[item.severity] += 1;
  const routes = connectors.map((connector) => connector.route);
  const routeQuality = measureRouteQuality(routes);
  routeQuality.obstacleIntersections = connectors.reduce(
    (total, connector) => total + connector.obstacleIntersections,
    0,
  );
  return {
    title: state.document.title ?? "",
    canvas: union(drawing.elements.map((element) => bounds(element))),
    counts: {
      semanticElements: elements.length,
      renderedPrimitives: drawing.elements.length,
      renderedByKind,
      diagnostics,
    },
    elements,
    strokes,
    connectors,
    labels,
    containers,
    texts: textMeasurements(drawing),
    constraints,
    assets: assetMeasurements(drawing),
    routeQuality,
  };
}
