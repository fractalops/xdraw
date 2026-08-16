/** The libraries XDraw ships. Data only; the schema module validates it. */
import { defineLibraryManifest, normalizeLibraryCatalog } from "./schema.ts";
import type {
  ChildPolicyManifest,
  ConstructorArgumentManifest,
  ConstructorDefaultsManifest,
  ConstructorManifest,
  ConstructorPropertyManifest,
  ManifestDocumentation,
  ManifestElementKind,
  ManifestSemanticKind,
  ManifestTone,
} from "./contracts.ts";


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
      simpleConstructor("plot", "plot", "freedraw", "Parametric curve plotted from expressions.", `mark: math.plot {
  at (0, 0)
  x """120 * sin(2*t)"""
  y """110 * sin(3*t)"""
  from 0
  to 6.2832
}`, {
        arguments: noArguments,
        properties: [
          { name: "at", kind: "pair", required: true, synopsis: "Curve origin." },
          { name: "x", kind: "raw-string", required: true, synopsis: "Expression for the x coordinate, in t." },
          { name: "y", kind: "raw-string", required: true, synopsis: "Expression for the y coordinate, in t." },
          { name: "from", kind: "number", required: true, synopsis: "Start of the parameter range." },
          { name: "to", kind: "number", required: true, synopsis: "End of the parameter range." },
          { name: "tolerance", kind: "number", required: false, synopsis: "Greatest permitted departure from the curve, in pixels." },
          { name: "link", kind: "string", required: false, synopsis: "Hyperlink." },
          { name: "locked", kind: "boolean", required: false, synopsis: "Whether the curve is locked." },
          { name: "opacity", kind: "number", required: false, synopsis: "Element opacity." },
          { name: "roughness", kind: "number", required: false, synopsis: "Stroke roughness." },
          { name: "stroke", kind: "string", required: false, synopsis: "Stroke color." },
          { name: "stroke-width", kind: "number", required: false, synopsis: "Stroke width." },
          { name: "style", kind: "identifier", required: false, synopsis: "Named style or palette tone." },
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
