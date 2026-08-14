import assert from "node:assert/strict";
import test from "node:test";

import { compile } from "../src/pipeline.ts";
import { layoutBuiltInDocument } from "../src/layout/builtin.ts";
import { createMeasurer } from "../src/measurement.ts";
import { createSceneGraph } from "../src/scene.ts";
import { buildSemanticIR, DiagnosticError, validateSemanticDocument } from "../src/semantic.ts";
import { parseSource } from "../src/source-language.ts";
import { measureTextWidth } from "../src/text/metrics.ts";
import { requireElementById } from "../test-support/assertions.ts";
import type { Bounds } from "../src/foundation-contracts.ts";
import type { SceneGraph } from "../src/layout-contracts.ts";

const imports = `use "xdraw/process" as process
use "xdraw/annotations" as annotations`;

test("font-aware metrics distinguish proportional and code fonts", () => {
  assert.ok(measureTextWidth("W", 20, 1) > measureTextWidth("i", 20, 1));
  assert.ok(measureTextWidth("W", 20, 2) > measureTextWidth("i", 20, 2));
  assert.equal(measureTextWidth("W", 20, 3), measureTextWidth("i", 20, 3));
});

test("spacing presets express layout density without numeric geometry", () => {
  const drawing = (spacing: string) => compile(parseSource(`${imports}
    diagram "Spacing" {
      flow: process.lane "Flow" {
        arrange row { spacing ${spacing} }
        a: rectangle "A"
        b: rectangle "B"
      }
    }`)).toJSON();
  const tight = drawing("tight");
  const airy = drawing("airy");
  const tightA = requireElementById(tight.elements, "flow.a:frame");
  const tightB = requireElementById(tight.elements, "flow.b:frame");
  const airyA = requireElementById(airy.elements, "flow.a:frame");
  const airyB = requireElementById(airy.elements, "flow.b:frame");
  assert.ok(airyB.x - (airyA.x + airyA.width) > tightB.x - (tightA.x + tightA.width));
});

test("small numeric gaps report automatic correction", () => {
  const drawing = compile(parseSource(`${imports}
    diagram "Warnings" {
      flow: process.lane "Flow" {
        arrange row { gap 8 }
        a: rectangle "A"
        b: rectangle "B"
        a -> b "a connector label"
      }
    }`));
  assert.ok(drawing.diagnostics.some((item) => item.code === "XD2001" && item.severity === "warning"));
});

test("container notes participate in layout without manual coordinates", () => {
  const result = compile(parseSource(`${imports}
    diagram "Notes" {
      flow: process.lane "Flow" {
        a: rectangle "A"
        caveat: annotations.note "This applies to the whole flow."
      }
    }`)).toJSON();
  const lane = requireElementById(result.elements, "flow:frame");
  const note = requireElementById(result.elements, "flow.caveat:frame");
  assert.ok(note.x >= lane.x && note.y >= lane.y);
  assert.ok(note.x + note.width <= lane.x + lane.width);
  assert.ok(note.y + note.height <= lane.y + lane.height);
});

test("multiple container notes remain inside their measured container", () => {
  const result = compile(parseSource(`${imports}
    diagram "Notes" {
      flow: process.lane "Flow" {
        a: rectangle "A"
        one: annotations.note "First note"
        two: annotations.note "Second note"
        three: annotations.note "Third note"
        four: annotations.note "Fourth note"
      }
    }`)).toJSON();
  const lane = requireElementById(result.elements, "flow:frame");
  const notes = result.elements.filter((item) => /^flow\.(?:one|two|three|four):frame$/u.test(item.id));
  assert.equal(notes.length, 4);
  assert.ok(notes.every((note) => note.y + note.height <= lane.y + lane.height));
});

test("arranged frame notes are placed inside and move with their frame", () => {
  const result = compile(parseSource(`${imports}
    diagram "Arranged notes" {
      scope: frame "Scope" {
        arrange row {}
        a: rectangle "A"
        b: rectangle "B"
        caveat: annotations.note "This note belongs to the frame."
      }
    }`)).toJSON();
  const frame = requireElementById(result.elements, "scope");
  const note = requireElementById(result.elements, "scope.caveat:frame");
  assert.ok(note.x >= frame.x && note.y >= frame.y);
  assert.ok(note.x + note.width <= frame.x + frame.width);
  assert.ok(note.y + note.height <= frame.y + frame.height);
  assert.equal(note.frameId, frame.id);
});

test("invalid numeric layout and connection values fail before rendering", () => {
  assert.throws(
    () => compile(parseSource(`${imports} diagram "Bad gap" {
      flow: process.lane "Flow" { arrange row { gap -1 } a: rectangle "A" }
    }`)),
    /layout gap must be finite and non-negative/,
  );
  assert.throws(
    () => compile(parseSource('diagram "Bad width" { a: rectangle "A"; b: rectangle "B"; a -> b { width -2 } }')),
    /connection width must be a positive finite number/,
  );
  assert.throws(
    () => compile(parseSource('diagram "Bad head" { a: rectangle "A"; b: rectangle "B"; a -> b { head unknown } }')),
    /property 'head' on connection must be one of/,
  );
  for (const columns of [0, -1, 1.5]) {
    assert.throws(
      () => compile(parseSource(`diagram "Bad columns" { arrange grid { columns ${columns} } a: rectangle "A" }`)),
      /layout columns must be a positive integer/,
    );
  }
});

test("built-in grid layout rejects invalid columns at its runtime boundary", () => {
  const document = buildSemanticIR(parseSource('diagram "Grid" {}'));
  const state = createSceneGraph(document, {
    diagramWidth: 1120,
    contentWidth: 1120,
    annotationGutterWidth: 0,
    measurer: createMeasurer(),
  });
  const context = {
    state,
    registerBounds: (graph: SceneGraph, id: string, bounds: Bounds) => graph.place(id, bounds),
  };
  for (const columns of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => layoutBuiltInDocument(context, [], {
        columns,
        contentWidth: 1120,
        gap: 35,
        kind: "grid",
        startY: 42,
      }),
      /grid columns must be a positive integer/,
    );
  }
});

test("tree validation rejects children that layout would otherwise omit", () => {
  const diagnostics = validateSemanticDocument({
    statements: [{
      type: "tree",
      id: "map",
      title: "Map",
      kind: "rectangle",
      statements: [{
        type: "node",
        id: "unexpected",
        kind: "rectangle",
        title: "Unexpected",
        attributes: {},
        statements: [],
      }],
    }],
  });
  assert.ok(diagnostics.some((item) => (
    item.code === "XD1241" && item.message === "tree may contain only branches and leaves, not node"
  )));
});

test("connection diagnostics use a distinct range from freedraw diagnostics", () => {
  assert.throws(
    () => compile(parseSource('diagram "Bad width" { a: rectangle "A"; b: rectangle "B"; a -> b { width -2 } }')),
    (error) => error instanceof DiagnosticError
      && error.diagnostics.some((item) => item.code === "XD1232"),
  );
  assert.throws(
    () => compile(parseSource('diagram "Bad stroke" { a: freedraw { at (0, 0); points ((1, 1), (1, 1)) } }')),
    (error) => error instanceof DiagnosticError
      && error.diagnostics.some((item) => item.code === "XD1224"),
  );
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

test("connections may target annotations that are placed during rendering", () => {
  const drawing = compile(parseSource(`${imports}
    diagram "Annotation connection" {
      a: rectangle "A"
      review: annotations.note "Review" { attach a@bottom }
      a -> review
    }`)).toJSON();
  requireElementById(drawing.elements, "review:frame");
  assert.ok(drawing.elements.some((item) => item.type === "arrow"));
});
