import assert from "node:assert/strict";
import test from "node:test";

import {
  Drawing,
  FONT,
  alignBounds,
  arrow,
  box,
  boundText,
  card,
  column,
  connect,
  distributeBounds,
  inset,
  rectangle,
  row,
  text,
  tone,
  wrapText,
} from "../src/index.ts";
import { measureTextWidth, wrapTextToWidth } from "../src/text/metrics.ts";

test("text defaults to the code font", () => {
  const element = text("label", { x: 10, y: 20 }, "Hello");
  assert.equal(element.fontFamily, FONT.code);
});

test("arrows default to XDraw's solid flow arrowhead", () => {
  const element = arrow("flow", [0, 0], [100, 0]);
  assert.equal(element.strokeStyle, "solid");
  assert.equal(element.endArrowhead, "triangle");
});

test("arrows preserve an explicitly absent arrowhead", () => {
  const element = arrow("lifeline", [0, 0], [0, 100], { endArrowhead: null });
  assert.equal(element.endArrowhead, null);
});

test("connect composes an arrow and optional label", () => {
  const from = box(0, 0, 100, 50);
  const to = box(200, 0, 100, 50);
  const elements = connect("edge", from, to, { label: "moves" });
  assert.deepEqual(elements.map((element) => element.type), ["arrow", "text"]);
  assert.equal(elements[0].points[1][0], 100);
});

test("connect rejects paths that cannot form a segment", () => {
  const from = box(0, 0, 100, 50);
  const to = box(200, 0, 100, 50);
  assert.throws(() => connect("empty", from, to, { points: [], label: "moves" }), /at least two points/);
  assert.throws(() => connect("single", from, to, { points: [[0, 0]], endLabel: "target" }), /at least two points/);
});

test("tone rejects prototype names and invalid overrides", () => {
  assert.throws(() => tone("toString"), /unknown tone/);
  assert.throws(() => tone("info", { stroke: undefined }), /must be a non-empty color string/);
  assert.throws(() => tone("info", { background: "" }), /must be a non-empty color string/);
});

test("wrapText splits long hyphenated labels", () => {
  assert.equal(wrapText("Candidate-only", 10), "Candidate-\nonly");
});

test("wide Unicode text wraps by grapheme width", () => {
  const width = 72;
  const wrapped = wrapTextToWidth("日本語の説明🙂日本語", width, 18);
  assert.ok(wrapped.includes("\n"));
  assert.ok(wrapped.split("\n").every((line) => measureTextWidth(line, 18) <= width));
});

test("row creates equal deterministic boxes", () => {
  assert.deepEqual(row(box(0, 0, 320, 50), 3, 10), [
    box(0, 0, 100, 50),
    box(110, 0, 100, 50),
    box(220, 0, 100, 50),
  ]);
});

test("layout helpers reject geometry that cannot contain positive children", () => {
  assert.throws(() => row(box(0, 0, 1, 1), 2, 1), /positive child width/);
  assert.throws(() => column(box(0, 0, 1, 1), 2, 1), /positive child height/);
  assert.throws(() => inset(box(0, 0, 1, 1), 1), /positive width and height/);
  assert.throws(() => row(box(0, 0, Number.NaN, 1), 1), /finite numbers/);
  assert.throws(() => column(box(0, 0, 1, 1), 1, -1), /non-negative finite number/);
  assert.throws(() => inset(box(0, 0, 1, 1), Number.POSITIVE_INFINITY), /non-negative finite number/);
});

test("alignBounds supports Excalidraw edge and center alignments", () => {
  const bounds = [box(10, 20, 40, 30), box(100, 80, 20, 50)];
  assert.deepEqual(alignBounds(bounds, "left").map((item) => item.x), [10, 10]);
  assert.deepEqual(alignBounds(bounds, "right").map((item) => item.x + item.width), [120, 120]);
  assert.deepEqual(alignBounds(bounds, "center-x").map((item) => item.x + item.width / 2), [65, 65]);
  assert.deepEqual(alignBounds(bounds, "top").map((item) => item.y), [20, 20]);
  assert.deepEqual(alignBounds(bounds, "bottom").map((item) => item.y + item.height), [130, 130]);
  assert.deepEqual(alignBounds(bounds, "center-y").map((item) => item.y + item.height / 2), [75, 75]);
});

test("distributeBounds equalizes gaps and falls back to centers for overlaps", () => {
  const horizontal = distributeBounds([
    box(0, 0, 20, 10), box(90, 0, 40, 10), box(250, 0, 30, 10),
  ], "x");
  assert.equal(horizontal[1].x - (horizontal[0].x + horizontal[0].width), 95);
  assert.equal(horizontal[2].x - (horizontal[1].x + horizontal[1].width), 95);

  const overlapping = distributeBounds([
    box(0, 0, 100, 10), box(30, 0, 100, 10), box(60, 0, 100, 10),
  ], "x");
  assert.deepEqual(overlapping.map((item) => item.x + item.width / 2), [50, 80, 110]);
});

test("distributeBounds is byte-stable when applied repeatedly", () => {
  const bounds = [
    box(0, 0, 1, 1),
    box(13, 0, 1, 1),
    box(0, 0, 25, 1),
    box(337, 0, 1, 1),
  ];
  const once = distributeBounds(bounds, "x");
  assert.deepEqual(distributeBounds(once, "x"), once);
});

test("overlapping mixed-size bounds do not change distribution modes on repetition", () => {
  const bounds = [
    box(0, 0, 1, 272),
    box(0, 0, 1, 194),
    box(0, 0, 1, 183),
    box(0, 0, 1, 3),
    box(0, -450, 1, 294),
    box(0, 0, 1, 4),
    box(0, 499, 1, 1),
  ];
  const once = distributeBounds(bounds, "y");
  assert.deepEqual(distributeBounds(once, "y"), once);
});

test("distribution lands the final edge exactly when the gap does not terminate", () => {
  // Ten items spanning -1669..698 give a gap of 106.44444... Accumulating that
  // nine times drifts the last edge to 697.999999999999, which changes the gap
  // on a second pass. Positions are derived from the index instead.
  const bounds = [
    box(0, 0, 1, 1), box(0, 0, 1, 1), box(0, 0, 1, 1), box(0, 0, 1, 1), box(0, 0, 1, 1),
    box(0, 0, 1, 698), box(0, 0, 1, 3), box(0, 0, 1, 698), box(0, 0, 1, 4), box(0, -1669, 1, 1),
  ];
  const once = distributeBounds(bounds, "y");
  assert.deepEqual(distributeBounds(once, "y"), once);
  const lowest = Math.min(...once.map((item) => item.y));
  const highest = Math.max(...once.map((item) => item.y + item.height));
  assert.equal(lowest, -1669);
  assert.equal(highest, 698);
});

test("card creates a frame with title and body", () => {
  const elements = card("summary", box(0, 0, 300, 150), {
    tone: "info",
    title: "Result",
    body: "The comparison completed.",
  });
  assert.deepEqual(elements.map((element) => element.id), [
    "summary:frame",
    "summary:title",
    "summary:body",
  ]);
});

test("boundText emits native container alignment metadata", () => {
  const label = boundText("label", "shape", box(10, 20, 180, 80), "Bound label", {
    textAlign: "right",
    verticalAlign: "bottom",
  });
  assert.equal(label.containerId, "shape");
  assert.equal(label.textAlign, "right");
  assert.equal(label.verticalAlign, "bottom");
  assert.equal(label.autoResize, true);
  assert.ok(label.x + label.width <= 190);
  assert.ok(label.y + label.height <= 100);
});

test("drawing rejects one-sided text bindings", () => {
  const drawing = new Drawing().add(
    rectangle("shape", box(0, 0, 100, 60)),
    text("label", { x: 10, y: 10 }, "Label", { containerId: "shape" }),
  );
  assert.throws(() => drawing.toJSON(), /not registered by container/);
});

test("drawing output is deterministic and rejects duplicate ids", () => {
  const first = new Drawing().add(text("one", { x: 0, y: 0 }, "One"));
  const second = new Drawing().add(text("one", { x: 0, y: 0 }, "One"));
  assert.deepEqual(first.toJSON(), second.toJSON());

  const invalid = new Drawing().add(
    text("duplicate", { x: 0, y: 0 }, "One"),
    text("duplicate", { x: 10, y: 10 }, "Two"),
  );
  assert.throws(() => invalid.toJSON(), /duplicate element id/);
});

test("drawing rejects non-positive shape dimensions", () => {
  const drawing = new Drawing().add(rectangle("bad", { x: 0, y: 0, width: -1, height: 20 }));
  assert.throws(() => drawing.toJSON(), /must have positive width and height/);
});
