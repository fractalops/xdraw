import { Drawing } from "../excalidraw/document.ts";
import { mergeEmbeddedAssetFiles } from "../io/assets.ts";
import { BUILTIN_LAYOUT } from "../layout/builtin.ts";
import { LAYERED_LAYOUT } from "../layout/layered.ts";
import { heading } from "../excalidraw/components.ts";
import { text } from "../excalidraw/elements.ts";
import {
  renderableFreedraw,
  renderFreedraw,
  renderFreeText,
  renderImage,
  renderSceneVisuals,
} from "../excalidraw/adapter.ts";
import { applyGeometryStatements } from "./geometry-pass.ts";
import { resolveGeometryReferences } from "./geometry-references.ts";
import { renderAnnotation, renderConnection } from "../routing/renderer.ts";
import { splitEndpoint } from "../routing/endpoints.ts";
import { createSceneGraph, layoutWithAdapter } from "./scene.ts";
import { createMeasurer } from "./measurement.ts";
import { createStyleResolver } from "./styles.ts";
import { createDiagnosticCollector } from "../io/diagnostics.ts";
import { measureTextWidth } from "../text/metrics.ts";
import { layoutGap } from "../routing/clearances.ts";
import { SECTION_TYPES } from "../layout/sections.ts";
import { validateArchitectureUsage } from "../nodes/architecture.ts";
import type {
  AssetUseStatement,
  FreedrawStatement,
  NoteStatement,
  SemanticDocument,
  SemanticStatement,
  TextStatement,
} from "../contracts/semantic.ts";
import type { Bounds, Point } from "../contracts/foundation.ts";
import type { SceneGraph } from "../contracts/layout.ts";
import type {
  DrawingElement,
  TextElement,
} from "../contracts/render.ts";
import type { FontFamily } from "../text/metrics.ts";
import type { FormulaPreparation } from "../nodes/math/formula.ts";

interface RenderOptions {
  syntaxHighlighting?: boolean;
}

interface DetachedStatement<T extends SemanticStatement = SemanticStatement> {
  statement: T;
  frameId: string | null;
  locked: boolean;
}

type FixedTextElement = TextElement & {
  text: string;
  fontSize: number;
  fontFamily: FontFamily;
  autoResize: false;
};

function isFreedraw(statement: SemanticStatement): statement is FreedrawStatement {
  return statement.type === "freedraw";
}

function isText(statement: SemanticStatement): statement is TextStatement {
  return statement.type === "text";
}

function isImage(statement: SemanticStatement): statement is AssetUseStatement {
  return statement.type === "image" || statement.type === "icon";
}

function isNote(statement: SemanticStatement): statement is NoteStatement {
  return statement.type === "note" || statement.type === "callout";
}

function isFixedTextElement(element: DrawingElement): element is FixedTextElement {
  return element.type === "text"
    && element.autoResize === false
    && typeof element.text === "string"
    && typeof element.fontSize === "number"
    && (element.fontFamily === 1
      || element.fontFamily === 2
      || element.fontFamily === 3
      || element.fontFamily === 7);
}

function containsAnnotations(statements: readonly SemanticStatement[]): boolean {
  return statements.some((item) => item.type === "callout" || (item.type === "note" && item.target)
    || (item.statements && containsAnnotations(item.statements)));
}

function collectDetachedStatements<T extends SemanticStatement>(
  statements: readonly SemanticStatement[],
  accepts: (statement: SemanticStatement) => statement is T,
  result: DetachedStatement<T>[] = [],
  frameId: string | null = null,
  locked = false,
): DetachedStatement<T>[] {
  for (const statement of statements) {
    if (accepts(statement)) result.push({ statement, frameId, locked });
    const childFrame = statement.type === "frame" ? statement.id : frameId;
    const childLocked = locked || (statement.type === "frame" && statement.attributes?.locked === true);
    if (statement.statements) {
      collectDetachedStatements(statement.statements, accepts, result, childFrame, childLocked);
    }
  }
  return result;
}

function registerBounds(state: SceneGraph, id: string, bounds: Bounds): void {
  if (state.bounds.has(id)) throw new Error(`duplicate semantic id: ${id}`);
  state.place(id, bounds);
}

function renderDetached<T extends SemanticStatement>(
  drawing: Drawing,
  items: readonly DetachedStatement<T>[],
  render: (statement: T) => void,
): void {
  items.forEach(({ statement, frameId, locked }) => {
    const start = drawing.elements.length;
    render(statement);
    for (const element of drawing.elements.slice(start)) {
      element.frameId = frameId;
      if (locked) element.locked = true;
    }
  });
}


/**
 * Row layout tops-aligns its children, so siblings of differing height end up
 * with their centres at different y. Any connector between them slopes, which
 * reads as a mistake and has no other signal.
 */
function warnAboutCrookedConnectors(
  state: SceneGraph,
  diagnostics: ReturnType<typeof createDiagnosticCollector>,
): void {
  const ids = new Set(state.bounds.keys());
  for (const connection of state.connections) {
    const endpoints = connection.nodes.map((endpoint) => splitEndpoint(endpoint, ids).id);
    for (let index = 0; index < endpoints.length - 1; index += 1) {
      const from = state.bounds.get(endpoints[index]);
      const to = state.bounds.get(endpoints[index + 1]);
      if (!from || !to) continue;
      // Only when the author asked for a side-to-side connector. Without
      // explicit sides the router is free to curve, and a sloped connector
      // between boxes of different size is an ordinary composition.
      const leaving = splitEndpoint(connection.nodes[index], ids).side;
      const entering = splitEndpoint(connection.nodes[index + 1], ids).side;
      const horizontal = (leaving === "right" || leaving === "left")
        && (entering === "right" || entering === "left");
      if (!horizontal) continue;
      const topAligned = Math.abs(from.y - to.y) <= 1;
      const differentHeight = Math.abs(from.height - to.height) > 1;
      if (!topAligned || !differentHeight) continue;
      diagnostics.warn(
        "XD2006",
        `'${endpoints[index]}' and '${endpoints[index + 1]}' share a row but differ in height,`
          + ` so their connector will not be level; match-size`
          + ` (${endpoints[index]}, ${endpoints[index + 1]}) height levels them`,
        connection,
      );
    }
  }
}

export function renderCompilation(
  scene: SemanticDocument,
  options: RenderOptions = {},
  preparedLayeredBounds: ReadonlyMap<string, Bounds> | null = null,
  formulaPreparation?: FormulaPreparation,
): Drawing {
  const files = mergeEmbeddedAssetFiles([scene.assetFiles ?? {}, formulaPreparation?.files ?? {}]);
  const diagnostics = createDiagnosticCollector();
  const drawing = new Drawing({
    backgroundColor: "#eef2f7",
    files,
    diagnostics: diagnostics.diagnostics,
    syntaxHighlighting: options.syntaxHighlighting,
  });
  validateArchitectureUsage(scene, diagnostics);
  const documentLayout = scene.statements.find((item) => item.type === "layout");
  if (documentLayout && !["compact", "grid", "layered"].includes(documentLayout.kind)) throw new Error(`unsupported document layout: ${documentLayout.kind}`);
  if (documentLayout?.columns !== undefined && documentLayout.kind !== "grid") throw new Error("layout columns is supported only by document grid layout");
  const annotationGutterWidth = containsAnnotations(scene.statements) ? 250 : 0;
  const gridColumns = documentLayout?.kind === "grid" ? documentLayout.columns ?? 2 : undefined;
  const widthColumns = gridColumns ?? 2;
  const gridGap = layoutGap(documentLayout, 24);
  const inferredDiagramWidth = documentLayout?.kind === "grid"
    ? Math.max(1900, 140 + widthColumns * 680 + (widthColumns - 1) * gridGap + annotationGutterWidth)
    : documentLayout?.kind === "layered" ? 1900
      : documentLayout?.kind === "compact" ? 1240 : 1120;
  const diagramWidth = documentLayout?.width ?? inferredDiagramWidth;
  const contentWidth = diagramWidth - annotationGutterWidth;
  const sectionGap = layoutGap(documentLayout, documentLayout?.kind === "compact" ? 22 : 35);
  const styles = createStyleResolver(scene);
  styles.diagnostics = diagnostics;
  const measurer = createMeasurer(styles, formulaPreparation);
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
    attributes: {},
    statements: [...loose, ...syntheticConnections],
  });
  const layoutResult = layoutWithAdapter(
    adapter,
    { state, registerBounds, preparedLayeredBounds: preparedLayeredBounds ?? undefined },
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
  state.annotations.push(...scene.statements.filter(isNote));
  // Text and freehand are drawn where they are told and take no part in layout,
  // so an `at` that names another element's geometry can be resolved here,
  // against the boxes layout has just produced, without moving them.
  // A stroke's points are relative to its own origin, so they are offered in
  // absolute coordinates — the same space every other geometry name uses.
  const strokes = new Map<string, readonly Point[]>();
  collectDetachedStatements(scene.statements, isFreedraw).forEach(({ statement }) => {
    strokes.set(statement.id, statement.points.map(([x, y]) => [
      statement.at[0] + x,
      statement.at[1] + y,
    ] as Point));
  });
  resolveGeometryReferences(scene.statements, state.bounds, strokes);
  collectDetachedStatements(scene.statements, isFreedraw).forEach(({ statement, frameId, locked }) => {
    const element = renderFreedraw(drawing, renderableFreedraw(statement), styles.resolveFreedraw(statement));
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
    collectDetachedStatements(scene.statements, isText),
    (statement) => renderFreeText(drawing, statement, styles.resolveText(statement)),
  );
  renderDetached(
    drawing,
    collectDetachedStatements(scene.statements, isImage),
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
  warnAboutCrookedConnectors(state, diagnostics);
  state.connections.forEach((connection, index) => renderConnection(drawing, state, connection, index));
  state.annotations.forEach((annotation, index) => {
    if (!referencedAnnotations.has(annotation.id)) {
      renderAnnotation(drawing, state, annotation, index, registerBounds);
    }
  });
  for (const element of drawing.elements.filter(isFixedTextElement)) {
    const measured = Math.max(...String(element.text).split("\n").map((line) => (
      measureTextWidth(line, element.fontSize, element.fontFamily)
    )), 0);
    if (measured > element.width + 1) {
      diagnostics.warn("XD2004", `text '${element.id}' exceeds its ${Math.round(element.width)}px content width`, null);
    }
  }
  return drawing;
}
