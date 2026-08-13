import { Drawing } from "./document.js";
import { BUILTIN_LAYOUT } from "./builtin-layouts.js";
import { LAYERED_LAYOUT } from "./layered-layout.js";
import { heading } from "./components.js";
import { text } from "./elements.js";
import { renderFreedraw, renderFreeText, renderImage, renderSceneVisuals } from "./excalidraw-adapter.js";
import { applyGeometryStatements } from "./geometry.js";
import { renderAnnotation, renderConnection } from "./routing-renderer.js";
import { splitEndpoint } from "./router.js";
import { createSceneGraph, layoutWithAdapter } from "./scene.ts";
import { buildSemanticIR } from "./semantic.js";
import { createMeasurer } from "./measurement.js";
import { createStyleResolver } from "./styles.js";
import { expandDocument } from "./expander.js";
import { createDiagnosticCollector } from "./diagnostics.js";
import { measureTextWidth } from "./text-metrics.js";
import { layoutGap } from "./clearances.js";
import { SECTION_TYPES } from "./layout-items.js";
import { prepareDocumentSyntaxHighlighting } from "./syntax-highlighter.js";

const FREEDRAW_TYPES = new Set(["freedraw"]);
const IMAGE_TYPES = new Set(["image", "icon"]);
const TEXT_TYPES = new Set(["text"]);

function containsAnnotations(statements) {
  return statements.some((item) => item.type === "callout" || (item.type === "note" && item.target)
    || (item.statements && containsAnnotations(item.statements)));
}

function collectDetachedStatements(statements, acceptedTypes, result = [], frameId = null, locked = false) {
  for (const statement of statements) {
    if (acceptedTypes.has(statement.type)) result.push({ statement, frameId, locked });
    const childFrame = statement.type === "frame" ? statement.id : frameId;
    const childLocked = locked || (statement.type === "frame" && statement.attributes?.locked === true);
    if (statement.statements) {
      collectDetachedStatements(statement.statements, acceptedTypes, result, childFrame, childLocked);
    }
  }
  return result;
}

function registerBounds(state, id, bounds) {
  if (state.bounds.has(id)) throw new Error(`duplicate semantic id: ${id}`);
  state.place(id, bounds);
}

function renderDetached(drawing, items, render) {
  items.forEach(({ statement, frameId, locked }) => {
    const start = drawing.elements.length;
    render(statement);
    for (const element of drawing.elements.slice(start)) {
      element.frameId = frameId;
      if (locked) element.locked = true;
    }
  });
}

export function compile(document, options = {}) {
  const files = document.assetFiles ?? {};
  const scene = document.type === "semantic-document" ? document : buildSemanticIR(expandDocument(document));
  const diagnostics = createDiagnosticCollector();
  const drawing = new Drawing({
    backgroundColor: "#eef2f7",
    files,
    diagnostics: diagnostics.diagnostics,
    syntaxHighlighting: options.syntaxHighlighting,
  });
  const documentLayout = scene.statements.find((item) => item.type === "layout");
  if (documentLayout && !["compact", "grid", "layered"].includes(documentLayout.kind)) throw new Error(`unsupported document layout: ${documentLayout.kind}`);
  if (documentLayout?.columns !== undefined && documentLayout.kind !== "grid") throw new Error("layout columns is supported only by document grid layout");
  const annotationGutterWidth = containsAnnotations(scene.statements) ? 250 : 0;
  const gridColumns = documentLayout?.kind === "grid" ? documentLayout.columns ?? 2 : undefined;
  const gridGap = layoutGap(documentLayout, 24);
  const inferredDiagramWidth = documentLayout?.kind === "grid"
    ? Math.max(1900, 140 + gridColumns * 680 + (gridColumns - 1) * gridGap + annotationGutterWidth)
    : documentLayout?.kind === "layered" ? 1900
      : documentLayout?.kind === "compact" ? 1240 : 1120;
  const diagramWidth = documentLayout?.width ?? inferredDiagramWidth;
  const contentWidth = diagramWidth - annotationGutterWidth;
  const sectionGap = layoutGap(documentLayout, documentLayout?.kind === "compact" ? 22 : 35);
  const styles = createStyleResolver(scene);
  styles.diagnostics = diagnostics;
  const measurer = createMeasurer(styles);
  const state = createSceneGraph(scene, { diagramWidth, contentWidth, annotationGutterWidth, measurer, styles, diagnostics });
  let y = 42;
  if (scene.title) {
    drawing.add(heading("document:title", { x: 70, y }, scene.title, { fontSize: 32 }));
    y += 52;
  }
  const subtitle = scene.statements.find((item) => item.type === "subtitle");
  if (subtitle) {
    drawing.add(text("document:subtitle", { x: 72, y }, subtitle.value, { fontSize: 17, strokeColor: "#64748b" }));
    y += 50;
  }

  const adapter = documentLayout?.kind === "layered" ? LAYERED_LAYOUT : BUILTIN_LAYOUT;
  const containers = scene.statements.filter((item) => SECTION_TYPES.has(item.type));
  const loose = scene.statements.filter((item) => item.type === "node");
  const topLevelConnections = scene.statements.filter((item) => item.type === "connection");
  const looseIds = new Set(loose.map((item) => item.id));
  const looseConnections = topLevelConnections.filter((connection) => connection.nodes.every((endpoint) => (
    looseIds.has(splitEndpoint(endpoint, looseIds).id)
  )));
  const syntheticConnections = adapter === LAYERED_LAYOUT ? [] : looseConnections;
  if (adapter === LAYERED_LAYOUT) containers.push(...loose);
  else if (loose.length) containers.unshift({
    type: "lane",
    id: "diagram",
    title: "",
    statements: [...loose, ...syntheticConnections],
  });
  const layoutResult = layoutWithAdapter(
    adapter,
    { state, registerBounds },
    containers,
    {
      columnGap: layoutGap(documentLayout, 24),
      columns: gridColumns,
      contentWidth,
      gap: sectionGap,
      kind: documentLayout?.kind,
      startY: y,
      x: 70,
    },
  );
  y = layoutResult.bottom;
  renderSceneVisuals(drawing, state.visuals);
  state.connections.push(...topLevelConnections.filter((item) => !syntheticConnections.includes(item)));
  state.annotations.push(...scene.statements.filter((item) => ["note", "callout"].includes(item.type)));
  collectDetachedStatements(scene.statements, FREEDRAW_TYPES).forEach(({ statement, frameId, locked }) => {
    const element = renderFreedraw(drawing, statement, styles.resolveFreedraw(statement));
    element.frameId = frameId;
    if (locked) element.locked = true;
    registerBounds(state, statement.id, {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    });
  });
  applyGeometryStatements(drawing, state, scene.statements);
  renderDetached(
    drawing,
    collectDetachedStatements(scene.statements, TEXT_TYPES),
    (statement) => renderFreeText(drawing, statement, styles.resolveText(statement)),
  );
  renderDetached(
    drawing,
    collectDetachedStatements(scene.statements, IMAGE_TYPES),
    (statement) => renderImage(drawing, statement),
  );
  const annotationIds = new Set(state.annotations.map((annotation) => annotation.id));
  const referencedAnnotations = new Set(state.connections.flatMap((connection) => (
    connection.nodes
      .map((endpoint) => splitEndpoint(endpoint, annotationIds).id)
      .filter((id) => annotationIds.has(id))
  )));
  state.annotations.forEach((annotation, index) => {
    if (referencedAnnotations.has(annotation.id)) {
      renderAnnotation(drawing, state, annotation, index, registerBounds);
    }
  });
  state.connections.forEach((connection, index) => renderConnection(drawing, state, connection, index));
  state.annotations.forEach((annotation, index) => {
    if (!referencedAnnotations.has(annotation.id)) {
      renderAnnotation(drawing, state, annotation, index, registerBounds);
    }
  });
  for (const element of drawing.elements.filter((item) => item.type === "text" && item.autoResize === false)) {
    const measured = Math.max(...String(element.text).split("\n").map((line) => (
      measureTextWidth(line, element.fontSize, element.fontFamily)
    )), 0);
    if (measured > element.width + 1) {
      diagnostics.warn("XD2004", `text '${element.id}' exceeds its ${Math.round(element.width)}px content width`, null);
    }
  }
  return drawing;
}

export async function compileAsync(document) {
  await prepareDocumentSyntaxHighlighting(document);
  return compile(document, { syntaxHighlighting: true });
}
