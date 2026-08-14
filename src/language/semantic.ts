import { isHighlightLanguage } from "./registry.ts";
import {
  MAX_CODE_LINE_CHARACTERS,
  MAX_CODE_LINES,
  MAX_CODE_SOURCE_CHARACTERS,
} from "../text/code-policy.ts";
import {
  hasValidFreedrawPoints,
  hasValidFreedrawPressures,
  isFinitePoint,
  MAX_DOCUMENT_FREEDRAW_POINTS,
  MAX_FREEDRAW_COORDINATE,
  MAX_FREEDRAW_POINTS,
} from "../excalidraw/freedraw-policy.ts";
import { validateTableNode } from "../nodes/table.ts";
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
  SourceLocation,
  SourceSpan,
} from "../contracts/foundation.ts";

const PORTS = new Set([
  "north", "south", "east", "west", "top", "bottom", "left", "right", "center",
]);

const DEFINITIONS = new Set<SemanticStatement["type"]>([
  "lane", "group", "frame", "section", "tree", "branch", "leaf", "participant", "note", "callout", "node", "text", "layout-text", "code", "image", "icon", "freedraw",
]);
const SPACING = new Set(["tight", "normal", "airy"]);
const ALIGNMENT_MODES = new Set(["left", "center-x", "right", "top", "center-y", "bottom"]);
const DISTRIBUTION_AXES = new Set(["x", "y"]);
const CODE_GEOMETRY_OPERATIONS = new Set<GeometryStatement["type"]>(["alignment", "distribution", "offset", "snap"]);
const FREEDRAW_GEOMETRY_OPERATIONS = new Set<GeometryStatement["type"]>(["alignment", "distribution", "offset", "rotation", "snap"]);

type SemanticContext = "document" | "sequence" | "container" | "table" | "tree";

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

function isGeometryStatement(statement: SemanticStatement): statement is GeometryStatement {
  return ["alignment", "distribution", "offset", "match-size", "rotation", "snap"].includes(statement.type);
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
      : ["lane", "group", "frame", "section"].includes(statement.type)
        ? "container"
        : statement.type === "tree" || statement.type === "branch"
          ? "tree"
          : context;
    if (statement.statements) collectStatements(statement.statements, visit, childContext);
  }
}

type SemanticValidationDocument = DiagnosticNode & Pick<DiagramDocument, "statements">;

/**
 * Mutable state threaded through the validation rules. Some rules only report;
 * others also accumulate declarations that later passes resolve against.
 */
interface ValidationState {
  readonly diagnostics: Diagnostic[];
  readonly definitions: Map<string, SemanticStatement>;
  readonly references: ValidationReference[];
  readonly styles: Map<string, StyleStatement>;
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
        const previous = state.definitions.get(statement.id);
        if (previous) {
          state.diagnostics.push(diagnostic(
            "XD1001",
            `duplicate semantic id '${statement.id}' (first declared at ${previous.span?.start?.line ?? "unknown"}:${previous.span?.start?.column ?? "unknown"})`,
            statement,
          ));
        } else {
          state.definitions.set(statement.id, statement);
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
        const supported = context === "document" ? ["compact", "grid", "layered"] : ["row", "column"];
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
    family: "freedraw",
    apply(statement, _context, state) {
      if (statement.type === "freedraw") {
        const points = statement.points;
        if (!isFinitePoint(statement.at)) {
          state.diagnostics.push(diagnostic("XD1220", "freedraw at must be a finite coordinate pair", statement));
        }
        if (!hasValidFreedrawPoints(points)) {
          state.diagnostics.push(diagnostic("XD1221", "freedraw points must contain at least two finite coordinate pairs", statement));
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
      }
    },
  },
  {
    family: "node-size",
    apply(statement, _context, state) {
      if (statement.type === "node" && statement.size) {
        const [width, height] = statement.size;
        if (!(width > 0) || !(height > 0)) {
          state.diagnostics.push(diagnostic("XD1209", "node size must use positive dimensions", statement));
        } else if (statement.kind === "decision" && statement.title && (width < 96 || height < 72)) {
          state.diagnostics.push(diagnostic("XD1244", "decision size must be at least 96 by 72", statement));
        } else if (statement.kind !== "junction" && width <= 40) {
          state.diagnostics.push(diagnostic("XD1210", "node width must be greater than 40 to contain its label", statement));
        }
      }
    },
  },
] satisfies readonly ValidationRule[]);

export function validateSemanticDocument(document: SemanticValidationDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const definitions = new Map<string, SemanticStatement>();
  const references: ValidationReference[] = [];
  const styles = new Map<string, StyleStatement>();
  const state: ValidationState = {
    diagnostics, definitions, references, styles, theme: undefined, freedrawPointCount: 0,
  };

  collectStatements(document.statements, (statement, context) => {
    for (const rule of VALIDATION_RULES) {
      if (rule.apply(statement, context, state)) return;
    }
  });

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

export function buildSemanticIR(ast: DiagramDocument): SemanticDocument {
  if (!ast || ast.type !== "diagram" || !Array.isArray(ast.statements)) {
    throw new TypeError("expected an XDraw diagram AST");
  }
  const lowered = cloneNode(ast);
  lowered.statements = lowerDecisionBranches(lowered.statements);
  const diagnostics = validateSemanticDocument(lowered);
  if (diagnostics.length) throw new DiagnosticError(diagnostics);
  const ir: SemanticDocument = {
    type: "semantic-document",
    title: lowered.title,
    statements: lowered.statements,
    objects: new Map(),
    origins: new Map(),
    references: [],
  };
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
