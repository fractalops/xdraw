import { isSemanticGeometryStatement as isGeometryStatement } from "./geometry-statements.ts";
import { isHighlightLanguage } from "./registry.ts";
import {
  MAX_CODE_LINE_CHARACTERS,
  MAX_CODE_LINES,
  MAX_CODE_SOURCE_CHARACTERS,
  MAX_TEXT_CHARACTERS,
} from "../text/policy.ts";
import {
  hasValidFreedrawPoints,
  hasValidFreedrawPressures,
  isFinitePoint,
  MAX_DOCUMENT_FREEDRAW_POINTS,
  MAX_FREEDRAW_COORDINATE,
  MAX_FREEDRAW_POINTS,
} from "../excalidraw/freedraw-policy.ts";
import { validateTableNode } from "../nodes/table.ts";
import { validateCartesianNode } from "../nodes/cartesian.ts";
import {
  analyzeRelativeCoordinate,
  analyzeRelativePoint,
  RelativePositionError,
  type LinearGeometryExpression,
} from "./relative-position.ts";
import {
  type ExpressionNode,
  expressionPathReferences,
  freeNames,
  inferExpressionKind,
  parseExpression,
} from "./expression.ts";
import { ANCHORS, splitAnchorName, splitGeometryName } from "./geometry-names.ts";
import type {
  ConnectionStatement,
  DecisionBranchStatement,
  DiagramDocument,
  GeometryStatement,
  SemanticDocument,
  SemanticReference,
  SemanticStatement,
  StyleStatement,
  ThemeStatement,
} from "../contracts/semantic.ts";
import type {
  Diagnostic,
  DiagnosticNode,
  DeferredPoint,
  Point,
  SourceLocation,
  SourceSpan,
} from "../contracts/foundation.ts";

const PORTS = new Set([
  "north", "south", "east", "west", "top", "bottom", "left", "right", "center",
]);

const DEFINITIONS = new Set<SemanticStatement["type"]>([
  "lane", "group", "frame", "section", "tree", "branch", "leaf", "participant", "note", "callout", "node", "text", "layout-text", "code", "image", "icon", "freedraw", "plot",
]);
const SPACING = new Set(["tight", "normal", "airy"]);
const ALIGNMENT_MODES = new Set(["left", "center-x", "right", "top", "center-y", "bottom"]);
const DISTRIBUTION_AXES = new Set(["x", "y"]);
const CODE_GEOMETRY_OPERATIONS = new Set<GeometryStatement["type"]>(["alignment", "distribution", "offset", "snap"]);
const FREEDRAW_GEOMETRY_OPERATIONS = new Set<GeometryStatement["type"]>(["alignment", "distribution", "offset", "rotation", "snap"]);
const PLACED_BOX_TYPES = new Set<SemanticStatement["type"]>([
  "node", "participant", "branch", "leaf", "code", "lane", "group", "frame", "section", "sequence", "tree",
]);

type SemanticContext = "document" | "sequence" | "container" | "table" | "plane" | "tree";

interface ValidationReference {
  id?: string;
  endpoint?: string;
  node: SemanticStatement;
  kind: string;
  operation?: GeometryStatement["type"];
}

interface SemanticIndex {
  objects: Map<string, SemanticDocument | SemanticStatement>;
  origins: Map<string, SourceSpan | null>;
  references: SemanticReference[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Why a background cannot paint this stroke, or nothing when it can.
 *
 * Excalidraw fills a freehand shape only when its ends meet, within the 8px it
 * treats as closed, and leaves it hollow otherwise. A fill on an open curve
 * therefore does nothing in the editor and nothing in a local preview, so it is
 * better refused than accepted and ignored.
 */
function openStrokeFill(background: unknown, points: readonly Point[] | undefined): string | null {
  if (typeof background !== "string" || background === "transparent") return null;
  if (!points || points.length < 2) return null;
  const [firstX, firstY] = points[0];
  const [lastX, lastY] = points[points.length - 1];
  const gap = Math.hypot(lastX - firstX, lastY - firstY);
  if (gap <= 8) return null;
  return `background needs a closed stroke, and this one's ends are ${gap.toFixed(1)} apart, beyond the 8 that count as closed`;
}

function isDecisionBranch(statement: SemanticStatement): statement is DecisionBranchStatement {
  return statement.type === "decision-branch";
}

function endpointId(
  value: string,
  definitions?: ReadonlyMap<string, SemanticDocument | SemanticStatement>,
): string {
  if (definitions?.has(value)) return value;
  const segments = value.split(".");
  const port = segments.at(-1);
  return port && PORTS.has(port) ? segments.slice(0, -1).join(".") : value;
}

function locationOf(node?: DiagnosticNode): SourceLocation | null {
  const location = node?.span?.start;
  return location ? { ...location, file: node.sourceFile } : null;
}

export class DiagnosticError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    const lines = diagnostics.map((item) => {
      const location = item.location
        ? ` at ${item.location.file ? `${item.location.file}:` : ""}${item.location.line}:${item.location.column}`
        : "";
      return `${item.code}: ${item.message}${location}`;
    });
    super(lines.join("\n"));
    this.name = "XDrawDiagnosticError";
    this.diagnostics = diagnostics;
  }
}

function diagnostic(code: string, message: string, node?: DiagnosticNode): Diagnostic {
  return { code, severity: "error", message, location: locationOf(node) };
}

function cloneNode<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneNode) as T;
  if (!isRecord(value)) return value;
  const result = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneNode(item)]),
  );
  for (const key of ["span", "semanticId", "expansion", "sourceFile", "assetFiles"] as const) {
    if (value[key] !== undefined) {
      Object.defineProperty(result, key, { value: value[key], enumerable: false });
    }
  }
  return result as T;
}

function lowerDecisionBranches(statements: SemanticStatement[]): SemanticStatement[] {
  const result: SemanticStatement[] = [];
  for (const statement of statements) {
    if (statement.statements) statement.statements = lowerDecisionBranches(statement.statements);
    result.push(statement);
    if (statement.type === "node" && statement.kind === "decision") {
      const branches = statement.statements.filter(isDecisionBranch);
      if (branches.length) statement.statements = statement.statements.filter((item) => !isDecisionBranch(item));
      for (const branch of branches) {
        const connection: ConnectionStatement = {
          type: "connection",
          nodes: [statement.id, branch.target],
          label: branch.label,
          attributes: {},
        };
        if (branch.span) Object.defineProperty(connection, "span", { value: branch.span, enumerable: false });
        result.push(connection);
      }
    }
  }
  return result;
}

function indexSemanticObjects(document: SemanticDocument): SemanticIndex {
  const objects = new Map<string, SemanticDocument | SemanticStatement>();
  const origins = new Map<string, SourceSpan | null>();
  const references: Omit<SemanticReference, "targetObject">[] = [];

  const visit = (statement: SemanticStatement, path: string): void => {
    const semanticId = statement.type === "style"
      ? `style:${statement.id}`
      : statement.id ?? `${path}:${statement.type}`;
    Object.defineProperties(statement, {
      semanticId: { value: semanticId, enumerable: false },
      origin: { value: statement.span ?? null, enumerable: false },
    });
    objects.set(semanticId, statement);
    origins.set(semanticId, statement.span ?? null);
    if (statement.type === "connection") {
      statement.nodes.forEach((endpoint, index) => references.push({
        source: semanticId,
        target: endpointId(endpoint),
        endpoint,
        index,
      }));
    }
    if ((statement.type === "note" || statement.type === "callout") && statement.target) {
      references.push({ source: semanticId, target: endpointId(statement.target), endpoint: statement.target, index: 0 });
    }
    statement.statements?.forEach((child, index) => visit(child, `${path}/${index}`));
  };

  Object.defineProperties(document, {
    semanticId: { value: "document", enumerable: false },
    origin: { value: document.span ?? null, enumerable: false },
  });
  objects.set("document", document);
  origins.set("document", document.span ?? null);
  document.statements.forEach((statement, index) => visit(statement, `document/${index}`));
  const resolvedReferences = references.map((reference) => ({
    ...reference,
    target: endpointId(reference.endpoint, objects),
    targetObject: objects.get(endpointId(reference.endpoint, objects)),
  }));
  return { objects, origins, references: resolvedReferences };
}

function collectStatements(
  statements: readonly SemanticStatement[],
  visit: (statement: SemanticStatement, context: SemanticContext) => void,
  context: SemanticContext = "document",
): void {
  for (const statement of statements) {
    visit(statement, context);
    const childContext: SemanticContext = statement.type === "sequence"
      ? "sequence"
      : statement.type === "node" && statement.kind === "table"
        ? "table"
      : statement.type === "node" && statement.kind === "cartesian"
        ? "plane"
      : ["lane", "group", "frame", "section"].includes(statement.type)
        ? "container"
        : statement.type === "tree" || statement.type === "branch"
          ? "tree"
          : context;
    if (statement.statements) collectStatements(statement.statements, visit, childContext);
  }
}

type SemanticValidationDocument = DiagnosticNode
  & Pick<DiagramDocument, "statements">
  & { readonly title?: string };

/**
 * Mutable state threaded through the validation rules. Some rules only report;
 * others also accumulate declarations that later passes resolve against.
 */
interface ValidationState {
  readonly diagnostics: Diagnostic[];
  /** Complete declaration index, independent of source order. */
  readonly definitions: Map<string, SemanticStatement>;
  /** Declarations encountered by the ordered duplicate-id rule. */
  readonly seenDefinitions: Map<string, SemanticStatement>;
  readonly references: ValidationReference[];
  readonly styles: Map<string, StyleStatement>;
  readonly relativeReferences: Array<{ owner: SemanticStatement; ownerId: string; target: string }>;
  readonly attachments: Map<string, Extract<SemanticStatement, { type: "attachment" }>>;
  theme: ThemeStatement | undefined;
  freedrawPointCount: number;
}

/**
 * One semantic family. Rules run in array order against every statement, and
 * that order is part of the observable contract: it determines the order of
 * the returned diagnostics. See test/semantic-diagnostics.test.ts.
 *
 * Returning true halts the remaining rules for the current statement. Only
 * the geometry selection rule does this, because a malformed selection makes
 * every later geometry check meaningless.
 */
interface ValidationRule {
  readonly family: string;
  apply(statement: SemanticStatement, context: SemanticContext, state: ValidationState): boolean | void;
}

interface DeferredPositionCarrier {
  type: string;
  id?: string;
  at?: DeferredPoint;
  size?: Point;
}

function recordRelativeReference(
  statement: SemanticStatement,
  carrier: DeferredPositionCarrier,
  element: string,
  state: ValidationState,
): void {
  recordGeometryDependency(statement, carrier.id ?? "?", element, state);
}

function recordGeometryDependency(
  statement: SemanticStatement,
  ownerId: string,
  element: string,
  state: ValidationState,
): void {
  const target = state.definitions.get(element);
  if (!target) {
    state.diagnostics.push(diagnostic(
      "XD1272",
      `node '${ownerId}' relative position references unknown element '${element}'`,
      statement,
    ));
  } else if (!PLACED_BOX_TYPES.has(target.type)) {
    state.diagnostics.push(diagnostic(
      "XD1272",
      `node '${ownerId}' relative position references '${element}', which has no layout box`,
      statement,
    ));
  } else {
    state.relativeReferences.push({ owner: statement, ownerId, target: element });
  }
}

function validateRelativeNodePosition(
  statement: SemanticStatement,
  carrier: DeferredPositionCarrier,
  state: ValidationState,
): void {
  const recorded = new Set<string>();
  try {
    const expressions: readonly LinearGeometryExpression[] = typeof carrier.at === "string"
      ? Object.values(analyzeRelativePoint(carrier.at))
      : (carrier.at ?? []).filter((coordinate): coordinate is string => typeof coordinate === "string")
        .map((coordinate) => analyzeRelativeCoordinate(coordinate));
    for (const expression of expressions) {
      for (const reference of expression.terms) {
        if (recorded.has(reference.element)) continue;
        recorded.add(reference.element);
        recordRelativeReference(statement, carrier, reference.element, state);
      }
    }
  } catch (error) {
    const detail = error instanceof RelativePositionError ? error.message : String(error);
    state.diagnostics.push(diagnostic(
      "XD1272",
      `node '${carrier.id ?? "?"}' relative position is invalid: ${detail}`,
      statement,
    ));
  }
}

function reportUnresolvedPoint(
  statement: SemanticStatement,
  carrier: DeferredPositionCarrier,
  key: "at" | "size",
  state: ValidationState,
): void {
  const value = carrier[key];
  const unresolved = (typeof value === "string" ? [value] : value ?? [])
    .filter((part): part is string => typeof part === "string")
    .map((part) => `'${part}'`)
    .join(" and ");
  state.diagnostics.push(diagnostic(
    "XD1272",
    `${carrier.type} '${carrier.id ?? "?"}' ${key} could not be resolved to numbers: ${unresolved}. `
    + "A name must be bound with 'let'; only nodes, text, plots, and freehand may be placed from another element's geometry",
    statement,
  ));
}

function validateDeferredPosition(statement: SemanticStatement, state: ValidationState): void {
  // Detached positions resolve after layout. A node instead contributes a
  // required relation to the geometry solver's dependency graph.
  const carrier: DeferredPositionCarrier = statement;
  if (["text", "freedraw", "plot"].includes(carrier.type)) return;
  for (const key of ["at", "size"] as const) {
    if (!isPendingPoint(carrier[key])) continue;
    if (carrier.type === "node" && key === "at") validateRelativeNodePosition(statement, carrier, state);
    else reportUnresolvedPoint(statement, carrier, key, state);
  }
}

const VALIDATION_RULES: readonly ValidationRule[] = Object.freeze([
  {
    family: "container-membership",
    apply(statement, context, state) {
      if (context === "sequence" && statement.type !== "participant" && statement.type !== "connection") {
        state.diagnostics.push(diagnostic(
          "XD1240",
          `sequence may contain only participants and messages, not ${statement.type}`,
          statement,
        ));
      }
      if (context === "tree" && statement.type !== "branch" && statement.type !== "leaf") {
        state.diagnostics.push(diagnostic(
          "XD1241",
          `tree may contain only branches and leaves, not ${statement.type}`,
          statement,
        ));
      }
      if (context === "table" && statement.type !== "table-header" && statement.type !== "table-row") {
        state.diagnostics.push(diagnostic(
          "XD1250",
          `table may contain only a header and rows, not ${statement.type}`,
          statement,
        ));
      }
      if ((statement.type === "table-header" || statement.type === "table-row") && context !== "table") {
        state.diagnostics.push(diagnostic("XD1251", `${statement.type} must be declared inside a table`, statement));
      }
      if (context === "plane" && statement.type !== "plot") {
        state.diagnostics.push(diagnostic("XD1287", `coordinate plane may contain only plot series, not ${statement.type}`, statement));
      }
      if (statement.type === "plot" && context !== "plane") {
        state.diagnostics.push(diagnostic("XD1287", "plot series without an at position must be declared inside a coordinate plane", statement));
      }
    },
  },
  {
    family: "cartesian-structure",
    apply(statement, _context, state) {
      if (statement.type === "node" && statement.kind === "cartesian") {
        state.diagnostics.push(...validateCartesianNode(statement).map((issue) => (
          diagnostic(issue.code, issue.message, issue.node)
        )));
      }
    },
  },
  {
    family: "table-structure",
    apply(statement, _context, state) {
      if (statement.type === "node" && statement.kind === "table") {
        state.diagnostics.push(...validateTableNode(statement).map((issue) => (
          diagnostic(issue.code, issue.message, issue.node)
        )));
      }
    },
  },
  {
    family: "sequence-messages",
    apply(statement, _context, state) {
      if (statement.type === "sequence") {
        const participantIds = new Set(
          statement.statements
            .filter((item) => item.type === "participant")
            .map((item) => item.id),
        );
        for (const message of statement.statements.filter((item) => item.type === "connection")) {
          for (const endpoint of message.nodes) {
            const id = endpointId(endpoint, new Map([...participantIds].map((item) => [item, message])));
            if (!participantIds.has(id)) {
              state.diagnostics.push(diagnostic(
                "XD1242",
                `sequence message references a non-participant: ${id}`,
                message,
              ));
            }
          }
        }
      }
    },
  },
  {
    family: "style-declarations",
    apply(statement, context, state) {
      if (statement.type === "style") {
        if (context !== "document") state.diagnostics.push(diagnostic("XD1005", "styles may only be declared at document scope", statement));
        if (state.styles.has(statement.id)) state.diagnostics.push(diagnostic("XD1003", `duplicate style '${statement.id}'`, statement));
        else state.styles.set(statement.id, statement);
      }
    },
  },
  {
    family: "theme-declarations",
    apply(statement, context, state) {
      if (statement.type === "theme") {
        if (context !== "document") state.diagnostics.push(diagnostic("XD1006", "themes may only be declared at document scope", statement));
        if (state.theme) state.diagnostics.push(diagnostic("XD1007", "a document may declare only one theme", statement));
        else state.theme = statement;
      }
    },
  },
  {
    family: "unique-ids",
    apply(statement, _context, state) {
      if (DEFINITIONS.has(statement.type) && statement.id) {
        const previous = state.seenDefinitions.get(statement.id);
        if (previous) {
          state.diagnostics.push(diagnostic(
            "XD1001",
            `duplicate semantic id '${statement.id}' (first declared at ${previous.span?.start?.line ?? "unknown"}:${previous.span?.start?.column ?? "unknown"})`,
            statement,
          ));
        } else {
          state.seenDefinitions.set(statement.id, statement);
        }
      }
    },
  },
  {
    family: "connections",
    apply(statement, _context, state) {
      if (statement.type === "connection") {
        if (statement.nodes.length < 2) {
          state.diagnostics.push(diagnostic("XD1230", "connection requires at least two endpoints", statement));
        }
        const style = statement.attributes.style;
        if (style !== undefined && (typeof style !== "string"
            || !["auto", "straight", "elbow", "curved", "line"].includes(style))) {
          state.diagnostics.push(diagnostic("XD1231", `unsupported connection style '${String(style)}'`, statement));
        }
        const width = statement.attributes.width;
        if (width !== undefined && (typeof width !== "number" || !Number.isFinite(width) || width <= 0)) {
          state.diagnostics.push(diagnostic("XD1232", "connection width must be a positive finite number", statement));
        }
        const head = statement.attributes.head;
        const supportedHeads = new Set([
          "none", "arrow", "bar", "dot", "circle", "circle_outline", "triangle", "triangle_outline",
          "diamond", "diamond_outline", "crowfoot_one", "crowfoot_many", "crowfoot_one_or_many",
        ]);
        if (head !== undefined && (typeof head !== "string" || !supportedHeads.has(head))) {
          state.diagnostics.push(diagnostic("XD1238", `unsupported arrowhead '${String(head)}'`, statement));
        }
        if (statement.attributes.dashed !== undefined && typeof statement.attributes.dashed !== "boolean") {
          state.diagnostics.push(diagnostic("XD1239", "connection dashed must be true or false", statement));
        }
        for (const key of ["start-label", "end-label", "technology"] as const) {
          const value = statement.attributes[key];
          if (value !== undefined && typeof value !== "string") {
            state.diagnostics.push(diagnostic("XD1233", `connection ${key} must be text`, statement));
          }
        }
      }
    },
  },
  {
    family: "connection-references",
    apply(statement, _context, state) {
      if (statement.type !== "connection") return;
      for (const endpoint of statement.nodes) state.references.push({ endpoint, node: statement, kind: "connection" });
      const route = String(statement.attributes?.route ?? "");
      if (route.startsWith("around ")) state.references.push({ id: route.slice(7), node: statement, kind: "route constraint" });
    },
  },
  {
    family: "annotation-targets",
    apply(statement, _context, state) {
      if ((statement.type === "note" || statement.type === "callout") && statement.target) {
        state.references.push({ endpoint: statement.target, node: statement, kind: statement.type });
      }
    },
  },
  {
    family: "geometry-selection",
    // A malformed selection makes every later geometry check meaningless, so
    // this is the one rule that halts the rest for its statement.
    apply(statement, _context, state) {
      if (!isGeometryStatement(statement)) return false;
      if (!Array.isArray(statement.ids) || statement.ids.some((id) => typeof id !== "string")) {
        state.diagnostics.push(diagnostic("XD1105", `${statement.type} requires a node selection`, statement));
        return true;
      }
      for (const id of statement.ids) {
        state.references.push({ id, node: statement, kind: "geometry operation", operation: statement.type });
      }
      if (new Set(statement.ids).size !== statement.ids.length) {
        state.diagnostics.push(diagnostic("XD1101", `${statement.type} contains duplicate node ids`, statement));
      }
      return false;
    },
  },
  {
    family: "geometry-match-size",
    apply(statement, _context, state) {
      if (statement.type === "match-size" && !["width", "height", "both"].includes(statement.axis ?? "")) {
        state.diagnostics.push(diagnostic("XD1102", `unsupported size axis '${statement.axis}'`, statement));
      }
      if (statement.type === "match-size" && statement.ids.length < 2) {
        state.diagnostics.push(diagnostic("XD1103", "match-size requires at least two nodes", statement));
      }
    },
  },
  {
    family: "geometry-alignment",
    apply(statement, _context, state) {
      if (statement.type === "alignment" && !ALIGNMENT_MODES.has(statement.mode ?? "")) {
        state.diagnostics.push(diagnostic("XD1106", `unsupported alignment mode '${statement.mode}'`, statement));
      }
      if (statement.type === "alignment" && statement.ids.length < 2) {
        state.diagnostics.push(diagnostic("XD1107", "alignment requires at least two nodes", statement));
      }
    },
  },
  {
    family: "geometry-distribution",
    apply(statement, _context, state) {
      if (statement.type === "distribution" && !DISTRIBUTION_AXES.has(statement.axis ?? "")) {
        state.diagnostics.push(diagnostic("XD1108", `unsupported distribution axis '${statement.axis}'`, statement));
      }
      if (statement.type === "distribution" && statement.ids.length < 3) {
        state.diagnostics.push(diagnostic("XD1109", "distribution requires at least three nodes", statement));
      }
    },
  },
  {
    family: "geometry-transform",
    apply(statement, _context, state) {
      if (statement.type === "offset" && !isFinitePoint(statement.by)) {
        state.diagnostics.push(diagnostic("XD1110", "offset requires finite x and y values", statement));
      }
      if (statement.type === "rotation" && !(typeof statement.degrees === "number" && Number.isFinite(statement.degrees))) {
        state.diagnostics.push(diagnostic("XD1111", "rotation must be finite", statement));
      }
      if (statement.type === "snap" && !(typeof statement.grid === "number" && Number.isFinite(statement.grid) && statement.grid > 0)) {
        state.diagnostics.push(diagnostic("XD1104", "snap grid must be positive", statement));
      }
    },
  },
  {
    family: "layout",
    apply(statement, context, state) {
      if (statement.type === "layout") {
        const supported = context === "document" ? ["compact", "grid", "layered"] : ["row", "column", "grid"];
        if (!supported.includes(statement.kind)) {
          state.diagnostics.push(diagnostic(
            "XD1201",
            `layout '${statement.kind}' is not supported in ${context}`,
            statement,
          ));
        }
        if (statement.spacing !== undefined && !SPACING.has(statement.spacing)) {
          state.diagnostics.push(diagnostic("XD1206", `unsupported spacing preset '${statement.spacing}'`, statement));
        }
        if (statement.spacing !== undefined && statement.gap !== undefined) {
          state.diagnostics.push(diagnostic("XD1211", "layout may use spacing or gap, not both", statement));
        }
        if (statement.width !== undefined && (!(statement.width > 0) || !Number.isFinite(statement.width))) {
          state.diagnostics.push(diagnostic("XD1213", "layout width must be a positive finite number", statement));
        }
        if (statement.gap !== undefined && (!Number.isFinite(statement.gap) || statement.gap < 0)) {
          state.diagnostics.push(diagnostic("XD1235", "layout gap must be finite and non-negative", statement));
        }
        if (statement.columns !== undefined && (
          !Number.isFinite(statement.columns)
          || !Number.isInteger(statement.columns)
          || statement.columns <= 0
        )) {
          state.diagnostics.push(diagnostic("XD1243", "layout columns must be a positive integer", statement));
        }
      }
    },
  },
  {
    family: "tree-spacing",
    apply(statement, _context, state) {
      if ((statement.type === "tree" || statement.type === "branch" || statement.type === "leaf")) {
        for (const [name, value] of [["level-gap", statement.levelGap], ["sibling-gap", statement.siblingGap]] as const) {
          if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
            state.diagnostics.push(diagnostic("XD1236", `tree ${name} must be finite and non-negative`, statement));
          }
        }
      }
    },
  },
  {
    family: "text-length",
    // Every string here reaches the measurer. Code is excluded because it has
    // its own, larger budget in policy.ts.
    apply(statement, _context, state) {
      if (statement.type === "code") return;
      const tooLong = (field: string, text: unknown): void => {
        if (typeof text === "string" && text.length > MAX_TEXT_CHARACTERS) {
          state.diagnostics.push(diagnostic(
            "XD1245",
            `${statement.type} ${field} exceeds the ${MAX_TEXT_CHARACTERS}-character text limit`,
            statement,
          ));
        }
      };
      for (const field of ["title", "value", "label"] as const) {
        if (field in statement) tooLong(field, Reflect.get(statement, field));
      }
      if ("cells" in statement) {
        const cells: unknown = Reflect.get(statement, "cells");
        if (Array.isArray(cells)) cells.forEach((cell) => tooLong("cell", cell));
      }
    },
  },
  {
    family: "body-content",
    apply(statement, _context, state) {
      if (statement.type === "body" && typeof statement.value !== "string") {
        state.diagnostics.push(diagnostic("XD1237", "body content must be text", statement));
      }
    },
  },
  {
    family: "annotation-anchoring",
    apply(statement, context, state) {
      if (statement.type === "note" && !statement.target && !statement.at && context !== "container") {
        state.diagnostics.push(diagnostic("XD1212", "an unanchored note must be declared inside a lane, group, frame, or section", statement));
      }

      if (statement.type === "callout" && !statement.target && !statement.at) {
        state.diagnostics.push(diagnostic("XD1234", "a callout requires a target or explicit position", statement));
      }
    },
  },
  {
    family: "frame-attributes",
    apply(statement, _context, state) {
      if (statement.type === "frame") {
        const unsupported = Object.keys(statement.attributes ?? {}).filter((key) => key !== "locked");
        if (unsupported.length) state.diagnostics.push(diagnostic("XD1205", `unsupported frame attributes: ${unsupported.join(", ")}`, statement));
        if (statement.attributes?.locked !== undefined && typeof statement.attributes.locked !== "boolean") {
          state.diagnostics.push(diagnostic("XD1207", "frame locked must be a boolean flag", statement));
        }
      }
    },
  },
  {
    family: "asset-attributes",
    apply(statement, _context, state) {
      if (statement.type === "image" || statement.type === "icon") {
        const supported = new Set(["alt", "fit", "locked"]);
        const unsupported = Object.keys(statement.attributes ?? {}).filter((key) => !supported.has(key));
        if (unsupported.length) state.diagnostics.push(diagnostic("XD1208", `unsupported ${statement.type} attributes: ${unsupported.join(", ")}`, statement));
      }
    },
  },
  {
    family: "text",
    apply(statement, _context, state) {
      if (statement.type === "text" && !["left", "center", "right"].includes(statement.align)) {
        state.diagnostics.push(diagnostic("XD1202", `unsupported text alignment '${statement.align}'`, statement));
      }

      if (statement.type === "text" && statement.fontSize !== undefined && !(statement.fontSize > 0)) {
        state.diagnostics.push(diagnostic("XD1203", "font size must be positive", statement));
      }

      if (statement.type === "text" && statement.width !== undefined && !(statement.width > 0)) {
        state.diagnostics.push(diagnostic("XD1204", "text width must be positive", statement));
      }
    },
  },
  {
    family: "code",
    apply(statement, _context, state) {
      if (statement.type === "code") {
        if (typeof statement.value !== "string") {
          state.diagnostics.push(diagnostic("XD1214", "code source must be text", statement));
        }
        if (statement.title !== undefined && typeof statement.title !== "string") {
          state.diagnostics.push(diagnostic("XD1219", "code title must be text", statement));
        }
        if (typeof statement.lineNumbers !== "boolean") {
          state.diagnostics.push(diagnostic("XD1215", "code line-numbers must be true or false", statement));
        }
        if (typeof statement.highlight !== "boolean") {
          state.diagnostics.push(diagnostic("XD1216", "code highlight must be true or false", statement));
        }
        if (statement.highlight === true
            && !isHighlightLanguage(statement.language)) {
          state.diagnostics.push(diagnostic(
            "XD1217",
            "highlighted code language must be sql, typescript, or xdraw",
            statement,
          ));
        }
        if (typeof statement.value === "string") {
          const lines = statement.value.split("\n");
          if (statement.value.length > MAX_CODE_SOURCE_CHARACTERS
              || lines.length > MAX_CODE_LINES
              || lines.some((line) => line.length > MAX_CODE_LINE_CHARACTERS)) {
            state.diagnostics.push(diagnostic("XD1218", "code source exceeds the supported size", statement));
          }
        }
      }
    },
  },
  {
    family: "deferred-position",
    apply(statement, _context, state) {
      validateDeferredPosition(statement, state);
    },
  },
  {
    family: "freedraw",
    apply(statement, _context, state) {
      if (statement.type === "freedraw") {
        const points = statement.points;
        // A pair still written as text names geometry that layout has not
        // produced yet. It is resolved after layout, and reports there if it
        // cannot be; here it is pending rather than malformed.
        if (!isPendingPoint(statement.at) && !isFinitePoint(statement.at)) {
          state.diagnostics.push(diagnostic("XD1220", "freedraw at must be a finite point", statement));
        }
        if (!hasValidFreedrawPoints(points)) {
          state.diagnostics.push(diagnostic("XD1221", "freedraw points must contain at least two finite points", statement));
        } else {
          state.freedrawPointCount += points.length;
          if (points.length > MAX_FREEDRAW_POINTS) {
            state.diagnostics.push(diagnostic("XD1222", `freedraw may contain at most ${MAX_FREEDRAW_POINTS} points`, statement));
          }
          if (points.some((point) => point.some((value) => Math.abs(value) > MAX_FREEDRAW_COORDINATE))) {
            state.diagnostics.push(diagnostic("XD1223", "freedraw coordinates exceed the supported range", statement));
          }
          if (new Set(points.map((point) => `${point[0]},${point[1]}`)).size < 2) {
            state.diagnostics.push(diagnostic("XD1224", "freedraw requires at least two distinct points", statement));
          }
        }
        if (!hasValidFreedrawPressures(statement.pressures, points?.length)) {
          state.diagnostics.push(diagnostic("XD1225", "freedraw pressures must be empty or contain one value from 0 to 1 per point", statement));
        }
        if (typeof statement.simulatePressure !== "boolean") {
          state.diagnostics.push(diagnostic("XD1226", "freedraw simulate-pressure must be true or false", statement));
        }
        const unfillable = openStrokeFill(statement.attributes?.background, points);
        if (unfillable) state.diagnostics.push(diagnostic("XD1228", unfillable, statement));
      }
    },
  },
  {
    family: "node-size",
    apply(statement, _context, state) {
      const hasLabel = (node: SemanticStatement & { title?: unknown; statements?: readonly SemanticStatement[] }): boolean => (
        (typeof node.title === "string" && node.title.length > 0)
        || (node.statements ?? []).some((child) => child.type === "body")
      );
      if (statement.type === "node" && statement.size) {
        const [width, height] = statement.size;
        if (!(width > 0) || !(height > 0)) {
          state.diagnostics.push(diagnostic("XD1209", "node size must use positive dimensions", statement));
        } else if (statement.kind === "decision" && statement.title && (width < 96 || height < 72)) {
          state.diagnostics.push(diagnostic("XD1244", "decision size must be at least 96 by 72", statement));
        } else if (statement.kind !== "junction" && width <= 40 && hasLabel(statement)) {
          // Gated on there being a label for the same reason the height rule
          // below is: the message names one, so it cannot be right when there is
          // none. A 10px unlabelled shape is a seed on a phyllotaxis spiral or a
          // dot in a stipple, and `junction` should not have to be borrowed to
          // draw one.
          state.diagnostics.push(diagnostic("XD1210", "node width must be greater than 40 to contain its label", statement));
        } else if (statement.kind !== "junction" && height <= 40 && hasLabel(statement)) {
          // The width rule's other half. A short node used to fail loudly when
          // its padding could not fit, and now the padding gives way instead, so
          // nothing else would notice that a label is being laid out taller than
          // the box that holds it. Gated on there being a label, because an
          // unlabelled node this short is a tick mark and perfectly legitimate.
          state.diagnostics.push(diagnostic("XD1246", "node height must be greater than 40 to contain its label", statement));
        }
      }
    },
  },
] satisfies readonly ValidationRule[]);

function validateRotatedRelativeReferences(
  statements: readonly SemanticStatement[],
  state: ValidationState,
): void {
  const rotated = new Set<string>();
  collectStatements(statements, (statement) => {
    if (statement.type === "rotation") statement.ids.forEach((id) => rotated.add(id));
  });
  for (const reference of state.relativeReferences) {
    if (!rotated.has(reference.target)) continue;
    state.diagnostics.push(diagnostic(
      "XD1272",
      `node '${reference.ownerId}' relative position cannot read rotated element '${reference.target}'`,
      reference.owner,
    ));
  }
}

function validateAttachmentPaths(
  statement: Extract<SemanticStatement, { type: "attachment" }>,
  expression: ExpressionNode,
  geometryTargets: ReadonlySet<string>,
  attachmentMovers: ReadonlySet<string>,
  state: ValidationState,
): void {
  for (const path of expressionPathReferences(expression)) {
    const target = state.definitions.get(path);
    if (target?.type !== "freedraw") continue;
    state.relativeReferences.push({ owner: statement, ownerId: statement.moving, target: path });
    if (!isFinitePoint(target.at)) {
      state.diagnostics.push(diagnostic(
        "XD1290",
        `attachment cannot read path '${path}' until that path has a fixed numeric position`,
        statement,
      ));
    }
    if (geometryTargets.has(path)) {
      state.diagnostics.push(diagnostic(
        "XD1290",
        `attachment cannot read path '${path}' because a geometry statement moves it`,
        statement,
      ));
    }
    if (attachmentMovers.has(path)) {
      state.diagnostics.push(diagnostic(
        "XD1290",
        `attachment cannot read path '${path}' because another attachment moves it`,
        statement,
      ));
    }
  }
}

function validateAttachmentMover(
  statement: Extract<SemanticStatement, { type: "attachment" }>,
  rotated: ReadonlySet<string>,
  state: ValidationState,
): boolean {
  const moving = state.definitions.get(statement.moving);
  if (!moving) {
    state.diagnostics.push(diagnostic("XD1290", `attachment moves unknown element '${statement.moving}'`, statement));
    return false;
  }
    if (statement.anchor !== "origin" && !(ANCHORS as readonly string[]).includes(statement.anchor)) {
      state.diagnostics.push(diagnostic("XD1290", `attachment anchor '${statement.anchor}' is not valid`, statement));
      return false;
    }
    if (moving.type !== "node" && moving.type !== "freedraw") {
      state.diagnostics.push(diagnostic(
        "XD1290",
        `attachment mover '${statement.moving}' must be a node or path, not ${moving.type}`,
        statement,
      ));
    }
    if (statement.anchor === "origin" && moving.type !== "freedraw") {
      state.diagnostics.push(diagnostic("XD1290", "attachment anchor 'origin' is only defined for paths", statement));
    }
    if (moving.type === "node" && isPendingPoint(moving.at)) {
      state.diagnostics.push(diagnostic(
        "XD1290",
        `node '${statement.moving}' cannot have both a relative at expression and an attachment`,
        statement,
      ));
    }
    if (rotated.has(statement.moving) && statement.anchor !== "center") {
      state.diagnostics.push(diagnostic(
        "XD1290",
        `rotated attachment mover '${statement.moving}' may use only its center anchor`,
        statement,
      ));
    }
    const previous = state.attachments.get(statement.moving);
    if (previous) {
      state.diagnostics.push(diagnostic("XD1290", `element '${statement.moving}' may have only one attachment`, statement));
    } else {
      state.attachments.set(statement.moving, statement);
    }
  return true;
}

function validateAttachment(
  statement: Extract<SemanticStatement, { type: "attachment" }>,
  geometryTargets: ReadonlySet<string>,
  rotated: ReadonlySet<string>,
  attachmentMovers: ReadonlySet<string>,
  state: ValidationState,
): void {
    if (!validateAttachmentMover(statement, rotated, state)) return;

    let expression;
    try {
      expression = parseExpression(statement.target);
    } catch (error) {
      state.diagnostics.push(diagnostic("XD1290", `attachment target is invalid: ${String(error)}`, statement));
      return;
    }
    const type = inferExpressionKind(expression, (name) => {
      if (splitGeometryName(name)) return "number";
      if (splitAnchorName(name)) return "point";
      return state.definitions.get(name)?.type === "freedraw" ? "path" : null;
    });
    if (type.kind !== "point" || type.issues.length) {
      const detail = type.issues.map((issue) => issue.message).join("; ") || `received ${type.kind ?? "an invalid value"}`;
      state.diagnostics.push(diagnostic("XD1290", `attachment target must be a point: ${detail}`, statement));
      return;
    }

    const recordedBoxes = new Set<string>();
    for (const name of freeNames(expression)) {
      const reference = splitGeometryName(name) ?? splitAnchorName(name);
      if (!reference || recordedBoxes.has(reference.element)) continue;
      recordedBoxes.add(reference.element);
      recordGeometryDependency(statement, statement.moving, reference.element, state);
    }
    validateAttachmentPaths(statement, expression, geometryTargets, attachmentMovers, state);
}

function validateAttachments(
  statements: readonly SemanticStatement[],
  state: ValidationState,
): void {
  const geometryTargets = new Set<string>();
  const rotated = new Set<string>();
  const attachmentMovers = new Set<string>();
  collectStatements(statements, (statement) => {
    if (statement.type === "attachment") attachmentMovers.add(statement.moving);
    if (isGeometryStatement(statement) && statement.type !== "layer" && Array.isArray(statement.ids)) {
      statement.ids.forEach((id) => geometryTargets.add(id));
      if (statement.type === "rotation") statement.ids.forEach((id) => rotated.add(id));
    }
  });

  collectStatements(statements, (statement) => {
    if (statement.type === "attachment") {
      validateAttachment(statement, geometryTargets, rotated, attachmentMovers, state);
    }
  });
}

function validateDetachedGeometryExpressions(
  statements: readonly SemanticStatement[],
  state: ValidationState,
): void {
  const geometryTargets = new Set<string>();
  const attachmentMovers = new Set<string>();
  collectStatements(statements, (statement) => {
    if (statement.type === "attachment") attachmentMovers.add(statement.moving);
    if (isGeometryStatement(statement) && statement.type !== "layer" && Array.isArray(statement.ids)) {
      statement.ids.forEach((id) => geometryTargets.add(id));
    }
  });
  const symbolKind = (name: string) => {
    if (splitGeometryName(name)) return "number" as const;
    if (splitAnchorName(name)) return "point" as const;
    return state.definitions.get(name)?.type === "freedraw" ? "path" as const : null;
  };
  collectStatements(statements, (statement) => {
    if (statement.type !== "text" && statement.type !== "freedraw") return;
    if (statement.at === undefined) return;
    const sources = typeof statement.at === "string"
      ? [{ source: statement.at, expected: "point" as const }]
      : Array.isArray(statement.at) ? statement.at.flatMap((value) => (
        typeof value === "string" ? [{ source: value, expected: "number" as const }] : []
      )) : [];
    for (const { source, expected } of sources) {
      let expression;
      try {
        expression = parseExpression(source);
      } catch (error) {
        state.diagnostics.push(diagnostic("XD1291", `${statement.type} '${statement.id}' position is invalid: ${String(error)}`, statement));
        continue;
      }
      const typed = inferExpressionKind(expression, symbolKind);
      if (typed.kind !== expected || typed.issues.length) {
        const detail = typed.issues.map((issue) => issue.message).join("; ") || `expected ${expected}, received ${typed.kind}`;
        state.diagnostics.push(diagnostic("XD1291", `${statement.type} '${statement.id}' position is invalid: ${detail}`, statement));
        continue;
      }
      for (const path of expressionPathReferences(expression)) {
        const target = state.definitions.get(path);
        if (target?.type !== "freedraw") continue;
        if (!isFinitePoint(target.at)) {
          state.diagnostics.push(diagnostic("XD1291", `path '${path}' cannot be read before its position is resolved`, statement));
        }
        if (geometryTargets.has(path)) {
          state.diagnostics.push(diagnostic("XD1291", `path '${path}' cannot be read because a geometry statement moves it`, statement));
        }
        if (attachmentMovers.has(path)) {
          state.diagnostics.push(diagnostic("XD1291", `path '${path}' cannot be read because an attachment moves it`, statement));
        }
      }
    }
  });
}

function validateRelativeReferenceCycles(state: ValidationState): void {
  const graph = new Map<string, Set<string>>();
  const owners = new Map<string, SemanticStatement>();
  for (const reference of state.relativeReferences) {
    const owner = reference.ownerId;
    owners.set(owner, reference.owner);
    const targets = graph.get(owner) ?? new Set<string>();
    targets.add(reference.target);
    graph.set(owner, targets);
  }
  const complete = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const reported = new Set<string>();
  const visit = (id: string): void => {
    if (complete.has(id)) return;
    if (active.has(id)) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      const key = [...new Set(cycle)].sort().join("|");
      if (!reported.has(key)) {
        reported.add(key);
        state.diagnostics.push(diagnostic(
          "XD1272",
          `relative placement cycle: ${cycle.join(" -> ")}`,
          owners.get(stack.at(-1) ?? id) ?? owners.get(id),
        ));
      }
      return;
    }
    active.add(id);
    stack.push(id);
    for (const target of [...(graph.get(id) ?? [])].sort()) {
      if (graph.has(target)) visit(target);
    }
    stack.pop();
    active.delete(id);
    complete.add(id);
  };
  for (const id of [...graph.keys()].sort()) visit(id);
}

export function validateSemanticDocument(document: SemanticValidationDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const definitions = new Map<string, SemanticStatement>();
  collectStatements(document.statements, (statement) => {
    if (DEFINITIONS.has(statement.type) && statement.id && !definitions.has(statement.id)) {
      definitions.set(statement.id, statement);
    }
  });
  const references: ValidationReference[] = [];
  const styles = new Map<string, StyleStatement>();
  const state: ValidationState = {
    diagnostics,
    definitions,
    seenDefinitions: new Map(),
    references,
    styles,
    relativeReferences: [],
    attachments: new Map(),
    theme: undefined,
    freedrawPointCount: 0,
  };

  if (typeof document.title === "string" && document.title.length > MAX_TEXT_CHARACTERS) {
    diagnostics.push(diagnostic(
      "XD1245",
      `diagram title exceeds the ${MAX_TEXT_CHARACTERS}-character text limit`,
      document,
    ));
  }

  collectStatements(document.statements, (statement, context) => {
    for (const rule of VALIDATION_RULES) {
      if (rule.apply(statement, context, state)) return;
    }
  });

  validateAttachments(document.statements, state);
  validateDetachedGeometryExpressions(document.statements, state);
  validateRotatedRelativeReferences(document.statements, state);
  validateRelativeReferenceCycles(state);

  collectStatements(document.statements, (statement) => {
    if (statement.type === "node" || statement.type === "text" || statement.type === "layout-text") {
      const styleName = statement.attributes.style;
      if (typeof styleName === "string" && !styles.has(styleName)) {
        diagnostics.push(diagnostic("XD1004", `unknown style '${styleName}'`, statement));
      }
    }
  });

  for (const reference of references) {
    const id = reference.id ?? endpointId(reference.endpoint ?? "", definitions);
    if (!definitions.has(id)) {
      diagnostics.push(diagnostic(
        "XD1002",
        `${reference.kind} references unknown node: ${id}`,
        reference.node,
      ));
    } else if (reference.kind === "geometry operation") {
      const targetType = definitions.get(id)!.type;
      // Layer order changes which element is drawn on top, and every drawn thing
      // has a place in that order. The restriction below is about what can be
      // *moved*, which is a different question.
      if (reference.operation === "layer") continue;
      const supportedNode = ["node", "participant", "branch", "leaf"].includes(targetType);
      const supportedCode = targetType === "code"
        && reference.operation !== undefined
        && CODE_GEOMETRY_OPERATIONS.has(reference.operation);
      const supportedFreedraw = targetType === "freedraw"
        && reference.operation !== undefined
        && FREEDRAW_GEOMETRY_OPERATIONS.has(reference.operation);
      if (!supportedNode && !supportedCode && !supportedFreedraw) {
        diagnostics.push(diagnostic(
          "XD1105",
          ["code", "freedraw"].includes(targetType)
            ? `${reference.operation} does not support ${targetType} targets`
            : `geometry operations require node or movable code targets; '${id}' is ${targetType}`,
          reference.node,
        ));
      }
    }
  }
  if (state.freedrawPointCount > MAX_DOCUMENT_FREEDRAW_POINTS) {
    diagnostics.push(diagnostic(
      "XD1227",
      `document may contain at most ${MAX_DOCUMENT_FREEDRAW_POINTS} freedraw points`,
      document,
    ));
  }
  return diagnostics;
}

/** A point whose coordinates are expressions awaiting layout. */
function isPendingPoint(value: unknown): boolean {
  return typeof value === "string"
    || (Array.isArray(value) && value.length === 2 && value.some((part) => typeof part === "string"));
}

export function buildSemanticIR(ast: DiagramDocument): SemanticDocument {
  if (!ast || ast.type !== "diagram" || !Array.isArray(ast.statements)) {
    throw new TypeError("expected an XDraw diagram AST");
  }
  const lowered = cloneNode(ast);
  lowered.statements = lowerDecisionBranches(lowered.statements);
  const diagnostics = validateSemanticDocument(lowered);
  if (diagnostics.length) throw new DiagnosticError(diagnostics);
  const ir = {
    type: "semantic-document",
    title: lowered.title,
    statements: lowered.statements,
    objects: new Map(),
    origins: new Map(),
    references: [],
  } as unknown as SemanticDocument;
  if (lowered.span) Object.defineProperty(ir, "span", { value: lowered.span, enumerable: false });
  const index = indexSemanticObjects(ir);
  Object.defineProperties(ir, {
    source: { value: ast.source, enumerable: false },
    comments: { value: ast.comments ?? [], enumerable: false },
    tokens: { value: ast.tokens ?? [], enumerable: false },
    ast: { value: ast, enumerable: false },
    objects: { value: index.objects, enumerable: false },
    origins: { value: index.origins, enumerable: false },
    references: { value: index.references, enumerable: false },
    assetFiles: { value: ast.assetFiles ?? {}, enumerable: false },
  });
  return ir;
}

function sourceOnlySemanticStatement(statements: readonly SemanticStatement[]): SemanticStatement | null {
  for (const statement of statements) {
    if (statement.type === "template" || statement.type === "use" || statement.type === "decision-branch") return statement;
    const nested = statement.statements ? sourceOnlySemanticStatement(statement.statements) : null;
    if (nested) return nested;
  }
  return null;
}

/** Own and re-index a validated semantic tree before any geometry resolution mutates it. */
export function cloneSemanticDocument(document: SemanticDocument): SemanticDocument {
  const statements = cloneNode(document.statements);
  const sourceOnly = sourceOnlySemanticStatement(statements);
  if (sourceOnly) {
    throw new TypeError(`semantic document contains source-only '${sourceOnly.type}' statement`);
  }
  const owned = {
    type: "semantic-document",
    title: document.title,
    statements,
    objects: new Map(),
    origins: new Map(),
    references: [],
  } as unknown as SemanticDocument;
  for (const key of ["span", "source", "comments", "tokens", "ast", "assetFiles"] as const) {
    const value = document[key];
    if (value !== undefined) Object.defineProperty(owned, key, { value, enumerable: false });
  }
  const diagnostics = validateSemanticDocument(owned);
  if (diagnostics.length) throw new DiagnosticError(diagnostics);
  const index = indexSemanticObjects(owned);
  Object.defineProperties(owned, {
    objects: { value: index.objects, enumerable: false },
    origins: { value: index.origins, enumerable: false },
    references: { value: index.references, enumerable: false },
  });
  return owned;
}
