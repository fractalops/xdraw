import { SyntaxError, tokenize } from "./tokenizer.js";
import {
  hasProperty,
  normalizePropertyValue,
  propertyKind,
  resolveConstructor,
  resolveTone,
} from "./language-registry.js";

function located(value, start, end) {
  Object.defineProperty(value, "span", {
    value: {
      start: { offset: start.offset, ...start.start },
      end: { offset: end.end, ...end.finish },
    },
    enumerable: false,
  });
  return value;
}

export function parseSyntax(source) {
  const tokens = tokenize(source);
  let index = 0;

  const peek = (type, value, offset = 0) => {
    const current = tokens[index + offset];
    return current?.type === type && (value === undefined || current.value === value);
  };
  const take = (type, value, message) => {
    const current = tokens[index];
    if (!peek(type, value)) {
      throw new SyntaxError(message ?? `expected ${value ?? type}`, source, current.offset);
    }
    index += 1;
    return current;
  };
  const identifier = (value, message) => take("identifier", value, message).value;
  const quoted = (message = "expected a quoted string") => take("string", undefined, message).value;

  function pair(label) {
    take("(", undefined, `expected '(' after ${label}`);
    const x = take("number", undefined, `expected ${label} x value`).value;
    take(",", undefined, `expected ',' in ${label}`);
    const y = take("number", undefined, `expected ${label} y value`).value;
    take(")", undefined, `expected ')' after ${label}`);
    return [x, y];
  }

  function selection(label) {
    take("(", undefined, `expected '(' after ${label}`);
    const references = [identifier(undefined, `expected an element reference in ${label}`)];
    while (peek(",")) {
      take(",");
      references.push(identifier(undefined, `expected an element reference in ${label}`));
    }
    take(")", undefined, `expected ')' after ${label}`);
    return references;
  }

  function value(label) {
    if (peek("string")) return take("string").value;
    if (peek("number")) return take("number").value;
    if (peek("identifier")) return take("identifier").value;
    if (peek("(")) return pair(label);
    throw new SyntaxError(`expected a value for ${label}`, source, tokens[index].offset);
  }

  function points(label) {
    take("(", undefined, `expected '(' after ${label}`);
    const result = [pair(label)];
    while (peek(",")) {
      take(",");
      result.push(pair(label));
    }
    take(")", undefined, `expected ')' after ${label}`);
    return result;
  }

  function numbers(label) {
    take("(", undefined, `expected '(' after ${label}`);
    const result = [take("number", undefined, `expected a number in ${label}`).value];
    while (peek(",")) {
      take(",");
      result.push(take("number", undefined, `expected a number in ${label}`).value);
    }
    take(")", undefined, `expected ')' after ${label}`);
    return result;
  }

  function arguments_() {
    if (peek("string")) return [take("string").value];
    if (!peek("(")) return [];
    take("(");
    const result = [];
    while (!peek(")")) {
      result.push(value("constructor argument"));
      if (peek(",")) take(",");
      else if (!peek(")")) throw new SyntaxError("expected ',' or ')'", source, tokens[index].offset);
    }
    take(")");
    return result;
  }

  function property(name, start) {
    const kind = propertyKind(name);
    if (!kind) throw new SyntaxError(`unknown property '${name}'`, source, start.offset);
    let propertyValue;
    if (kind === "pair") propertyValue = pair(name);
    else if (kind === "points") propertyValue = points(name);
    else if (kind === "numbers") propertyValue = numbers(name);
    else if (kind === "endpoint") propertyValue = endpoint();
    else if (kind === "string") propertyValue = quoted(`expected a quoted string for ${name}`);
    else if (kind === "identifier" && peek("$")) {
      take("$");
      propertyValue = `{${identifier(undefined, `expected a parameter name for ${name}`)}}`;
    } else propertyValue = take(kind, undefined, `expected ${kind} value for ${name}`).value;
    return located({ type: "property", name, value: propertyValue }, start, tokens[index - 1]);
  }

  function endpoint() {
    const reference = identifier(undefined, "expected an element reference");
    if (!peek("@")) return { reference, anchor: undefined };
    take("@");
    return { reference, anchor: identifier(undefined, "expected an anchor after '@'") };
  }

  function propertiesBlock() {
    take("{", undefined, "expected '{'");
    const result = [];
    while (!peek("}")) {
      if (peek("eof")) throw new SyntaxError("unterminated property block", source, tokens[index].offset);
      const start = take("identifier", undefined, "expected a property");
      result.push(property(start.value, start));
    }
    take("}");
    return result;
  }

  function arrangement(start) {
    const kind = identifier(undefined, "expected arrangement type");
    return located(
      { type: "arrangement", kind, properties: propertiesBlock() },
      start,
      tokens[index - 1],
    );
  }

  function connection(id, firstEndpoint, start) {
    const operator = take(peek("arrow") ? "arrow" : "line").value;
    const endpoints = [firstEndpoint, endpoint()];
    while (peek(operator === "->" ? "arrow" : "line")) {
      take(operator === "->" ? "arrow" : "line");
      endpoints.push(endpoint());
    }
    const label = peek("string") ? quoted() : undefined;
    const properties = peek("{") ? propertiesBlock() : [];
    return located(
      { type: "connection", id, operator, endpoints, label, properties },
      start,
      tokens[index - 1],
    );
  }

  function followsNamedConnection() {
    if (!peek("identifier")) return false;
    if (peek("arrow", undefined, 1) || peek("line", undefined, 1)) return true;
    return peek("@", undefined, 1)
      && peek("identifier", undefined, 2)
      && (peek("arrow", undefined, 3) || peek("line", undefined, 3));
  }

  function block() {
    take("{", undefined, "expected '{'");
    const statements = [];
    while (!peek("}")) {
      if (peek("eof")) throw new SyntaxError("unterminated block", source, tokens[index].offset);
      statements.push(statement());
    }
    take("}");
    return statements;
  }

  function statement() {
    const start = take("identifier", undefined, "expected a statement");
    if (start.value === "subtitle") {
      return located({ type: "subtitle", value: quoted() }, start, tokens[index - 1]);
    }
    if (start.value === "arrange") return arrangement(start);
    if (start.value === "align" && peek("identifier") && peek("(", undefined, 1)) {
      const mode = identifier(undefined, "expected an alignment mode");
      return located({ type: "alignment", mode, references: selection(`align ${mode}`) }, start, tokens[index - 1]);
    }
    if (start.value === "distribute") {
      const axis = identifier(undefined, "expected distribution axis 'x' or 'y'");
      return located({ type: "distribution", axis, references: selection(`distribute ${axis}`) }, start, tokens[index - 1]);
    }
    if (start.value === "offset") {
      const references = selection("offset");
      identifier("by", "expected 'by' and an offset");
      return located({ type: "offset", references, by: pair("offset") }, start, tokens[index - 1]);
    }
    if (start.value === "match-size") {
      const references = selection("match-size");
      const axis = peek("identifier") ? identifier() : "both";
      return located({ type: "match-size", references, axis }, start, tokens[index - 1]);
    }
    if (start.value === "rotate") {
      const references = selection("rotate");
      const degrees = take("number", undefined, "expected rotation in degrees").value;
      return located({ type: "rotation", references, degrees }, start, tokens[index - 1]);
    }
    if (start.value === "snap") {
      const references = selection("snap");
      identifier("to", "expected 'to' and a grid size");
      const grid = take("number", undefined, "expected grid size").value;
      return located({ type: "snap", references, grid }, start, tokens[index - 1]);
    }

    if (peek(":")) {
      take(":");
      if (followsNamedConnection()) {
        const firstEndpoint = endpoint();
        return connection(start.value, firstEndpoint, start);
      }
      const constructor = identifier(undefined, "expected a constructor after ':'");
      const args = arguments_();
      const statements = peek("{") ? block() : [];
      return located({
        type: "declaration",
        id: start.value,
        constructor,
        arguments: args,
        statements,
      }, start, tokens[index - 1]);
    }

    if (peek("@") || peek("arrow") || peek("line")) {
      let firstEndpoint = { reference: start.value, anchor: undefined };
      if (peek("@")) {
        take("@");
        firstEndpoint = { ...firstEndpoint, anchor: identifier(undefined, "expected an anchor after '@'") };
      }
      return connection(undefined, firstEndpoint, start);
    }
    if (hasProperty(start.value)) return property(start.value, start);
    throw new SyntaxError(`unknown statement '${start.value}'`, source, start.offset);
  }

  const imports = [];
  while (peek("identifier", "use")) {
    const start = take("identifier", "use");
    const importSource = quoted("expected a quoted library name");
    identifier("as", "expected 'as' and an import alias");
    const alias = identifier(undefined, "expected an import alias");
    imports.push(located({ type: "import", source: importSource, alias }, start, tokens[index - 1]));
  }

  const start = take("identifier", "diagram", "expected a diagram declaration");
  const diagram = located(
    { type: "diagram", title: quoted("expected a diagram title"), statements: block() },
    start,
    tokens[index - 1],
  );
  take("eof", undefined, "unexpected content after diagram");
  const document = { type: "source-document", imports, diagram };
  Object.defineProperties(document, {
    source: { value: source, enumerable: false },
    comments: { value: tokens.comments, enumerable: false },
  });
  return document;
}

function copySpan(target, source) {
  if (source.span) Object.defineProperty(target, "span", { value: source.span, enumerable: false });
  return target;
}

function propertyMap(statement) {
  return new Map(statement.statements
    .filter((child) => child.type === "property")
    .map((child) => [child.name, child.value]));
}

function qualify(path, id) {
  return path.length ? `${path.join(".")}.${id}` : id;
}

function endpointValue(endpoint, scopes) {
  const [head, ...tail] = endpoint.reference.split(".");
  let resolved;
  for (const scope of scopes) {
    if (scope.has(head)) {
      resolved = [scope.get(head), ...tail].join(".");
      break;
    }
  }
  resolved ??= endpoint.reference;
  return endpoint.anchor ? `${resolved}.${endpoint.anchor}` : resolved;
}

function referenceValue(reference, scopes) {
  return endpointValue({ reference, anchor: undefined }, scopes);
}

function interpolationValue(value) {
  return typeof value === "string"
    ? value.replace(/\$\{([A-Za-z_][A-Za-z0-9_-]*)\}/gu, "{$1}")
    : value;
}

function codeValue(value) {
  const lines = String(value).split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const populated = lines.filter((line) => line.trim().length);
  if (!populated.length) return lines.join("\n");
  const indentation = populated
    .map((line) => line.match(/^[\t ]*/u)?.[0] ?? "")
    .reduce((shared, current) => {
      let length = 0;
      while (length < shared.length && shared[length] === current[length]) length += 1;
      return shared.slice(0, length);
    });
  return lines.map((line) => line.startsWith(indentation) ? line.slice(indentation.length) : line).join("\n");
}

function lowerProperties(properties, imports) {
  const attributes = {};
  for (const [name, value] of properties) {
    if (["at", "size", "body", "style", "attach", "language", "line-numbers", "highlight", "points", "pressures", "simulate-pressure"].includes(name)) continue;
    if (name === "stroke-style") attributes.dashed = value === "dashed";
    else if (name === "route" && ["auto", "straight", "elbow", "curved", "line"].includes(value)) {
      attributes.style = value;
    }
    else if (name === "via") attributes.via = value.map((point) => point.join(",")).join(";");
    else attributes[name] = normalizePropertyValue(value);
  }
  const style = properties.get("style");
  const tone = resolveTone(style, imports) ?? (/^\{[A-Za-z_][A-Za-z0-9_-]*\}$/u.test(style ?? "") ? style : undefined);
  if (properties.has("style") && !tone) attributes.style = properties.get("style");
  return { attributes, tone };
}

function lowerTreeArrangement(statement, children, id, title) {
  const arrangement = statement.statements.find((child) => child.type === "arrangement" && child.kind === "tree");
  if (!arrangement) return null;
  const options = new Map(arrangement.properties.map((property) => [property.name, property.value]));
  const rootName = options.get("root");
  if (typeof rootName !== "string") throw new Error(`tree arrangement '${id}' requires a root property`);
  const rootId = `${id}.${rootName}`;
  const nodes = new Map(children.filter((child) => child.type === "node").map((child) => [child.id, child]));
  const adjacency = new Map([...nodes.keys()].map((nodeId) => [nodeId, []]));
  const parents = new Map();
  for (const connection of children.filter((child) => child.type === "connection")) {
    for (let index = 0; index < connection.nodes.length - 1; index += 1) {
      const parent = connection.nodes[index].replace(/\.(?:top|right|bottom|left|center)$/u, "");
      const child = connection.nodes[index + 1].replace(/\.(?:top|right|bottom|left|center)$/u, "");
      if (!nodes.has(parent) || !nodes.has(child)) throw new Error(`tree arrangement '${id}' may connect only its direct nodes`);
      if (parents.has(child)) throw new Error(`tree node '${child}' has more than one parent`);
      parents.set(child, parent);
      adjacency.get(parent).push(child);
    }
  }
  if (!nodes.has(rootId)) throw new Error(`tree root '${rootName}' is not a direct child of '${id}'`);
  const visited = new Set();
  const branch = (nodeId) => {
    if (visited.has(nodeId)) throw new Error(`tree arrangement '${id}' contains a cycle at '${nodeId}'`);
    visited.add(nodeId);
    const node = nodes.get(nodeId);
    const descendants = adjacency.get(nodeId).map(branch);
    return copySpan({
      type: descendants.length ? "branch" : "leaf",
      id: node.id,
      title: node.title,
      kind: node.kind,
      tone: node.tone,
      statements: descendants,
    }, node);
  };
  const root = branch(rootId);
  if (visited.size !== nodes.size) throw new Error(`tree arrangement '${id}' contains nodes that are unreachable from '${rootName}'`);
  return copySpan({
    type: "tree",
    id: root.id,
    title: root.title,
    kind: root.kind,
    tone: root.tone,
    section: title,
    sectionId: id,
    direction: options.get("direction") ?? "down",
    levelGap: options.get("level-gap"),
    siblingGap: options.get("sibling-gap"),
    statements: root.statements,
  }, statement);
}

function lowerScope(statements, path, parentScopes, imports, components) {
  const declarations = new Map(statements
    .filter((statement) => statement.type === "declaration")
    .map((statement) => [statement.id, qualify(path, statement.id)]));
  const scopes = [declarations, ...parentScopes];

  return statements.flatMap((statement) => {
    if (statement.type === "subtitle") return [copySpan({ type: "subtitle", value: statement.value }, statement)];
    if (statement.type === "arrangement") {
      const options = new Map(statement.properties.map((property) => [property.name, property.value]));
      return [copySpan({
        type: "layout",
        kind: statement.kind,
        gap: options.get("gap"),
        columns: options.get("columns"),
        spacing: options.get("spacing"),
        width: options.get("width"),
        ownsChildren: true,
      }, statement)];
    }
    if (statement.type === "property") return [];
    if (["alignment", "distribution", "offset", "match-size", "rotation", "snap"].includes(statement.type)) {
      return [copySpan({
        ...statement,
        ids: statement.references.map((reference) => referenceValue(reference, scopes)),
        references: undefined,
      }, statement)];
    }
    if (statement.type === "connection") {
      const properties = new Map(statement.properties.map((property) => [property.name, property.value]));
      const { attributes, tone } = lowerProperties(properties, imports);
      if (tone) attributes[tone] = true;
      if (statement.operator === "--") attributes.style = "line";
      return [copySpan({
        type: "connection",
        id: statement.id ? qualify(path, statement.id) : undefined,
        nodes: statement.endpoints.map((endpoint_) => endpointValue(endpoint_, scopes)),
        label: statement.label,
        attributes,
      }, statement)];
    }

    const id = qualify(path, statement.id);
    const component = components.get(statement.constructor);
    if (component && statement.constructor !== "component") {
      const supplied = Object.fromEntries(component.arguments
        .slice(0, statement.arguments.length)
        .map((name, argumentIndex) => {
          const value = interpolationValue(statement.arguments[argumentIndex]);
          return [name, resolveTone(value, imports) ?? value];
        }));
      return [copySpan({
        type: "use",
        component: qualify([], statement.constructor),
        id,
        arguments: supplied,
      }, statement)];
    }

    const constructor = resolveConstructor(statement.constructor, imports);
    const properties = propertyMap(statement);
    const { attributes, tone } = lowerProperties(properties, imports);
    const children = lowerScope(statement.statements, [...path, statement.id], scopes, imports, components);
    const title = interpolationValue(statement.arguments[0] ?? statement.id);

    const tree = lowerTreeArrangement(statement, children, id, title);
    if (tree) return [tree];

    if (constructor.type === "component") {
      if (path.length) throw new Error(`component '${statement.id}' must be declared at document scope`);
      if (!statement.arguments.every((parameter) => typeof parameter === "string")) {
        throw new Error(`component '${statement.id}' parameters must be identifiers`);
      }
      return [copySpan({
        type: "component",
        id,
        parameters: statement.arguments,
        statements: lowerScope(statement.statements, [], [], imports, components),
      }, statement)];
    }

    if (constructor.type === "style") {
      return [copySpan({
        type: "style",
        id,
        statements: [...properties].map(([key, value]) => ({
          type: "property",
          key,
          value: normalizePropertyValue(value),
        })),
      }, statement)];
    }
    if (constructor.type === "theme") {
      return [copySpan({
        type: "theme",
        statements: [...properties].map(([key, value]) => ({
          type: "property",
          key,
          value: normalizePropertyValue(value),
        })),
      }, statement)];
    }
    if (constructor.type === "asset") {
      if (typeof statement.arguments[0] !== "string") throw new Error(`asset '${id}' requires a source string`);
      return [copySpan({ type: "asset", id, source: statement.arguments[0], attributes }, statement)];
    }
    if (["image", "icon"].includes(constructor.type)) {
      const asset = statement.arguments[0];
      if (typeof asset !== "string") throw new Error(`${constructor.type} '${id}' requires an asset reference`);
      if (!properties.has("at") || !properties.has("size")) {
        throw new Error(`${constructor.type} '${id}' requires at and size properties`);
      }
      return [copySpan({
        type: constructor.type,
        id,
        asset: referenceValue(asset, scopes),
        at: properties.get("at"),
        size: properties.get("size"),
        attributes,
      }, statement)];
    }
    if (constructor.type === "participant") {
      return [copySpan({ type: "participant", id, title }, statement)];
    }
    if (constructor.type === "sequence") {
      return [copySpan({ type: "sequence", id, statements: children }, statement)];
    }
    if (constructor.type === "note") {
      const attach = properties.get("attach");
      return [copySpan({
        type: "note",
        id,
        title,
        target: attach ? endpointValue(attach, scopes) : undefined,
      }, statement)];
    }

    if (constructor.type === "code") {
      if (statement.arguments.length !== 1 || typeof statement.arguments[0] !== "string") {
        throw new Error(`code block '${id}' requires one source string`);
      }
      const unsupported = statement.statements.filter((child) => child.type !== "property");
      if (unsupported.length) throw new Error(`code block '${id}' may contain only properties`);
      const unsupportedProperties = [...properties.keys()].filter((name) => (
        !["language", "title", "line-numbers", "highlight"].includes(name)
      ));
      if (unsupportedProperties.length) {
        throw new Error(`code block '${id}' has unsupported properties: ${unsupportedProperties.join(", ")}`);
      }
      return [copySpan({
        type: "code",
        id,
        value: codeValue(statement.arguments[0]),
        language: properties.get("language"),
        title: properties.get("title"),
        lineNumbers: normalizePropertyValue(properties.get("line-numbers") ?? true),
        highlight: normalizePropertyValue(properties.get("highlight") ?? false),
      }, statement)];
    }

    if (constructor.type === "freedraw") {
      if (statement.arguments.length) throw new Error(`freedraw '${id}' does not accept constructor arguments`);
      const unsupported = statement.statements.filter((child) => child.type !== "property");
      if (unsupported.length) throw new Error(`freedraw '${id}' may contain only properties`);
      const allowed = new Set([
        "at", "points", "pressures", "simulate-pressure", "style", "stroke", "background",
        "stroke-width", "roughness", "fill-style", "opacity", "locked", "link",
      ]);
      const unsupportedProperties = [...properties.keys()].filter((name) => !allowed.has(name));
      if (unsupportedProperties.length) {
        throw new Error(`freedraw '${id}' has unsupported properties: ${unsupportedProperties.join(", ")}`);
      }
      if (!properties.has("at") || !properties.has("points")) {
        throw new Error(`freedraw '${id}' requires at and points properties`);
      }
      const pressures = properties.get("pressures");
      return [copySpan({
        type: "freedraw",
        id,
        at: properties.get("at"),
        points: properties.get("points"),
        pressures: pressures ?? [],
        simulatePressure: normalizePropertyValue(
          properties.get("simulate-pressure") ?? (pressures === undefined),
        ),
        attributes,
      }, statement)];
    }

    if (constructor.type === "node") {
      delete attributes.align;
      delete attributes["vertical-align"];
      const body = properties.has("body")
        ? [copySpan({ type: "body", value: properties.get("body") }, statement)]
        : [];
      const textAlignment = properties.has("align")
        ? [copySpan({ type: "text-align", value: properties.get("align") }, statement)]
        : [];
      const verticalAlignment = properties.has("vertical-align")
        ? [copySpan({ type: "vertical-align", value: properties.get("vertical-align") }, statement)]
        : [];
      return [copySpan({
        type: "node",
        kind: constructor.kind,
        id,
        title,
        tone: tone ?? constructor.tone,
        attributes,
        at: properties.get("at"),
        size: properties.get("size") ?? (constructor.kind === "junction" ? [20, 20] : undefined),
        statements: [...body, ...textAlignment, ...verticalAlignment, ...children],
      }, statement)];
    }
    if (constructor.type === "text") {
      delete attributes.align;
      delete attributes["wrap-width"];
      delete attributes["font-size"];
      if (!properties.has("at")) {
        return [copySpan({
          type: "layout-text",
          id,
          value: title,
          width: properties.get("wrap-width"),
          align: properties.get("align") ?? "left",
          fontSize: properties.get("font-size"),
          attributes,
        }, statement)];
      }
      return [copySpan({
        type: "text",
        id,
        value: title,
        at: properties.get("at"),
        width: properties.get("wrap-width"),
        align: properties.get("align") ?? "left",
        fontSize: properties.get("font-size"),
        attributes,
      }, statement)];
    }
    return [copySpan({
      type: constructor.type,
      id,
      title,
      attributes: {
        ...attributes,
        ...(statement.constructor === "group" ? { invisible: true } : {}),
      },
      statements: children,
    }, statement)];
  });
}

export function lowerSyntax(sourceDocument) {
  const imports = new Map();
  for (const import_ of sourceDocument.imports) {
    if (imports.has(import_.alias)) throw new Error(`duplicate import alias '${import_.alias}'`);
    imports.set(import_.alias, import_.source);
  }
  const components = new Map(sourceDocument.diagram.statements
    .filter((statement) => statement.type === "declaration" && statement.constructor === "component")
    .map((statement) => [statement.id, statement]));
  const document = copySpan({
    type: "diagram",
    title: sourceDocument.diagram.title,
    statements: lowerScope(sourceDocument.diagram.statements, [], [], imports, components),
  }, sourceDocument.diagram);
  Object.defineProperties(document, {
    source: { value: sourceDocument.source, enumerable: false },
    comments: { value: sourceDocument.comments, enumerable: false },
  });
  return document;
}

export function parseSource(source) {
  return lowerSyntax(parseSyntax(source));
}
