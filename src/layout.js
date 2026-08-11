/**
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @returns {import("./contracts.js").Bounds}
 */
export function box(x, y, width, height) {
  return { x, y, width, height };
}

/**
 * @param {import("./contracts.js").Bounds} bounds
 * @param {number} padding
 */
export function inset(bounds, padding) {
  return box(
    bounds.x + padding,
    bounds.y + padding,
    bounds.width - padding * 2,
    bounds.height - padding * 2,
  );
}

/**
 * @param {import("./contracts.js").Bounds} bounds
 * @param {number} count
 * @param {number} [gap]
 */
export function row(bounds, count, gap = 24) {
  if (!Number.isInteger(count) || count < 1) {
    throw new TypeError("row count must be a positive integer");
  }
  const width = (bounds.width - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) =>
    box(bounds.x + index * (width + gap), bounds.y, width, bounds.height),
  );
}

/**
 * @param {import("./contracts.js").Bounds} bounds
 * @param {number} count
 * @param {number} [gap]
 */
export function column(bounds, count, gap = 24) {
  if (!Number.isInteger(count) || count < 1) {
    throw new TypeError("column count must be a positive integer");
  }
  const height = (bounds.height - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) =>
    box(bounds.x, bounds.y + index * (height + gap), bounds.width, height),
  );
}

/** @type {Record<"left" | "right" | "top" | "bottom" | "center", (bounds: import("./contracts.js").Bounds) => import("./contracts.js").Point>} */
export const anchor = {
  left: (bounds) => [bounds.x, bounds.y + bounds.height / 2],
  right: (bounds) => [bounds.x + bounds.width, bounds.y + bounds.height / 2],
  top: (bounds) => [bounds.x + bounds.width / 2, bounds.y],
  bottom: (bounds) => [bounds.x + bounds.width / 2, bounds.y + bounds.height],
  center: (bounds) => [
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  ],
};

/** @type {Record<import("./contracts.js").Axis, { start: "x" | "y", size: "width" | "height" }>} */
const AXIS_PROPERTIES = {
  x: { start: "x", size: "width" },
  y: { start: "y", size: "height" },
};

/**
 * @param {import("./contracts.js").Bounds[]} bounds
 * @param {import("./contracts.js").Axis} axis
 */
function axisExtent(bounds, axis) {
  const { start, size } = AXIS_PROPERTIES[axis];
  const minimum = Math.min(...bounds.map((item) => item[start]));
  const maximum = Math.max(...bounds.map((item) => item[start] + item[size]));
  return { minimum, maximum, center: (minimum + maximum) / 2 };
}

/**
 * @param {import("./contracts.js").Bounds[]} bounds
 * @param {import("./contracts.js").AlignmentMode} mode
 */
export function alignBounds(bounds, mode) {
  if (bounds.length < 2) throw new Error("alignment requires at least two elements");
  /** @type {Record<import("./contracts.js").AlignmentMode, { axis: import("./contracts.js").Axis, position: "start" | "center" | "end" }>} */
  const modes = {
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
    return { ...item, [start]: item[start] + target - current };
  });
}

/**
 * @param {import("./contracts.js").Bounds[]} bounds
 * @param {import("./contracts.js").Axis} axis
 */
export function distributeBounds(bounds, axis) {
  if (!(axis in AXIS_PROPERTIES)) throw new Error(`unsupported distribution axis: ${axis}`);
  if (bounds.length < 3) throw new Error("distribution requires at least three elements");
  const { start, size } = AXIS_PROPERTIES[axis];
  const ordered = bounds.map((item, index) => ({ item, index }))
    .sort((left, right) => left.item[start] + left.item[size] / 2 - (right.item[start] + right.item[size] / 2));
  const minimum = Math.min(...bounds.map((item) => item[start]));
  const maximum = Math.max(...bounds.map((item) => item[start] + item[size]));
  const totalSize = bounds.reduce((sum, item) => sum + item[size], 0);
  const gap = (maximum - minimum - totalSize) / (bounds.length - 1);
  const result = [...bounds];
  if (gap >= 0) {
    let position = minimum;
    for (const { item, index } of ordered) {
      result[index] = { ...item, [start]: position };
      position += item[size] + gap;
    }
    return result;
  }
  const firstCenter = ordered[0].item[start] + ordered[0].item[size] / 2;
  const last = ordered[ordered.length - 1].item;
  const lastCenter = last[start] + last[size] / 2;
  const centerStep = (lastCenter - firstCenter) / (ordered.length - 1);
  ordered.forEach(({ item, index }, position) => {
    result[index] = { ...item, [start]: firstCenter + centerStep * position - item[size] / 2 };
  });
  return result;
}
