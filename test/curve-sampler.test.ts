// The contract for the curve sampler.
//
// The central property below verifies the tolerance independently: it probes
// each emitted span densely and measures the true worst departure from the
// chord, rather than trusting the sampler's own flatness test. That distinction
// matters, because the previous sampler's test was its own judge and jury — it
// asked seven interior samples whether a span was flat and reported success
// while exceeding the stated tolerance by up to 27 times.
//
// Several assertions pin the shape of a result rather than its accuracy.
// Mutation testing found that without them the curve could be transposed, the
// last point dropped, the parameters reversed, or `at` made to disagree with
// `points`, and the suite stayed green.
import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import {
  type CurvePoint,
  MAXIMUM_POINT_BUDGET,
  sampleCurve,
} from "../src/language/curve-sampler.ts";

const RUNS = Number.parseInt(process.env.XDRAW_PROPERTY_RUNS ?? "150", 10);
const TAU = Math.PI * 2;

function distanceToSegment(p: CurvePoint, a: CurvePoint, b: CurvePoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(p[0] - (a[0] + u * dx), p[1] - (a[1] + u * dy));
}

/** The true worst departure from the emitted polyline, by brute force. */
function verifiedError(
  result: { readonly parameters: readonly number[]; at(t: number): CurvePoint },
  probes = 64,
): number {
  let worst = 0;
  for (let i = 0; i < result.parameters.length - 1; i += 1) {
    const t0 = result.parameters[i];
    const t1 = result.parameters[i + 1];
    const a = result.at(t0);
    const b = result.at(t1);
    for (let k = 1; k < probes; k += 1) {
      const inner = result.at(t0 + ((t1 - t0) * k) / probes);
      if (!Number.isFinite(inner[0]) || !Number.isFinite(inner[1])) continue;
      worst = Math.max(worst, distanceToSegment(inner, a, b));
    }
  }
  return worst;
}

const sampled = (request: Parameters<typeof sampleCurve>[0]) => {
  const result = sampleCurve(request);
  assert.equal(result.status, "sampled", `expected a sample: ${result.status === "refused" ? result.reason : ""}`);
  if (result.status !== "sampled") throw new Error("unreachable");
  return result;
};
const refused = (request: Parameters<typeof sampleCurve>[0]): string => {
  const result = sampleCurve(request);
  assert.equal(result.status, "refused", "expected a refusal");
  return result.status === "refused" ? result.reason : "";
};

test("the tolerance holds on curves that defeated the previous sampler", () => {
  // Each of these was measured exceeding its stated tolerance before the
  // sampler enclosed spans instead of probing them. The multiples are what the
  // old sampler reported as success.
  const cases: Array<[string, string, string, number, number]> = [
    ["high frequency (was 4x over)", "cos(9*t) * 130", "cos(t)", 0, 7],
    ["extreme frequency (was 27x over)", "sin(2752*t) * 100", "t * 40", 0, 1],
    ["rose (was over)", "110 * cos(5*t) * cos(t)", "110 * cos(5*t) * sin(t)", 0, TAU],
    ["logo mark", "120 * sin(2*t)", "110 * sin(3*t)", 0, TAU],
    ["spiral", "7 * t * cos(t)", "7 * t * sin(t)", 0, 20],
    ["circle", "sin(t) * 100", "cos(t) * 100", 0, 10],
  ];
  for (const [label, x, y, from, to] of cases) {
    const tolerance = 0.5;
    const result = sampled({ x, y, from, to, tolerance, maximumPoints: 100_000 });
    const worst = verifiedError(result);
    assert.ok(worst <= tolerance, `${label}: departed ${worst.toFixed(2)}px against a ${tolerance}px tolerance`);
  }
});

test("the shape of a sampled result", () => {
  const result = sampled({ x: "sin(t) * 40", y: "cos(t) * 40", from: 1.5, to: 9.5, tolerance: 0.5 });
  assert.equal(result.points.length, result.parameters.length, "one point per parameter");
  assert.equal(result.parameters[0], 1.5, "the first parameter is exactly `from`");
  assert.equal(result.parameters.at(-1), 9.5, "the last parameter is exactly `to`");
  for (let i = 1; i < result.parameters.length; i += 1) {
    assert.ok(result.parameters[i] > result.parameters[i - 1], `parameters ascend at ${i}`);
  }
  for (let i = 0; i < result.parameters.length; i += 1) {
    assert.deepEqual(result.points[i], result.at(result.parameters[i]), `points[${i}] agrees with at()`);
  }
  assert.deepEqual(result.at(2), [Math.sin(2) * 40, Math.cos(2) * 40], "at() returns (x, y), in that order");
});

test("the last parameter is exactly `to`, including where the arithmetic does not round-trip", () => {
  // Computing span ends as a fraction of the range lands one ulp past `to` for
  // about 15% of ranges — including 0..2*pi, the most likely range anyone
  // writes — which left the final point slightly off the curve.
  // These ranges are chosen because `from + (to - from) !== to` for each of
  // them, which is true of about 6% of ranges. Round numbers round-trip and so
  // cannot tell a correct implementation from one that recomputes the endpoint.
  const drifting: Array<[number, number]> = [
    [-16.8552, 5.8295], [11.529, -6.1513], [-9.9036, 13.7767], [18.3187, 0.8034],
  ];
  for (const [from, to] of drifting) {
    assert.notEqual(from + (to - from), to, `fixture ${from}..${to} must not round-trip, or it tests nothing`);
  }
  for (const [from, to] of [...drifting, [0, TAU], [2.1, 49.9], [0, 10], [0, 1], [-3.3, 7.7]] as Array<[number, number]>) {
    const result = sampled({ x: "sin(t) * 30", y: "cos(t) * 30", from, to, tolerance: 0.5 });
    assert.equal(result.parameters.at(-1), to, `${from}..${to} must end exactly at ${to}`);
    assert.equal(result.parameters[0], from, `${from}..${to} must start exactly at ${from}`);
  }
});

test("a descending range mirrors an ascending one", () => {
  const up = sampled({ x: "sin(t) * 50", y: "cos(t) * 50", from: 0, to: 10, tolerance: 0.5 });
  const down = sampled({ x: "sin(t) * 50", y: "cos(t) * 50", from: 10, to: 0, tolerance: 0.5 });
  assert.deepEqual([...down.parameters].reverse(), [...up.parameters]);
});

test("a pole is found by enclosure, not stumbled upon", () => {
  // The previous sampler detected these by probing near them and getting
  // lucky; sqrt(abs(t))/cos(2t) slipped through and erred by 186,000px.
  assert.match(refused({ x: "1 / t", y: "t", from: 0, to: 3, tolerance: 0.5 }), /not finite at t = 0/);
  assert.match(refused({ x: "t", y: "1 / (t - 5)", from: 0, to: 9, tolerance: 0.5 }), /unbounded/);
  assert.match(refused({ x: "tan(t)", y: "t", from: 0, to: 4, tolerance: 0.5 }), /unbounded/);
  assert.match(refused({ x: "sqrt(abs(t)) / cos(2*t)", y: "t", from: 0, to: 2, tolerance: 0.5 }), /unbounded/);
});

test("a curve that leaves the usable range says so, and says which limit", () => {
  // The magnitude limit used to report "the curve is not finite", which is
  // false for a curve that is merely large, and left the limit undiscoverable.
  const reason = refused({ x: "t * 2000000", y: "t", from: 0, to: 1, tolerance: 0.5 });
  assert.match(reason, /beyond the limit of/, "the message must name the limit that fired");
  assert.doesNotMatch(reason, /not finite/, "a large finite curve is not an infinite one");
  assert.match(refused({ x: "exp(t)", y: "t", from: 0, to: 19, tolerance: 0.5 }), /beyond the limit of|unbounded/);
});

test("every limit is validated, and each says which one it was", () => {
  const base = { x: "t", y: "t", from: 0, to: 1, tolerance: 0.5 };
  for (const tolerance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.match(refused({ ...base, tolerance }), /tolerance must be a positive finite number/, String(tolerance));
  }
  for (const maximumPoints of [Number.NaN, 0, 1, -5, 1.5, Number.POSITIVE_INFINITY]) {
    assert.match(refused({ ...base, maximumPoints }), /maximumPoints must be an integer/, String(maximumPoints));
  }
  // Validating only the floor leaves an absurd budget passing, which is the
  // same as having no budget at all.
  assert.match(refused({ ...base, maximumPoints: Number.MAX_SAFE_INTEGER }), /must not exceed/);
  assert.match(refused({ ...base, maximumPoints: MAXIMUM_POINT_BUDGET + 1 }), /must not exceed/);
  for (const maximumMagnitude of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
    assert.match(refused({ ...base, maximumMagnitude }), /maximumMagnitude must be a positive finite/, String(maximumMagnitude));
  }
  for (const [from, to] of [[1, 1], [0, Number.NaN], [Number.POSITIVE_INFINITY, 1]] as Array<[number, number]>) {
    assert.match(refused({ ...base, from, to }), /parameter range must be finite and non-empty/);
  }
  assert.equal(sampleCurve({ ...base, maximumPoints: 64, maximumMagnitude: 1e3 }).status, "sampled");
});

test("the sampler validates the expressions before it samples them", () => {
  assert.match(refused({ x: "sin(t, t)", y: "t", from: 0, to: 1, tolerance: 0.5 }), /sin takes 1 argument, received 2/);
  assert.match(refused({ x: "a * t", y: "t", from: 0, to: 1, tolerance: 0.5 }), /unknown name 'a'/);
  assert.match(refused({ x: "wobble(t)", y: "t", from: 0, to: 1, tolerance: 0.5 }), /unknown function 'wobble'/);
  assert.match(refused({ x: "sin(t", y: "t", from: 0, to: 1, tolerance: 0.5 }), /expected '\)'/);
});

test("the enclosure stays tight enough to be affordable", () => {
  // Correctness does not depend on how closely spans are enclosed — a looser
  // enclosure subdivides more and is still sound — so nothing else in this file
  // notices if the tightening regresses. It is worth a great deal though: a
  // single box per span needs 794 points for this circle where a run of
  // sub-boxes needs 90, and the old unsound sampler used 81.
  const circle = sampled({ x: "sin(t) * 100", y: "cos(t) * 100", from: 0, to: 10, tolerance: 0.5 });
  assert.ok(circle.points.length < 200, `a circle took ${circle.points.length} points; the enclosure has loosened`);
  const rose = sampled({
    x: "110 * cos(5*t) * cos(t)", y: "110 * cos(5*t) * sin(t)", from: 0, to: TAU, tolerance: 0.5,
  });
  assert.ok(rose.points.length < 600, `a rose took ${rose.points.length} points; the enclosure has loosened`);
});

test("the point budget binds", () => {
  const request = { x: "t * 4", y: "t * t", from: 0, to: 8, tolerance: 0.05 };
  const needed = sampled({ ...request, maximumPoints: 100_000 }).points.length;
  assert.ok(needed > 4, "the fixture must need a non-trivial number of points");
  assert.equal(sampled({ ...request, maximumPoints: needed }).points.length, needed);
  assert.match(refused({ ...request, maximumPoints: needed - 1 }), /exceeded \d+ points/);
});

// --------------------------------------------------------------- properties

const smoothTerm = fc.oneof(
  fc.integer({ min: 1, max: 120 }).map(String),
  fc.constant("t"),
  fc.integer({ min: 1, max: 9 }).map((k) => `sin(${k}*t)`),
  fc.integer({ min: 1, max: 9 }).map((k) => `cos(${k}*t)`),
  fc.constant("sqrt(abs(t))"),
);
const hostileTerm = fc.oneof(smoothTerm, fc.constant("tan(t)"), fc.constant("exp(t)"), fc.constant("1/t"));
const curveOf = (term: fc.Arbitrary<string>) => fc.record({
  x: fc.tuple(term, fc.constantFrom("*", "+", "-"), term).map(([a, o, b]) => `${a} ${o} ${b}`),
  y: fc.tuple(term, fc.constantFrom("*", "+", "-"), term).map(([a, o, b]) => `${a} ${o} ${b}`),
  span: fc.integer({ min: 1, max: 12 }),
});

test("property: a sampled curve never departs from its tolerance", () => {
  // Verified independently of the sampler's own flatness test.
  fc.assert(fc.property(curveOf(smoothTerm), fc.integer({ min: 1, max: 4 }), ({ x, y, span }, scale) => {
    const tolerance = scale / 2;
    const result = sampleCurve({ x, y, from: 0, to: span, tolerance, maximumPoints: 100_000 });
    if (result.status !== "sampled") return;
    const worst = verifiedError(result, 24);
    assert.ok(
      worst <= tolerance,
      `(${x}, ${y}) over 0..${span} at tolerance ${tolerance}: departed ${worst.toFixed(3)}px`,
    );
  }), { numRuns: RUNS });
});

test("property: a refusal always says why, and a sample is always finite", () => {
  fc.assert(fc.property(curveOf(hostileTerm), ({ x, y, span }) => {
    const result = sampleCurve({ x, y, from: 0, to: span, tolerance: 0.5 });
    if (result.status === "refused") {
      assert.ok(result.reason.length > 0, "a refusal must say why");
      return;
    }
    for (const point of result.points) {
      assert.ok(Number.isFinite(point[0]) && Number.isFinite(point[1]), `(${x}, ${y}) produced ${point}`);
    }
  }), { numRuns: RUNS });
});

test("property: sampling is deterministic", () => {
  fc.assert(fc.property(curveOf(smoothTerm), ({ x, y, span }) => {
    const first = sampleCurve({ x, y, from: 0, to: span, tolerance: 0.5 });
    const second = sampleCurve({ x, y, from: 0, to: span, tolerance: 0.5 });
    assert.equal(first.status, second.status);
    if (first.status !== "sampled" || second.status !== "sampled") return;
    assert.deepEqual(second.points, first.points);
    assert.deepEqual(second.parameters, first.parameters);
    assert.deepEqual(second.at(1.25), first.at(1.25));
  }), { numRuns: RUNS });
});

test("property: the emitted parameters always span exactly the requested range", () => {
  fc.assert(fc.property(
    curveOf(smoothTerm),
    fc.double({ min: -20, max: 20, noNaN: true }),
    ({ x, y, span }, from) => {
      const to = from + span;
      const result = sampleCurve({ x, y, from, to, tolerance: 0.5 });
      if (result.status !== "sampled") return;
      assert.equal(result.parameters[0], from);
      assert.equal(result.parameters.at(-1), to);
      for (let i = 1; i < result.parameters.length; i += 1) {
        assert.ok(result.parameters[i] > result.parameters[i - 1], "parameters must ascend");
      }
    },
  ), { numRuns: RUNS });
});
