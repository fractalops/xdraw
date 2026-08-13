import type {
  BodyStatement,
  NodeStatement,
  PropertyStatement,
  SemanticDocument,
  SemanticStatement,
} from "./semantic-contracts.ts";
import type { Bounds, DiagnosticCollector, Point } from "./foundation-contracts.ts";
import type { ResolvedNodeStyle } from "./layout-contracts.ts";
import type {
  BaseElementOptions,
  DrawingElement,
  FillStyle,
  StrokeStyle,
} from "./render-contracts.ts";
import type { FontFamily } from "./text-metrics.ts";

import { fitTextSize, tone } from "./components.ts";
import type { ToneName } from "./components.ts";
import { arrow, ellipse, frame, rectangle, text } from "./elements.ts";
import { wrapTextToWidth } from "./text-metrics.ts";

const ARCHITECTURE_KINDS = new Set([
  "architecture-person",
  "architecture-system",
  "architecture-external-system",
  "architecture-container",
  "architecture-component",
  "architecture-database",
  "architecture-queue",
]);

const ARCHITECTURE_BOUNDARY_KINDS = new Set([
  "architecture-system-boundary",
  "architecture-container-boundary",
  "architecture-deployment-node",
  "architecture-group",
]);

const ARCHITECTURE_RUNTIME_KINDS = new Set([
  "architecture-container",
  "architecture-database",
  "architecture-queue",
]);

const ARCHITECTURE_TECHNOLOGY_KINDS = new Set([
  ...ARCHITECTURE_RUNTIME_KINDS,
  "architecture-component",
]);

interface ArchitectureStyle {
  strokeColor: string;
  backgroundColor: string;
  textColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  fillStyle?: FillStyle;
  roughness?: number;
  opacity?: number;
  fontFamily: FontFamily;
  titleSize: number;
  bodySize: number;
  lineHeight: number;
  titleLineHeight: number;
  locked: boolean;
  link?: string | null;
}

type ArchitectureStyleInput = Readonly<Partial<ResolvedNodeStyle>>;

function stringValue(style: ArchitectureStyleInput, name: keyof ResolvedNodeStyle, fallback: string): string {
  return typeof style[name] === "string" ? style[name] : fallback;
}

function numberValue(style: ArchitectureStyleInput, name: keyof ResolvedNodeStyle, fallback: number): number {
  return typeof style[name] === "number" ? style[name] : fallback;
}

function strokeStyleValue(style: ArchitectureStyleInput): StrokeStyle {
  const value = style.strokeStyle;
  return value === "dashed" || value === "dotted" || value === "solid" ? value : "solid";
}

function fillStyleValue(style: ArchitectureStyleInput): FillStyle | undefined {
  const value = style.fillStyle;
  return value === "hachure" || value === "cross-hatch" || value === "solid" ? value : undefined;
}

function architectureStyle(style: ArchitectureStyleInput): ArchitectureStyle {
  const family = style.fontFamily;
  return {
    strokeColor: stringValue(style, "strokeColor", "#2563eb"),
    backgroundColor: stringValue(style, "backgroundColor", "#dbeafe"),
    textColor: stringValue(style, "textColor", "#1e3a8a"),
    strokeWidth: numberValue(style, "strokeWidth", 2),
    strokeStyle: strokeStyleValue(style),
    fillStyle: fillStyleValue(style),
    roughness: typeof style.roughness === "number" ? style.roughness : undefined,
    opacity: typeof style.opacity === "number" ? style.opacity : undefined,
    fontFamily: family === 1 || family === 2 || family === 3 || family === 7 ? family : 3,
    titleSize: numberValue(style, "titleSize", 19),
    bodySize: numberValue(style, "bodySize", 16),
    lineHeight: numberValue(style, "lineHeight", 1.28),
    titleLineHeight: numberValue(style, "titleLineHeight", 1.25),
    locked: style.locked === true,
    link: typeof style.link === "string" ? style.link : null,
  };
}

function bodyOf(node: NodeStatement): string | undefined {
  const body = node.statements.find((item): item is BodyStatement => item.type === "body")?.value;
  return typeof body === "string" ? body : undefined;
}

function propertyOf(node: NodeStatement, key: string): unknown {
  return node.statements.find(
    (item): item is PropertyStatement => item.type === "property" && item.key === key,
  )?.value;
}

export function architectureTechnology(node: NodeStatement): string | undefined {
  const value = propertyOf(node, "technology");
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function roleLine(node: NodeStatement, role: string): string {
  const technology = architectureTechnology(node);
  return `[${technology ? `${role} | ${technology}` : role}]`;
}

function frameOptions(
  style: ArchitectureStyle,
  groupIds: string[],
  overrides: BaseElementOptions = {},
): BaseElementOptions {
  return {
    strokeColor: style.strokeColor,
    backgroundColor: style.backgroundColor,
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    fillStyle: style.fillStyle,
    roughness: style.roughness,
    opacity: style.opacity,
    link: style.link,
    locked: style.locked,
    groupIds,
    ...overrides,
  };
}

function line(
  id: string,
  start: Point,
  end: Point,
  style: ArchitectureStyle,
  groupIds: string[],
): DrawingElement {
  return arrow(id, start, end, {
    type: "line",
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
    roughness: style.roughness,
    opacity: style.opacity,
    locked: style.locked,
    groupIds,
  });
}

function cardLabels(
  node: NodeStatement,
  bounds: Bounds,
  style: ArchitectureStyle,
  groupIds: string[],
  tag: string,
  leftInset = 18,
): DrawingElement[] {
  const contentWidth = Math.max(40, bounds.width - leftInset - 18);
  const titleSize = fitTextSize(node.title, contentWidth, style.titleSize, 12, style.fontFamily);
  const title = wrapTextToWidth(node.title, contentWidth, titleSize, style.fontFamily);
  const titleHeight = title.split("\n").length * titleSize * style.titleLineHeight;
  const body = bodyOf(node);
  const titleY = bounds.y + 16;
  const roleY = titleY + titleHeight + 4;
  const role = roleLine(node, tag);
  const roleSize = fitTextSize(
    role,
    contentWidth,
    Math.max(11, Math.min(13, style.bodySize - 3)),
    9,
    style.fontFamily,
  );
  const roleText = wrapTextToWidth(role, contentWidth, roleSize, style.fontFamily);
  const roleHeight = roleText.split("\n").length * roleSize * 1.25;
  const bodyY = roleY + roleHeight + 9;
  const elements = [
    text(`${node.id}:title`, { x: bounds.x + leftInset, y: titleY }, title, {
      fontSize: titleSize,
      fontFamily: style.fontFamily,
      lineHeight: style.titleLineHeight,
      strokeColor: style.textColor,
      width: contentWidth,
      autoResize: false,
      groupIds,
      locked: style.locked,
    }),
    text(`${node.id}:kind`, { x: bounds.x + leftInset, y: roleY }, roleText, {
      fontSize: roleSize,
      fontFamily: style.fontFamily,
      strokeColor: style.strokeColor,
      width: contentWidth,
      autoResize: false,
      groupIds,
      locked: style.locked,
    }),
  ];
  if (body) {
    const bodyText = wrapTextToWidth(body, contentWidth, style.bodySize, style.fontFamily);
    elements.push(text(`${node.id}:body`, {
      x: bounds.x + leftInset,
      y: bodyY,
    }, bodyText, {
      fontSize: style.bodySize,
      fontFamily: style.fontFamily,
      lineHeight: style.lineHeight,
      strokeColor: style.textColor,
      width: contentWidth,
      autoResize: false,
      groupIds,
      locked: style.locked,
    }));
  }
  return elements;
}

function renderCardNode(
  node: NodeStatement,
  bounds: Bounds,
  style: ArchitectureStyle,
  tag: string,
  leftInset = 18,
): DrawingElement[] {
  const groupIds = [`${node.id}:group`];
  return [
    rectangle(`${node.id}:frame`, bounds, frameOptions(style, groupIds)),
    ...cardLabels(node, bounds, style, groupIds, tag, leftInset),
  ];
}

function renderPerson(node: NodeStatement, bounds: Bounds, style: ArchitectureStyle): DrawingElement[] {
  const groupIds = [`${node.id}:group`];
  const centerX = bounds.x + bounds.width / 2;
  const headSize = Math.min(34, Math.max(24, bounds.width * 0.16));
  const headY = bounds.y + 16;
  const shoulderY = headY + headSize + 16;
  const hipY = shoulderY + 30;
  const figureWidth = Math.min(70, bounds.width * 0.42);
  const labelY = Math.min(bounds.y + bounds.height - 54, hipY + 34);
  const contentWidth = Math.max(60, bounds.width - 24);
  const titleSize = fitTextSize(node.title, contentWidth, style.titleSize, 12, style.fontFamily);
  const title = wrapTextToWidth(node.title, contentWidth, titleSize, style.fontFamily);
  const titleHeight = title.split("\n").length * titleSize * style.titleLineHeight;
  const elements: DrawingElement[] = [
    rectangle(`${node.id}:frame`, bounds, frameOptions(style, groupIds, {
      backgroundColor: "transparent",
      opacity: 0,
    })),
    ellipse(`${node.id}:head`, {
      x: centerX - headSize / 2,
      y: headY,
      width: headSize,
      height: headSize,
    }, frameOptions(style, groupIds, { backgroundColor: style.backgroundColor })),
    line(`${node.id}:body-line`, [centerX, shoulderY], [centerX, hipY], style, groupIds),
    line(`${node.id}:arms`, [centerX - figureWidth / 2, shoulderY + 8], [centerX + figureWidth / 2, shoulderY + 8], style, groupIds),
    line(`${node.id}:left-leg`, [centerX, hipY], [centerX - figureWidth / 2.5, hipY + 30], style, groupIds),
    line(`${node.id}:right-leg`, [centerX, hipY], [centerX + figureWidth / 2.5, hipY + 30], style, groupIds),
    text(`${node.id}:title`, { x: bounds.x + 12, y: labelY }, title, {
      fontSize: titleSize,
      fontFamily: style.fontFamily,
      lineHeight: style.titleLineHeight,
      strokeColor: style.textColor,
      width: contentWidth,
      textAlign: "center",
      autoResize: false,
      groupIds,
      locked: style.locked,
    }),
    text(`${node.id}:kind`, { x: bounds.x + 12, y: labelY + titleHeight + 3 }, "[Person]", {
      fontSize: 12,
      fontFamily: style.fontFamily,
      strokeColor: style.strokeColor,
      width: contentWidth,
      textAlign: "center",
      autoResize: false,
      groupIds,
      locked: style.locked,
    }),
  ];
  const body = bodyOf(node);
  if (body) elements.push(text(`${node.id}:body`, { x: bounds.x + 12, y: labelY + titleHeight + 23 }, wrapTextToWidth(body, contentWidth, style.bodySize, style.fontFamily), {
    fontSize: style.bodySize,
    fontFamily: style.fontFamily,
    strokeColor: style.textColor,
    width: contentWidth,
    textAlign: "center",
    autoResize: false,
    groupIds,
    locked: style.locked,
  }));
  return elements;
}

function renderDatabase(node: NodeStatement, bounds: Bounds, style: ArchitectureStyle): DrawingElement[] {
  const groupIds = [`${node.id}:group`];
  const inset = 8;
  const lipHeight = Math.min(28, Math.max(18, bounds.height * 0.18));
  const shape = {
    x: bounds.x + inset,
    y: bounds.y + 6,
    width: bounds.width - inset * 2,
    height: bounds.height - 12,
  };
  const visibleOptions = frameOptions(style, groupIds, { roundness: false });
  return [
    rectangle(`${node.id}:frame`, bounds, frameOptions(style, groupIds, {
      backgroundColor: "transparent",
      opacity: 0,
    })),
    ellipse(`${node.id}:bottom`, {
      x: shape.x,
      y: shape.y + shape.height - lipHeight,
      width: shape.width,
      height: lipHeight,
    }, visibleOptions),
    rectangle(`${node.id}:body-shape`, {
      x: shape.x,
      y: shape.y + lipHeight / 2,
      width: shape.width,
      height: shape.height - lipHeight,
    }, visibleOptions),
    ellipse(`${node.id}:top`, {
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: lipHeight,
    }, visibleOptions),
    ...cardLabels(node, {
      x: bounds.x,
      y: bounds.y + lipHeight / 2,
      width: bounds.width,
      height: bounds.height - lipHeight / 2,
    }, style, groupIds, "Container: Data Store", 24),
  ];
}

function renderComponent(node: NodeStatement, bounds: Bounds, style: ArchitectureStyle): DrawingElement[] {
  const groupIds = [`${node.id}:group`];
  const margin = Math.min(16, Math.max(2, bounds.height * 0.1));
  const availableHeight = Math.max(4, bounds.height - margin * 2);
  const tabHeight = Math.min(16, Math.max(2, (availableHeight - 4) / 2));
  const tabGap = Math.max(0, availableHeight - tabHeight * 2);
  const tabWidth = Math.min(25, Math.max(6, bounds.width * 0.12));
  const tabX = bounds.x + Math.min(16, Math.max(2, (bounds.width - tabWidth) * 0.08));
  const leftInset = Math.min(58, Math.max(18, tabX - bounds.x + tabWidth + 12));
  const elements = renderCardNode(node, bounds, style, "Component", leftInset);
  for (const [index, y] of [bounds.y + margin, bounds.y + margin + tabHeight + tabGap].entries()) {
    elements.push(rectangle(`${node.id}:tab-${index + 1}`, {
      x: tabX,
      y,
      width: tabWidth,
      height: tabHeight,
    }, frameOptions(style, groupIds, { backgroundColor: "transparent", roundness: false })));
  }
  return elements;
}

function renderQueue(node: NodeStatement, bounds: Bounds, style: ArchitectureStyle): DrawingElement[] {
  const groupIds = [`${node.id}:group`];
  const margin = Math.min(16, Math.max(2, bounds.height * 0.1));
  const messageWidth = Math.min(36, Math.max(6, bounds.width * 0.16));
  const stepX = Math.min(6, Math.max(0, (bounds.width - margin * 2 - messageWidth) / 2));
  const stepY = Math.min(8, Math.max(0, (bounds.height - margin * 2 - 24) / 2));
  const messageHeight = Math.min(24, Math.max(4, bounds.height - margin * 2 - stepY * 2));
  const leftInset = Math.min(72, Math.max(18, margin + messageWidth + stepX * 2 + 12));
  const elements = renderCardNode(node, bounds, style, "Container: Message Queue", leftInset);
  for (let index = 0; index < 3; index += 1) {
    elements.push(rectangle(`${node.id}:message-${index + 1}`, {
      x: bounds.x + margin + index * stepX,
      y: bounds.y + margin + index * stepY,
      width: messageWidth,
      height: messageHeight,
    }, frameOptions(style, groupIds, { backgroundColor: "transparent" })));
  }
  return elements;
}

export function isArchitectureNodeKind(kind: unknown): kind is string {
  return typeof kind === "string" && ARCHITECTURE_KINDS.has(kind);
}

export function isArchitectureBoundaryKind(kind: unknown): kind is string {
  return typeof kind === "string" && ARCHITECTURE_BOUNDARY_KINDS.has(kind);
}

export function renderArchitectureNode(
  node: NodeStatement,
  bounds: Bounds,
  rawStyle: ArchitectureStyleInput = {},
): DrawingElement[] {
  const style = architectureStyle(rawStyle);
  if (node.kind === "architecture-person") return renderPerson(node, bounds, style);
  if (node.kind === "architecture-database") return renderDatabase(node, bounds, style);
  if (node.kind === "architecture-component") return renderComponent(node, bounds, style);
  if (node.kind === "architecture-queue") return renderQueue(node, bounds, style);
  if (node.kind === "architecture-external-system") {
    return renderCardNode(node, bounds, { ...style, strokeStyle: "dashed" }, "External Software System");
  }
  if (node.kind === "architecture-container") return renderCardNode(node, bounds, style, "Container");
  return renderCardNode(node, bounds, style, "Software System");
}

export function renderArchitectureBoundary(
  id: string,
  bounds: Bounds,
  title: string,
  kind: string,
  toneName: ToneName = "info",
  locked = false,
): DrawingElement {
  const colors = tone(toneName);
  const labels: Record<string, string> = {
    "architecture-system-boundary": "Software System",
    "architecture-container-boundary": "Container",
    "architecture-deployment-node": "Deployment Node",
    "architecture-group": "Group",
  };
  const strokeStyles: Record<string, StrokeStyle> = {
    "architecture-system-boundary": "solid",
    "architecture-container-boundary": "dashed",
    "architecture-deployment-node": "solid",
    "architecture-group": "dotted",
  };
  return frame(id, bounds, `${labels[kind] ?? "Boundary"}: ${title}`, {
    strokeColor: colors.stroke,
    backgroundColor: "transparent",
    strokeWidth: kind === "architecture-deployment-node" ? 3 : 2,
    strokeStyle: strokeStyles[kind] ?? "dashed",
    locked,
  });
}

function collectArchitectureStatements(
  statements: readonly SemanticStatement[],
  nodes: Map<string, NodeStatement>,
  connections: SemanticStatement[],
): void {
  for (const statement of statements) {
    if (statement.type === "node" && isArchitectureNodeKind(statement.kind)) nodes.set(statement.id, statement);
    if (statement.type === "connection") connections.push(statement);
    if (statement.statements) collectArchitectureStatements(statement.statements, nodes, connections);
  }
}

function endpointNode(endpoint: string, nodes: ReadonlyMap<string, NodeStatement>): NodeStatement | undefined {
  if (nodes.has(endpoint)) return nodes.get(endpoint);
  const withoutAnchor = endpoint.replace(/\.(?:top|right|bottom|left|center|north|east|south|west)$/u, "");
  return nodes.get(withoutAnchor);
}

export function validateArchitectureUsage(
  document: SemanticDocument,
  diagnostics: DiagnosticCollector,
): void {
  const nodes = new Map<string, NodeStatement>();
  const connections: SemanticStatement[] = [];
  collectArchitectureStatements(document.statements, nodes, connections);
  for (const node of nodes.values()) {
    if (!bodyOf(node)) {
      diagnostics.warn("XD2101", `architecture element '${node.id}' should describe its responsibility`, node);
    }
    if (ARCHITECTURE_TECHNOLOGY_KINDS.has(node.kind) && !architectureTechnology(node)) {
      diagnostics.warn("XD2102", `architecture element '${node.id}' should name its technology`, node);
    }
  }
  for (const statement of connections) {
    if (statement.type !== "connection") continue;
    const pairs = statement.nodes.slice(0, -1).map((endpoint, index) => [
      endpointNode(endpoint, nodes),
      endpointNode(statement.nodes[index + 1], nodes),
    ] as const);
    if (!pairs.some(([from, to]) => from && to)) continue;
    if (!statement.label?.trim()) {
      diagnostics.warn("XD2103", "architecture relationships should describe their direction and intent", statement);
    }
    if (pairs.some(([from, to]) => from && to
      && ARCHITECTURE_RUNTIME_KINDS.has(from.kind)
      && ARCHITECTURE_RUNTIME_KINDS.has(to.kind))
      && !(typeof statement.attributes.technology === "string" && statement.attributes.technology.trim())) {
      diagnostics.warn("XD2104", "relationships between architecture containers should name their technology or protocol", statement);
    }
  }
}
