import type {
  TemplateStatement,
  TemplateUseStatement,
  DiagramDocument,
  SemanticStatement,
} from "./semantic-contracts.ts";

function substitute(value: string, bindings: ReadonlyMap<string, unknown>): string {
  return value.replace(/\{([A-Za-z_][A-Za-z0-9_-]*)\}/g, (match, name: string) => (
    bindings.has(name) ? String(bindings.get(name)) : match
  ));
}

function substituteValue(value: unknown, bindings: ReadonlyMap<string, unknown>): unknown {
  if (typeof value === "string") return substitute(value, bindings);
  if (Array.isArray(value)) return value.map((item) => substituteValue(item, bindings));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substituteValue(item, bindings)]),
  );
}

function localDefinitions(statements: readonly SemanticStatement[], result = new Set<string>()): Set<string> {
  for (const statement of statements) {
    if (statement.id && statement.type !== "template") result.add(statement.id);
    if (statement.statements) localDefinitions(statement.statements, result);
  }
  return result;
}

const PORTS = new Set(["north", "south", "east", "west", "top", "bottom", "left", "right", "center"]);

function rewriteReference(value: string, ids: ReadonlySet<string>, prefix: string): string {
  const parts = value.split(".");
  const last = parts.at(-1);
  const port = parts.length > 1 && last !== undefined && PORTS.has(last) ? `.${parts.pop()}` : "";
  const candidate = parts.join(".");
  const localId = [...ids]
    .filter((id) => candidate === id || candidate.startsWith(`${id}.`))
    .sort((left, right) => right.length - left.length)[0];
  return localId ? `${prefix}.${candidate}${port}` : value;
}

function copyMetadata(target: SemanticStatement, source: SemanticStatement): void {
  for (const key of ["span", "sourceFile"] as const) {
    const value = source[key];
    if (value !== undefined) Object.defineProperty(target, key, { value, enumerable: false });
  }
}

function rewriteStatement(
  source: SemanticStatement,
  bindings: ReadonlyMap<string, unknown>,
  ids: ReadonlySet<string>,
  prefix: string,
  template: string,
): SemanticStatement {
  const statement = structuredClone(source);
  copyMetadata(statement, source);

  if (statement.id && ids.has(statement.id)) statement.id = `${prefix}.${statement.id}`;
  if ("title" in statement && typeof statement.title === "string") {
    statement.title = substitute(statement.title, bindings);
  }
  if ("authoredSource" in statement && typeof statement.authoredSource === "string") {
    statement.authoredSource = substitute(statement.authoredSource, bindings);
  }
  if ("tone" in statement && typeof statement.tone === "string") {
    statement.tone = substitute(statement.tone, bindings);
  }
  if ("value" in statement && typeof statement.value === "string") {
    statement.value = substitute(statement.value, bindings);
  }
  if ("attributes" in statement) {
    statement.attributes = substituteValue(statement.attributes, bindings) as Record<string, unknown>;
    const style = statement.attributes.style;
    if (typeof style === "string") statement.attributes.style = rewriteReference(style, ids, prefix);
  }

  switch (statement.type) {
    case "connection":
      statement.nodes = statement.nodes.map((value) => rewriteReference(value, ids, prefix));
      if (statement.label) statement.label = substitute(statement.label, bindings);
      break;
    case "alignment":
    case "distribution":
    case "offset":
    case "match-size":
    case "rotation":
    case "snap":
      statement.ids = statement.ids.map((value) => rewriteReference(value, ids, prefix));
      break;
    case "image":
    case "icon":
      statement.asset = rewriteReference(statement.asset, ids, prefix);
      break;
    case "note":
    case "callout":
      if (statement.target) statement.target = rewriteReference(statement.target, ids, prefix);
      break;
    case "use":
      statement.arguments = Object.fromEntries(
        Object.entries(statement.arguments).map(([key, value]) => [key, substituteValue(value, bindings)]),
      );
      break;
    case "property":
      statement.value = substituteValue(statement.value, bindings);
      break;
    default:
      break;
  }

  if (statement.statements) {
    statement.statements = statement.statements.map((child) => (
      rewriteStatement(child, bindings, ids, prefix, template)
    ));
  }
  Object.defineProperty(statement, "expansion", {
    value: { template, useSite: prefix, source: source.span ?? null },
    enumerable: false,
  });
  return statement;
}

function isTemplateUse(statement: SemanticStatement): statement is TemplateUseStatement {
  return statement.type === "use";
}

function expandStatements(
  statements: readonly SemanticStatement[],
  templates: ReadonlyMap<string, TemplateStatement>,
  stack: readonly string[] = [],
): SemanticStatement[] {
  const output: SemanticStatement[] = [];
  for (const source of statements) {
    if (source.type === "template") continue;
    if (isTemplateUse(source)) {
      const definition = templates.get(source.template);
      if (!definition) throw new Error(`unknown template '${source.template}' at use site '${source.id}'`);
      if (stack.includes(source.template)) {
        throw new Error(`template cycle: ${[...stack, source.template].join(" -> ")}`);
      }
      const supplied = new Map(Object.entries(source.arguments));
      const missing = definition.parameters.filter((name) => !supplied.has(name));
      const unknown = [...supplied.keys()].filter((name) => !definition.parameters.includes(name));
      const location = `${source.sourceFile ?? "<source>"}:${source.span?.start?.line ?? "?"}:${source.span?.start?.column ?? "?"}`;
      if (missing.length) {
        throw new Error(`template '${source.template}' at '${source.id}' (${location}) is missing parameters: ${missing.join(", ")}`);
      }
      if (unknown.length) {
        throw new Error(`template '${source.template}' at '${source.id}' (${location}) has unknown parameters: ${unknown.join(", ")}`);
      }
      const ids = localDefinitions(definition.statements);
      const instantiated = definition.statements.map((statement) => (
        rewriteStatement(statement, supplied, ids, source.id, source.template)
      ));
      output.push(...expandStatements(instantiated, templates, [...stack, source.template]));
      continue;
    }
    const statement = structuredClone(source);
    copyMetadata(statement, source);
    if (source.statements) statement.statements = expandStatements(source.statements, templates, stack);
    output.push(statement);
  }
  return output;
}

export function expandDocument(document: DiagramDocument): DiagramDocument {
  const templates = new Map<string, TemplateStatement>();
  const collect = (statements: readonly SemanticStatement[], context = "document"): void => {
    for (const statement of statements) {
      if (statement.type === "template") {
        if (context !== "document") throw new Error(`template '${statement.id}' must be declared at document scope`);
        if (templates.has(statement.id)) throw new Error(`duplicate template '${statement.id}'`);
        templates.set(statement.id, statement);
      }
      if (statement.statements) collect(statement.statements, "nested");
    }
  };
  collect(document.statements);
  const result = structuredClone(document);
  result.statements = expandStatements(document.statements, templates);
  for (const key of ["span", "source", "comments", "assetFiles"] as const) {
    const value = document[key];
    if (value !== undefined) Object.defineProperty(result, key, { value, enumerable: false });
  }
  return result;
}
