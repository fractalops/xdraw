import assert from "node:assert/strict";
import test from "node:test";

import { SyntaxError, tokenize } from "../src/tokenizer.ts";

test("tokenizer preserves exact spans and separates comments", () => {
  const tokens = tokenize('# heading\ndiagram "Flow" { source -> target }');

  assert.deepEqual(tokens.slice(0, 4).map(({ type, value }) => ({ type, value })), [
    { type: "identifier", value: "diagram" },
    { type: "string", value: "Flow" },
    { type: "{", value: "{" },
    { type: "identifier", value: "source" },
  ]);
  assert.equal(tokens[0].start.line, 2);
  assert.equal(tokens.comments[0].value, "heading");
  assert.equal(tokens.comments[0].start.line, 1);
  assert.equal(Object.keys(tokens).includes("comments"), false);
});

test("tokenizer handles multiline strings, numbers, and escapes", () => {
  const tokens = tokenize('"""first\nsecond\n""" -12.5 "a\\tb"');
  assert.deepEqual(tokens.slice(0, -1).map(({ type, value }) => [type, value]), [
    ["string", "first\nsecond"],
    ["number", -12.5],
    ["string", "a\tb"],
  ]);
});

test("tokenizer reports source locations for malformed input", () => {
  assert.throws(
    () => tokenize('diagram "broken\\q"'),
    (error) => error instanceof SyntaxError
      && error.line === 1
      && error.column === 16
      && /unknown escape/.test(error.message),
  );
});
