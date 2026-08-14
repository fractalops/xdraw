// Characterization coverage for the semantic validator.
//
// Each entry pins one diagnostic code to a document that triggers it, so the
// validator can be decomposed by semantic family provably rather than hopefully.
//
// Coverage is partial by necessity: many codes in validateSemanticDocument are
// shadowed by src/language/validator.ts, which rejects the document before the
// semantic validator runs. Those are defence for the programmatic path, where a
// caller hands compile() a SemanticDocument it built itself. See CONTEXT.md.
import assert from "node:assert/strict";
import test from "node:test";

import { expandDocument } from "../src/language/expander.ts";
import { parseSource } from "../src/language/parser.ts";
import { validateSemanticDocument } from "../src/language/semantic.ts";

function codes(source: string): string[] {
  return validateSemanticDocument(expandDocument(parseSource(source))).map((item) => item.code);
}

function wrap(body: string): string {
  return `diagram "Checks" {\n${body}\n}`;
}

const CASES: ReadonlyArray<readonly [code: string, source: string]> = [
  ["XD1003", wrap('s: style { stroke "#fff" }\ns: style { stroke "#000" }')],
  ["XD1007", wrap("a: theme { font-family normal }\nb: theme { font-family normal }")],
  ["XD1002", wrap('a: rectangle "A"\nb: rectangle "B"\na -> ghost')],
  ["XD1004", wrap('a: rectangle "A" { style missing }')],
  ["XD1101", wrap('a: rectangle "A"\nalign left (a, a)')],
  ["XD1104", wrap('a: rectangle "A"\nb: rectangle "B"\nsnap (a, b) to 0')],
  ["XD1107", wrap('a: rectangle "A"\nalign left (a)')],
  ["XD1109", wrap('a: rectangle "A"\nb: rectangle "B"\ndistribute x (a, b)')],
  ["XD1209", wrap('a: rectangle "A" { size (0, 10) }')],
  ["XD1210", wrap('a: rectangle "A" { size (20, 60) }')],
  ["XD1212", 'use "xdraw/annotations" as ann\ndiagram "Checks" { n: ann.note "Floating" }'],
  ["XD1213", wrap("arrange grid { width 0 }")],
  ["XD1232", wrap('a: rectangle "A"\nb: rectangle "B"\na -> b { width 0 }')],
  ["XD1235", wrap("arrange row { gap -1 }")],
  ["XD1243", wrap("arrange grid { columns 0 }")],
];

for (const [code, source] of CASES) {
  test(`semantic validation reports ${code}`, () => {
    const reported = codes(source);
    assert.ok(
      reported.includes(code),
      `expected ${code}, got [${reported.join(", ")}]\n---\n${source}`,
    );
  });
}

test("valid documents produce no semantic diagnostics", () => {
  assert.deepEqual(codes(wrap('a: rectangle "A"\nb: rectangle "B"\na -> b "edge"')), []);
});

test("diagnostics keep a stable order across independent rule families", () => {
  // Ordering is part of the contract: decomposing the validator by family must
  // not reorder what callers already see. Note that the order is neither source
  // order nor code order — it follows the sequence of checks inside the visitor.
  const source = wrap([
    's: style { stroke "#fff" }',
    's: style { stroke "#000" }',
    'a: rectangle "A" { size (0, 10) }',
    'b: rectangle "B" { style missing }',
    "arrange grid { columns 0 }",
  ].join("\n"));
  assert.deepEqual(codes(source), ["XD1003", "XD1209", "XD1243", "XD1004"]);
});
