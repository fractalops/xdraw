// The contract for interval arithmetic over the expression vocabulary.
//
// One property here carries the weight: for every t in [t0,t1], the value of an
// expression must lie inside its interval evaluation over [t0,t1]. The sampler
// treats a passing flatness test as a proof, so if inclusion can fail anywhere,
// the sampler's guarantee is decoration.
//
// The generator deliberately produces intervals that straddle zero as well as
// uniformly random ones. That is not decoration either: several rules turn at
// zero, and with uniform intervals alone an injected defect in the even-power
// rule survived this suite — `t^2` over [-1,2] wrongly enclosing [1,4] when the
// true value at 0 is 0.
import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { FUNCTIONS, evaluateExpression, parseExpression } from "../src/language/expression.ts";
import {
  INTERVAL_FUNCTIONS,
  type Interval,
  interval,
  intervalEvaluate,
  isBounded,
} from "../src/language/interval.ts";

const RUNS = Number.parseInt(process.env.XDRAW_PROPERTY_RUNS ?? "400", 10);
const over = (source: string, lo: number, hi: number): Interval =>
  intervalEvaluate(parseExpression(source), new Map([["t", interval(lo, hi)]]));

test("every function in the vocabulary has an interval extension", () => {
  // A missing extension is a crash at sample time rather than a diagnostic, so
  // the two tables must not drift apart.
  assert.deepEqual([...INTERVAL_FUNCTIONS.keys()].sort(), [...FUNCTIONS.names].sort());
});

test("a range that turns inside the interval reaches its turning point", () => {
  // The endpoints alone are not enough for any of these, and using them is the
  // classic way an interval library becomes unsound.
  assert.deepEqual(over("sin(t)", 0, Math.PI), interval(0, 1), "sin peaks at pi/2");
  assert.deepEqual(over("sin(t)", -2, -1), interval(-1, Math.sin(-1)), "sin troughs at -pi/2");
  assert.deepEqual(over("cos(t)", -1, 1), interval(Math.cos(1), 1), "cos peaks at 0");
  assert.deepEqual(over("cos(t)", 3, 3.5), interval(-1, Math.cos(3.5)), "cos troughs at pi");
  assert.deepEqual(over("t ^ 2", -1, 2), interval(0, 4), "an even power dips to zero");
  assert.deepEqual(over("abs(t)", -3, 2), interval(0, 3), "abs dips to zero");
  assert.deepEqual(over("sin(t)", 0, 100), interval(-1, 1), "a wide interval covers a full period");
});

test("a pole makes the enclosure unbounded rather than wrong", () => {
  for (const [source, lo, hi] of [
    ["1 / t", -1, 1],
    ["tan(t)", 1, 2],
    ["sqrt(abs(t)) / cos(2*t)", 0, 2],
    ["log(t)", -1, 1],
    ["t ^ (0 - 1)", -1, 1],
  ] as Array<[string, number, number]>) {
    assert.equal(isBounded(over(source, lo, hi)), false, `${source} over [${lo},${hi}] must be unbounded`);
  }
  assert.equal(isBounded(over("1 / t", 1, 2)), true, "away from its pole it is bounded");
});

test("atan2 widens across its branch cut and is tight away from it", () => {
  const cut = over("atan2(t, 0 - 1)", -1, 1);
  assert.deepEqual(cut, interval(-Math.PI, Math.PI), "spanning the negative x axis must widen");
  const clear = over("atan2(t, 1)", 0, 1);
  assert.deepEqual(clear, interval(0, Math.atan2(1, 1)), "the right half plane is exact");
  // x reaching zero is not a crossing: the cut is where x is strictly negative.
  // Widening here would double the range of any curve whose x touches zero,
  // which abs(t) and t^2 both do whenever the span straddles the origin.
  assert.deepEqual(
    over("atan2(t, abs(t))", -1, 1),
    interval(-Math.PI / 2, Math.PI / 2),
    "a box touching the y axis from the right must not widen to the whole circle",
  );
  assert.deepEqual(over("atan2(t, t ^ 2)", -1, 1), interval(-Math.PI / 2, Math.PI / 2));
});

test("a repeated variable is treated as two independent ones", () => {
  // The dependency problem, and the main reason enclosures are wider than the
  // true range. `t * t` cannot be told that both factors move together, so it
  // admits (-1)·(1); `t ^ 2` knows it is a square and does not. Both are sound
  // — one is simply tighter — so an expression that squares by multiplying
  // costs extra subdivision rather than correctness.
  assert.deepEqual(over("t * t", -1, 1), interval(-1, 1), "multiplication loses the correlation");
  assert.deepEqual(over("t ^ 2", -1, 1), interval(0, 1), "an even power keeps it");
  assert.deepEqual(over("t - t", -1, 1), interval(-2, 2), "and subtraction loses it too");
});

test("an indeterminate form widens rather than narrowing on a guess", () => {
  // Multiplying zero by an unbounded range gives 0·infinity, which has no
  // defensible value. Returning [0,0] would be narrower than the reasoning
  // supports, so the rules widen instead — the direction that costs
  // subdivision rather than correctness.
  assert.equal(isBounded(over("0 * (1 / t)", -1, 1)), false, "0 * unbounded must not narrow to zero");
});

test("a domain edge widens rather than producing NaN", () => {
  for (const source of ["sqrt(t)", "asin(t * 2)", "acos(t * 2)", "log(t)"]) {
    const result = over(source, -1, 1);
    assert.ok(!Number.isNaN(result.lo) && !Number.isNaN(result.hi), `${source} must not produce NaN`);
    assert.equal(isBounded(result), false, `${source} must widen outside its domain`);
  }
});

// --------------------------------------------------------------- properties

const term = fc.oneof(
  fc.integer({ min: -50, max: 50 }).map(String),
  fc.constant("t"),
  fc.integer({ min: 1, max: 12 }).map((k) => `sin(${k}*t)`),
  fc.integer({ min: 1, max: 12 }).map((k) => `cos(${k}*t)`),
  ...["tan(t)", "exp(t)", "log(abs(t))", "sqrt(abs(t))", "atan(t)", "asin(t)", "acos(t)",
    "abs(t)", "sign(t)", "floor(t)", "ceil(t)", "round(t)", "t ^ 2", "t ^ 3", "min(t, 2)",
    "max(t, 0 - 2)", "hypot(t, 3)", "atan2(t, 2)", "t * t - t", "1 / t", "t / (t - 1)",
    // atan2 with an x that reaches zero, straddles it, and stays negative —
    // the three sides of its branch-cut test.
    "atan2(t, abs(t))", "atan2(t, t)", "atan2(t, 0 - abs(t))", "atan2(abs(t), t)",
  ].map((source) => fc.constant(source)),
);
const expression = fc.oneof(
  term,
  fc.tuple(term, fc.constantFrom("*", "+", "-", "/", "^"), term).map(([a, o, b]) => `${a} ${o} ${b}`),
  fc.tuple(term, fc.constantFrom("*", "+", "-", "/"), term, fc.constantFrom("*", "+", "-"), term)
    .map(([a, o, b, p, c]) => `(${a} ${o} ${b}) ${p} ${c}`),
);
const range = fc.oneof(
  fc.tuple(fc.double({ min: -12, max: 12, noNaN: true }), fc.double({ min: 0.0001, max: 6, noNaN: true }))
    .map(([start, span]) => [start, start + span] as [number, number]),
  // straddling zero, where several rules have their turning point
  fc.tuple(fc.double({ min: -6, max: -0.0001, noNaN: true }), fc.double({ min: 0.0001, max: 6, noNaN: true }))
    .map(([lo, hi]) => [lo, hi] as [number, number]),
);

test("property: the value at every point lies inside the enclosure", () => {
  // This is the claim the sampler's guarantee rests on. Probe densely rather
  // than once: a single sample per interval misses violations that only occur
  // near a turning point.
  const PROBES = 32;
  fc.assert(fc.property(expression, range, (source, [lo, hi]) => {
    const node = parseExpression(source);
    const enclosure = intervalEvaluate(node, new Map([["t", interval(lo, hi)]]));
    assert.ok(
      !Number.isNaN(enclosure.lo) && !Number.isNaN(enclosure.hi),
      `${source} over [${lo}, ${hi}] produced NaN bounds`,
    );
    if (!isBounded(enclosure)) return; // sound, and carries no information
    // Slack for floating-point rounding in the bounds themselves; a real
    // inclusion failure is off by far more than this.
    const slack = 1e-9 * Math.max(1, Math.abs(enclosure.lo), Math.abs(enclosure.hi));
    for (let k = 0; k <= PROBES; k += 1) {
      const t = lo + ((hi - lo) * k) / PROBES;
      const actual = evaluateExpression(node, { t });
      if (!Number.isFinite(actual)) continue;
      assert.ok(
        actual >= enclosure.lo - slack && actual <= enclosure.hi + slack,
        `${source}: f(${t}) = ${actual} outside [${enclosure.lo}, ${enclosure.hi}] over [${lo}, ${hi}]`,
      );
    }
  }), { numRuns: RUNS });
});

test("property: a wider interval encloses a narrower one", () => {
  // Inclusion isotony. If this fails, subdividing a span could report a range
  // the parent did not contain, and the proof would not compose.
  fc.assert(fc.property(expression, range, fc.double({ min: 0.05, max: 0.45, noNaN: true }), (source, [lo, hi], inset) => {
    const node = parseExpression(source);
    const outer = intervalEvaluate(node, new Map([["t", interval(lo, hi)]]));
    if (!isBounded(outer)) return;
    const span = hi - lo;
    const inner = intervalEvaluate(node, new Map([["t", interval(lo + span * inset, hi - span * inset)]]));
    if (!isBounded(inner)) return;
    const slack = 1e-9 * Math.max(1, Math.abs(outer.lo), Math.abs(outer.hi));
    assert.ok(
      inner.lo >= outer.lo - slack && inner.hi <= outer.hi + slack,
      `${source}: inner [${inner.lo}, ${inner.hi}] escapes outer [${outer.lo}, ${outer.hi}]`,
    );
  }), { numRuns: RUNS });
});
