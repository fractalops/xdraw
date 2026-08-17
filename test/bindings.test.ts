// The contract for named values.
//
// A document may name a number and reuse it. The only interesting part is
// ordering: names are resolved by what they depend on rather than by where they
// appear, so a document reads in whatever order suits its author. That makes
// two failure modes possible which a linear evaluator would not have — a cycle,
// and a name that is used but never bound — and both must be diagnosed rather
// than looped on or silently defaulted.
import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { BindingError, resolveBindings } from "../src/language/bindings.ts";

const RUNS = Number.parseInt(process.env.XDRAW_PROPERTY_RUNS ?? "200", 10);
const values = (pairs: Array<[string, string]>) =>
  resolveBindings(pairs.map(([name, source]) => ({ name, source })));

test("a name may be used before it is bound", () => {
  const resolved = values([
    ["gap", "card / 4"],
    ["card", "260"],
    ["column", "margin + card + gap"],
    ["margin", "80"],
  ]);
  assert.equal(resolved.get("card"), 260);
  assert.equal(resolved.get("gap"), 65);
  assert.equal(resolved.get("column"), 405);
});

test("a binding may use the constants and functions of the expression language", () => {
  const resolved = values([
    ["turn", "tau"],
    ["radius", "120"],
    ["reach", "radius * cos(pi / 3)"],
  ]);
  assert.equal(resolved.get("turn"), Math.PI * 2);
  assert.ok(Math.abs(resolved.get("reach")! - 60) < 1e-9);
});

test("a cycle is reported with the path that closes it", () => {
  try {
    values([["a", "b + 1"], ["b", "c + 1"], ["c", "a + 1"]]);
    assert.fail("a cycle must be rejected");
  } catch (error) {
    assert.ok(error instanceof BindingError);
    assert.match(error.message, /a -> b -> c -> a/, `got: ${error.message}`);
  }
});

test("a name bound to itself is a cycle, not a silent zero", () => {
  assert.throws(() => values([["a", "a + 1"]]), /a -> a/);
});

test("an unbound name reports who used it", () => {
  assert.throws(() => values([["a", "mystery * 2"]]), /unknown name 'mystery'.*'a'/);
});

test("a binding may not shadow a constant or a function", () => {
  // `freeNames` excludes constants, so a binding named `tau` is never treated
  // as a dependency and resolution falls back to source order — which made the
  // same document draw two different sizes depending on which line came first,
  // silently, against what the specification promises.
  for (const name of ["pi", "tau", "e"]) {
    assert.throws(() => values([[name, "5"]]), new RegExp(`'${name}'.*constant`), `${name} must be refused`);
  }
  for (const name of ["sin", "hypot", "round"]) {
    assert.throws(() => values([[name, "5"]]), new RegExp(`'${name}'.*function`), `${name} must be refused`);
  }
});

test("a duplicate name is rejected rather than shadowing", () => {
  assert.throws(() => values([["a", "1"], ["a", "2"]]), /'a' is bound more than once/);
});

test("a binding that is not a finite number is rejected", () => {
  assert.throws(() => values([["a", "1 / 0"]]), /'a' is not a finite number/);
  assert.throws(() => values([["a", "0 / 0"]]), /'a' is not a finite number/);
});

test("a malformed expression names the binding it belongs to", () => {
  assert.throws(() => values([["a", "1 +"]]), /'a'/);
});

// --------------------------------------------------------------- properties

/** A chain of bindings where each refers only to the one declared before it. */
const chain = fc.integer({ min: 1, max: 12 }).map((length) =>
  Array.from({ length }, (_, i) => (
    i === 0 ? ["n0", "1"] as [string, string] : [`n${i}`, `n${i - 1} + 1`] as [string, string]
  )));

test("property: resolution does not depend on the order names are written in", () => {
  fc.assert(fc.property(chain, fc.integer({ min: 0, max: 5 }), (bindings, rotation) => {
    const rotated = [...bindings.slice(rotation), ...bindings.slice(0, rotation)];
    const straight = values(bindings);
    const shuffled = values(rotated);
    assert.deepEqual([...shuffled].sort(), [...straight].sort(), "order must not change the result");
  }), { numRuns: RUNS });
});

test("property: every binding in a well-formed document resolves to a finite number", () => {
  fc.assert(fc.property(chain, (bindings) => {
    const resolved = values(bindings);
    assert.equal(resolved.size, bindings.length, "every name must be bound");
    for (const [name, value] of resolved) {
      assert.ok(Number.isFinite(value), `${name} resolved to ${value}`);
    }
  }), { numRuns: RUNS });
});

test("property: closing a chain into a loop always reports a cycle", () => {
  // Whatever the length, pointing the first binding at the last makes every
  // name unreachable. None of them may resolve, and it must not hang.
  fc.assert(fc.property(fc.integer({ min: 2, max: 12 }), (length) => {
    const looped: Array<[string, string]> = Array.from({ length }, (_, i) => (
      i === 0
        ? ["n0", `n${length - 1} + 1`]
        : [`n${i}`, `n${i - 1} + 1`]
    ));
    assert.throws(() => values(looped), BindingError, `a loop of ${length} must be rejected`);
  }), { numRuns: RUNS });
});

test("property: resolution is deterministic", () => {
  fc.assert(fc.property(chain, (bindings) => {
    assert.deepEqual([...values(bindings)], [...values(bindings)]);
  }), { numRuns: RUNS });
});
