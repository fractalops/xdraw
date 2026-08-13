import { boundText, card, fitTextSize, lane, wrapText } from "./components.js";
import { arrow, diamond, ellipse, frame, freedraw, image, text } from "./elements.js";
import { box } from "./layout.js";
import { wrapTextToWidth } from "./text-metrics.js";
import { renderCodeBlock } from "./code-block.js";

const KIND_LABEL_COLORS = { person: "#7c3aed", database: "#475569" };

function bodyOf(node) {
  return node.statements?.find((item) => item.type === "body")?.value;
}

function renderNode(drawing, node, bounds, style) {
  const textAlign = node.statements?.find((item) => item.type === "text-align")?.value ?? "center";
  const verticalAlign = node.statements?.find((item) => item.type === "vertical-align")?.value ?? (bodyOf(node) ? "top" : "middle");
  if (!["left", "center", "right"].includes(textAlign)) throw new Error(`unsupported text alignment: ${textAlign}`);
  if (!["top", "middle", "bottom"].includes(verticalAlign)) throw new Error(`unsupported vertical alignment: ${verticalAlign}`);
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
      textAlign,
      verticalAlign,
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
    textAlign,
    verticalAlign,
    boundLabel: !bodyOf(node),
    groupIds,
    ...style,
    frameFactory: node.kind === "ellipse" ? ellipse : undefined,
  }));
  if (["person", "database"].includes(node.kind)) {
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

export function renderFreeText(drawing, statement, style = {}) {
  if (!["left", "center", "right"].includes(statement.align)) throw new Error(`unsupported text alignment: ${statement.align}`);
  const fontSize = style.fontSize ?? statement.fontSize ?? 18;
  if (!(fontSize > 0)) throw new Error("font size must be positive");
  const width = statement.width ?? style.wrapWidth;
  if (width !== undefined && !(width > 0)) throw new Error("text width must be positive");
  if (style.autoSize === false && width === undefined) throw new Error("fixed-size text requires a width");
  const value = width === undefined
    ? statement.value
    : wrapTextToWidth(statement.value, width, fontSize, style.fontFamily);
  drawing.add(text(statement.id, { x: statement.at[0], y: statement.at[1] }, value, {
    fontSize,
    width,
    textAlign: statement.align,
    autoResize: style.autoSize ?? width === undefined,
    strokeColor: style.textColor,
    fontFamily: style.fontFamily,
    lineHeight: style.lineHeight,
    link: style.link,
    locked: style.locked,
  }));
}

export function renderFreedraw(drawing, statement, style = {}) {
  const element = freedraw(`${statement.id}:stroke`, statement.at, statement.points, {
    ...style,
    pressures: statement.pressures,
    simulatePressure: statement.simulatePressure,
  });
  drawing.add(element);
  return element;
}

export function renderSceneVisuals(drawing, visuals) {
  for (const visual of visuals) {
    const start = drawing.elements.length;
    if (visual.type === "container") {
      drawing.add(lane(visual.id, visual.bounds, visual.title, { tone: visual.tone }));
    } else if (visual.type === "frame") {
      drawing.add(frame(visual.id, visual.bounds, visual.title, { locked: visual.locked }));
    } else if (visual.type === "node") {
      renderNode(drawing, visual.node, visual.bounds, visual.style);
    } else if (visual.type === "arrow") {
      drawing.add(arrow(visual.id, visual.start, visual.end, visual.options));
    } else if (visual.type === "text") {
      drawing.add(text(visual.id, visual.position, visual.value, visual.options));
    } else if (visual.type === "code") {
      renderCodeBlock(drawing, visual.block, visual.bounds);
    } else {
      throw new Error(`unsupported scene visual: ${visual.type}`);
    }
    for (const element of drawing.elements.slice(start)) {
      element.frameId = visual.frameId ?? null;
      if (visual.locked) element.locked = true;
    }
  }
}

export function renderImage(drawing, statement) {
  if (!statement.resolvedAsset) throw new Error(`image '${statement.id}' uses unresolved asset '${statement.asset}'`);
  const fit = String(statement.attributes.fit ?? "contain");
  if (!["contain", "cover", "fill"].includes(fit)) throw new Error(`unsupported image fit '${fit}'`);
  let [width, height] = statement.size;
  let [x, y] = statement.at;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error(`image '${statement.id}' requires finite positive dimensions`);
  }
  const naturalWidth = statement.resolvedAsset.width;
  const naturalHeight = statement.resolvedAsset.height;
  let crop = null;
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
  drawing.add(image(statement.id, { x, y, width, height }, statement.resolvedAsset.fileId, {
    crop,
    description: statement.attributes.alt,
    locked: statement.attributes.locked === true,
  }));
}
