import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateArrangedRows,
  calculateRowPlan,
  calculateSlotWidth,
} from "../src/measurement.ts";
import { compile } from "../src/compiler.ts";
import { buildSemanticIR } from "../src/semantic.ts";
import { parseSource } from "../src/source-language.ts";

test("measurement helpers enforce finite non-negative geometry", () => {
  assert.throws(() => calculateSlotWidth(Number.NaN, 1, 0, "row"), /width must be positive and finite/);
  assert.throws(() => calculateSlotWidth(200, 1, -1, "row"), /gap must be finite and non-negative/);
  assert.throws(() => calculateArrangedRows(200, [], Number.POSITIVE_INFINITY), /gap must be finite and non-negative/);
});

test("row plans treat preferred and hard minimum widths separately", () => {
  assert.deepEqual(calculateRowPlan(100, 1, 0, "row", 140), {
    columns: 1,
    rows: 1,
    slotWidth: 100,
  });
  assert.equal(calculateRowPlan(300, 2, 20, "row", 140).slotWidth, 140);
  assert.throws(() => calculateRowPlan(39, 1, 0, "row", 140), /minimum width of 40/);
});

test("semantic validation rejects non-text body content before measurement", () => {
  const semantic = buildSemanticIR(parseSource('diagram "Body" { item: rectangle "Item" { body "Text" } }'));
  const body = semantic.statements[0].statements.find((item) => item.type === "body");
  body.value = 42;
  assert.throws(() => compile(semantic), /body content must be text/);
});

test("semantic validation rejects an unanchored callout before placement", () => {
  const semantic = buildSemanticIR(parseSource('diagram "Callout" {}'));
  semantic.statements.push({ type: "callout", id: "review", title: "Review" });
  assert.throws(() => compile(semantic), /a callout requires a target or explicit position/);
});
