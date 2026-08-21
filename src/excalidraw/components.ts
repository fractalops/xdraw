import { arrow, rectangle, text } from "./elements.ts";
import { anchor, inset } from "../geometry.ts";
import { endpointLabelBounds, placeConnectorLabel } from "../routing/labels.ts";
import {
  DEFAULT_CONNECTOR_LABEL_SIZE,
  fitTextSize,
  measureTextWidth,
  wrapTextToWidth,
} from "../text/metrics.ts";
import type { Bounds, Point } from "../contracts/foundation.ts";
import type {
  Arrowhead,
  ElementBinding,
  FillStyle,
  LinearElement,
  Roundness,
  ShapeElement,
  ShapeElementOptions,
  StrokeStyle,
  TextAlign,
  TextElement,
  TextElementOptions,
  VerticalAlign,
} from "../contracts/render.ts";
import type { FontFamily } from "../text/metrics.ts";

export { fitTextSize } from "../text/metrics.ts";

export interface ToneColors {
  stroke: string;
  background: string;
  text: string;
}

export type ToneName = "neutral" | "success" | "danger" | "warning" | "info" | "accent";
export type AnchorSide = keyof typeof anchor;
export type ConnectorPath = readonly [Point, Point, ...Point[]];
export type ShapeFactory = (
  id: string,
  bounds: Bounds,
  options?: ShapeElementOptions,
) => ShapeElement;

export interface HeadingOptions extends TextElementOptions {
  color?: string;
}

export type BoundTextOptions = Omit<
  TextElementOptions,
  "width" | "height" | "containerId" | "autoResize"
>;

export interface CardMeasureOptions {
  padding?: number;
  title?: string;
  titleSize?: number;
  titleLineHeight?: number;
  body?: string;
  bodySize?: number;
  lineHeight?: number;
  fontFamily?: FontFamily;
  minimumHeight?: number;
}

export interface LaneOptions {
  tone?: ToneName;
  colors?: Partial<ToneColors>;
  titleSize?: number;
}

export interface CardOptions extends CardMeasureOptions {
  tone?: ToneName;
  colors?: Partial<ToneColors>;
  frameFactory?: ShapeFactory;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  fillStyle?: FillStyle;
  roughness?: number;
  opacity?: number;
  link?: string | null;
  locked?: boolean;
  groupIds?: string[];
  startLabel?: string;
  endLabel?: string;
  boundLabel?: boolean;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
}

export interface ConnectOptions {
  startSide?: AnchorSide;
  endSide?: AnchorSide;
  groupIds?: string[];
  color?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  startArrowhead?: Arrowhead | null;
  endArrowhead?: Arrowhead | null;
  points?: ConnectorPath;
  type?: "arrow" | "line";
  elbowed?: boolean;
  roundness?: Roundness | false;
  startBinding?: ElementBinding | null;
  endBinding?: ElementBinding | null;
  label?: string;
  labelSize?: number;
  labelWidth?: number;
  labelObstacles?: Bounds[];
  labelRoutes?: readonly ConnectorPath[];
  fontFamily?: FontFamily;
  startLabel?: string;
  endLabel?: string;
}

const DEFAULT_TONES: Record<ToneName, ToneColors> = {
  neutral: {
    stroke: "#94a3b8",
    background: "#f8fafc",
    text: "#0f172a",
  },
  success: {
    stroke: "#16a34a",
    background: "#dcfce7",
    text: "#166534",
  },
  danger: {
    stroke: "#dc2626",
    background: "#fee2e2",
    text: "#991b1b",
  },
  warning: {
    stroke: "#d97706",
    background: "#fef3c7",
    text: "#92400e",
  },
  info: {
    stroke: "#2563eb",
    background: "#dbeafe",
    text: "#1e40af",
  },
  accent: {
    stroke: "#7c3aed",
    background: "#ede9fe",
    text: "#5b21b6",
  },
};

export function tone(name: ToneName, overrides: Partial<ToneColors> = {}): ToneColors {
  if (!Object.hasOwn(DEFAULT_TONES, name)) {
    throw new Error(`unknown tone: ${name}`);
  }
  const colors = { ...DEFAULT_TONES[name], ...overrides };
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`tone ${name} ${key} must be a non-empty color string`);
    }
  }
  return colors;
}

export function heading(
  id: string,
  position: { x: number; y: number } | Point,
  value: string,
  options: HeadingOptions = {},
): TextElement {
  return text(id, position, value, {
    fontSize: options.fontSize ?? 30,
    strokeColor: options.color ?? "#1f2937",
    ...options,
  });
}

export function boundText(
  id: string,
  containerId: string,
  bounds: Bounds,
  value: string,
  options: BoundTextOptions = {},
): TextElement {
  const fontSize = options.fontSize ?? 18;
  const lineHeight = options.lineHeight ?? 1.25;
  const align = options.textAlign ?? "center";
  const verticalAlign = options.verticalAlign ?? "middle";
  const fontFamily = options.fontFamily ?? 3;
  const wrapped = wrapTextToWidth(value, bounds.width, fontSize, fontFamily);
  const lines = wrapped.split("\n");
  const width = Math.min(bounds.width, Math.max(...lines.map((line) => measureTextWidth(line, fontSize, fontFamily)), 1));
  const height = lines.length * fontSize * lineHeight;
  const x = align === "left"
    ? bounds.x
    : align === "right"
      ? bounds.x + bounds.width - width
      : bounds.x + (bounds.width - width) / 2;
  const y = verticalAlign === "top"
    ? bounds.y
    : verticalAlign === "bottom"
      ? bounds.y + bounds.height - height
      : bounds.y + (bounds.height - height) / 2;
  return text(id, { x, y }, wrapped, {
    ...options,
    fontSize,
    lineHeight,
    width,
    height,
    textAlign: align,
    verticalAlign,
    containerId,
    autoResize: true,
  });
}

export function wrapText(value: string, maxCharacters: number): string {
  return value.split("\n").flatMap((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean).flatMap((word) => {
      if (word.length <= maxCharacters || !word.includes("-")) return [word];
      const chunks: string[] = [];
      let remaining = word;
      while (remaining.length > maxCharacters) {
        const breakAt = remaining.lastIndexOf("-", maxCharacters - 1);
        const size = breakAt > 0 ? breakAt + 1 : maxCharacters;
        chunks.push(remaining.slice(0, size));
        remaining = remaining.slice(size);
      }
      if (remaining) chunks.push(remaining);
      return chunks;
    });
    if (!words.length) return [""];
    const lines: string[] = [];
    let line = words[0];
    for (const word of words.slice(1)) {
      if (`${line} ${word}`.length <= maxCharacters) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
    return lines;
  }).join("\n");
}

export function measureCard(options: CardMeasureOptions, width: number): number {
  const padding = options.padding ?? 20;
  const contentWidth = Math.max(1, width - padding * 2);
  let height = padding * 2;
  if (options.title) {
    const titleSize = fitTextSize(options.title, contentWidth, options.titleSize ?? 19, 12, options.fontFamily ?? 3);
    const title = wrapTextToWidth(options.title, contentWidth, titleSize, options.fontFamily ?? 3);
    height += title.split("\n").length * titleSize * (options.titleLineHeight ?? 1.25) + 8;
  }
  if (options.body) {
    const bodySize = options.bodySize ?? 17;
    const lineHeight = options.lineHeight ?? 1.28;
    const body = wrapTextToWidth(options.body, contentWidth, bodySize, options.fontFamily ?? 3);
    height += body.split("\n").length * bodySize * lineHeight;
  }
  return Math.ceil(Math.max(options.minimumHeight ?? 88, height));
}

export function lane(
  id: string,
  bounds: Bounds,
  title: string,
  options: LaneOptions = {},
): Array<ShapeElement | TextElement> {
  const colors = tone(options.tone ?? "neutral", options.colors);
  const elements: Array<ShapeElement | TextElement> = [
    rectangle(`${id}:frame`, bounds, {
      strokeColor: colors.stroke,
      backgroundColor: colors.background,
    }),
  ];
  if (title) elements.push(text(
      `${id}:title`,
      { x: bounds.x + 22, y: bounds.y + 18 },
      title,
      { fontSize: options.titleSize ?? 23, strokeColor: colors.text },
  ));
  return elements;
}

export function card(
  id: string,
  bounds: Bounds,
  options: CardOptions,
): Array<ShapeElement | TextElement> {
  const colors = tone(options.tone ?? "neutral", options.colors);
  const frameFactory = options.frameFactory ?? rectangle;
  const frameOptions = {
    strokeColor: colors.stroke,
    backgroundColor: colors.background,
    strokeWidth: options.strokeWidth ?? 2,
    strokeStyle: options.strokeStyle ?? "solid",
    fillStyle: options.fillStyle,
    roughness: options.roughness,
    opacity: options.opacity,
    link: options.link,
    locked: options.locked,
  };
  // A node no larger than twice its padding leaves no room for a content box,
  // and `inset` rightly refuses to produce one. Asking it to was the mistake:
  // the padding is usually the default rather than something the author chose,
  // so honour the size they did write and shrink the padding to fit. A tick mark
  // eight pixels tall is a legitimate thing to draw. Where a label genuinely
  // does not fit, XD1210 already says so.
  const room = Math.max(0, (Math.min(bounds.width, bounds.height) - 1) / 2);
  const content = inset(bounds, Math.min(options.padding ?? 20, room));
  const groupIds = options.groupIds ?? (options.startLabel || options.endLabel ? [`${id}:group`] : []);
  if (options.boundLabel && options.title && !options.body) {
    const label = boundText(`${id}:title`, `${id}:frame`, content, options.title, {
      fontSize: fitTextSize(options.title, content.width, options.titleSize ?? 19, 12, options.fontFamily ?? 3),
      strokeColor: colors.text,
      fontFamily: options.fontFamily,
      lineHeight: options.titleLineHeight,
      textAlign: options.textAlign ?? "center",
      verticalAlign: options.verticalAlign ?? "middle",
      groupIds,
      locked: options.locked,
    });
    return [
      frameFactory(`${id}:frame`, bounds, {
        ...frameOptions,
        boundElements: [{ type: "text", id: label.id }],
        groupIds,
      }),
      label,
    ];
  }
  const elements: Array<ShapeElement | TextElement> = [
    frameFactory(`${id}:frame`, bounds, {
      ...frameOptions,
      groupIds,
    }),
  ];

  const titleSize = options.title ? fitTextSize(options.title, content.width, options.titleSize ?? 19, 12, options.fontFamily ?? 3) : 0;
  const wrappedTitle = options.title
    ? wrapTextToWidth(options.title, content.width, titleSize, options.fontFamily ?? 3)
    : "";
  const bodySize = options.bodySize ?? 17;
  const bodyLineHeight = options.lineHeight ?? 1.28;
  const wrappedBody = options.body
    ? wrapTextToWidth(options.body, content.width, bodySize, options.fontFamily ?? 3)
    : "";
  const titleLineHeight = options.titleLineHeight ?? 1.25;
  const contentHeight = (wrappedTitle ? wrappedTitle.split("\n").length * titleSize * titleLineHeight + 8 : 0)
    + (wrappedBody ? wrappedBody.split("\n").length * bodySize * bodyLineHeight : 0);
  let bodyY = options.verticalAlign === "bottom"
    ? content.y + content.height - contentHeight
    : options.verticalAlign === "middle"
      ? content.y + (content.height - contentHeight) / 2
      : content.y;
  if (options.title) {
    elements.push(text(`${id}:title`, { x: content.x, y: bodyY }, wrappedTitle, {
      fontSize: titleSize,
      strokeColor: colors.text,
      fontFamily: options.fontFamily,
      lineHeight: titleLineHeight,
      width: content.width,
      textAlign: options.textAlign ?? "left",
      autoResize: false,
      groupIds,
      locked: options.locked,
    }));
    bodyY += wrappedTitle.split("\n").length * titleSize * titleLineHeight + 8;
  }
  if (options.body) {
    elements.push(text(`${id}:body`, { x: content.x, y: bodyY }, wrappedBody, {
      fontSize: bodySize,
      strokeColor: colors.text,
      fontFamily: options.fontFamily,
      width: content.width,
      textAlign: options.textAlign ?? "left",
      lineHeight: bodyLineHeight,
      autoResize: false,
      groupIds,
      locked: options.locked,
    }));
  }
  return elements;
}

export function connect(
  id: string,
  fromBounds: Bounds,
  toBounds: Bounds,
  options: ConnectOptions = {},
): Array<LinearElement | TextElement> {
  if (options.points && options.points.length < 2) throw new Error("connector paths require at least two points");
  const startSide = options.startSide ?? "right";
  const endSide = options.endSide ?? "left";
  const groupIds = options.groupIds ?? (options.startLabel || options.endLabel ? [`${id}:group`] : []);
  const endpointLabelIds = {
    ...(options.startLabel ? { start: `${id}:start-label` } : {}),
    ...(options.endLabel ? { end: `${id}:end-label` } : {}),
  };
  const line = arrow(id, anchor[startSide](fromBounds), anchor[endSide](toBounds), {
      strokeColor: options.color ?? "#475569",
      strokeWidth: options.strokeWidth ?? 2,
      strokeStyle: options.strokeStyle ?? "solid",
      startArrowhead: options.startArrowhead ?? null,
      endArrowhead: options.endArrowhead === undefined ? "triangle" : options.endArrowhead,
      points: options.points,
      type: options.type ?? "arrow",
      elbowed: options.elbowed ?? false,
      roundness: options.roundness,
      startBinding: options.startBinding,
      endBinding: options.endBinding,
      groupIds,
      customData: Object.keys(endpointLabelIds).length ? { xdrawEndpointLabels: endpointLabelIds } : undefined,
    });
  const elements: Array<LinearElement | TextElement> = [line];
  if (options.label) {
    const placement = placeConnectorLabel({
      label: options.label,
      path: options.points ?? [anchor[startSide](fromBounds), anchor[endSide](toBounds)],
      fromBounds,
      toBounds,
      obstacles: options.labelObstacles,
      routes: options.labelRoutes,
      fontSize: options.labelSize,
      fontFamily: options.fontFamily,
      maxWidth: options.labelWidth,
    });
    const label = text(`${id}:label`, { x: placement.x, y: placement.y }, placement.text, {
      fontSize: options.labelSize ?? DEFAULT_CONNECTOR_LABEL_SIZE,
      strokeColor: options.color ?? "#475569",
      width: placement.width,
      height: placement.height,
      textAlign: "center",
      autoResize: false,
      containerId: id,
      groupIds,
    });
    line.boundElements = [{ type: "text", id: label.id }];
    elements.push(label);
  }
  const endpointLabel = (
    position: "start" | "end",
    value: string | undefined,
    point: Point,
    nextPoint: Point,
  ): void => {
    if (!value) return;
    const fontSize = options.labelSize ?? 15;
    const bounds = endpointLabelBounds(value, point, nextPoint, fontSize, options.fontFamily ?? 3);
    elements.push(text(`${id}:${position}-label`, bounds, value, {
      fontSize,
      strokeColor: options.color ?? "#475569",
      width: bounds.width,
      textAlign: "center",
      autoResize: false,
      groupIds,
    }));
  };
  const path = options.points ?? [anchor[startSide](fromBounds), anchor[endSide](toBounds)];
  endpointLabel("start", options.startLabel, path[0], path[1]);
  endpointLabel("end", options.endLabel, path[path.length - 1], path[path.length - 2]);
  return elements;
}
