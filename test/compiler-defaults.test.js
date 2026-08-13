import assert from "node:assert/strict";
import test from "node:test";

import { compile } from "../src/compiler.js";
import { parseSource } from "../src/source-language.js";
import { measureTextWidth } from "../src/text-metrics.js";

const imports = `use "xdraw/process" as process
use "xdraw/cards" as cards
use "xdraw/annotations" as annotations`;

test("font-aware metrics distinguish proportional and code fonts", () => {
  assert.ok(measureTextWidth("W", 20, 1) > measureTextWidth("i", 20, 1));
  assert.ok(measureTextWidth("W", 20, 2) > measureTextWidth("i", 20, 2));
  assert.equal(measureTextWidth("W", 20, 3), measureTextWidth("i", 20, 3));
});

test("spacing presets express layout density without numeric geometry", () => {
  const drawing = (spacing) => compile(parseSource(`${imports}
    diagram "Spacing" {
      flow: process.lane "Flow" {
        arrange row { spacing ${spacing} }
        a: cards.card "A"
        b: cards.card "B"
      }
    }`)).toJSON();
  const tight = drawing("tight");
  const airy = drawing("airy");
  const tightA = tight.elements.find((item) => item.id === "flow.a:frame");
  const tightB = tight.elements.find((item) => item.id === "flow.b:frame");
  const airyA = airy.elements.find((item) => item.id === "flow.a:frame");
  const airyB = airy.elements.find((item) => item.id === "flow.b:frame");
  assert.ok(airyB.x - (airyA.x + airyA.width) > tightB.x - (tightA.x + tightA.width));
});

test("small numeric gaps report automatic correction", () => {
  const drawing = compile(parseSource(`${imports}
    diagram "Warnings" {
      flow: process.lane "Flow" {
        arrange row { gap 8 }
        a: cards.card "A"
        b: cards.card "B"
        a -> b "a connector label"
      }
    }`));
  assert.ok(drawing.diagnostics.some((item) => item.code === "XD2001" && item.severity === "warning"));
});

test("container notes participate in layout without manual coordinates", () => {
  const result = compile(parseSource(`${imports}
    diagram "Notes" {
      flow: process.lane "Flow" {
        a: cards.card "A"
        caveat: annotations.note "This applies to the whole flow."
      }
    }`)).toJSON();
  const lane = result.elements.find((item) => item.id === "flow:frame");
  const note = result.elements.find((item) => item.id === "flow.caveat:frame");
  assert.ok(note.x >= lane.x && note.y >= lane.y);
  assert.ok(note.x + note.width <= lane.x + lane.width);
  assert.ok(note.y + note.height <= lane.y + lane.height);
});

test("decision branches use ordinary labeled connections", () => {
  const result = compile(parseSource(`diagram "Decision" {
    gate: diamond "Approved?"
    release: rectangle "Release"
    revise: rectangle "Revise"
    gate -> release "yes"
    gate -> revise "no"
  }`)).toJSON();
  const labels = result.elements.filter((item) => item.type === "text").map((item) => item.text);
  assert.ok(labels.includes("yes"));
  assert.ok(labels.includes("no"));
  assert.equal(result.elements.filter((item) => item.type === "arrow").length, 2);
});

test("explicit waypoints report that automatic routing is disabled", () => {
  const drawing = compile(parseSource(`diagram "Routing" {
    a: rectangle "A" { at (100, 100) }
    b: rectangle "B" { at (500, 100) }
    a@right -> b@left { via ((340, 155)) }
  }`));
  assert.ok(drawing.diagnostics.some((item) => item.code === "XD2003"));
  assert.ok(drawing.diagnostics.some((item) => item.code === "XD2002"));
});
