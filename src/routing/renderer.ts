import { card, connect } from "../excalidraw/components.ts";
import { anchor, box } from "../geometry.ts";
import { inferredSides, routeConnection, splitEndpoint } from "./router.ts";
import type {
  Bounds,
  EndpointSide,
  Point,
  Route,
} from "../contracts/foundation.ts";
import type { ConnectionStatement, NoteStatement } from "../contracts/semantic.ts";
import type { SceneGraph } from "../contracts/layout.ts";
import type { Drawing } from "../excalidraw/document.ts";
import type { Arrowhead, DrawingElement, ElementBinding } from "../contracts/render.ts";
import type { CardinalSide } from "./router.ts";

type ConnectionTone = keyof typeof COLORS;
type ConnectionStyle = "auto" | "straight" | "elbow" | "curved" | "line";

const COLORS = {
  neutral: "#475569",
  success: "#16a34a",
  danger: "#dc2626",
  warning: "#d97706",
  info: "#2563eb",
  accent: "#7c3aed",
} as const;
const ARROWHEADS = new Set<string>([
  "arrow", "bar", "dot", "circle", "circle_outline", "triangle", "triangle_outline",
  "diamond", "diamond_outline", "crowfoot_one", "crowfoot_many", "crowfoot_one_or_many",
]);
function addWithFrame(
  drawing: Drawing,
  elements: readonly DrawingElement[],
  frameId: string | null,
  locked = false,
): void {
  for (const element of elements) {
    element.frameId = frameId ?? null;
    if (locked) element.locked = true;
  }
  drawing.add(elements);
}

function parseWaypoints(value: unknown): Point[] | null {
  if (value === undefined) return null;
  const points = String(value).split(";").map((item): Point => {
    const values = item.split(",").map((part) => Number(part.trim()));
    if (values.length !== 2 || !values.every(Number.isFinite)) {
      throw new Error(`invalid connection waypoint '${item}'`);
    }
    return [values[0], values[1]];
  });
  if (!points.length) throw new Error("connection via requires at least one waypoint");
  return points;
}

function isOrthogonal(points: readonly Point[]): boolean {
  return points.slice(0, -1).every((point, index) => (
    point[0] === points[index + 1][0] || point[1] === points[index + 1][1]
  ));
}

function routeAround(value: unknown): string | undefined {
  const match = /^around\s+(.+)$/u.exec(String(value ?? ""));
  return match?.[1];
}

function isCollinear(points: readonly Point[]): boolean {
  return points.every((point) => point[0] === points[0][0])
    || points.every((point) => point[1] === points[0][1]);
}

function isConnectionTone(value: string): value is ConnectionTone {
  return Object.hasOwn(COLORS, value);
}

function isArrowhead(value: string): value is Arrowhead {
  return ARROWHEADS.has(value);
}

function connectionStyle(value: unknown): ConnectionStyle {
  const style = String(value ?? "auto");
  if (style === "auto" || style === "straight" || style === "elbow" || style === "curved" || style === "line") {
    return style;
  }
  throw new Error(`unsupported connection style: ${style}`);
}

function arrowhead(value: unknown): Arrowhead | null {
  if (value === "none") return null;
  const head = String(value ?? "triangle");
  if (!isArrowhead(head)) throw new Error(`unsupported arrowhead: ${head}`);
  return head;
}

function routeWithWaypoints(start: Point, waypoints: readonly Point[], end: Point): Route {
  const first = waypoints[0];
  return first ? [start, first, ...waypoints.slice(1), end] : [start, end];
}

function bindingElementId(state: SceneGraph, id: string): string {
  if (state.visuals?.find((visual) => visual.id === id)?.type === "frame") return id;
  const semantic = state.objects?.get(id)?.semantic;
  if (semantic && typeof semantic === "object" && "type" in semantic) {
    if (semantic.type === "freedraw") return `${id}:stroke`;
    if (semantic.type === "image" || semantic.type === "icon" || semantic.type === "text") return id;
  }
  return `${id}:frame`;
}

function positiveStrokeWidth(value: unknown): number {
  const width = Number(value ?? 2);
  if (!Number.isFinite(width) || width <= 0) throw new Error("connection width must be a positive finite number");
  return width;
}

function clampInside(bounds: Bounds, container: Bounds): Bounds {
  return {
    ...bounds,
    x: Math.min(Math.max(bounds.x, container.x), container.x + container.width - bounds.width),
    y: Math.min(Math.max(bounds.y, container.y), container.y + container.height - bounds.height),
  };
}



interface ResolvedSides {
  from: ReturnType<typeof splitEndpoint>;
  to: ReturnType<typeof splitEndpoint>;
  fromBounds: Bounds;
  toBounds: Bounds;
  startSide: EndpointSide;
  endSide: EndpointSide;
}

/** Shared by the slot planner and the renderer so both agree on the edges used. */
function resolveSides(
  state: SceneGraph,
  connection: ConnectionStatement,
  nodeIndex: number,
): ResolvedSides | null {
  const from = splitEndpoint(connection.nodes[nodeIndex], state.bounds);
  const to = splitEndpoint(connection.nodes[nodeIndex + 1], state.bounds);
  const fromBounds = state.bounds.get(from.id);
  const toBounds = state.bounds.get(to.id);
  if (!fromBounds || !toBounds) return null;
  const fromContainer = state.containerMembership?.get(from.id);
  const toContainer = state.containerMembership?.get(to.id);
  const sides = inferredSides(fromBounds, toBounds, fromContainer && toContainer && fromContainer !== toContainer ? {
    fromContainerBounds: state.bounds.get(fromContainer),
    toContainerBounds: state.bounds.get(toContainer),
  } : {});
  return {
    from, to, fromBounds, toBounds,
    startSide: from.side ?? sides.startSide,
    endSide: to.side ?? sides.endSide,
  };
}

/** Fraction along an edge for connector `slot` of `total` sharing it. */
function slotFraction(slot: number, total: number): number {
  return total <= 1 ? 0.5 : (slot + 1) / (total + 1);
}

function pointOnEdge(bounds: Bounds, side: EndpointSide, fraction: number): Point {
  if (side === "center") return anchor.center(bounds);
  if (side === "top") return [bounds.x + bounds.width * fraction, bounds.y];
  if (side === "bottom") return [bounds.x + bounds.width * fraction, bounds.y + bounds.height];
  if (side === "left") return [bounds.x, bounds.y + bounds.height * fraction];
  return [bounds.x + bounds.width, bounds.y + bounds.height * fraction];
}

function fixedPointOnEdge(side: EndpointSide, fraction: number): Point {
  if (side === "center") return [0.5, 0.5];
  if (side === "top") return [fraction, 0];
  if (side === "bottom") return [fraction, 1];
  if (side === "left") return [0, fraction];
  return [1, fraction];
}

/**
 * Several connections leaving one anchor would all bind to the middle of that
 * edge and overlap. Spread them evenly instead, so a fan reads as a fan.
 * Excalidraw binds by fraction, so this costs nothing in the output format.
 */
export function planConnectorSlots(
  state: SceneGraph,
  connections: readonly ConnectionStatement[],
): void {
  const sharing = new Map<string, string[]>();
  const record = (elementId: string, side: EndpointSide, key: string): void => {
    const anchorKey = `${elementId}@${side}`;
    const existing = sharing.get(anchorKey);
    if (existing) existing.push(key);
    else sharing.set(anchorKey, [key]);
  };

  connections.forEach((connection, index) => {
    for (let nodeIndex = 0; nodeIndex < connection.nodes.length - 1; nodeIndex += 1) {
      const resolved = resolveSides(state, connection, nodeIndex);
      if (!resolved) continue;
      record(resolved.from.id, resolved.startSide, `${index}:${nodeIndex}:start`);
      record(resolved.to.id, resolved.endSide, `${index}:${nodeIndex}:end`);
    }
  });

  for (const keys of sharing.values()) {
    keys.forEach((key, slot) => state.connectorSlots?.set(key, slotFraction(slot, keys.length)));
  }
}

function binding(id: string, side: EndpointSide, fraction = 0.5): ElementBinding {
  return { elementId: id, focus: 0, gap: 8, fixedPoint: fixedPointOnEdge(side, fraction) };
}

export function renderConnection(
  drawing: Drawing,
  state: SceneGraph,
  connection: ConnectionStatement,
  index: number,
): void {
  if (connection.nodes.length < 2) throw new Error("connection requires at least two endpoints");
  if (connection.attributes.via !== undefined && connection.nodes.length !== 2) {
    throw new Error("connection via is only valid for a single connector segment");
  }
  for (let nodeIndex = 0; nodeIndex < connection.nodes.length - 1; nodeIndex += 1) {
    const resolved = resolveSides(state, connection, nodeIndex);
    if (!resolved) {
      const missing = splitEndpoint(connection.nodes[nodeIndex], state.bounds);
      const other = splitEndpoint(connection.nodes[nodeIndex + 1], state.bounds);
      throw new Error(`connection references unknown node: ${missing.id} -> ${other.id}`);
    }
    const { from, to, fromBounds, toBounds, startSide, endSide } = resolved;
    const semanticTone = Object.keys(connection.attributes).find(isConnectionTone);
    const startFraction = state.connectorSlots?.get(`${index}:${nodeIndex}:start`) ?? 0.5;
    const endFraction = state.connectorSlots?.get(`${index}:${nodeIndex}:end`) ?? 0.5;
    const waypoints = parseWaypoints(connection.attributes.via);
    const adapterRoute = state.adapterRoutes.get(`${index}:${nodeIndex}`);
    const style = connectionStyle(connection.attributes.style);
    const start = pointOnEdge(fromBounds, startSide, startFraction);
    const end = pointOnEdge(toBounds, endSide, endFraction);
    if (waypoints) {
      if (!connection.generatedRoute) {
        state.diagnostics?.warn("XD2003", "connection via disables automatic obstacle routing", connection);
      }
      if (isCollinear([start, ...waypoints, end])) {
        state.diagnostics?.warn("XD2002", "connection waypoints are collinear and do not change the route", connection);
      }
    }
    const needsRoutedPath = !waypoints && ["auto", "elbow"].includes(style);
    const resolvedAdapterRoute = adapterRoute ? routeWithWaypoints(start, adapterRoute.slice(1, -1), end) : null;
    const routed = needsRoutedPath
      ? resolvedAdapterRoute ?? routeConnection(state, from.id, to.id, fromBounds, toBounds, startSide, endSide, {
        startFraction,
        endFraction,
        around: routeAround(connection.attributes.route),
      })
      : null;
    if (resolvedAdapterRoute && needsRoutedPath) state.routes.push(resolvedAdapterRoute);
    let points: Route;
    if (waypoints) points = routeWithWaypoints(start, waypoints, end);
    else if (style === "straight" || style === "line") points = [start, end];
    else if (style === "curved") {
      points = [
        start,
        [start[0] + (end[0] - start[0]) / 3, Math.min(start[1], end[1]) - 56],
        [start[0] + ((end[0] - start[0]) * 2) / 3, Math.min(start[1], end[1]) - 56],
        end,
      ];
    } else if (routed) points = routed;
    else throw new Error("automatic connection routing produced no path");
    if (waypoints || !needsRoutedPath) state.routes.push(points);
    if (style === "elbow" && !isOrthogonal(points)) {
      throw new Error("elbow connections require orthogonal waypoints");
    }
    const elbowed = (style === "elbow" || (style === "auto" && points.length > 2)) && isOrthogonal(points);
    const headValue = arrowhead(connection.attributes.head);
    const fromFrame = state.frameMembership.get(from.id) ?? null;
    const toFrame = state.frameMembership.get(to.id) ?? null;
    const frameId = fromFrame && fromFrame === toFrame ? fromFrame : null;
    const relationshipLabel = nodeIndex === 0
      ? [connection.label, typeof connection.attributes.technology === "string"
        ? `[${connection.attributes.technology}]`
        : null].filter(Boolean).join("\n") || undefined
      : undefined;
    const rendered = connect(`document:connection:${index}:${nodeIndex}`, fromBounds, toBounds, {
      startSide,
      endSide,
      points,
      type: style === "line" ? "line" : "arrow",
      elbowed,
      roundness: style === "curved" ? { type: 2 } : false,
      endArrowhead: style === "line" ? null : headValue,
      startBinding: style === "line" ? null : binding(bindingElementId(state, from.id), startSide, startFraction),
      endBinding: style === "line" ? null : binding(bindingElementId(state, to.id), endSide, endFraction),
      label: relationshipLabel,
      startLabel: nodeIndex === 0 && typeof connection.attributes["start-label"] === "string"
        ? connection.attributes["start-label"] : undefined,
      endLabel: nodeIndex === connection.nodes.length - 2 && typeof connection.attributes["end-label"] === "string"
        ? connection.attributes["end-label"] : undefined,
      color: semanticTone ? COLORS[semanticTone] : COLORS.neutral,
      strokeStyle: connection.attributes.dashed ? "dashed" : "solid",
      strokeWidth: positiveStrokeWidth(connection.attributes.width),
      labelObstacles: [
        ...[...state.nodeIds]
          .filter((id) => id !== from.id && id !== to.id)
          .map((id) => state.bounds.get(id))
          .filter((bounds): bounds is Bounds => Boolean(bounds)),
        ...(state.labelBounds ?? []),
      ],
    });
    addWithFrame(drawing, rendered, frameId, connection.locked || (frameId ? state.frameLocks.get(frameId) : false));
    state.labelBounds ??= [];
    state.labelBounds.push(...rendered.filter((item) => item.type === "text").map((item) => ({
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    })));
  }
}

export function renderAnnotation(
  drawing: Drawing,
  state: SceneGraph,
  annotation: NoteStatement,
  index: number,
  registerBounds: (state: SceneGraph, id: string, bounds: Bounds) => void,
): void {
  const target = annotation.target ? splitEndpoint(annotation.target, state.bounds) : null;
  const targetBounds = target ? state.bounds.get(target.id) : null;
  if (target && !targetBounds) throw new Error(`${annotation.type} references unknown node: ${target.id}`);
  const side = target?.side ?? "right";
  const placementSide: CardinalSide = side === "center" ? "right" : side;
  const frameId = target ? state.frameMembership.get(target.id) ?? null : annotation.frameId ?? null;
  const frameBounds = frameId ? state.bounds.get(frameId) : undefined;
  const noteWidth = Math.min(annotation.width ?? 220, frameBounds?.width ?? Number.POSITIVE_INFINITY);
  const noteHeight = Math.min(
    state.measurer.measureAnnotation(annotation, noteWidth),
    frameBounds?.height ?? Number.POSITIVE_INFINITY,
  );
  const preferred: Readonly<Record<CardinalSide, Bounds>> | null = targetBounds ? {
    right: box(targetBounds.x + targetBounds.width + 28, targetBounds.y + targetBounds.height / 2 - noteHeight / 2, noteWidth, noteHeight),
    left: box(targetBounds.x - noteWidth - 28, targetBounds.y + targetBounds.height / 2 - noteHeight / 2, noteWidth, noteHeight),
    bottom: box(targetBounds.x + targetBounds.width / 2 - noteWidth / 2, targetBounds.y + targetBounds.height + 28, noteWidth, noteHeight),
    top: box(targetBounds.x + targetBounds.width / 2 - noteWidth / 2, targetBounds.y - noteHeight - 28, noteWidth, noteHeight),
  } : null;
  const candidates: Bounds[] = preferred && targetBounds
    ? [
      ...(!frameBounds && state.annotationGutter
        ? [box(state.annotationGutter.x, Math.max(state.canvas.top, targetBounds.y), noteWidth, noteHeight)]
        : []),
      preferred[placementSide], preferred.right, preferred.left, preferred.bottom, preferred.top,
    ].map((bounds) => frameBounds ? clampInside(bounds, frameBounds) : bounds)
    : [];
  const placementScore = (bounds: Bounds): number => {
    const outside = Math.max(0, state.canvas.left - bounds.x)
      + Math.max(0, bounds.x + bounds.width - state.canvas.right)
      + Math.max(0, state.canvas.top - bounds.y);
    const overlaps = [...state.nodeIds]
      .map((id) => state.bounds.get(id))
      .filter((other): other is Bounds => Boolean(other))
      .filter((other) => bounds.x < other.x + other.width + 12 && bounds.x + bounds.width + 12 > other.x
        && bounds.y < other.y + other.height + 12 && bounds.y + bounds.height + 12 > other.y).length;
    return outside * 10_000 + overlaps * 1_000;
  };
  const noteBounds = annotation.at
    ? box(annotation.at[0], annotation.at[1], noteWidth, noteHeight)
    : candidates.sort((left, right) => placementScore(left) - placementScore(right))[0];
  if (!noteBounds) throw new Error(`${annotation.type} requires a target or explicit position`);
  addWithFrame(
    drawing,
    card(annotation.id, noteBounds, { title: annotation.title, tone: "warning", bodySize: 15 }),
    frameId,
    annotation.locked || (frameId ? state.frameLocks.get(frameId) : false),
  );
  registerBounds(state, annotation.id, noteBounds);
  state.nodeIds.add(annotation.id);
  if (frameId) state.frameMembership.set(annotation.id, frameId);
  if (annotation.type === "callout" && target && targetBounds) {
    const calloutSides = inferredSides(noteBounds, targetBounds);
    addWithFrame(drawing, connect(`document:callout:${index}`, noteBounds, targetBounds, {
      ...calloutSides,
      points: routeConnection(state, annotation.id, target.id, noteBounds, targetBounds, calloutSides.startSide, target.side ?? calloutSides.endSide),
      roundness: { type: 2 },
      startBinding: binding(`${annotation.id}:frame`, calloutSides.startSide),
      endBinding: binding(bindingElementId(state, target.id), target.side ?? calloutSides.endSide),
      endSide: target.side ?? calloutSides.endSide,
      strokeStyle: "dashed",
      color: COLORS.warning,
    }), frameId, annotation.locked || (frameId ? state.frameLocks.get(frameId) : false));
  }
}
