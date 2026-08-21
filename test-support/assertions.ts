import assert from "node:assert/strict";

import type { ArrowElement, DrawingElement } from "../src/contracts/render.ts";
import type { SceneGraph } from "../src/contracts/layout.ts";
import { createMeasurer } from "../src/compile/measurement.ts";
import { parseSource } from "../src/language/parser.ts";
import { buildSemanticIR } from "../src/language/semantic.ts";

export function createTestSceneGraph(overrides: Partial<SceneGraph> = {}): SceneGraph {
  const graph: SceneGraph = {
    document: buildSemanticIR(parseSource('diagram "Test scene" {}')),
    measurer: createMeasurer(),
    capabilities: {
      nestedNodes: true,
      explicitPorts: true,
      crossContainerEdges: true,
      fixedPositions: true,
      fixedDimensions: true,
      edgeRouting: true,
      selfEdges: true,
      multiEdges: true,
      labels: true,
      disconnectedComponents: true,
    },
    objects: new Map(),
    origins: new Map(),
    bounds: new Map(),
    nodeIds: new Set(),
    containers: [],
    routes: [],
    adapterRoutes: new Map(),
    connections: [],
    annotations: [],
    labelBounds: [],
    strokePoints: new Map(),
    visuals: [],
    frameMembership: new Map(),
    containerMembership: new Map(),
    layoutFlows: [],
    frameLocks: new Map(),
    canvas: { left: 0, right: 1_200, top: 0 },
    annotationGutter: null,
    registerGenerated(id, semantic, origin = null) {
      const record = { id, semantic, origin, bounds: null, generated: true };
      graph.objects.set(id, record);
      graph.origins.set(id, origin);
      return record;
    },
    place(id, bounds, semantic) {
      const record = graph.registerGenerated(id, semantic);
      record.bounds = bounds;
      graph.bounds.set(id, bounds);
      return record;
    },
    addVisual(visual) {
      graph.visuals.push(visual as SceneGraph["visuals"][number]);
    },
    ...overrides,
  };
  return graph;
}

export function requireElementById(
  elements: readonly DrawingElement[],
  id: string,
): DrawingElement {
  const element = elements.find((item) => item.id === id);
  assert.ok(element, `missing drawing element: ${id}`);
  return element;
}

export function requireArrow(
  elements: readonly DrawingElement[],
  id?: string,
): ArrowElement {
  const element = elements.find((item) => item.type === "arrow" && (id === undefined || item.id === id));
  assert.ok(element?.type === "arrow", id ? `missing arrow: ${id}` : "missing arrow");
  return element;
}
