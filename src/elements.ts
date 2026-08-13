import { nonceFor, seedFor } from "./identity.ts";
import { measureTextWidth } from "./text-metrics.ts";
import type { Bounds, Point } from "./foundation-contracts.ts";
import type {
  ArrowElement,
  BaseElement,
  BaseElementOptions,
  DiamondElement,
  EllipseElement,
  FrameElement,
  FreedrawElement,
  FreedrawElementOptions,
  ImageElement,
  ImageElementOptions,
  LineElement,
  LinearElement,
  LinearElementOptions,
  RectangleElement,
  ShapeElementOptions,
  TextElement,
  TextElementOptions,
} from "./render-contracts.ts";

export const FONT = {
  handDrawn: 1,
  normal: 2,
  code: 3,
  bold: 7,
} as const;

const TRANSPARENT = "transparent";

function baseElement<TType extends string>(
  id: string,
  type: TType,
  bounds: Bounds,
  options: BaseElementOptions = {},
): BaseElement<TType> {
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

export function rectangle(
  id: string,
  bounds: Bounds,
  options: ShapeElementOptions = {},
): RectangleElement {
  return baseElement(id, "rectangle", bounds, options);
}

export function diamond(
  id: string,
  bounds: Bounds,
  options: ShapeElementOptions = {},
): DiamondElement {
  return baseElement(id, "diamond", bounds, options);
}

export function ellipse(
  id: string,
  bounds: Bounds,
  options: ShapeElementOptions = {},
): EllipseElement {
  return baseElement(id, "ellipse", bounds, { ...options, roundness: false });
}

export function frame(
  id: string,
  bounds: Bounds,
  name: string,
  options: ShapeElementOptions = {},
): FrameElement {
  return {
    ...baseElement(id, "frame", bounds, { ...options, roundness: false }),
    name: name || null,
  };
}

export function image(
  id: string,
  bounds: Bounds,
  fileId: string,
  options: ImageElementOptions = {},
): ImageElement {
  return {
    ...baseElement(id, "image", bounds, { ...options, roundness: false }),
    fileId,
    status: "saved",
    scale: options.scale ?? [1, 1],
    crop: options.crop ?? null,
    customData: options.description ? { description: options.description } : undefined,
  };
}

export function text(
  id: string,
  position: { x: number; y: number } | Point,
  value: string,
  options: TextElementOptions = {},
): TextElement {
  const fontSize = options.fontSize ?? 18;
  const fontFamily = options.fontFamily ?? FONT.code;
  const lineHeight = options.lineHeight ?? 1.25;
  const lines = value.split("\n");
  const estimatedWidth = Math.max(
    ...lines.map((line) => measureTextWidth(line, fontSize, fontFamily)),
    fontSize * 0.61,
  );
  const estimatedHeight = lines.length * fontSize * lineHeight;
  const width = options.width ?? estimatedWidth;
  const height = options.height ?? estimatedHeight;
  const [x, y] = Array.isArray(position) ? position : [position.x, position.y];

  return {
    ...baseElement(id, "text", { x, y, width, height }, { ...options, roundness: false }),
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

export function arrow(
  id: string,
  start: Point,
  end: Point,
  options: LinearElementOptions & { type: "line" },
): LineElement;
export function arrow(
  id: string,
  start: Point,
  end: Point,
  options?: LinearElementOptions & { type?: "arrow" },
): ArrowElement;
export function arrow(
  id: string,
  start: Point,
  end: Point,
  options: LinearElementOptions,
): LinearElement;
export function arrow(
  id: string,
  start: Point,
  end: Point,
  options: LinearElementOptions = {},
): LinearElement {
  const path = options.points ? [...options.points] : [start, end];
  const xs = path.map((point) => point[0]);
  const ys = path.map((point) => point[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const points: Point[] = path.map((point) => [point[0] - x, point[1] - y]);
  const type = options.type ?? "arrow";
  const common = {
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
  };
  if (type === "line") {
    return {
      ...common,
      type: "line",
      endArrowhead: null,
      customData: options.customData,
    } satisfies LineElement;
  }
  const elbowed = options.elbowed ?? false;
  return {
    ...common,
    type: "arrow",
    endArrowhead: options.endArrowhead === undefined ? "triangle" : options.endArrowhead,
    customData: options.customData,
    elbowed,
    ...(elbowed ? {
      fixedSegments: options.fixedSegments ?? null,
      startIsSpecial: false as const,
      endIsSpecial: false as const,
    } : {}),
  } satisfies ArrowElement;
}

export function freedraw(
  id: string,
  at: Point,
  inputPoints: readonly Point[],
  options: FreedrawElementOptions = {},
): FreedrawElement {
  const absolutePoints: Point[] = inputPoints.map(([x, y]) => [at[0] + x, at[1] + y]);
  const xs = absolutePoints.map(([x]) => x);
  const ys = absolutePoints.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const points: Point[] = absolutePoints.map(([pointX, pointY]) => [pointX - x, pointY - y]);
  return {
    ...baseElement(id, "freedraw", {
      x,
      y,
      width: Math.max(...xs) - x,
      height: Math.max(...ys) - y,
    }, { ...options, roundness: false }),
    points,
    pressures: [...(options.pressures ?? [])],
    simulatePressure: options.simulatePressure ?? true,
    lastCommittedPoint: null,
  };
}
