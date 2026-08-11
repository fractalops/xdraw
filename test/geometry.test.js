import assert from "node:assert/strict";
import test from "node:test";

import { compile, parse } from "../src/index.ts";

function elements(source) {
  return compile(parse(source)).toJSON().elements;
}

test("geometry transforms compose in source order", () => {
  const result = elements(`diagram "Transforms" {
    lane flow "Flow" {
      a: card "A" size (180, 90)
      b: card "B" size (240, 120)
      offset (b) by (13, 17)
      match-size (a, b) both
      snap (b) to 20
      rotate (b) 90
    }
  }`);
  const a = result.find((element) => element.id === "a:frame");
  const b = result.find((element) => element.id === "b:frame");
  assert.deepEqual([b.width, b.height], [a.width, a.height]);
  assert.equal(b.x % 20, 0);
  assert.equal(b.y % 20, 0);
  assert.equal(b.angle, Math.PI / 2);
});

test("invalid geometry policies fail with semantic diagnostics", () => {
  assert.throws(() => compile(parse('diagram "Bad" { a: card "A" snap (a) to 0 }')), /snap grid must be positive/);
  assert.throws(() => compile(parse('diagram "Bad" { a: card "A" match-size (a) depth }')), /unsupported size axis/);
  assert.throws(
    () => compile(parse('diagram "Bad" { text caption "Caption" at (0, 0) offset (caption) by (1, 1) }')),
    /geometry operations require node targets; 'caption' is text/,
  );
  assert.throws(
    () => compile(parse('diagram "Bad" { frame f "F" { a: card "A" } offset (f) by (1, 1) }')),
    /geometry operations require node targets; 'f' is frame/,
  );
});

test("rotation moves rich-card parts around one semantic centre", () => {
  const base = elements('diagram "Base" { lane l "L" { a: card "A" { body "Body" } } }');
  const rotated = elements('diagram "Rotated" { lane l "L" { a: card "A" { body "Body" } rotate (a) 90 } }');
  const baseFrame = base.find((element) => element.id === "a:frame");
  const baseBody = base.find((element) => element.id === "a:body");
  const frame = rotated.find((element) => element.id === "a:frame");
  const body = rotated.find((element) => element.id === "a:body");
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
    layout layered gap 28
    a: card "A"
    b: card "B"
    c: card "C"
    a -> b
    b -> c
  }`;
  const first = compile(parse(source)).toJSON();
  const second = compile(parse(source)).toJSON();
  assert.deepEqual(first, second);
  const frames = ["a", "b", "c"].map((id) => first.elements.find((element) => element.id === `${id}:frame`));
  assert.ok(frames[0].x < frames[1].x && frames[1].x < frames[2].x);
  const arrows = first.elements.filter((element) => element.type === "arrow");
  assert.equal(arrows.length, 2);
  assert.ok(arrows.every((arrow) => arrow.elbowed && arrow.points.length === 4));
});

test("layered layout preserves dotted identifiers and explicit ports", () => {
  const result = elements(`diagram "Dotted" {
    layout layered
    service.api: system "API"
    service.db: database "DB"
    service.api.east -> service.db.west
  }`);
  const api = result.find((element) => element.id === "service.api:frame");
  const database = result.find((element) => element.id === "service.db:frame");
  assert.ok(api.x < database.x);
});

test("flat layered layout rejects nested diagrams before placement", () => {
  assert.throws(
    () => compile(parse('diagram "Nested" { layout layered frame f "F" { a: card "A" } }')),
    /layered layout cannot draw nested containers/,
  );
});

for (const count of [10, 50, 200]) {
  test(`layered layout places ${count} nodes within its acceptance budget`, () => {
    const nodes = Array.from({ length: count }, (_, index) => `n${index}: card "Node ${index}"`).join("\n");
    const edges = Array.from({ length: count - 1 }, (_, index) => `n${Math.floor(index / 2)} -> n${index + 1}`).join("\n");
    const source = `diagram "Scale ${count}" { layout layered gap 12 ${nodes} ${edges} }`;
    const started = performance.now();
    const result = compile(parse(source)).toJSON();
    const elapsed = performance.now() - started;
    const frames = result.elements.filter((element) => element.id.endsWith(":frame"));
    assert.equal(frames.length, count);
    for (let left = 0; left < frames.length; left += 1) {
      for (let right = left + 1; right < frames.length; right += 1) {
        const overlap = frames[left].x < frames[right].x + frames[right].width
          && frames[left].x + frames[left].width > frames[right].x
          && frames[left].y < frames[right].y + frames[right].height
          && frames[left].y + frames[left].height > frames[right].y;
        assert.equal(overlap, false);
      }
    }
    assert.ok(elapsed < 3_000, `${count}-node compile took ${elapsed.toFixed(1)} ms`);
    assert.ok(Math.max(...frames.map((frame) => frame.x + frame.width)) < 10_000);
    assert.ok(Math.max(...frames.map((frame) => frame.y + frame.height)) < 30_000);
  });
}
