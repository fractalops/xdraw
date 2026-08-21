/**
 * Interval arithmetic over the expression vocabulary.
 *
 * Evaluating an expression with `t` bound to an interval rather than a number
 * yields a range guaranteed to contain every value the expression takes as `t`
 * moves across that interval. That is the inclusion property, and it is what
 * lets the sampler prove a span is flat instead of probing a few points and
 * hoping. Without it, no finite number of samples says anything about the
 * points = between them.
 *
 * Every rule here must over-estimate rather than under-estimate. A range that
 * is too wide costs extra subdivision; a range that is too narrow silently
 * produces a wrong curve, which is the failure the whole approach exists to
 * prevent. Where a tight rule would be intricate — `atan2` across its branch
 * cut, a fractional power of a negative base — this returns the whole line and
 * lets the caller subdivide.
 *
 * The bounds are computed in ordinary double precision without directed
 * rounding, so the guarantee holds up to floating-point error in the bounds
 * themselves. That is orders of magnitude below any tolerance a drawing uses.
 */
import { type ExpressionNode, ExpressionError } from "./expression.ts";

export interface Interval {
  readonly lo: number;
  readonly hi: number;
}

export const interval = (lo: number, hi: number): Interval => ({ lo, hi });

/** The whole real line: sound, and carries no information. */
export const UNBOUNDED: Interval = interval(-Infinity, Infinity);

export const isBounded = (a: Interval): boolean =>
  Number.isFinite(a.lo) && Number.isFinite(a.hi);

export const width = (a: Interval): number => a.hi - a.lo;

export const magnitude = (a: Interval): number => Math.max(Math.abs(a.lo), Math.abs(a.hi));

export const straddlesZero = (a: Interval): boolean => a.lo <= 0 && a.hi >= 0;

const TAU = Math.PI * 2;

/**
 * The smallest interval containing every value given. A NaN among them means an
 * indeterminate form (0·∞, ∞−∞) that cannot be bounded, so the result widens to
 * the whole line rather than propagating a NaN that later comparisons would
 * silently read as false.
 */
function hull(values: readonly number[]): Interval {
  let lo = Infinity;
  let hi = -Infinity;
  for (const value of values) {
    if (Number.isNaN(value)) return UNBOUNDED;
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  return interval(lo, hi);
}

/** Does [a,b] contain `phase + k·period` for some integer k? */
function containsPhase(a: number, b: number, phase: number, period: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return phase + Math.ceil((a - phase) / period) * period <= b;
}

export const add = (a: Interval, b: Interval): Interval => interval(a.lo + b.lo, a.hi + b.hi);
export const subtract = (a: Interval, b: Interval): Interval => interval(a.lo - b.hi, a.hi - b.lo);
export const negate = (a: Interval): Interval => interval(-a.hi, -a.lo);
export const multiply = (a: Interval, b: Interval): Interval =>
  hull([a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi]);

export function divide(a: Interval, b: Interval): Interval {
  // A divisor spanning zero is a pole. Returning the whole line here is what
  // makes poles detectable by construction rather than by sampling near them.
  if (straddlesZero(b)) return UNBOUNDED;
  return hull([a.lo / b.lo, a.lo / b.hi, a.hi / b.lo, a.hi / b.hi]);
}

export function power(a: Interval, b: Interval): Interval {
  if (b.lo === b.hi && Number.isInteger(b.lo)) {
    const exponent = b.lo;
    if (exponent === 0) return interval(1, 1);
    if (exponent < 0 && straddlesZero(a)) return UNBOUNDED;
    const ends = [a.lo ** exponent, a.hi ** exponent];
    // An even power turns at zero, so a base spanning zero reaches its minimum
    // in the interior rather than at an endpoint.
    if (exponent % 2 === 0 && straddlesZero(a)) ends.push(0);
    return hull(ends);
  }
  // A negative base to a fractional power is not real.
  if (a.lo < 0) return UNBOUNDED;
  return hull([a.lo ** b.lo, a.lo ** b.hi, a.hi ** b.lo, a.hi ** b.hi]);
}

/** For a function that never turns: the range is fixed by the endpoints. */
const monotone = (a: Interval, f: (x: number) => number): Interval => hull([f(a.lo), f(a.hi)]);

export function sine(a: Interval): Interval {
  if (width(a) >= TAU) return interval(-1, 1);
  const ends = [Math.sin(a.lo), Math.sin(a.hi)];
  if (containsPhase(a.lo, a.hi, Math.PI / 2, TAU)) ends.push(1);
  if (containsPhase(a.lo, a.hi, -Math.PI / 2, TAU)) ends.push(-1);
  return hull(ends);
}

export function cosine(a: Interval): Interval {
  if (width(a) >= TAU) return interval(-1, 1);
  const ends = [Math.cos(a.lo), Math.cos(a.hi)];
  if (containsPhase(a.lo, a.hi, 0, TAU)) ends.push(1);
  if (containsPhase(a.lo, a.hi, Math.PI, TAU)) ends.push(-1);
  return hull(ends);
}

export function tangent(a: Interval): Interval {
  if (width(a) >= Math.PI) return UNBOUNDED;
  if (containsPhase(a.lo, a.hi, Math.PI / 2, Math.PI)) return UNBOUNDED;
  return monotone(a, Math.tan);
}

export function absolute(a: Interval): Interval {
  if (straddlesZero(a)) return interval(0, magnitude(a));
  return hull([Math.abs(a.lo), Math.abs(a.hi)]);
}

export function signum(a: Interval): Interval {
  if (a.lo > 0) return interval(1, 1);
  if (a.hi < 0) return interval(-1, -1);
  return hull([Math.sign(a.lo), Math.sign(a.hi), 0]);
}

/**
 * `atan2` is continuous and turns nowhere in the interior, and is monotone
 * along each edge of a box, so the corners bound it — but only on a box that
 * avoids the origin and the negative x axis, where the branch cut makes the
 * angle jump between -pi and pi.
 */
export function arcTangent2(y: Interval, x: Interval): Interval {
  // The cut lies where x is strictly negative, so a box whose x reaches zero
  // without passing it does not cross. Testing `x.lo <= 0` instead widens such
  // a box to the whole circle when its true range is half of that — and x
  // touching zero exactly is ordinary, not a corner case: abs(t) and t^2 both
  // produce it whenever the span straddles the origin.
  const crossesCut = x.lo < 0 && straddlesZero(y);
  if (crossesCut) return interval(-Math.PI, Math.PI);
  return hull([
    Math.atan2(y.lo, x.lo), Math.atan2(y.lo, x.hi),
    Math.atan2(y.hi, x.lo), Math.atan2(y.hi, x.hi),
  ]);
}

export function hypotenuse(a: Interval, b: Interval): Interval {
  const p = absolute(a);
  const q = absolute(b);
  return interval(Math.hypot(p.lo, q.lo), Math.hypot(p.hi, q.hi));
}

type IntervalFunction = (args: readonly Interval[]) => Interval;

/**
 * One entry per name in the expression vocabulary. A missing entry is a
 * programming error rather than a document error, and `test/interval.test.ts`
 * pins that the two tables have the same names.
 */
export const INTERVAL_FUNCTIONS: ReadonlyMap<string, IntervalFunction> = new Map<string, IntervalFunction>([
  ["sin", ([x]) => sine(x)],
  ["cos", ([x]) => cosine(x)],
  ["tan", ([x]) => tangent(x)],
  ["asin", ([x]) => (x.lo < -1 || x.hi > 1 ? UNBOUNDED : monotone(x, Math.asin))],
  ["acos", ([x]) => (x.lo < -1 || x.hi > 1 ? UNBOUNDED : monotone(x, Math.acos))],
  ["atan", ([x]) => monotone(x, Math.atan)],
  ["atan2", ([y, x]) => arcTangent2(y, x)],
  ["sqrt", ([x]) => (x.lo < 0 ? UNBOUNDED : monotone(x, Math.sqrt))],
  ["abs", ([x]) => absolute(x)],
  ["sign", ([x]) => signum(x)],
  ["floor", ([x]) => monotone(x, Math.floor)],
  ["ceil", ([x]) => monotone(x, Math.ceil)],
  ["round", ([x]) => monotone(x, Math.round)],
  ["min", ([a, b]) => interval(Math.min(a.lo, b.lo), Math.min(a.hi, b.hi))],
  ["max", ([a, b]) => interval(Math.max(a.lo, b.lo), Math.max(a.hi, b.hi))],
  ["exp", ([x]) => monotone(x, Math.exp)],
  ["log", ([x]) => (x.lo <= 0 ? UNBOUNDED : monotone(x, Math.log))],
  ["hypot", ([a, b]) => hypotenuse(a, b)],
]);

const INTERVAL_CONSTANTS: ReadonlyMap<string, number> = new Map([
  ["pi", Math.PI],
  ["tau", TAU],
  ["e", Math.E],
]);

function applyBinary(operator: string, left: Interval, right: Interval): Interval {
  if (operator === "+") return add(left, right);
  if (operator === "-") return subtract(left, right);
  if (operator === "*") return multiply(left, right);
  if (operator === "/") return divide(left, right);
  return power(left, right);
}

/**
 * Evaluates an expression with every free name bound to an interval, returning
 * a range that contains the expression's value for every combination of values
 * those names could take.
 */
export function intervalEvaluate(
  node: ExpressionNode,
  environment: ReadonlyMap<string, Interval>,
): Interval {
  switch (node.kind) {
    case "number": return interval(node.value, node.value);
    case "name": {
      const bound = environment.get(node.name);
      if (bound) return bound;
      const constant = INTERVAL_CONSTANTS.get(node.name);
      if (constant !== undefined) return interval(constant, constant);
      throw new ExpressionError(`unknown name '${node.name}'`, node.offset);
    }
    case "negate": return negate(intervalEvaluate(node.operand, environment));
    case "binary": return applyBinary(
      node.operator,
      intervalEvaluate(node.left, environment),
      intervalEvaluate(node.right, environment),
    );
    case "call": {
      const fn = INTERVAL_FUNCTIONS.get(node.name);
      if (!fn) throw new ExpressionError(`unknown function '${node.name}'`, node.offset);
      return fn(node.args.map((argument) => intervalEvaluate(argument, environment)));
    }
  }
  throw new ExpressionError(`unsupported expression node '${(node as { kind: string }).kind}'`, 0);
}
