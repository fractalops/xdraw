// The contract for deferred numeric values.
//
// A name whose value someone supplies later is one idea, whoever supplies it:
// a `let` binding, a repeat's index, a template parameter, or a measured box.
// Each compilation stage advances what it can and leaves the rest, and only the
// last stage may turn an unsupplied name into a diagnostic.
//
// A pending value is a plain string. That looks too simple and is the only
// thing that works: an opaque class does not survive `structuredClone`, which
// repetition and template expansion both use, and a cloned value came back
// resolved-looking. The property tests below pin that.
import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { compile, parse } from "../src/index.ts";

import {
  UnresolvedError,
  advance,
  deferredValue,
  demand,
  requireResolved,
  scope,
} from "../src/language/deferred.ts";

const RUNS = Number.parseInt(process.env.XDRAW_PROPERTY_RUNS ?? "200", 10);

test("a value with nothing outstanding resolves immediately", () => {
  assert.equal(deferredValue("2 + 3 * 4"), 14);
  assert.equal(deferredValue("tau"), Math.PI * 2);
});

test("a value waits for a name nobody has supplied yet", () => {
  const waiting = deferredValue("card + 10");
  assert.equal(typeof waiting, "string", "a pending value is plain data");
  assert.equal(advance(waiting, scope({ card: 90 })), 100);
});

test("what a stage knows is folded in, and the rest keeps waiting", () => {
  const partial = advance(deferredValue("card + index"), scope({ card: 260 }));
  assert.equal(typeof partial, "string", "still waiting on index");
  assert.equal(advance(partial, scope({ index: 2 })), 262);
});

test("one value resolves differently for each instance that uses it", () => {
  // The case repetition depends on: a declaration is cloned, and every clone
  // must resolve the same written value against its own index.
  const shared = advance(deferredValue("100 + 40 * index"), scope({}));
  const placed = [0, 1, 2, 3].map((index) => advance(shared, scope({ index })));
  assert.deepEqual(placed, [100, 140, 180, 220]);
  assert.equal(typeof shared, "string", "the shared value is left intact for the next instance");
});

test("an unsupplied name becomes a diagnostic only when demanded", () => {
  const waiting = deferredValue("mystery * 2");
  assert.equal(advance(waiting, scope({ other: 1 })), waiting, "an unrelated stage changes nothing");
  assert.throws(() => demand(waiting, "text 'note' at"), UnresolvedError);
  assert.throws(() => demand(waiting, "text 'note' at"), /'mystery'.*not defined/);
  assert.throws(() => demand(waiting, "text 'note' at"), /text 'note' at/);
});

test("a value a stage cannot defer says why it cannot wait", () => {
  // An instance count must be known before the instances exist, so it may not
  // depend on anything a later stage supplies.
  assert.throws(
    () => requireResolved(deferredValue("flow.a.width / 100"), "count", "instances are made before layout runs"),
    /instances are made before layout runs.*'flow.a.width'/s,
  );
  assert.equal(requireResolved(deferredValue("3 + 1"), "count", "…"), 4);
});

test("demanding a resolved value is the value", () => {
  assert.equal(demand(42, "x"), 42);
  assert.equal(demand(deferredValue("6 * 7"), "x"), 42);
});

test("a malformed expression is reported against its owner", () => {
  assert.throws(() => deferredValue("1 +"), /unexpected end|1 \+/);
});

// --------------------------------------------------------------- properties

const term = fc.oneof(
  fc.integer({ min: -50, max: 50 }).map(String),
  fc.constantFrom("a", "b", "c"),
);
const expression = fc.tuple(term, fc.constantFrom("+", "-", "*"), term)
  .map(([left, operator, right]) => `${left} ${operator} ${right}`);

test("property: a pending value survives the cloning expansion does", () => {
  // structuredClone is used by both repetition and template expansion. An
  // opaque representation came back as `{}` and was then treated as resolved,
  // which is a silent wrong number rather than an error.
  fc.assert(fc.property(expression, fc.integer({ min: -20, max: 20 }), (source, supplied) => {
    const original = deferredValue(source);
    const cloned = structuredClone({ at: [original, 0] }).at[0];
    assert.deepEqual(cloned, original, "cloning must not change the value");
    const names = scope({ a: supplied, b: supplied + 1, c: supplied + 2 });
    assert.equal(advance(cloned, names), advance(original, names), "and must not change what it resolves to");
  }), { numRuns: RUNS });
});

test("property: resolving in one stage or several gives the same answer", () => {
  // Whether a name arrives early or late must not change the result, or a
  // document's meaning would depend on which stage happened to supply what.
  fc.assert(fc.property(expression, fc.integer({ min: -20, max: 20 }), (source, base) => {
    const names = { a: base, b: base * 2, c: base - 3 };
    const together = advance(deferredValue(source), scope(names));
    const apart = advance(
      advance(advance(deferredValue(source), scope({ a: names.a })), scope({ b: names.b })),
      scope({ c: names.c }),
    );
    assert.equal(apart, together);
  }), { numRuns: RUNS });
});

test("property: advancing with nothing new never changes a value", () => {
  fc.assert(fc.property(expression, (source) => {
    const value = deferredValue(source);
    assert.equal(advance(value, scope({})), value);
  }), { numRuns: RUNS });
});

test("property: a resolved value is never advanced again", () => {
  fc.assert(fc.property(fc.integer({ min: -1000, max: 1000 }), fc.integer(), (resolved, noise) => {
    assert.equal(advance(resolved, scope({ a: noise, b: noise, c: noise })), resolved);
  }), { numRuns: RUNS });
});

// -------------------------------------------------------- through a document

test("names from different stages compose in one expression", () => {
  // Each of these was impossible before the mechanisms were unified: a value
  // could hold a binding, or an index, or a measured box, but never two.
  const source = `diagram "" {
    let card = 100
    let unit = 40
    flow: frame "F" {
      arrange row { gap 40 }
      a: rectangle "A"
      b: rectangle "B"
    }
    both: text "x" { count 2; at = (card + unit * index + flow.a.right, 300) }
  }`;
  const scene = compile(parse(source)).toJSON();
  const placed = ["both.0", "both.1"].map((id) => {
    const found = scene.elements.find((e) => e.id === id);
    assert.ok(found, `expected '${id}'`);
    return (found as unknown as { x: number }).x;
  });
  // The instances differ by exactly `unit`, whatever the layout chose for the
  // box they both refer to.
  assert.equal(placed[1] - placed[0], 40);
});
