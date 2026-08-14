import assert from "node:assert/strict";

import type { ArrowElement, DrawingElement } from "../src/contracts/render.ts";

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
