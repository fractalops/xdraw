import assert from "node:assert/strict";
import test from "node:test";

import { resolveAssets } from "../src/io/assets.ts";
import { compilePrepared as compile } from "../src/compile/pipeline.ts";
import { MemoryFileSystem } from "../src/io/filesystem.ts";
import { parseSource, parseSyntax } from "../src/language/parser.ts";
import { GEOMETRY_STATEMENT_KINDS, isSourceGeometryStatement } from "../src/language/geometry-statements.ts";
import type { GeometryStatementKind } from "../src/contracts/foundation.ts";
import { requireArrow, requireElementById } from "../test-support/assertions.ts";
import type { SourceDeclaration } from "../src/contracts/language.ts";

const FLOW = `
use "xdraw/palette" as palette
use "xdraw/process" as process

diagram "Request lifecycle" {
  subtitle "A compact flow"

  flow: process.lane "Processing" {
    arrange row { gap = 55 }

    request: rectangle "Request" { style = palette.info }
    validate: rectangle "Validate" {
      body = "Check the request"
      style = palette.warning
    }
    publish: rectangle "Publish" { style = palette.success }
    request@east -> validate@west -> publish@west
  }
}`;

test("parses generic declarations without architecture-specific grammar", () => {
  const syntax = parseSyntax(FLOW);
  assert.deepEqual(syntax.imports.map(({ source, alias }) => ({ source, alias })), [
    { source: "xdraw/palette", alias: "palette" },
    { source: "xdraw/process", alias: "process" },
  ]);
  const flow = syntax.diagram.statements.find((statement): statement is SourceDeclaration => (
    "id" in statement && statement.id === "flow"
  ));
  assert.ok(flow);
  assert.equal(flow.constructor, "process.lane");
  const validate = flow.statements.find((statement): statement is SourceDeclaration => (
    "id" in statement && statement.id === "validate"
  ));
  assert.equal(validate?.constructor, "rectangle");
});

test("lowers generic declarations through the production compiler", () => {
  const drawing = compile(parseSource(FLOW)).toJSON();
  assert.ok(drawing.elements.some((element) => element.id === "flow.request:frame"));
  assert.ok(drawing.elements.some((element) => element.id === "flow.validate:frame"));
  assert.ok(drawing.elements.some((element) => element.id === "flow.publish:frame"));
  assert.ok(drawing.elements.some((element) => element.type === "arrow"));
});

test("qualified references and anchors remain unambiguous after lowering", () => {
  const document = parseSource(`diagram "Namespaces" {
    source: frame "Source" {
      api: rectangle "API" { at = (80, 120); size = (220, 100) }
    }
    target: frame "Target" {
      store: ellipse "Store" { at = (480, 120); size = (220, 100) }
    }
    transfer: source.api@east -> target.store@west "copies"
  }`);
  const connection = document.statements.find((statement) => statement.type === "connection");
  assert.ok(connection?.type === "connection");
  assert.deepEqual(connection.nodes, ["source.api.right", "target.store.left"]);
  const drawing = compile(document).toJSON();
  assert.ok(drawing.elements.some((element) => element.type === "arrow"));
});

test("rejects constructors that are not provided by the core or an imported library", () => {
  assert.throws(
    () => parseSource('diagram "Unknown" { item: architecture.service "API" }'),
    /unknown import alias 'architecture'/,
  );
});

test("rejects retired libraries even when their aliases are unused", () => {
  for (const library of ["xdraw/cards", "xdraw/containers"]) {
    assert.throws(
      () => parseSource(`use "${library}" as retired\ndiagram "Retired import" {}`),
      new RegExp(`unknown library '${library.replace("/", "\\/")}'`),
    );
  }
});

test("sections remain visible and distinct from frames and groups", () => {
  const drawing = compile(parseSource(`diagram "Containers" {
    framed: frame "Frame" { framed_item: rectangle "Framed" }
    grouped: group { grouped_item: rectangle "Grouped" }
    sectioned: section "Section" { sectioned_item: rectangle "Sectioned" }
  }`)).toJSON();

  const frame = drawing.elements.find((element) => element.id === "framed");
  const group = drawing.elements.find((element) => element.id === "grouped");
  const section = drawing.elements.find((element) => element.id === "sectioned:frame");
  const sectionTitle = drawing.elements.find((element) => element.id === "sectioned:title");

  assert.equal(frame?.type, "frame");
  assert.equal(group, undefined);
  assert.equal(section?.type, "rectangle");
  assert.equal(sectionTitle?.type, "text");
  assert.notEqual(section?.backgroundColor, "transparent");
});

test("arrangements own nested groups and flowing text", () => {
  const drawing = compile(parseSource(`diagram "Comparison" {
    arrange compact { width = 1600 }
    comparison: frame "Comparison" {
      arrange column { gap = 24 }
      histories: group {
        arrange row { gap = 32 }
        source: frame "Source" { source_row: rectangle "Version 12" }
        target: frame "Target" { target_row: rectangle "Version 0" }
        source.source_row@east -> target.target_row@west "copied"
      }
      explanation: text "The copied rows have a new path and version history."
    }
  }`)).toJSON();

  const source = requireElementById(drawing.elements, "comparison.histories.source");
  const target = requireElementById(drawing.elements, "comparison.histories.target");
  const explanation = requireElementById(drawing.elements, "comparison.explanation");
  assert.ok(source.x < target.x);
  assert.ok(explanation.y > source.y + source.height);
  assert.ok(drawing.elements.some((element) => element.type === "arrow"));
});

test("qualified sequence constructors lower without sequence keywords", () => {
  const drawing = compile(parseSource(`
    use "xdraw/sequence" as seq
    diagram "Interaction" {
      interaction: seq.sequence {
        client: seq.participant "Client"
        server: seq.participant "Server"
        request: client -> server "Request"
      }
    }
  `)).toJSON();
  assert.ok(drawing.elements.some((element) => element.id === "interaction.client:lifeline"));
  assert.ok(drawing.elements.some((element) => element.id === "interaction.server:lifeline"));
});

test("multiple sequences use stable semantic identities", () => {
  const source = (prefix = "") => `
    use "xdraw/sequence" as seq
    diagram "Interactions" {
      sequence: rectangle "Ordinary node"
      ${prefix}
      first: seq.sequence {
        client: seq.participant "Client"
        server: seq.participant "Server"
        request: client -> server "Request"
      }
      second: seq.sequence {
        worker: seq.participant "Worker"
        store: seq.participant "Store"
        save: worker -> store "Save"
      }
    }
  `;
  const drawing = compile(parseSource(source())).toJSON();
  const ids = drawing.elements.map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("first:message:0:label"));
  assert.ok(ids.includes("second:message:0:label"));
  assert.ok(ids.includes("sequence:frame"));

  const reordered = compile(parseSource(source(`
    earlier: seq.sequence {
      left: seq.participant "Left"
      right: seq.participant "Right"
      flow: left -> right "Flow"
    }
  `))).toJSON();
  assert.ok(reordered.elements.some((element) => element.id === "first:message:0:label"));
  assert.ok(reordered.elements.some((element) => element.id === "second:message:0:label"));
});

test("sequences reject unsupported content and external endpoints", () => {
  assert.throws(
    () => compile(parseSource(`
      use "xdraw/sequence" as seq
      diagram "Bad content" {
        interaction: seq.sequence {
          client: seq.participant "Client"
          server: seq.participant "Server"
          extra: rectangle "Not a participant"
          client -> server
        }
      }
    `)),
    /constructor 'seq\.sequence' does not accept child kind 'node'/,
  );
  assert.throws(
    () => compile(parseSource(`
      use "xdraw/sequence" as seq
      diagram "External endpoint" {
        outside: rectangle "Outside"
        interaction: seq.sequence {
          client: seq.participant "Client"
          server: seq.participant "Server"
          client -> outside
        }
      }
    `)),
    /sequence message references a non-participant: outside/,
  );
});

test("sequences require at least two participants through the public parser", () => {
  assert.throws(
    () => parseSource(`
      use "xdraw/sequence" as seq
      diagram "Incomplete interaction" {
        interaction: seq.sequence { only: seq.participant "Only" }
      }
    `),
    /requires at least 2 'participants' child\(ren\), received 1/,
  );
});

test("invalid declaration children are rejected instead of being dropped", () => {
  assert.throws(
    () => parseSource(`diagram "Invalid child" {
      parent: rectangle "Parent" { child: ellipse "Child" }
    }`),
    /constructor 'rectangle' does not accept children/,
  );
});

test("templates expand hygienically from constructor declarations", () => {
  const drawing = compile(parseSource(`
    use "xdraw/architecture" as arch
    use "xdraw/palette" as palette
    diagram "Services" {
      service: template(name, visual_style) {
        api: arch.system "${"${name}"} API" { style = $visual_style }
        store: arch.database "${"${name}"} store"
        api -> store
      }
      orders: service("Orders", palette.info)
      billing: service("Billing", palette.warning)
      orders.api -> billing.api
    }
  `)).toJSON();
  assert.ok(drawing.elements.some((element) => element.id === "orders.api:frame"));
  assert.ok(drawing.elements.some((element) => element.id === "billing.store:frame"));
});

test("templates compose without leaking identifiers", () => {
  const drawing = compile(parseSource(`diagram "Composition" {
    leaf: template(name) { node: rectangle "${"${name}"}" }
    pair: template(name) {
      left: leaf("${"${name}"} left")
      right: leaf("${"${name}"} right")
    }
    first: pair("First")
    second: pair("Second")
  }`)).toJSON();
  for (const id of [
    "first.left.node:frame",
    "first.right.node:frame",
    "second.left.node:frame",
    "second.right.node:frame",
  ]) assert.ok(drawing.elements.some((element) => element.id === id));
});

test("document bindings compose with template parameters in one expression", () => {
  const drawing = compile(parseSource(`diagram "Bound template" {
    let unit = 24
    card: template(columns) {
      item: rectangle "Item" { size = (\${columns} * unit, 4 * unit) }
    }
    result: card(5)
  }`)).toJSON();
  const frame = drawing.elements.find((item) => item.id === "result.item:frame");
  assert.ok(frame);
  assert.deepEqual([frame.width, frame.height], [120, 96]);
});

test("containers arrange heterogeneous children in a fixed-column grid", () => {
  const drawing = compile(parseSource(`diagram "Nested grid" {
    panel: frame "Panel" {
      arrange grid { columns = 2; gap = 24 }
      a: rectangle "A"
      b: rectangle "B" { body = "taller body wraps over more than one line" }
      c: rectangle "C"
      d: rectangle "D"
    }
  }`)).toJSON();
  const frame = (id: string) => {
    const value = drawing.elements.find((item) => item.id === `${id}:frame`);
    assert.ok(value);
    return value;
  };
  const [a, b, c, d] = ["panel.a", "panel.b", "panel.c", "panel.d"].map(frame);
  assert.equal(a.y, b.y);
  assert.equal(c.y, d.y);
  assert.equal(a.x, c.x);
  assert.equal(b.x, d.x);
  assert.ok(c.y >= Math.max(a.y + a.height, b.y + b.height) + 24);
});

test("template diagnostics report missing parameters and cycles", () => {
  assert.throws(
    () => compile(parseSource('diagram "Missing" { item: template(name) { node: rectangle "${name}" }; use: item() }')),
    /template 'item' expects 1 argument\(s\), received 0/,
  );
  assert.throws(
    () => compile(parseSource(`diagram "Cycle" {
      first: template() { nested: second() }
      second: template() { nested: first() }
      root: first()
    }`)),
    /template cycle: first -> second -> first/,
  );
});

test("named styles, frame locks, and connector waypoints share property syntax", () => {
  const drawing = compile(parseSource(`diagram "Controls" {
    focus: style { stroke = "#059669"; background = "#ecfdf5" }
    workspace: frame "Workspace" {
      locked = true
      source: rectangle "Source" { at = (80, 120); size = (180, 90); style = focus }
      target: ellipse "Target" { at = (520, 120); size = (180, 90) }
      source@east -> target@west {
        via = ((300, 165), (440, 165))
        start-label = "caller"
      }
    }
  }`)).toJSON();
  assert.equal(requireElementById(drawing.elements, "workspace").locked, true);
  assert.ok(drawing.elements.some((element) => element.type === "arrow"));
});

test("every property uses explicit assignment", () => {
  for (const source of [
    'diagram "Bad" { a: rectangle "A" { locked true } }',
    'diagram "Bad" { arrange row { gap 24 }; a: rectangle "A" }',
    'diagram "Bad" { a: rectangle "A"; a -> a { route elbow } }',
  ]) {
    assert.throws(() => parseSource(source), /expected '=' after property/u);
  }
});

test("connection route properties select the rendered path style", () => {
  const drawing = compile(parseSource(`use "xdraw/connectors" as connectors
  diagram "Curved connection" {
    left: connectors.junction "" { at = (80, 120); size = (8, 8); opacity = 0 }
    right: connectors.junction "" { at = (420, 120); size = (8, 8); opacity = 0 }
    left@east -> right@west {
      route = curved
      via = ((220, 220), (300, 220))
      head = none
    }
  }`)).toJSON();
  const edge = requireArrow(drawing.elements, "document:connection:0:0");

  assert.deepEqual(edge.roundness, { type: 2 });
  assert.equal(edge.endArrowhead, null);
  assert.equal(edge.points.length, 4);
});

test("rightward tree arrangements preserve qualified node identities", () => {
  const drawing = compile(parseSource(`
    diagram "Language design" {
      map: section "XDraw" {
        arrange tree {
          root = root
          direction = right
          level-gap = 90
          sibling-gap = 28
        }
        root: rectangle "XDraw"
        syntax: rectangle "Syntax"
        layout: rectangle "Layout"
        ids: rectangle "Stable IDs"
        root -> syntax
        root -> layout
        syntax -> ids
      }
    }
  `)).toJSON();

  const root = requireElementById(drawing.elements, "map.root:frame");
  const syntax = requireElementById(drawing.elements, "map.syntax:frame");
  const ids = requireElementById(drawing.elements, "map.ids:frame");
  assert.ok(root.x < syntax.x);
  assert.ok(syntax.x < ids.x);
  const arrows = drawing.elements.filter((element) => element.type === "arrow");
  assert.equal(arrows.length, 3);
  assert.ok(arrows.every((arrow) => arrow.points.every((point, index) => (
    index === 0 || point[0] >= arrow.points[index - 1][0]
  ))));
});

test("tree arrangements reject ambiguous and cyclic topology", () => {
  assert.throws(
    () => parseSource(`diagram "Ambiguous" {
      map: frame "Map" {
        arrange tree { root = root }
        root: rectangle "Root"
        first: rectangle "First"
        second: rectangle "Second"
        root -> second
        first -> second
      }
    }`),
    /tree node 'map\.second' has more than one parent/,
  );
  assert.throws(
    () => parseSource(`diagram "Cycle" {
      map: frame "Map" {
        arrange tree { root = root }
        root: rectangle "Root"
        child: rectangle "Child"
        root -> child
        child -> root
      }
    }`),
    /tree node 'map\.root' has more than one parent|contains a cycle/,
  );
});

test("notes attach to semantic anchors and remain connectable", () => {
  const drawing = compile(parseSource(`
    use "xdraw/annotations" as annotations
    diagram "Investigation" {
      source: rectangle "Source snapshot"
      target: rectangle "Candidate output"
      source -> target "compare"
      mismatch: annotations.note "Three records differ" { attach = target@south }
      owner: annotations.callout "Confirm expected semantics"
      owner -> mismatch
    }
  `)).toJSON();

  assert.ok(drawing.elements.some((element) => element.id === "mismatch:frame"));
  assert.equal(drawing.elements.filter((element) => element.type === "arrow").length, 2);
});

test("callouts preserve declaration identity, connectability, and warning tone", () => {
  const drawing = compile(parseSource(`
    use "xdraw/annotations" as annotations
    diagram "Review" {
      source: rectangle "Source"
      review: annotations.callout "Review semantics"
      source -> review
    }
  `)).toJSON();

  const callout = drawing.elements.find((element) => element.id === "review:frame");
  const connector = drawing.elements.find((element) => element.type === "arrow");

  assert.equal(callout?.type, "rectangle");
  assert.equal(callout?.strokeColor, "#d97706");
  assert.equal(callout?.backgroundColor, "#fef3c7");
  assert.equal(connector?.endBinding?.elementId, "review:frame");
  assert.ok(callout?.boundElements?.some(({ type, id }) => (
    type === "arrow" && id === connector?.id
  )));
});

test("assets, images, and library icons resolve through the normal asset pipeline", async () => {
  const filesystem = new MemoryFileSystem({
    "mark.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10"/></svg>',
  });
  const document = parseSource(`
    use "xdraw/assets" as assets
    diagram "Portable assets" {
      logo: asset "mark.svg"
      hero: image(logo) { at = (100, 100); size = (320, 160); fit = contain; alt = "Mark" }
      mark: assets.icon(logo) { at = (470, 120); size = (80, 80); fit = contain }
    }
  `);
  const drawing = compile(await resolveAssets(document, filesystem)).toJSON();

  assert.equal(requireElementById(drawing.elements, "hero").type, "image");
  assert.equal(requireElementById(drawing.elements, "mark").type, "image");
  assert.equal(Object.keys(drawing.files).length, 1);
});

test("precision transforms resolve namespaced selections before geometry", () => {
  const drawing = compile(parseSource(`diagram "Geometry" {
    workspace: frame "Workspace" {
      first: rectangle "First" { at = (80, 100); size = (100, 80) }
      second: rectangle "Second" { at = (330, 180); size = (140, 100) }
      third: rectangle "Third" { at = (700, 260); size = (120, 90) }
      fourth: rectangle "Fourth" { at = (900, 340); size = (100, 80) }
      fifth: rectangle "Fifth" { at = (1113, 427); size = (100, 80) }
      align top (first, second, third)
      distribute x (first, second, third)
      match-size (first, third) height
      offset (fourth) by (10, 0)
      rotate (third) 15
      snap (fifth) to 10
    }
  }`)).toJSON();
  const frames = ["first", "second", "third"].map((id) => (
    requireElementById(drawing.elements, `workspace.${id}:frame`)
  ));
  assert.equal(frames[0].y, frames[1].y);
  assert.equal(frames[0].height, frames[2].height);
  assert.notEqual(frames[2].angle, 0);
  assert.equal(requireElementById(drawing.elements, "workspace.fourth:frame").x, 910);
  assert.equal(requireElementById(drawing.elements, "workspace.fifth:frame").x % 10, 0);
});

test("deeply nested documents fail with a diagnostic rather than a stack overflow", () => {
  // Recursive descent has no natural floor: past a few hundred frames the
  // parser used to die with RangeError, which callers catching syntax errors
  // never see coming.
  const deep = (depth: number) => `diagram "D" {${'f: frame "F" {'.repeat(depth)}a: rectangle "A"${"}".repeat(depth)}}`;
  assert.doesNotThrow(() => parseSource(deep(40)));
  let error: unknown;
  try {
    parseSource(deep(5_000));
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof Error, "expected deeply nested source to be rejected");
  assert.doesNotMatch(error.message, /call stack/i, "must not surface as a stack overflow");
  assert.match(error.message, /nest/i);
});

test("errors name the import that provides an unresolved constructor", () => {
  // The registry knows which library exports each name, so the compiler can
  // print the exact `use` line rather than leaving the reader to search.
  assert.throws(
    () => parseSource('diagram "D" { f: math.formula """x^2""" }'),
    /use "xdraw\/math" as math/,
  );
  assert.throws(
    () => parseSource('diagram "D" { t: table.table "T" {} }'),
    /use "xdraw\/table" as table/,
  );
  assert.throws(
    () => parseSource('diagram "D" { n: note "hi" }'),
    /use "xdraw\/annotations"/,
  );
  // An alias nothing provides must not invent an import.
  assert.throws(
    () => parseSource('diagram "D" { a: nonsense.thing "x" }'),
    /unknown import alias 'nonsense'/,
  );
});

test("every suggestion produces a document that actually compiles", () => {
  // Matching the wording of a suggestion proves nothing. Apply it and reparse:
  // that is what a reader does, and it is where the first version failed.
  const applied = [
    ['diagram "D" { a: rectangle "A" { fill "#eee" } }', 'diagram "D" { a: rectangle "A" { background = "#eee" } }'],
    ['diagram "D" { a: rectangle "A" { backgroud "#eee" } }', 'diagram "D" { a: rectangle "A" { background = "#eee" } }'],
    ['diagram "D" { f: math.formula """x^2""" }', 'use "xdraw/math" as math\ndiagram "D" { f: math.formula """x^2""" }'],
    ['diagram "D" { n: note "hi" }', 'use "xdraw/annotations" as annotations\ndiagram "D" { n: annotations.note "hi" }'],
  ];
  for (const [broken, fixed] of applied) {
    assert.throws(() => parseSource(broken), `expected ${broken} to fail`);
    assert.doesNotThrow(() => parseSource(fixed), `applying the suggestion must compile: ${fixed}`);
  }
});

test("suggestions stay silent when the replacement would not be usable", () => {
  // 'size' is the right concept for width, but it takes a pair, so naming it
  // alone sends the reader into a second error. 'radius' has no counterpart:
  // roughness is sketchiness, not corner rounding.
  const message = (source: string) => {
    try { parseSource(source); return ""; } catch (error) { return String(error instanceof Error ? error.message : error); }
  };
  assert.match(message('diagram "D" { a: rectangle "A" { width = 100 } }'), /size \(width, height\)/);
  assert.doesNotMatch(message('diagram "D" { a: rectangle "A" { radius = 4 } }'), /did you mean/);
});

test("unknown properties suggest the XDraw name for familiar vocabulary", () => {
  // Vocabulary carried over from CSS and other tools is not a misspelling, so
  // edit distance cannot find it: 'fill' is closer to 'fit' than 'background'.
  const attempt = (property: string, value = '"#eee"') => () =>
    parseSource(`diagram "D" { a: rectangle "A" { ${property} = ${value} } }`);
  assert.throws(attempt("fill"), /did you mean 'background'/);
  assert.throws(attempt("color"), /did you mean 'stroke'/);
  assert.throws(attempt("width", "100"), /did you mean 'size \(width, height\)'/);
  assert.throws(attempt("height", "50"), /did you mean 'size \(width, height\)'/);
  assert.throws(attempt("font"), /did you mean 'font-family'/);

  // A genuine typo is close enough for edit distance to catch.
  assert.throws(attempt("backgroud"), /did you mean 'background'/);

  // Something unrelated must not attract a bogus suggestion.
  assert.throws(attempt("xyzzy"), /does not accept property 'xyzzy'/);
  assert.doesNotThrow(() => parseSource('diagram "D" { a: rectangle "A" { background = "#eee" } }'));
});

test("mistyped constructors and arrangements suggest the intended name", () => {
  // The edit-distance helper already backs property suggestions; these two
  // sites are the remaining places a near-miss goes unhelped.
  assert.throws(
    () => parseSource('diagram "D" { a: rectangel "A" }'),
    /did you mean 'rectangle'/,
  );
  assert.throws(
    () => parseSource('diagram "D" { a: elipse "A" }'),
    /did you mean 'ellipse'/,
  );
  assert.throws(
    () => parseSource('diagram "D" { arrange gird { columns = 2 }\na: rectangle "A" }'),
    /did you mean 'grid'/,
  );
  assert.throws(
    () => parseSource('diagram "D" { f: frame "F" { arrange colum { gap = 4 }\na: rectangle "A" } }'),
    /did you mean 'column'/,
  );

  // Applying the suggestion must produce something that compiles.
  assert.doesNotThrow(() => parseSource('diagram "D" { a: rectangle "A" }'));
  assert.doesNotThrow(() => parseSource('diagram "D" { arrange grid { columns = 2 }\na: rectangle "A" }'));

  // Nothing close enough must attract a guess.
  assert.throws(() => parseSource('diagram "D" { a: qqqqqqq "A" }'), /unknown constructor 'qqqqqqq'/);
  assert.doesNotMatch(
    (() => { try { parseSource('diagram "D" { a: qqqqqqq "A" }'); return ""; } catch (error) { return String(error instanceof Error ? error.message : error); } })(),
    /did you mean/,
  );
});

test("words that mean something else in this domain get no constructor suggestion", () => {
  // 'node' is one edit from 'code', and applying that suggestion compiles
  // cleanly into a code block, so the reader is told to write something that
  // silently produces the wrong element. Distance cannot separate these:
  // 'node' to 'code' is one edit with a margin of three over the runner-up.
  const message = (source: string) => {
    try { parseSource(source); return ""; } catch (error) { return String(error instanceof Error ? error.message : error); }
  };
  for (const word of ["node", "state"]) {
    const reported = message(`diagram "D" { a: ${word} "A" }`);
    assert.match(reported, new RegExp(`unknown constructor '${word}'`));
    assert.doesNotMatch(reported, /did you mean/, `'${word}' must not attract a suggestion`);
  }

  // Genuine typos still get help.
  assert.match(message('diagram "D" { a: rectangel "A" }'), /did you mean 'rectangle'/);
  assert.match(message('diagram "D" { a: cod "A" }'), /did you mean 'code'/);
});

test("every geometry statement kind is parsed and survives into the semantic document", () => {
  // One list feeds the parser, the semantic pass and the geometry pass. This walks
  // each kind through all three, so a kind added to the list but wired into none of
  // them fails here rather than being silently dropped at whichever stage was missed.
  const sources: Record<GeometryStatementKind, string> = {
    alignment: "align left (a, b)",
    distribution: "distribute x (a, b, c)",
    offset: "offset (a) by (5, 5)",
    "match-size": "match-size (a, b) width",
    rotation: "rotate (a) 15",
    snap: "snap (a) to 10",
    layer: "bring-to-front (a)",
  };
  assert.deepEqual(
    Object.keys(sources).sort(),
    [...GEOMETRY_STATEMENT_KINDS].sort(),
    "a geometry statement kind has no case here",
  );
  for (const [kind, statement] of Object.entries(sources)) {
    const source = `diagram "Geometry" {
      a: rectangle "A" { at = (0, 0); size = (100, 60) }
      b: rectangle "B" { at = (200, 0); size = (140, 80) }
      c: rectangle "C" { at = (400, 0); size = (100, 60) }
      ${statement}
    }`;
    const parsed = parseSyntax(source).diagram.statements.filter(isSourceGeometryStatement);
    assert.equal(parsed.length, 1, `${kind} did not parse as a geometry statement`);
    assert.equal(parsed[0]?.type, kind);
    const semantic = compile(parseSource(source)).elements;
    assert.ok(semantic.length > 0, `${kind} did not compile`);
  }
});
