// `let` in a document. The resolver's own contract is in test/bindings.test.ts;
// what matters here is that a bound name reaches the places a number is written,
// including an expression that still has a variable of its own to be bound.
import assert from "node:assert/strict";
import test from "node:test";

import { parse } from "../src/index.ts";
import { compilePrepared as compile } from "../src/compile/pipeline.ts";

const element = (source: string, id: string) => {
  const found = compile(parse(source)).toJSON().elements.find((e) => e.id === id);
  assert.ok(found, `expected an element '${id}'`);
  return found as unknown as Record<string, number | string>;
};

test("a bound name reaches a numeric property", () => {
  const source = `diagram "" {
    let base = 3
    let emphasis = base * 2
    a: rectangle "A" { at = (60, 200); stroke-width = base }
    b: rectangle "B" { at = (60, 400); stroke-width = emphasis }
  }`;
  assert.equal(element(source, "a:frame").strokeWidth, 3);
  assert.equal(element(source, "b:frame").strokeWidth, 6);
});

test("a bound point composes as one value", () => {
  const source = `diagram "" {
    let origin = (20, 30)
    let offset = (12, -8)
    mark: text "M" { at = origin + 2 * offset }
  }`;
  const mark = element(source, "mark");
  assert.deepEqual([mark.x, mark.y], [44, 14]);
});

test("a bound name folds into an expression that keeps its own variable", () => {
  // The curve's `t` is bound by the sampler, not by the document, so the fold
  // has to replace `radius` and leave `t` alone rather than refusing.
  const source = `use "xdraw/math" as math

  diagram "" {
    let radius = 60
    mark: math.plot { at = (0, 0); x = radius * cos(t); y = radius * sin(t); t in [0, tau] }
  }`;
  const mark = element(source, "mark:stroke");
  assert.equal(Math.round(Number(mark.width)), 120, "a circle of the bound radius");
  assert.equal(Math.round(Number(mark.height)), 120);
});

test("an expression works whether or not the document binds anything", () => {
  // The fold pass used to return early when a document declared no bindings,
  // which left every `=` expression unfolded — so `at = (100, 200)` failed in a
  // document with no `let` and succeeded in one with an unused binding. A
  // property's validity must not depend on an unrelated statement elsewhere.
  const plain = `diagram "" { a: rectangle "A" { at = (10, 20); stroke-width = 2 + 2 } }`;
  const bound = `diagram "" {
    let unused = 1
    a: rectangle "A" { at = (10, 20); stroke-width = 2 + 2 }
  }`;
  for (const source of [plain, bound]) {
    const box = element(source, "a:frame");
    assert.equal(box.x, 10);
    assert.equal(box.y, 20);
    assert.equal(box.strokeWidth, 4);
  }
});

test("a document that uses neither bindings nor expressions is untouched", () => {
  const source = `diagram "" { a: rectangle "A" { at = (10, 20); stroke-width = 4 } }`;
  assert.equal(element(source, "a:frame").strokeWidth, 4);
});

test("bindings resolve by dependency, not by the order they are written", () => {
  const forwards = `diagram "" {
    let a = 2
    let b = a * 5
    x: rectangle "X" { at = (0, 0); stroke-width = b }
  }`;
  const backwards = `diagram "" {
    let b = a * 5
    let a = 2
    x: rectangle "X" { at = (0, 0); stroke-width = b }
  }`;
  assert.equal(element(forwards, "x:frame").strokeWidth, 10);
  assert.equal(element(backwards, "x:frame").strokeWidth, 10);
});

test("a document error names the binding it belongs to", () => {
  const document = (bindings: string) => `diagram "" {
    ${bindings}
    x: rectangle "X" { at = (0, 0) }
  }`;
  assert.throws(() => parse(document("let a = b + 1\n    let b = a + 1")), /a -> b -> a/);
  assert.throws(() => parse(document("let a = a + 1")), /a -> a/);
  assert.throws(() => parse(document("let a = 1\n    let a = 2")), /'a' is bound more than once/);
  assert.throws(() => parse(document("let a = 1 / 0")), /'a' is not finite/);
});

test("unused bindings still validate the closed function vocabulary", () => {
  for (const binding of ["let p = along(curve)", "let p = nonsense(curve)"]) {
    assert.throws(
      () => parse(`diagram "" { ${binding}; box: rectangle "B" }`),
      /not a valid expression.*(?:takes 2 arguments|unknown function)/u,
    );
  }
});

test("a computed point may break across lines", () => {
  // Specification §7.2 says line breaks are insignificant, and this was the one
  // place they were not — in the construct most likely to grow long enough to
  // want wrapping.
  const wrapped = `diagram "" {
    let m = 10
    a: text "A" {
      at = (m + 5,
            m + 9)
    }
  }`;
  const oneLine = `diagram "" {
    let m = 10
    a: text "A" { at = (m + 5, m + 9) }
  }`;
  const boxOf = (source: string) => {
    const found = compile(parse(source)).toJSON().elements.find((e) => e.id === "a");
    assert.ok(found, "expected the text element");
    return found as unknown as { x: number; y: number };
  };
  assert.deepEqual(boxOf(wrapped), boxOf(oneLine), "wrapping must not change the meaning");
  assert.equal(boxOf(wrapped).x, 15);
});

test("an incomplete expression runs into the statement after it", () => {
  // An expression has no closing delimiter — it ends where the grammar ends it
  // — so `let a = 1 +` continues onto the next line and takes the following
  // declaration's name as its right operand. The document is still rejected,
  // but the complaint lands on the statement that got eaten rather than on the
  // expression that was left unfinished. That is the cost of not delimiting.
  const source = `diagram "" {
    let a = 1 +
    x: rectangle "X" { at = (0, 0) }
  }`;
  assert.throws(() => parse(source), /expected a statement/);
});

test("'let' without a name or an expression says so", () => {
  assert.throws(() => parse(`diagram "" { let }`), /expected a name after 'let'/);
  assert.throws(() => parse(`diagram "" { let a }`), /expected '=' after binding 'a'/);
});
