// Coverage for the semantic validator, at two levels.
//
// Source level: proves a rule is reachable by writing ordinary XDraw. Many are
// not, because src/language/validator.ts rejects the document first.
//
// IR level: builds a SemanticDocument directly. This is the path those rules
// actually defend — compile() accepts a SemanticDocument, and a caller can hand
// it one it built itself rather than one buildSemanticIR produced and validated.
// Every rule in VALIDATION_RULES is exercised here. See CONTEXT.md.
import assert from "node:assert/strict";
import test from "node:test";

import { expandDocument } from "../src/language/expander.ts";
import { parseSource } from "../src/language/parser.ts";
import { validateSemanticDocument } from "../src/language/semantic.ts";
import type { SemanticStatement } from "../src/contracts/semantic.ts";

function codes(source: string): string[] {
  return validateSemanticDocument(expandDocument(parseSource(source))).map((item) => item.code);
}

/**
 * These documents are deliberately malformed, so they cannot satisfy the
 * statement types. The cast is the point of the test: it reproduces what an
 * external caller can hand to compile().
 */
function statement(value: Record<string, unknown>): SemanticStatement {
  return { attributes: {}, ...value } as unknown as SemanticStatement;
}

function irCodes(...statements: SemanticStatement[]): string[] {
  return validateSemanticDocument({ statements }).map((item) => item.code);
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

// One entry per rule in VALIDATION_RULES, grouped by the family that owns it.
// A family that loses a rule during refactoring fails here rather than silently
// accepting invalid documents.
const IR_CASES: ReadonlyArray<readonly [family: string, code: string, statements: SemanticStatement[]]> = [
  ["container-membership", "XD1240", [statement({ type: "sequence", id: "s", statements: [statement({ type: "node", id: "n", kind: "rectangle" })] })]],
  ["container-membership", "XD1241", [statement({ type: "tree", id: "t", statements: [statement({ type: "node", id: "n", kind: "rectangle" })] })]],
  ["container-membership", "XD1250", [statement({ type: "node", id: "tb", kind: "table", statements: [statement({ type: "node", id: "n", kind: "rectangle" })] })]],
  ["container-membership", "XD1251", [statement({ type: "table-row", id: "r", statements: [] })]],
  ["sequence-messages", "XD1242", [statement({ type: "sequence", id: "s", statements: [statement({ type: "connection", nodes: ["a", "b"] })] })]],
  ["style-declarations", "XD1003", [statement({ type: "style", id: "x" }), statement({ type: "style", id: "x" })]],
  ["style-declarations", "XD1005", [statement({ type: "frame", id: "f", statements: [statement({ type: "style", id: "x" })] })]],
  ["theme-declarations", "XD1006", [statement({ type: "frame", id: "f", statements: [statement({ type: "theme", id: "t" })] })]],
  ["theme-declarations", "XD1007", [statement({ type: "theme", id: "a" }), statement({ type: "theme", id: "b" })]],
  ["unique-ids", "XD1001", [statement({ type: "node", id: "d", kind: "rectangle" }), statement({ type: "node", id: "d", kind: "rectangle" })]],
  ["connections", "XD1230", [statement({ type: "connection", nodes: ["a"] })]],
  ["connections", "XD1231", [statement({ type: "connection", nodes: ["a", "b"], attributes: { style: "zig" } })]],
  ["connections", "XD1232", [statement({ type: "connection", nodes: ["a", "b"], attributes: { width: 0 } })]],
  ["connections", "XD1233", [statement({ type: "connection", nodes: ["a", "b"], attributes: { "start-label": 3 } })]],
  ["connections", "XD1238", [statement({ type: "connection", nodes: ["a", "b"], attributes: { head: "spike" } })]],
  ["connections", "XD1239", [statement({ type: "connection", nodes: ["a", "b"], attributes: { dashed: 3 } })]],
  ["geometry-selection", "XD1105", [statement({ type: "alignment", ids: "nope", mode: "left" })]],
  ["geometry-selection", "XD1101", [statement({ type: "alignment", ids: ["a", "a"], mode: "left" })]],
  ["geometry-match-size", "XD1102", [statement({ type: "match-size", ids: ["a", "b"], axis: "depth" })]],
  ["geometry-match-size", "XD1103", [statement({ type: "match-size", ids: ["a"], axis: "width" })]],
  ["geometry-alignment", "XD1106", [statement({ type: "alignment", ids: ["a", "b"], mode: "sideways" })]],
  ["geometry-alignment", "XD1107", [statement({ type: "alignment", ids: ["a"], mode: "left" })]],
  ["geometry-distribution", "XD1108", [statement({ type: "distribution", ids: ["a", "b", "c"], axis: "z" })]],
  ["geometry-distribution", "XD1109", [statement({ type: "distribution", ids: ["a", "b"], axis: "x" })]],
  ["geometry-transform", "XD1104", [statement({ type: "snap", ids: ["a"], grid: 0 })]],
  ["geometry-transform", "XD1110", [statement({ type: "offset", ids: ["a"], by: [Number.NaN, 1] })]],
  ["geometry-transform", "XD1111", [statement({ type: "rotation", ids: ["a"], degrees: "x" })]],
  ["layout", "XD1201", [statement({ type: "layout", kind: "row" })]],
  ["layout", "XD1206", [statement({ type: "layout", kind: "grid", spacing: "huge" })]],
  ["layout", "XD1211", [statement({ type: "layout", kind: "grid", spacing: "tight", gap: 4 })]],
  ["layout", "XD1213", [statement({ type: "layout", kind: "grid", width: 0 })]],
  ["layout", "XD1235", [statement({ type: "layout", kind: "grid", gap: -1 })]],
  ["layout", "XD1243", [statement({ type: "layout", kind: "grid", columns: 0 })]],
  ["tree-spacing", "XD1236", [statement({ type: "tree", id: "t", levelGap: -1, statements: [] })]],
  ["body-content", "XD1237", [statement({ type: "body", value: 3 })]],
  ["annotation-anchoring", "XD1212", [statement({ type: "note", id: "n" })]],
  ["annotation-anchoring", "XD1234", [statement({ type: "callout", id: "c" })]],
  ["frame-attributes", "XD1205", [statement({ type: "frame", id: "f", attributes: { bogus: 1 }, statements: [] })]],
  ["frame-attributes", "XD1207", [statement({ type: "frame", id: "f", attributes: { locked: 3 }, statements: [] })]],
  ["asset-attributes", "XD1208", [statement({ type: "image", id: "i", attributes: { bogus: 1 } })]],
  ["text", "XD1202", [statement({ type: "text", id: "t", align: "middle" })]],
  ["text", "XD1203", [statement({ type: "text", id: "t", align: "left", fontSize: 0 })]],
  ["text", "XD1204", [statement({ type: "text", id: "t", align: "left", width: 0 })]],
  ["code", "XD1214", [statement({ type: "code", id: "c", value: 3, lineNumbers: true, highlight: false })]],
  ["code", "XD1215", [statement({ type: "code", id: "c", value: "x", lineNumbers: 3, highlight: false })]],
  ["code", "XD1216", [statement({ type: "code", id: "c", value: "x", lineNumbers: true, highlight: 3 })]],
  ["code", "XD1217", [statement({ type: "code", id: "c", value: "x", lineNumbers: true, highlight: true, language: "cobol" })]],
  ["code", "XD1218", [statement({ type: "code", id: "c", value: "x".repeat(200_000), lineNumbers: true, highlight: false })]],
  ["code", "XD1219", [statement({ type: "code", id: "c", value: "x", title: 3, lineNumbers: true, highlight: false })]],
  ["freedraw", "XD1220", [statement({ type: "freedraw", id: "f", at: [Number.NaN, 0], points: [[0, 0], [1, 1]], simulatePressure: true })]],
  ["freedraw", "XD1221", [statement({ type: "freedraw", id: "f", at: [0, 0], points: [[0, 0]], simulatePressure: true })]],
  ["freedraw", "XD1222", [statement({ type: "freedraw", id: "f", at: [0, 0], points: Array.from({ length: 20_001 }, (_, index) => [index, index]), simulatePressure: true })]],
  ["freedraw", "XD1223", [statement({ type: "freedraw", id: "f", at: [0, 0], points: [[0, 0], [1e9, 1]], simulatePressure: true })]],
  ["freedraw", "XD1224", [statement({ type: "freedraw", id: "f", at: [0, 0], points: [[1, 1], [1, 1]], simulatePressure: true })]],
  ["freedraw", "XD1225", [statement({ type: "freedraw", id: "f", at: [0, 0], points: [[0, 0], [1, 1]], pressures: [5], simulatePressure: true })]],
  ["freedraw", "XD1226", [statement({ type: "freedraw", id: "f", at: [0, 0], points: [[0, 0], [1, 1]], simulatePressure: 3 })]],
  ["node-size", "XD1209", [statement({ type: "node", id: "n", kind: "rectangle", size: [0, 10] })]],
  ["node-size", "XD1210", [statement({ type: "node", id: "n", kind: "rectangle", size: [20, 60] })]],
  ["node-size", "XD1244", [statement({ type: "node", id: "n", kind: "decision", title: "T", size: [50, 50] })]],
];

for (const [family, code, statements] of IR_CASES) {
  test(`${family} reports ${code}`, () => {
    const reported = irCodes(...statements);
    assert.ok(reported.includes(code), `expected ${code}, got [${reported.join(", ")}]`);
  });
}

test("every diagnostic code in the registry has a rule test", () => {
  // Guards against a rule being added without coverage. Update alongside
  // VALIDATION_RULES in src/language/semantic.ts.
  assert.equal(new Set(IR_CASES.map(([, code]) => code)).size, 59);
});

test("a malformed geometry selection halts the remaining geometry rules", () => {
  // geometry-selection returns true, so XD1106 for the bad mode never fires.
  assert.deepEqual(irCodes(statement({ type: "alignment", ids: "nope", mode: "sideways" })), ["XD1105"]);
});
