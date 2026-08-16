// `along(curve, u)` is a point on a drawn stroke: u = 0 is its start, u = 1 its
// end, and the values between walk the stroke by arc length rather than by
// parameter. Arc length is what makes it useful — halfway along a spiral is
// halfway along the line you can see, not halfway through the range of t.
import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { compile, parse } from "../src/index.ts";

const RUNS = Number.parseInt(process.env.XDRAW_PROPERTY_RUNS ?? "100", 10);
const scene = (source: string) => compile(parse(source)).toJSON();
const at = (source: string, id: string) => {
  const found = scene(source).elements.find((e) => e.id === id);
  assert.ok(found, `expected an element '${id}'`);
  return found as unknown as { x: number; y: number; width: number; height: number };
};

const withCurve = (body: string) => `use "xdraw/math" as math

diagram "" {
  arc: math.plot {
    at (300, 300)
    x = 200 * cos(t)
    y = 200 * sin(t)
    domain (0, pi)
  }
  ${body}
}`;

test("a marker sits on the curve it names", () => {
  // The arc is the top half of a circle of radius 200 centred on (300, 300).
  // Halfway along it is the top of that circle.
  const marker = at(withCurve(`m: text "m" { at = (along_x(arc, 0.5), along_y(arc, 0.5)) }`), "m");
  assert.ok(Math.abs(marker.x - 300) < 3, `x was ${marker.x}, expected about 300`);
  assert.ok(Math.abs(marker.y - 500) < 3, `y was ${marker.y}, expected about 500`);
});

test("the ends of the curve are its first and last points", () => {
  const start = at(withCurve(`m: text "m" { at = (along_x(arc, 0), along_y(arc, 0)) }`), "m");
  const end = at(withCurve(`m: text "m" { at = (along_x(arc, 1), along_y(arc, 1)) }`), "m");
  assert.ok(Math.abs(start.x - 500) < 3, `start x was ${start.x}`);
  assert.ok(Math.abs(end.x - 100) < 3, `end x was ${end.x}`);
  assert.ok(Math.abs(start.y - end.y) < 3, "both ends of a semicircle are level");
});

test("a fraction outside zero to one is clamped to the ends", () => {
  const before = at(withCurve(`m: text "m" { at = (along_x(arc, 0 - 5), along_y(arc, 0)) }`), "m");
  const start = at(withCurve(`m: text "m" { at = (along_x(arc, 0), along_y(arc, 0)) }`), "m");
  assert.equal(before.x, start.x, "before the start is the start");
  const after = at(withCurve(`m: text "m" { at = (along_x(arc, 9), along_y(arc, 1)) }`), "m");
  const end = at(withCurve(`m: text "m" { at = (along_x(arc, 1), along_y(arc, 1)) }`), "m");
  assert.equal(after.x, end.x, "past the end is the end");
});

test("it walks by arc length, not by parameter", () => {
  // A spiral covers far more distance late in its range than early, so the
  // halfway point by arc length is well past the halfway point by parameter.
  const spiral = (body: string) => `use "xdraw/math" as math

  diagram "" {
    s: math.plot { at (400, 400); x = 9 * t * cos(t); y = 9 * t * sin(t); domain (0, 20) }
    ${body}
  }`;
  const middle = at(spiral(`m: text "m" { at = (along_x(s, 0.5), along_y(s, 0.5)) }`), "m");
  const centre = 400;
  // Halfway by parameter would be t = 10, a radius of 90. Halfway by arc length
  // is much further out, because the outer turns are longer.
  const radius = Math.hypot(middle.x - centre, middle.y - centre);
  assert.ok(radius > 110, `halfway by arc length should be well past r=90, got ${radius.toFixed(0)}`);
});

test("naming something that is not a stroke is a diagnostic", () => {
  assert.throws(
    () => scene(`diagram "" {
      box: rectangle "B" { at (10, 10); size (120, 80) }
      m: text "m" { at = (along_x(box, 0.5), 40) }
    }`),
    /along.*'box'|not a stroke|no stroke/i,
  );
  assert.throws(() => scene(withCurve(`m: text "m" { at = (along_x(mystery, 0.5), 40) }`)), /mystery/);
});

test("a malformed along call says what it takes", () => {
  // Mutation testing found nothing covered these: the arity check could be
  // removed entirely and the suite stayed green.
  for (const call of ["along_x(arc)", "along_x(arc, 0.5, 2)", "along_x(0.5, arc)", "along_x()"]) {
    assert.throws(
      () => scene(withCurve(`m: text "m" { at = (${call}, 40) }`)),
      /takes a stroke and a fraction|arc/i,
      `${call} must be rejected`,
    );
  }
});

test("a document that uses no markers is untouched", () => {
  const source = withCurve(`m: text "m" { at (10, 20) }`);
  const marker = at(source, "m");
  assert.deepEqual([marker.x, marker.y], [10, 20]);
});

// --------------------------------------------------------------- properties

test("property: every fraction lands within the curve's own bounds", () => {
  const strokeBox = at(withCurve(""), "arc:stroke");
  fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (u) => {
    const marker = at(withCurve(`m: text "m" { at = (along_x(arc, ${u}), along_y(arc, ${u})) }`), "m");
    assert.ok(
      marker.x >= strokeBox.x - 2 && marker.x <= strokeBox.x + strokeBox.width + 2,
      `x ${marker.x} outside [${strokeBox.x}, ${strokeBox.x + strokeBox.width}]`,
    );
    assert.ok(
      marker.y >= strokeBox.y - 2 && marker.y <= strokeBox.y + strokeBox.height + 2,
      `y ${marker.y} outside [${strokeBox.y}, ${strokeBox.y + strokeBox.height}]`,
    );
  }), { numRuns: RUNS });
});

test("property: the fraction advances monotonically along the curve", () => {
  // On a semicircle drawn left to right, a larger fraction is never further
  // right than a smaller one.
  fc.assert(fc.property(
    fc.double({ min: 0, max: 0.98, noNaN: true }),
    fc.double({ min: 0.01, max: 1, noNaN: true }),
    (first, step) => {
      const second = Math.min(1, first + step);
      const a = at(withCurve(`m: text "m" { at = (along_x(arc, ${first}), 40) }`), "m");
      const b = at(withCurve(`m: text "m" { at = (along_x(arc, ${second}), 40) }`), "m");
      assert.ok(b.x <= a.x + 1, `u=${second} gave x=${b.x}, behind u=${first} at x=${a.x}`);
    },
  ), { numRuns: RUNS });
});
