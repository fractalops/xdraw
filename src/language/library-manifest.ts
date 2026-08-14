import type { ToneName } from "../excalidraw/components.ts";
import type { ConstructorDefinition } from "./registry.ts";

export type ManifestValueKind =
  | "string"
  | "raw-string"
  | "identifier"
  | "number"
  | "boolean"
  | "pair"
  | "points"
  | "numbers"
  | "endpoint";

export type LibraryValueKind = "tone";

export type ManifestSemanticKind = ConstructorDefinition["type"];

export type ManifestElementKind =
  | "architecture-component"
  | "architecture-container"
  | "architecture-container-boundary"
  | "architecture-database"
  | "architecture-deployment-node"
  | "architecture-external-system"
  | "architecture-group"
  | "architecture-person"
  | "architecture-queue"
  | "architecture-system"
  | "architecture-system-boundary"
  | "card"
  | "code"
  | "decision"
  | "ellipse"
  | "frame"
  | "freedraw"
  | "icon"
  | "image"
  | "junction"
  | "lane"
  | "formula"
  | "note"
  | "participant"
  | "section"
  | "sequence"
  | "table"
  | "text";

export type ManifestTone = ToneName;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface ManifestDocumentation {
  readonly synopsis: string;
  readonly examples: readonly string[];
}

export interface ConstructorArgumentManifest {
  readonly name: string;
  readonly kind: ManifestValueKind;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly synopsis: string;
}

export interface ConstructorPropertyManifest {
  readonly name: string;
  readonly kind: ManifestValueKind;
  readonly required: boolean;
  readonly synopsis: string;
}

export interface ChildRoleManifest {
  readonly name: string;
  readonly accepts: readonly string[];
  readonly minimum: number;
  readonly maximum: number | null;
  readonly synopsis: string;
}

export type ChildPolicyManifest =
  | { readonly mode: "none"; readonly roles: readonly [] }
  | { readonly mode: "roles"; readonly roles: readonly ChildRoleManifest[] };

export interface ConstructorDefaultsManifest {
  readonly properties: Readonly<Record<string, JsonValue>>;
}

export interface ConstructorLoweringManifest {
  readonly semanticKind: ManifestSemanticKind;
  readonly elementKind: ManifestElementKind | null;
  readonly tone: ManifestTone | null;
}

export interface ConstructorManifest {
  readonly name: string;
  readonly identity: "named" | "anonymous";
  readonly arguments: readonly ConstructorArgumentManifest[];
  readonly properties: readonly ConstructorPropertyManifest[];
  readonly children: ChildPolicyManifest;
  readonly defaults: ConstructorDefaultsManifest;
  readonly lowering: ConstructorLoweringManifest;
  readonly documentation: ManifestDocumentation;
}

export interface LibraryValueManifest {
  readonly name: string;
  readonly kind: LibraryValueKind;
  readonly synopsis: string;
}

export interface LibraryManifest {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly documentation: ManifestDocumentation;
  readonly constructors: readonly ConstructorManifest[];
  readonly values: readonly LibraryValueManifest[];
}

export interface LibraryManifestSummary {
  readonly name: string;
  readonly synopsis: string;
  readonly constructors: readonly string[];
  readonly values: readonly string[];
}

export class LibraryManifestError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "LibraryManifestError";
    this.path = path;
  }
}

const VALUE_KINDS = new Set<ManifestValueKind>([
  "string",
  "raw-string",
  "identifier",
  "number",
  "boolean",
  "pair",
  "points",
  "numbers",
  "endpoint",
]);

const SEMANTIC_KIND_SUPPORT = {
  asset: true,
  code: true,
  frame: true,
  freedraw: true,
  group: true,
  icon: true,
  image: true,
  lane: true,
  node: true,
  note: true,
  participant: true,
  section: true,
  sequence: true,
  "table-header": true,
  "table-row": true,
  style: true,
  template: true,
  text: true,
  theme: true,
} as const satisfies Readonly<Record<ManifestSemanticKind, true>>;

const ELEMENT_KINDS = new Set<ManifestElementKind>([
  "architecture-component",
  "architecture-container",
  "architecture-container-boundary",
  "architecture-database",
  "architecture-deployment-node",
  "architecture-external-system",
  "architecture-group",
  "architecture-person",
  "architecture-queue",
  "architecture-system",
  "architecture-system-boundary",
  "card",
  "code",
  "decision",
  "ellipse",
  "formula",
  "frame",
  "freedraw",
  "icon",
  "image",
  "junction",
  "lane",
  "note",
  "participant",
  "section",
  "sequence",
  "table",
  "text",
]);

const TONE_SUPPORT = {
  accent: true,
  danger: true,
  info: true,
  neutral: true,
  success: true,
  warning: true,
} as const satisfies Readonly<Record<ManifestTone, true>>;

const SEMANTIC_KINDS = new Set<ManifestSemanticKind>(
  Object.keys(SEMANTIC_KIND_SUPPORT) as ManifestSemanticKind[],
);
const TONES = new Set<ManifestTone>(Object.keys(TONE_SUPPORT) as ManifestTone[]);

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/u;
const LIBRARY_PATTERN = /^xdraw\/[a-z][a-z0-9-]*$/u;

function fail(path: string, message: string): never {
  throw new LibraryManifestError(path, message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key)).sort();
  if (unknown.length > 0) fail(path, `contains unknown field(s): ${unknown.join(", ")}`);
  const missing = allowed.filter((key) => !(key in value));
  if (missing.length > 0) fail(path, `is missing field(s): ${missing.join(", ")}`);
}

function string(value: unknown, path: string, pattern?: RegExp): string {
  if (typeof value !== "string" || value.trim() === "") fail(path, "must be a non-empty string");
  if (pattern && !pattern.test(value)) fail(path, `has invalid value '${value}'`);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  return value;
}

function integer(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(path, "must be a non-negative safe integer");
  return value as number;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function closedValue<T extends string>(
  value: unknown,
  path: string,
  supported: ReadonlySet<T>,
): T {
  if (typeof value !== "string" || !supported.has(value as T)) {
    fail(path, `must be one of ${[...supported].join(", ")}`);
  }
  return value as T;
}

function nullableClosedValue<T extends string>(
  value: unknown,
  path: string,
  supported: ReadonlySet<T>,
): T | null {
  if (value === null) return null;
  return closedValue(value, path, supported);
}

function documentation(value: unknown, path: string): ManifestDocumentation {
  const input = record(value, path);
  exactKeys(input, ["synopsis", "examples"], path);
  const examples = array(input.examples, `${path}.examples`).map((item, index) => (
    string(item, `${path}.examples[${index}]`)
  ));
  return { synopsis: string(input.synopsis, `${path}.synopsis`), examples };
}

function valueKind(value: unknown, path: string): ManifestValueKind {
  if (typeof value !== "string" || !VALUE_KINDS.has(value as ManifestValueKind)) {
    fail(path, `must be one of ${[...VALUE_KINDS].join(", ")}`);
  }
  return value as ManifestValueKind;
}

function jsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "must contain only finite JSON numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${path}[${index}]`));
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(input).sort().map((key) => [key, jsonValue(input[key], `${path}.${key}`)]),
    );
  }
  fail(path, "must be JSON-serializable data");
}

function matchesKind(value: JsonValue, kind: ManifestValueKind): boolean {
  if (kind === "string" || kind === "raw-string" || kind === "identifier") return typeof value === "string";
  if (kind === "number") return typeof value === "number";
  if (kind === "boolean") return typeof value === "boolean";
  if (kind === "pair") {
    return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "number");
  }
  if (kind === "numbers") return Array.isArray(value) && value.every((item) => typeof item === "number");
  if (kind === "points") {
    return Array.isArray(value) && value.every((point) => (
      Array.isArray(point) && point.length === 2 && point.every((item) => typeof item === "number")
    ));
  }
  return false;
}

function uniqueNames(items: readonly { readonly name: string }[], path: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.name)) fail(path, `contains duplicate name '${item.name}'`);
    seen.add(item.name);
  }
}

function argument(value: unknown, path: string): ConstructorArgumentManifest {
  const input = record(value, path);
  exactKeys(input, ["name", "kind", "required", "variadic", "synopsis"], path);
  return {
    name: string(input.name, `${path}.name`, NAME_PATTERN),
    kind: valueKind(input.kind, `${path}.kind`),
    required: boolean(input.required, `${path}.required`),
    variadic: boolean(input.variadic, `${path}.variadic`),
    synopsis: string(input.synopsis, `${path}.synopsis`),
  };
}

function property(value: unknown, path: string): ConstructorPropertyManifest {
  const input = record(value, path);
  exactKeys(input, ["name", "kind", "required", "synopsis"], path);
  return {
    name: string(input.name, `${path}.name`, NAME_PATTERN),
    kind: valueKind(input.kind, `${path}.kind`),
    required: boolean(input.required, `${path}.required`),
    synopsis: string(input.synopsis, `${path}.synopsis`),
  };
}

function childRole(value: unknown, path: string): ChildRoleManifest {
  const input = record(value, path);
  exactKeys(input, ["name", "accepts", "minimum", "maximum", "synopsis"], path);
  const accepts = array(input.accepts, `${path}.accepts`).map((item, index) => (
    string(item, `${path}.accepts[${index}]`, NAME_PATTERN)
  )).sort();
  if (accepts.length === 0) fail(`${path}.accepts`, "must not be empty");
  if (new Set(accepts).size !== accepts.length) fail(`${path}.accepts`, "contains duplicate semantic kinds");
  const minimum = integer(input.minimum, `${path}.minimum`);
  const maximum = input.maximum === null ? null : integer(input.maximum, `${path}.maximum`);
  if (maximum !== null && maximum < minimum) fail(`${path}.maximum`, "must be greater than or equal to minimum");
  return {
    name: string(input.name, `${path}.name`, NAME_PATTERN),
    accepts,
    minimum,
    maximum,
    synopsis: string(input.synopsis, `${path}.synopsis`),
  };
}

function childPolicy(value: unknown, path: string): ChildPolicyManifest {
  const input = record(value, path);
  exactKeys(input, ["mode", "roles"], path);
  if (input.mode !== "none" && input.mode !== "roles") fail(`${path}.mode`, "must be 'none' or 'roles'");
  const roles = array(input.roles, `${path}.roles`).map((item, index) => childRole(item, `${path}.roles[${index}]`));
  uniqueNames(roles, `${path}.roles`);
  roles.sort((left, right) => left.name.localeCompare(right.name));
  if (input.mode === "none") {
    if (roles.length > 0) fail(`${path}.roles`, "must be empty when mode is 'none'");
    return { mode: "none", roles: [] };
  }
  if (roles.length === 0) fail(`${path}.roles`, "must not be empty when mode is 'roles'");
  return { mode: "roles", roles };
}

function defaultsRecord(value: unknown, path: string): Readonly<Record<string, JsonValue>> {
  const input = record(value, path);
  return Object.fromEntries(Object.keys(input).sort().map((key) => [
    string(key, `${path}.${key}`, NAME_PATTERN),
    jsonValue(input[key], `${path}.${key}`),
  ]));
}

function defaults(value: unknown, path: string): ConstructorDefaultsManifest {
  const input = record(value, path);
  exactKeys(input, ["properties"], path);
  return {
    properties: defaultsRecord(input.properties, `${path}.properties`),
  };
}

function lowering(value: unknown, path: string): ConstructorLoweringManifest {
  const input = record(value, path);
  exactKeys(input, ["semanticKind", "elementKind", "tone"], path);
  return {
    semanticKind: closedValue(input.semanticKind, `${path}.semanticKind`, SEMANTIC_KINDS),
    elementKind: nullableClosedValue(input.elementKind, `${path}.elementKind`, ELEMENT_KINDS),
    tone: nullableClosedValue(input.tone, `${path}.tone`, TONES),
  };
}

function validateSignature(
  item: ConstructorManifest,
  path: string,
): void {
  uniqueNames(item.arguments, `${path}.arguments`);
  uniqueNames(item.properties, `${path}.properties`);

  let optionalSeen = false;
  item.arguments.forEach((argumentItem, index) => {
    if (argumentItem.variadic && index !== item.arguments.length - 1) {
      fail(`${path}.arguments[${index}].variadic`, "a variadic argument must be last");
    }
    if (argumentItem.variadic && argumentItem.required) {
      fail(`${path}.arguments[${index}]`, "a variadic argument cannot be required");
    }
    if (!argumentItem.required) optionalSeen = true;
    if (argumentItem.required && optionalSeen) {
      fail(`${path}.arguments[${index}].required`, "a required argument cannot follow an optional argument");
    }
  });

  const propertiesByName = new Map(item.properties.map((entry) => [entry.name, entry]));
  for (const [name, defaultValue] of Object.entries(item.defaults.properties)) {
    const declared = propertiesByName.get(name);
    if (!declared) fail(`${path}.defaults.properties.${name}`, "does not name a declared property");
    if (declared.required) fail(`${path}.defaults.properties.${name}`, "cannot default a required property");
    if (declared.kind === "endpoint") {
      fail(`${path}.defaults.properties.${name}`, "cannot default an endpoint property");
    }
    if (!matchesKind(defaultValue, declared.kind)) fail(`${path}.defaults.properties.${name}`, `must match kind '${declared.kind}'`);
  }
}

function constructorManifest(value: unknown, path: string): ConstructorManifest {
  const input = record(value, path);
  exactKeys(input, ["name", "identity", "arguments", "properties", "children", "defaults", "lowering", "documentation"], path);
  const result: ConstructorManifest = {
    name: string(input.name, `${path}.name`, NAME_PATTERN),
    identity: closedValue(input.identity, `${path}.identity`, new Set(["named", "anonymous"] as const)),
    arguments: array(input.arguments, `${path}.arguments`).map((item, index) => (
      argument(item, `${path}.arguments[${index}]`)
    )),
    properties: array(input.properties, `${path}.properties`).map((item, index) => (
      property(item, `${path}.properties[${index}]`)
    )).sort((left, right) => left.name.localeCompare(right.name)),
    children: childPolicy(input.children, `${path}.children`),
    defaults: defaults(input.defaults, `${path}.defaults`),
    lowering: lowering(input.lowering, `${path}.lowering`),
    documentation: documentation(input.documentation, `${path}.documentation`),
  };
  validateSignature(result, path);
  return result;
}

function libraryValue(value: unknown, path: string): LibraryValueManifest {
  const input = record(value, path);
  exactKeys(input, ["name", "kind", "synopsis"], path);
  if (input.kind !== "tone") fail(`${path}.kind`, "must be 'tone'");
  return {
    name: string(input.name, `${path}.name`, NAME_PATTERN),
    kind: input.kind,
    synopsis: string(input.synopsis, `${path}.synopsis`),
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function defineLibraryManifest(value: unknown): LibraryManifest {
  const input = record(value, "manifest");
  exactKeys(input, ["schemaVersion", "name", "documentation", "constructors", "values"], "manifest");
  if (input.schemaVersion !== 1) fail("manifest.schemaVersion", "must be 1");
  const constructors = array(input.constructors, "manifest.constructors").map((item, index) => (
    constructorManifest(item, `manifest.constructors[${index}]`)
  )).sort((left, right) => left.name.localeCompare(right.name));
  const values = array(input.values, "manifest.values").map((item, index) => (
    libraryValue(item, `manifest.values[${index}]`)
  )).sort((left, right) => left.name.localeCompare(right.name));
  uniqueNames(constructors, "manifest.constructors");
  uniqueNames(values, "manifest.values");
  const constructorNames = new Set(constructors.map(({ name }) => name));
  const collision = values.find(({ name }) => constructorNames.has(name));
  if (collision) fail("manifest", `exports '${collision.name}' as both a constructor and a value`);
  return deepFreeze({
    schemaVersion: 1,
    name: string(input.name, "manifest.name", LIBRARY_PATTERN),
    documentation: documentation(input.documentation, "manifest.documentation"),
    constructors,
    values,
  });
}

export function normalizeLibraryCatalog(values: readonly unknown[]): readonly LibraryManifest[] {
  const manifests = values.map(defineLibraryManifest).sort((left, right) => left.name.localeCompare(right.name));
  const seen = new Set<string>();
  for (const manifest of manifests) {
    if (seen.has(manifest.name)) fail("catalog", `contains duplicate library '${manifest.name}'`);
    seen.add(manifest.name);
  }
  return deepFreeze(manifests);
}

export function manifestForIntrospection(value: unknown): LibraryManifest {
  return defineLibraryManifest(value);
}

export function summarizeLibraryManifest(value: unknown): LibraryManifestSummary {
  const manifest = defineLibraryManifest(value);
  return deepFreeze({
    name: manifest.name,
    synopsis: manifest.documentation.synopsis,
    constructors: manifest.constructors.map((item) => item.name),
    values: manifest.values.map((item) => item.name),
  });
}

const NONE = { mode: "none", roles: [] } as const;
const EMPTY_DEFAULTS = { properties: {} } as const;

const optionalLabel = [{
  name: "label", kind: "string", required: false, variadic: false, synopsis: "Visible label.",
}] as const;
const noArguments = [] as const;
const exampleAsset = "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%221%22%20height=%221%22/%3E";

const positionProperties = [
  { name: "at", kind: "pair", required: false, synopsis: "Absolute position." },
  { name: "size", kind: "pair", required: false, synopsis: "Explicit size." },
] as const;
const visualProperties = [
  ...positionProperties,
  { name: "background", kind: "string", required: false, synopsis: "Background color." },
  { name: "fill-style", kind: "identifier", required: false, synopsis: "Fill style." },
  { name: "font-family", kind: "identifier", required: false, synopsis: "Font family." },
  { name: "font-size", kind: "number", required: false, synopsis: "Font size." },
  { name: "line-height", kind: "number", required: false, synopsis: "Line height." },
  { name: "link", kind: "string", required: false, synopsis: "Hyperlink." },
  { name: "locked", kind: "boolean", required: false, synopsis: "Whether the element is locked." },
  { name: "opacity", kind: "number", required: false, synopsis: "Element opacity." },
  { name: "padding", kind: "number", required: false, synopsis: "Internal padding." },
  { name: "roughness", kind: "number", required: false, synopsis: "Stroke roughness." },
  { name: "stroke", kind: "string", required: false, synopsis: "Stroke color." },
  { name: "stroke-style", kind: "identifier", required: false, synopsis: "Stroke style." },
  { name: "stroke-width", kind: "number", required: false, synopsis: "Stroke width." },
  { name: "style", kind: "identifier", required: false, synopsis: "Named style or palette tone." },
  { name: "text-color", kind: "string", required: false, synopsis: "Text color." },
] as const;
const contentProperties = [
  ...visualProperties,
  { name: "align", kind: "identifier", required: false, synopsis: "Horizontal text alignment." },
  { name: "body", kind: "string", required: false, synopsis: "Secondary text." },
  { name: "body-size", kind: "number", required: false, synopsis: "Body font size." },
  { name: "description", kind: "string", required: false, synopsis: "Semantic description." },
  { name: "technology", kind: "string", required: false, synopsis: "Technology metadata." },
  { name: "title-size", kind: "number", required: false, synopsis: "Title font size." },
  { name: "vertical-align", kind: "identifier", required: false, synopsis: "Vertical text alignment." },
] as const;

const textProperties = [
  ...visualProperties,
  { name: "align", kind: "identifier", required: false, synopsis: "Horizontal text alignment." },
  { name: "auto-size", kind: "boolean", required: false, synopsis: "Automatically size the text box." },
  { name: "wrap-width", kind: "number", required: false, synopsis: "Text wrapping width." },
] as const;

const toneProperty = {
  name: "style", kind: "identifier", required: false, synopsis: "Palette tone.",
} as const;
const frameProperties = [
  { name: "locked", kind: "boolean", required: false, synopsis: "Whether the frame and its children are locked." },
  toneProperty,
] as const;
const visibleContainerProperties = [toneProperty] as const;

const styleProperties = [
  ...visualProperties.filter(({ name }) => name !== "at" && name !== "size" && name !== "style"),
  { name: "auto-size", kind: "boolean", required: false, synopsis: "Automatically size text boxes." },
  { name: "body-size", kind: "number", required: false, synopsis: "Body font size." },
  { name: "title-size", kind: "number", required: false, synopsis: "Title font size." },
  { name: "wrap-width", kind: "number", required: false, synopsis: "Text wrapping width." },
] as const;

function docs(synopsis: string, example: string): ManifestDocumentation {
  return { synopsis, examples: [example] };
}

function simpleConstructor(
  name: string,
  semanticKind: ManifestSemanticKind,
  elementKind: ManifestElementKind | null,
  synopsis: string,
  example: string,
  options: {
    readonly arguments?: readonly ConstructorArgumentManifest[];
    readonly properties?: readonly ConstructorPropertyManifest[];
    readonly children?: ChildPolicyManifest;
    readonly defaults?: ConstructorDefaultsManifest;
    readonly tone?: ManifestTone | null;
    readonly identity?: "named" | "anonymous";
  } = {},
): ConstructorManifest {
  return {
    name,
    identity: options.identity ?? "named",
    arguments: options.arguments ?? optionalLabel,
    properties: options.properties ?? contentProperties,
    children: options.children ?? NONE,
    defaults: options.defaults ?? EMPTY_DEFAULTS,
    lowering: {
      semanticKind,
      elementKind,
      tone: options.tone ?? null,
    },
    documentation: docs(synopsis, example),
  };
}

const contentChildren: ChildPolicyManifest = {
  mode: "roles",
  roles: [{
    name: "content",
    accepts: ["arrangement", "code", "connection", "frame", "freedraw", "geometry", "group", "icon", "image", "lane", "node", "note", "section", "sequence", "text"],
    minimum: 0,
    maximum: null,
    synopsis: "Nested visual content.",
  }],
};

export const CORE_LIBRARY_MANIFEST = defineLibraryManifest({
  schemaVersion: 1,
  name: "xdraw/core",
  documentation: docs("Core drawing primitives.", "diagram \"Example\" { item: rectangle \"Item\" }"),
  values: [],
  constructors: [
    simpleConstructor("rectangle", "node", "card", "Rectangular node.", "item: rectangle \"Item\""),
    simpleConstructor("ellipse", "node", "ellipse", "Elliptical node.", "item: ellipse \"Item\""),
    simpleConstructor("diamond", "node", "decision", "Diamond decision node.", "choice: diamond \"Valid?\""),
    simpleConstructor("frame", "frame", "frame", "Visible container.", "area: frame \"Area\" { item: rectangle \"Item\" }", {
      properties: frameProperties,
      children: contentChildren,
    }),
    simpleConstructor("group", "group", null, "Invisible layout container.", "items: group { first: rectangle \"First\" }", {
      properties: [],
      children: contentChildren,
    }),
    simpleConstructor("section", "section", "section", "Visible layout section.", "area: section \"Area\" { item: rectangle \"Item\" }", {
      properties: visibleContainerProperties,
      children: contentChildren,
      tone: "info",
    }),
    simpleConstructor("text", "text", "text", "Free-standing text.", "caption: text \"A caption\"", {
      arguments: [{ name: "value", kind: "string", required: true, variadic: false, synopsis: "Text content." }],
      properties: textProperties,
    }),
    simpleConstructor("code", "code", "code", "Syntax-highlighted source text.", "sample: code \"select 1\" { language sql }", {
      arguments: [{ name: "source", kind: "string", required: true, variadic: false, synopsis: "Source text." }],
      properties: [
        { name: "highlight", kind: "boolean", required: false, synopsis: "Enable syntax highlighting." },
        { name: "language", kind: "identifier", required: false, synopsis: "Source language." },
        { name: "line-numbers", kind: "boolean", required: false, synopsis: "Show line numbers." },
        { name: "title", kind: "string", required: false, synopsis: "Code block title." },
      ],
      defaults: { properties: { highlight: false, "line-numbers": true } },
    }),
    simpleConstructor("freedraw", "freedraw", "freedraw", "Freehand stroke.", "line: freedraw { at (0, 0); points ((0, 0), (20, 10)) }", {
      arguments: noArguments,
      properties: [
        { name: "at", kind: "pair", required: true, synopsis: "Stroke origin." },
        { name: "background", kind: "string", required: false, synopsis: "Background color." },
        { name: "fill-style", kind: "identifier", required: false, synopsis: "Fill style." },
        { name: "link", kind: "string", required: false, synopsis: "Hyperlink." },
        { name: "locked", kind: "boolean", required: false, synopsis: "Whether the stroke is locked." },
        { name: "opacity", kind: "number", required: false, synopsis: "Element opacity." },
        { name: "points", kind: "points", required: true, synopsis: "Stroke points." },
        { name: "pressures", kind: "numbers", required: false, synopsis: "Pressure values." },
        { name: "roughness", kind: "number", required: false, synopsis: "Stroke roughness." },
        { name: "simulate-pressure", kind: "boolean", required: false, synopsis: "Simulate pressure." },
        { name: "stroke", kind: "string", required: false, synopsis: "Stroke color." },
        { name: "stroke-width", kind: "number", required: false, synopsis: "Stroke width." },
        { name: "style", kind: "identifier", required: false, synopsis: "Named style or palette tone." },
      ],
    }),
    simpleConstructor("style", "style", null, "Reusable visual style.", "primary: style { stroke \"#1d4ed8\" }", {
      arguments: noArguments,
      properties: styleProperties,
    }),
    simpleConstructor("theme", "theme", null, "Diagram theme.", "brand: theme { stroke \"#1d4ed8\" }", {
      arguments: noArguments,
      properties: styleProperties,
    }),
    simpleConstructor("asset", "asset", null, "Named image asset.", `logo: asset "${exampleAsset}"`, {
      arguments: [{ name: "source", kind: "string", required: true, variadic: false, synopsis: "Asset source." }],
      properties: [],
    }),
    simpleConstructor("image", "image", "image", "Placed image asset.", "mark: image(logo) { at (0, 0); size (120, 80) }", {
      arguments: [{ name: "asset", kind: "identifier", required: true, variadic: false, synopsis: "Asset name." }],
      properties: [
        { name: "at", kind: "pair", required: true, synopsis: "Image position." },
        { name: "size", kind: "pair", required: true, synopsis: "Image size." },
        { name: "alt", kind: "string", required: false, synopsis: "Alternative text." },
        { name: "fit", kind: "identifier", required: false, synopsis: "Image fit mode." },
      ],
    }),
    simpleConstructor("template", "template", null, "Reusable declaration template.", "card: template(title) { item: rectangle \"${title}\" }", {
      arguments: [{ name: "parameters", kind: "identifier", required: false, variadic: true, synopsis: "Template parameters." }],
      properties: [],
      children: contentChildren,
    }),
  ],
});

const architectureConstructors = [
  ["person", "architecture-person", "Person or actor."],
  ["system", "architecture-system", "Software system."],
  ["external-system", "architecture-external-system", "External software system."],
  ["container", "architecture-container", "Deployable or runnable container."],
  ["component", "architecture-component", "Component within a container."],
  ["database", "architecture-database", "Persistent data store."],
  ["queue", "architecture-queue", "Message queue or topic."],
] as const;
const architectureBoundaries = [
  ["system-boundary", "architecture-system-boundary", "System boundary.", "info"],
  ["container-boundary", "architecture-container-boundary", "Container boundary.", "success"],
  ["deployment-node", "architecture-deployment-node", "Deployment environment or node.", "neutral"],
  ["group", "architecture-group", "Architecture grouping boundary.", "neutral"],
] as const;

export const STANDARD_LIBRARY_MANIFESTS = normalizeLibraryCatalog([
  {
    schemaVersion: 1,
    name: "xdraw/process",
    documentation: docs("Process-flow constructs.", "use \"xdraw/process\" as flow"),
    values: [],
    constructors: [simpleConstructor("lane", "lane", "lane", "Process swimlane.", "work: flow.lane \"Work\" { item: rectangle \"Item\" }", {
      properties: visibleContainerProperties,
      children: contentChildren,
    })],
  },
  {
    schemaVersion: 1,
    name: "xdraw/architecture",
    documentation: docs("Software architecture notation.", "use \"xdraw/architecture\" as arch"),
    values: [],
    constructors: [
      ...architectureConstructors.map(([name, kind, synopsis]) => simpleConstructor(
        name, "node", kind, synopsis, `item: arch.${name} \"Item\"`,
      )),
      ...architectureBoundaries.map(([name, kind, synopsis, tone]) => simpleConstructor(
        name, "frame", kind, synopsis, `area: arch.${name} \"Area\" { item: rectangle \"Item\" }`, {
          properties: frameProperties,
          children: contentChildren,
          tone,
        },
      )),
    ],
  },
  {
    schemaVersion: 1,
    name: "xdraw/connectors",
    documentation: docs("Connector helpers.", "use \"xdraw/connectors\" as connectors"),
    values: [],
    constructors: [simpleConstructor("junction", "node", "junction", "Small connector junction.", "split: connectors.junction")],
  },
  {
    schemaVersion: 1,
    name: "xdraw/sequence",
    documentation: docs("Sequence interaction notation.", "use \"xdraw/sequence\" as seq"),
    values: [],
    constructors: [
      simpleConstructor("sequence", "sequence", "sequence", "Sequence interaction container.", "interaction: seq.sequence { user: seq.participant \"User\"; api: seq.participant \"API\" }", {
        arguments: noArguments,
        properties: [],
        children: {
          mode: "roles",
          roles: [
            { name: "messages", accepts: ["connection"], minimum: 0, maximum: null, synopsis: "Messages between participants." },
            { name: "participants", accepts: ["participant"], minimum: 2, maximum: null, synopsis: "Sequence participants." },
          ],
        },
      }),
      simpleConstructor("participant", "participant", "participant", "Sequence participant.", "user: seq.participant \"User\"", {
        properties: [],
      }),
    ],
  },
  {
    schemaVersion: 1,
    name: "xdraw/assets",
    documentation: docs("Asset-based visual elements.", "use \"xdraw/assets\" as assets"),
    values: [],
    constructors: [simpleConstructor("icon", "icon", "icon", "Placed icon asset.", "mark: assets.icon(logo) { at (0, 0); size (48, 48) }", {
      arguments: [{ name: "asset", kind: "identifier", required: true, variadic: false, synopsis: "Asset name." }],
      properties: [
        { name: "at", kind: "pair", required: true, synopsis: "Icon position." },
        { name: "size", kind: "pair", required: true, synopsis: "Icon size." },
        { name: "alt", kind: "string", required: false, synopsis: "Alternative text." },
        { name: "fit", kind: "identifier", required: false, synopsis: "Icon fit mode." },
        { name: "locked", kind: "boolean", required: false, synopsis: "Whether the icon is locked." },
      ],
    })],
  },
  {
    schemaVersion: 1,
    name: "xdraw/annotations",
    documentation: docs("Notes and callouts.", "use \"xdraw/annotations\" as annotations"),
    values: [],
    constructors: [
      simpleConstructor("note", "note", "note", "Informational note.", "item: rectangle \"Item\"; context: annotations.note \"Context\" { attach item@bottom }", {
        properties: [{ name: "attach", kind: "endpoint", required: false, synopsis: "Element anchor to annotate." }],
      }),
      simpleConstructor("callout", "node", "card", "Emphasized callout.", "warning: annotations.callout \"Review\"", {
        tone: "warning",
      }),
    ],
  },
  {
    schemaVersion: 1,
    name: "xdraw/table",
    documentation: docs("Structured tables rendered as editable native elements.", "use \"xdraw/table\" as table"),
    values: [],
    constructors: [
      simpleConstructor("table", "node", "table", "Measured table with one header and one or more rows.", `orders: table.table "Orders" {
  table.header "Order" "Customer" "Total"
  table.row "1001" "A. Ndlovu" "R450"
}`, {
        children: {
          mode: "roles",
          roles: [
            { name: "header", accepts: ["table-header"], minimum: 1, maximum: 1, synopsis: "Column headings." },
            { name: "rows", accepts: ["table-row"], minimum: 1, maximum: null, synopsis: "Table data rows." },
          ],
        },
        properties: [],
      }),
      simpleConstructor("header", "table-header", null, "Table column headings.", `orders: table.table "Orders" {
  table.header "Order" "Customer" "Total"
  table.row "1001" "A. Ndlovu" "R450"
}`, {
        arguments: [
          { name: "first-cell", kind: "string", required: true, variadic: false, synopsis: "First heading cell." },
          { name: "additional-cells", kind: "string", required: false, variadic: true, synopsis: "Additional heading cells." },
        ],
        identity: "anonymous",
        properties: [],
      }),
      simpleConstructor("row", "table-row", null, "Table data row.", `orders: table.table "Orders" {
  table.header "Order" "Customer" "Total"
  table.row "1001" "A. Ndlovu" "R450"
}`, {
        arguments: [
          { name: "first-cell", kind: "string", required: true, variadic: false, synopsis: "First row cell." },
          { name: "additional-cells", kind: "string", required: false, variadic: true, synopsis: "Additional row cells." },
        ],
        identity: "anonymous",
        properties: [],
      }),
    ],
  },
  {
    schemaVersion: 1,
    name: "xdraw/math",
    documentation: docs("Mathematical notation rendered as portable scene assets.", "use \"xdraw/math\" as math"),
    values: [],
    constructors: [
      simpleConstructor("formula", "node", "formula", "Display-style mathematical formula.", `expression: math.formula """
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
"""`, {
        arguments: [{
          name: "source",
          kind: "raw-string",
          required: true,
          variadic: false,
          synopsis: "Raw triple-quoted TeX formula source.",
        }],
        properties: [
          { name: "size", kind: "pair", required: false, synopsis: "Formula display box." },
          { name: "locked", kind: "boolean", required: false, synopsis: "Whether the formula is locked." },
        ],
      }),
    ],
  },
  {
    schemaVersion: 1,
    name: "xdraw/palette",
    documentation: docs("Named palette tones.", "use \"xdraw/palette\" as palette"),
    values: [
      { name: "accent", kind: "tone", synopsis: "Accent emphasis." },
      { name: "danger", kind: "tone", synopsis: "Danger or failure emphasis." },
      { name: "info", kind: "tone", synopsis: "Informational emphasis." },
      { name: "neutral", kind: "tone", synopsis: "Neutral presentation." },
      { name: "success", kind: "tone", synopsis: "Success emphasis." },
      { name: "warning", kind: "tone", synopsis: "Warning emphasis." },
    ],
    constructors: [],
  },
]);

export const BUILTIN_LIBRARY_MANIFESTS = normalizeLibraryCatalog([
  CORE_LIBRARY_MANIFEST,
  ...STANDARD_LIBRARY_MANIFESTS,
]);
