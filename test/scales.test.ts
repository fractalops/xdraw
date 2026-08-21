import assert from "node:assert/strict";
import test from "node:test";

import {
  invertLinearValue,
  planLinearAxis,
  planLinearScale,
  scaleLinearValue,
} from "../src/math/scales.ts";

test("a covering tick plan expands the effective domain and stays inside the range", () => {
  const scale = planLinearScale([0, 8], [20, 320], { count: 3 });
  assert.deepEqual(scale.dataDomain, [0, 8]);
  assert.deepEqual(scale.domain, [0, 10]);
  assert.deepEqual(scale.ticks.map(({ value, position }) => [value, position]), [
    [0, 20],
    [5, 170],
    [10, 320],
  ]);
});

test("extended nice numbers and inside extreme labels compete in the same search", () => {
  const quarterSteps = planLinearScale([0, 5], [0, 400], { count: 3 });
  assert.deepEqual(quarterSteps.ticks.map(({ value }) => value), [0, 2.5, 5]);

  const insideExtreme = planLinearScale([0, 8], [0, 400], { count: 4 });
  assert.deepEqual(insideExtreme.domain, [0, 8]);
  assert.deepEqual(insideExtreme.ticks.map(({ value }) => value), [0, 2.5, 5, 7.5]);
});

test("formatting preserves the sign of negative fractional ticks", () => {
  const scale = planLinearScale([-1.2, 1.2], [300, 0], { count: 5 });
  assert.ok(scale.ticks.some(({ label }) => label === "-0.5"));
  assert.ok(scale.ticks.every(({ label }) => label !== "-0"));
});

test("measured label legibility reduces tick density when physical space is narrow", () => {
  const narrow = planLinearScale([0, 100], [0, 80], { count: 8 });
  const wide = planLinearScale([0, 100], [0, 800], { count: 8 });
  assert.ok(narrow.ticks.length < wide.ticks.length);
  assert.deepEqual(narrow.ticks.map(({ value }) => value), [0, 100]);
});

test("mapping and inversion use the effective domain and support reversed extents", () => {
  const scale = planLinearScale([100, 0], [10, 410], { count: 5 });
  assert.deepEqual(scale.domain, [100, 0]);
  assert.equal(scaleLinearValue(scale, 75), 110);
  assert.equal(invertLinearValue(scale, 310), 25);
  assert.deepEqual(scale.ticks.map(({ position }) => position), [10, 110, 210, 310, 410]);
});

test("formatting and all returned plans remain data-only", () => {
  const scale = planLinearScale([0, 1], [0, 200], {
    count: 3,
    format: (value) => `${Math.round(value * 100)}%`,
  });
  assert.deepEqual(scale.ticks.map(({ label }) => label), ["0%", "50%", "100%"]);
  const axis = planLinearAxis(scale, { orientation: "bottom", cross: 40 });
  assert.deepEqual(structuredClone({ scale, axis }), { scale, axis });
});

test("axis planning owns line, tick, label, and alignment geometry", () => {
  const scale = planLinearScale([0, 10], [100, 300], { count: 3 });
  const bottom = planLinearAxis(scale, { orientation: "bottom", cross: 50, tickSize: 8, labelGap: 3 });
  assert.deepEqual(bottom.line, { start: [100, 50], end: [300, 50] });
  assert.deepEqual(bottom.ticks[0].mark, { start: [100, 50], end: [100, 58] });
  assert.deepEqual(bottom.ticks[0].labelPosition, [100, 61]);
  assert.equal(bottom.ticks[0].textAlign, "center");
  assert.equal(bottom.ticks[0].verticalAlign, "top");

  const left = planLinearAxis(scale, { orientation: "left", cross: 50 });
  assert.deepEqual(left.line, { start: [50, 100], end: [50, 300] });
  assert.deepEqual(left.ticks[0].mark, { start: [50, 100], end: [44, 100] });
  assert.equal(left.ticks[0].textAlign, "right");
  assert.equal(left.ticks[0].verticalAlign, "middle");
});

test("scale and axis plans reject invalid numeric inputs", () => {
  assert.throws(() => planLinearScale([1, 1], [0, 100]), /distinct finite/u);
  assert.throws(() => planLinearScale([0, 1], [0, 100], { count: 1 }), /tick count/u);
  assert.throws(() => planLinearScale([0, 1], [0, 100], { fontSize: 0 }), /font size/u);
  const scale = planLinearScale([0, 1], [0, 100]);
  assert.throws(() => scaleLinearValue(scale, Number.NaN), /finite/u);
  assert.throws(() => planLinearAxis(scale, { labelGap: -1 }), /label gap/u);
});
