import { nonceFor, seedFor } from "./identity.js";
import { measureTextWidth } from "./text-metrics.js";

export const FONT = {
  handDrawn: 1,
  normal: 2,
  code: 3,
};

const TRANSPARENT = "transparent";

function baseElement(id, type, bounds, options = {}) {
  return {
    id,
    type,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    angle: 0,
    strokeColor: options.strokeColor ?? "#1f2937",
    backgroundColor: options.backgroundColor ?? TRANSPARENT,
    fillStyle: options.fillStyle ?? "solid",
    strokeWidth: options.strokeWidth ?? 1,
    strokeStyle: options.strokeStyle ?? "solid",
    roughness: options.roughness ?? 0,
    opacity: options.opacity ?? 100,
    groupIds: options.groupIds ?? [],
    frameId: options.frameId ?? null,
    roundness: options.roundness === false ? null : (options.roundness ?? { type: 3 }),
    seed: seedFor(id),
    version: 1,
    versionNonce: nonceFor(id),
    isDeleted: false,
    boundElements: options.boundElements ?? null,
    updated: 1,
    link: options.link ?? null,
    locked: options.locked ?? false,
  };
}

export function rectangle(id, bounds, options = {}) {
  return baseElement(id, "rectangle", bounds, options);
}

export function diamond(id, bounds, options = {}) {
  return baseElement(id, "diamond", bounds, options);
}

export function ellipse(id, bounds, options = {}) {
  return baseElement(id, "ellipse", bounds, { ...options, roundness: false });
}

export function frame(id, bounds, name, options = {}) {
  return {
    ...baseElement(id, "frame", bounds, { ...options, roundness: false }),
    name: name || null,
  };
}

export function image(id, bounds, fileId, options = {}) {
  return {
    ...baseElement(id, "image", bounds, { ...options, roundness: false }),
    fileId,
    status: "saved",
    scale: options.scale ?? [1, 1],
    crop: options.crop ?? null,
    customData: options.description ? { description: options.description } : undefined,
  };
}

export function text(id, position, value, options = {}) {
  const fontSize = options.fontSize ?? 18;
  const fontFamily = options.fontFamily ?? FONT.code;
  const lineHeight = options.lineHeight ?? 1.25;
  const lines = value.split("\n");
  const estimatedWidth = Math.max(...lines.map((line) => measureTextWidth(line, fontSize, fontFamily)), fontSize * 0.61);
  const estimatedHeight = lines.length * fontSize * lineHeight;
  const width = options.width ?? estimatedWidth;
  const height = options.height ?? estimatedHeight;

  return {
    ...baseElement(
      id,
      "text",
      { x: position.x, y: position.y, width, height },
      { ...options, roundness: false },
    ),
    fontSize,
    fontFamily,
    text: value,
    textAlign: options.textAlign ?? "left",
    verticalAlign: options.verticalAlign ?? "top",
    containerId: options.containerId ?? null,
    originalText: value,
    lineHeight,
    autoResize: options.autoResize ?? true,
  };
}

export function arrow(id, start, end, options = {}) {
  const path = options.points ?? [start, end];
  const xs = path.map((point) => point[0]);
  const ys = path.map((point) => point[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const points = path.map((point) => [point[0] - x, point[1] - y]);

  const type = options.type ?? "arrow";
  const element = {
    ...baseElement(
      id,
      type,
      {
        x,
        y,
        width: Math.max(...xs) - x,
        height: Math.max(...ys) - y,
      },
      { ...options, roundness: options.roundness ?? false },
    ),
    points,
    lastCommittedPoint: null,
    startBinding: options.startBinding ?? null,
    endBinding: options.endBinding ?? null,
    startArrowhead: options.startArrowhead ?? null,
    endArrowhead: type === "line" ? null : (options.endArrowhead === undefined ? "triangle" : options.endArrowhead),
    customData: options.customData,
  };
  if (type === "arrow") {
    element.elbowed = options.elbowed ?? false;
    if (element.elbowed) {
      element.fixedSegments = options.fixedSegments ?? null;
      element.startIsSpecial = false;
      element.endIsSpecial = false;
    }
  }
  return element;
}
