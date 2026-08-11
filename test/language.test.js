import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { run } from "../src/cli.js";
import { compile } from "../src/compiler.js";
import { parse } from "../src/parser.js";
import { parsePartial } from "../src/partial.js";
import { createSceneGraph } from "../src/scene.js";
import { buildSemanticIR, DiagnosticError } from "../src/semantic.js";
import { createMeasurer } from "../src/measurement.js";

const SOURCE = `
diagram "Simple flow" {
  subtitle "A compact example"
  lane systems "Systems" {
    layout row gap 100
    source: card "Source" info { body "Reads data" }
    target: card "Target" success { body "Receives data" }
    source -> target "copies" [accent, width=3]
  }
}`;

test("parses semantic diagram structure", () => {
  const scene = parse(SOURCE);
  assert.equal(scene.title, "Simple flow");
  const lane = scene.statements.find((item) => item.type === "lane");
  assert.equal(lane.id, "systems");
  assert.deepEqual(lane.statements.filter((item) => item.type === "node").map((item) => item.id), [
    "source",
    "target",
  ]);
});

test("compiles language to deterministic Excalidraw elements", () => {
  const first = compile(parse(SOURCE)).toJSON();
  const second = compile(parse(SOURCE)).toJSON();
  assert.deepEqual(first, second);
  assert.equal(first.type, "excalidraw");
  assert.ok(first.elements.some((element) => element.id === "document:connection:0:0"));
});

test("reports source locations for syntax errors", () => {
  assert.throws(() => parse('diagram "Broken" { lane }'), /at 1:25/);
});

test("preserves source spans and comments without changing the public AST shape", () => {
  const ast = parse(`diagram "Located" {
    # A source comment.
    source: card "Source"
  }`);
  const source = ast.statements.find((item) => item.id === "source");
  assert.deepEqual(Object.keys(source), ["type", "kind", "id", "title", "tone", "attributes", "at", "size", "statements"]);
  assert.deepEqual(source.span.start, { offset: 48, line: 3, column: 5 });
  assert.equal(ast.comments[0].value, "A source comment.");
});

test("preserves raw literal forms for formatting without changing semantic values", () => {
  const ast = parse('diagram "Raw" { text label "line\\nvalue" at (10.0, -2); body_holder: card """\nBody\n""" }');
  assert.equal(ast.tokens.find((token) => token.value === "line\nvalue").raw, '"line\\nvalue"');
  assert.equal(ast.tokens.find((token) => token.type === "number").raw, "10.0");
  assert.equal(ast.tokens.find((token) => token.raw.startsWith('"""')).raw, '"""\nBody\n"""');
  assert.equal(Object.keys(ast).includes("tokens"), false);
});

test("nested container measurement is bottom-up and cached", () => {
  const ast = parse('diagram "Nested" { group outer "Outer" { group inner "Inner" { item: card "Item" } } }');
  const measurer = createMeasurer();
  const outer = ast.statements[0];
  const first = measurer.measureContainer(outer, 1000);
  const second = measurer.measureContainer(outer, 1000);

  assert.equal(first, second);
  assert.deepEqual(measurer.stats, { nodeCalculations: 1, containerCalculations: 2 });
});

test("dense automatic layouts wrap before emitting invalid geometry", () => {
  const cards = Array.from({ length: 30 }, (_, index) => `n${index}: card "${index}"`).join("\n");
  const result = compile(parse(`diagram "Dense" { lane cards "Cards" { ${cards} } }`)).toJSON();
  const cardRows = new Set(result.elements
    .filter((element) => /^n\d+:frame$/u.test(element.id))
    .map((element) => element.y));
  assert.ok(cardRows.size > 1);

  const participants = Array.from({ length: 20 }, (_, index) => `participant p${index} "${index}"`).join("\n");
  assert.throws(
    () => compile(parse(`diagram "Dense" { sequence { ${participants}; p0 -> p1 } }`)),
    /sequence participants cannot fit 20 items/,
  );
});

test("explicitly positioned nodes expand their containing lane", () => {
  const result = compile(parse('diagram "Placed" { lane area "Area" { item: card "Item" at (100, 1000) } }')).toJSON();
  const lane = result.elements.find((element) => element.id === "area:frame");
  const item = result.elements.find((element) => element.id === "item:frame");
  assert.ok(lane.y + lane.height >= item.y + item.height + 24);
});

test("nested section types are measured and rendered bottom-up", () => {
  const result = compile(parse(`diagram "Nested sections" {
    lane outer "Outer" {
      lane inner "Inner" { item: card "Item" }
      sequence { participant a "A"; participant b "B"; a -> b "calls" }
    }
  }`)).toJSON();
  const outer = result.elements.find((element) => element.id === "outer:frame");
  const inner = result.elements.find((element) => element.id === "inner:frame");
  const sequence = result.elements.find((element) => element.id === "sequence:frame");
  assert.ok(outer.y + outer.height > inner.y + inner.height);
  assert.ok(outer.y + outer.height > sequence.y + sequence.height);
});

test("lowers AST to semantic IR and preserves source provenance in the scene graph", () => {
  const ast = parse('diagram "Provenance" { source: card "Source" }');
  const ir = buildSemanticIR(ast);
  const graph = createSceneGraph(ir, { diagramWidth: 1120, contentWidth: 1120, annotationGutterWidth: 0 });
  assert.equal(ir.type, "semantic-document");
  assert.equal(ir.ast, ast);
  assert.ok([...ir.objects.values()].every((object) => object.origin?.start?.line > 0));
  assert.deepEqual(graph.origins.get("source"), ast.statements[0].span);
  assert.equal(graph.capabilities.explicitPorts, true);
  assert.equal(graph.capabilities.edgeRouting, false);
});

test("semantic IR resolves references to indexed semantic objects", () => {
  const ir = buildSemanticIR(parse('diagram "References" { a: card "A"; b: card "B"; a -> b }'));
  assert.equal(ir.references.length, 2);
  assert.equal(ir.references[0].targetObject, ir.objects.get("a"));
  assert.equal(ir.references[1].targetObject, ir.objects.get("b"));
});

test("semantic validation reports independent failures together", () => {
  const ast = parse(`diagram "Invalid" {
    first: card "First"
    first: card "Duplicate"
    first -> missing
    align left (first, absent)
  }`);
  assert.throws(
    () => buildSemanticIR(ast),
    (error) => {
      assert.ok(error instanceof DiagnosticError);
      assert.deepEqual(error.diagnostics.map((item) => item.code), ["XD1001", "XD1002", "XD1002"]);
      assert.match(error.message, /duplicate semantic id 'first'/);
      assert.match(error.message, /connection references unknown node: missing/);
      assert.match(error.message, /geometry operation references unknown node: absent/);
      assert.ok(error.diagnostics.every((item) => item.location?.line > 0));
      return true;
    },
  );
});

test("CLI compiles an inline expression", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-"));
  const output = join(directory, "inline.excalidraw");
  await run(["build", "-e", SOURCE, "-o", output]);
  const result = JSON.parse(await readFile(output, "utf8"));
  assert.equal(result.type, "excalidraw");
});

test("CLI resolves rooted imports and embeds local assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-resources-"));
  await mkdir(join(directory, "parts"));
  await writeFile(join(directory, "parts", "service.xdraw"), 'component service(name) { api: system "{name}" }');
  await writeFile(join(directory, "mark.svg"), '<svg width="20" height="10" xmlns="http://www.w3.org/2000/svg"></svg>');
  await writeFile(join(directory, "main.xdraw"), `diagram "Resources" {
    import "parts/service.xdraw"
    use service orders [name="Orders"]
    asset mark "mark.svg"
    image logo mark at (0,0) size (40,20)
  }`);
  const output = join(directory, "result.excalidraw");
  await run(["build", join(directory, "main.xdraw"), "-o", output]);
  const result = JSON.parse(await readFile(output, "utf8"));
  assert.ok(result.elements.some((element) => element.id === "orders.api:frame"));
  assert.equal(result.elements.find((element) => element.id === "logo").type, "image");
  assert.equal(Object.keys(result.files).length, 1);
});

test("implicit diagrams lay out top-level cards", () => {
  const result = compile(parse('a: card "Source"; b: card "Target"; a -> b')).toJSON();
  assert.ok(result.elements.some((element) => element.id === "a:frame"));
  assert.ok(result.elements.some((element) => element.id === "document:connection:0:0"));
  assert.equal(result.elements.some((element) => element.id === "diagram:title"), false);
});

test("dotted node ids take precedence over port syntax", () => {
  const result = compile(parse('a: card "A"; a.north: card "Exact"; b: card "B"; a.north -> b')).toJSON();
  const connection = result.elements.find((element) => element.type === "arrow");
  assert.equal(connection.startBinding.elementId, "a.north:frame");
});

test("image attributes are validated strictly", () => {
  assert.throws(
    () => compile(parse('asset mark "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22/%3E"; image logo mark at (0,0) size (20,20) [fitt=contain]')),
    /XD1208: unsupported image attributes: fitt/,
  );
});

test("node sizes fail with source-located diagnostics", () => {
  assert.throws(
    () => compile(parse('diagram "Small" { tiny: card "Tiny" size (20, 20) }')),
    /XD1210: node width must be greater than 40.*1:19/,
  );
});

test("import diagnostics name the referencing files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-diagnostic-"));
  await writeFile(join(directory, "main.xdraw"), 'diagram "Main" { import "broken.xdraw" }');
  await writeFile(join(directory, "broken.xdraw"), 'diagram "Broken" { item: card "unterminated }');
  await assert.rejects(
    () => run(["check", join(directory, "main.xdraw")]),
    /main\.xdraw: import 'broken\.xdraw' failed: broken\.xdraw: unterminated string/,
  );
});

test("automatic nodes are placed below explicit nodes in the same container", () => {
  const result = compile(parse('diagram "Mixed" { lane area "Area" { pinned: card "Pinned" at (100, 180) size (220, 100); flowing: card "Flowing" } }')).toJSON();
  const pinned = result.elements.find((element) => element.id === "pinned:frame");
  const flowing = result.elements.find((element) => element.id === "flowing:frame");
  assert.ok(flowing.y >= pinned.y + pinned.height);
});

test("partial parsing returns the latest complete drawing prefix", () => {
  const partial = parsePartial(`diagram "Streaming" {
    lane flow "Flow" {
      first: card "First" info
      second: card "Sec`);
  assert.ok(partial);
  const lane = partial.scene.statements.find((item) => item.type === "lane");
  assert.deepEqual(lane.statements.filter((item) => item.type === "node").map((item) => item.id), ["first"]);
});

test("supports document-wide connections with explicit ports", () => {
  const result = compile(parse(`diagram "Cross lane" {
    lane first "First" { source: system "Source" }
    lane second "Second" { target: database "Target" }
    source.south -> target.north "loads"
  }`)).toJSON();
  assert.ok(result.elements.some((element) => element.id === "document:connection:0:0"));
});

test("tree layout emits recursive nodes and parent edges", () => {
  const result = compile(parse('diagram "Tree" { tree root "Root" { branch one "One" { leaf two "Two" } } }')).toJSON();
  assert.ok(result.elements.some((element) => element.id === "two:frame"));
  assert.ok(result.elements.some((element) => element.id === "document:connection:1:0"));
});

test("semantic nodes and nested groups retain their visual identity", () => {
  const result = compile(parse('diagram "Group" { group platform "Platform" { user: person "User"; choice: decision "Choose"; db: database "Data" } }')).toJSON();
  assert.equal(result.elements.find((element) => element.id === "choice:frame").type, "diamond");
  assert.ok(result.elements.some((element) => element.id === "platform:frame"));
  assert.ok(result.elements.some((element) => element.id === "user:kind"));
  assert.ok(result.elements.some((element) => element.id === "db:kind"));
});

test("sequence notation emits lifelines and every chained message", () => {
  const result = compile(parse('diagram "Sequence" { sequence { participant a "A"; participant b "B"; participant c "C"; a -> b -> c "calls" } }')).toJSON();
  assert.ok(result.elements.some((element) => element.id === "a:lifeline"));
  assert.ok(result.elements.some((element) => element.id === "sequence:message:0"));
  assert.ok(result.elements.some((element) => element.id === "sequence:message:1"));
});

test("notes and callouts attach to semantic node ports", () => {
  const result = compile(parse('diagram "Note" { a: card "A"; note n "Inspect" at a.south; note p "Pinned" at (900, 200); callout c "Confirm" at (900, 320) -> a.east }')).toJSON();
  assert.ok(result.elements.some((element) => element.id === "n:frame"));
  assert.equal(result.elements.find((element) => element.id === "p:frame").x, 900);
  assert.ok(result.elements.some((element) => element.id === "c:frame"));
  assert.ok(result.elements.some((element) => element.id === "document:callout:2"));
});

test("precision placement preserves explicit position and size", () => {
  const result = compile(parse('diagram "Place" { a: system "A" at (80, 120) size (220, 100); b: system "B" at (420, 120); a.east -> b.west }')).toJSON();
  const frame = result.elements.find((element) => element.id === "a:frame");
  assert.deepEqual({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }, {
    x: 80, y: 120, width: 220, height: 100,
  });
});

test("simple nodes use native bound text with explicit alignment", () => {
  const result = compile(parse(`diagram "Bound" {
    status: card "Approved" at (80, 120) size (240, 120) {
      text-align right
      vertical-align bottom
    }
  }`)).toJSON();
  const frame = result.elements.find((element) => element.id === "status:frame");
  const label = result.elements.find((element) => element.id === "status:title");
  assert.deepEqual(frame.boundElements, [{ type: "text", id: label.id }]);
  assert.equal(label.containerId, frame.id);
  assert.equal(label.textAlign, "right");
  assert.equal(label.verticalAlign, "bottom");
});

test("rich cards group styled text without claiming native binding", () => {
  const result = compile(parse('diagram "Rich" { info: card "Heading" { body "Separate supporting copy" } }')).toJSON();
  const frame = result.elements.find((element) => element.id === "info:frame");
  const title = result.elements.find((element) => element.id === "info:title");
  const body = result.elements.find((element) => element.id === "info:body");
  assert.equal(title.containerId, null);
  assert.equal(body.containerId, null);
  assert.deepEqual(frame.groupIds, title.groupIds);
  assert.deepEqual(frame.groupIds, body.groupIds);
});

test("free text supports auto width and fixed-width wrapping", () => {
  const result = compile(parse(`diagram "Text" {
    text caption "Free label" at (100, 80) align center
    text paragraph "A deliberately longer paragraph that must wrap inside a fixed width" at (100, 140) width 180 align left font 16
  }`)).toJSON();
  const caption = result.elements.find((element) => element.id === "caption");
  const paragraph = result.elements.find((element) => element.id === "paragraph");
  assert.equal(caption.autoResize, true);
  assert.equal(caption.textAlign, "center");
  assert.equal(paragraph.autoResize, false);
  assert.equal(paragraph.width, 180);
  assert.match(paragraph.text, /\n/);
});

test("parses and applies alignment and distribution before routing", () => {
  const scene = parse(`diagram "Geometry" {
    a: card "A" at (80, 100) size (100, 80)
    b: card "B" at (330, 180) size (140, 100)
    c: card "C" at (700, 260) size (120, 90)
    align top (a, b, c)
    distribute x (a, b, c)
    a -> c
  }`);
  assert.deepEqual(scene.statements.filter((item) => ["alignment", "distribution"].includes(item.type)), [
    { type: "alignment", mode: "top", ids: ["a", "b", "c"] },
    { type: "distribution", axis: "x", ids: ["a", "b", "c"] },
  ]);
  const result = compile(scene).toJSON();
  const frames = ["a", "b", "c"].map((id) => result.elements.find((element) => element.id === `${id}:frame`));
  assert.deepEqual(frames.map((frame) => frame.y), [100, 100, 100]);
  assert.equal(frames[1].x - (frames[0].x + frames[0].width), frames[2].x - (frames[1].x + frames[1].width));
  const edge = result.elements.find((element) => element.id === "document:connection:0:0");
  assert.equal(edge.startBinding.elementId, "a:frame");
  assert.equal(edge.endBinding.elementId, "c:frame");
  assert.equal(edge.y + edge.points[0][1], frames[0].y + frames[0].height / 2);
});

test("geometry operations reject invalid selections", () => {
  assert.throws(() => compile(parse('diagram "Bad" { a: card "A"; align left (a, missing) }')), /unknown node: missing/);
  assert.throws(() => compile(parse('diagram "Bad" { a: card "A"; align left (a, a) }')), /duplicate node ids/);
  assert.throws(() => compile(parse('diagram "Bad" { a: card "A"; distribute x (a) }')), /at least three/);
});

test("automatic cards grow to contain wrapped content", () => {
  const result = compile(parse(`diagram "Sizing" {
    lane flow "Flow" {
      layout row
      detail: card "A deliberately long title that wraps over several lines" {
        body "A long explanation must remain inside its card instead of being clipped by a fixed automatic height."
      }
      companion: card "A second card"
      final: card "A third card"
    }
  }`)).toJSON();
  const frame = result.elements.find((element) => element.id === "detail:frame");
  const body = result.elements.find((element) => element.id === "detail:body");
  assert.ok(frame.height > 110);
  assert.ok(body.y + body.height <= frame.y + frame.height);
});

test("document connections route around unrelated nodes", () => {
  const result = compile(parse(`diagram "Routing" {
    source: system "Source" at (80, 120)
    obstacle: system "Obstacle" at (380, 100) size (220, 150)
    target: system "Target" at (760, 120)
    source.east -> target.west
  }`)).toJSON();
  const edge = result.elements.find((element) => element.id === "document:connection:0:0");
  const absolutePoints = edge.points.map(([x, y]) => [x + edge.x, y + edge.y]);
  assert.ok(absolutePoints.length >= 5);
  assert.ok(absolutePoints.some(([, y]) => y < 88 || y > 262));
});

test("semantic node variants contain their measured text", () => {
  const result = compile(parse(`diagram "Measured variants" {
    lane flow "Flow" {
      layout row gap 30
      decision_node: decision "A decision title that must wrap safely"
      person_node: person "A participant with a longer display name"
    }
  }`)).toJSON();
  for (const id of ["decision_node", "person_node"]) {
    const frame = result.elements.find((element) => element.id === `${id}:frame`);
    const title = result.elements.find((element) => element.id === `${id}:title`);
    assert.ok(title.y >= frame.y);
    assert.ok(title.y + title.height <= frame.y + frame.height);
  }
});

test("tree section title is independent from its semantic root", () => {
  const result = compile(parse('tree root "Root decision" [section="Decision factors"] { leaf one "One" }')).toJSON();
  assert.equal(result.elements.find((element) => element.id === "tree:root:title").text, "Decision factors");
  assert.equal(result.elements.find((element) => element.id === "root:title").text, "Root decision");
});

test("sequence participants grow before messages begin", () => {
  const result = compile(parse('sequence { participant a "A participant with a long wrapped title"; participant b "B"; a -> b "A descriptive message" }')).toJSON();
  const participant = result.elements.find((element) => element.id === "a:frame");
  const message = result.elements.find((element) => element.id === "sequence:message:0");
  assert.ok(participant.height >= 112);
  assert.ok(message.y > participant.y + participant.height);
});

test("automatic annotations stay within the diagram width", () => {
  const result = compile(parse('diagram "Annotations" { a: system "Target"; note n "A useful bounded annotation" at a.east }')).toJSON();
  const note = result.elements.find((element) => element.id === "n:frame");
  assert.ok(note.x >= 70);
  assert.ok(note.x + note.width <= 1190);
});

test("compact documents use wider sections and configured spacing", () => {
  const result = compile(parse('diagram "Compact" { layout compact gap 18; lane a "A" { x: card "X" }; lane b "B" { y: card "Y" } }')).toJSON();
  const first = result.elements.find((element) => element.id === "a:frame");
  const second = result.elements.find((element) => element.id === "b:frame");
  assert.equal(first.width, 1240);
  assert.equal(second.y - (first.y + first.height), 18);
});

test("grid documents place top-level sections in two columns", () => {
  const result = compile(parse(`diagram "Grid" {
    layout grid gap 30
    lane first "First" { a: card "A" }
    lane second "Second" { b: card "B" }
    lane third "Third" { c: card "C" }
  }`)).toJSON();
  const first = result.elements.find((element) => element.id === "first:frame");
  const second = result.elements.find((element) => element.id === "second:frame");
  const third = result.elements.find((element) => element.id === "third:frame");
  assert.ok(second.x > first.x + first.width);
  assert.equal(second.y, first.y);
  assert.equal(third.x, first.x);
  assert.ok(third.y > first.y + first.height);
});

test("grid documents support an explicit landscape column count", () => {
  const result = compile(parse(`diagram "Grid" {
    layout grid columns 3 gap 30
    lane first "First" { a: card "A" }
    lane second "Second" { b: card "B" }
    lane third "Third" { c: card "C" }
    lane fourth "Fourth" { d: card "D" }
  }`)).toJSON();
  const first = result.elements.find((element) => element.id === "first:frame");
  const second = result.elements.find((element) => element.id === "second:frame");
  const third = result.elements.find((element) => element.id === "third:frame");
  const fourth = result.elements.find((element) => element.id === "fourth:frame");
  assert.equal(first.y, second.y);
  assert.equal(first.y, third.y);
  assert.ok(first.x < second.x && second.x < third.x);
  assert.equal(fourth.x, first.x);
  assert.ok(fourth.y > first.y + first.height);
});

test("layout columns rejects invalid counts and non-grid layouts", () => {
  assert.throws(() => parse('diagram "Invalid" { layout grid columns 0 }'), /positive integer/);
  assert.throws(
    () => compile(parse('diagram "Invalid" { layout compact columns 3; lane a "A" { x: card "X" } }')),
    /supported only by document grid layout/,
  );
});

test("connection styles emit native Excalidraw arrow semantics", () => {
  const result = compile(parse(`diagram "Arrows" {
    a: system "A" at (80, 100)
    obstacle: card "Obstacle" at (350, 80)
    b: system "B" at (700, 100)
    a.east -> b.west "route" [style=elbow]
  }`)).toJSON();
  const edge = result.elements.find((element) => element.id === "document:connection:0:0");
  const label = result.elements.find((element) => element.id === "document:connection:0:0:label");
  const source = result.elements.find((element) => element.id === "a:frame");
  const target = result.elements.find((element) => element.id === "b:frame");
  assert.equal(edge.elbowed, true);
  assert.equal(edge.endArrowhead, "triangle");
  assert.equal(edge.startBinding.elementId, "a:frame");
  assert.equal(edge.endBinding.elementId, "b:frame");
  assert.equal(label.containerId, edge.id);
  assert.ok(source.boundElements.some((item) => item.id === edge.id));
  assert.ok(target.boundElements.some((item) => item.id === edge.id));
});

test("explicit connection styles preserve distinct geometry and heads", () => {
  const result = compile(parse(`diagram "Styles" {
    a: card "A" at (80, 100); b: card "B" at (500, 100)
    a -> b [style=curved, head=triangle_outline]
  }`)).toJSON();
  const edge = result.elements.find((element) => element.id === "document:connection:0:0");
  assert.equal(edge.elbowed, false);
  assert.deepEqual(edge.roundness, { type: 2 });
  assert.equal(edge.endArrowhead, "triangle_outline");
  assert.equal(edge.points.length, 4);
});
