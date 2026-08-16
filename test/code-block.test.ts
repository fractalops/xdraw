import assert from "node:assert/strict";
import test from "node:test";

import { compile, compileAsync } from "../src/compile/pipeline.ts";
import { codeBlockRequiredWidth } from "../src/text/code-block.ts";
import { FONT } from "../src/excalidraw/elements.ts";
import { renderSceneSvg } from "../src/io/local-renderer.ts";
import { buildSemanticIR } from "../src/language/semantic.ts";
import { parseSource } from "../src/language/parser.ts";

const SOURCE = `diagram "Code blocks" {
  example: code """
    function greet(name: string) {
      return \`Hello, \${name}\`;
    }
  """ {
    title "Greeting function"
    language typescript
    line-numbers true
  }
}`;

function codeSource(drawing, id = "example") {
  return drawing.elements.find((element) => element.id === `${id}:source`);
}

function codeFrame(drawing, id = "example") {
  return drawing.elements.find((element) => element.id === `${id}:frame`);
}

test("code blocks preserve relative indentation in the semantic document", () => {
  const block = parseSource(SOURCE).statements[0];

  assert.equal(block.type, "code");
  assert.equal(block.title, "Greeting function");
  assert.equal(block.language, "typescript");
  assert.equal(block.lineNumbers, true);
  assert.equal(block.highlight, false);
  assert.equal(block.value, "function greet(name: string) {\n  return `Hello, ${name}`;\n}");
});

test("code blocks render one editable source element without wrapping", () => {
  const drawing = compile(parseSource(SOURCE)).toJSON();
  const source = codeSource(drawing);

  assert.equal(codeFrame(drawing).type, "rectangle");
  assert.equal(source.fontFamily, FONT.code);
  assert.equal(source.autoResize, true);
  assert.equal(source.text, "function greet(name: string) {\n  return `Hello, ${name}`;\n}");
  assert.equal(source.originalText, source.text);
  assert.ok(drawing.elements.some((element) => element.id === "example:lines"));
  const title = drawing.elements.find((element) => element.id === "example:title");
  assert.equal(title.text, "Greeting function");
  assert.equal(title.fontFamily, FONT.bold);
  assert.equal(title.fontSize, 17);
  assert.equal(drawing.elements.find((element) => element.id === "example:language").text, "typescript");
  assert.equal(drawing.elements.find((element) => element.id === "example:language").textAlign, "right");
});

test("code blocks participate in container layout and may hide line numbers", () => {
  const drawing = compile(parseSource(`diagram "Nested code" {
    examples: frame "Examples" {
      arrange row { gap 32 }
      first: code "const first = true" { language typescript }
      second: code "SELECT 1" { language sql; line-numbers false }
    }
  }`)).toJSON();

  for (const id of [
    "examples.first:frame",
    "examples.first:source",
    "examples.second:frame",
    "examples.second:source",
  ]) {
    assert.equal(drawing.elements.find((element) => element.id === id).frameId, "examples");
  }
  assert.equal(drawing.elements.some((element) => element.id === "examples.second:lines"), false);
});

test("mixed rows wrap before shrinking code below its measured width", () => {
  const document = parseSource(`diagram "Mixed row" {
    examples: frame "Examples" {
      arrange row { gap 32 }
      first: rectangle "First" { size (400, 100) }
      sample: code "use \\"xdraw/architecture\\" as architecture" { language xdraw }
      last: rectangle "Last" { size (400, 100) }
    }
  }`);
  const code = document.statements[0].statements.find((item) => item.id === "examples.sample");
  const compiled = compile(document);
  const drawing = compiled.toJSON();
  const frame = codeFrame(drawing, "examples.sample");
  const first = drawing.elements.find((element) => element.id === "examples.first:frame");
  const last = drawing.elements.find((element) => element.id === "examples.last:frame");

  assert.ok(frame.width >= codeBlockRequiredWidth(code));
  assert.equal(compiled.diagnostics.some((item) => item.code === "XD2005"), false);
  assert.ok(last.y > first.y);
});

test("code blocks align with neighboring nodes by their visual center", () => {
  const drawing = compile(parseSource(`diagram "Aligned code" {
    examples: frame "Examples" {
      arrange row { gap 32 }
      first: rectangle "First" { size (220, 100) }
      sample: code "const first = true\\nconst second = false" { language typescript }
      last: rectangle "Last" { size (220, 140) }
      align center-y (first, sample, last)
    }
  }`)).toJSON();
  const frames = ["examples.first", "examples.sample", "examples.last"].map((id) => (
    codeFrame(drawing, id)
  ));
  const centers = frames.map((frame) => frame.y + frame.height / 2);

  assert.ok(centers.every((center) => Math.abs(center - centers[0]) < 1e-9));
});

test("async compilation renders compacted highlighted runs with canonical source metadata", async () => {
  const document = parseSource(`diagram "Highlighted code" {
    example: code "const value: number = 42" { language typescript; highlight true }
  }`);
  const drawing = (await compileAsync(document)).toJSON();
  const repeated = (await compileAsync(document)).toJSON();
  const source = drawing.elements.filter((element) => element.id.startsWith("example:source:"));

  assert.ok(source.length > 1);
  assert.ok(source.length < 12);
  assert.equal(codeSource(drawing), undefined);
  assert.ok(new Set(source.map((element) => element.strokeColor)).size > 1);
  assert.deepEqual(codeFrame(drawing).customData.xdraw, {
    type: "code",
    source: "const value: number = 42",
    language: "typescript",
    title: null,
    highlighted: true,
    highlightFallback: null,
  });
  assert.deepEqual(repeated, drawing);
});

test("highlighted XDraw source uses the native language vocabulary", async () => {
  const drawing = (await compileAsync(parseSource(`diagram "XDraw code" {
    example: code "scene excalidraw::default::examples::overview { patch { update api { title \\"API v2\\" } } }" { language xdraw; highlight true }
  }`))).toJSON();
  const source = drawing.elements.filter((element) => element.id.startsWith("example:source:"));

  for (const keyword of ["scene", "patch", "update"]) {
    assert.ok(source.some((element) => element.text === keyword && element.strokeColor === "#8250df"));
  }
});

test("synchronous compilation degrades highlighted code deterministically", () => {
  const drawing = compile(parseSource(`diagram "Synchronous code" {
    example: code "const value = 42" { language typescript; highlight true }
  }`)).toJSON();

  assert.equal(codeSource(drawing).text, "const value = 42");
  assert.equal(codeFrame(drawing).customData.xdraw.highlightFallback, "not-prepared");
});

test("highlight failures and source normalization safely fall back", async () => {
  // `total = left * right` used to serve here, but `=` now introduces an
  // expression and that sample tokenizes, so it no longer exercises the
  // fallback. `??` is not in the language at all.
  const invalidXDraw = (await compileAsync(parseSource(`diagram "Fallback" {
    example: code "total ?? left" { language xdraw; highlight true }
  }`))).toJSON();
  assert.equal(codeSource(invalidXDraw).text, "total ?? left");
  assert.equal(codeFrame(invalidXDraw).customData.xdraw.highlightFallback, "highlight-error");

  const crlfDocument = [
    'diagram "Fallback" {',
    '  example: code """',
    "    const x = 1",
    "    const y = 2",
    '  """ { language typescript; highlight true }',
    "}",
  ].join("\r\n");
  const crlf = (await compileAsync(parseSource(crlfDocument))).toJSON();
  assert.equal(codeSource(crlf).text, "const x = 1\r\nconst y = 2\r");
  assert.equal(codeFrame(crlf).customData.xdraw.source, "const x = 1\r\nconst y = 2\r");
  assert.equal(codeFrame(crlf).customData.xdraw.highlightFallback, "source-mismatch");
});

test("empty highlighted code remains an editable source element", async () => {
  const drawing = (await compileAsync(parseSource(`diagram "Empty code" {
    example: code "" { language typescript; highlight true }
  }`))).toJSON();

  assert.equal(codeSource(drawing).text, "");
  assert.equal(codeFrame(drawing).customData.xdraw.highlightFallback, "empty-source");
});

test("highlighting enforces line, run, and drawing-wide budgets", async () => {
  const longLine = `const value = "${"x".repeat(2_100)}"`;
  const dense = Array.from({ length: 40 }, (_, index) => (
    `const value${index}: number = input${index} + offset${index}`
  )).join("\n");
  const blocks = Array.from({ length: 120 }, (_, index) => (
    `b${index}: code "const value${index}: number = source${index} + 1" { language typescript; highlight true }`
  )).join("\n");
  const drawing = (await compileAsync(parseSource(`diagram "Budgets" {
    long: code ${JSON.stringify(longLine)} { language typescript; highlight true }
    dense: code ${JSON.stringify(dense)} { language typescript; highlight true }
    ${blocks}
  }`))).toJSON();

  assert.equal(codeFrame(drawing, "long").customData.xdraw.highlightFallback, "source-budget");
  assert.equal(codeFrame(drawing, "dense").customData.xdraw.highlightFallback, "block-budget");
  assert.ok(drawing.elements.some((element) => (
    element.id.endsWith(":frame") && element.customData?.xdraw?.highlightFallback === "drawing-budget"
  )));
});

test("rejected highlighting does not consume the drawing-wide run budget", async () => {
  const oversized = `const value = "${"x".repeat(2_100)}"`;
  const drawing = (await compileAsync(parseSource(`diagram "Budget accounting" {
    rejected: code ${JSON.stringify(oversized)} { language typescript; highlight true }
    accepted: code "const value: number = 42" { language typescript; highlight true }
  }`))).toJSON();
  assert.equal(codeFrame(drawing, "rejected").customData.xdraw.highlightFallback, "source-budget");
  assert.equal(codeFrame(drawing, "accepted").customData.xdraw.highlighted, true);
});

test("code blocks reject invalid content and values", () => {
  assert.throws(
    () => parseSource('diagram "Invalid" { sample: code "source" { nested: rectangle "No" } }'),
    /constructor 'code' does not accept children/,
  );
  assert.throws(
    () => compile(parseSource('diagram "Invalid" { sample: code "source" { line-numbers sometimes } }')),
    /property 'line-numbers' on 'code' expects boolean, received string/,
  );
  assert.throws(
    () => compile(parseSource('diagram "Invalid" { sample: code "source" { highlight sometimes } }')),
    /property 'highlight' on 'code' expects boolean, received string/,
  );
  assert.throws(
    () => compile(parseSource('diagram "Invalid" { sample: code "source" { language python; highlight true } }')),
    /XD1217: highlighted code language must be sql, typescript, or xdraw/,
  );
  assert.throws(
    () => parseSource('diagram "Invalid" { sample: code "source" { stroke "#f00" } }'),
    /constructor 'code' does not accept property 'stroke'/,
  );
  assert.throws(
    () => compile(parseSource(`diagram "Invalid" { sample: code ${JSON.stringify("x".repeat(100_001))} }`)),
    /XD1218: code source exceeds the supported size/,
  );

  const semantic = buildSemanticIR(parseSource('diagram "Invalid semantic input" { sample: code "source" }'));
  semantic.statements[0].lineNumbers = "yes";
  assert.throws(
    () => compile(semantic),
    /XD1215: code line-numbers must be true or false/,
  );
});

test("local previews preserve code indentation", () => {
  const svg = renderSceneSvg(compile(parseSource(SOURCE)).toJSON());

  assert.match(svg, /xml:space="preserve"/);
  assert.match(svg, />  return `Hello, \$\{name\}`;<\/tspan>/);
});
