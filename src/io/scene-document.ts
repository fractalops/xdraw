import { parseSource } from "../language/parser.ts";
import { SyntaxError, tokenize } from "../language/tokenizer.ts";
import type { DiagramDocument } from "../semantic-contracts.ts";
import type { Token, TokenList } from "../foundation-contracts.ts";
import type { ToneName } from "../excalidraw/components.ts";

const UPDATE_PROPERTY_NAMES = [
  "tone", "title", "stroke", "background", "text", "stroke-width", "opacity",
  "x", "y", "width", "height", "angle",
] as const;

type SceneUpdateProperty = typeof UPDATE_PROPERTY_NAMES[number];

const UPDATE_PROPERTIES: ReadonlySet<string> = new Set(UPDATE_PROPERTY_NAMES);
const NUMERIC_UPDATE_PROPERTIES: ReadonlySet<string> = new Set([
  "stroke-width", "opacity", "x", "y", "width", "height", "angle",
]);
const TONES: ReadonlySet<string> = new Set(["neutral", "success", "danger", "warning", "info", "accent"]);

export interface SceneResource {
  provider: "excalidraw";
  workspace: string;
  collection: string;
  scene: string;
}

export interface SceneUpdate {
  target: string;
  properties: SceneUpdateProperties;
}

export interface SceneUpdateProperties {
  tone?: ToneName;
  title?: string;
  stroke?: string;
  background?: string;
  text?: string;
  "stroke-width"?: number;
  opacity?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
}

export interface SceneReplaceOperation {
  type: "replace";
  diagram: DiagramDocument;
}

export type SceneAdditionDocument = Omit<DiagramDocument, "title"> & { title?: string };

export interface ScenePatchOperation {
  type: "patch";
  updates: SceneUpdate[];
  deletes: string[];
  additions?: SceneAdditionDocument;
}

export type SceneOperation = SceneReplaceOperation | ScenePatchOperation;

export interface SceneDocument {
  type: "scene-document";
  resource: SceneResource;
  operation: SceneOperation;
  readonly source: string;
  readonly tokens: TokenList;
}

function attachSource(
  document: Omit<SceneDocument, "source" | "tokens">,
  source: string,
  tokens: TokenList,
): SceneDocument {
  Object.defineProperties(document, {
    source: { value: source, enumerable: false },
    tokens: { value: tokens, enumerable: false },
  });
  return document as SceneDocument;
}

function parseAdditions(source: string): SceneAdditionDocument {
  const tokens = tokenize(source);
  let index = 0;
  let importsEnd = 0;
  while (tokens[index]?.type === "identifier" && tokens[index].value === "use") {
    index += 1;
    if (tokens[index]?.type !== "string") break;
    index += 1;
    if (tokens[index]?.type !== "identifier" || tokens[index].value !== "as") break;
    index += 1;
    if (tokens[index]?.type !== "identifier") break;
    importsEnd = tokens[index].end;
    index += 1;
  }
  const imports = source.slice(0, importsEnd);
  const statements = source.slice(importsEnd);
  const additions: SceneAdditionDocument = parseSource(`${imports}\ndiagram "" {${statements}}`);
  additions.title = undefined;
  return additions;
}

function updateValue(
  property: SceneUpdateProperty,
  token: Token,
  source: string,
): string | number {
  if (NUMERIC_UPDATE_PROPERTIES.has(property)) {
    if (typeof token.value !== "number" || !Number.isFinite(token.value)) {
      throw new SyntaxError(`update property '${property}' requires a number`, source, token.offset);
    }
    return token.value;
  }
  if (typeof token.value !== "string") {
    throw new SyntaxError(`update property '${property}' requires text`, source, token.offset);
  }
  if (property === "tone" && !TONES.has(token.value)) {
    throw new SyntaxError(`unsupported tone '${token.value}'`, source, token.offset);
  }
  return token.value;
}

export function formatSceneResource(resource: SceneResource): string {
  if (!resource || typeof resource !== "object") throw new TypeError("scene resource must be an object");
  const values = [resource.provider, resource.workspace, resource.collection, resource.scene];
  if (values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new TypeError("scene resource segments must be non-empty strings");
  }
  if (values.some((value) => value.includes(":"))) {
    throw new TypeError("scene resource segments must not contain ':'");
  }
  if (resource.provider !== "excalidraw") {
    throw new TypeError(`unsupported scene provider '${String(resource.provider)}'`);
  }
  return [resource.provider, resource.workspace, resource.collection, resource.scene].join("::");
}

export function parseSceneResource(value: string): SceneResource {
  if (typeof value !== "string") throw new TypeError("scene resource must be text");
  const [provider, workspace, collection, scene, ...extra] = value.split("::");
  if (extra.length || !provider || !workspace || !collection || !scene) {
    throw new TypeError("scene resource must be provider::workspace::collection::scene");
  }
  if ([provider, workspace, collection, scene].some((segment) => segment.includes(":"))) {
    throw new TypeError("scene resource segments must not contain ':'");
  }
  if (provider !== "excalidraw") throw new TypeError(`unsupported scene provider '${provider}'`);
  return {
    provider,
    workspace,
    collection,
    scene,
  };
}

export function parseSceneDocument(source: string): SceneDocument {
  if (typeof source !== "string") throw new TypeError("scene document source must be a string");
  const tokens = tokenize(source);
  let index = 0;
  const peek = (type: Token["type"], value?: Token["value"]): boolean => tokens[index].type === type
    && (value === undefined || tokens[index].value === value);
  const take = (type: Token["type"], value?: Token["value"], message?: string): Token => {
    const current = tokens[index];
    if (!peek(type, value)) throw new SyntaxError(message ?? `expected ${value ?? type}`, source, current.offset);
    index += 1;
    return current;
  };
  const word = (value?: string, message?: string): string => String(take("identifier", value, message).value);

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
  const [provider, workspace, collection, scene] = parts;
  if (provider !== "excalidraw") {
    throw new SyntaxError(`unsupported scene provider '${provider}'`, source, tokens[1].offset);
  }
  const resource: SceneResource = { provider, workspace, collection, scene };
  take("{", undefined, "expected '{' after scene resource");
  const parsedMode = word(undefined, "expected 'replace' or 'patch'");
  if (parsedMode !== "replace" && parsedMode !== "patch") {
    throw new SyntaxError("expected 'replace' or 'patch'", source, tokens[index - 1].offset);
  }
  const mode: SceneOperation["type"] = parsedMode;
  take("{", undefined, `expected '{' after ${mode}`);

  let operation: SceneOperation;
  if (mode === "replace") {
    const start = tokens[index];
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
    const content = source.slice(start.offset, end.end);
    if (!content.trim()) throw new SyntaxError("replace must contain one diagram", source, start.offset);
    const diagram = parseSource(content);
    operation = { type: "replace", diagram };
  } else {
    const updates: SceneUpdate[] = [];
    const deletes: string[] = [];
    let additions: SceneAdditionDocument | undefined;
    while (!peek("}")) {
      const action = word(undefined, "expected add, update, or delete");
      if (action === "update") {
        const target = word(undefined, "expected update target");
        take("{", undefined, "expected '{' after update target");
        const properties: SceneUpdateProperties = {};
        while (!peek("}")) {
          const keyToken = take("identifier", undefined, "expected update property");
          const key = String(keyToken.value);
          if (!UPDATE_PROPERTIES.has(key)) {
            throw new SyntaxError(`unsupported update property '${key}'`, source, keyToken.offset);
          }
          const property = key as SceneUpdateProperty;
          const valueToken = tokens[index];
          if (!["identifier", "string", "number"].includes(valueToken.type)) {
            throw new SyntaxError(`expected a value for '${key}'`, source, valueToken.offset);
          }
          index += 1;
          if (Object.hasOwn(properties, property)) {
            throw new SyntaxError(`update property '${key}' is declared more than once`, source, keyToken.offset);
          }
          Object.assign(properties, { [property]: updateValue(property, valueToken, source) });
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
        additions = parseAdditions(content);
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
