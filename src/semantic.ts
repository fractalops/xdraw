import { isHighlightLanguage } from "./language-registry.ts";
import {
  MAX_CODE_LINE_CHARACTERS,
  MAX_CODE_LINES,
  MAX_CODE_SOURCE_CHARACTERS,
} from "./code-policy.ts";
import {
  hasValidFreedrawPoints,
  hasValidFreedrawPressures,
  isFinitePoint,
  MAX_DOCUMENT_FREEDRAW_POINTS,
  MAX_FREEDRAW_COORDINATE,
  MAX_FREEDRAW_POINTS,
} from "./freedraw-policy.ts";
import { validateTableNode } from "./nodes/table.ts";
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
} from "./semantic-contracts.ts";
import type {
  Diagnostic,
  DiagnosticNode,
  SourceLocation,
  SourceSpan,
} from "./foundation-contracts.ts";

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

export function validateSemanticDocument(document: SemanticValidationDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const definitions = new Map<string, SemanticStatement>();
  const references: ValidationReference[] = [];
  const styles = new Map<string, StyleStatement>();
  let theme: ThemeStatement | undefined;
  let freedrawPointCount = 0;

  collectStatements(document.statements, (statement, context) => {
    if (context === "sequence" && statement.type !== "participant" && statement.type !== "connection") {
      diagnostics.push(diagnostic(
        "XD1240",
        `sequence may contain only participants and messages, not ${statement.type}`,
        statement,
      ));
    }
    if (context === "tree" && statement.type !== "branch" && statement.type !== "leaf") {
      diagnostics.push(diagnostic(
        "XD1241",
        `tree may contain only branches and leaves, not ${statement.type}`,
        statement,
      ));
    }
    if (context === "table" && statement.type !== "table-header" && statement.type !== "table-row") {
      diagnostics.push(diagnostic(
        "XD1250",
        `table may contain only a header and rows, not ${statement.type}`,
        statement,
      ));
    }
    if ((statement.type === "table-header" || statement.type === "table-row") && context !== "table") {
      diagnostics.push(diagnostic("XD1251", `${statement.type} must be declared inside a table`, statement));
    }
    if (statement.type === "node" && statement.kind === "table") {
      diagnostics.push(...validateTableNode(statement).map((issue) => (
        diagnostic(issue.code, issue.message, issue.node)
      )));
    }
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
            diagnostics.push(diagnostic(
              "XD1242",
              `sequence message references a non-participant: ${id}`,
              message,
            ));
          }
        }
      }
    }
    if (statement.type === "style") {
      if (context !== "document") diagnostics.push(diagnostic("XD1005", "styles may only be declared at document scope", statement));
      if (styles.has(statement.id)) diagnostics.push(diagnostic("XD1003", `duplicate style '${statement.id}'`, statement));
      else styles.set(statement.id, statement);
    }
    if (statement.type === "theme") {
      if (context !== "document") diagnostics.push(diagnostic("XD1006", "themes may only be declared at document scope", statement));
      if (theme) diagnostics.push(diagnostic("XD1007", "a document may declare only one theme", statement));
      else theme = statement;
    }
    if (DEFINITIONS.has(statement.type) && statement.id) {
      const previous = definitions.get(statement.id);
      if (previous) {
        diagnostics.push(diagnostic(
          "XD1001",
          `duplicate semantic id '${statement.id}' (first declared at ${previous.span?.start?.line ?? "unknown"}:${previous.span?.start?.column ?? "unknown"})`,
          statement,
        ));
      } else {
        definitions.set(statement.id, statement);
      }
    }

    if (statement.type === "connection") {
      if (statement.nodes.length < 2) {
        diagnostics.push(diagnostic("XD1230", "connection requires at least two endpoints", statement));
      }
      const style = statement.attributes.style;
      if (style !== undefined && (typeof style !== "string"
          || !["auto", "straight", "elbow", "curved", "line"].includes(style))) {
        diagnostics.push(diagnostic("XD1231", `unsupported connection style '${String(style)}'`, statement));
      }
      const width = statement.attributes.width;
      if (width !== undefined && (typeof width !== "number" || !Number.isFinite(width) || width <= 0)) {
        diagnostics.push(diagnostic("XD1232", "connection width must be a positive finite number", statement));
      }
      const head = statement.attributes.head;
      const supportedHeads = new Set([
        "none", "arrow", "bar", "dot", "circle", "circle_outline", "triangle", "triangle_outline",
        "diamond", "diamond_outline", "crowfoot_one", "crowfoot_many", "crowfoot_one_or_many",
      ]);
      if (head !== undefined && (typeof head !== "string" || !supportedHeads.has(head))) {
        diagnostics.push(diagnostic("XD1238", `unsupported arrowhead '${String(head)}'`, statement));
      }
      if (statement.attributes.dashed !== undefined && typeof statement.attributes.dashed !== "boolean") {
        diagnostics.push(diagnostic("XD1239", "connection dashed must be true or false", statement));
      }
      for (const key of ["start-label", "end-label", "technology"] as const) {
        const value = statement.attributes[key];
        if (value !== undefined && typeof value !== "string") {
          diagnostics.push(diagnostic("XD1233", `connection ${key} must be text`, statement));
        }
      }
      for (const endpoint of statement.nodes) references.push({ endpoint, node: statement, kind: "connection" });
      const route = String(statement.attributes?.route ?? "");
      if (route.startsWith("around ")) references.push({ id: route.slice(7), node: statement, kind: "route constraint" });
    }
    if ((statement.type === "note" || statement.type === "callout") && statement.target) {
      references.push({ endpoint: statement.target, node: statement, kind: statement.type });
    }
    if (isGeometryStatement(statement)) {
      if (!Array.isArray(statement.ids) || statement.ids.some((id) => typeof id !== "string")) {
        diagnostics.push(diagnostic("XD1105", `${statement.type} requires a node selection`, statement));
        return;
      }
      for (const id of statement.ids) {
        references.push({ id, node: statement, kind: "geometry operation", operation: statement.type });
      }
      if (new Set(statement.ids).size !== statement.ids.length) {
        diagnostics.push(diagnostic("XD1101", `${statement.type} contains duplicate node ids`, statement));
      }
    }
    if (statement.type === "match-size" && !["width", "height", "both"].includes(statement.axis ?? "")) {
      diagnostics.push(diagnostic("XD1102", `unsupported size axis '${statement.axis}'`, statement));
    }
    if (statement.type === "match-size" && statement.ids.length < 2) {
      diagnostics.push(diagnostic("XD1103", "match-size requires at least two nodes", statement));
    }
    if (statement.type === "alignment" && !ALIGNMENT_MODES.has(statement.mode ?? "")) {
      diagnostics.push(diagnostic("XD1106", `unsupported alignment mode '${statement.mode}'`, statement));
    }
    if (statement.type === "alignment" && statement.ids.length < 2) {
      diagnostics.push(diagnostic("XD1107", "alignment requires at least two nodes", statement));
    }
    if (statement.type === "distribution" && !DISTRIBUTION_AXES.has(statement.axis ?? "")) {
      diagnostics.push(diagnostic("XD1108", `unsupported distribution axis '${statement.axis}'`, statement));
    }
    if (statement.type === "distribution" && statement.ids.length < 3) {
      diagnostics.push(diagnostic("XD1109", "distribution requires at least three nodes", statement));
    }
    if (statement.type === "offset" && !isFinitePoint(statement.by)) {
      diagnostics.push(diagnostic("XD1110", "offset requires finite x and y values", statement));
    }
    if (statement.type === "rotation" && !(typeof statement.degrees === "number" && Number.isFinite(statement.degrees))) {
      diagnostics.push(diagnostic("XD1111", "rotation must be finite", statement));
    }
    if (statement.type === "snap" && !(typeof statement.grid === "number" && Number.isFinite(statement.grid) && statement.grid > 0)) {
      diagnostics.push(diagnostic("XD1104", "snap grid must be positive", statement));
    }

    if (statement.type === "layout") {
      const supported = context === "document" ? ["compact", "grid", "layered"] : ["row", "column"];
      if (!supported.includes(statement.kind)) {
        diagnostics.push(diagnostic(
          "XD1201",
          `layout '${statement.kind}' is not supported in ${context}`,
          statement,
        ));
      }
      if (statement.spacing !== undefined && !SPACING.has(statement.spacing)) {
        diagnostics.push(diagnostic("XD1206", `unsupported spacing preset '${statement.spacing}'`, statement));
      }
      if (statement.spacing !== undefined && statement.gap !== undefined) {
        diagnostics.push(diagnostic("XD1211", "layout may use spacing or gap, not both", statement));
      }
      if (statement.width !== undefined && (!(statement.width > 0) || !Number.isFinite(statement.width))) {
        diagnostics.push(diagnostic("XD1213", "layout width must be a positive finite number", statement));
      }
      if (statement.gap !== undefined && (!Number.isFinite(statement.gap) || statement.gap < 0)) {
        diagnostics.push(diagnostic("XD1235", "layout gap must be finite and non-negative", statement));
      }
      if (statement.columns !== undefined && (
        !Number.isFinite(statement.columns)
        || !Number.isInteger(statement.columns)
        || statement.columns <= 0
      )) {
        diagnostics.push(diagnostic("XD1243", "layout columns must be a positive integer", statement));
      }
    }
    if ((statement.type === "tree" || statement.type === "branch" || statement.type === "leaf")) {
      for (const [name, value] of [["level-gap", statement.levelGap], ["sibling-gap", statement.siblingGap]] as const) {
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
          diagnostics.push(diagnostic("XD1236", `tree ${name} must be finite and non-negative`, statement));
        }
      }
    }
    if (statement.type === "body" && typeof statement.value !== "string") {
      diagnostics.push(diagnostic("XD1237", "body content must be text", statement));
    }
    if (statement.type === "note" && !statement.target && !statement.at && context !== "container") {
      diagnostics.push(diagnostic("XD1212", "an unanchored note must be declared inside a lane, group, frame, or section", statement));
    }
    if (statement.type === "callout" && !statement.target && !statement.at) {
      diagnostics.push(diagnostic("XD1234", "a callout requires a target or explicit position", statement));
    }
    if (statement.type === "frame") {
      const unsupported = Object.keys(statement.attributes ?? {}).filter((key) => key !== "locked");
      if (unsupported.length) diagnostics.push(diagnostic("XD1205", `unsupported frame attributes: ${unsupported.join(", ")}`, statement));
      if (statement.attributes?.locked !== undefined && typeof statement.attributes.locked !== "boolean") {
        diagnostics.push(diagnostic("XD1207", "frame locked must be a boolean flag", statement));
      }
    }
    if (statement.type === "image" || statement.type === "icon") {
      const supported = new Set(["alt", "fit", "locked"]);
      const unsupported = Object.keys(statement.attributes ?? {}).filter((key) => !supported.has(key));
      if (unsupported.length) diagnostics.push(diagnostic("XD1208", `unsupported ${statement.type} attributes: ${unsupported.join(", ")}`, statement));
    }
    if (statement.type === "text" && !["left", "center", "right"].includes(statement.align)) {
      diagnostics.push(diagnostic("XD1202", `unsupported text alignment '${statement.align}'`, statement));
    }
    if (statement.type === "text" && statement.fontSize !== undefined && !(statement.fontSize > 0)) {
      diagnostics.push(diagnostic("XD1203", "font size must be positive", statement));
    }
    if (statement.type === "text" && statement.width !== undefined && !(statement.width > 0)) {
      diagnostics.push(diagnostic("XD1204", "text width must be positive", statement));
    }
    if (statement.type === "code") {
      if (typeof statement.value !== "string") {
        diagnostics.push(diagnostic("XD1214", "code source must be text", statement));
      }
      if (statement.title !== undefined && typeof statement.title !== "string") {
        diagnostics.push(diagnostic("XD1219", "code title must be text", statement));
      }
      if (typeof statement.lineNumbers !== "boolean") {
        diagnostics.push(diagnostic("XD1215", "code line-numbers must be true or false", statement));
      }
      if (typeof statement.highlight !== "boolean") {
        diagnostics.push(diagnostic("XD1216", "code highlight must be true or false", statement));
      }
      if (statement.highlight === true
          && !isHighlightLanguage(statement.language)) {
        diagnostics.push(diagnostic(
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
          diagnostics.push(diagnostic("XD1218", "code source exceeds the supported size", statement));
        }
      }
    }
    if (statement.type === "freedraw") {
      const points = statement.points;
      if (!isFinitePoint(statement.at)) {
        diagnostics.push(diagnostic("XD1220", "freedraw at must be a finite coordinate pair", statement));
      }
      if (!hasValidFreedrawPoints(points)) {
        diagnostics.push(diagnostic("XD1221", "freedraw points must contain at least two finite coordinate pairs", statement));
      } else {
        freedrawPointCount += points.length;
        if (points.length > MAX_FREEDRAW_POINTS) {
          diagnostics.push(diagnostic("XD1222", `freedraw may contain at most ${MAX_FREEDRAW_POINTS} points`, statement));
        }
        if (points.some((point) => point.some((value) => Math.abs(value) > MAX_FREEDRAW_COORDINATE))) {
          diagnostics.push(diagnostic("XD1223", "freedraw coordinates exceed the supported range", statement));
        }
        if (new Set(points.map((point) => `${point[0]},${point[1]}`)).size < 2) {
          diagnostics.push(diagnostic("XD1224", "freedraw requires at least two distinct points", statement));
        }
      }
      if (!hasValidFreedrawPressures(statement.pressures, points?.length)) {
        diagnostics.push(diagnostic("XD1225", "freedraw pressures must be empty or contain one value from 0 to 1 per point", statement));
      }
      if (typeof statement.simulatePressure !== "boolean") {
        diagnostics.push(diagnostic("XD1226", "freedraw simulate-pressure must be true or false", statement));
      }
    }
    if (statement.type === "node" && statement.size) {
      const [width, height] = statement.size;
      if (!(width > 0) || !(height > 0)) {
        diagnostics.push(diagnostic("XD1209", "node size must use positive dimensions", statement));
      } else if (statement.kind === "decision" && statement.title && (width < 96 || height < 72)) {
        diagnostics.push(diagnostic("XD1244", "decision size must be at least 96 by 72", statement));
      } else if (statement.kind !== "junction" && width <= 40) {
        diagnostics.push(diagnostic("XD1210", "node width must be greater than 40 to contain its label", statement));
      }
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
  if (freedrawPointCount > MAX_DOCUMENT_FREEDRAW_POINTS) {
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
