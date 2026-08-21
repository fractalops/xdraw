import assert from "node:assert/strict";
import test from "node:test";

import { compilePrepared } from "../src/compile/pipeline.ts";
import { parseSource } from "../src/language/parser.ts";
import { analyzeRelativeCoordinate } from "../src/language/relative-position.ts";
import { requireElementById } from "../test-support/assertions.ts";

function drawing(source: string) {
  return compilePrepared(parseSource(source)).toJSON();
}

test("a node may derive its position from an earlier node instead of guessed coordinates", () => {
  const scene = drawing(`diagram "Relative" {
    a: rectangle "A" { size = (120, 80) }
    b: rectangle "B" { at = (a.bounds.right + 24, a.bounds.top); size = (140, 90) }
  }`);
  const a = requireElementById(scene.elements, "a:frame");
  const b = requireElementById(scene.elements, "b:frame");
  assert.equal(b.x, a.x + a.width + 24);
  assert.equal(b.y, a.y);
});

test("point anchors express relative placement without reconstructing coordinates", () => {
  const scene = drawing(`diagram "Anchors" {
    a: rectangle "A" { size = (120, 80) }
    b: rectangle "B" { at = a.north-east + (24, 0); size = (140, 90) }
  }`);
  const a = requireElementById(scene.elements, "a:frame");
  const b = requireElementById(scene.elements, "b:frame");
  assert.deepEqual([b.x, b.y], [a.x + a.width + 24, a.y]);
});

test("relative positions re-derive when the referenced node changes size", () => {
  const x = (width: number): number => {
    const scene = drawing(`diagram "Relative" {
      a: rectangle "A" { size = (${width}, 80) }
      b: rectangle "B" { at = (a.bounds.right + 24, a.bounds.top); size = (120, 80) }
    }`);
    return requireElementById(scene.elements, "b:frame").x;
  };
  assert.equal(x(240) - x(120), 120);
});

test("relative chains and local container names resolve through the dependency graph", () => {
  const document = parseSource(`diagram "Relative" {
    scope: frame "Scope" {
      arrange row {}
      a: rectangle "A"
      b: rectangle "B" { at = (a.bounds.right + 24, a.bounds.top) }
      c: rectangle "C" { at = (b.bounds.right + 24, b.bounds.top) }
    }
  }`);
  const scope = document.statements.find((statement) => statement.type === "frame");
  assert.ok(scope?.statements);
  const b = scope.statements.find((statement) => statement.type === "node" && statement.id === "scope.b")!;
  assert.deepEqual(b.at, ["(scope.a.bounds.right + 24)", "scope.a.bounds.top"]);

  const scene = compilePrepared(document).toJSON();
  const [aFrame, bFrame, cFrame] = ["a", "b", "c"].map((id) => (
    requireElementById(scene.elements, `scope.${id}:frame`)
  ));
  assert.equal(bFrame.x, aFrame.x + aFrame.width + 24);
  assert.equal(cFrame.x, bFrame.x + bFrame.width + 24);
});

test("relative positions compose with simultaneous size constraints", () => {
  const scene = drawing(`diagram "Relative" {
    a: rectangle "A" { size = (180, 80) }
    b: rectangle "B" { at = (a.bounds.right + 30, a.bounds.top); size = (100, 60) }
    match-size (a, b) width
  }`);
  const a = requireElementById(scene.elements, "a:frame");
  const b = requireElementById(scene.elements, "b:frame");
  assert.equal(b.width, a.width);
  assert.equal(b.x, a.x + a.width + 30);
});

test("a containing frame grows to satisfy a relative gap", () => {
  const scene = drawing(`diagram "Relative growth" {
    scope: frame "Scope" {
      arrange row { gap = 40 }
      a: rectangle "A" { size = (160, 80) }
      b: rectangle "B" { at = (a.bounds.right + 500, a.bounds.top); size = (160, 80) }
    }
  }`);
  const scope = requireElementById(scene.elements, "scope");
  const a = requireElementById(scene.elements, "scope.a:frame");
  const b = requireElementById(scene.elements, "scope.b:frame");
  assert.equal(b.x, a.x + a.width + 500);
  assert.ok(scope.x + scope.width >= b.x + b.width);
  assert.ok(scope.width > 1_120, "the frame should grow beyond its measured layout width");
});

test("constraint-driven growth propagates through container ancestors", () => {
  const scene = drawing(`diagram "Nested growth" {
    outer: frame "Outer" {
      inner: frame "Inner" {
        arrange row { gap = 40 }
        a: rectangle "A" { size = (160, 80) }
        b: rectangle "B" { at = (a.bounds.right + 500, a.bounds.top); size = (160, 80) }
      }
    }
  }`);
  const outer = requireElementById(scene.elements, "outer");
  const inner = requireElementById(scene.elements, "outer.inner");
  const b = requireElementById(scene.elements, "outer.inner.b:frame");
  assert.ok(inner.x + inner.width >= b.x + b.width);
  assert.ok(outer.x + outer.width >= inner.x + inner.width);
});

test("a grown section reflows the following section without moving the document origin", () => {
  const scene = drawing(`diagram "Vertical growth" {
    first: frame "First" {
      arrange column { gap = 40 }
      a: rectangle "A" { size = (160, 80) }
      b: rectangle "B" { at = (a.bounds.left, a.bounds.bottom + 500); size = (160, 80) }
    }
    second: frame "Second" { c: rectangle "C" }
  }`);
  const first = requireElementById(scene.elements, "first");
  const second = requireElementById(scene.elements, "second");
  const a = requireElementById(scene.elements, "first.a:frame");
  const b = requireElementById(scene.elements, "first.b:frame");
  assert.equal(first.y, 86);
  assert.equal(b.y, a.y + a.height + 500);
  assert.ok(second.y >= first.y + first.height + 35);
});

test("compatible cross-container relations resize their destination region", () => {
  const scene = drawing(`diagram "Cross-container" {
    arrange grid { columns = 2; gap = 40 }
    first: frame "First" { a: rectangle "A" }
    second: frame "Second" {
      b: rectangle "B" { at = (first.a.bounds.right + 200, first.a.bounds.top) }
    }
  }`);
  const a = requireElementById(scene.elements, "first.a:frame");
  const b = requireElementById(scene.elements, "second.b:frame");
  const second = requireElementById(scene.elements, "second");
  assert.equal(b.x, a.x + a.width + 200);
  assert.equal(b.y, a.y);
  assert.ok(second.x + second.width >= b.x + b.width);
});

test("a relation contradictory to the containing flow fails explicitly", () => {
  assert.throws(() => drawing(`diagram "Contradictory flow" {
    first: frame "First" { a: rectangle "A" }
    second: frame "Second" {
      b: rectangle "B" { at = (first.a.bounds.right + 200, first.a.bounds.top) }
    }
  }`), /geometry constraints cannot be satisfied together/u);
});

test("forward references form a graph while cycles and invalid relations fail", () => {
  const forward = drawing(`diagram "" {
    b: rectangle "B" { at = (a.bounds.left - 140, a.bounds.top); size = (100, 80) }
    a: rectangle "A"
  }`);
  const a = requireElementById(forward.elements, "a:frame");
  const b = requireElementById(forward.elements, "b:frame");
  assert.deepEqual([b.x, b.y], [a.x - 140, a.y]);
  assert.throws(() => drawing(`diagram "" {
    a: rectangle "A" { at = (a.bounds.right + 20, 100) }
  }`), /XD1272.*relative placement cycle: a -> a/u);
  assert.throws(() => drawing(`diagram "" {
    a: rectangle "A" { at = (b.bounds.left - 20, 100) }
    b: rectangle "B" { at = (a.bounds.right + 20, 100) }
  }`), /XD1272.*relative placement cycle: a -> b -> a/u);
  assert.throws(() => drawing(`diagram "" {
    a: rectangle "A"
    b: rectangle "B" { at = (sin\(a.bounds.right\), a.bounds.top) }
  }`), /XD1272.*linear expressions/u);
  assert.throws(() => drawing(`diagram "" {
    a: rectangle "A"
    b: rectangle "B" { at = (a.bounds.right + 20, a.bounds.top) }
    rotate (a) 15
  }`), /XD1272.*rotated element 'a'/u);
});

test("relative expressions are deterministic clone-safe data", () => {
  const expression = analyzeRelativeCoordinate("x(b.center) + 0.5 * b.bounds.width + 24");
  assert.deepEqual(structuredClone(expression), expression);
  assert.deepEqual(expression, {
    constant: 24,
    terms: [
      { element: "b", part: "left", coefficient: 1 },
      { element: "b", part: "width", coefficient: 1 },
    ],
  });
});

test("rotated children remain inside their containing frame", () => {
  const scene = drawing(`diagram "Rotated containment" {
    panel: frame "Panel" {
      beam: rectangle "Beam" { size = (700, 80) }
      rotate (beam) 45
    }
  }`);
  const panel = requireElementById(scene.elements, "panel");
  const beam = requireElementById(scene.elements, "panel.beam:frame") as typeof panel & { angle: number };
  const cosine = Math.abs(Math.cos(beam.angle));
  const sine = Math.abs(Math.sin(beam.angle));
  const width = beam.width * cosine + beam.height * sine;
  const height = beam.width * sine + beam.height * cosine;
  const centerX = beam.x + beam.width / 2;
  const centerY = beam.y + beam.height / 2;
  const rotated = { x: centerX - width / 2, y: centerY - height / 2, width, height };
  assert.ok(panel.x <= rotated.x);
  assert.ok(panel.y <= rotated.y);
  assert.ok(panel.x + panel.width >= rotated.x + rotated.width);
  assert.ok(panel.y + panel.height >= rotated.y + rotated.height);
});
