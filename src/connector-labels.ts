import { measureTextWidth } from "./text-metrics.ts";
import type { Bounds, Point } from "./foundation-contracts.ts";
import type {
  DrawingElement,
  LinearElement,
  TextElement,
} from "./render-contracts.ts";
import type { FontFamily } from "./text-metrics.ts";

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
