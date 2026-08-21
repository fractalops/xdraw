import { ROUTING_CLEARANCE } from "./clearances.ts";
import {
  DEFAULT_CONNECTOR_LABEL_SIZE,
  measureConnectorLabelWidth,
  measureTextWidth,
  wrapTextToWidth,
} from "../text/metrics.ts";
import type { Bounds, Point } from "../contracts/foundation.ts";
import type {
  DrawingElement,
  LinearElement,
  TextElement,
} from "../contracts/render.ts";
import type { FontFamily } from "../text/metrics.ts";

export interface EndpointLabelSynchronization {
  elements: DrawingElement[];
  changed: boolean;
}

function isLinearElement(element: DrawingElement): element is LinearElement {
  return element.type === "arrow" || element.type === "line";
}

function isTextElement(element: DrawingElement | undefined): element is TextElement {
  return element?.type === "text";
}

export function endpointLabelBounds(
  value: string,
  point: Point,
  nextPoint: Point,
  fontSize = 15,
  fontFamily: FontFamily = 3,
): Bounds {
  const measuredWidth = measureTextWidth(value, fontSize, fontFamily) + 14;
  const width = Math.min(160, Math.max(60, measuredWidth));
  const height = fontSize * 1.25;
  const horizontal = point[1] === nextPoint[1];
  if (horizontal) {
    const direction = Math.sign(nextPoint[0] - point[0]) || 1;
    return {
      x: direction > 0 ? point[0] + 8 : point[0] - width - 8,
      y: point[1] - height - 32,
      width,
      height,
    };
  }
  const direction = Math.sign(nextPoint[1] - point[1]) || 1;
  return {
    x: point[0] + 20,
    y: direction > 0 ? point[1] + 8 : point[1] - height - 8,
    width,
    height,
  };
}

export function synchronizeEndpointLabels(elements: DrawingElement[]): EndpointLabelSynchronization {
  const byId = new Map<string, DrawingElement>(elements.map((element) => [element.id, element]));
  const replacements = new Map<string, TextElement>();
  for (const element of elements) {
    if (!isLinearElement(element)) continue;
    const labels = element.customData?.xdrawEndpointLabels;
    if (!labels || element.points.length < 2) continue;
    const path: Point[] = element.points.map(([x, y]) => [x + element.x, y + element.y]);
    for (const [position, labelId] of Object.entries(labels)) {
      if ((position !== "start" && position !== "end") || typeof labelId !== "string") continue;
      const label = byId.get(labelId);
      if (!isTextElement(label)) continue;
      const atStart = position === "start";
      const bounds = endpointLabelBounds(
        label.text,
        atStart ? path[0] : path[path.length - 1],
        atStart ? path[1] : path[path.length - 2],
        label.fontSize,
        label.fontFamily,
      );
      if (label.x === bounds.x && label.y === bounds.y
          && label.width === bounds.width && label.height === bounds.height) continue;
      replacements.set(label.id, {
        ...label,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        version: (label.version ?? 1) + 1,
        updated: Date.now(),
      });
    }
  }
  return {
    elements: replacements.size ? elements.map((element) => replacements.get(element.id) ?? element) : elements,
    changed: replacements.size > 0,
  };
}

// ---------------------------------------------------------------------------
// The label on the path itself. Endpoint labels above sit at the two ends; this
// one names the connector as a whole and goes alongside its longest leg.
// ---------------------------------------------------------------------------

export interface ConnectorLabelRequest {
  label: string;
  /** The drawn path. Two points for a straight run, more for a routed one. */
  path: readonly Point[];
  fromBounds: Bounds;
  toBounds: Bounds;
  /** Shapes and already-placed labels the text should not land on. */
  obstacles?: readonly Bounds[];
  /** Other connector paths whose strokes must remain visually distinct. */
  routes?: readonly (readonly Point[])[];
  fontSize?: number;
  fontFamily?: FontFamily;
  /** Cap on the text width, before wrapping. */
  maxWidth?: number;
}

export interface ConnectorLabelPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The label wrapped to `width`, which is what should be drawn. */
  text: string;
}

export class ConnectorLabelFitError extends Error {
  readonly code = "XD2002";
  readonly requiredClearance: number;

  constructor(requiredClearance: number, label?: string) {
    super(`connector label${label ? ` '${label}'` : ""} cannot fit beside its route; reserve at least ${Math.ceil(requiredClearance)}px of clearance`);
    this.name = "ConnectorLabelFitError";
    this.requiredClearance = requiredClearance;
  }
}

const LABEL_OFFSET = 8;

function segmentIntersectsBounds(start: Point, end: Point, bounds: Bounds): boolean {
  const delta: Point = [end[0] - start[0], end[1] - start[1]];
  let entry = 0;
  let exit = 1;
  const edges = [
    [-delta[0], start[0] - bounds.x],
    [delta[0], bounds.x + bounds.width - start[0]],
    [-delta[1], start[1] - bounds.y],
    [delta[1], bounds.y + bounds.height - start[1]],
  ];
  for (const [direction, distance] of edges) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const time = distance / direction;
    if (direction < 0) entry = Math.max(entry, time);
    else exit = Math.min(exit, time);
    if (entry > exit) return false;
  }
  return true;
}

function routeIntersectsBounds(route: readonly Point[], bounds: Bounds): boolean {
  return route.slice(0, -1).some((start, index) => (
    segmentIntersectsBounds(start, route[index + 1], bounds)
  ));
}

/** Drop the interior points of a straight run, so a dogleg yields one segment per leg. */
function compactPath(path: readonly Point[]): readonly Point[] {
  return path.filter((point, index) => {
    if (!index || index === path.length - 1) return true;
    const previous = path[index - 1];
    const next = path[index + 1];
    return !((previous[0] === point[0] && point[0] === next[0])
      || (previous[1] === point[1] && point[1] === next[1]));
  });
}

/** Route legs ordered by the amount of room they offer. */
function segmentsByLength(path: readonly Point[]): { start: Point; end: Point; length: number }[] {
  const compacted = compactPath(path);
  const segments = compacted.slice(0, -1).map((point, index) => ({
    start: point,
    end: compacted[index + 1],
    length: Math.abs(compacted[index + 1][0] - point[0]) + Math.abs(compacted[index + 1][1] - point[1]),
  }));
  return segments.sort((left, right) => right.length - left.length);
}

/**
 * Where a connector's label goes.
 *
 * Two positions are tried alongside the longest leg. If neither fits, placement
 * fails with the clearance the layout must reserve. A label is never detached
 * from its connector to make an impossible arrangement appear successful.
 */
export function placeConnectorLabel(request: ConnectorLabelRequest): ConnectorLabelPlacement {
  const { label, fromBounds, toBounds } = request;
  const fontSize = request.fontSize ?? DEFAULT_CONNECTOR_LABEL_SIZE;
  const fontFamily = request.fontFamily ?? 3;
  const desiredWidth = request.maxWidth ?? measureConnectorLabelWidth(label, fontSize, fontFamily);
  let requiredClearance = 0;
  for (const segment of segmentsByLength(request.path)) {
    // A label along a horizontal leg may wrap to fit it; alongside a vertical leg
    // the leg's length is no constraint on how wide the text may be.
    const horizontal = segment.start[1] === segment.end[1];
    const available = horizontal ? Math.max(1, segment.length - 12) : desiredWidth;
    const width = Math.min(desiredWidth, available);
    const text = wrapTextToWidth(label, width, fontSize, fontFamily);
    const height = text.split("\n").length * fontSize * 1.25;
    const midpoint: Point = [
      (segment.start[0] + segment.end[0]) / 2,
      (segment.start[1] + segment.end[1]) / 2,
    ];
    requiredClearance = Math.max(requiredClearance, horizontal
      ? height + 2 * LABEL_OFFSET
      : width + 2 * LABEL_OFFSET);
    const collides = (candidate: { x: number; y: number }): boolean => {
      const overlapsBounds = [fromBounds, toBounds, ...(request.obstacles ?? [])].some((bounds) => (
        candidate.x < bounds.x + bounds.width
        && candidate.x + width + ROUTING_CLEARANCE.label > bounds.x
        && candidate.y < bounds.y + bounds.height
        && candidate.y + height + ROUTING_CLEARANCE.label > bounds.y
      ));
      const padded = {
        x: candidate.x - ROUTING_CLEARANCE.label,
        y: candidate.y - ROUTING_CLEARANCE.label,
        width: width + 2 * ROUTING_CLEARANCE.label,
        height: height + 2 * ROUTING_CLEARANCE.label,
      };
      return overlapsBounds || (request.routes ?? []).some((route) => routeIntersectsBounds(route, padded));
    };
    const candidates = horizontal
      ? [
        { x: midpoint[0] - width / 2, y: midpoint[1] - height - LABEL_OFFSET },
        { x: midpoint[0] - width / 2, y: midpoint[1] + LABEL_OFFSET },
      ]
      : [
        { x: midpoint[0] - width - LABEL_OFFSET, y: midpoint[1] - height / 2 },
        { x: midpoint[0] + LABEL_OFFSET, y: midpoint[1] - height / 2 },
      ];
    const position = candidates.find((candidate) => !collides(candidate));
    if (position) return { x: position.x, y: position.y, width, height, text };
  }
  throw new ConnectorLabelFitError(requiredClearance, label);
}
