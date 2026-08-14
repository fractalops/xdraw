import assert from "node:assert/strict";
import test from "node:test";

import {
  highlightSource,
  prepareSyntaxHighlighting,
  sourceFromHighlight,
  supportsHighlighting,
} from "../src/text/syntax-highlighter.ts";

test("highlighting support uses a closed language vocabulary", () => {
  assert.equal(supportsHighlighting("sql"), true);
  assert.equal(supportsHighlighting("typescript"), true);
  assert.equal(supportsHighlighting("xdraw"), true);
  assert.equal(supportsHighlighting("python"), false);
  assert.throws(() => highlightSource("print('no')", "python"), /unsupported highlight language/);
});

test("XDraw highlighting reconstructs source exactly", () => {
  const source = 'diagram "Flow" {\n  source: rectangle "Source"\n  source -> target\n}\n';
  const lines = highlightSource(source, "xdraw");
  assert.equal(sourceFromHighlight(lines), source);
  assert.ok(lines.flat().some((run) => run.color !== "#24292f"));
});

test("concurrent Shiki preparation is reusable and preserves source", async () => {
  await Promise.all([
    prepareSyntaxHighlighting(["sql", "typescript"]),
    prepareSyntaxHighlighting(["typescript", "sql"]),
  ]);
  for (const [language, source] of [
    ["sql", "SELECT id FROM records WHERE active = 1"],
    ["typescript", "const value: number = 42;"],
  ]) {
    assert.equal(sourceFromHighlight(highlightSource(source, language)), source);
  }
});
