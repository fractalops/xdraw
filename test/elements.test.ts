import assert from "node:assert/strict";
import test from "node:test";

import {
  FONT,
  arrow,
  diamond,
  ellipse,
  frame,
  freedraw,
  image,
  rectangle,
  text,
} from "../src/excalidraw/elements.ts";

const bounds = { x: 10, y: 20, width: 120, height: 80 };

test("shape factories emit deterministic shared defaults", () => {
  const first = rectangle("shape", bounds);
  const second = rectangle("shape", bounds);
  assert.deepEqual(first, second);
  assert.equal(first.type, "rectangle");
  assert.equal(first.fillStyle, "solid");
  assert.equal(first.strokeStyle, "solid");
  assert.deepEqual(first.roundness, { type: 3 });
  assert.equal(first.version, 1);
  assert.equal(first.locked, false);
  assert.equal(FONT.bold, 7);
});

test("shape-specific factories preserve names, options, and roundness", () => {
  assert.equal(diamond("decision", bounds).type, "diamond");
  assert.equal(ellipse("actor", bounds).roundness, null);
  const panel = frame("panel", bounds, "Panel", {
    strokeStyle: "dashed",
    backgroundColor: "#ffffff",
    locked: true,
  });
  assert.equal(panel.name, "Panel");
  assert.equal(panel.roundness, null);
  assert.equal(panel.strokeStyle, "dashed");
  assert.equal(panel.locked, true);
  assert.equal(rectangle("square", bounds, { roundness: false }).roundness, null);
});

test("image factory records portable image metadata", () => {
  const element = image("logo", bounds, "file-1", {
    scale: [-1, 1],
    crop: {
      x: 2,
      y: 3,
      width: 40,
      height: 30,
      naturalWidth: 80,
      naturalHeight: 60,
    },
    description: "Product mark",
  });
  assert.equal(element.fileId, "file-1");
  assert.equal(element.status, "saved");
  assert.deepEqual(element.scale, [-1, 1]);
  assert.equal(element.crop.naturalWidth, 80);
  assert.deepEqual(element.customData, { description: "Product mark" });
});

test("image descriptions merge with semantic metadata", () => {
  const element = image("formula", { x: 0, y: 0, width: 80, height: 40 }, "file", {
    description: "Mathematical formula",
    customData: { xdraw: { type: "formula", source: "x^2" } },
  });
  assert.deepEqual(element.customData, {
    description: "Mathematical formula",
    xdraw: { type: "formula", source: "x^2" },
  });
});

test("text accepts object and tuple positions", () => {
  const objectPosition = text("object", { x: 10, y: 20 }, "Hello");
  const tuplePosition = text("tuple", [30, 40], "Hello", {
    fontFamily: FONT.normal,
    textAlign: "center",
    verticalAlign: "middle",
    autoResize: false,
  });
  assert.deepEqual([objectPosition.x, objectPosition.y], [10, 20]);
  assert.deepEqual([tuplePosition.x, tuplePosition.y], [30, 40]);
  assert.equal(tuplePosition.fontFamily, FONT.normal);
  assert.equal(tuplePosition.textAlign, "center");
  assert.equal(tuplePosition.verticalAlign, "middle");
  assert.equal(tuplePosition.autoResize, false);
});

test("linear factories normalize paths and distinguish arrows from lines", () => {
  const flow = arrow("flow", [10, 20], [50, 70], {
    points: [[10, 20], [30, 20], [50, 70]],
    elbowed: true,
    startBinding: { elementId: "source", fixedPoint: [1, 0.5] },
    endBinding: { elementId: "target", fixedPoint: [0, 0.5] },
  });
  assert.equal(flow.type, "arrow");
  assert.deepEqual([flow.x, flow.y, flow.width, flow.height], [10, 20, 40, 50]);
  assert.deepEqual(flow.points, [[0, 0], [20, 0], [40, 50]]);
  assert.equal(flow.elbowed, true);
  assert.equal(flow.endArrowhead, "triangle");
  assert.equal(flow.startIsSpecial, false);

  const line = arrow("line", [0, 0], [0, 100], { type: "line", endArrowhead: "bar" });
  assert.equal(line.type, "line");
  assert.equal(line.endArrowhead, null);
  assert.equal(Object.hasOwn(line, "elbowed"), false);
});

test("freehand factory normalizes points and preserves pressure options", () => {
  const stroke = freedraw("stroke", [100, 200], [[10, 20], [-5, 5], [25, 30]], {
    pressures: [0.2, 0.5, 0.8],
    simulatePressure: false,
    strokeColor: "#7c3aed",
  });
  assert.deepEqual([stroke.x, stroke.y, stroke.width, stroke.height], [95, 205, 30, 25]);
  assert.deepEqual(stroke.points, [[15, 15], [0, 0], [30, 25]]);
  assert.deepEqual(stroke.pressures, [0.2, 0.5, 0.8]);
  assert.equal(stroke.simulatePressure, false);
  assert.equal(stroke.strokeColor, "#7c3aed");
});
