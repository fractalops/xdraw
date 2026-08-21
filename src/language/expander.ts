import {
  evaluateExpression,
  expressionRequiresGeometry,
  formatExpression,
  freeNames,
  mapExpressionNames,
  parseExpression,
} from "./expression.ts";
import type {
  TemplateStatement,
  TemplateUseStatement,
  DiagramDocument,
  PlotStatement,
  SemanticStatement,
} from "../contracts/semantic.ts";

/**
 * Replaces `${name}` and `{name}` alike. Both spellings appear in documents —
 * a title uses the bare form, and anything that could be confused with source
 * text uses the marked one — and matching only the braces left the dollar of
 * the marked form stranded in the output.
 */
function substitute(value: string, bindings: ReadonlyMap<string, unknown>): string {
  return value.replace(/\$?\{([A-Za-z_][A-Za-z0-9_-]*)\}/gu, (match, name: string) => (
    bindings.has(name) ? String(bindings.get(name)) : match
  ));
}

/**
 * Substitutes `${name}` rather than `{name}`. An expression is source text in
 * its own grammar, where a bare brace means nothing, so a parameter has to be
 * marked in a way the expression tokenizer can be taught to skip over.
 */
function substituteParameters(value: string, bindings: ReadonlyMap<string, unknown>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_-]*)\}/gu, (match, name: string) => (
    bindings.has(name) ? String(bindings.get(name)) : match
  ));
}

function evaluatePairPart(source: string): number {
  const value = evaluateExpression(parseExpression(source), {});
  if (!Number.isFinite(value)) throw new Error(`'${source}' is not a finite number`);
  return value;
}

function substituteInterval(
  values: readonly [number | string, number | string],
  bindings: ReadonlyMap<string, unknown>,
): [number, number] {
  return values.map((value) => (
    typeof value === "string" ? evaluatePairPart(substituteParameters(value, bindings)) : value
  )) as [number, number];
}

function substitutePlaneIntervals(
  statement: SemanticStatement,
  bindings: ReadonlyMap<string, unknown>,
): void {
  if (statement.type !== "node" || !statement.plane) return;
  statement.plane = {
    ...statement.plane,
    xDomain: statement.plane.xDomain ? substituteInterval(statement.plane.xDomain, bindings) : undefined,
    yDomain: statement.plane.yDomain ? substituteInterval(statement.plane.yDomain, bindings) : undefined,
  };
}

function substitutePlot(
  statement: PlotStatement,
  bindings: ReadonlyMap<string, unknown>,
): void {
  statement.x = substituteParameters(statement.x, bindings);
  statement.y = substituteParameters(statement.y, bindings);
  if (statement.equation) statement.equation = substituteParameters(statement.equation, bindings);
  if (typeof statement.from === "string") {
    statement.from = evaluatePairPart(substituteParameters(statement.from, bindings));
  }
  if (typeof statement.to === "string") {
    statement.to = evaluatePairPart(substituteParameters(statement.to, bindings));
  }
  if (statement.label) statement.label = substitute(statement.label, bindings);
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

function rewriteExpressionReferences(value: string, ids: ReadonlySet<string>, prefix: string): string {
  return formatExpression(mapExpressionNames(parseExpression(value), (name) => (
    rewriteReference(name, ids, prefix)
  )));
}

function expandDeferredExpression(
  value: string,
  bindings: ReadonlyMap<string, unknown>,
  ids: ReadonlySet<string>,
  prefix: string,
): number | string {
  const rewritten = rewriteExpressionReferences(substituteParameters(value, bindings), ids, prefix);
  const expression = parseExpression(rewritten);
  if (freeNames(expression).size || expressionRequiresGeometry(expression)) return rewritten;
  return evaluateExpression(expression, {});
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
  // A pair written after '=' arrives as text when it mentions a parameter, so
  // it is resolved here, once the parameter has a value.
  for (const key of ["at", "size"] as const) {
    const carrier = statement as unknown as Record<string, readonly unknown[] | string | undefined>;
    const value = carrier[key];
    if (typeof value === "string") {
      carrier[key] = rewriteExpressionReferences(substituteParameters(value, bindings), ids, prefix);
      continue;
    }
    if (Array.isArray(value) && value.some((item) => typeof item === "string")) {
      carrier[key] = value.map((item): unknown => (
        typeof item === "string" ? expandDeferredExpression(item, bindings, ids, prefix) : item
      ));
    }
  }
  if ("attributes" in statement) {
    statement.attributes = substituteValue(statement.attributes, bindings) as Record<string, unknown>;
    const style = statement.attributes.style;
    if (typeof style === "string") statement.attributes.style = rewriteReference(style, ids, prefix);
  }

  switch (statement.type) {
    case "plot":
      // A curve is described rather than drawn at this point, so its equations
      // are still text and a parameter can still reach them.
      substitutePlot(statement, bindings);
      break;
    case "connection":
      statement.nodes = statement.nodes.map((value) => rewriteReference(value, ids, prefix));
      if (statement.label) statement.label = substitute(statement.label, bindings);
      break;
    case "attachment":
      statement.moving = rewriteReference(statement.moving, ids, prefix);
      statement.target = rewriteExpressionReferences(
        substituteParameters(statement.target, bindings),
        ids,
        prefix,
      );
      break;
    case "alignment":
    case "distribution":
    case "offset":
    case "match-size":
    case "rotation":
    case "snap":
    case "layer":
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

  substitutePlaneIntervals(statement, bindings);

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
