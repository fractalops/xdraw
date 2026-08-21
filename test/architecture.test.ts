import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BUILTIN_LAYOUT } from "../src/layout/builtin.ts";
import { createMeasurer } from "../src/compile/measurement.ts";
import { createStyleResolver } from "../src/compile/styles.ts";
import { parseSource as parse } from "../src/language/parser.ts";
import {
  assertLayoutCapabilities,
  BUILTIN_LAYOUT_CAPABILITIES,
  createLayoutAdapter,
  createSceneGraph,
  layoutWithAdapter,
} from "../src/compile/scene.ts";
import { buildSemanticIR } from "../src/language/semantic.ts";
import type { Bounds } from "../src/contracts/foundation.ts";
import type { SceneGraph } from "../src/contracts/layout.ts";

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
  const document = buildSemanticIR(parse('diagram "Routes" { source: rectangle "Source"; target: rectangle "Target"; source -> target }'));
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
    layoutDocument: () => ({ bottom: 100, routes: [{ connectionIndex: 0, points: [[0, 0]] as never }] }),
  });
  assert.throws(
    () => layoutWithAdapter(malformed, { state }, [], { contentWidth: 1120, gap: 35, startY: 42 }),
    /returned invalid route geometry/,
  );

  for (const [connectionIndex, segmentIndex] of [[-1, 0], [99, 0], [0, 99]]) {
    const unowned = createLayoutAdapter({
      name: "unowned-route",
      capabilities: { ...BUILTIN_LAYOUT_CAPABILITIES, edgeRouting: true },
      layoutDocument: () => ({
        bottom: 100,
        routes: [{ connectionIndex, segmentIndex, points: [[0, 0], [100, 0]] }],
      }),
    });
    assert.throws(
      () => layoutWithAdapter(unowned, { state }, [], { contentWidth: 1120, gap: 35, startY: 42 }),
      /route without a matching connection segment/,
    );
  }
});

test("compiler rendering delegates built-in section placement", async () => {
  const facade = await readFile(new URL("../src/compile/pipeline.ts", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/compile/render.ts", import.meta.url), "utf8");
  assert.doesNotMatch(facade, /layoutWithAdapter|routeConnection|inferredSides|ARROWHEADS/);
  assert.doesNotMatch(renderer, /function (?:compile|layout)(?:Container|Tree|Sequence)/);
  assert.doesNotMatch(renderer, /routeConnection|inferredSides|ARROWHEADS/);
  assert.doesNotMatch(renderer, /function render(?:Node|FreeText)/);
  assert.match(renderer, /layoutWithAdapter/);
});

test("tree layouts register one routing obstacle per rendered tree", () => {
  const document = buildSemanticIR(parse(`
    diagram "Tree" {
      map: section "Map" {
        arrange tree { root = root }
        root: rectangle "Root"
        child: rectangle "Child"
        root -> child
      }
    }
  `));
  const styles = createStyleResolver(document);
  const state = createSceneGraph(document, {
    diagramWidth: 1120,
    contentWidth: 1120,
    annotationGutterWidth: 0,
    measurer: createMeasurer(styles),
    styles,
  });
  const registerBounds = (graph: SceneGraph, id: string, bounds: Bounds) => graph.place(id, bounds);
  const tree = document.statements.find((item) => item.type === "tree");
  assert.ok(tree);
  layoutWithAdapter(BUILTIN_LAYOUT, { state, registerBounds }, [tree], {
    contentWidth: 1120,
    gap: 35,
    startY: 42,
  });

  assert.deepEqual(state.containers, ["map"]);
  assert.ok(state.bounds.has("map"));
  assert.ok(state.bounds.has("map.root"));
  assert.ok(state.bounds.has("map.child"));
  assert.equal(state.visuals.filter((visual) => visual.type === "container" && visual.id === "map").length, 1);
});

test("layout requirements are derived from the semantic input", () => {
  const document = buildSemanticIR(parse('diagram "Fixed" { item: rectangle "Item" { at = (10, 20) } }'));
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
  const document = buildSemanticIR(parse('diagram "Scene" { flow: frame "Flow" { item: rectangle "Item" } }'));
  const styles = createStyleResolver(document);
  const state = createSceneGraph(document, {
    diagramWidth: 1120,
    contentWidth: 1120,
    annotationGutterWidth: 0,
    measurer: createMeasurer(styles),
    styles,
  });
  const registerBounds = (graph: SceneGraph, id: string, bounds: Bounds) => graph.place(id, bounds);
  const statement = document.statements[0];
  assert.ok(statement);
  const result = layoutWithAdapter(BUILTIN_LAYOUT, { state, registerBounds }, [statement], {
    contentWidth: 1120,
    gap: 35,
    startY: 42,
  });

  assert.ok(state.objects.get("flow")?.bounds);
  assert.ok(state.objects.get("flow.item")?.bounds);
  assert.ok(state.visuals.length >= 2);
  assert.ok(state.visuals.every((visual) => (visual.origin?.start?.line ?? 0) > 0));
  assert.equal(result.placements, state.bounds);
  assert.equal(result.visuals, state.visuals);
});

test("scene graph supplies resolved styles for adapter-generated node visuals", () => {
  const document = buildSemanticIR(parse(`use "xdraw/architecture" as arch
    diagram "Scene" { item: arch.system "Item" }`));
  const styles = createStyleResolver(document);
  const state = createSceneGraph(document, {
    diagramWidth: 1120,
    contentWidth: 1120,
    annotationGutterWidth: 0,
    measurer: createMeasurer(styles),
    styles,
  });
  const node = document.statements.find((item) => item.id === "item");
  assert.ok(node?.type === "node");
  state.addVisual({ type: "node", id: node.id, node, bounds: { x: 0, y: 0, width: 200, height: 100 } });
  const visual = state.visuals[0];
  assert.equal(visual?.type === "node" ? visual.style.strokeColor : undefined, "#2563eb");
});
