import assert from "node:assert/strict";
import test from "node:test";

import { compile } from "../src/compiler.js";
import { parse } from "../src/parser.js";
import { measureTextWidth } from "../src/text-metrics.js";

test("font-aware metrics distinguish proportional and code fonts", () => {
  assert.ok(measureTextWidth("W", 20, 1) > measureTextWidth("i", 20, 1));
  assert.ok(measureTextWidth("W", 20, 2) > measureTextWidth("i", 20, 2));
  assert.equal(measureTextWidth("W", 20, 3), measureTextWidth("i", 20, 3));
});

test("spacing presets express layout density without numeric geometry", () => {
  const tight = compile(parse(`diagram "Spacing" {
    lane flow "Flow" {
      layout row spacing tight
      a: card "A"
      b: card "B"
    }
  }`)).toJSON();
  const airy = compile(parse(`diagram "Spacing" {
    lane flow "Flow" {
      layout row spacing airy
      a: card "A"
      b: card "B"
    }
  }`)).toJSON();
  const tightA = tight.elements.find((item) => item.id === "a:frame");
  const tightB = tight.elements.find((item) => item.id === "b:frame");
  const airyA = airy.elements.find((item) => item.id === "a:frame");
  const airyB = airy.elements.find((item) => item.id === "b:frame");
  assert.ok(airyB.x - (airyA.x + airyA.width) > tightB.x - (tightA.x + tightA.width));
});

test("numeric gaps remain compatible but report automatic correction", () => {
  const drawing = compile(parse(`diagram "Warnings" {
    lane flow "Flow" {
      layout row gap 8
      a: card "A"
      b: card "B"
      a -> b "a connector label"
    }
  }`));
  assert.ok(drawing.diagnostics.some((item) => item.code === "XD2001" && item.severity === "warning"));
  drawing.toJSON();
});

test("container notes participate in layout without manual coordinates", () => {
  const result = compile(parse(`diagram "Notes" {
    lane flow "Flow" {
      a: card "A"
      note caveat "This applies to the whole flow."
    }
  }`)).toJSON();
  const lane = result.elements.find((item) => item.id === "flow:frame");
  const note = result.elements.find((item) => item.id === "caveat:frame");
  assert.ok(note.x >= lane.x && note.y >= lane.y);
  assert.ok(note.x + note.width <= lane.x + lane.width);
  assert.ok(note.y + note.height <= lane.y + lane.height);
});

test("decision branches lower to labeled routed connections", () => {
  const result = compile(parse(`diagram "Decision" {
    lane flow "Flow" {
      gate: decision "Approved?" {
        when "yes" -> release
        when "no" -> revise
      }
      release: card "Release"
      revise: card "Revise"
    }
  }`)).toJSON();
  const labels = result.elements.filter((item) => item.type === "text").map((item) => item.text);
  assert.ok(labels.includes("yes"));
  assert.ok(labels.includes("no"));
  assert.equal(result.elements.filter((item) => item.type === "arrow").length, 2);
});

test("routing escape hatches emit compatibility warnings", () => {
  const drawing = compile(parse(`diagram "Routing" {
    a: card "A" at (100, 100)
    b: card "B" at (500, 100)
    a.east -> b.west [via="340,155"]
  }`));
  assert.ok(drawing.diagnostics.some((item) => item.code === "XD2003"));
  assert.ok(drawing.diagnostics.some((item) => item.code === "XD2002"));
});

test("route-around constraints bind to semantic obstacle ids", () => {
  const result = compile(parse(`diagram "Routing" {
    a: card "A" at (100, 100)
    obstacle: card "Obstacle" at (380, 80) size (220, 150)
    b: card "B" at (760, 100)
    a.east -> b.west [route=around obstacle]
  }`)).toJSON();
  assert.equal(result.elements.filter((item) => item.type === "arrow").length, 1);
  assert.throws(
    () => compile(parse('a: card "A"; b: card "B"; a -> b [route=around missing]')),
    /unknown node: missing/,
  );
});
