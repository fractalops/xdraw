import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BUILTIN_LAYOUT } from "../src/builtin-layouts.js";
import { createMeasurer } from "../src/measurement.js";
import { createStyleResolver } from "../src/styles.js";
import { parse } from "../src/parser.js";
import {
  assertLayoutCapabilities,
  BUILTIN_LAYOUT_CAPABILITIES,
  createLayoutAdapter,
  createSceneGraph,
  layoutWithAdapter,
} from "../src/scene.ts";
import { buildSemanticIR } from "../src/semantic.js";

test("built-in layout capabilities are enforced", () => {
  assert.doesNotThrow(() => assertLayoutCapabilities(
    BUILTIN_LAYOUT_CAPABILITIES,
    ["nestedNodes", "explicitPorts"],
    "test",
  ));
  assert.throws(
    () => assertLayoutCapabilities({ ...BUILTIN_LAYOUT_CAPABILITIES, nestedNodes: false }, ["nestedNodes"], "test"),
    /test layout cannot draw nested containers/,
  );
});

test("layout adapters may return routes only when they declare ownership", () => {
  const document = buildSemanticIR(parse('diagram "Routes" { item: card "Item" }'));
  const state = createSceneGraph(document, {
    diagramWidth: 1120, contentWidth: 1120, annotationGutterWidth: 0, measurer: createMeasurer(),
  });
  const adapter = createLayoutAdapter({
    name: "routed",
    capabilities: { ...BUILTIN_LAYOUT_CAPABILITIES, edgeRouting: true },
    layoutDocument: () => ({
      bottom: 100,
      routes: [{ connectionIndex: 0, segmentIndex: 0, points: [[0, 0], [100, 0]] }],
    }),
  });
  layoutWithAdapter(adapter, { state }, [], { contentWidth: 1120, gap: 35, startY: 42 });
  assert.deepEqual(state.adapterRoutes.get("0:0"), [[0, 0], [100, 0]]);

  const invalid = createLayoutAdapter({
    name: "invalid-routed",
    capabilities: BUILTIN_LAYOUT_CAPABILITIES,
    layoutDocument: () => ({ bottom: 100, routes: [] }),
  });
  assert.throws(
    () => layoutWithAdapter(invalid, { state }, [], { contentWidth: 1120, gap: 35, startY: 42 }),
    /returned routes without edgeRouting capability/,
  );

  const malformed = createLayoutAdapter({
    name: "malformed-routed",
    capabilities: { ...BUILTIN_LAYOUT_CAPABILITIES, edgeRouting: true },
    layoutDocument: () => ({ bottom: 100, routes: [{ connectionIndex: 0, points: [[0, 0]] }] }),
  });
  assert.throws(
    () => layoutWithAdapter(malformed, { state }, [], { contentWidth: 1120, gap: 35, startY: 42 }),
    /returned invalid route geometry/,
  );
});

test("compiler orchestration does not own built-in section placement", async () => {
  const source = await readFile(new URL("../src/compiler.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /function (?:compile|layout)(?:Container|Tree|Sequence)/);
  assert.doesNotMatch(source, /routeConnection|inferredSides|ARROWHEADS/);
  assert.doesNotMatch(source, /function render(?:Node|FreeText)/);
  assert.match(source, /layoutWithAdapter/);
});

test("tree layouts register one routing obstacle per frame", async () => {
  const source = await readFile(new URL("../src/builtin-layouts.js", import.meta.url), "utf8");
  assert.equal(source.match(/state\.containers\.push\(frameId\)/g)?.length, 1);
});

test("layout requirements are derived from the semantic input", () => {
  const document = buildSemanticIR(parse('diagram "Fixed" { item: card "Item" at (10, 20) }'));
  const state = createSceneGraph(document, {
    diagramWidth: 1120,
    contentWidth: 1120,
    annotationGutterWidth: 0,
    measurer: createMeasurer(),
  });
  const adapter = createLayoutAdapter({
    name: "limited",
    capabilities: { ...BUILTIN_LAYOUT_CAPABILITIES, fixedPositions: false },
    layoutDocument: () => assert.fail("unsupported input must fail before layout"),
  });
  assert.throws(
    () => layoutWithAdapter(adapter, { state }, [], { contentWidth: 1120, gap: 35, startY: 42 }),
    /limited layout cannot draw explicit node placement/,
  );
});

test("layout populates a measured scene before Excalidraw adaptation", () => {
  const document = buildSemanticIR(parse('diagram "Scene" { lane flow "Flow" { item: card "Item" } }'));
  const state = createSceneGraph(document, {
    diagramWidth: 1120,
    contentWidth: 1120,
    annotationGutterWidth: 0,
    measurer: createMeasurer(),
  });
  const registerBounds = (graph, id, bounds) => graph.place(id, bounds);
  const result = layoutWithAdapter(BUILTIN_LAYOUT, { state, registerBounds }, [document.statements[0]], {
    contentWidth: 1120,
    gap: 35,
    startY: 42,
  });

  assert.ok(state.objects.get("flow").bounds);
  assert.ok(state.objects.get("item").bounds);
  assert.ok(state.visuals.length >= 2);
  assert.ok(state.visuals.every((visual) => visual.origin?.start?.line > 0));
  assert.equal(result.placements, state.bounds);
  assert.equal(result.visuals, state.visuals);
});

test("scene graph supplies resolved styles for adapter-generated node visuals", () => {
  const document = buildSemanticIR(parse('diagram "Scene" { item: system "Item" }'));
  const styles = createStyleResolver(document);
  const state = createSceneGraph(document, {
    diagramWidth: 1120,
    contentWidth: 1120,
    annotationGutterWidth: 0,
    measurer: createMeasurer(styles),
    styles,
  });
  const node = document.statements.find((item) => item.id === "item");
  state.addVisual({ type: "node", id: node.id, node, bounds: { x: 0, y: 0, width: 200, height: 100 } });
  assert.equal(state.visuals[0].style.strokeColor, "#2563eb");
});
