import assert from "node:assert/strict";
import test from "node:test";

import { compile, parse } from "../src/index.ts";
import { MAX_FREEDRAW_POINTS } from "../src/freedraw-policy.ts";

function drawing(source) {
  return compile(parse(source)).toJSON();
}

test("freedraw compiles to an editable Excalidraw freehand element", () => {
  const scene = drawing(`diagram "" {
    mark: freedraw {
      at (100, 80)
      points ((0, 20), (30, 0), (70, 45))
      stroke "#2563eb"
      stroke-width 6
      roughness 1
      fill-style hachure
    }
  }`);
  const mark = scene.elements.find((element) => element.id === "mark:stroke");

  assert.equal(mark.type, "freedraw");
  assert.deepEqual([mark.x, mark.y, mark.width, mark.height], [100, 80, 70, 45]);
  assert.deepEqual(mark.points, [[0, 20], [30, 0], [70, 45]]);
  assert.deepEqual(mark.pressures, []);
  assert.equal(mark.simulatePressure, true);
  assert.equal(mark.lastCommittedPoint, null);
  assert.equal(mark.strokeColor, "#2563eb");
  assert.equal(mark.strokeWidth, 6);
  assert.equal(mark.roughness, 1);
  assert.equal(mark.fillStyle, "hachure");
});

test("freedraw normalizes negative local points without changing their absolute path", () => {
  const scene = drawing(`diagram "" {
    mark: freedraw { at (100, 80); points ((10, 10), (-20, 30), (40, -10)) }
  }`);
  const mark = scene.elements.find((element) => element.id === "mark:stroke");
  assert.deepEqual([mark.x, mark.y, mark.width, mark.height], [80, 70, 60, 40]);
  assert.deepEqual(mark.points, [[30, 20], [0, 40], [60, 0]]);
});

test("freedraw preserves explicit pressure samples", () => {
  const scene = drawing(`diagram "" {
    mark: freedraw {
      at (0, 0)
      points ((0, 0), (20, 10), (40, 0))
      pressures (0.2, 0.8, 0.4)
      simulate-pressure false
    }
  }`);
  const mark = scene.elements.find((element) => element.id === "mark:stroke");
  assert.deepEqual(mark.pressures, [0.2, 0.8, 0.4]);
  assert.equal(mark.simulatePressure, false);
});

test("freedraw supports movement geometry but rejects size matching", () => {
  const scene = drawing(`diagram "" {
    a: freedraw { at (13, 17); points ((0, 0), (20, 10)) }
    b: freedraw { at (80, 90); points ((0, 0), (30, 20)) }
    align top (a, b)
    offset (a) by (7, 3)
    snap (a) to 10
    rotate (b) 90
  }`);
  const a = scene.elements.find((element) => element.id === "a:stroke");
  const b = scene.elements.find((element) => element.id === "b:stroke");
  assert.equal(a.x % 10, 0);
  assert.equal(a.y % 10, 0);
  assert.equal(b.angle, Math.PI / 2);
  assert.throws(
    () => drawing(`diagram "" {
      a: freedraw { at (0, 0); points ((0, 0), (20, 10)) }
      b: freedraw { at (40, 0); points ((0, 0), (20, 10)) }
      match-size (a, b) both
    }`),
    /match-size does not support freedraw targets/,
  );
});

test("freedraw validates geometry, pressures, and point budgets", () => {
  assert.throws(
    () => drawing('diagram "" { mark: freedraw { at (0, 0); points ((1, 1), (1, 1)) } }'),
    /at least two distinct points/,
  );
  assert.throws(
    () => drawing(`diagram "" {
      mark: freedraw {
        at (0, 0)
        points ((0, 0), (10, 10), (20, 0))
        pressures (0.2, 0.8)
      }
    }`),
    /one value from 0 to 1 per point/,
  );
  const points = Array.from({ length: MAX_FREEDRAW_POINTS + 1 }, (_, index) => `(${index}, ${index % 2})`).join(", ");
  assert.throws(
    () => drawing(`diagram "" { mark: freedraw { at (0, 0); points (${points}) } }`),
    new RegExp(`at most ${MAX_FREEDRAW_POINTS} points`),
  );
});
