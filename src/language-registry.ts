export type PropertyKind = "pair" | "string" | "identifier" | "number" | "points" | "numbers" | "endpoint";

export interface ConstructorDefinition {
  type: "node" | "frame" | "group" | "text" | "code" | "freedraw" | "style" | "theme"
    | "asset" | "image" | "component" | "lane" | "sequence" | "participant" | "icon" | "note";
  kind?: string;
  tone?: string;
}

const PROPERTY_KINDS = new Map<string, PropertyKind>([
  ["at", "pair"],
  ["size", "pair"],
  ["body", "string"],
  ["description", "string"],
  ["technology", "string"],
  ["style", "identifier"],
  ["gap", "number"],
  ["columns", "number"],
  ["width", "number"],
  ["spacing", "identifier"],
  ["direction", "identifier"],
  ["root", "identifier"],
  ["route", "identifier"],
  ["stroke-style", "identifier"],
  ["stroke", "string"],
  ["background", "string"],
  ["text-color", "string"],
  ["stroke-width", "number"],
  ["roughness", "number"],
  ["fill-style", "identifier"],
  ["opacity", "number"],
  ["font-family", "identifier"],
  ["font-size", "number"],
  ["line-height", "number"],
  ["title-size", "number"],
  ["body-size", "number"],
  ["wrap-width", "number"],
  ["auto-size", "identifier"],
  ["locked", "identifier"],
  ["link", "string"],
  ["align", "identifier"],
  ["vertical-align", "identifier"],
  ["fit", "identifier"],
  ["head", "identifier"],
  ["start-label", "string"],
  ["end-label", "string"],
  ["alt", "string"],
  ["via", "points"],
  ["points", "points"],
  ["pressures", "numbers"],
  ["simulate-pressure", "identifier"],
  ["attach", "endpoint"],
  ["level-gap", "number"],
  ["sibling-gap", "number"],
  ["language", "identifier"],
  ["title", "string"],
  ["line-numbers", "identifier"],
  ["highlight", "identifier"],
]);

export const HIGHLIGHT_LANGUAGES = Object.freeze(["sql", "typescript", "xdraw"] as const);
export type HighlightLanguage = (typeof HIGHLIGHT_LANGUAGES)[number];

export function isHighlightLanguage(value: unknown): value is HighlightLanguage {
  return typeof value === "string" && (HIGHLIGHT_LANGUAGES as readonly string[]).includes(value);
}

const CORE_CONSTRUCTORS = new Map<string, ConstructorDefinition>([
  ["rectangle", { type: "node", kind: "card" }],
  ["ellipse", { type: "node", kind: "ellipse" }],
  ["diamond", { type: "node", kind: "decision" }],
  ["frame", { type: "frame" }],
  ["group", { type: "group" }],
  ["text", { type: "text" }],
  ["code", { type: "code" }],
  ["freedraw", { type: "freedraw" }],
  ["style", { type: "style" }],
  ["theme", { type: "theme" }],
  ["asset", { type: "asset" }],
  ["image", { type: "image" }],
  ["component", { type: "component" }],
]);

const LIBRARY_CONSTRUCTORS = new Map<string, ConstructorDefinition>([
  ["xdraw/cards.card", { type: "node", kind: "card" }],
  ["xdraw/process.lane", { type: "lane" }],
  ["xdraw/containers.section", { type: "group" }],
  ["xdraw/architecture.person", { type: "node", kind: "architecture-person" }],
  ["xdraw/architecture.system", { type: "node", kind: "architecture-system" }],
  ["xdraw/architecture.external-system", { type: "node", kind: "architecture-external-system" }],
  ["xdraw/architecture.container", { type: "node", kind: "architecture-container" }],
  ["xdraw/architecture.component", { type: "node", kind: "architecture-component" }],
  ["xdraw/architecture.database", { type: "node", kind: "architecture-database" }],
  ["xdraw/architecture.queue", { type: "node", kind: "architecture-queue" }],
  ["xdraw/architecture.system-boundary", { type: "frame", kind: "architecture-system-boundary", tone: "info" }],
  ["xdraw/architecture.container-boundary", { type: "frame", kind: "architecture-container-boundary", tone: "success" }],
  ["xdraw/architecture.deployment-node", { type: "frame", kind: "architecture-deployment-node", tone: "neutral" }],
  ["xdraw/architecture.group", { type: "frame", kind: "architecture-group", tone: "neutral" }],
  ["xdraw/connectors.junction", { type: "node", kind: "junction" }],
  ["xdraw/sequence.diagram", { type: "sequence" }],
  ["xdraw/sequence.participant", { type: "participant" }],
  ["xdraw/assets.icon", { type: "icon" }],
  ["xdraw/annotations.note", { type: "note" }],
  ["xdraw/annotations.callout", { type: "node", kind: "card", tone: "warning" }],
]);

export function hasProperty(name: string): boolean {
  return PROPERTY_KINDS.has(name);
}

export function propertyKind(name: string): PropertyKind | undefined {
  return PROPERTY_KINDS.get(name);
}

export function resolveConstructor(name: string, imports: ReadonlyMap<string, string>): ConstructorDefinition {
  const core = CORE_CONSTRUCTORS.get(name);
  if (core) return core;
  const [alias, ...members] = name.split(".");
  const library = imports.get(alias);
  if (!library || !members.length) throw new Error(`unknown constructor '${name}'`);
  const constructor = LIBRARY_CONSTRUCTORS.get(`${library}.${members.join(".")}`);
  if (!constructor) throw new Error(`unknown constructor '${name}'`);
  return constructor;
}

export function resolveTone(value: unknown, imports: ReadonlyMap<string, string>): string | undefined {
  if (typeof value !== "string") return undefined;
  const [alias, name] = value.split(".");
  return imports.get(alias) === "xdraw/palette" ? name : undefined;
}

export function normalizePropertyValue<T>(value: T): T | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}
