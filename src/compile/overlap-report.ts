import { measureRouteQuality } from "../routing/quality.ts";
import type { DiagnosticCollector, Bounds, Point, Route } from "../contracts/foundation.ts";
import type { SceneGraph } from "../contracts/layout.ts";
import type { DrawingElement, LinearElement } from "../contracts/render.ts";

function overlapArea(left: Bounds, right: Bounds): number {
  return Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x))
    * Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
}

function isLinear(element: DrawingElement): element is LinearElement {
  return element.type === "arrow" || element.type === "line";
}

function bindingElementId(state: SceneGraph, id: string): string {
  if (state.visuals.find((visual) => visual.id === id)?.type === "frame") return id;
  const semantic = state.objects.get(id)?.semantic;
  if (semantic && typeof semantic === "object" && "type" in semantic) {
    if (semantic.type === "freedraw") return `${id}:stroke`;
    if (semantic.type === "image" || semantic.type === "icon" || semantic.type === "text" || semantic.type === "layout-text") return id;
  }
  return `${id}:frame`;
}

/** Report overlaps that are not explained by containment or connector binding. */
export function reportSceneOverlaps(
  state: SceneGraph,
  elements: readonly DrawingElement[],
  diagnostics: DiagnosticCollector,
): void {
  const nodes = [...state.nodeIds].filter((id) => state.bounds.has(id));
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const leftId = nodes[leftIndex];
      const rightId = nodes[rightIndex];
      if ((state.containerMembership.get(leftId) ?? null) !== (state.containerMembership.get(rightId) ?? null)) continue;
      const area = overlapArea(state.bounds.get(leftId)!, state.bounds.get(rightId)!);
      if (area <= 0) continue;
      diagnostics.remark(
        "XD3002",
        `siblings '${leftId}' and '${rightId}' overlap by ${Math.round(area)}px²`,
        state.origins.get(leftId) ?? null,
        { subjects: [leftId, rightId] },
      );
    }
  }

  const nodeElements = new Map(nodes.map((id) => [bindingElementId(state, id), id]));
  for (const connector of elements.filter((element): element is LinearElement => (
    isLinear(element) && element.id.includes(":connection:")
  ))) {
    const route = connector.points.map(([x, y]): Point => [x + connector.x, y + connector.y]) as Route;
    const endpoints = new Set([
      connector.startBinding?.elementId,
      connector.endBinding?.elementId,
    ].filter((id): id is string => typeof id === "string"));
    for (const [elementId, nodeId] of nodeElements) {
      if (endpoints.has(elementId)) continue;
      const bounds = state.bounds.get(nodeId)!;
      if (measureRouteQuality([route], [bounds]).obstacleIntersections === 0) continue;
      diagnostics.remark(
        "XD3002",
        `connector '${connector.id}' crosses unrelated node '${nodeId}'`,
        state.origins.get(nodeId) ?? null,
        { subjects: [connector.id, nodeId] },
      );
    }
  }
}
