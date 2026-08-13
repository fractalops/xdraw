const PROPERTY_KINDS = new Map([
  ["at", "pair"],
  ["size", "pair"],
  ["body", "string"],
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

export const HIGHLIGHT_LANGUAGES = Object.freeze(["sql", "typescript", "xdraw"]);

const CORE_CONSTRUCTORS = new Map([
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

const LIBRARY_CONSTRUCTORS = new Map([
  ["xdraw/cards.card", { type: "node", kind: "card" }],
  ["xdraw/process.lane", { type: "lane" }],
  ["xdraw/containers.section", { type: "group" }],
  ["xdraw/architecture.person", { type: "node", kind: "person" }],
  ["xdraw/architecture.system", { type: "node", kind: "system" }],
  ["xdraw/architecture.database", { type: "node", kind: "database" }],
  ["xdraw/connectors.junction", { type: "node", kind: "junction" }],
  ["xdraw/sequence.diagram", { type: "sequence" }],
  ["xdraw/sequence.participant", { type: "participant" }],
  ["xdraw/assets.icon", { type: "icon" }],
  ["xdraw/annotations.note", { type: "note" }],
  ["xdraw/annotations.callout", { type: "node", kind: "card", tone: "warning" }],
]);

export function hasProperty(name) {
  return PROPERTY_KINDS.has(name);
}

export function propertyKind(name) {
  return PROPERTY_KINDS.get(name);
}

export function resolveConstructor(name, imports) {
  if (CORE_CONSTRUCTORS.has(name)) return CORE_CONSTRUCTORS.get(name);
  const [alias, ...members] = name.split(".");
  const library = imports.get(alias);
  if (!library || !members.length) throw new Error(`unknown constructor '${name}'`);
  const constructor = LIBRARY_CONSTRUCTORS.get(`${library}.${members.join(".")}`);
  if (!constructor) throw new Error(`unknown constructor '${name}'`);
  return constructor;
}

export function resolveTone(value, imports) {
  if (typeof value !== "string") return undefined;
  const [alias, name] = value.split(".");
  return imports.get(alias) === "xdraw/palette" ? name : undefined;
}

export function normalizePropertyValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}
