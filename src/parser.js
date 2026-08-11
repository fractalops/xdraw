import { SyntaxError, tokenize } from "./tokenizer.js";

const TONES = new Set(["neutral", "success", "danger", "warning", "info", "accent"]);
const NODE_KINDS = new Set(["card", "person", "system", "database", "decision", "ellipse", "junction"]);

export function parse(source) {
  const tokens = tokenize(source);
  let index = 0;

  const peek = (type, value) => {
    const token = tokens[index];
    return token.type === type && (value === undefined || token.value === value);
  };
  const take = (type, value, message) => {
    const token = tokens[index];
    if (!peek(type, value)) {
      throw new SyntaxError(message ?? `expected ${value ?? type}`, source, token.offset);
    }
    index += 1;
    return token;
  };
  const identifier = (value, message) => take("identifier", value, message).value;
  const string = () => take("string", undefined, "expected a quoted string").value;

  function withSpan(value, start, end) {
    Object.defineProperty(value, "span", {
      value: {
        start: { offset: start.offset, ...start.start },
        end: { offset: end.end, ...end.finish },
      },
      enumerable: false,
    });
    return value;
  }

  function pair(label) {
    take("(", undefined, `expected '(' after ${label}`);
    const first = take("number", undefined, `expected ${label} x value`).value;
    take(",", undefined, `expected ',' in ${label}`);
    const second = take("number", undefined, `expected ${label} y value`).value;
    take(")", undefined, `expected ')' after ${label}`);
    return [first, second];
  }

  function selection(label) {
    take("(", undefined, `expected '(' after ${label}`);
    const ids = [identifier(undefined, `expected an element id in ${label}`)];
    while (peek(",")) {
      take(",");
      ids.push(identifier(undefined, `expected an element id in ${label}`));
    }
    take(")", undefined, `expected ')' after ${label}`);
    return ids;
  }

  function parameters(label) {
    take("(", undefined, `expected '(' after ${label}`);
    const names = [];
    while (!peek(")")) {
      names.push(identifier(undefined, `expected a parameter name in ${label}`));
      if (peek(",")) take(",");
      else if (!peek(")")) throw new SyntaxError("expected ',' or ')'", source, tokens[index].offset);
    }
    take(")");
    return names;
  }

  function attributes() {
    const result = {};
    if (!peek("[")) return result;
    take("[");
    while (!peek("]")) {
      const key = identifier();
      let value = true;
      if (peek("=")) {
        take("=");
        const token = tokens[index];
        if (!["identifier", "string", "number"].includes(token.type)) {
          throw new SyntaxError("expected an attribute value", source, token.offset);
        }
        index += 1;
        value = token.value;
      }
      result[key] = value;
      if (key === "route" && value === "around" && peek("identifier")) {
        result[key] = `around ${identifier()}`;
      }
      if (peek(",")) take(",");
      else if (!peek("]")) throw new SyntaxError("expected ',' or ']'", source, tokens[index].offset);
    }
    take("]");
    return result;
  }

  function block(context) {
    take("{", undefined, "expected '{'");
    const statements = [];
    while (!peek("}")) {
      if (peek("eof")) throw new SyntaxError("unterminated block", source, tokens[index].offset);
      statements.push(statement(context));
    }
    take("}");
    return statements;
  }

  function statement(context = "document") {
    const start = tokens[index];
    const value = parseStatement(context);
    return withSpan(value, start, tokens[Math.max(0, index - 1)]);
  }

  function parseStatement(context = "document") {
    const first = take("identifier", undefined, "expected a statement");
    if (first.value === "subtitle") return { type: "subtitle", value: string() };
    if (first.value === "import") return { type: "import", path: string() };
    if (first.value === "asset") {
      const id = identifier(undefined, "expected asset name");
      return { type: "asset", id, source: string(), attributes: attributes() };
    }
    if (first.value === "image" || first.value === "icon") {
      const id = identifier(undefined, `expected ${first.value} id`);
      const asset = identifier(undefined, `expected ${first.value} asset name`);
      identifier("at", `expected 'at' and an ${first.value} position`);
      const at = pair("at");
      identifier("size", `expected 'size' and an ${first.value} size`);
      return { type: first.value, id, asset, at, size: pair("size"), attributes: attributes() };
    }
    if (first.value === "component") {
      const id = identifier(undefined, "expected component name");
      return { type: "component", id, parameters: parameters(`component ${id}`), statements: block("component") };
    }
    if (first.value === "use") {
      const component = identifier(undefined, "expected component name");
      const id = identifier(undefined, "expected use-site id");
      return { type: "use", component, id, arguments: attributes() };
    }
    if (first.value === "theme") return { type: "theme", statements: block("theme") };
    if (first.value === "style") {
      const id = identifier(undefined, "expected style name");
      return { type: "style", id, statements: block("style") };
    }
    if (["theme", "style"].includes(context)) {
      const token = tokens[index];
      if (!["identifier", "string", "number"].includes(token.type)) {
        throw new SyntaxError("expected style value", source, token.offset);
      }
      index += 1;
      return { type: "property", key: first.value, value: token.value };
    }
    if (first.value === "lane") {
      const id = identifier(undefined, "expected lane id");
      return { type: "lane", id, title: string(), statements: block("lane") };
    }
    if (first.value === "group") {
      const id = identifier(undefined, "expected group id");
      return { type: "group", id, title: string(), statements: block("group") };
    }
    if (first.value === "frame") {
      const id = identifier(undefined, "expected frame id");
      const title = string();
      return { type: "frame", id, title, attributes: attributes(), statements: block("frame") };
    }
    if (first.value === "tree") {
      const id = identifier(undefined, "expected tree id");
      const title = string();
      const treeAttributes = attributes();
      return { type: "tree", id, title, section: treeAttributes.section, statements: block("tree") };
    }
    if (first.value === "branch" || first.value === "leaf") {
      if (context !== "tree") throw new SyntaxError(`${first.value} is only valid inside a tree`, source, first.offset);
      const id = identifier(undefined, `expected ${first.value} id`);
      const title = string();
      const statements = first.value === "branch" ? block("tree") : [];
      return { type: first.value, id, title, statements };
    }
    if (first.value === "sequence") {
      return { type: "sequence", statements: block("sequence") };
    }
    if (first.value === "participant") {
      if (context !== "sequence") throw new SyntaxError("participant is only valid inside a sequence", source, first.offset);
      return { type: "participant", id: identifier(), title: string() };
    }
    if (first.value === "note") {
      const id = identifier(undefined, "expected note id");
      const title = string();
      if (!peek("identifier", "at")) return { type: "note", id, title };
      identifier("at", "expected 'at' and a target anchor or position");
      if (peek("(")) return { type: "note", id, title, at: pair("at") };
      return { type: "note", id, title, target: identifier(undefined, "expected note target") };
    }
    if (first.value === "callout") {
      const id = identifier(undefined, "expected callout id");
      const title = string();
      let at;
      if (peek("identifier", "at")) {
        identifier("at");
        at = pair("at");
      }
      take("arrow", undefined, "expected '->' and a callout target");
      return { type: "callout", id, title, at, target: identifier(undefined, "expected callout target") };
    }
    if (first.value === "layout") {
      const kind = identifier(undefined, "expected layout type");
      let gap;
      let columns;
      let spacing;
      while (peek("identifier", "gap") || peek("identifier", "columns") || peek("identifier", "spacing")) {
        const option = identifier();
        if (option === "spacing") {
          if (spacing !== undefined) throw new SyntaxError("layout spacing may be declared only once", source, first.offset);
          spacing = identifier(undefined, "expected spacing preset");
        } else if (option === "gap") {
          const value = take("number", undefined, `expected numeric ${option}`).value;
          if (gap !== undefined) throw new SyntaxError("layout gap may be declared only once", source, first.offset);
          gap = value;
        } else {
          const value = take("number", undefined, `expected numeric ${option}`).value;
          if (columns !== undefined) throw new SyntaxError("layout columns may be declared only once", source, first.offset);
          if (!Number.isInteger(value) || value < 1) throw new SyntaxError("layout columns must be a positive integer", source, first.offset);
          columns = value;
        }
      }
      return { type: "layout", kind, gap, columns, spacing };
    }
    if (first.value === "align") {
      const mode = identifier(undefined, "expected an alignment mode");
      return { type: "alignment", mode, ids: selection(`align ${mode}`) };
    }
    if (first.value === "distribute") {
      const axis = identifier(undefined, "expected distribution axis 'x' or 'y'");
      return { type: "distribution", axis, ids: selection(`distribute ${axis}`) };
    }
    if (first.value === "offset") {
      const ids = selection("offset");
      identifier("by", "expected 'by' and an offset");
      return { type: "offset", ids, by: pair("offset") };
    }
    if (first.value === "match-size") {
      const ids = selection("match-size");
      const axis = peek("identifier") ? identifier() : "both";
      return { type: "match-size", ids, axis };
    }
    if (first.value === "rotate") {
      const ids = selection("rotate");
      return { type: "rotation", ids, degrees: take("number", undefined, "expected rotation in degrees").value };
    }
    if (first.value === "snap") {
      const ids = selection("snap");
      identifier("to", "expected 'to' and a grid size");
      return { type: "snap", ids, grid: take("number", undefined, "expected grid size").value };
    }
    if (first.value === "text") {
      const id = identifier(undefined, "expected text id");
      const value = string();
      identifier("at", "expected 'at' and a text position");
      const at = pair("at");
      let width;
      let align = "left";
      let fontSize;
      while (peek("identifier", "width") || peek("identifier", "align") || peek("identifier", "font")) {
        const property = identifier();
        if (property === "width") width = take("number", undefined, "expected text width").value;
        else if (property === "font") fontSize = take("number", undefined, "expected font size").value;
        else align = identifier(undefined, "expected text alignment");
      }
      return { type: "text", id, value, at, width, align, fontSize, attributes: attributes() };
    }
    if (first.value === "text-align") {
      if (context !== "card") throw new SyntaxError("text-align is only valid inside a node", source, first.offset);
      return { type: "text-align", value: identifier(undefined, "expected text alignment") };
    }
    if (first.value === "vertical-align") {
      if (context !== "card") throw new SyntaxError("vertical-align is only valid inside a node", source, first.offset);
      return { type: "vertical-align", value: identifier(undefined, "expected vertical alignment") };
    }
    if (first.value === "body") return { type: "body", value: string() };
    if (first.value === "when") {
      if (context !== "decision") throw new SyntaxError("when is only valid inside a decision node", source, first.offset);
      const label = string();
      take("arrow", undefined, "expected '->' and a decision target");
      return { type: "decision-branch", label, target: identifier(undefined, "expected decision target") };
    }
    if (peek(":")) {
      take(":");
      const kind = identifier(undefined, "expected node kind");
      if (!NODE_KINDS.has(kind)) throw new SyntaxError(`unsupported node kind '${kind}'`, source, first.offset);
      const title = string();
      let tone;
      if (peek("identifier") && TONES.has(tokens[index].value)) tone = identifier();
      const nodeAttributes = attributes();
      let at;
      let size;
      while (peek("identifier", "at") || peek("identifier", "size")) {
        const property = identifier();
        if (property === "at") at = pair("at");
        else size = pair("size");
      }
      const statements = peek("{") ? block(kind === "decision" ? "decision" : "card") : [];
      return {
        type: "node", kind, id: first.value, title, tone, attributes: nodeAttributes, at,
        size: size ?? (kind === "junction" ? [20, 20] : undefined), statements,
      };
    }
    if (peek("arrow")) {
      const nodes = [first.value];
      while (peek("arrow")) {
        take("arrow");
        nodes.push(identifier(undefined, "expected node id after '->'"));
      }
      const label = peek("string") ? string() : undefined;
      return { type: "connection", nodes, label, attributes: attributes() };
    }
    throw new SyntaxError(`unknown statement '${first.value}'`, source, first.offset);
  }

  let document;
  if (peek("identifier", "diagram")) {
    const start = tokens[index];
    identifier("diagram");
    document = { type: "diagram", title: string(), statements: block("document") };
    withSpan(document, start, tokens[Math.max(0, index - 1)]);
  } else {
    const start = tokens[index];
    const statements = [];
    while (!peek("eof")) statements.push(statement());
    document = { type: "diagram", title: undefined, statements };
    withSpan(document, start, tokens[Math.max(0, index - 1)]);
  }
  take("eof", undefined, "unexpected content after diagram");
  Object.defineProperties(document, {
    source: { value: source, enumerable: false },
    comments: { value: tokens.comments, enumerable: false },
    tokens: { value: tokens, enumerable: false },
  });
  return document;
}
