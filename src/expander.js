import { parse } from "./parser.js";

function normalizePath(path) {
  if (/^(?:\/|[A-Za-z]:[\\/])/.test(path)) throw new Error(`path must be relative to the configured root: ${path}`);
  const parts = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else if (part === "..") parts.push(part);
    else parts.push(part);
  }
  return parts.join("/");
}

function directoryOf(path) {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function joinPath(directory, path) {
  return normalizePath(directory ? `${directory}/${path}` : path);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  if (value.span) Object.defineProperty(result, "span", { value: value.span, enumerable: false });
  if (value.sourceFile) Object.defineProperty(result, "sourceFile", { value: value.sourceFile, enumerable: false });
  if (value.assetFiles) Object.defineProperty(result, "assetFiles", { value: value.assetFiles, enumerable: false });
  return result;
}

function substitute(value, bindings) {
  if (typeof value !== "string") return value;
  return value.replace(/\{([A-Za-z_][A-Za-z0-9_-]*)\}/g, (match, name) => (
    bindings.has(name) ? String(bindings.get(name)) : match
  ));
}

function localDefinitions(statements, result = new Set()) {
  for (const statement of statements) {
    if (statement.id && statement.type !== "component") result.add(statement.id);
    if (statement.statements) localDefinitions(statement.statements, result);
  }
  return result;
}

const PORTS = new Set(["north", "south", "east", "west", "top", "bottom", "left", "right", "center"]);

function rewriteReference(value, ids, prefix) {
  const parts = value.split(".");
  const port = parts.length > 1 && PORTS.has(parts.at(-1)) ? `.${parts.pop()}` : "";
  const candidate = parts.join(".");
  const localId = [...ids]
    .filter((id) => candidate === id || candidate.startsWith(`${id}.`))
    .sort((left, right) => right.length - left.length)[0];
  if (!localId) return value;
  return `${prefix}.${candidate}${port}`;
}

function rewrite(value, bindings, ids, prefix, component, key = null) {
  if (Array.isArray(value)) return value.map((item) => rewrite(item, bindings, ids, prefix, component, key));
  if (!value || typeof value !== "object") {
    const substituted = substitute(value, bindings);
    if (typeof substituted !== "string") return substituted;
    if (key === "id" && ids.has(substituted)) return `${prefix}.${substituted}`;
    if (["nodes", "target", "ids", "asset", "style"].includes(key)) return rewriteReference(substituted, ids, prefix);
    return substituted;
  }
  const result = Object.fromEntries(Object.entries(value).map(([childKey, item]) => [
    childKey,
    rewrite(item, bindings, ids, prefix, component, childKey),
  ]));
  if (value.span) Object.defineProperty(result, "span", { value: value.span, enumerable: false });
  if (value.sourceFile) Object.defineProperty(result, "sourceFile", { value: value.sourceFile, enumerable: false });
  Object.defineProperty(result, "expansion", {
    value: { component, useSite: prefix, source: value.span ?? null },
    enumerable: false,
  });
  return result;
}

function expandStatements(statements, components, stack = []) {
  const output = [];
  for (const statement of statements) {
    if (statement.type === "component") continue;
    if (statement.type === "import") throw new Error(`unresolved import '${statement.path}'; load source files with loadDocument()`);
    if (statement.type === "use") {
      const definition = components.get(statement.component);
      if (!definition) throw new Error(`unknown component '${statement.component}' at use site '${statement.id}'`);
      if (stack.includes(statement.component)) {
        throw new Error(`component cycle: ${[...stack, statement.component].join(" -> ")}`);
      }
      const supplied = new Map(Object.entries(statement.arguments ?? {}));
      const missing = definition.parameters.filter((name) => !supplied.has(name));
      const unknown = [...supplied.keys()].filter((name) => !definition.parameters.includes(name));
      const location = `${statement.sourceFile ?? "<source>"}:${statement.span?.start?.line ?? "?"}:${statement.span?.start?.column ?? "?"}`;
      if (missing.length) throw new Error(`component '${statement.component}' at '${statement.id}' (${location}) is missing parameters: ${missing.join(", ")}`);
      if (unknown.length) throw new Error(`component '${statement.component}' at '${statement.id}' (${location}) has unknown parameters: ${unknown.join(", ")}`);
      const ids = localDefinitions(definition.statements);
      const instantiated = definition.statements.map((item) => rewrite(
        item, supplied, ids, statement.id, statement.component,
      ));
      output.push(...expandStatements(instantiated, components, [...stack, statement.component]));
      continue;
    }
    const item = clone(statement);
    if (item.statements) item.statements = expandStatements(item.statements, components, stack);
    output.push(item);
  }
  return output;
}

export function expandDocument(document) {
  const components = new Map();
  const collect = (statements, context = "document") => {
    for (const statement of statements) {
      if (statement.type === "component") {
        if (context !== "document") throw new Error(`component '${statement.id}' must be declared at document scope`);
        if (components.has(statement.id)) throw new Error(`duplicate component '${statement.id}'`);
        components.set(statement.id, statement);
      }
      if (statement.statements) collect(statement.statements, "nested");
    }
  };
  collect(document.statements);
  const result = clone(document);
  result.statements = expandStatements(document.statements, components);
  return result;
}

export async function loadParsedDocument(document, path, filesystem, state = { stack: [] }) {
  const normalized = normalizePath(path);
  if (state.stack.includes(normalized)) throw new Error(`import cycle: ${[...state.stack, normalized].join(" -> ")}`);
  const markSource = (statements) => {
    for (const statement of statements) {
      Object.defineProperty(statement, "sourceFile", { value: normalized, enumerable: false });
      if (statement.statements) markSource(statement.statements);
    }
  };
  markSource(document.statements);
  const directory = directoryOf(normalized);
  const statements = [];
  for (const statement of document.statements) {
    if (statement.type !== "import") {
      statements.push(statement);
      continue;
    }
    const importedPath = joinPath(directory, statement.path);
    let imported;
    try {
      imported = await loadDocument(importedPath, filesystem, { stack: [...state.stack, normalized] });
    } catch (error) {
      throw new Error(`${normalized}: import '${statement.path}' failed: ${error.message}`);
    }
    statements.push(...imported.statements);
  }
  document.statements = statements;
  return document;
}

export async function loadDocument(path, filesystem, state = { stack: [] }) {
  const normalized = normalizePath(path);
  let document;
  try {
    document = parse(await filesystem.readText(normalized));
  } catch (error) {
    if (error?.name === "XDrawSyntaxError") error.message = `${normalized}: ${error.message}`;
    throw error;
  }
  return loadParsedDocument(document, normalized, filesystem, state);
}
