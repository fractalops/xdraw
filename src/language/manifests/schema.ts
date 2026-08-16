/**
 * Validates a library manifest against the contract. A manifest is data, so it
 * is checked at load rather than trusted, and every failure names its path.
 */
import { LibraryManifestError } from "./contracts.ts";
import type {
  ChildPolicyManifest,
  ChildRoleManifest,
  ConstructorArgumentManifest,
  ConstructorDefaultsManifest,
  ConstructorLoweringManifest,
  ConstructorManifest,
  ConstructorPropertyManifest,
  JsonValue,
  LibraryManifest,
  LibraryManifestSummary,
  LibraryValueManifest,
  ManifestDocumentation,
  ManifestElementKind,
  ManifestSemanticKind,
  ManifestTone,
  ManifestValueKind,
} from "./contracts.ts";

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
  plot: true,
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
