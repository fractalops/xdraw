import { boundText, card, fitTextSize, lane, tone } from "./components.ts";
import { arrow, diamond, ellipse, frame, freedraw, image, text } from "./elements.ts";
import { box } from "./geometry.ts";
import { wrapTextToWidth } from "./text-metrics.ts";
import { renderCodeBlock } from "./code-block.ts";
import { planRichNode, renderRichNode, richNodePlanFor } from "./nodes/rich-nodes.ts";
import {
  isArchitectureBoundaryKind,
  renderArchitectureBoundary,
} from "./nodes/architecture.ts";
import type {
  AssetUseStatement,
  BodyStatement,
  FreedrawStatement,
  NodeStatement,
  RenderableFreedrawStatement,
  TextStatement,
} from "./semantic-contracts.ts";
import type { Bounds } from "./foundation-contracts.ts";
import type {
  ResolvedFreedrawStyle,
  ResolvedNodeStyle,
  ResolvedTextStyle,
  SceneVisual,
} from "./layout-contracts.ts";
import type { Drawing } from "./document.ts";
import type {
  FreedrawElement,
  ImageCrop,
  TextAlign,
  VerticalAlign,
} from "./render-contracts.ts";
import type { ToneName } from "./components.ts";

const KIND_LABEL_COLORS = { person: "#7c3aed", database: "#475569" } as const;

function bodyOf(node: NodeStatement): string | undefined {
  const body = node.statements.find((item): item is BodyStatement => item.type === "body");
  return typeof body?.value === "string" ? body.value : undefined;
}

function toneName(value: string | undefined): ToneName | undefined {
  if (value === undefined) return undefined;
  if (
    value === "neutral"
    || value === "success"
    || value === "danger"
    || value === "warning"
    || value === "info"
    || value === "accent"
  ) return value;
  throw new Error(`unsupported tone: ${value}`);
}

function nodeProperty(node: NodeStatement, type: BodyStatement["type"]): unknown {
  return node.statements.find((item): item is BodyStatement => item.type === type)?.value;
}

function textAlign(value: unknown, fallback: TextAlign = "center"): TextAlign {
  if (value === undefined) return fallback;
  if (value === "left" || value === "center" || value === "right") return value;
  throw new Error(`unsupported text alignment: ${String(value)}`);
}

function verticalAlign(value: unknown, fallback: VerticalAlign): VerticalAlign {
  if (value === undefined) return fallback;
  if (value === "top" || value === "middle" || value === "bottom") return value;
  throw new Error(`unsupported vertical alignment: ${String(value)}`);
}

function renderNode(
  drawing: Drawing,
  node: NodeStatement,
  bounds: Bounds,
  style: ResolvedNodeStyle,
  visual?: Extract<SceneVisual, { type: "node" }>,
): void {
  const storedPlan = visual ? richNodePlanFor(visual) : undefined;
  const richPlan = storedPlan === undefined ? planRichNode(node, bounds.width, style) : storedPlan;
  if (richPlan) {
    drawing.add(renderRichNode(node, bounds, style, richPlan));
    return;
  }
  const resolvedTextAlign = textAlign(nodeProperty(node, "text-align"));
  const resolvedVerticalAlign = verticalAlign(
    nodeProperty(node, "vertical-align"),
    bodyOf(node) ? "top" : "middle",
  );
  const groupIds = [`${node.id}:group`];
  if (node.kind === "junction") {
    drawing.add(ellipse(`${node.id}:frame`, bounds, {
      ...style,
      backgroundColor: style.strokeColor,
      groupIds,
    }));
    return;
  }
  if (node.kind === "decision") {
    const titleWidth = bounds.width - 64;
    const titleSize = fitTextSize(node.title, titleWidth, style.titleSize, 12, style.fontFamily);
    const title = wrapTextToWidth(node.title, titleWidth, titleSize, style.fontFamily);
    const frame = diamond(`${node.id}:frame`, bounds, {
      ...style,
      groupIds,
    });
    const labelBounds = box(bounds.x + bounds.width / 4 + 5, bounds.y + bounds.height / 4 + 5, bounds.width / 2 - 10, bounds.height / 2 - 10);
    const label = boundText(`${node.id}:title`, frame.id, labelBounds, title, {
      fontSize: titleSize,
      strokeColor: style.textColor,
      fontFamily: style.fontFamily,
      lineHeight: style.titleLineHeight,
      textAlign: resolvedTextAlign,
      verticalAlign: resolvedVerticalAlign,
      groupIds,
      locked: style.locked,
    });
    frame.boundElements = [{ type: "text", id: label.id }];
    drawing.add(frame, label);
    return;
  }
  drawing.add(card(node.id, bounds, {
    title: node.title,
    body: bodyOf(node),
    colors: { stroke: style.strokeColor, background: style.backgroundColor, text: style.textColor },
    textAlign: resolvedTextAlign,
    verticalAlign: resolvedVerticalAlign,
    boundLabel: !bodyOf(node),
    groupIds,
    ...style,
    frameFactory: node.kind === "ellipse" ? ellipse : undefined,
  }));
  if (node.kind === "person" || node.kind === "database") {
    drawing.add(text(`${node.id}:kind`, { x: bounds.x + 12, y: bounds.y + bounds.height - 24 }, node.kind === "person" ? "PERSON" : "DATA", {
      fontSize: 11,
      strokeColor: KIND_LABEL_COLORS[node.kind],
      fontFamily: style.fontFamily,
      width: bounds.width - 24,
      textAlign: "center",
      groupIds,
      locked: style.locked,
    }));
  }
}

export function renderFreeText(
  drawing: Drawing,
  statement: TextStatement,
  style?: ResolvedTextStyle,
): void {
  if (!statement.at) throw new Error(`text '${statement.id}' requires a position`);
  const resolvedAlign = textAlign(statement.align);
  const fontSize = style?.fontSize ?? statement.fontSize ?? 18;
  if (!(fontSize > 0)) throw new Error("font size must be positive");
  const width = statement.width ?? style?.wrapWidth;
  if (width !== undefined && !(width > 0)) throw new Error("text width must be positive");
  if (style?.autoSize === false && width === undefined) throw new Error("fixed-size text requires a width");
  const value = width === undefined
    ? statement.value
    : wrapTextToWidth(statement.value, width, fontSize, style?.fontFamily);
  drawing.add(text(statement.id, { x: statement.at[0], y: statement.at[1] }, value, {
    fontSize,
    width,
    textAlign: resolvedAlign,
    autoResize: style?.autoSize ?? width === undefined,
    strokeColor: style?.textColor,
    fontFamily: style?.fontFamily,
    lineHeight: style?.lineHeight,
    link: style?.link,
    locked: style?.locked,
  }));
}

export function renderFreedraw(
  drawing: Drawing,
  statement: RenderableFreedrawStatement,
  style?: ResolvedFreedrawStyle,
): FreedrawElement {
  const element = freedraw(`${statement.id}:stroke`, statement.at, statement.points, {
    ...style,
    pressures: statement.pressures,
    simulatePressure: statement.simulatePressure,
  });
  drawing.add(element);
  return element;
}

export function renderableFreedraw(statement: FreedrawStatement): RenderableFreedrawStatement {
  if (typeof statement.simulatePressure !== "boolean") {
    throw new Error(`freedraw '${statement.id}' simulatePressure must be boolean`);
  }
  return { ...statement, simulatePressure: statement.simulatePressure };
}

export function renderSceneVisuals(drawing: Drawing, visuals: readonly SceneVisual[]): void {
  for (const visual of visuals) {
    const start = drawing.elements.length;
    if (visual.type === "container" || visual.type === "frame") {
      if (visual.type === "container") {
        drawing.add(lane(visual.id, visual.bounds, visual.title, { tone: toneName(visual.tone) }));
      } else {
        const resolvedTone = toneName(visual.tone);
        const colors = resolvedTone === undefined ? undefined : tone(resolvedTone);
        drawing.add(isArchitectureBoundaryKind(visual.kind)
          ? renderArchitectureBoundary(
            visual.id,
            visual.bounds,
            visual.title,
            visual.kind,
            toneName(visual.tone),
            visual.locked,
          )
          : frame(visual.id, visual.bounds, visual.title, {
            locked: visual.locked,
            ...(colors ? { strokeColor: colors.stroke, backgroundColor: colors.background } : {}),
          }));
      }
    } else if (visual.type === "node") {
      renderNode(drawing, visual.node, visual.bounds, visual.style, visual);
    } else if (visual.type === "arrow") {
      drawing.add(arrow(visual.id, visual.start, visual.end, visual.options));
    } else if (visual.type === "text") {
      drawing.add(text(visual.id, visual.position, visual.value, visual.options));
    } else if (visual.type === "code") {
      renderCodeBlock(drawing, visual.block, visual.bounds);
    } else {
      const unreachable: never = visual;
      throw new Error(`unsupported scene visual: ${String(unreachable)}`);
    }
    for (const element of drawing.elements.slice(start)) {
      element.frameId = visual.frameId ?? null;
      if (visual.locked) element.locked = true;
    }
  }
}

export function renderImage(drawing: Drawing, statement: AssetUseStatement): void {
  if (!statement.resolvedAsset) throw new Error(`image '${statement.id}' uses unresolved asset '${statement.asset}'`);
  const embedded = drawing.files[statement.resolvedAsset.fileId];
  if (!embedded || embedded.id !== statement.resolvedAsset.fileId) {
    throw new Error(`image '${statement.id}' references missing embedded file '${statement.resolvedAsset.fileId}'`);
  }
  const fit = String(statement.attributes.fit ?? "contain");
  if (!["contain", "cover", "fill"].includes(fit)) throw new Error(`unsupported image fit '${fit}'`);
  let [width, height] = statement.size;
  let [x, y] = statement.at;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error(`image '${statement.id}' requires finite positive dimensions`);
  }
  const naturalWidth = statement.resolvedAsset.width;
  const naturalHeight = statement.resolvedAsset.height;
  if (![naturalWidth, naturalHeight].every(Number.isFinite) || naturalWidth <= 0 || naturalHeight <= 0) {
    throw new Error(`image '${statement.id}' has invalid natural dimensions`);
  }
  let crop: ImageCrop | null = null;
  if (fit === "contain") {
    const ratio = Math.min(width / naturalWidth, height / naturalHeight);
    const fittedWidth = naturalWidth * ratio;
    const fittedHeight = naturalHeight * ratio;
    x += (width - fittedWidth) / 2;
    y += (height - fittedHeight) / 2;
    width = fittedWidth;
    height = fittedHeight;
  } else if (fit === "cover") {
    const targetRatio = width / height;
    const naturalRatio = naturalWidth / naturalHeight;
    const cropWidth = naturalRatio > targetRatio ? naturalHeight * targetRatio : naturalWidth;
    const cropHeight = naturalRatio > targetRatio ? naturalHeight : naturalWidth / targetRatio;
    crop = {
      x: (naturalWidth - cropWidth) / 2,
      y: (naturalHeight - cropHeight) / 2,
      width: cropWidth,
      height: cropHeight,
      naturalWidth,
      naturalHeight,
    };
  }
  const alt = statement.attributes.alt;
  if (alt !== undefined && typeof alt !== "string") throw new Error(`image '${statement.id}' alt must be text`);
  drawing.add(image(statement.id, { x, y, width, height }, statement.resolvedAsset.fileId, {
    crop,
    description: alt,
    locked: statement.attributes.locked === true,
  }));
}
