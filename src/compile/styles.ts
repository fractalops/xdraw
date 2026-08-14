import { tone } from "../excalidraw/components.ts";
import type { ToneName } from "../excalidraw/components.ts";
import { FONT } from "../excalidraw/elements.ts";
import type {
  FreedrawStatement,
  SemanticDocument,
  StyleStatement,
  TextStyleStatement,
  ThemeStatement,
} from "../semantic-contracts.ts";
import type {
  NodeStyleTarget,
  ResolvedFreedrawStyle,
  ResolvedNodeStyle,
  ResolvedTextStyle,
  StyleProperties,
  StyleResolver,
} from "../layout-contracts.ts";
import type { FontFamily } from "../text/metrics.ts";

const PROPERTY_NAMES: Readonly<Record<string, keyof StyleProperties>> = Object.freeze({
  stroke: "strokeColor",
  background: "backgroundColor",
  text: "textColor",
  "text-color": "textColor",
  "stroke-width": "strokeWidth",
  "stroke-style": "strokeStyle",
  "fill-style": "fillStyle",
  roughness: "roughness",
  opacity: "opacity",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "title-size": "titleSize",
  "body-size": "bodySize",
  "line-height": "lineHeight",
  padding: "padding",
  link: "link",
  locked: "locked",
  "auto-size": "autoSize",
  "wrap-width": "wrapWidth",
});

const FONT_FAMILIES: Readonly<Record<string, FontFamily>> = {
  hand: FONT.handDrawn,
  handwritten: FONT.handDrawn,
  normal: FONT.normal,
  code: FONT.code,
};
const KIND_TONES: Readonly<Record<string, string>> = {
  card: "neutral",
  person: "accent",
  system: "info",
  database: "neutral",
  decision: "warning",
  ellipse: "neutral",
  junction: "neutral",
  "architecture-person": "accent",
  "architecture-system": "info",
  "architecture-external-system": "neutral",
  "architecture-container": "info",
  "architecture-component": "success",
  "architecture-database": "neutral",
  "architecture-queue": "warning",
};

function toneName(value: string | undefined): ToneName {
  if (value === "neutral" || value === "success" || value === "danger"
      || value === "warning" || value === "info" || value === "accent") return value;
  throw new Error(`unknown tone: ${value}`);
}
const NODE_PROPERTIES: ReadonlySet<keyof StyleProperties> = new Set([
  "strokeColor", "backgroundColor", "textColor", "strokeWidth", "strokeStyle",
  "fillStyle", "roughness", "opacity", "fontFamily", "titleSize", "bodySize",
  "lineHeight", "padding", "link", "locked",
]);
const TEXT_PROPERTIES: ReadonlySet<keyof StyleProperties> = new Set([
  "textColor", "fontFamily", "fontSize", "lineHeight", "link", "locked",
  "autoSize", "wrapWidth",
]);
const FREEDRAW_PROPERTIES: ReadonlySet<keyof StyleProperties> = new Set([
  "strokeColor", "backgroundColor", "strokeWidth", "fillStyle", "roughness",
  "opacity", "link", "locked",
]);

type StyleContainer = StyleStatement | ThemeStatement;
type StyleTarget = NodeStyleTarget | TextStyleStatement | FreedrawStatement;

function propertyMap(statement: StyleContainer | undefined): Record<string, unknown> {
  return Object.fromEntries((statement?.statements ?? []).map((item) => [item.key, item.value]));
}

function booleanValue(value: unknown, name: string): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function isFontFamily(value: unknown): value is FontFamily {
  return value === FONT.handDrawn || value === FONT.normal || value === FONT.code || value === FONT.bold;
}

function normalizeProperties(properties: Record<string, unknown> = {}): StyleProperties {
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(properties)) {
    if (name === "style") continue;
    const key = PROPERTY_NAMES[name];
    if (!key) throw new Error(`unsupported style property: ${name}`);
    if (key === "fontFamily") {
      const family = typeof value === "number" ? value : typeof value === "string" ? FONT_FAMILIES[value] : undefined;
      if (!isFontFamily(family) || family === FONT.bold) throw new Error(`unsupported font family: ${String(value)}`);
      result[key] = family;
    } else if (key === "locked" || key === "autoSize") {
      result[key] = booleanValue(value, name);
    } else if (key === "opacity") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new Error("opacity must be between 0 and 100");
      result[key] = value;
    } else if (key === "roughness" || key === "padding") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${name} must not be negative`);
      result[key] = value;
    } else if (["strokeWidth", "fontSize", "titleSize", "bodySize", "lineHeight", "wrapWidth"].includes(key)) {
      if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) throw new Error(`${name} must be a positive number`);
      result[key] = value;
    } else if (key === "strokeStyle") {
      if (value !== "solid" && value !== "dashed" && value !== "dotted") throw new Error(`unsupported stroke style: ${String(value)}`);
      result[key] = value;
    } else if (key === "fillStyle") {
      if (value !== "solid" && value !== "hachure" && value !== "cross-hatch") throw new Error(`unsupported fill style: ${String(value)}`);
      result[key] = value;
    } else if (key === "link") {
      if (typeof value !== "string") throw new Error("link must be a string");
      let protocol: string;
      try {
        protocol = new URL(value).protocol;
      } catch {
        throw new Error(`invalid link: ${value}`);
      }
      if (!['http:', 'https:', 'mailto:'].includes(protocol)) throw new Error(`unsupported link protocol: ${protocol}`);
      result[key] = value;
    } else if (key === "strokeColor" || key === "backgroundColor" || key === "textColor") {
      if (typeof value !== "string") throw new Error(`${name} must be a string`);
      result[key] = value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function createStyleResolver(document: SemanticDocument): StyleResolver {
  const themeStatement = document.statements.find((item): item is ThemeStatement => item.type === "theme");
  const theme = normalizeProperties(propertyMap(themeStatement));
  const named = new Map<string, StyleProperties>(document.statements
    .filter((item): item is StyleStatement => item.type === "style")
    .map((item) => [item.id, normalizeProperties(propertyMap(item))]));

  const namedStyle = (statement: StyleTarget): StyleProperties => {
    const name = statement.attributes?.style;
    if (!name) return {};
    if (typeof name !== "string" || !named.has(name)) throw new Error(`unknown style: ${String(name)}`);
    return named.get(name) ?? {};
  };

  const propertiesFor = (statement: StyleTarget): {
    defaults: StyleProperties;
    named: StyleProperties;
    local: StyleProperties;
  } => ({
    defaults: normalizeProperties(statement.styleDefaults ?? {}),
    named: namedStyle(statement),
    local: normalizeProperties(statement.attributes ?? {}),
  });

  const assertApplicable = (
    layers: Readonly<Record<string, StyleProperties>>,
    allowed: ReadonlySet<keyof StyleProperties>,
    target: string,
  ): void => {
    for (const [layer, properties] of Object.entries(layers)) {
      const unsupported = Object.keys(properties).filter((key) => !allowed.has(key as keyof StyleProperties));
      if (unsupported.length) throw new Error(`${layer} style properties do not apply to ${target}: ${unsupported.join(", ")}`);
    }
  };

  const applicableTheme = (allowed: ReadonlySet<keyof StyleProperties>): StyleProperties => Object.fromEntries(
    Object.entries(theme).filter(([key]) => allowed.has(key as keyof StyleProperties)),
  );

  const resolveNode = (node: NodeStyleTarget): ResolvedNodeStyle => {
    const colors = tone(toneName(node.tone ?? KIND_TONES[node.kind] ?? "neutral"));
    const kind: StyleProperties = {
      strokeColor: colors.stroke,
      backgroundColor: colors.background,
      textColor: colors.text,
      ...(String(node.kind).startsWith("architecture-") ? { fontFamily: FONT.normal } : {}),
      strokeWidth: ["system", "architecture-system"].includes(node.kind) ? 3 : 2,
      strokeStyle: ["database", "architecture-external-system"].includes(node.kind) ? "dashed" : "solid",
      ...(node.kind === "decision" ? { titleSize: 18 } : {}),
    };
    const properties = propertiesFor(node);
    assertApplicable(properties, NODE_PROPERTIES, "nodes");
    const resolved: ResolvedNodeStyle = {
      fontFamily: FONT.code,
      titleSize: 19,
      bodySize: 17,
      lineHeight: 1.28,
      titleLineHeight: 1.25,
      padding: 20,
      locked: false,
      link: null,
      strokeColor: colors.stroke,
      backgroundColor: colors.background,
      textColor: colors.text,
      strokeWidth: 2,
      strokeStyle: "solid",
      ...applicableTheme(NODE_PROPERTIES),
      ...kind,
      ...properties.defaults,
      ...properties.named,
      ...properties.local,
    };
    if ([theme, kind, properties.named, properties.local].some((layer) => Object.hasOwn(layer, "lineHeight"))) {
      resolved.titleLineHeight = resolved.lineHeight;
    }
    return resolved;
  };

  const resolveText = (statement: TextStyleStatement): ResolvedTextStyle => {
    const properties = propertiesFor(statement);
    assertApplicable(properties, TEXT_PROPERTIES, "free text");
    return {
      fontFamily: FONT.code,
      fontSize: 18,
      lineHeight: 1.25,
      textColor: "#1f2937",
      autoSize: statement.width === undefined,
      locked: false,
      link: null,
      ...applicableTheme(TEXT_PROPERTIES),
      ...properties.defaults,
      ...properties.named,
      ...(statement.fontSize === undefined ? {} : { fontSize: statement.fontSize }),
      ...properties.local,
    };
  };

  const resolveFreedraw = (statement: FreedrawStatement): ResolvedFreedrawStyle => {
    const properties = propertiesFor(statement);
    assertApplicable(properties, FREEDRAW_PROPERTIES, "freedraw");
    return {
      strokeColor: "#1f2937",
      backgroundColor: "transparent",
      strokeWidth: 2,
      fillStyle: "solid",
      roughness: 0,
      opacity: 100,
      locked: false,
      link: null,
      ...applicableTheme(FREEDRAW_PROPERTIES),
      ...properties.defaults,
      ...properties.named,
      ...properties.local,
    };
  };

  return { resolveFreedraw, resolveNode, resolveText };
}
