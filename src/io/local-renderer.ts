import { Resvg } from "@resvg/resvg-js";
import { getStroke } from "perfect-freehand";
import type { Point } from "../contracts/foundation.ts";
import type { StrokeStyle, TextAlign } from "../contracts/render.ts";

type LocalElementType =
  | "arrow"
  | "diamond"
  | "ellipse"
  | "frame"
  | "freedraw"
  | "image"
  | "line"
  | "rectangle"
  | "text";

export interface RenderableSceneElement {
  id: string;
  type: LocalElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  backgroundColor?: string;
  endArrowhead?: string | null;
  fileId?: string;
  fontFamily?: number;
  fontSize?: number;
  frameId?: string | null;
  isDeleted?: boolean;
  lineHeight?: number;
  name?: string | null;
  opacity?: number;
  points?: Point[];
  pressures?: number[];
  roundness?: unknown;
  simulatePressure?: boolean;
  startArrowhead?: string | null;
  strokeColor?: string;
  strokeStyle?: StrokeStyle;
  strokeWidth?: number;
  text?: string;
  textAlign?: TextAlign;
}

export interface RenderableSceneFile {
  dataURL: string;
}

export interface RenderableSceneInput {
  elements: readonly RenderableSceneElement[];
  appState?: { viewBackgroundColor?: string };
  files?: Readonly<Record<string, RenderableSceneFile>>;
}

interface LocalScene {
  elements: RenderableSceneElement[];
  appState: { viewBackgroundColor?: string };
  files: Record<string, RenderableSceneFile>;
}

export interface RenderSceneOptions {
  frameId?: string;
  padding?: number;
  maxWidth?: number;
  backgroundColor?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : finiteNumber(value, label);
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}

function points(value: unknown, label: string): Point[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array of points`);
  return value.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) throw new TypeError(`${label}[${index}] must be an [x, y] point`);
    return [finiteNumber(point[0], `${label}[${index}].x`), finiteNumber(point[1], `${label}[${index}].y`)];
  });
}

/**
 * How far apart a stroke's ends may be and still count as closed, matching
 * Excalidraw's own LINE_CONFIRM_THRESHOLD. A stroke wider than this at the seam
 * is not filled there either, so the two agree.
 */
const LOOP_THRESHOLD = 8;

const ELEMENT_TYPES: ReadonlySet<string> = new Set<LocalElementType>([
  "arrow", "diamond", "ellipse", "frame", "freedraw", "image", "line", "rectangle", "text",
]);

function parseElement(value: unknown, index: number): RenderableSceneElement {
  if (!isRecord(value)) throw new TypeError(`scene element ${index} must be an object`);
  if (typeof value.id !== "string" || !value.id) throw new TypeError(`scene element ${index} must have a non-empty id`);
  if (typeof value.type !== "string" || !ELEMENT_TYPES.has(value.type)) {
    throw new TypeError(`scene element '${value.id}' has unsupported type '${String(value.type)}'`);
  }
  const type = value.type as LocalElementType;
  const element: RenderableSceneElement = {
    id: value.id,
    type,
    x: finiteNumber(value.x, `element '${value.id}' x`),
    y: finiteNumber(value.y, `element '${value.id}' y`),
    width: finiteNumber(value.width, `element '${value.id}' width`),
    height: finiteNumber(value.height, `element '${value.id}' height`),
    angle: optionalNumber(value.angle, `element '${value.id}' angle`),
    backgroundColor: optionalString(value.backgroundColor, `element '${value.id}' backgroundColor`),
    fileId: optionalString(value.fileId, `element '${value.id}' fileId`),
    fontFamily: optionalNumber(value.fontFamily, `element '${value.id}' fontFamily`),
    fontSize: optionalNumber(value.fontSize, `element '${value.id}' fontSize`),
    frameId: value.frameId === null ? null : optionalString(value.frameId, `element '${value.id}' frameId`),
    lineHeight: optionalNumber(value.lineHeight, `element '${value.id}' lineHeight`),
    name: value.name === null ? null : optionalString(value.name, `element '${value.id}' name`),
    opacity: optionalNumber(value.opacity, `element '${value.id}' opacity`),
    roundness: value.roundness,
    strokeColor: optionalString(value.strokeColor, `element '${value.id}' strokeColor`),
    strokeWidth: optionalNumber(value.strokeWidth, `element '${value.id}' strokeWidth`),
    text: optionalString(value.text, `element '${value.id}' text`),
  };
  if (value.isDeleted !== undefined && typeof value.isDeleted !== "boolean") {
    throw new TypeError(`element '${value.id}' isDeleted must be boolean`);
  }
  element.isDeleted = value.isDeleted;
  if (value.strokeStyle !== undefined) {
    if (value.strokeStyle !== "solid" && value.strokeStyle !== "dashed" && value.strokeStyle !== "dotted") {
      throw new TypeError(`element '${value.id}' has invalid strokeStyle`);
    }
    element.strokeStyle = value.strokeStyle;
  }
  if (value.textAlign !== undefined) {
    if (value.textAlign !== "left" && value.textAlign !== "center" && value.textAlign !== "right") {
      throw new TypeError(`element '${value.id}' has invalid textAlign`);
    }
    element.textAlign = value.textAlign;
  }
  if (value.startArrowhead !== undefined && value.startArrowhead !== null && typeof value.startArrowhead !== "string") {
    throw new TypeError(`element '${value.id}' startArrowhead must be a string or null`);
  }
  if (value.endArrowhead !== undefined && value.endArrowhead !== null && typeof value.endArrowhead !== "string") {
    throw new TypeError(`element '${value.id}' endArrowhead must be a string or null`);
  }
  element.startArrowhead = value.startArrowhead;
  element.endArrowhead = value.endArrowhead;
  if (type === "arrow" || type === "line" || type === "freedraw") {
    element.points = points(value.points, `element '${value.id}' points`);
  }
  if (type === "freedraw") {
    if (value.pressures !== undefined) {
      if (!Array.isArray(value.pressures)) throw new TypeError(`element '${value.id}' pressures must be an array`);
      element.pressures = value.pressures.map((pressure, pressureIndex) => (
        finiteNumber(pressure, `element '${String(value.id)}' pressures[${String(pressureIndex)}]`)
      ));
    }
    if (value.simulatePressure !== undefined && typeof value.simulatePressure !== "boolean") {
      throw new TypeError(`element '${value.id}' simulatePressure must be boolean`);
    }
    element.simulatePressure = value.simulatePressure;
  }
  if (["diamond", "ellipse", "frame", "image", "rectangle"].includes(type)
      && (!(element.width > 0) || !(element.height > 0))) {
    throw new TypeError(`element '${value.id}' must have positive width and height`);
  }
  return element;
}

function parseScene(value: unknown): LocalScene {
  if (!isRecord(value)) throw new TypeError("scene must be an object");
  if (!Array.isArray(value.elements)) throw new TypeError("scene.elements must be an array");
  const appState = value.appState === undefined ? {} : value.appState;
  if (!isRecord(appState)) throw new TypeError("scene.appState must be an object");
  const background = optionalString(appState.viewBackgroundColor, "scene background color");
  const sourceFiles = value.files === undefined ? {} : value.files;
  if (!isRecord(sourceFiles)) throw new TypeError("scene.files must be an object");
  const files: Record<string, RenderableSceneFile> = {};
  for (const [fileId, file] of Object.entries(sourceFiles)) {
    if (!isRecord(file) || typeof file.dataURL !== "string" || !file.dataURL) {
      throw new TypeError(`scene file '${fileId}' must contain a non-empty dataURL`);
    }
    files[fileId] = { dataURL: file.dataURL };
  }
  const elements = value.elements.map(parseElement);
  for (const element of elements) {
    if (element.type === "image" && (!element.fileId || !files[element.fileId])) {
      throw new TypeError(`image '${element.id}' references missing scene file '${String(element.fileId)}'`);
    }
  }
  return { elements, appState: { viewBackgroundColor: background }, files };
}

function escape(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function visibleElements(scene: LocalScene, frameId?: string): RenderableSceneElement[] {
  const visible = scene.elements.filter((element) => !element.isDeleted);
  if (!frameId) return visible;
  const selected = visible.filter((element) => element.id === frameId || element.frameId === frameId);
  if (!selected.some((element) => element.id === frameId)) throw new Error(`scene does not contain frame '${frameId}'`);
  return selected;
}

function boundsOf(elements: readonly RenderableSceneElement[]): { x: number; y: number; width: number; height: number } {
  if (!elements.length) return { x: 0, y: 0, width: 1, height: 1 };
  const left = Math.min(...elements.map((item) => item.x ?? 0));
  const top = Math.min(...elements.map((item) => item.y ?? 0));
  const right = Math.max(...elements.map((item) => (item.x ?? 0) + Math.max(item.width ?? 0, 1)));
  const bottom = Math.max(...elements.map((item) => (item.y ?? 0) + Math.max(item.height ?? 0, 1)));
  return { x: left, y: top, width: Math.max(right - left, 1), height: Math.max(bottom - top, 1) };
}

function dash(element: RenderableSceneElement): string {
  if (element.strokeStyle === "dashed") return ' stroke-dasharray="12 8"';
  if (element.strokeStyle === "dotted") return ' stroke-dasharray="3 6"';
  return "";
}

function shapeStyle(element: RenderableSceneElement): string {
  const fill = element.backgroundColor && element.backgroundColor !== "transparent" ? element.backgroundColor : "none";
  return `fill="${escape(fill)}" stroke="${escape(element.strokeColor ?? "#1f2937")}" stroke-width="${element.strokeWidth ?? 1}"${dash(element)} opacity="${(element.opacity ?? 100) / 100}"`;
}

function transform(element: RenderableSceneElement): string {
  if (!element.angle) return "";
  const cx = (element.x ?? 0) + (element.width ?? 0) / 2;
  const cy = (element.y ?? 0) + (element.height ?? 0) / 2;
  return ` transform="rotate(${element.angle * 180 / Math.PI} ${cx} ${cy})"`;
}

function renderText(element: RenderableSceneElement): string {
  const lines = String(element.text ?? "").split("\n");
  const fontSize = element.fontSize ?? 18;
  const lineHeight = fontSize * (element.lineHeight ?? 1.25);
  const alignment = element.textAlign ?? "left";
  const anchor = alignment === "center" ? "middle" : alignment === "right" ? "end" : "start";
  const x = (element.x ?? 0) + (alignment === "center" ? (element.width ?? 0) / 2 : alignment === "right" ? (element.width ?? 0) : 0);
  // Excalidraw numbers its families Virgil 1, Helvetica 2, Cascadia 3, Lilita One 7.
  // Name the real font first so a machine that has it renders what the editor
  // renders, and keep the generic stand-ins behind it for machines that do not.
  const family = element.fontFamily === 3
    ? "Cascadia, Cascadia Code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    : element.fontFamily === 7
      ? "Lilita One, Arial Black, Arial, sans-serif"
      : element.fontFamily === 1
        ? "Virgil, Excalifont, Comic Sans MS, cursive"
        : "Helvetica, Arial, sans-serif";
  const spans = lines.map((line, index) => (
    `<tspan x="${x}" dy="${index === 0 ? fontSize : lineHeight}">${escape(line)}</tspan>`
  )).join("");
  return `<text xml:space="preserve" x="${x}" y="${element.y ?? 0}" text-anchor="${anchor}" font-family="${escape(family)}" font-size="${fontSize}" fill="${escape(element.strokeColor ?? "#1f2937")}" opacity="${(element.opacity ?? 100) / 100}"${transform(element)}>${spans}</text>`;
}

function linearPoints(element: RenderableSceneElement): string {
  return (element.points ?? []).map(([x, y]) => `${element.x + x},${element.y + y}`).join(" ");
}

/**
 * The interior of a closed stroke, drawn under it.
 *
 * `freeDrawPath` returns the stroke's outline, so on its own a plotted circle is
 * a ring with nothing inside. Excalidraw fills the polygon through the raw
 * points = when the stroke closes, and closes means first and last point within
 * `LOOP_THRESHOLD` of each other; matching that keeps a preview agreeing with
 * what the editor shows rather than approximating it differently.
 *
 * The fill is solid whatever `fill-style` asked for, which is what this renderer
 * already does for every other shape: it has no hatch generator.
 */
function freeDrawFill(element: RenderableSceneElement, rotation: string): string {
  const background = element.backgroundColor;
  if (!background || background === "transparent") return "";
  const points = element.points ?? [];
  if (points.length < 3) return "";
  const [firstX, firstY] = points[0];
  const [lastX, lastY] = points[points.length - 1];
  if (Math.hypot(lastX - firstX, lastY - firstY) > LOOP_THRESHOLD) return "";
  const x = element.x ?? 0;
  const y = element.y ?? 0;
  const path = points.map(([px, py], index) => `${index === 0 ? "M" : "L"} ${x + px} ${y + py}`).join(" ");
  return `<path d="${path} Z" fill="${escape(background)}" stroke="none" opacity="${(element.opacity ?? 100) / 100}"${rotation}/>`;
}

function freeDrawPath(element: RenderableSceneElement): string {
  const pressures = element.pressures ?? [];
  const input = (element.points ?? []).map(([x, y], index) => (
    [(element.x ?? 0) + x, (element.y ?? 0) + y, pressures[index] ?? 0.5]
  ));
  const outline = getStroke(input, {
    size: (element.strokeWidth ?? 1) * 4.25,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: element.simulatePressure ?? true,
    last: true,
  });
  if (!outline.length) return "";
  const path = ["M", outline[0][0], outline[0][1], "Q"];
  for (let index = 0; index < outline.length; index += 1) {
    const point = outline[index];
    const next = outline[(index + 1) % outline.length];
    path.push(point[0], point[1], (point[0] + next[0]) / 2, (point[1] + next[1]) / 2);
  }
  path.push("Z");
  return path.join(" ");
}

function renderElement(
  element: RenderableSceneElement,
  files: Readonly<Record<string, RenderableSceneFile>>,
): string {
  const { x, y, width, height } = element;
  const style = shapeStyle(element);
  const rotation = transform(element);
  if (element.type === "text") return renderText(element);
  if (element.type === "rectangle") {
    const radius = element.roundness ? Math.min(8, width / 8, height / 8) : 0;
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" ${style}${rotation}/>`;
  }
  if (element.type === "frame") {
    return `<g${rotation}><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="${escape(element.strokeColor ?? "#94a3b8")}" stroke-width="${element.strokeWidth ?? 1}"/><text x="${x + 8}" y="${y + 20}" font-family="Arial, sans-serif" font-size="14" fill="${escape(element.strokeColor ?? "#64748b")}">${escape(element.name ?? "")}</text></g>`;
  }
  if (element.type === "ellipse") {
    return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" ${style}${rotation}/>`;
  }
  if (element.type === "diamond") {
    const points = `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`;
    return `<polygon points="${points}" ${style}${rotation}/>`;
  }
  if (element.type === "freedraw") {
    const stroke = `<path d="${freeDrawPath(element)}" fill="${escape(element.strokeColor ?? "#1f2937")}" opacity="${(element.opacity ?? 100) / 100}"${rotation}/>`;
    return `${freeDrawFill(element, rotation)}${stroke}`;
  }
  if (["arrow", "line"].includes(element.type)) {
    const markerStart = element.startArrowhead ? ' marker-start="url(#arrow-start)"' : "";
    const markerEnd = element.endArrowhead ? ' marker-end="url(#arrow-end)"' : "";
    return `<polyline points="${linearPoints(element)}" fill="none" stroke="${escape(element.strokeColor ?? "#1f2937")}" stroke-width="${element.strokeWidth ?? 1}" stroke-linecap="round" stroke-linejoin="round"${dash(element)}${markerStart}${markerEnd} opacity="${(element.opacity ?? 100) / 100}"${rotation}/>`;
  }
  if (element.type === "image") {
    const href = files[element.fileId ?? ""]?.dataURL;
    return `<image x="${x}" y="${y}" width="${width}" height="${height}" href="${escape(href)}"${rotation}/>`;
  }
  return "";
}

export function renderSceneSvg(scene: RenderableSceneInput, options: RenderSceneOptions = {}): string {
  const { frameId, padding = 20, maxWidth, backgroundColor } = options;
  if (!Number.isFinite(padding) || padding < 0) throw new Error("padding must be a non-negative number");
  if (maxWidth !== undefined && (!Number.isFinite(maxWidth) || maxWidth <= 0)) {
    throw new Error("maxWidth must be a positive number");
  }
  if (frameId !== undefined && (typeof frameId !== "string" || !frameId)) {
    throw new Error("frameId must be a non-empty string");
  }
  if (backgroundColor !== undefined && (typeof backgroundColor !== "string" || !backgroundColor.trim())) {
    throw new Error("backgroundColor must be a non-empty string");
  }
  const parsedScene = parseScene(scene);
  const elements = visibleElements(parsedScene, frameId);
  const content = boundsOf(elements);
  const naturalWidth = content.width + padding * 2;
  const naturalHeight = content.height + padding * 2;
  const width = maxWidth ? Math.min(maxWidth, naturalWidth) : naturalWidth;
  const height = naturalHeight * width / naturalWidth;
  const background = backgroundColor ?? parsedScene.appState.viewBackgroundColor ?? "#ffffff";
  const backgroundElement = background === "transparent"
    ? ""
    : `<rect width="100%" height="100%" fill="${escape(background)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="0 0 ${naturalWidth} ${naturalHeight}">
  <defs>
    <marker id="arrow-end" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke"/></marker>
    <marker id="arrow-start" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M9,0 L9,6 L0,3 z" fill="context-stroke"/></marker>
  </defs>
  ${backgroundElement}
  <g transform="translate(${padding - content.x} ${padding - content.y})">
    ${elements.map((element) => renderElement(element, parsedScene.files)).join("\n    ")}
  </g>
</svg>`;
}

export function renderScenePng(scene: RenderableSceneInput, options: RenderSceneOptions = {}): Uint8Array {
  const svg = renderSceneSvg(scene, options);
  return new Resvg(svg).render().asPng();
}
