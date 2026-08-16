import type { ConstructorManifest, LibraryManifest, ManifestValueKind } from "./manifests/contracts.ts";
import { BUILTIN_LIBRARY_MANIFESTS, CORE_LIBRARY_MANIFEST, STANDARD_LIBRARY_MANIFESTS } from "./manifests/builtins.ts";

export type PropertyKind = "pair" | "string" | "identifier" | "number" | "points" | "numbers" | "endpoint";

export interface ConstructorDefinition {
  type: "node" | "frame" | "group" | "section" | "text" | "code" | "freedraw" | "plot" | "style" | "theme"
    | "asset" | "image" | "template" | "lane" | "sequence" | "participant" | "icon" | "note"
    | "table-header" | "table-row";
  kind?: string;
  tone?: string;
  manifest: ConstructorManifest;
}

const GRAMMAR_PROPERTY_KINDS = new Map<string, PropertyKind>([
  ["gap", "number"],
  ["columns", "number"],
  ["width", "number"],
  ["spacing", "identifier"],
  ["direction", "identifier"],
  ["root", "identifier"],
  ["level-gap", "number"],
  ["sibling-gap", "number"],
  ["route", "identifier"],
  ["head", "identifier"],
  ["start-label", "string"],
  ["end-label", "string"],
  ["via", "points"],
  ["attach", "endpoint"],
]);

function parserKind(kind: ManifestValueKind): PropertyKind {
  if (kind === "boolean") return "identifier";
  if (kind === "raw-string") return "string";
  return kind;
}

const PROPERTY_KINDS = new Map(GRAMMAR_PROPERTY_KINDS);
for (const manifest of BUILTIN_LIBRARY_MANIFESTS) {
  for (const constructor of manifest.constructors) {
    for (const property of constructor.properties) {
      const kind = parserKind(property.kind);
      const previous = PROPERTY_KINDS.get(property.name);
      if (previous && previous !== kind) {
        throw new Error(`property '${property.name}' has conflicting kinds '${previous}' and '${kind}'`);
      }
      PROPERTY_KINDS.set(property.name, kind);
    }
  }
}

function definition(manifest: ConstructorManifest): ConstructorDefinition {
  return {
    type: manifest.lowering.semanticKind,
    kind: manifest.lowering.elementKind ?? undefined,
    tone: manifest.lowering.tone ?? undefined,
    manifest,
  };
}

const CORE_CONSTRUCTORS = new Map(
  CORE_LIBRARY_MANIFEST.constructors.map((constructor) => [constructor.name, definition(constructor)]),
);

const BUILTIN_LIBRARIES = new Map(BUILTIN_LIBRARY_MANIFESTS.map((manifest) => [manifest.name, manifest]));
const LIBRARIES = new Map(STANDARD_LIBRARY_MANIFESTS.map((manifest) => [manifest.name, manifest]));
const LIBRARY_CONSTRUCTORS = new Map<string, ConstructorDefinition>();
for (const manifest of STANDARD_LIBRARY_MANIFESTS) {
  for (const constructor of manifest.constructors) {
    LIBRARY_CONSTRUCTORS.set(`${manifest.name}.${constructor.name}`, definition(constructor));
  }
}

export const HIGHLIGHT_LANGUAGES = Object.freeze(["sql", "typescript", "xdraw"] as const);
export type HighlightLanguage = (typeof HIGHLIGHT_LANGUAGES)[number];

export function isHighlightLanguage(value: unknown): value is HighlightLanguage {
  return typeof value === "string" && (HIGHLIGHT_LANGUAGES as readonly string[]).includes(value);
}

export function hasProperty(name: string): boolean {
  return PROPERTY_KINDS.has(name);
}

export function propertyKind(name: string): PropertyKind | undefined {
  return PROPERTY_KINDS.get(name);
}

export function listLibraryManifests(): readonly LibraryManifest[] {
  return BUILTIN_LIBRARY_MANIFESTS;
}

export function getLibraryManifest(name: string): LibraryManifest | undefined {
  return BUILTIN_LIBRARIES.get(name);
}

export function requireLibraryManifest(name: string): LibraryManifest {
  const manifest = LIBRARIES.get(name);
  if (!manifest) throw new Error(`unknown library '${name}'`);
  return manifest;
}

export function resolveConstructor(name: string, imports: ReadonlyMap<string, string>): ConstructorDefinition {
  const core = CORE_CONSTRUCTORS.get(name);
  if (core) return core;
  const [alias, ...members] = name.split(".");
  const library = imports.get(alias);
  if (!library || members.length !== 1) throw new Error(`unknown constructor '${name}'`);
  const constructor = LIBRARY_CONSTRUCTORS.get(`${library}.${members[0]}`);
  if (!constructor) throw new Error(`unknown constructor '${name}'`);
  return constructor;
}

export function resolveTone(value: unknown, imports: ReadonlyMap<string, string>): string | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.split(".");
  if (parts.length !== 2) return undefined;
  const [alias, name] = parts;
  const libraryName = imports.get(alias);
  if (!libraryName || !name) return undefined;
  const exported = LIBRARIES.get(libraryName)?.values.find((item) => item.name === name);
  return exported?.kind === "tone" ? exported.name : undefined;
}

export function normalizePropertyValue<T>(value: T): T | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}
