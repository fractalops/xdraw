const PORTS = new Set([
  "north", "south", "east", "west", "top", "bottom", "left", "right", "center",
]);

const DEFINITIONS = new Set([
  "lane", "group", "frame", "tree", "branch", "leaf", "participant", "note", "callout", "node", "text", "image", "icon",
]);
const SPACING = new Set(["tight", "normal", "airy"]);

function endpointId(value, definitions) {
  if (definitions?.has(value)) return value;
  const segments = value.split(".");
  return PORTS.has(segments.at(-1)) ? segments.slice(0, -1).join(".") : value;
}

function locationOf(node) {
  const location = node?.span?.start;
  return location ? { ...location, file: node.sourceFile } : null;
}

export class DiagnosticError extends Error {
  constructor(diagnostics) {
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

function diagnostic(code, message, node) {
  return { code, severity: "error", message, location: locationOf(node) };
}

function cloneNode(value) {
  if (Array.isArray(value)) return value.map(cloneNode);
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneNode(item)]));
  if (value.span) Object.defineProperty(result, "span", { value: value.span, enumerable: false });
  if (value.semanticId) Object.defineProperty(result, "semanticId", { value: value.semanticId, enumerable: false });
  if (value.expansion) Object.defineProperty(result, "expansion", { value: value.expansion, enumerable: false });
  if (value.sourceFile) Object.defineProperty(result, "sourceFile", { value: value.sourceFile, enumerable: false });
  if (value.assetFiles) Object.defineProperty(result, "assetFiles", { value: value.assetFiles, enumerable: false });
  return result;
}

function lowerDecisionBranches(statements) {
  const result = [];
  for (const statement of statements) {
    if (statement.statements) statement.statements = lowerDecisionBranches(statement.statements);
    const branches = statement.type === "node" && statement.kind === "decision"
      ? statement.statements.filter((item) => item.type === "decision-branch")
      : [];
    if (branches.length) statement.statements = statement.statements.filter((item) => item.type !== "decision-branch");
    result.push(statement);
    for (const branch of branches) {
      const connection = {
        type: "connection",
        nodes: [statement.id, branch.target],
        label: branch.label,
        attributes: {},
      };
      if (branch.span) Object.defineProperty(connection, "span", { value: branch.span, enumerable: false });
      result.push(connection);
    }
  }
  return result;
}

function indexSemanticObjects(document) {
  const objects = new Map();
  const origins = new Map();
  const references = [];

  const visit = (statement, path) => {
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
    if (["note", "callout"].includes(statement.type) && statement.target) {
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

function collectStatements(statements, visit, context = "document") {
  for (const statement of statements) {
    visit(statement, context);
    const childContext = statement.type === "sequence"
      ? "sequence"
      : ["lane", "group", "frame"].includes(statement.type)
        ? "container"
        : statement.type === "tree" || statement.type === "branch"
          ? "tree"
          : context;
    if (statement.statements) collectStatements(statement.statements, visit, childContext);
  }
}

export function validateSemanticDocument(document) {
  const diagnostics = [];
  const definitions = new Map();
  const references = [];
  const styles = new Map();
  let theme;

  collectStatements(document.statements, (statement, context) => {
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
      for (const endpoint of statement.nodes) references.push({ endpoint, node: statement, kind: "connection" });
      const route = String(statement.attributes?.route ?? "");
      if (route.startsWith("around ")) references.push({ id: route.slice(7), node: statement, kind: "route constraint" });
    }
    if (["note", "callout"].includes(statement.type) && statement.target) {
      references.push({ endpoint: statement.target, node: statement, kind: statement.type });
    }
    if (["alignment", "distribution", "offset", "match-size", "rotation", "snap"].includes(statement.type)) {
      for (const id of statement.ids) references.push({ id, node: statement, kind: "geometry operation" });
      if (new Set(statement.ids).size !== statement.ids.length) {
        diagnostics.push(diagnostic("XD1101", `${statement.type} contains duplicate node ids`, statement));
      }
    }
    if (statement.type === "match-size" && !["width", "height", "both"].includes(statement.axis)) {
      diagnostics.push(diagnostic("XD1102", `unsupported size axis '${statement.axis}'`, statement));
    }
    if (statement.type === "match-size" && statement.ids.length < 2) {
      diagnostics.push(diagnostic("XD1103", "match-size requires at least two nodes", statement));
    }
    if (statement.type === "snap" && !(statement.grid > 0)) {
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
    }
    if (statement.type === "note" && !statement.target && !statement.at && context !== "container") {
      diagnostics.push(diagnostic("XD1212", "an unanchored note must be declared inside a lane, group, or frame", statement));
    }
    if (statement.type === "frame") {
      const unsupported = Object.keys(statement.attributes ?? {}).filter((key) => key !== "locked");
      if (unsupported.length) diagnostics.push(diagnostic("XD1205", `unsupported frame attributes: ${unsupported.join(", ")}`, statement));
      if (statement.attributes?.locked !== undefined && typeof statement.attributes.locked !== "boolean") {
        diagnostics.push(diagnostic("XD1207", "frame locked must be a boolean flag", statement));
      }
    }
    if (["image", "icon"].includes(statement.type)) {
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
    if (statement.type === "node" && statement.size) {
      const [width, height] = statement.size;
      if (!(width > 0) || !(height > 0)) {
        diagnostics.push(diagnostic("XD1209", "node size must use positive dimensions", statement));
      } else if (statement.kind !== "junction" && width <= 40) {
        diagnostics.push(diagnostic("XD1210", "node width must be greater than 40 to contain its label", statement));
      }
    }
  });

  collectStatements(document.statements, (statement) => {
    const styleName = statement.attributes?.style;
    if (["node", "text"].includes(statement.type) && styleName && !styles.has(styleName)) {
      diagnostics.push(diagnostic("XD1004", `unknown style '${styleName}'`, statement));
    }
  });

  for (const reference of references) {
    const id = reference.id ?? endpointId(reference.endpoint, definitions);
    if (!definitions.has(id)) {
      diagnostics.push(diagnostic(
        "XD1002",
        `${reference.kind} references unknown node: ${id}`,
        reference.node,
      ));
    } else if (reference.kind === "geometry operation"
      && !["node", "participant", "branch", "leaf"].includes(definitions.get(id).type)) {
      diagnostics.push(diagnostic(
        "XD1105",
        `geometry operations require node targets; '${id}' is ${definitions.get(id).type}`,
        reference.node,
      ));
    }
  }
  return diagnostics;
}

export function buildSemanticIR(ast) {
  if (!ast || ast.type !== "diagram" || !Array.isArray(ast.statements)) {
    throw new TypeError("expected an XDraw diagram AST");
  }
  const lowered = cloneNode(ast);
  lowered.statements = lowerDecisionBranches(lowered.statements);
  const diagnostics = validateSemanticDocument(lowered);
  if (diagnostics.length) throw new DiagnosticError(diagnostics);
  const ir = lowered;
  ir.type = "semantic-document";
  const index = indexSemanticObjects(ir);
  Object.defineProperties(ir, {
    source: { value: ast.source, enumerable: false },
    comments: { value: ast.comments ?? [], enumerable: false },
    tokens: { value: ast.tokens ?? [], enumerable: false },
    ast: { value: ast, enumerable: false },
    objects: { value: index.objects, enumerable: false },
    origins: { value: index.origins, enumerable: false },
    references: { value: index.references, enumerable: false },
  });
  return ir;
}
