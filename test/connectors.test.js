import assert from "node:assert/strict";
import test from "node:test";

import { compile } from "../src/compiler.js";
import { parse } from "../src/parser.js";
import { measureRouteQuality } from "../src/route-quality.js";
import { Drawing } from "../src/document.js";
import { renderConnection } from "../src/routing-renderer.js";
import { synchronizeEndpointLabels } from "../src/connector-labels.js";

test("explicit waypoints and endpoint labels compile deterministically", () => {
  const source = `diagram "Connector depth" {
    a: system "A" at (80, 120) size (180, 90)
    j: junction "" at (360, 150) size (20, 20)
    b: system "B" at (520, 120) size (180, 90)
    a.east -> j.west "request" [via="290,165;330,165", start-label="caller", end-label="junction"]
    j.east -> b.west [end-label="callee"]
  }`;
  const first = compile(parse(source)).toJSON();
  const second = compile(parse(source)).toJSON();
  assert.deepEqual(first, second);
  assert.equal(first.elements.find((item) => item.id === "j:frame").type, "ellipse");
  const arrow = first.elements.find((item) => item.id === "document:connection:0:0");
  assert.equal(arrow.points.length, 4);
  assert.ok(first.elements.some((item) => item.id === `${arrow.id}:start-label`));
  assert.ok(first.elements.some((item) => item.id === `${arrow.id}:end-label`));
});

test("malformed waypoints fail with a bounded diagnostic", () => {
  assert.throws(
    () => compile(parse('a: card "A"; b: card "B"; a -> b [via="10,nope"]')),
    /invalid connection waypoint '10,nope'/,
  );
  assert.throws(
    () => compile(parse('a: card "A"; b: card "B"; c: card "C"; a -> b -> c [via="10,20"]')),
    /via is only valid for a single connector segment/,
  );
});

test("route quality reports crossings, bends, shared segments and obstacles", () => {
  const result = measureRouteQuality([
    [[0, 10], [100, 10], [100, 80]],
    [[50, 0], [50, 30], [100, 30], [100, 80]],
  ], [{ x: 70, y: 5, width: 10, height: 10 }]);
  assert.deepEqual(result, {
    crossings: 1,
    obstacleIntersections: 1,
    bends: 3,
    sharedSegmentLength: 50,
  });
});

test("straight and curved connectors register only their rendered routes", () => {
  for (const style of ["straight", "curved"]) {
    const drawing = new Drawing();
    const state = {
      bounds: new Map([
        ["a", { x: 0, y: 0, width: 100, height: 60 }],
        ["b", { x: 300, y: 120, width: 100, height: 60 }],
      ]),
      nodeIds: new Set(["a", "b"]),
      containers: [],
      routes: [],
      adapterRoutes: new Map(),
      frameMembership: new Map(),
      frameLocks: new Map(),
    };
    renderConnection(drawing, state, { nodes: ["a", "b"], attributes: { style } }, 0);
    const rendered = drawing.elements[0].points.map(([x, y]) => [x + drawing.elements[0].x, y + drawing.elements[0].y]);
    assert.deepEqual(state.routes, [rendered]);
  }
});

test("endpoint labels follow connector rerouting", () => {
  const drawing = compile(parse(`
    a: card "A" at (0,0) size (100,60)
    b: card "B" at (300,0) size (100,60)
    a -> b [start-label="caller", end-label="callee"]
  `)).toJSON();
  const arrow = drawing.elements.find((item) => item.type === "arrow");
  const label = drawing.elements.find((item) => item.id === `${arrow.id}:end-label`);
  const previousX = label.x;
  arrow.x += 80;
  const synchronized = synchronizeEndpointLabels(drawing.elements);
  assert.equal(synchronized.changed, true);
  const movedLabel = synchronized.elements.find((item) => item.id === label.id);
  assert.equal(movedLabel.x, previousX + 80);
  assert.equal(label.x, previousX);
  assert.equal(synchronizeEndpointLabels(synchronized.elements).changed, false);
});

test("connector labels avoid endpoints when the gap is too short", () => {
  const drawing = compile(parse(`
    a: card "A" at (0,0) size (100,60)
    b: card "B" at (140,0) size (100,60)
    a.east -> b.west "a label wider than the gap"
  `)).toJSON();
  const label = drawing.elements.find((item) => item.id.endsWith(":label"));
  const endpoints = drawing.elements.filter((item) => ["a:frame", "b:frame"].includes(item.id));
  assert.equal(endpoints.some((bounds) => (
    label.x < bounds.x + bounds.width && label.x + label.width > bounds.x
    && label.y < bounds.y + bounds.height && label.y + label.height > bounds.y
  )), false);
});

test("connector labels use the full collinear run across explicit waypoints", () => {
  const drawing = compile(parse(`diagram "Waypoint label" {
    a: system "A" at (100, 100) size (160, 80)
    b: system "B" at (480, 100) size (160, 80)
    a.east -> b.west "validated payload" [via="320,140;420,140"]
  }`));
  const label = drawing.elements.find((item) => item.id === "document:connection:0:0:label");
  assert.equal(label.text, "validated payload");
  assert.equal(label.text.includes("\n"), false);
  assert.ok(label.width >= 120);
});

test("endpoint labels occupy a separate row from the connector label", () => {
  const drawing = compile(parse(`diagram "Endpoint labels" {
    a: system "A" at (100, 100) size (160, 80)
    b: system "B" at (480, 100) size (160, 80)
    a.east -> b.west "request" [start-label="caller", end-label="callee"]
  }`));
  const middle = drawing.elements.find((item) => item.id === "document:connection:0:0:label");
  const start = drawing.elements.find((item) => item.id === "document:connection:0:0:start-label");
  const end = drawing.elements.find((item) => item.id === "document:connection:0:0:end-label");
  assert.ok(start.y + start.height < middle.y);
  assert.ok(end.y + end.height < middle.y);
});

test("overlapping horizontal spans connect vertically", () => {
  const drawing = compile(parse(`diagram "Nested routing" {
    a: system "A" at (420, 100) size (280, 80)
    b: system "B" at (100, 320) size (800, 80)
    a -> b
  }`));
  const arrow = drawing.elements.find((item) => item.id === "document:connection:0:0");
  assert.deepEqual(arrow.startBinding.fixedPoint, [0.5, 1]);
  assert.deepEqual(arrow.endBinding.fixedPoint, [0.5, 0]);
});

test("cross-container connectors infer sides from their owning sections", () => {
  const result = compile(parse(`diagram "Containers" {
    layout grid columns 2
    group left "Left" { source: card "Source" }
    group right "Right" { target: card "Target" }
    source -> target
  }`)).toJSON();
  const source = result.elements.find((item) => item.id === "source:frame");
  const target = result.elements.find((item) => item.id === "target:frame");
  const edge = result.elements.find((item) => item.type === "arrow");
  assert.equal(edge.x + edge.points[0][0], source.x + source.width);
  assert.equal(edge.x + edge.points.at(-1)[0], target.x);
});

test("automatic row layout reserves a complete channel for connector labels", () => {
  const drawing = compile(parse(`diagram "Label clearance" {
    lane flow "Flow" {
      layout row gap 8
      source: card "Source"
      target: card "Target"
      source -> target "validated payload"
    }
  }`)).toJSON();
  const source = drawing.elements.find((item) => item.id === "source:frame");
  const target = drawing.elements.find((item) => item.id === "target:frame");
  const label = drawing.elements.find((item) => item.id === "document:connection:0:0:label");
  const gap = target.x - (source.x + source.width);

  assert.equal(label.text, "validated payload");
  assert.ok(gap >= label.width + 24);
  assert.equal(label.text.includes("\n"), false);
});

test("loose top-level nodes also reserve connector-label clearance", () => {
  const drawing = compile(parse(`diagram "Top-level clearance" {
    source: card "Source"
    target: card "Target"
    source -> target "compare records"
  }`)).toJSON();
  const source = drawing.elements.find((item) => item.id === "source:frame");
  const target = drawing.elements.find((item) => item.id === "target:frame");
  const labels = drawing.elements.filter((item) => item.id === "document:connection:0:0:label");
  assert.equal(labels.length, 1);
  assert.ok(target.x - (source.x + source.width) >= labels[0].width + 24);
});

test("automatic column layout keeps visible lead-in space around connectors", () => {
  const drawing = compile(parse(`diagram "Arrow clearance" {
    lane flow "Flow" {
      layout column gap 4
      source: card "Source"
      target: card "Target"
      source -> target
    }
  }`)).toJSON();
  const source = drawing.elements.find((item) => item.id === "source:frame");
  const target = drawing.elements.find((item) => item.id === "target:frame");
  assert.ok(target.y - (source.y + source.height) >= 52);
});

test("vertical connector labels use horizontal text width instead of segment length", () => {
  const drawing = compile(parse(`diagram "Vertical label" {
    lane flow "Flow" {
      layout column gap 4
      source: card "Source"
      target: card "Target"
      source -> target "record both versions"
    }
  }`)).toJSON();
  const label = drawing.elements.find((item) => item.id === "document:connection:0:0:label");
  assert.equal(label.text, "record both versions");
  assert.equal(label.text.includes("\n"), false);
  assert.ok(label.width > 100);
});

test("dense routed connectors avoid unrelated node interiors", () => {
  const drawing = compile(parse(`
    source: card "Left" at (0,100) size (120,70)
    obstacle: card "Obstacle" at (240,80) size (140,110)
    target: card "Right" at (520,100) size (120,70)
    source -> target
  `)).toJSON();
  const arrow = drawing.elements.find((item) => item.type === "arrow");
  const route = arrow.points.map(([x, y]) => [x + arrow.x, y + arrow.y]);
  const obstacle = drawing.elements.find((item) => item.id === "obstacle:frame");
  assert.equal(measureRouteQuality([route], [obstacle]).obstacleIntersections, 0);
  const direct = [[120, 135], [520, 135]];
  assert.equal(measureRouteQuality([direct], [obstacle]).obstacleIntersections, 1);
});
