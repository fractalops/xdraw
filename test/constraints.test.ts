import assert from "node:assert/strict";
import test from "node:test";

import { ConstraintLayoutError, solveGeometryConstraints } from "../src/layout/constraints.ts";
import type { Bounds } from "../src/contracts/foundation.ts";
import type { RenderableGeometryStatement } from "../src/contracts/semantic.ts";

const initial = new Map<string, Bounds>([
  ["a", { x: 10, y: 20, width: 100, height: 50 }],
  ["b", { x: 180, y: 80, width: 140, height: 70 }],
  ["c", { x: 400, y: 140, width: 80, height: 90 }],
]);

test("constraint layout satisfies alignment, equal gaps, and shared size together", () => {
  const solved = solveGeometryConstraints(initial, [
    { type: "alignment", mode: "center-y", ids: ["a", "b", "c"] },
    { type: "distribution", axis: "x", ids: ["a", "b", "c"] },
    { type: "match-size", axis: "both", ids: ["a", "b", "c"] },
  ]);
  const [a, b, c] = [solved.get("a")!, solved.get("b")!, solved.get("c")!];
  assert.equal(a.y + a.height / 2, b.y + b.height / 2);
  assert.equal(b.y + b.height / 2, c.y + c.height / 2);
  assert.deepEqual([b.width, b.height, c.width, c.height], [a.width, a.height, a.width, a.height]);
  assert.ok(Math.abs((b.x - a.x - a.width) - (c.x - b.x - b.width)) < 1e-9);
});

test("constraint insertion and map insertion order do not affect solved bounds", () => {
  const statements: RenderableGeometryStatement[] = [
    { type: "alignment", mode: "top", ids: ["a", "b", "c"] },
    { type: "distribution", axis: "x", ids: ["a", "b", "c"] },
    { type: "match-size", axis: "height", ids: ["a", "b", "c"] },
  ];
  const expected = [...solveGeometryConstraints(initial, statements)];
  const reversedBounds = new Map([...initial].reverse());
  assert.deepEqual([...solveGeometryConstraints(reversedBounds, [...statements].reverse())], expected);
});

test("conflicting required constraints fail explicitly", () => {
  assert.throws(() => solveGeometryConstraints(initial, [
    { type: "offset", ids: ["a"], by: [10, 0] },
    { type: "snap", ids: ["a"], grid: 100 },
  ]), ConstraintLayoutError);
});

test("constraint output remains structured-cloneable data", () => {
  const solved = solveGeometryConstraints(initial, [
    { type: "offset", ids: ["a"], by: [25, 35] },
  ]);
  assert.deepEqual(structuredClone([...solved]), [...solved]);
});
