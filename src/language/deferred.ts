/**
 * A value the document writes but cannot yet compute.
 *
 * `let card`, a repeat's `index`, a template parameter, and `flow.a.east` are
 * one idea — a name whose value someone supplies later — differing only in who
 * supplies it and when. This module is that idea, once. Each compilation stage
 * calls `advance` with the names it knows; a name nobody has supplied *yet* is
 * not an error, and only the last stage may call `demand` and turn one into a
 * diagnostic, because only it knows nobody else is coming.
 *
 * A pending value is a plain string, and that is load-bearing rather than lazy.
 * An opaque representation — a class with private fields, so that no pass could
 * branch on whether a value had resolved — does not survive `structuredClone`,
 * which repetition and template expansion both use. A cloned value came back as
 * an empty object and was then treated as already resolved: a silently wrong
 * number rather than an error.
 *
 * The invisibility that matters is at the language level, and the closed
 * expression vocabulary already provides it: a document cannot ask whether a
 * value has resolved, because there is no function to ask with.
 */
import {
  ExpressionError,
  evaluateExpression,
  evaluateValueExpression,
  formatExpression,
  freeNames,
  parseExpression,
  substituteNames,
  type ExpressionValue,
} from "./expression.ts";

/** A number, or the source of a computation still waiting on a name. */
export type Deferred = number | string;
export type DeferredValue = ExpressionValue | string;

export class UnresolvedError extends Error {
  /** The names that were never supplied. */
  readonly names: readonly string[];

  constructor(owner: string, names: readonly string[], source: string) {
    const quoted = names.map((name) => `'${name}'`).join(", ");
    const verb = names.length === 1 ? "is" : "are";
    super(`${owner}: ${quoted} ${verb} not defined anywhere (in ${source})`);
    this.name = "XDrawUnresolvedError";
    this.names = names;
  }
}

/** The names one stage supplies. */
export function scope(names: Readonly<Record<string, number>>): ReadonlyMap<string, number> {
  return new Map(Object.entries(names));
}

const isPending = (value: Deferred): value is string => typeof value === "string";

/** Reads a value as written, resolving it if nothing is outstanding. */
export function deferredValue(source: string): Deferred {
  const node = parseExpression(source);
  return freeNames(node).size === 0 ? evaluateExpression(node, {}) : source;
}

/**
 * Advances a value through one stage.
 *
 * A resolved value is returned untouched. A pending one resolves if this stage
 * supplies everything it wanted, and otherwise keeps waiting with what this
 * stage did supply folded in — so a later stage sees a smaller problem, and the
 * same written value can be advanced separately for each instance that uses it.
 */
export function advance(value: Deferred, names: ReadonlyMap<string, number>): Deferred {
  if (!isPending(value)) return value;
  const node = parseExpression(value);
  const outstanding = [...freeNames(node)].filter((name) => !names.has(name));
  if (outstanding.length === 0) return evaluateExpression(node, Object.fromEntries(names));
  if (outstanding.length === freeNames(node).size) return value;
  return formatExpression(substituteNames(node, names));
}

/** Advance a scalar or point expression without discarding its value kind. */
export function advanceValue(value: DeferredValue, names: ReadonlyMap<string, number>): DeferredValue {
  if (typeof value !== "string") return value;
  const substituted = substituteNames(parseExpression(value), names);
  if (freeNames(substituted).size === 0) return evaluateValueExpression(substituted, {});
  return formatExpression(substituted);
}

/** Names a pending value is still waiting on. */
export function outstandingNames(value: Deferred): readonly string[] {
  if (!isPending(value)) return [];
  try {
    return [...freeNames(parseExpression(value))];
  } catch {
    return [];
  }
}

/**
 * Turns a value into a number, or into a diagnostic naming what was never
 * supplied. Only the last stage that could have supplied a name may call this.
 */
export function demand(value: Deferred, owner: string): number {
  if (!isPending(value)) return value;
  throw new UnresolvedError(owner, outstandingNames(value), value);
}

/**
 * Demands a value that a stage cannot defer, saying why it cannot wait.
 *
 * An instance count has to be known before the instances exist, so it may not
 * depend on anything a later stage supplies. Terraform states the same
 * restriction for `for_each`, and it follows from what expansion means rather
 * than being a limitation worth removing.
 */
export function requireResolved(value: Deferred, owner: string, why: string): number {
  if (!isPending(value)) return value;
  throw new UnresolvedError(`${owner} (${why})`, outstandingNames(value), value);
}

/**
 * Adds a number to a value that may still be waiting.
 *
 * A stage often knows an offset before it knows the thing being offset — the
 * curve sampler knows where its first point sits relative to the origin long
 * before layout has produced that origin. Composing the two keeps the result a
 * single value rather than forcing the stage to resolve early.
 */
export function offsetBy(value: Deferred, delta: number): Deferred {
  if (!isPending(value)) return value + delta;
  if (delta === 0) return value;
  return formatExpression(parseExpression(`(${value}) + ${delta}`));
}

/** True when the text could be read as an expression at all. */
export function isExpressionSource(source: string): boolean {
  try {
    parseExpression(source);
    return true;
  } catch (error) {
    if (error instanceof ExpressionError) return false;
    throw error;
  }
}
