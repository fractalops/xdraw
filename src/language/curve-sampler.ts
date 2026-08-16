/**
 * Turns a pair of expressions into a polyline, guaranteeing that every point of
 * the curve lies within `tolerance` of the emitted line.
 *
 * The guarantee comes from interval arithmetic, not from sampling. Evaluating
 * the expressions over an interval of `t` gives a box containing that whole arc
 * — every point of it, not just the ones probed — so asking whether a span is
 * flat becomes a question the code can answer rather than estimate. An earlier
 * version subdivided until a handful of interior samples looked close enough,
 * which says nothing about the points between them; measured against curves of
 * high frequency it exceeded its stated tolerance by up to 27 times, and
 * reported success.
 *
 * The same mechanism retires two other problems. A pole makes some divisor span
 * zero, which makes the enclosure unbounded, so poles are found rather than
 * stumbled upon. And the magnitude limit is checked against the enclosure, so a
 * curve that leaves the usable range is caught even between samples.
 *
 * See `src/language/interval.ts` for the guarantee's one caveat: bounds are
 * computed in double precision without directed rounding.
 */
import {
  type ExpressionNode,
  ExpressionError,
  evaluateExpression,
  parseExpression,
  validateExpression,
} from "./expression.ts";
import {
  type Interval,
  UNBOUNDED,
  interval,
  intervalEvaluate,
  isBounded,
  magnitude,
} from "./interval.ts";

export type CurvePoint = readonly [number, number];

export interface SampleRequest {
  readonly x: string;
  readonly y: string;
  readonly from: number;
  readonly to: number;
  readonly tolerance: number;
  readonly maximumPoints?: number;
  readonly maximumMagnitude?: number;
}

export type SampleResult =
  | {
    readonly status: "sampled";
    readonly points: readonly CurvePoint[];
    readonly parameters: readonly number[];
    at(t: number): CurvePoint;
  }
  | { readonly status: "refused"; readonly reason: string };

export const DEFAULT_MAXIMUM_POINTS = 5_000;
export const DEFAULT_MAXIMUM_MAGNITUDE = 1e6;

/**
 * The largest point budget a caller may ask for. Validating only the floor
 * leaves `Number.isInteger(9e15)` passing, and a budget that large is the same
 * as no budget: one call measured 37 seconds and 1.3 GB before returning.
 */
export const MAXIMUM_POINT_BUDGET = 200_000;

/**
 * How many sub-boxes enclose one span while testing it for flatness.
 *
 * One axis-aligned box around a diagonal arc is a poor fit — its far corners
 * sit well outside the curve, so spans that are genuinely flat fail the test
 * and get subdivided anyway. Enclosing the arc in a run of smaller boxes hugs
 * it far more closely, and each still contains its own piece of the arc, so the
 * test stays a proof. Measured on a circle: one box needs 794 points, sixteen
 * needs 113, and thirty-two needs 90 — against 81 for the old unsound test.
 * Past this the extra interval evaluations cost more than the points saved.
 */
const ENCLOSURE_PIECES = 32;

/** Subdivisions of one seed span before the sampler gives up on it. */
const MAXIMUM_DEPTH = 40;

/** Seed spans, before any subdivision. */
const SEED_SPANS = 8;

function distanceToSegment(point: CurvePoint, a: CurvePoint, b: CurvePoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const along = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
  const u = Math.max(0, Math.min(1, along));
  return Math.hypot(point[0] - (a[0] + u * dx), point[1] - (a[1] + u * dy));
}

/**
 * The furthest any point of the box can lie from the chord. Distance to a
 * segment is convex and a box is convex, so the maximum is attained at a
 * corner: four evaluations give the exact answer rather than a sampled one.
 */
function boxDistanceToChord(x: Interval, y: Interval, a: CurvePoint, b: CurvePoint): number {
  return Math.max(
    distanceToSegment([x.lo, y.lo], a, b),
    distanceToSegment([x.lo, y.hi], a, b),
    distanceToSegment([x.hi, y.lo], a, b),
    distanceToSegment([x.hi, y.hi], a, b),
  );
}

interface SpanEnclosure {
  /** Furthest the arc can be from its chord; Infinity if it cannot be bounded. */
  readonly distance: number;
  /** Largest coordinate the arc can reach; Infinity if it cannot be bounded. */
  readonly extent: number;
}

function parseBoth(request: SampleRequest): { x: ExpressionNode; y: ExpressionNode } | string {
  try {
    return { x: parseExpression(request.x), y: parseExpression(request.y) };
  } catch (error) {
    return error instanceof ExpressionError ? error.message : String(error);
  }
}

function validateRequest(request: SampleRequest, maximumPoints: number, maximumMagnitude: number): string | null {
  if (!(request.tolerance > 0) || !Number.isFinite(request.tolerance)) {
    return "tolerance must be a positive finite number";
  }
  if (!Number.isInteger(maximumPoints) || maximumPoints < 2) {
    return "maximumPoints must be an integer of at least 2";
  }
  if (maximumPoints > MAXIMUM_POINT_BUDGET) {
    return `maximumPoints must not exceed ${MAXIMUM_POINT_BUDGET}`;
  }
  if (!(maximumMagnitude > 0) || !Number.isFinite(maximumMagnitude)) {
    return "maximumMagnitude must be a positive finite number";
  }
  if (!Number.isFinite(request.from) || !Number.isFinite(request.to) || request.from === request.to) {
    return "the parameter range must be finite and non-empty";
  }
  return null;
}

export function sampleCurve(request: SampleRequest): SampleResult {
  const maximumPoints = request.maximumPoints ?? DEFAULT_MAXIMUM_POINTS;
  const maximumMagnitude = request.maximumMagnitude ?? DEFAULT_MAXIMUM_MAGNITUDE;
  const invalid = validateRequest(request, maximumPoints, maximumMagnitude);
  if (invalid) return { status: "refused", reason: invalid };

  const parsed = parseBoth(request);
  if (typeof parsed === "string") return { status: "refused", reason: parsed };
  const { x, y } = parsed;

  const bound = new Set(["t"]);
  const issues = [...validateExpression(x, bound), ...validateExpression(y, bound)];
  if (issues.length) return { status: "refused", reason: issues[0].message };

  const at = (t: number): CurvePoint => [
    evaluateExpression(x, { t }),
    evaluateExpression(y, { t }),
  ];

  const enclose = (t0: number, t1: number): [Interval, Interval] => {
    const span = new Map([["t", interval(Math.min(t0, t1), Math.max(t0, t1))]]);
    return [intervalEvaluate(x, span), intervalEvaluate(y, span)];
  };

  /** Encloses the arc in a run of sub-boxes and reports the worst of them. */
  const encloseSpan = (t0: number, t1: number, a: CurvePoint, b: CurvePoint): SpanEnclosure => {
    let distance = 0;
    let extent = 0;
    for (let piece = 0; piece < ENCLOSURE_PIECES; piece += 1) {
      const [bx, by] = enclose(
        t0 + ((t1 - t0) * piece) / ENCLOSURE_PIECES,
        t0 + ((t1 - t0) * (piece + 1)) / ENCLOSURE_PIECES,
      );
      if (!isBounded(bx) || !isBounded(by)) return { distance: Infinity, extent: Infinity };
      extent = Math.max(extent, magnitude(bx), magnitude(by));
      distance = Math.max(distance, boxDistanceToChord(bx, by, a, b));
    }
    return { distance, extent };
  };

  const parameters: number[] = [request.from];
  let refusal: string | null = null;
  const near = (t: number): string => t.toPrecision(4);

  const refine = (t0: number, t1: number, depth: number): void => {
    if (refusal) return;
    if (parameters.length >= maximumPoints) {
      refusal = `sampling exceeded ${maximumPoints} points before reaching a tolerance of ${request.tolerance}`;
      return;
    }
    const a = at(t0);
    const b = at(t1);
    const arc = encloseSpan(t0, t1, a, b);
    if (arc.extent === Infinity) {
      refusal = `the curve is unbounded between t = ${near(t0)} and t = ${near(t1)}`;
      return;
    }
    if (arc.extent > maximumMagnitude) {
      refusal = `the curve reaches ${arc.extent.toPrecision(4)} between t = ${near(t0)} and t = ${near(t1)}, `
        + `beyond the limit of ${maximumMagnitude}`;
      return;
    }
    if (arc.distance <= request.tolerance) {
      parameters.push(t1);
      return;
    }
    if (depth >= MAXIMUM_DEPTH) {
      refusal = `the curve could not be sampled to a tolerance of ${request.tolerance} near t = ${near(t0)}`;
      return;
    }
    refine(t0, (t0 + t1) / 2, depth + 1);
    refine((t0 + t1) / 2, t1, depth + 1);
  };

  const first = at(request.from);
  if (!Number.isFinite(first[0]) || !Number.isFinite(first[1])) {
    return { status: "refused", reason: `the curve is not finite at t = ${request.from}` };
  }

  for (let index = 0; index < SEED_SPANS; index += 1) {
    const t0 = index === 0
      ? request.from
      : request.from + ((request.to - request.from) * index) / SEED_SPANS;
    // The last span ends at `to` exactly. Computing it as a fraction of the
    // range does not round-trip: over 0..2*pi it lands one ulp past the end,
    // which left the final point off the curve for 15% of ranges.
    const t1 = index === SEED_SPANS - 1
      ? request.to
      : request.from + ((request.to - request.from) * (index + 1)) / SEED_SPANS;
    refine(t0, t1, 0);
    if (refusal) return { status: "refused", reason: refusal };
  }

  return { status: "sampled", points: parameters.map(at), parameters, at };
}

/** Exposed so callers can bound a curve without sampling it. */
export function enclosureOf(source: string, over: Interval): Interval {
  const node = parseExpression(source);
  const issues = validateExpression(node, new Set(["t"]));
  if (issues.length) throw new ExpressionError(issues[0].message, issues[0].offset);
  return intervalEvaluate(node, new Map([["t", over]])) ?? UNBOUNDED;
}
