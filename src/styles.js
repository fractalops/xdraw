import { tone } from "./components.js";
import { FONT } from "./elements.js";

const PROPERTY_NAMES = Object.freeze({
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

const FONT_FAMILIES = { hand: FONT.handDrawn, handwritten: FONT.handDrawn, normal: FONT.normal, code: FONT.code };
const KIND_TONES = {
  card: "neutral", person: "accent", system: "info", database: "neutral",
  decision: "warning", ellipse: "neutral", junction: "neutral",
};
const NODE_PROPERTIES = new Set([
  "strokeColor", "backgroundColor", "textColor", "strokeWidth", "strokeStyle",
  "fillStyle", "roughness", "opacity", "fontFamily", "titleSize", "bodySize",
  "lineHeight", "padding", "link", "locked",
]);
const TEXT_PROPERTIES = new Set([
  "textColor", "fontFamily", "fontSize", "lineHeight", "link", "locked",
  "autoSize", "wrapWidth",
]);

function propertyMap(statement) {
  return Object.fromEntries((statement?.statements ?? [])
    .filter((item) => item.type === "property")
    .map((item) => [item.key, item.value]));
}

function booleanValue(value, name) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function normalizeProperties(properties = {}) {
  const result = {};
  for (const [name, value] of Object.entries(properties)) {
    if (name === "style") continue;
    const key = PROPERTY_NAMES[name];
    if (!key) throw new Error(`unsupported style property: ${name}`);
    if (key === "fontFamily") {
      const family = typeof value === "number" ? value : FONT_FAMILIES[value];
      if (![FONT.handDrawn, FONT.normal, FONT.code].includes(family)) throw new Error(`unsupported font family: ${value}`);
      result[key] = family;
    } else if (["locked", "autoSize"].includes(key)) {
      result[key] = booleanValue(value, name);
    } else if (key === "opacity") {
      if (typeof value !== "number" || value < 0 || value > 100) throw new Error("opacity must be between 0 and 100");
      result[key] = value;
    } else if (["roughness", "padding"].includes(key)) {
      if (typeof value !== "number" || value < 0) throw new Error(`${name} must not be negative`);
      result[key] = value;
    } else if (["strokeWidth", "fontSize", "titleSize", "bodySize", "lineHeight", "wrapWidth"].includes(key)) {
      if (typeof value !== "number" || !(value > 0)) throw new Error(`${name} must be a positive number`);
      result[key] = value;
    } else if (key === "strokeStyle") {
      if (!["solid", "dashed", "dotted"].includes(value)) throw new Error(`unsupported stroke style: ${value}`);
      result[key] = value;
    } else if (key === "fillStyle") {
      if (!["solid", "hachure", "cross-hatch"].includes(value)) throw new Error(`unsupported fill style: ${value}`);
      result[key] = value;
    } else if (key === "link") {
      if (typeof value !== "string") throw new Error("link must be a string");
      let protocol;
      try {
        protocol = new URL(value).protocol;
      } catch {
        throw new Error(`invalid link: ${value}`);
      }
      if (!["http:", "https:", "mailto:"].includes(protocol)) throw new Error(`unsupported link protocol: ${protocol}`);
      result[key] = value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function createStyleResolver(document) {
  const theme = normalizeProperties(propertyMap(document.statements.find((item) => item.type === "theme")));
  const named = new Map(document.statements
    .filter((item) => item.type === "style")
    .map((item) => [item.id, normalizeProperties(propertyMap(item))]));

  const namedStyle = (statement) => {
    const name = statement.attributes?.style;
    if (!name) return {};
    if (!named.has(name)) throw new Error(`unknown style: ${name}`);
    return named.get(name);
  };

  const propertiesFor = (statement) => ({
    named: namedStyle(statement),
    local: normalizeProperties(statement.attributes),
  });

  const assertApplicable = (layers, allowed, target) => {
    for (const [layer, properties] of Object.entries(layers)) {
      const unsupported = Object.keys(properties).filter((key) => !allowed.has(key));
      if (unsupported.length) throw new Error(`${layer} style properties do not apply to ${target}: ${unsupported.join(", ")}`);
    }
  };

  const applicableTheme = (allowed) => Object.fromEntries(Object.entries(theme).filter(([key]) => allowed.has(key)));

  const resolveNode = (node) => {
    const colors = tone(node.tone ?? KIND_TONES[node.kind]);
    const kind = {
      strokeColor: colors.stroke,
      backgroundColor: colors.background,
      textColor: colors.text,
      strokeWidth: node.kind === "system" ? 3 : 2,
      strokeStyle: node.kind === "database" ? "dashed" : "solid",
      ...(node.kind === "decision" ? { titleSize: 18 } : {}),
    };
    const properties = propertiesFor(node);
    assertApplicable(properties, NODE_PROPERTIES, "nodes");
    const resolved = {
      fontFamily: FONT.code,
      titleSize: 19,
      bodySize: 17,
      lineHeight: 1.28,
      titleLineHeight: 1.25,
      padding: 20,
      locked: false,
      link: null,
      ...applicableTheme(NODE_PROPERTIES),
      ...kind,
      ...properties.named,
      ...properties.local,
    };
    if ([theme, kind, properties.named, properties.local].some((layer) => Object.hasOwn(layer, "lineHeight"))) {
      resolved.titleLineHeight = resolved.lineHeight;
    }
    return resolved;
  };

  const resolveText = (statement) => {
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
      ...properties.named,
      ...(statement.fontSize === undefined ? {} : { fontSize: statement.fontSize }),
      ...properties.local,
    };
  };

  return { named, resolveNode, resolveText, theme };
}
