import assert from "node:assert/strict";
import test from "node:test";

import { parse } from "../src/index.ts";
import { compilePrepared as compile } from "../src/compile/pipeline.ts";
import { measureRouteQuality } from "../src/routing/quality.ts";
import { budgetMs } from "../test-support/budget.ts";
import { requireArrow, requireElementById } from "../test-support/assertions.ts";
import type { DrawingElement, LinearElement } from "../src/contracts/render.ts";
import type { Point, Route } from "../src/contracts/foundation.ts";

function elements(source: string): DrawingElement[] {
  return compile(parse(source)).toJSON().elements;
}

function requireLinear(elements: readonly DrawingElement[], id: string): LinearElement {
  const element = requireElementById(elements, id);
  assert.ok(element.type === "arrow" || element.type === "line", `expected linear element ${id}`);
  return element;
}

test("conflicting positional constraints fail instead of depending on source order", () => {
  assert.throws(() => elements(`diagram "Transforms" {
    a: rectangle "A" { at = (80, 80); size = (180, 90) }
    b: rectangle "B" { at = (360, 80); size = (240, 120) }
    offset (b) by (13, 17)
    match-size (a, b) both
    snap (b) to 20
    rotate (b) 90
  }`), /geometry constraints cannot be satisfied together/u);
});

test("compatible linear constraints solve before rotation", () => {
  const result = elements(`diagram "Transforms" {
    a: rectangle "A" { at = (80, 80); size = (180, 90) }
    b: rectangle "B" { at = (360, 80); size = (240, 120) }
    match-size (a, b) both
    align top (a, b)
    rotate (b) 90
  }`);
  const a = requireElementById(result, "a:frame");
  const b = requireElementById(result, "b:frame");
  assert.deepEqual([b.width, b.height], [a.width, a.height]);
  assert.equal(b.y, a.y);
  assert.equal(b.angle, Math.PI / 2);
});

test("invalid geometry policies fail with semantic diagnostics", () => {
  assert.throws(() => compile(parse('diagram "Bad" { a: rectangle "A"; snap (a) to 0 }')), /snap grid must be positive/);
  assert.throws(() => compile(parse('diagram "Bad" { a: rectangle "A"; match-size (a) depth }')), /unsupported size axis/);
  assert.throws(
    () => compile(parse('diagram "Bad" { caption: text "Caption" { at = (0, 0) }; offset (caption) by (1, 1) }')),
    /geometry operations require node or movable code targets; 'caption' is text/,
  );
  assert.throws(
    () => compile(parse('diagram "Bad" { f: frame "F" { a: rectangle "A" }; offset (f) by (1, 1) }')),
    /geometry operations require node or movable code targets; 'f' is frame/,
  );
  assert.throws(
    () => compile(parse('diagram "Bad" { sample: code "value"; match-size (sample, sample) both }')),
    /match-size does not support code targets/,
  );
  assert.throws(
    () => compile(parse('diagram "Bad" { a: rectangle "A"; b: rectangle "B"; align diagonal (a, b) }')),
    /unsupported alignment mode 'diagonal'/,
  );
  assert.throws(
    () => compile(parse('diagram "Bad" { a: rectangle "A"; b: rectangle "B"; distribute x (a, b) }')),
    /distribution requires at least three nodes/,
  );
});

test("match-size constrains local bounds before rotation", () => {
  const result = elements(`diagram "Rotated resize" {
    reference: rectangle "Reference" { at = (40, 40); size = (180, 90) }
    target: rectangle "Target" { at = (360, 40); size = (240, 120) }
    rotate (target) 90
    match-size (reference, target) both
  }`);
  const reference = requireElementById(result, "reference:frame");
  const target = requireElementById(result, "target:frame");
  assert.deepEqual([target.width, target.height], [reference.width, reference.height]);
  assert.equal(target.angle, Math.PI / 2);
});

test("match-size scales compound line points with their element bounds", () => {
  const base = elements(`use "xdraw/architecture" as arch
    diagram "Base" { person: arch.person "Person" { size = (200, 160) } }`);
  const resized = elements(`use "xdraw/architecture" as arch
    diagram "Resized" {
      reference: arch.person "Reference" { size = (400, 320) }
      person: arch.person "Person" { size = (200, 160) }
      match-size (reference, person) both
    }`);
  const baseArms = requireLinear(base, "person:arms");
  const resizedArms = requireLinear(resized, "person:arms");
  assert.equal(resizedArms.width, baseArms.width * 2);
  assert.deepEqual(resizedArms.points, baseArms.points.map(([x, y]) => [x * 2, y * 2]));
});

test("anisotropic size constraints remain representable before arbitrary rotation", () => {
  const result = elements(`diagram "Supported resize" {
      reference: rectangle "Reference" { size = (200, 100) }
      target: rectangle "Target" { size = (100, 100) }
      rotate (target) 45
      match-size (reference, target) both
    }`);
  const reference = requireElementById(result, "reference:frame");
  const target = requireElementById(result, "target:frame");
  assert.deepEqual([target.width, target.height], [reference.width, reference.height]);
  assert.equal(target.angle, Math.PI / 4);
});

test("rotation moves rich-card parts around one semantic centre", () => {
  const base = elements('diagram "Base" { a: rectangle "A" { body = "Body" } }');
  const rotated = elements('diagram "Rotated" { a: rectangle "A" { body = "Body" }; rotate (a) 90 }');
  const baseFrame = requireElementById(base, "a:frame");
  const baseBody = requireElementById(base, "a:body");
  const frame = requireElementById(rotated, "a:frame");
  const body = requireElementById(rotated, "a:body");
  const baseVector = [
    baseBody.x + baseBody.width / 2 - (baseFrame.x + baseFrame.width / 2),
    baseBody.y + baseBody.height / 2 - (baseFrame.y + baseFrame.height / 2),
  ];
  const rotatedVector = [
    body.x + body.width / 2 - (frame.x + frame.width / 2),
    body.y + body.height / 2 - (frame.y + frame.height / 2),
  ];
  assert.ok(Math.abs(rotatedVector[0] + baseVector[1]) < 1e-9);
  assert.ok(Math.abs(rotatedVector[1] - baseVector[0]) < 1e-9);
});

test("layered layout is deterministic and separates graph ranks", () => {
  const source = `diagram "Layered" {
    arrange layered { gap = 28 }
    a: rectangle "A"
    b: rectangle "B"
    c: rectangle "C"
    a -> b
    b -> c
  }`;
  const first = compile(parse(source)).toJSON();
  const second = compile(parse(source)).toJSON();
  assert.deepEqual(first, second);
  const frames = ["a", "b", "c"].map((id) => requireElementById(first.elements, `${id}:frame`));
  assert.ok(frames[0].x < frames[1].x && frames[1].x < frames[2].x);
  const arrows = first.elements.filter((element) => element.type === "arrow");
  assert.equal(arrows.length, 2);
  assert.ok(arrows.every((arrow) => arrow.elbowed && arrow.points.length === 4));
});

test("layered layout preserves dotted identifiers and explicit ports", () => {
  const result = elements(`diagram "Dotted" {
    arrange layered {}
    service.api: rectangle "API"
    service.db: rectangle "DB"
    service.api@east -> service.db@west
  }`);
  const api = requireElementById(result, "service.api:frame");
  const database = requireElementById(result, "service.db:frame");
  assert.ok(api.x < database.x);
});

test("layered layout places cyclic graphs deterministically", () => {
  const source = `diagram "Cycle" {
    arrange layered {}
    a: rectangle "A"
    b: rectangle "B"
    a -> b
    b -> a
  }`;
  const first = compile(parse(source)).toJSON();
  const second = compile(parse(source)).toJSON();
  assert.deepEqual(first, second);
  const frames = ["a", "b"].map((id) => requireElementById(first.elements, `${id}:frame`));
  assert.equal(frames[0].x, frames[1].x);
  assert.ok(frames[0].y + frames[0].height <= frames[1].y);
});

test("layered layout routes long edges around intermediate ranks", () => {
  const result = compile(parse(`diagram "Long edge" {
    arrange layered {}
    a: rectangle "A"
    b: rectangle "B"
    c: rectangle "C"
    a -> b
    b -> c
    a -> c
  }`)).toJSON();
  const direct = requireLinear(result.elements, "document:connection:2:0");
  const route = direct.points.map(([x, y]): Point => [x + direct.x, y + direct.y]) as Route;
  const intermediate = requireElementById(result.elements, "b:frame");
  assert.equal(measureRouteQuality([route], [intermediate]).obstacleIntersections, 0);
});

test("layered layout raises undersized gaps so connectors remain visible", () => {
  const drawing = compile(parse(`diagram "Small gap" {
    arrange layered { gap = 0 }
    a: rectangle "A"
    b: rectangle "B"
    a -> b
  }`));
  const result = drawing.toJSON();
  const route = requireArrow(result.elements).points;
  assert.ok(new Set(route.map(([x, y]) => `${x}:${y}`)).size >= 2);
  assert.ok(drawing.diagnostics.some((item) => item.code === "XD2001"));
});

test("flat layered layout rejects nested diagrams before placement", () => {
  assert.throws(
    () => compile(parse('diagram "Nested" { arrange layered {}; f: frame "F" { a: rectangle "A" } }')),
    /layered layout cannot draw nested containers/,
  );
});

for (const count of [10, 50, 200]) {
  test(`layered layout places ${count} nodes within its acceptance budget`, () => {
    const nodes = Array.from({ length: count }, (_, index) => `n${index}: rectangle "Node ${index}"`).join("\n");
    const edges = Array.from({ length: count - 1 }, (_, index) => `n${Math.floor(index / 2)} -> n${index + 1}`).join("\n");
    const source = `diagram "Scale ${count}" { arrange layered { gap = 12 } ${nodes} ${edges} }`;
    const started = performance.now();
    const result = compile(parse(source)).toJSON();
    const elapsed = performance.now() - started;
    const frames = result.elements.filter((element) => element.id.endsWith(":frame"));
    assert.equal(frames.length, count);
    for (let left = 0; left < frames.length; left += 1) {
      for (let right = left + 1; right < frames.length; right += 1) {
        const leftFrame = frames[left];
        const rightFrame = frames[right];
        assert.ok(leftFrame && rightFrame);
        const overlap = leftFrame.x < rightFrame.x + rightFrame.width
          && leftFrame.x + leftFrame.width > rightFrame.x
          && leftFrame.y < rightFrame.y + rightFrame.height
          && leftFrame.y + leftFrame.height > rightFrame.y;
        assert.equal(overlap, false);
      }
    }
    assert.ok(elapsed < budgetMs(3_000), `${count}-node compile took ${elapsed.toFixed(1)} ms`);
    assert.ok(Math.max(...frames.map((frame) => frame.x + frame.width)) < 10_000);
    assert.ok(Math.max(...frames.map((frame) => frame.y + frame.height)) < 30_000);
  });
}
