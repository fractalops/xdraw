import type {
  AlignmentMode,
  Axis,
  Bounds,
  Point,
} from "./contracts/foundation.ts";

export function box(x: number, y: number, width: number, height: number): Bounds {
  return { x, y, width, height };
}

export function inset(bounds: Bounds, padding: number): Bounds {
  requirePositiveBounds(bounds, "inset");
  requireNonNegative(padding, "inset padding");
  const width = bounds.width - padding * 2;
  const height = bounds.height - padding * 2;
  if (width <= 0 || height <= 0) {
    throw new RangeError("inset must produce positive width and height");
  }
  return box(
    stableCoordinate(bounds.x + padding),
    stableCoordinate(bounds.y + padding),
    stableCoordinate(width),
    stableCoordinate(height),
  );
}

export function row(bounds: Bounds, count: number, gap = 24): Bounds[] {
  requirePositiveBounds(bounds, "row");
  if (!Number.isInteger(count) || count < 1) {
    throw new TypeError("row count must be a positive integer");
  }
  requireNonNegative(gap, "row gap");
  const width = (bounds.width - gap * (count - 1)) / count;
  if (width <= 0) throw new RangeError("row must produce a positive child width");
  return Array.from({ length: count }, (_, index) =>
    box(
      stableCoordinate(bounds.x + index * (width + gap)),
      bounds.y,
      stableCoordinate(width),
      bounds.height,
    ),
  );
}

export function column(bounds: Bounds, count: number, gap = 24): Bounds[] {
  requirePositiveBounds(bounds, "column");
  if (!Number.isInteger(count) || count < 1) {
    throw new TypeError("column count must be a positive integer");
  }
  requireNonNegative(gap, "column gap");
  const height = (bounds.height - gap * (count - 1)) / count;
  if (height <= 0) throw new RangeError("column must produce a positive child height");
  return Array.from({ length: count }, (_, index) =>
    box(
      bounds.x,
      stableCoordinate(bounds.y + index * (height + gap)),
      bounds.width,
      stableCoordinate(height),
    ),
  );
}

export const anchor: Record<"left" | "right" | "top" | "bottom" | "center", (bounds: Bounds) => Point> = {
  left: (bounds) => [bounds.x, bounds.y + bounds.height / 2],
  right: (bounds) => [bounds.x + bounds.width, bounds.y + bounds.height / 2],
  top: (bounds) => [bounds.x + bounds.width / 2, bounds.y],
  bottom: (bounds) => [bounds.x + bounds.width / 2, bounds.y + bounds.height],
  center: (bounds) => [
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  ],
};

/**
 * Which outline a connector should meet.
 *
 * Excalidraw has three native shapes and each has a different border, so a
 * connector aiming at a shape's centre crosses a different curve for each. Using
 * the box for all three put every diagonal connector off by a wide margin on the
 * other two: outside an ellipse, and inside a diamond.
 */
export type BorderShape = "box" | "ellipse" | "diamond";

/**
 * Where a ray from the centre of `bounds` towards `target` leaves the border.
 *
 * The four cardinal anchors answer "which side", not "where on it", so a hub
 * with attachments in six directions gives the same midpoint to every connector
 * that resolves to the same side, and they all appear to start from one point.
 * A straight run between two shapes should meet each border where it genuinely
 * crosses, which is what this returns.
 */
export function borderPoint(bounds: Bounds, target: Point, shape: BorderShape = "box"): Point {
  const centre = anchor.center(bounds);
  const dx = target[0] - centre[0];
  const dy = target[1] - centre[1];
  if (dx === 0 && dy === 0) return centre;
  // All three agree on the cardinal axes and diverge everywhere else, which is
  // why using one for all of them looked correct until a connector ran diagonally.
  const a = bounds.width / 2;
  const b = bounds.height / 2;
  const scale = shape === "ellipse"
    ? 1 / Math.hypot(dx / a, dy / b)
    : shape === "diamond"
      ? 1 / (Math.abs(dx) / a + Math.abs(dy) / b)
      : Math.min(
        dx === 0 ? Number.POSITIVE_INFINITY : a / Math.abs(dx),
        dy === 0 ? Number.POSITIVE_INFINITY : b / Math.abs(dy),
      );
  return [centre[0] + dx * scale, centre[1] + dy * scale];
}

type AxisProperties =
  | { start: "x"; size: "width" }
  | { start: "y"; size: "height" };

const AXIS_PROPERTIES: Record<Axis, AxisProperties> = {
  x: { start: "x", size: "width" },
  y: { start: "y", size: "height" },
};

const COORDINATE_DECIMAL_PLACES = 12;

function stableCoordinate(value: number): number {
  return Number(value.toFixed(COORDINATE_DECIMAL_PLACES));
}

function requirePositiveBounds(bounds: Bounds, operation: string): void {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
    throw new TypeError(`${operation} bounds must contain finite numbers`);
  }
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new RangeError(`${operation} bounds must have positive width and height`);
  }
}

function requireNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

function axisExtent(bounds: Bounds[], axis: Axis): { minimum: number; maximum: number; center: number } {
  const { start, size } = AXIS_PROPERTIES[axis];
  const minimum = Math.min(...bounds.map((item) => item[start]));
  const maximum = Math.max(...bounds.map((item) => item[start] + item[size]));
  return { minimum, maximum, center: (minimum + maximum) / 2 };
}

export function alignBounds(bounds: Bounds[], mode: AlignmentMode): Bounds[] {
  if (bounds.length < 2) throw new Error("alignment requires at least two elements");
  const modes: Record<AlignmentMode, { axis: Axis; position: "start" | "center" | "end" }> = {
    left: { axis: "x", position: "start" },
    "center-x": { axis: "x", position: "center" },
    right: { axis: "x", position: "end" },
    top: { axis: "y", position: "start" },
    "center-y": { axis: "y", position: "center" },
    bottom: { axis: "y", position: "end" },
  };
  const alignment = modes[mode];
  if (!alignment) throw new Error(`unsupported alignment mode: ${mode}`);
  const { axis, position } = alignment;
  const { start, size } = AXIS_PROPERTIES[axis];
  const extent = axisExtent(bounds, axis);
  return bounds.map((item) => {
    const current = position === "start"
      ? item[start]
      : position === "end"
        ? item[start] + item[size]
        : item[start] + item[size] / 2;
    const target = position === "start" ? extent.minimum : position === "end" ? extent.maximum : extent.center;
    return { ...item, [start]: stableCoordinate(item[start] + target - current) };
  });
}

export function distributeBounds(bounds: Bounds[], axis: Axis): Bounds[] {
  if (!(axis in AXIS_PROPERTIES)) throw new Error(`unsupported distribution axis: ${axis}`);
  if (bounds.length < 3) throw new Error("distribution requires at least three elements");
  const { start, size } = AXIS_PROPERTIES[axis];
  const ordered = bounds.map((item, index) => ({ item, index }))
    .sort((left, right) => left.item[start] + left.item[size] / 2 - (right.item[start] + right.item[size] / 2));
  const first = ordered[0].item;
  const last = ordered[ordered.length - 1].item;
  const minimum = first[start];
  const maximum = last[start] + last[size];
  const totalSize = bounds.reduce((sum, item) => sum + item[size], 0);
  const gap = (maximum - minimum - totalSize) / (bounds.length - 1);
  const result = [...bounds];
  if (gap >= 0) {
    // Derive each position from the running size total and the gap multiple
    // rather than accumulating. Repeatedly adding a non-terminating gap drifts
    // the final edge off `maximum`, which changes the gap on a second pass and
    // makes distribution non-idempotent.
    let consumed = 0;
    ordered.forEach(({ item, index }, position) => {
      result[index] = { ...item, [start]: stableCoordinate(minimum + consumed + position * gap) };
      consumed += item[size];
    });
    return result;
  }
  const firstCenter = first[start] + first[size] / 2;
  const lastCenter = last[start] + last[size] / 2;
  const centerStep = (lastCenter - firstCenter) / (ordered.length - 1);
  ordered.forEach(({ item, index }, position) => {
    result[index] = {
      ...item,
      [start]: stableCoordinate(firstCenter + centerStep * position - item[size] / 2),
    };
  });
  return result;
}
