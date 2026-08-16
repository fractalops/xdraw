// The contract for the expression sublanguage.
//
// Several assertions here check values where a shape check would read more
// naturally, because the shape checks do not discriminate: `typeof
// fn.apply([0.5]) === "number"` holds just as well with min swapped for max,
// floor for ceil, or atan2's arguments reversed. Mutation testing found each of
// those defects surviving a suite that only checked shapes, so the function
// table is pinned to its values and the size limits to their exact boundaries.
import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import {
  CONSTANTS,
  ExpressionError,
  FUNCTIONS,
  MAXIMUM_NESTING,
  MAXIMUM_NODES,
  type ExpressionNode,
  evaluateExpression,
  freeNames,
  parseExpression,
  validateExpression,
} from "../src/language/expression.ts";

const RUNS = Number.parseInt(process.env.XDRAW_PROPERTY_RUNS ?? "250", 10);
const value = (source: string): number => evaluateExpression(parseExpression(source), {});

// ------------------------------------------------------------------ grammar

test("the vocabulary is closed", () => {
  for (const source of ["t = 4", "t++", "foo.bar(t)", "[1,2]", "t ? 1 : 2", "new Date()"]) {
    assert.throws(() => parseExpression(source), ExpressionError, `${source} must be rejected`);
  }
});

test("errors carry the offset a reader needs", () => {
  const cases: Array<[string, number]> = [["t = 4", 2], ["1 + ", 4], ["sin(t", 5]];
  for (const [source, offset] of cases) {
    try {
      parseExpression(source);
      assert.fail(`${source} must be rejected`);
    } catch (error) {
      assert.ok(error instanceof ExpressionError);
      assert.equal(error.offset, offset, `${source} must report offset ${offset}`);
    }
  }
});

test("arithmetic follows the conventions it is written in", () => {
  assert.equal(value("-2 ^ 2"), -4, "unary minus binds looser than exponentiation");
  assert.equal(value("2 ^ 3 ^ 2"), 512, "exponentiation is right-associative");
  assert.equal(value("1 + 2 * 3"), 7);
  assert.equal(value("(1 + 2) * 3"), 9);
  assert.equal(value("10 - 3 - 2"), 5, "subtraction is left-associative");
  assert.equal(value("100 / 5 / 2"), 10, "division is left-associative");
  assert.equal(value("1 - 2 + 3"), 2, "+ and - share a precedence level");
  assert.equal(value("8 / 4 * 2"), 4, "* and / share a precedence level");
});

test("unknown names, unknown functions, and wrong arity fail before evaluation", () => {
  const bound = new Set(["t"]);
  const issues = (source: string) => validateExpression(parseExpression(source), bound);
  assert.match(issues("a * t")[0].message, /unknown name 'a'/);
  assert.match(issues("wobble(t)")[0].message, /unknown function 'wobble'/);
  assert.match(issues("sin(t, t)")[0].message, /sin takes 1 argument, received 2/);
  assert.match(issues("hypot(t)")[0].message, /hypot takes 2 arguments, received 1/);
  assert.deepEqual(issues("sin(2 * t) + pi"), [], "a valid expression reports nothing");
  // The validator must descend into call arguments; a bad name hidden inside a
  // well-formed call is the case that skipping them would miss.
  assert.match(issues("sin(a * t)")[0].message, /unknown name 'a'/);
  assert.match(issues("hypot(t, wobble(t))")[0].message, /unknown function 'wobble'/);
  assert.match(issues("sin(-a)")[0].message, /unknown name 'a'/);
});

test("every declared function computes what its name says", () => {
  // Asserting only that each function returns a finite number would pass with
  // min and max swapped, floor and ceil swapped, atan2's arguments reversed,
  // and sign replaced by abs. These pin the values.
  assert.equal(value("sin(0)"), 0);
  assert.equal(value("cos(0)"), 1);
  assert.equal(value("tan(0)"), 0);
  assert.equal(value("asin(1)"), Math.PI / 2);
  assert.equal(value("acos(1)"), 0);
  assert.equal(value("atan(1)"), Math.PI / 4);
  assert.equal(value("atan2(1, 0)"), Math.PI / 2, "atan2 takes (y, x), in that order");
  assert.equal(value("atan2(0, 1)"), 0);
  assert.equal(value("sqrt(9)"), 3);
  assert.equal(value("abs(0 - 3)"), 3);
  assert.equal(value("sign(0 - 3)"), -1);
  assert.equal(value("floor(1.7)"), 1);
  assert.equal(value("ceil(1.2)"), 2);
  assert.equal(value("round(2.5)"), 3);
  assert.equal(value("round(0 - 2.5)"), -2, "round breaks ties towards +Infinity");
  assert.equal(value("min(3, 7)"), 3);
  assert.equal(value("max(3, 7)"), 7);
  assert.equal(value("exp(0)"), 1);
  assert.equal(value("log(1)"), 0);
  assert.equal(value("hypot(3, 4)"), 5);
  assert.equal(value("pi"), Math.PI);
  assert.equal(value("tau"), Math.PI * 2);
  assert.equal(value("e"), Math.E);
  assert.equal(FUNCTIONS.names.length, 18, "the declared function set is fixed");
  assert.deepEqual([...CONSTANTS.names].sort(), ["e", "pi", "tau"]);
});

// --------------------------------------------------------------- the closure

test("names inherited from Object are not part of the vocabulary", () => {
  // `in` and index lookup walk the prototype chain, so an unguarded table
  // accepts 'constructor' and '__proto__' as though they were declared.
  const bound = new Set(["t"]);
  const inherited = ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf"];
  for (const name of inherited) {
    const [issue] = validateExpression(parseExpression(`${name} * t`), bound);
    assert.equal(issue?.message, `unknown name '${name}'`, `${name} must not resolve as a name`);
    assert.equal(FUNCTIONS.get(name), undefined, `FUNCTIONS must not answer for ${name}`);
    assert.equal(CONSTANTS.get(name), undefined, `CONSTANTS must not answer for ${name}`);
  }
  for (const name of inherited) {
    const [issue] = validateExpression(parseExpression(`${name}(t)`), bound);
    assert.equal(issue?.message, `unknown function '${name}'`, `${name} must not resolve as a function`);
  }
});

test("the evaluator's tables are closed too, not only the validator's", () => {
  // The two entry points hold separate lookups. Guarding only the validator
  // leaves `toString(t)` resolving to Function.prototype.apply in the
  // evaluator, which returns a string where a number was promised.
  for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
    assert.throws(
      () => evaluateExpression(parseExpression(`${name}(t)`), { t: 1 }),
      /unknown function/,
      `${name} must not be callable`,
    );
    assert.throws(
      () => evaluateExpression(parseExpression(name), { t: 1 }),
      /unknown name/,
      `${name} must not be readable`,
    );
  }
});

test("an inherited name is not readable from the environment either", () => {
  // The environment is caller-supplied, so its prototype is reachable too.
  for (const source of ["toString", "constructor * 2", "valueOf", "__proto__"]) {
    assert.throws(
      () => evaluateExpression(parseExpression(source), { t: 1 }),
      ExpressionError,
      `${source} must not evaluate`,
    );
  }
  // A name on the environment's prototype is not the environment's own, so it
  // must not resolve; an own property must.
  assert.throws(
    () => evaluateExpression(parseExpression("t"), Object.create({ t: 99 }) as Record<string, number>),
    /unknown name 't'/,
    "an inherited binding must not satisfy a free name",
  );
  assert.equal(evaluateExpression(parseExpression("t"), Object.assign(Object.create({ t: 99 }), { t: 7 })), 7);
  assert.equal(evaluateExpression(parseExpression("t"), Object.assign(Object.create(null), { t: 5 })), 5);
});

test("the vocabulary cannot be extended at run time", () => {
  // A frozen object literal cannot be extended but exposes Object.prototype; a
  // bare Map hides the prototype but Object.freeze does nothing to it, so any
  // holder of the export could add a function or redefine pi. Both must hold.
  for (const table of [FUNCTIONS, CONSTANTS]) {
    assert.ok(Object.isFrozen(table), "the table must be frozen");
    assert.equal((table as unknown as { set?: unknown }).set, undefined, "no mutator may be exposed");
    assert.throws(() => {
      (table as unknown as Record<string, unknown>).pwn = 1;
    }, TypeError, "the table must reject new properties");
  }
  assert.ok(Object.isFrozen(FUNCTIONS.names), "the name list must be frozen");
  assert.equal(FUNCTIONS.get("pwn"), undefined);
  assert.equal(CONSTANTS.get("pi"), Math.PI, "pi must still be pi");
});

// ----------------------------------------------------------------- the size

test("a long chain is refused by node count, not left to overflow the stack", () => {
  // The regression this exists for: `t+1+1+1…` is consumed by a loop, not by
  // recursion, so the parser never nests while the tree grows one level per
  // term. Capping parser depth alone let an 8 KB expression through, and the
  // stack then overflowed inside the evaluator with a RangeError.
  const chain = (terms: number): string => `t${"+1".repeat(terms)}`;
  const perTerm = 2; // each `+1` builds a number node and a binary node
  const fits = Math.floor((MAXIMUM_NODES - 1) / perTerm);

  assert.doesNotThrow(() => parseExpression(chain(fits)), "an expression within the limit must parse");
  assert.throws(() => parseExpression(chain(fits + 1)), /holds more than/, "one term past the limit must be refused");

  for (const terms of [1_000, 10_000, 50_000]) {
    assert.throws(
      () => parseExpression(chain(terms)),
      ExpressionError,
      `${terms} terms must raise a diagnostic, not a RangeError`,
    );
  }
  // The same shape under every left-associative operator, and nested in a call.
  for (const operator of ["+", "-", "*", "/"]) {
    assert.throws(() => parseExpression(`t${`${operator}1`.repeat(10_000)}`), ExpressionError, `chain of ${operator}`);
  }
  assert.throws(() => parseExpression(`sin(t${"+1".repeat(10_000)})`), ExpressionError);
  assert.equal(MAXIMUM_NODES, 512, "the limit is part of the contract");
});

test("nesting deeper than the language allows is refused, not overflowed", () => {
  // Parentheses are the shape the node limit cannot catch: a parenthesised
  // group returns its inner node rather than wrapping it, so `((((t))))` is one
  // node however deep it goes, while the parser recurses once per level.
  const nested = (depth: number): string => `${"(".repeat(depth)}t${")".repeat(depth)}`;
  assert.doesNotThrow(() => parseExpression(nested(MAXIMUM_NESTING - 1)), "one level inside the limit must parse");
  assert.throws(() => parseExpression(nested(MAXIMUM_NESTING)), /nests deeper than/, "the limit itself must be refused");
  assert.throws(() => parseExpression(nested(5_000)), ExpressionError);
  assert.throws(() => parseExpression(`${"-".repeat(5_000)}t`), ExpressionError, "unary minus must be capped");
  assert.throws(() => parseExpression(`${"sin(".repeat(5_000)}t${")".repeat(5_000)}`), ExpressionError, "calls must be capped");
  assert.equal(MAXIMUM_NESTING, 64, "the limit is part of the contract");
});

test("evaluation enforces arity, rather than returning NaN", () => {
  // The validator checks arity, but the evaluator is exported separately and
  // must agree. Reaching apply() with the wrong count drops arguments or
  // returns NaN, which is how a wrong number reaches a coordinate.
  for (const source of ["min(1)", "hypot()", "sin(1, 2, 3)", "atan2(1)"]) {
    assert.throws(() => evaluateExpression(parseExpression(source), {}), /takes \d+ argument/, source);
  }
});

test("a node of an unrecognised kind is refused, not silently undefined", () => {
  // ExpressionNode is exported, so a caller can hand over a node the switch
  // does not cover. Falling out of it returns undefined typed as number, which
  // every downstream Number.isFinite guard would read as a valid coordinate.
  const alien = { kind: "lambda" } as unknown as ExpressionNode;
  assert.throws(() => evaluateExpression(alien, { t: 1 }), ExpressionError);
});

// ---------------------------------------------------------------- free names

test("free names are the unbound identifiers, and only those", () => {
  const namesOf = (source: string): string[] => [...freeNames(parseExpression(source))].sort();
  assert.deepEqual(namesOf("-a"), ["a"], "negate must be visited");
  assert.deepEqual(namesOf("pi + tau + e"), [], "constants are not free names");
  assert.deepEqual(namesOf("constructor"), ["constructor"], "an inherited name is still a free name");
  assert.deepEqual(namesOf("a * sin(b * t)"), ["a", "b", "t"], "call arguments must be visited");
  assert.deepEqual(namesOf("t ^ t"), ["t"], "a name is reported once");
  assert.deepEqual(namesOf("1 + 2"), []);
});

// --------------------------------------------------------------- properties

const term = fc.oneof(
  fc.integer({ min: 1, max: 200 }).map(String),
  fc.constant("t"),
  fc.integer({ min: 1, max: 9 }).map((k) => `sin(${k}*t)`),
  fc.integer({ min: 1, max: 9 }).map((k) => `cos(${k}*t)`),
  fc.constant("sqrt(abs(t))"),
);
const expression = fc.tuple(term, fc.constantFrom("*", "+", "-", "/"), term)
  .map(([a, operator, b]) => `${a} ${operator} ${b}`);

test("property: evaluation agrees with the reference implementation", () => {
  fc.assert(fc.property(fc.double({ min: -50, max: 50, noNaN: true }), (t) => {
    const at = (source: string): number => evaluateExpression(parseExpression(source), { t });
    assert.equal(at("sin(t)"), Math.sin(t));
    assert.equal(at("cos(t) * 3 + 2"), Math.cos(t) * 3 + 2);
    assert.equal(at("abs(t) ^ 0.5"), Math.abs(t) ** 0.5);
    assert.equal(at("hypot(t, 3)"), Math.hypot(t, 3));
    assert.equal(at("atan2(t, 2)"), Math.atan2(t, 2));
    assert.equal(at("min(t, 4) + max(t, 4)"), Math.min(t, 4) + Math.max(t, 4));
    assert.equal(at("floor(t) - ceil(t)"), Math.floor(t) - Math.ceil(t));
    assert.equal(at("sign(t) * 2"), Math.sign(t) * 2);
    assert.equal(at("(t + 1) / 3"), (t + 1) / 3);
  }), { numRuns: RUNS });
});

test("property: parsing is deterministic and round-trips through evaluation", () => {
  fc.assert(fc.property(expression, fc.double({ min: -20, max: 20, noNaN: true }), (source, t) => {
    const first = evaluateExpression(parseExpression(source), { t });
    const second = evaluateExpression(parseExpression(source), { t });
    assert.deepEqual(Object.is(first, second), true, `${source} must evaluate the same way twice`);
  }), { numRuns: RUNS });
});

test("property: a rejection always points inside the source it was given", () => {
  // The offset is the whole reason parsing reports failures the way it does, so
  // it must be usable as an index. One past the end is the caret convention for
  // "ran out of input" and is allowed; anything else is a bug.
  fc.assert(fc.property(fc.string({ maxLength: 40 }), (source) => {
    try {
      parseExpression(source);
    } catch (error) {
      assert.ok(error instanceof ExpressionError, `${JSON.stringify(source)} threw ${String(error)}`);
      assert.ok(
        Number.isInteger(error.offset) && error.offset >= 0 && error.offset <= source.length,
        `${JSON.stringify(source)} reported offset ${error.offset} for length ${source.length}`,
      );
    }
  }), { numRuns: RUNS });
});

test("property: a validated expression over bound names always evaluates", () => {
  fc.assert(fc.property(expression, fc.double({ min: -20, max: 20, noNaN: true }), (source, t) => {
    const node = parseExpression(source);
    assert.deepEqual(validateExpression(node, new Set(["t"])), [], `${source} must validate`);
    assert.equal(typeof evaluateExpression(node, { t }), "number", `${source} must evaluate to a number`);
  }), { numRuns: RUNS });
});
