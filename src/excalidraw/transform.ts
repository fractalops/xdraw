import type { Bounds, Point } from "../contracts/foundation.ts";
import type { SceneTransform } from "../contracts/layout.ts";
import type { DrawingElement } from "../contracts/render.ts";

function localScaleFor(element: DrawingElement, scaleX: number, scaleY: number): Point {
  const cosine = Math.abs(Math.cos(element.angle));
  const sine = Math.abs(Math.sin(element.angle));
  const epsilon = 1e-9;
  if (Math.abs(scaleX - scaleY) < epsilon || sine < epsilon) return [scaleX, scaleY];
  if (cosine < epsilon) return [scaleY, scaleX];
  throw new Error("match-size cannot anisotropically resize nodes rotated outside quarter turns");
}

function scaleElementPoints(element: DrawingElement, scaleX: number, scaleY: number): void {
  if (element.type !== "arrow" && element.type !== "line" && element.type !== "freedraw") return;
  element.points = element.points.map(([x, y]) => [x * scaleX, y * scaleY]);
}

function resizeElements(elements: readonly DrawingElement[], from: Bounds, to: Bounds): void {
  const scaleX = from.width ? to.width / from.width : 1;
  const scaleY = from.height ? to.height / from.height : 1;
  for (const element of elements) {
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const nextCenterX = to.x + (centerX - from.x) * scaleX;
    const nextCenterY = to.y + (centerY - from.y) * scaleY;
    const [localScaleX, localScaleY] = localScaleFor(element, scaleX, scaleY);
    element.width *= localScaleX;
    element.height *= localScaleY;
    scaleElementPoints(element, localScaleX, localScaleY);
    element.x = nextCenterX - element.width / 2;
    element.y = nextCenterY - element.height / 2;
  }
}

function rotateElements(elements: readonly DrawingElement[], bounds: Bounds, angle: number): void {
  if (!angle) return;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  for (const element of elements) {
    const elementCenterX = element.x + element.width / 2;
    const elementCenterY = element.y + element.height / 2;
    const dx = elementCenterX - centerX;
    const dy = elementCenterY - centerY;
    const rotatedCenterX = centerX + dx * cosine - dy * sine;
    const rotatedCenterY = centerY + dx * sine + dy * cosine;
    element.x = rotatedCenterX - element.width / 2;
    element.y = rotatedCenterY - element.height / 2;
    element.angle += angle;
  }
}

/** Apply a planned scene transform atomically while its target elements are emitted. */
export function applySceneTransform(
  elements: readonly DrawingElement[],
  transform: SceneTransform | undefined,
): void {
  if (!transform) return;
  resizeElements(elements, transform.from, transform.to);
  rotateElements(elements, transform.to, transform.angle);
}
