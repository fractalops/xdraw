import { card, connect, measureCard } from "./components.js";
import { anchor, box } from "./layout.js";
import { inferredSides, routeConnection, splitEndpoint } from "./router.js";

const COLORS = {
  neutral: "#475569",
  success: "#16a34a",
  danger: "#dc2626",
  warning: "#d97706",
  info: "#2563eb",
  accent: "#7c3aed",
};
const ARROWHEADS = new Set([
  "arrow", "bar", "dot", "circle", "circle_outline", "triangle", "triangle_outline",
  "diamond", "diamond_outline", "crowfoot_one", "crowfoot_many", "crowfoot_one_or_many",
]);
const FIXED_POINTS = {
  left: [0, 0.5], right: [1, 0.5], top: [0.5, 0], bottom: [0.5, 1], center: [0.5, 0.5],
};

function addWithFrame(drawing, elements, frameId, locked = false) {
  const items = elements.flat(Infinity).filter(Boolean);
  for (const element of items) {
    element.frameId = frameId ?? null;
    if (locked) element.locked = true;
  }
  drawing.add(items);
}

function parseWaypoints(value) {
  if (value === undefined) return null;
  const points = String(value).split(";").map((item) => {
    const values = item.split(",").map((part) => Number(part.trim()));
    if (values.length !== 2 || !values.every(Number.isFinite)) {
      throw new Error(`invalid connection waypoint '${item}'`);
    }
    return values;
  });
  if (!points.length) throw new Error("connection via requires at least one waypoint");
  return points;
}

function isOrthogonal(points) {
  return points.slice(0, -1).every((point, index) => (
    point[0] === points[index + 1][0] || point[1] === points[index + 1][1]
  ));
}

function routeAround(value) {
  const match = /^around\s+(.+)$/u.exec(String(value ?? ""));
  return match?.[1];
}

function isCollinear(points) {
  return points.every((point) => point[0] === points[0][0])
    || points.every((point) => point[1] === points[0][1]);
}

export function renderConnection(drawing, state, connection, index) {
  if (connection.attributes.via !== undefined && connection.nodes.length !== 2) {
    throw new Error("connection via is only valid for a single connector segment");
  }
  for (let nodeIndex = 0; nodeIndex < connection.nodes.length - 1; nodeIndex += 1) {
    const from = splitEndpoint(connection.nodes[nodeIndex], state.bounds);
    const to = splitEndpoint(connection.nodes[nodeIndex + 1], state.bounds);
    const fromBounds = state.bounds.get(from.id);
    const toBounds = state.bounds.get(to.id);
    if (!fromBounds || !toBounds) throw new Error(`connection references unknown node: ${from.id} -> ${to.id}`);
    const fromContainer = state.containerMembership?.get(from.id);
    const toContainer = state.containerMembership?.get(to.id);
    const sides = inferredSides(fromBounds, toBounds, fromContainer && toContainer && fromContainer !== toContainer ? {
      fromContainerBounds: state.bounds.get(fromContainer),
      toContainerBounds: state.bounds.get(toContainer),
    } : {});
    const semanticTone = Object.keys(connection.attributes).find((key) => key in COLORS);
    const startSide = from.side ?? sides.startSide;
    const endSide = to.side ?? sides.endSide;
    const waypoints = parseWaypoints(connection.attributes.via);
    const adapterRoute = state.adapterRoutes.get(`${index}:${nodeIndex}`);
    const style = String(connection.attributes.style ?? "auto");
    if (!["auto", "straight", "elbow", "curved", "line"].includes(style)) throw new Error(`unsupported connection style: ${style}`);
    const start = anchor[startSide](fromBounds);
    const end = anchor[endSide](toBounds);
    if (waypoints) {
      if (!connection.generatedRoute) {
        state.diagnostics?.warn("XD2003", "connection via disables automatic obstacle routing", connection);
      }
      if (isCollinear([start, ...waypoints, end])) {
        state.diagnostics?.warn("XD2002", "connection waypoints are collinear and do not change the route", connection);
      }
    }
    const needsRoutedPath = !waypoints && ["auto", "elbow"].includes(style);
    const routed = needsRoutedPath
      ? adapterRoute ?? routeConnection(state, from.id, to.id, fromBounds, toBounds, startSide, endSide, {
        around: routeAround(connection.attributes.route),
      })
      : null;
    if (adapterRoute && needsRoutedPath) state.routes.push(adapterRoute);
    const points = waypoints
      ? [start, ...waypoints, end]
      : style === "straight" || style === "line"
      ? [start, end]
      : style === "curved"
        ? [
          start,
          [start[0] + (end[0] - start[0]) / 3, Math.min(start[1], end[1]) - 56],
          [start[0] + ((end[0] - start[0]) * 2) / 3, Math.min(start[1], end[1]) - 56],
          end,
        ]
        : routed;
    if (waypoints || !needsRoutedPath) state.routes.push(points);
    if (style === "elbow" && !isOrthogonal(points)) {
      throw new Error("elbow connections require orthogonal waypoints");
    }
    const elbowed = (style === "elbow" || (style === "auto" && points.length > 2)) && isOrthogonal(points);
    const headValue = connection.attributes.head === "none" ? null : String(connection.attributes.head ?? "triangle");
    if (headValue && !ARROWHEADS.has(headValue)) throw new Error(`unsupported arrowhead: ${headValue}`);
    const binding = (id, side) => ({ elementId: id, focus: 0, gap: 8, fixedPoint: FIXED_POINTS[side] });
    const fromFrame = state.frameMembership.get(from.id) ?? null;
    const toFrame = state.frameMembership.get(to.id) ?? null;
    const frameId = fromFrame && fromFrame === toFrame ? fromFrame : null;
    const rendered = connect(`document:connection:${index}:${nodeIndex}`, fromBounds, toBounds, {
      ...sides,
      startSide,
      endSide,
      points,
      type: style === "line" ? "line" : "arrow",
      elbowed,
      roundness: style === "curved" ? { type: 2 } : null,
      endArrowhead: style === "line" ? null : headValue,
      startBinding: style === "line" ? null : binding(`${from.id}:frame`, startSide),
      endBinding: style === "line" ? null : binding(`${to.id}:frame`, endSide),
      label: nodeIndex === 0 ? connection.label : undefined,
      startLabel: nodeIndex === 0 ? connection.attributes["start-label"] : undefined,
      endLabel: nodeIndex === connection.nodes.length - 2 ? connection.attributes["end-label"] : undefined,
      color: COLORS[semanticTone] ?? COLORS.neutral,
      strokeStyle: connection.attributes.dashed ? "dashed" : "solid",
      strokeWidth: Number(connection.attributes.width ?? 2),
      labelObstacles: [
        ...[...state.nodeIds]
          .filter((id) => id !== from.id && id !== to.id)
          .map((id) => state.bounds.get(id)),
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

export function renderAnnotation(drawing, state, annotation, index, registerBounds) {
  const target = annotation.target ? splitEndpoint(annotation.target, state.bounds) : null;
  const targetBounds = target ? state.bounds.get(target.id) : null;
  if (target && !targetBounds) throw new Error(`${annotation.type} references unknown node: ${target.id}`);
  const side = target?.side ?? "right";
  const noteWidth = annotation.width ?? 220;
  const noteHeight = measureCard({ title: annotation.title, minimumHeight: 80 }, noteWidth);
  const preferred = targetBounds ? {
    right: box(targetBounds.x + targetBounds.width + 28, targetBounds.y + targetBounds.height / 2 - noteHeight / 2, noteWidth, noteHeight),
    left: box(targetBounds.x - noteWidth - 28, targetBounds.y + targetBounds.height / 2 - noteHeight / 2, noteWidth, noteHeight),
    bottom: box(targetBounds.x + targetBounds.width / 2 - noteWidth / 2, targetBounds.y + targetBounds.height + 28, noteWidth, noteHeight),
    top: box(targetBounds.x + targetBounds.width / 2 - noteWidth / 2, targetBounds.y - noteHeight - 28, noteWidth, noteHeight),
  } : null;
  const candidates = preferred
    ? [
      state.annotationGutter && box(state.annotationGutter.x, Math.max(state.canvas.top, targetBounds.y), noteWidth, noteHeight),
      preferred[side], preferred.right, preferred.left, preferred.bottom, preferred.top,
    ].filter(Boolean)
    : [];
  const placementScore = (bounds) => {
    const outside = Math.max(0, state.canvas.left - bounds.x)
      + Math.max(0, bounds.x + bounds.width - state.canvas.right)
      + Math.max(0, state.canvas.top - bounds.y);
    const overlaps = [...state.nodeIds]
      .map((id) => state.bounds.get(id))
      .filter((other) => bounds.x < other.x + other.width + 12 && bounds.x + bounds.width + 12 > other.x
        && bounds.y < other.y + other.height + 12 && bounds.y + bounds.height + 12 > other.y).length;
    return outside * 10_000 + overlaps * 1_000;
  };
  const noteBounds = annotation.at
    ? box(annotation.at[0], annotation.at[1], noteWidth, noteHeight)
    : candidates.sort((left, right) => placementScore(left) - placementScore(right))[0];
  const frameId = target ? state.frameMembership.get(target.id) ?? null : null;
  addWithFrame(
    drawing,
    card(annotation.id, noteBounds, { title: annotation.title, tone: "warning", bodySize: 15 }),
    frameId,
    annotation.locked || (frameId ? state.frameLocks.get(frameId) : false),
  );
  registerBounds(state, annotation.id, noteBounds);
  state.nodeIds.add(annotation.id);
  if (annotation.type === "callout" && targetBounds) {
    const calloutSides = inferredSides(noteBounds, targetBounds);
    addWithFrame(drawing, connect(`document:callout:${index}`, noteBounds, targetBounds, {
      ...calloutSides,
      points: routeConnection(state, annotation.id, target.id, noteBounds, targetBounds, calloutSides.startSide, target.side ?? calloutSides.endSide),
      roundness: { type: 2 },
      startBinding: { elementId: `${annotation.id}:frame`, focus: 0, gap: 8, fixedPoint: FIXED_POINTS[calloutSides.startSide] },
      endBinding: { elementId: `${target.id}:frame`, focus: 0, gap: 8, fixedPoint: FIXED_POINTS[target.side ?? calloutSides.endSide] },
      endSide: target.side ?? calloutSides.endSide,
      strokeStyle: "dashed",
      color: COLORS.warning,
    }), frameId, annotation.locked || (frameId ? state.frameLocks.get(frameId) : false));
  }
}
