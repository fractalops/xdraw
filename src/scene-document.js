import { parse } from "./parser.js";
import { SyntaxError, tokenize } from "./tokenizer.js";

const UPDATE_PROPERTIES = new Set([
  "tone", "title", "stroke", "background", "text", "stroke-width", "opacity",
  "x", "y", "width", "height", "angle",
]);

function attachSource(document, source, tokens) {
  Object.defineProperties(document, {
    source: { value: source, enumerable: false },
    tokens: { value: tokens, enumerable: false },
  });
  return document;
}

export function formatSceneResource(resource) {
  return [resource.provider, resource.workspace, resource.collection, resource.scene].join("::");
}

export function parseSceneDocument(source) {
  const tokens = tokenize(source);
  let index = 0;
  const peek = (type, value) => tokens[index].type === type
    && (value === undefined || tokens[index].value === value);
  const take = (type, value, message) => {
    const current = tokens[index];
    if (!peek(type, value)) throw new SyntaxError(message ?? `expected ${value ?? type}`, source, current.offset);
    index += 1;
    return current;
  };
  const word = (value, message) => take("identifier", value, message).value;

  word("scene", "expected 'scene'");
  const parts = [word(undefined, "expected scene provider")];
  while (peek("namespace")) {
    take("namespace");
    parts.push(word(undefined, "expected resource segment after '::'"));
  }
  if (parts.length !== 4) {
    throw new SyntaxError(
      "scene resource must be provider::workspace::collection::scene",
      source,
      tokens[Math.max(0, index - 1)].offset,
    );
  }
  const resource = {
    provider: parts[0], workspace: parts[1], collection: parts[2], scene: parts[3],
  };
  if (resource.provider !== "excalidraw") {
    throw new SyntaxError(`unsupported scene provider '${resource.provider}'`, source, tokens[1].offset);
  }
  take("{", undefined, "expected '{' after scene resource");
  const mode = word(undefined, "expected 'replace' or 'patch'");
  if (!["replace", "patch"].includes(mode)) {
    throw new SyntaxError("expected 'replace' or 'patch'", source, tokens[index - 1].offset);
  }
  take("{", undefined, `expected '{' after ${mode}`);

  let operation;
  if (mode === "replace") {
    const start = tokens[index];
    if (!peek("identifier", "diagram")) {
      throw new SyntaxError("replace must contain one diagram", source, start.offset);
    }
    let depth = 0;
    let end = start;
    while (!peek("eof")) {
      const current = tokens[index];
      if (current.type === "{") depth += 1;
      if (current.type === "}") {
        if (depth === 0) break;
        depth -= 1;
      }
      end = current;
      index += 1;
    }
    const diagram = parse(source.slice(start.offset, end.end));
    operation = { type: "replace", diagram };
  } else {
    const updates = [];
    const deletes = [];
    let additions;
    while (!peek("}")) {
      const action = word(undefined, "expected add, update, or delete");
      if (action === "update") {
        const target = word(undefined, "expected update target");
        take("{", undefined, "expected '{' after update target");
        const properties = {};
        while (!peek("}")) {
          const keyToken = take("identifier", undefined, "expected update property");
          const key = keyToken.value;
          if (!UPDATE_PROPERTIES.has(key)) {
            throw new SyntaxError(`unsupported update property '${key}'`, source, keyToken.offset);
          }
          const valueToken = tokens[index];
          if (!["identifier", "string", "number"].includes(valueToken.type)) {
            throw new SyntaxError(`expected a value for '${key}'`, source, valueToken.offset);
          }
          index += 1;
          if (Object.hasOwn(properties, key)) {
            throw new SyntaxError(`update property '${key}' is declared more than once`, source, keyToken.offset);
          }
          properties[key] = valueToken.value;
        }
        take("}");
        updates.push({ target, properties });
      } else if (action === "delete") {
        deletes.push(word(undefined, "expected delete target"));
      } else if (action === "add") {
        if (additions) throw new SyntaxError("patch may contain only one add block", source, tokens[index - 1].offset);
        const open = take("{", undefined, "expected '{' after add");
        const contentStart = open.end;
        let depth = 1;
        let close;
        while (depth > 0 && !peek("eof")) {
          const current = tokens[index];
          index += 1;
          if (current.type === "{") depth += 1;
          if (current.type === "}") depth -= 1;
          if (depth === 0) close = current;
        }
        if (!close) throw new SyntaxError("unterminated add block", source, open.offset);
        const content = source.slice(contentStart, close.offset);
        if (!content.trim()) throw new SyntaxError("add block must contain diagram elements", source, contentStart);
        additions = parse(content);
      } else {
        throw new SyntaxError(`unknown patch action '${action}'`, source, tokens[index - 1].offset);
      }
    }
    if (!updates.length && !deletes.length && !additions) {
      throw new SyntaxError("patch must add, update, or delete at least one element", source, tokens[index].offset);
    }
    const duplicateUpdate = updates.find((item, position) => updates.findIndex((other) => other.target === item.target) !== position);
    if (duplicateUpdate) throw new SyntaxError(`duplicate update target '${duplicateUpdate.target}'`, source, tokens[index].offset);
    const duplicateDelete = deletes.find((item, position) => deletes.indexOf(item) !== position);
    if (duplicateDelete) throw new SyntaxError(`duplicate delete target '${duplicateDelete}'`, source, tokens[index].offset);
    const conflict = updates.find((item) => deletes.includes(item.target));
    if (conflict) throw new SyntaxError(`patch cannot update and delete '${conflict.target}'`, source, tokens[index].offset);
    operation = { type: "patch", updates, deletes, additions };
  }

  take("}", undefined, `expected '}' after ${mode}`);
  take("}", undefined, "expected '}' after scene document");
  take("eof", undefined, "unexpected content after scene document");
  return attachSource({ type: "scene-document", resource, operation }, source, tokens);
}
