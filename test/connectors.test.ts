import assert from "node:assert/strict";
import test from "node:test";

import { compilePrepared as compile } from "../src/compile/pipeline.ts";
import { parseSource as parse } from "../src/language/parser.ts";
import { measureRouteQuality } from "../src/routing/quality.ts";
import { Drawing } from "../src/excalidraw/document.ts";
import { renderAnnotation, renderConnection } from "../src/routing/renderer.ts";
import { synchronizeEndpointLabels } from "../src/routing/labels.ts";
import { routeConnection } from "../src/routing/router.ts";
import { borderOfElementKind, listLibraryManifests } from "../src/language/registry.ts";
import { createMeasurer } from "../src/compile/measurement.ts";
import { createTestSceneGraph, requireArrow, requireElementById } from "../test-support/assertions.ts";
import type { Bounds, Point, Route } from "../src/contracts/foundation.ts";
import type { DrawingJson, LinearElement, TextElement } from "../src/contracts/render.ts";

function requireLinear(elements: readonly DrawingJson["elements"][number][], id?: string): LinearElement {
  const element = elements.find((candidate) => (
    (candidate.type === "arrow" || candidate.type === "line") && (id === undefined || candidate.id === id)
  ));
  assert.ok(element?.type === "arrow" || element?.type === "line", id ? `missing linear element ${id}` : "missing linear element");
  return element;
}

function requireText(elements: readonly DrawingJson["elements"][number][], id: string): TextElement {
  const element = elements.find((candidate) => candidate.id === id);
  assert.ok(element?.type === "text", `missing text element ${id}`);
  return element;
}

test("detached text is a routed and measured scene object", () => {
  const drawing = compile(parse(`diagram "Text endpoint" {
    caption: text "Caption" { at = (100, 120) }
    target: rectangle "Target" { at = (420, 100); size = (140, 80) }
    caption -> target
  }`));
  const result = drawing.toJSON();
  assert.ok(requireLinear(result.elements));
  assert.ok(drawing.measurements?.elements.some((item) => item.id === "caption"));
});

test("arranged text binds to its emitted text element", () => {
  const result = compile(parse(`diagram "Arranged text endpoint" {
    panel: frame "Panel" {
      arrange row { gap = 100 }
      caption: text "Caption"
      target: rectangle "Target"
      caption -> target
    }
  }`)).toJSON();
  const connector = requireLinear(result.elements);
  assert.equal(connector.startBinding?.elementId, "panel.caption");
});

test("explicit ports are transformed with rotated node geometry", () => {
  const result = compile(parse(`diagram "Rotated port" {
    source: rectangle "Source" { at = (100, 100); size = (240, 80) }
    target: rectangle "Target" { at = (600, 160); size = (140, 80) }
    rotate (source) 30
    source@east -> target@west { style = straight }
  }`)).toJSON();
  const source = requireElementById(result.elements, "source:frame") as DrawingJson["elements"][number] & {
    x: number; y: number; width: number; height: number; angle: number;
  };
  const connector = requireLinear(result.elements);
  const actual: Point = [connector.x + connector.points[0][0], connector.y + connector.points[0][1]];
  const center: Point = [source.x + source.width / 2, source.y + source.height / 2];
  const local: Point = [source.x + source.width, center[1]];
  const dx = local[0] - center[0];
  const dy = local[1] - center[1];
  const expected: Point = [
    center[0] + dx * Math.cos(source.angle) - dy * Math.sin(source.angle),
    center[1] + dx * Math.sin(source.angle) + dy * Math.cos(source.angle),
  ];
  assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) < 0.001);
});

test("explicit waypoints and endpoint labels compile deterministically", () => {
  const source = `use "xdraw/architecture" as arch
  use "xdraw/connectors" as connectors
  diagram "Connector depth" {
    a: arch.system "A" { at = (80, 120); size = (180, 90) }
    j: connectors.junction "" { at = (360, 150); size = (20, 20) }
    b: arch.system "B" { at = (520, 120); size = (180, 90) }
    a@east -> j@west "request" { via = ((290,165),(330,165)); start-label = "caller"; end-label = "junction" }
    j@east -> b@west { end-label = "callee" }
  }`;
  const first = compile(parse(source)).toJSON();
  const second = compile(parse(source)).toJSON();
  assert.deepEqual(first, second);
  assert.equal(requireElementById(first.elements, "j:frame").type, "ellipse");
  const arrow = requireArrow(first.elements, "document:connection:0:0");
  assert.equal(arrow.points.length, 4);
  assert.ok(first.elements.some((item) => item.id === `${arrow.id}:start-label`));
  assert.ok(first.elements.some((item) => item.id === `${arrow.id}:end-label`));
});

test("malformed waypoints fail with a bounded diagnostic", () => {
  assert.throws(
    () => parse('diagram "Invalid" { a: rectangle "A"; b: rectangle "B"; a -> b { via = ((10, nope)) } }'),
    /property 'via' on connection expects points/,
  );
  assert.throws(
    () => compile(parse('diagram "Invalid" { a: rectangle "A"; b: rectangle "B"; c: rectangle "C"; a -> b -> c { via = ((10,20)) } }')),
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

test("automatic routing records selected paths and ignores unplaced advisory obstacles", () => {
  const from = { x: 0, y: 40, width: 100, height: 60 };
  const to = { x: 500, y: 40, width: 100, height: 60 };
  const obstacle = { x: 230, y: 20, width: 140, height: 100 };
  const scene = {
    bounds: new Map([["from", from], ["to", to], ["obstacle", obstacle]]),
    nodeIds: new Set(["from", "to", "obstacle", "not-yet-placed"]),
    containers: [],
    routes: [],
    labelBounds: [],
  };
  const route = routeConnection(scene, "from", "to", from, to, "right", "left");
  assert.deepEqual(scene.routes, [route]);
  assert.equal(measureRouteQuality([route], [obstacle]).obstacleIntersections, 0);
});

test("automatic routing requires an explicitly requested obstacle", () => {
  const from = { x: 0, y: 0, width: 100, height: 60 };
  const to = { x: 300, y: 0, width: 100, height: 60 };
  const scene = {
    bounds: new Map([["from", from], ["to", to]]),
    nodeIds: new Set(["from", "to"]),
    containers: [],
    routes: [],
  };
  assert.throws(
    () => routeConnection(scene, "from", "to", from, to, "right", "left", { around: "missing" }),
    /route constraint references unknown node: missing/,
  );
});

test("endpoint-interior protection preserves a clear direct route", () => {
  const from = { x: 0, y: 40, width: 100, height: 60 };
  const to = { x: 300, y: 40, width: 100, height: 60 };
  const scene = {
    bounds: new Map([["from", from], ["to", to]]),
    nodeIds: new Set(["from", "to"]),
    containers: [],
    routes: [],
    labelBounds: [],
  };
  const route = routeConnection(
    scene,
    "from",
    "to",
    from,
    to,
    "right",
    "left",
    { avoidEndpointInteriors: true },
  );
  assert.deepEqual(route, [[100, 70], [300, 70]]);
});

test("straight and curved connectors register only their rendered routes", () => {
  for (const style of ["straight", "curved"]) {
    const drawing = new Drawing();
    const state = createTestSceneGraph({
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
    });
    renderConnection(drawing, state, { type: "connection", nodes: ["a", "b"], attributes: { style } }, 0);
    const edge = requireLinear(drawing.elements);
    const rendered: Route = edge.points.map(([x, y]) => [x + edge.x, y + edge.y]) as Route;
    assert.deepEqual(state.routes, [rendered]);
  }
});

test("connectors bind to native frames and normalize adapter route endpoints", () => {
  const nativeFrame = compile(parse(`diagram "Frame endpoint" {
    scope: frame "Scope" { nested: rectangle "Nested" }
    outside: rectangle "Outside"
    scope -> outside
  }`)).toJSON();
  const frameArrow = requireArrow(nativeFrame.elements);
  assert.equal(frameArrow.startBinding?.elementId, "scope");
  assert.equal(frameArrow.endBinding?.elementId, "outside:frame");

  const drawing = new Drawing();
  const from = { x: 100, y: 100, width: 100, height: 60 };
  const to = { x: 500, y: 100, width: 100, height: 60 };
  const state = createTestSceneGraph({
    bounds: new Map([["a", from], ["b", to]]),
    nodeIds: new Set(["a", "b"]), containers: [], routes: [],
    adapterRoutes: new Map([["0:0", [[0, 0], [50, 50]] as Route]]),
    frameMembership: new Map(), frameLocks: new Map(), visuals: [], labelBounds: [],
  });
  renderConnection(drawing, state, { type: "connection", nodes: ["a", "b"], attributes: {} }, 0);
  const arrow = requireArrow(drawing.elements);
  const absolute = arrow.points.map(([x, y]) => [x + arrow.x, y + arrow.y]);
  assert.deepEqual(absolute[0], [from.x + from.width, from.y + from.height / 2]);
  assert.deepEqual(absolute.at(-1), [to.x, to.y + to.height / 2]);
});

test("connectors bind to the emitted element for freehand endpoints", () => {
  const result = compile(parse(`diagram "Freehand endpoint" {
    mark: freedraw { at = (20, 40); points = ((0, 0), (40, 20), (80, 0)) }
    target: rectangle "Target" { at = (300, 20); size = (120, 80) }
    mark -> target { style = straight }
  }`)).toJSON();
  const arrow = requireArrow(result.elements);
  assert.equal(arrow.startBinding?.elementId, "mark:stroke");
  assert.equal(arrow.endBinding?.elementId, "target:frame");
});

test("attached annotations stay inside their frame and remain frame-owned", () => {
  const drawing = new Drawing();
  const frameBounds = { x: 0, y: 0, width: 420, height: 300 };
  const targetBounds = { x: 300, y: 100, width: 90, height: 60 };
  const state = createTestSceneGraph({
    bounds: new Map([["frame", frameBounds], ["target", targetBounds]]),
    nodeIds: new Set(["target"]), containers: ["frame"], routes: [], adapterRoutes: new Map(),
    frameMembership: new Map([["target", "frame"]]), containerMembership: new Map(), frameLocks: new Map(),
    canvas: { left: 0, right: 900, top: 0 }, annotationGutter: { x: 650, width: 220 },
    measurer: createMeasurer(), visuals: [], labelBounds: [],
  });
  const registerBounds = (graph: typeof state, id: string, bounds: Bounds) => graph.bounds.set(id, bounds);
  renderAnnotation(drawing, state, {
    type: "callout", id: "note", title: "Review", target: "target", at: undefined,
  }, 0, registerBounds);
  const note = state.bounds.get("note");
  assert.ok(note);
  assert.ok(note.x >= frameBounds.x && note.x + note.width <= frameBounds.x + frameBounds.width);
  assert.ok(note.y >= frameBounds.y && note.y + note.height <= frameBounds.y + frameBounds.height);
  assert.equal(state.frameMembership.get("note"), "frame");
});

test("labeled connector ignores advisory node ids without bounds", () => {
  const drawing = new Drawing();
  const state = createTestSceneGraph({
    bounds: new Map([
      ["a", { x: 0, y: 0, width: 100, height: 60 }],
      ["b", { x: 300, y: 0, width: 100, height: 60 }],
    ]),
    nodeIds: new Set(["a", "b", "pending"]), containers: [], routes: [], adapterRoutes: new Map(),
    frameMembership: new Map(), frameLocks: new Map(), visuals: [], labelBounds: [],
  });
  assert.doesNotThrow(() => renderConnection(drawing, state, {
    type: "connection", nodes: ["a", "b"], label: "request", attributes: {},
  }, 0));
});

test("endpoint labels follow connector rerouting", () => {
  const drawing = compile(parse(`
    diagram "Endpoint labels" {
      a: rectangle "A" { at = (0,0); size = (100,60) }
      b: rectangle "B" { at = (300,0); size = (100,60) }
      a -> b { start-label = "caller"; end-label = "callee" }
    }
  `)).toJSON();
  const arrow = requireArrow(drawing.elements);
  const label = requireText(drawing.elements, `${arrow.id}:end-label`);
  const previousX = label.x;
  arrow.x += 80;
  const synchronized = synchronizeEndpointLabels(drawing.elements);
  assert.equal(synchronized.changed, true);
  const movedLabel = requireText(synchronized.elements, label.id);
  assert.equal(movedLabel.x, previousX + 80);
  assert.equal(label.x, previousX);
  assert.equal(synchronizeEndpointLabels(synchronized.elements).changed, false);
});

test("endpoint-label synchronization ignores malformed editable-scene metadata", () => {
  const drawing = compile(parse(`diagram "Endpoint labels" {
    a: rectangle "A" { at = (0,0); size = (100,60) }
    b: rectangle "B" { at = (300,0); size = (100,60) }
    a -> b { start-label = "caller" }
  }`)).toJSON();
  const arrow = requireArrow(drawing.elements);
  assert.ok(arrow.customData?.xdrawEndpointLabels);
  arrow.customData.xdrawEndpointLabels.start = 42 as never;
  assert.deepEqual(synchronizeEndpointLabels(drawing.elements), {
    elements: drawing.elements,
    changed: false,
  });

  arrow.customData.xdrawEndpointLabels.start = "a:frame";
  assert.equal(synchronizeEndpointLabels(drawing.elements).changed, false);

  arrow.customData.xdrawEndpointLabels = { middle: requireText(drawing.elements, `${arrow.id}:start-label`).id } as never;
  assert.equal(synchronizeEndpointLabels(drawing.elements).changed, false);
});

test("endpoint-label synchronization repairs height-only drift", () => {
  const drawing = compile(parse(`diagram "Endpoint labels" {
    a: rectangle "A" { at = (0,0); size = (100,60) }
    b: rectangle "B" { at = (300,0); size = (100,60) }
    a -> b { start-label = "caller" }
  }`)).toJSON();
  const label = drawing.elements.find((item): item is TextElement => item.type === "text" && item.id.endsWith(":start-label"));
  assert.ok(label);
  label.height += 10;
  const synchronized = synchronizeEndpointLabels(drawing.elements);
  assert.equal(synchronized.changed, true);
  assert.equal(requireText(synchronized.elements, label.id).height, label.fontSize * 1.25);
});

test("connector labels reject an explicit gap that cannot fit", () => {
  assert.throws(() => compile(parse(`
    diagram "Short gap" {
      a: rectangle "A" { at = (0,0); size = (100,60) }
      b: rectangle "B" { at = (140,0); size = (100,60) }
      a@east -> b@west "a label wider than the gap"
    }
  `)), /cannot fit beside its route/u);
});

test("connector labels use the full collinear run across explicit waypoints", () => {
  const drawing = compile(parse(`diagram "Waypoint label" {
    a: rectangle "A" { at = (100, 100); size = (160, 80) }
    b: rectangle "B" { at = (480, 100); size = (160, 80) }
    a@east -> b@west "validated payload" { via = ((320,140),(420,140)) }
  }`));
  const label = requireText(drawing.elements, "document:connection:0:0:label");
  assert.equal(label.text, "validated payload");
  assert.equal(label.text.includes("\n"), false);
  assert.ok(label.width >= 120);
});

test("endpoint labels occupy a separate row from the connector label", () => {
  const drawing = compile(parse(`diagram "Endpoint labels" {
    a: rectangle "A" { at = (100, 100); size = (160, 80) }
    b: rectangle "B" { at = (480, 100); size = (160, 80) }
    a@east -> b@west "request" { start-label = "caller"; end-label = "callee" }
  }`));
  const middle = requireText(drawing.elements, "document:connection:0:0:label");
  const start = requireText(drawing.elements, "document:connection:0:0:start-label");
  const end = requireText(drawing.elements, "document:connection:0:0:end-label");
  assert.ok(start.y + start.height < middle.y);
  assert.ok(end.y + end.height < middle.y);
});

test("overlapping horizontal spans connect vertically", () => {
  const drawing = compile(parse(`diagram "Nested routing" {
    a: rectangle "A" { at = (420, 100); size = (280, 80) }
    b: rectangle "B" { at = (100, 320); size = (800, 80) }
    a -> b
  }`));
  const arrow = requireArrow(drawing.elements, "document:connection:0:0");
  assert.deepEqual(arrow.startBinding?.fixedPoint, [0.5, 1]);
  assert.deepEqual(arrow.endBinding?.fixedPoint, [0.5, 0]);
});

test("a label on a connector inside a group stays beside its arrow", () => {
  const drawing = compile(parse(`use "xdraw/architecture" as arch
  diagram "Grouped" {
    lane: arch.group "Lane" {
      arrange column { gap = 56 }
      one: arch.container "one" { description = "d"; technology = "t"; size = (420, 130) }
      two: arch.container "two" { description = "d"; technology = "t"; size = (420, 130) }
    }
    lane.one@south -> lane.two@north "waits only" { technology = "lane order" }
  }`));
  const group = requireElementById(drawing.elements, "lane");
  const label = requireText(drawing.elements, "document:connection:0:0:label");
  // Given a gap that fits it, the label belongs beside its arrow and inside the group.
  // When the gap is too short for the text the placement falls back to a position outside
  // the shapes entirely, which is why a column carrying labelled connectors needs a gap
  // at least as tall as a two-line label.
  assert.ok(label.x >= group.x, "label escaped its group to the left");
  assert.ok(label.x + label.width <= group.x + group.width, "label escaped its group to the right");
  // And it belongs in the gap between the two shapes, not above or below the pair.
  const one = requireElementById(drawing.elements, "lane.one:frame");
  const two = requireElementById(drawing.elements, "lane.two:frame");
  assert.ok(label.y >= one.y + one.height, "label sits over the upper shape");
  assert.ok(label.y + label.height <= two.y, "label sits over the lower shape");
});

test("crooked-connector advice is limited to siblings in one row", () => {
  const rowSiblings = compile(parse(`use "xdraw/architecture" as arch
  diagram "Row" {
    flow: section "Flow" {
      arrange row { gap = 260 }
      api: arch.container "API" { description = "d"; technology = "t"; size = (300, 200) }
      store: arch.container "Store" { description = "d"; technology = "t"; size = (300, 120) }
    }
    flow.api@east -> flow.store@west "writes" { technology = "SQL" }
  }`));
  assert.ok(
    rowSiblings.diagnostics.some((item) => item.code === "XD2006"),
    "two siblings of differing height in one row should still be reported",
  );

  // Each of these is the first child of its own section, so they share a y by
  // coincidence. match-size cannot level them: their heights answer to their own
  // containers, and one end also connects onward at a different height.
  const acrossSections = compile(parse(`use "xdraw/architecture" as arch
  diagram "Columns" {
    arrange grid { columns = 3; gap = 40 }
    left: section "Left" {
      arrange column { gap = 26 }
      source: arch.container "Source" { description = "d"; technology = "t"; size = (300, 200) }
      other: arch.container "Other" { description = "d"; technology = "t"; size = (300, 200) }
    }
    middle: section "Middle" {
      arrange column { gap = 26 }
      hop: arch.container "Hop" { description = "d"; technology = "t"; size = (300, 120) }
    }
    right: section "Right" {
      arrange column { gap = 26 }
      sink: arch.container "Sink" { description = "d"; technology = "t"; size = (300, 300) }
    }
    left.source@east -> middle.hop@west "sends" { technology = "SQL" }
    middle.hop@east -> right.sink@west "sends" { technology = "SQL" }
  }`));
  assert.equal(
    acrossSections.diagnostics.filter((item) => item.code === "XD2006").length,
    0,
    "connectors between different containers should not be called crooked",
  );
});

test("both ends of a connector orbit the shape they attach to", () => {
  const drawing = compile(parse(`diagram "Attachment" {
    a: rectangle "A" { at = (100, 100); size = (200, 80) }
    b: rectangle "B" { at = (500, 100); size = (200, 80) }
    a -> b
  }`));
  const arrow = requireArrow(drawing.elements, "document:connection:0:0");
  // A hosted scene rejects a binding with no mode, so neither end may omit it.
  assert.equal(arrow.startBinding?.mode, "orbit");
  assert.equal(arrow.endBinding?.mode, "orbit");
});

test("cross-container connectors infer sides from their owning sections", () => {
  const result = compile(parse(`diagram "Containers" {
    arrange grid { columns = 2 }
    left: frame "Left" { source: rectangle "Source" }
    right: frame "Right" { target: rectangle "Target" }
    left.source -> right.target
  }`)).toJSON();
  const source = requireElementById(result.elements, "left.source:frame");
  const target = requireElementById(result.elements, "right.target:frame");
  const edge = requireArrow(result.elements);
  assert.equal(edge.x + edge.points[0][0], source.x + source.width);
  assert.equal(edge.x + edge.points.at(-1)![0], target.x);
});

test("automatic row layout reserves a complete channel for connector labels", () => {
  const drawing = compile(parse(`diagram "Label clearance" {
    flow: frame "Flow" {
      arrange row { gap = 8 }
      source: rectangle "Source"
      target: rectangle "Target"
      source -> target "validated payload"
    }
  }`)).toJSON();
  const source = requireElementById(drawing.elements, "flow.source:frame");
  const target = requireElementById(drawing.elements, "flow.target:frame");
  const label = requireText(drawing.elements, "document:connection:0:0:label");
  const gap = target.x - (source.x + source.width);

  assert.equal(label.text, "validated payload");
  assert.ok(gap >= label.width + 24);
  assert.equal(label.text.includes("\n"), false);
});

test("loose top-level nodes also reserve connector-label clearance", () => {
  const drawing = compile(parse(`diagram "Top-level clearance" {
    source: rectangle "Source"
    target: rectangle "Target"
    source -> target "compare records"
  }`)).toJSON();
  const source = requireElementById(drawing.elements, "source:frame");
  const target = requireElementById(drawing.elements, "target:frame");
  const label = requireText(drawing.elements, "document:connection:0:0:label");
  assert.ok(target.x - (source.x + source.width) >= label.width + 24);
});

test("automatic column layout keeps visible lead-in space around connectors", () => {
  const drawing = compile(parse(`diagram "Arrow clearance" {
    flow: frame "Flow" {
      arrange column { gap = 4 }
      source: rectangle "Source"
      target: rectangle "Target"
      source -> target
    }
  }`)).toJSON();
  const source = requireElementById(drawing.elements, "flow.source:frame");
  const target = requireElementById(drawing.elements, "flow.target:frame");
  assert.ok(target.y - (source.y + source.height) >= 32);
});

test("vertical connector labels use horizontal text width instead of segment length", () => {
  const drawing = compile(parse(`diagram "Vertical label" {
    flow: frame "Flow" {
      arrange column { gap = 4 }
      source: rectangle "Source"
      target: rectangle "Target"
      source -> target "record both versions"
    }
  }`)).toJSON();
  const label = requireText(drawing.elements, "document:connection:0:0:label");
  assert.equal(label.text, "record both versions");
  assert.equal(label.text.includes("\n"), false);
  assert.ok(label.width > 100);
});

test("dense routed connectors avoid unrelated node interiors", () => {
  const drawing = compile(parse(`
    diagram "Obstacle routing" {
      source: rectangle "Left" { at = (0,100); size = (120,70) }
      obstacle: rectangle "Obstacle" { at = (240,80); size = (140,110) }
      target: rectangle "Right" { at = (520,100); size = (120,70) }
      source -> target
    }
  `)).toJSON();
  const arrow = requireArrow(drawing.elements);
  const route = arrow.points.map(([x, y]): Point => [x + arrow.x, y + arrow.y]) as Route;
  const obstacle = requireElementById(drawing.elements, "obstacle:frame");
  assert.equal(measureRouteQuality([route], [obstacle]).obstacleIntersections, 0);
  const direct: Route = [[120, 135], [520, 135]];
  assert.equal(measureRouteQuality([direct], [obstacle]).obstacleIntersections, 1);
});

test("a straight run meets each border where it crosses, not at a side midpoint", () => {
  // Four spokes leaving a hub diagonally all resolve to the same cardinal side,
  // so anchoring them at that side's midpoint made every one appear to start
  // from a single point. A hub-and-spoke is the shape that shows it.
  const drawing = compile(parse(`diagram "Radial" {
    hub: rectangle "" { at = (460, 260); size = (80, 80) }
    ne: rectangle "" { at = (700, 100); size = (80, 80) }
    nw: rectangle "" { at = (220, 100); size = (80, 80) }
    se: rectangle "" { at = (700, 420); size = (80, 80) }
    sw: rectangle "" { at = (220, 420); size = (80, 80) }
    hub -- ne
    hub -- nw
    hub -- se
    hub -- sw
  }`)).toJSON();
  const starts = drawing.elements
    .filter((item) => item.type === "line")
    .map((item) => `${Math.round(item.x + item.points[0][0])},${Math.round(item.y + item.points[0][1])}`);
  assert.equal(starts.length, 4);
  assert.equal(new Set(starts).size, 4, `four spokes should leave four points, got ${starts.join(" ")}`);
  // Each start is on the hub's border, never inside it.
  for (const start of starts) {
    const [x, y] = start.split(",").map(Number);
    assert.ok(x === 460 || x === 540 || y === 260 || y === 340, `${start} is not on the hub border`);
  }
});

test("a straight run meets an ellipse's own outline, not its bounding box", () => {
  // A box corner stands half again as far from the centre as the ellipse
  // inscribed in it, so computing the crossing on the box left a visible gap on
  // every diagonal spoke of a hub and none on the cardinal ones.
  const drawing = compile(parse(`diagram "Radial" {
    hub: ellipse "hub" { at = (460, 260); size = (140, 90) }
    ne: ellipse "ne" { at = (760, 100); size = (120, 72) }
    e: ellipse "e" { at = (800, 275); size = (120, 72) }
    hub -- ne
    hub -- e
  }`)).toJSON();
  const shape = (id: string) => requireElementById(drawing.elements, `${id}:frame`);
  const onOutline = (element: DrawingJson["elements"][number], [x, y]: Point) => {
    const nx = (x - (element.x + element.width / 2)) / (element.width / 2);
    const ny = (y - (element.y + element.height / 2)) / (element.height / 2);
    return nx * nx + ny * ny;
  };
  const lines = drawing.elements.filter((item) => item.type === "line");
  assert.equal(lines.length, 2);
  for (const line of lines) {
    const start: Point = [line.x + line.points[0][0], line.y + line.points[0][1]];
    // 1 is exactly on the outline; the box would have given about 1.8 diagonally.
    assert.ok(
      Math.abs(onOutline(shape("hub"), start) - 1) < 0.001,
      `a spoke should leave the ellipse's edge, got ${onOutline(shape("hub"), start)}`,
    );
  }
});

test("each native shape is met on its own border", () => {
  // Excalidraw has three shapes and each has a different border. Using the box
  // for all three left a connector outside an ellipse and inside a diamond, and
  // only on diagonals, which is why it looked right on the cardinal axes.
  const drawing = compile(parse(`diagram "Shapes" {
    box: rectangle "box" { at = (100, 400); size = (140, 90) }
    round: ellipse "round" { at = (400, 400); size = (140, 90) }
    dia: diamond "dia" { at = (700, 400); size = (140, 100) }
    far: rectangle "far" { at = (400, 80); size = (120, 72) }
    box -- far
    round -- far
    dia -- far
  }`)).toJSON();
  const frame = (id: string) => requireElementById(drawing.elements, `${id}:frame`);
  const startOf = (index: number): Point => {
    const line = drawing.elements.filter((item) => item.type === "line")[index];
    assert.ok(line);
    return [line.x + line.points[0][0], line.y + line.points[0][1]];
  };
  const unit = (id: string, [x, y]: Point): Point => {
    const e = frame(id);
    return [(x - (e.x + e.width / 2)) / (e.width / 2), (y - (e.y + e.height / 2)) / (e.height / 2)];
  };

  const [bx, by] = unit("box", startOf(0));
  assert.ok(Math.abs(Math.max(Math.abs(bx), Math.abs(by)) - 1) < 0.001, "a box is met where the larger axis reaches 1");

  const [rx, ry] = unit("round", startOf(1));
  assert.ok(Math.abs(Math.hypot(rx, ry) - 1) < 0.001, `an ellipse is met on its own curve, got ${Math.hypot(rx, ry)}`);

  const [dx, dy] = unit("dia", startOf(2));
  assert.ok(Math.abs(Math.abs(dx) + Math.abs(dy) - 1) < 0.001, `a diamond is met on its own edge, got ${Math.abs(dx) + Math.abs(dy)}`);
});

test("a plotted shape is met on the line it draws, not on its box", () => {
  // A stroke has points rather than a declared border, so its outline is the
  // only thing that can be intersected. Using the bounding box put a diagonal
  // connector 16% short of a plotted circle, the same error a native ellipse had.
  const drawing = compile(parse(`use "xdraw/math" as math
  diagram "Diagonal" {
    drawn: math.plot { at = (400, 400); x = 100 * cos(t); y = 100 * sin(t); t in [0, tau] }
    far: rectangle "far" { at = (760, 90); size = (120, 72) }
    drawn -- far
  }`)).toJSON();
  const stroke = requireElementById(drawing.elements, "drawn:stroke");
  const line = requireLinear(drawing.elements);
  const x = line.x + line.points[0][0];
  const y = line.y + line.points[0][1];
  const nx = (x - (stroke.x + stroke.width / 2)) / (stroke.width / 2);
  const ny = (y - (stroke.y + stroke.height / 2)) / (stroke.height / 2);
  assert.ok(
    Math.abs(Math.hypot(nx, ny) - 1) < 0.01,
    `should meet the drawn circle, got ${Math.hypot(nx, ny)}`,
  );
  // The box would have been reached well before the curve on this diagonal.
  assert.ok(Math.max(Math.abs(nx), Math.abs(ny)) < 0.95, "and not the bounding box");
});

test("a kind declares its border in its library manifest", () => {
  // The compiler used to hold the kind-to-border table, so a library could not
  // introduce a shape with its own border. It is manifest data now.
  const kinds = listLibraryManifests()
    .flatMap((library) => library.constructors)
    .filter((item) => item.lowering.border !== "box")
    .map((item) => `${item.name}:${item.lowering.border}`)
    .sort();
  assert.deepEqual(kinds, ["diamond:diamond", "ellipse:ellipse"]);
  // Anything that does not declare one is a box, which is what they all meant
  // before the field existed.
  assert.equal(borderOfElementKind("card"), "box");
  assert.equal(borderOfElementKind("architecture-database"), "box");
  assert.equal(borderOfElementKind("ellipse"), "ellipse");
  assert.equal(borderOfElementKind("decision"), "diamond");
});

test("an explicit anchor still means that side's midpoint", () => {
  const drawing = compile(parse(`diagram "Anchored" {
    hub: rectangle "" { at = (460, 260); size = (80, 80) }
    ne: rectangle "" { at = (700, 100); size = (80, 80) }
    hub@north -- ne@south
  }`)).toJSON();
  const line = requireLinear(drawing.elements);
  assert.deepEqual(
    [Math.round(line.x + line.points[0][0]), Math.round(line.y + line.points[0][1])],
    [500, 260],
  );
});

test("layer order lifts an element above what was drawn after it", () => {
  // Excalidraw has no z-index: depth is the order of the element array, and its
  // own front-and-back commands reorder that array. A badge sitting on a
  // connector needs exactly that, because connectors are drawn after the
  // elements they join and so cover anything placed on them.
  const source = (operation: string) => `diagram "Z" {
    a: rectangle "A" { at = (100, 300); size = (140, 90) }
    b: rectangle "B" { at = (500, 300); size = (140, 90) }
    mark: text "on the line" { at = (300, 330) }
    a -- b
    ${operation}
  }`;
  const orderOf = (operation: string) => compile(parse(source(operation))).toJSON()
    .elements.filter((item) => item.id === "mark" || item.type === "line")
    .map((item) => (item.type === "line" ? "line" : "mark"));

  // Without it the connector is drawn last and covers the label.
  assert.deepEqual(orderOf(""), ["mark", "line"]);
  assert.deepEqual(orderOf("bring-to-front (mark)"), ["line", "mark"]);
  assert.deepEqual(orderOf("send-to-back (mark)"), ["mark", "line"]);
  // Sending the connector back has the same effect from the other side.
  assert.deepEqual(orderOf("send-to-back (a, b)"), ["mark", "line"]);
});
