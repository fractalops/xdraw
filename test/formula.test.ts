import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { compile, compileAsync } from "../src/pipeline.ts";
import { expandDocument } from "../src/expander.ts";
import { FORMULA_LIMITS } from "../src/math/formula.ts";
import { renderScenePng } from "../src/local-renderer.ts";
import { renderFormulaSvg } from "../src/math/renderer.ts";
import { buildSemanticIR, DiagnosticError } from "../src/semantic.ts";
import { parseSource } from "../src/source-language.ts";
import type { DrawingJson, ImageElement, LinearElement } from "../src/render-contracts.ts";
import type { NodeStatement } from "../src/semantic-contracts.ts";

const GAUSSIAN = String.raw`\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}`;

function source(formula = GAUSSIAN): string {
  return `use "xdraw/math" as math

diagram "Formula" {
  gaussian: math.formula """
${formula}
"""
}`;
}

function formulaImage(scene: DrawingJson): ImageElement {
  const element = scene.elements.find(
    (candidate): candidate is ImageElement => candidate.type === "image" && candidate.id === "gaussian:image",
  );
  assert.ok(element);
  return element;
}

function svgSource(scene: DrawingJson, image: ImageElement): string {
  const dataUrl = scene.files[image.fileId]?.dataURL;
  assert.ok(dataUrl?.startsWith("data:image/svg+xml;base64,"));
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64").toString("utf8");
}

test("math.formula lowers exact TeX source into a formula node", () => {
  const document = buildSemanticIR(parseSource(source()));
  const node = document.statements.find(
    (statement): statement is NodeStatement => statement.type === "node" && statement.kind === "formula",
  );
  assert.ok(node);
  assert.equal(node.id, "gaussian");
  assert.equal(node.title, GAUSSIAN);
});

test("raw TeX preserves interpolation-like syntax literally", () => {
  const literal = `${String.raw`\text{`}${"${value}"}}`;
  const document = buildSemanticIR(parseSource(source(literal)));
  const node = document.statements.find(
    (statement): statement is NodeStatement => statement.type === "node" && statement.kind === "formula",
  );
  assert.equal(node?.title, literal);
});

test("formula rendering is explicit about requiring asynchronous compilation", () => {
  assert.throws(
    () => compile(parseSource(source())),
    /math\.formula requires asynchronous compilation with compileAsync/u,
  );
});

test("formula compilation does not reuse stale preparation state", async () => {
  const document = buildSemanticIR(parseSource(source(String.raw`x = 1`)));
  const first = (await compileAsync(document)).toJSON();
  const node = document.statements.find(
    (statement): statement is NodeStatement => statement.type === "node" && statement.kind === "formula",
  );
  assert.ok(node);
  node.title = String.raw`x = 2`;
  node.authoredSource = String.raw`x = 2`;

  const second = (await compileAsync(document)).toJSON();
  assert.notEqual(formulaImage(first).fileId, formulaImage(second).fileId);
  assert.equal(formulaImage(second).customData?.xdraw?.source, String.raw`x = 2`);
  assert.throws(() => compile(document), /requires asynchronous compilation/u);
});

test("compileAsync embeds deterministic sanitized SVG and formula metadata", async () => {
  const first = (await compileAsync(parseSource(source()))).toJSON();
  const second = (await compileAsync(parseSource(source()))).toJSON();
  assert.deepEqual(second, first);

  const image = formulaImage(first);
  const metadata = image.customData?.xdraw;
  assert.equal(metadata?.type, "formula");
  assert.equal(metadata?.source, GAUSSIAN);
  assert.equal(metadata?.renderer, "mathjax-svg");
  assert.match(String(metadata?.rendererVersion), /^4\./u);
  assert.match(String(metadata?.digest), /^[a-f0-9]{64}$/u);
  assert.equal(image.fileId, String(metadata?.digest).slice(0, 40));

  const svg = svgSource(first, image);
  assert.equal(createHash("sha256").update(svg).digest("hex"), metadata?.digest);
  assert.match(svg, /^<svg\b/u);
  assert.doesNotMatch(svg, /\sdata-[\w:-]+=/u);
  assert.doesNotMatch(svg, /<(?:script|foreignObject|iframe|object|embed|style)\b/iu);
  assert.equal(first.elements.find(({ id }) => id === "gaussian:frame")?.type, "rectangle");
});

test("formula metadata preserves authored indentation and line endings", async () => {
  const authored = "\r\n    x + y\r\n  ";
  const document = parseSource(
    `use "xdraw/math" as math\r\ndiagram "Formula" {\r\n  gaussian: math.formula \"\"\"${authored}\"\"\"\r\n}`,
  );
  const scene = (await compileAsync(document)).toJSON();
  assert.equal(formulaImage(scene).customData?.xdraw?.source, authored);
});

test("identical formulas share one embedded file", async () => {
  const document = parseSource(`use "xdraw/math" as math
diagram "Repeated" {
  first: math.formula """${String.raw`x^2 + y^2`}"""
  second: math.formula """
    ${String.raw`x^2 + y^2`}
  """
}`);
  const scene = (await compileAsync(document)).toJSON();
  assert.equal(Object.keys(scene.files).length, 1);
  const images = scene.elements.filter((element): element is ImageElement => element.type === "image");
  assert.equal(images.length, 2);
  assert.equal(images[0].fileId, images[1].fileId);
});

test("formula SVG renders into a non-empty PNG", async () => {
  const scene = (await compileAsync(parseSource(source(String.raw`a < b \le c`)))).toJSON();
  const png = renderScenePng(scene, { padding: 20 });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 1_000);
});

test("formula geometry remains addressable by connectors", async () => {
  const scene = (await compileAsync(parseSource(`use "xdraw/math" as math
diagram "Connected" {
  formula: math.formula """${String.raw`E = mc^2`}"""
  result: rectangle "Result"
  formula -> result
}`))).toJSON();
  const connector = scene.elements.find(
    (element): element is LinearElement => element.type === "arrow" || element.type === "line",
  );
  assert.ok(connector);
  assert.equal(connector.startBinding?.elementId, "formula:frame");
  assert.ok(scene.elements.some(({ id, width }) => id === "formula:frame" && width > 0));
});

test("formula raw-string requirements compose through templates", async () => {
  const tex = String.raw`\text{` + "${value}" + "}";
  const templateSource = (formula: string): string => String.raw`use "xdraw/math" as math
diagram "Template" {
  equation: template(source) {
    rendered: math.formula($source)
  }
  gaussian: equation("""${formula}""")
}`;
  const document = buildSemanticIR(expandDocument(parseSource(templateSource(tex))));
  const node = document.statements.find(
    (statement): statement is NodeStatement => statement.type === "node" && statement.kind === "formula",
  );
  assert.equal(node?.title, tex);
  assert.equal(node?.authoredSource, tex);

  const scene = (await compileAsync(parseSource(templateSource(String.raw`x^2`)))).toJSON();
  const formula = scene.elements.find(({ id }) => id === "gaussian.rendered:image");
  assert.equal(formula?.type, "image");
  assert.equal(formula?.customData?.xdraw?.source, String.raw`x^2`);
});

test("formula validation rejects empty, malformed, untrusted and oversized input", async (context) => {
  await context.test("escaped string", async () => {
    assert.throws(
      () => parseSource(String.raw`use "xdraw/math" as math
diagram "Escaped" {
  expression: math.formula "x \times y"
}`),
      /expects raw-string, received string/u,
    );
  });
  await context.test("empty", async () => {
    await assert.rejects(() => compileAsync(parseSource(source(" "))), /formula 'gaussian' must not be empty/u);
  });
  await context.test("malformed", async () => {
    await assert.rejects(
      () => compileAsync(parseSource(source(String.raw`\frac{1`))),
      /formula 'gaussian' is invalid:/u,
    );
  });
  await context.test("untrusted command", async () => {
    for (const formula of [
      String.raw`\href{https:\/\/example.com}{open}`,
      String.raw`\htmlClass{unsafe}{x}`,
      String.raw`\require{html}`,
    ]) {
      await assert.rejects(
        () => compileAsync(parseSource(source(formula))),
        /formula 'gaussian' is invalid:/u,
      );
    }
  });
  await context.test("source budget", async () => {
    await assert.rejects(
      () => compileAsync(parseSource(source(`x${"+x".repeat(FORMULA_LIMITS.sourceCharacters)}`))),
      new RegExp(`${FORMULA_LIMITS.sourceCharacters}-character source limit`, "u"),
    );
  });
  await context.test("authored source budget", async () => {
    const indentation = " ".repeat(FORMULA_LIMITS.sourceCharacters + 1);
    await assert.rejects(
      () => compileAsync(parseSource(source(`${indentation}x`))),
      new RegExp(`${FORMULA_LIMITS.sourceCharacters}-character source limit`, "u"),
    );
  });
});

test("formula rendering errors retain a diagnostic code and source location", async () => {
  await assert.rejects(
    () => compileAsync(parseSource(`use "xdraw/math" as math
diagram "Invalid" {
  broken: math.formula """\\frac{1"""
}`)),
    (error: unknown) => {
      assert.ok(error instanceof DiagnosticError);
      assert.equal(error.diagnostics[0]?.code, "XD1264");
      assert.equal(error.diagnostics[0]?.location?.line, 3);
      assert.match(error.diagnostics[0]?.message ?? "", /formula 'broken' is invalid/u);
      return true;
    },
  );
});

test("formula count is bounded before invoking the renderer", async () => {
  const formulas = Array.from(
    { length: FORMULA_LIMITS.count + 1 },
    (_, index) => `f${index}: math.formula """x_${index}"""`,
  ).join("\n");
  await assert.rejects(
    () => compileAsync(parseSource(`use "xdraw/math" as math\ndiagram "Many" {\n${formulas}\n}`)),
    new RegExp(`at most ${FORMULA_LIMITS.count} formulas`, "u"),
  );
});

test("aggregate formula source is bounded before invoking the renderer", async () => {
  const perFormula = "x".repeat(700);
  const formulas = Array.from(
    { length: FORMULA_LIMITS.count },
    (_, index) => `f${index}: math.formula """${perFormula}_${index}"""`,
  ).join("\n");
  await assert.rejects(
    () => compileAsync(parseSource(`use "xdraw/math" as math\ndiagram "Many" {\n${formulas}\n}`)),
    new RegExp(`${FORMULA_LIMITS.aggregateSourceCharacters}-character document limit`, "u"),
  );
});

test("formula rendering resets MathJax labels between documents", async () => {
  const reference = String.raw`\eqref{eq:x}`;
  const before = await renderFormulaSvg(reference);
  await renderFormulaSvg(String.raw`\tag{1}\label{eq:x} x=1`);
  const after = await renderFormulaSvg(reference);
  assert.deepEqual(after, before);
});

test("formula rendering enforces a hard deadline and recovers with a fresh worker", async () => {
  await assert.rejects(() => renderFormulaSvg("x", 0), /formula rendering exceeded 0ms/u);
  const recovered = await renderFormulaSvg("x");
  assert.match(recovered.svg, /^<svg\b/u);
});

test("formula output uses the shared image dimension limit", async () => {
  const wide = `${"a+".repeat(100)}a`;
  await assert.rejects(
    () => compileAsync(parseSource(source(wide))),
    /formula 'gaussian' exceeds the 8192-pixel dimension limit/u,
  );
});

test("oversized formula output is rejected before it is embedded", async () => {
  const large = `${"a+".repeat(900)}a`;
  await assert.rejects(
    () => compileAsync(parseSource(source(large))),
    /(?:byte output|pixel dimension) limit/u,
  );
});
