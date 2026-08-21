import assert from "node:assert/strict";
import test from "node:test";

import type {
  SourceDeclaration,
  SourceDocument,
  SourceProperty,
  SourcePropertyValue,
  SourceStatement,
  SourceValueKind,
} from "../src/contracts/language.ts";
import type { LibraryManifest } from "../src/language/manifests/contracts.ts";
import { defineLibraryManifest } from "../src/language/manifests/schema.ts";
import { BUILTIN_LIBRARY_MANIFESTS } from "../src/language/manifests/builtins.ts";
import { LanguageValidationError, validateLanguageDocument } from "../src/language/validator.ts";
import { parseSyntax } from "../src/language/parser.ts";

function validate(source: string): SourceDocument {
  const document = parseSyntax(source);
  assert.equal(validateLanguageDocument(document), document);
  return document;
}

function declaration(
  id = "item",
  constructor = "rectangle",
  arguments_: readonly SourcePropertyValue[] = ["Item"],
  statements: readonly SourceStatement[] = [],
): SourceDeclaration {
  return {
    type: "declaration",
    id,
    constructor,
    arguments: [...arguments_],
    argumentKinds: arguments_.map((value) => typeof value === "string" ? "string" : valueKind(value)),
    statements: [...statements],
  };
}

function valueKind(value: SourcePropertyValue): SourceValueKind {
  if (Array.isArray(value)) return "tuple";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "object") return "endpoint";
  return "identifier";
}

function property(
  name: string,
  value: SourcePropertyValue,
  kind: SourceValueKind = valueKind(value),
): SourceProperty {
  return { type: "property", name, value, valueKind: kind };
}

function documentWith(sourceStatement: SourceStatement): SourceDocument {
  return {
    type: "source-document",
    imports: [],
    diagram: { type: "diagram", title: "Test", statements: [sourceStatement] },
    source: "",
    comments: [],
  };
}

function customLibrary(acceptsConnections = false): LibraryManifest {
  return defineLibraryManifest({
    schemaVersion: 1,
    name: "xdraw/example",
    documentation: { synopsis: "Test constructs.", examples: ["use \"xdraw/example\" as example"] },
    values: [],
    constructors: [{
      name: "panel",
      identity: "named",
      arguments: [
        { name: "label", kind: "string", required: true, variadic: false, synopsis: "Label." },
        { name: "count", kind: "number", required: false, variadic: false, synopsis: "Count." },
      ],
      properties: [
        { name: "enabled", kind: "boolean", required: true, synopsis: "Enabled state." },
        { name: "target", kind: "identifier", required: false, synopsis: "Target name." },
        { name: "telemetry-tag", kind: "string", required: false, synopsis: "Diagnostic tag." },
      ],
      children: {
        mode: "roles",
        roles: [
          { name: "content", accepts: ["node"], minimum: 1, maximum: 1, synopsis: "Panel content." },
          ...(acceptsConnections
            ? [{ name: "relations", accepts: ["connection"], minimum: 0, maximum: null, synopsis: "Panel relations." }]
            : []),
        ],
      },
      defaults: { properties: {} },
      lowering: { semanticKind: "node", elementKind: "card", tone: null },
      documentation: { synopsis: "Test panel.", examples: ["item: example.panel \"Item\""] },
    }],
  });
}

function customDocument(
  properties: readonly SourceProperty[],
  children: readonly SourceStatement[] = [declaration("child")],
): SourceDocument {
  const document = documentWith(declaration(
    "item",
    "example.panel",
    ["Panel"],
    [...properties, ...children],
  ));
  document.imports.push({ type: "import", source: "xdraw/example", alias: "example" });
  return document;
}

test("accepts valid core, imported, and document-template constructors without lowering", () => {
  const document = validate(`
    use "xdraw/process" as flow
    diagram "Valid" {
      pair: template(label) { left: rectangle "${"${label}"}"; right: ellipse "Other" }
      lane: flow.lane "Work" { first: pair("One") }
    }
  `);
  assert.equal(document.type, "source-document");
  assert.equal("elements" in document, false);
});

test("rejects unknown libraries and duplicate aliases with source locations", () => {
  assert.throws(
    () => validateLanguageDocument(parseSyntax('use "xdraw/missing" as missing\ndiagram "Test" {}')),
    (error: unknown) => error instanceof LanguageValidationError
      && error.code === "unknown-library"
      && error.location?.line === 1
      && /at line 1, column 1/.test(error.message),
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax('use "xdraw/core" as core\ndiagram "Test" {}')),
    (error: unknown) => error instanceof LanguageValidationError
      && error.code === "core-import"
      && /xdraw\/core constructors are available without an import/.test(error.message),
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`
      use "xdraw/process" as flow
      use "xdraw/sequence" as flow
      diagram "Test" {}
    `)),
    (error: unknown) => error instanceof LanguageValidationError
      && error.code === "duplicate-import-alias",
  );
});

test("resolves only core, imported, or document-template constructors", () => {
  assert.throws(
    () => validateLanguageDocument(parseSyntax('diagram "Test" { item: missing "Item" }')),
    /unknown constructor 'missing'/,
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`
      use "xdraw/process" as flow
      diagram "Test" { item: flow.missing "Item" }
    `)),
    /library 'xdraw\/process' has no constructor 'missing'/,
  );
});

test("validates constructor and template argument arity", () => {
  assert.throws(
    () => validateLanguageDocument(parseSyntax('diagram "Test" { item: text() }')),
    /constructor 'text' expects 1 argument\(s\), received 0/,
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`
      diagram "Test" {
        labelled: template(label) { item: rectangle "${"${label}"}" }
        use: labelled()
      }
    `)),
    /template 'labelled' expects 1 argument\(s\), received 0/,
  );

  const manifests = [...BUILTIN_LIBRARY_MANIFESTS, customLibrary()];
  const wrongKind = customDocument([
    property("enabled", true),
  ]);
  const panel = wrongKind.diagram.statements[0] as SourceDeclaration;
  panel.arguments = [42];
  panel.argumentKinds = ["number"];
  assert.throws(
    () => validateLanguageDocument(wrongKind, manifests),
    /argument 'label' expects string, received number/,
  );
});

test("validates template parameter scope and declarations", () => {
  const invalidSources = [
    ["parameter 'tone' may be used only inside a template", 'diagram "Test" { item: rectangle "Item" { style = $tone } }'],
    ["template 'card' does not declare parameter 'missing'", `diagram "Test" {
      card: template(label) { item: rectangle "Item" { style = $missing } }
    }`],
    ["template 'card' does not declare parameter 'missing'", `diagram "Test" {
      card: template(label) { item: rectangle "${"${missing}"}" }
    }`],
  ] as const;

  for (const [message, source] of invalidSources) {
    assert.throws(() => validateLanguageDocument(parseSyntax(source)), new RegExp(message));
  }
});

test("infers template parameter kinds and validates invocation arguments", () => {
  assert.doesNotThrow(() => validateLanguageDocument(parseSyntax(`
    diagram "Valid" {
      styled: template(label, tone, size) {
        item: rectangle "${"${label}"}" { style = $tone; font-size = $size }
      }
      use: styled("Item", info, 18)
    }
  `)));

  const invalidSources = [
    ["template 'labelled' argument 'label' expects string, received number", `diagram "Test" {
      labelled: template(label) { item: rectangle "${"${label}"}" }
      use: labelled(42)
    }`],
    ["template 'styled' argument 'tone' expects identifier, received string", `diagram "Test" {
      styled: template(tone) { item: rectangle "Item" { style = $tone } }
      use: styled("info")
    }`],
    ["template 'outer' argument 'size' expects number, received string", `diagram "Test" {
      inner: template(size) { item: rectangle "Item" { font-size = $size } }
      outer: template(size) { item: inner($size) }
      use: outer("large")
    }`],
  ] as const;

  for (const [message, source] of invalidSources) {
    assert.throws(() => validateLanguageDocument(parseSyntax(source)), new RegExp(message));
  }

  assert.throws(
    () => validateLanguageDocument(parseSyntax(`diagram "Test" {
      card: template(columns) { item: rectangle "Item" { size = (\${columns} * 10, 20) } }
      use: card("many")
    }`)),
    /template 'card' argument 'columns' expects number, received string/,
  );

  assert.throws(
    () => validateLanguageDocument(parseSyntax(`diagram "Test" {
      stroke: template(x, y) {
        mark: freedraw { at = (0, 0); points = ((0, 0), ($x, $y)) }
      }
      use: stroke("far", 20)
    }`)),
    /template 'stroke' argument 'x' expects number, received string/,
  );
});

test("rejects template parameters used with conflicting kinds", () => {
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`diagram "Test" {
      invalid: template(value) {
        item: rectangle "${"${value}"}" { font-size = $value }
      }
    }`)),
    /template 'invalid' parameter 'value' has conflicting use kinds 'string' and 'number'/,
  );
});

test("rejects duplicate, unknown, missing, and wrong-kind properties", () => {
  const library = customLibrary();
  const manifests = [...BUILTIN_LIBRARY_MANIFESTS, library];

  assert.throws(() => validateLanguageDocument(customDocument([
    property("enabled", true),
    property("enabled", false),
  ]), manifests), /duplicate property 'enabled'/);
  assert.throws(() => validateLanguageDocument(customDocument([
    property("enabled", true),
    property("mystery", 1),
  ]), manifests), /does not accept property 'mystery'/);
  assert.throws(() => validateLanguageDocument(customDocument([
    property("target", "item"),
  ]), manifests), /requires property 'enabled'/);

  const wrong = customDocument([
    property("enabled", "yes"),
  ]);
  assert.throws(() => validateLanguageDocument(wrong, manifests), /property 'enabled'.*expects boolean, received string/);
});

test("accepts a manifest-declared property parsed by the generic grammar", () => {
  const document = parseSyntax(`
    use "xdraw/example" as example
    diagram "Extensible properties" {
      item: example.panel "Panel" {
        enabled = true
        telemetry-tag = "request-path"
        child: rectangle "Child"
      }
    }
  `);

  assert.doesNotThrow(() => validateLanguageDocument(
    document,
    [...BUILTIN_LIBRARY_MANIFESTS, customLibrary()],
  ));
  const item = document.diagram.statements[0] as SourceDeclaration;
  assert.deepEqual(
    item.statements.filter((statement) => statement.type === "property").map(({ name }) => name),
    ["enabled", "telemetry-tag"],
  );
});

test("validates child policy before lowering and enforces sequence participants", () => {
  assert.throws(
    () => validateLanguageDocument(parseSyntax('diagram "Test" { item: rectangle "Item" { child: ellipse "Child" } }')),
    /constructor 'rectangle' does not accept children/,
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax('diagram "Test" { item: rectangle "Item" { arrange row {} } }')),
    /constructor 'rectangle' does not accept children/,
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`diagram "Test" {
      pair: template(label) { item: rectangle "${"${label}"}" }
      first: pair("One") { arrange row {} }
    }`)),
    /template use 'pair' does not accept children/,
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`
      use "xdraw/sequence" as seq
      diagram "Test" {
        interaction: seq.sequence { only: seq.participant "Only" }
      }
    `)),
    /requires at least 2 'participants' child\(ren\), received 1/,
  );
  assert.doesNotThrow(() => validateLanguageDocument(parseSyntax(`
    use "xdraw/sequence" as seq
    diagram "Test" {
      interaction: seq.sequence {
        first: seq.participant "First"
        second: seq.participant "Second"
        first -> second "Message"
      }
    }
  `)));

  const manifests = [...BUILTIN_LIBRARY_MANIFESTS, customLibrary()];
  assert.throws(
    () => validateLanguageDocument(customDocument(
      [property("enabled", true)],
      [declaration("caption", "text", ["Caption"])],
    ), manifests),
    /constructor 'example\.panel' does not accept child kind 'text'/,
  );
  assert.throws(
    () => validateLanguageDocument(customDocument(
      [property("enabled", true)],
      [declaration("first"), declaration("second")],
    ), manifests),
    /accepts at most 1 'content' child\(ren\), received 2/,
  );
});

test("derives nested connection ownership from manifest child roles", () => {
  const panelWithConnection = (): SourceDocument => customDocument(
    [property("enabled", true)],
    [
      declaration("child"),
      {
        type: "connection",
        operator: "->",
        endpoints: [{ reference: "child" }, { reference: "child" }],
        properties: [],
      },
    ],
  );

  assert.throws(
    () => validateLanguageDocument(
      panelWithConnection(),
      [...BUILTIN_LIBRARY_MANIFESTS, customLibrary()],
    ),
    /constructor 'example\.panel' does not accept child kind 'connection'/,
  );
  assert.doesNotThrow(() => validateLanguageDocument(
    panelWithConnection(),
    [...BUILTIN_LIBRARY_MANIFESTS, customLibrary(true)],
  ));
});

test("rejects deterministic collisions between templates, core names, and import aliases", () => {
  assert.throws(
    () => validateLanguageDocument(parseSyntax('diagram "Test" { rectangle: template() {} }')),
    /template 'rectangle' conflicts with core constructor 'rectangle'/,
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`
      use "xdraw/process" as reusable
      diagram "Test" { reusable: template() {} }
    `)),
    /template 'reusable' conflicts with import alias 'reusable'/,
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`
      use "xdraw/process" as rectangle
      diagram "Test" {}
    `)),
    /import alias 'rectangle' conflicts with core constructor 'rectangle'/,
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax('diagram "Test" { flow.card: template() {} }')),
    /template declaration name 'flow\.card' must be unqualified/,
  );
});

test("distinguishes quoted strings from identifiers", () => {
  const library = customLibrary();
  const manifests = [...BUILTIN_LIBRARY_MANIFESTS, library];
  const source = (value: SourcePropertyValue) => customDocument([
    property("enabled", true),
    property("target", value),
  ]);

  assert.doesNotThrow(() => validateLanguageDocument(source("identifier"), manifests));
  const quoted = customDocument([property("enabled", true), property("target", "quoted", "string")]);
  assert.throws(() => validateLanguageDocument(quoted, manifests), /expects identifier, received string/);
  assert.throws(() => validateLanguageDocument(source(42), manifests), /expects identifier, received number/);
});

test("rejects malformed generic tuples against point and points manifests", () => {
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`
      diagram "Test" {
        stroke: freedraw { at = (0, 1, 2); points = ((0, 0), (10, 10)) }
      }
    `)),
    /property 'at'.*expects point, received number list/,
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`
      diagram "Test" {
        stroke: freedraw { at = (0, 0); points = ((0, 0), (10, 10, 20)) }
      }
    `)),
    /property 'points'.*expects points, received point list/,
  );
});

test("rejects statements that have no valid document or nested owner", () => {
  assert.throws(
    () => validateLanguageDocument(parseSyntax('diagram "Test" { mystery = "ignored" }')),
    (error: unknown) => error instanceof LanguageValidationError
      && error.code === "document-property"
      && /document scope does not accept property 'mystery'/.test(error.message),
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`
      diagram "Test" {
        group: group "Group" { subtitle "Ignored" }
      }
    `)),
    (error: unknown) => error instanceof LanguageValidationError
      && error.code === "nested-subtitle"
      && /subtitle is allowed only at diagram scope/.test(error.message),
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`
      diagram "Test" {
        subtitle "First"
        subtitle "Second"
      }
    `)),
    (error: unknown) => error instanceof LanguageValidationError
      && error.code === "duplicate-subtitle"
      && /diagram accepts at most one subtitle/.test(error.message),
  );
});

test("validates each arrangement kind against its own contract", () => {
  assert.doesNotThrow(() => validateLanguageDocument(parseSyntax(`
    diagram "Layouts" {
      arrange grid { columns = 2; gap = 24; width = 1400 }
      group: group "Group" { arrange row { spacing = tight } }
    }
  `)));

  const invalidSources = [
    ['arrangement \'compact\' does not accept property \'root\'', 'diagram "Test" { arrange compact { root = item } }'],
    ['arrangement \'grid\' does not accept property \'direction\'', 'diagram "Test" { arrange grid { direction = right } }'],
    ['arrangement \'layered\' does not accept property \'columns\'', 'diagram "Test" { arrange layered { columns = 2 } }'],
    ['arrangement \'row\' does not accept property \'width\'', 'diagram "Test" { group: group "G" { arrange row { width = 600 } } }'],
    ['arrangement \'column\' does not accept property \'columns\'', 'diagram "Test" { group: group "G" { arrange column { columns = 2 } } }'],
    ['arrangement \'tree\' does not accept property \'gap\'', 'diagram "Test" { group: group "G" { arrange tree { root = a; gap = 10 }; a: rectangle "A" } }'],
    ["property 'spacing' on arrangement 'row' must be one of tight, normal, airy", 'diagram "Test" { group: group "G" { arrange row { spacing = banana } } }'],
    ["property 'direction' on arrangement 'tree' must be one of down, right", 'diagram "Test" { group: group "G" { arrange tree { root = a; direction = left }; a: rectangle "A" } }'],
    ["unknown arrangement 'orbit'", 'diagram "Test" { arrange orbit {} }'],
  ] as const;

  for (const [message, source] of invalidSources) {
    assert.throws(() => validateLanguageDocument(parseSyntax(source)), new RegExp(message));
  }
});

test("rejects tree arrangements in unsupported owners", () => {
  assert.throws(
    () => validateLanguageDocument(parseSyntax('diagram "Test" { arrange tree { root = item }; item: rectangle "Item" }')),
    /tree arrangement is not supported at diagram scope/,
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`diagram "Test" {
      hierarchy: template() {
        arrange tree { root = root }
        root: rectangle "Root"
      }
    }`)),
    /tree arrangement is not supported in template 'hierarchy'/,
  );
});

test("rejects direct tree content that tree lowering cannot preserve", () => {
  const invalidSources = [
    ["tree arrangement in 'map' does not preserve child kind 'text'", `diagram "Test" {
      map: frame "Map" {
        arrange tree { root = root }
        root: rectangle "Root"
        caption: text "Caption"
      }
    }`],
    ["tree arrangement in 'map' requires direct node declarations, not template use 'first'", `diagram "Test" {
      reusable: template(label) { item: rectangle "${"${label}"}" }
      map: frame "Map" {
        arrange tree { root = first }
        first: reusable("First")
      }
    }`],
    ["tree arrangement in 'map' does not preserve geometry children", `diagram "Test" {
      map: frame "Map" {
        arrange tree { root = root }
        root: rectangle "Root"
        align left(root)
      }
    }`],
    ["tree arrangement in 'map' does not preserve additional arrangements", `diagram "Test" {
      map: frame "Map" {
        arrange tree { root = root }
        arrange row {}
        root: rectangle "Root"
      }
    }`],
  ] as const;

  for (const [message, source] of invalidSources) {
    assert.throws(() => validateLanguageDocument(parseSyntax(source)), new RegExp(message));
  }
});

test("rejects connection enum values before lowering can degrade them", () => {
  const source = (propertyText: string): string => `
    diagram "Connections" {
      left: rectangle "Left"
      right: rectangle "Right"
      left -> right { ${propertyText} }
    }
  `;
  const invalid = [
    ["route", "banana", "auto, straight, elbow, curved, line"],
    ["stroke-style", "wavy", "solid, dashed, dotted"],
    ["head", "unknown", "none, arrow, bar, dot, circle, circle_outline, triangle, triangle_outline, diamond, diamond_outline, crowfoot_one, crowfoot_many, crowfoot_one_or_many"],
  ] as const;
  for (const [propertyName, value, allowed] of invalid) {
    assert.throws(
      () => validateLanguageDocument(parseSyntax(source(`${propertyName} = ${value}`))),
      new RegExp(`property '${propertyName}' on connection must be one of ${allowed}`),
    );
  }
});

test("resolves qualified style values through imported library manifests", () => {
  assert.doesNotThrow(() => validateLanguageDocument(parseSyntax(`
    use "xdraw/palette" as palette
    diagram "Styles" {
      item: rectangle "Item" { style = palette.info }
    }
  `)));
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`
      use "xdraw/palette" as palette
      diagram "Styles" { item: rectangle "Item" { style = palette.missing } }
    `)),
    (error: unknown) => error instanceof LanguageValidationError
      && error.code === "unknown-library-value"
      && /library 'xdraw\/palette' has no exported value 'missing'/.test(error.message),
  );
  assert.throws(
    () => validateLanguageDocument(parseSyntax(`
      diagram "Styles" { item: rectangle "Item" { style = palette.info } }
    `)),
    (error: unknown) => error instanceof LanguageValidationError
      && error.code === "unknown-value-alias"
      && /unknown library alias 'palette'/.test(error.message),
  );
});

test("keeps unqualified document style references valid", () => {
  assert.doesNotThrow(() => validateLanguageDocument(parseSyntax(`
    diagram "Styles" {
      focus: style { stroke = "#2563eb" }
      item: rectangle "Item" { style = focus }
    }
  `)));
});

test("does not mutate a valid source document", () => {
  const document = parseSyntax('diagram "Test" { item: rectangle "Item" }');
  const before = structuredClone(document);
  const returned = validateLanguageDocument(document);
  assert.equal(returned, document);
  assert.deepEqual(document, before);
});
