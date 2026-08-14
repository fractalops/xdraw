import { alignBounds, distributeBounds } from "./geometry.ts";
import type { AlignmentMode, Bounds, Point } from "./foundation-contracts.ts";
import type { GeometryStatement, RenderableGeometryStatement, SemanticStatement } from "./semantic-contracts.ts";
import type { SceneGraph } from "./layout-contracts.ts";
import type { Drawing } from "./document.ts";
import type { DrawingElement } from "./render-contracts.ts";

function isGeometryStatement(statement: SemanticStatement): statement is GeometryStatement {
  return ["alignment", "distribution", "offset", "match-size", "rotation", "snap"].includes(statement.type);
}

function isAlignmentMode(value: unknown): value is AlignmentMode {
  return typeof value === "string"
    && ["left", "center-x", "right", "top", "center-y", "bottom"].includes(value);
}

function isMatchSizeAxis(value: unknown): value is "width" | "height" | "both" {
  return value === "width" || value === "height" || value === "both";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function renderableGeometryStatement(statement: GeometryStatement): RenderableGeometryStatement {
  if (statement.type === "alignment" && isAlignmentMode(statement.mode)) {
    return { ...statement, type: "alignment", mode: statement.mode };
  }
  if (statement.type === "distribution" && (statement.axis === "x" || statement.axis === "y")) {
    return { ...statement, type: "distribution", axis: statement.axis };
  }
  if (statement.type === "offset" && Array.isArray(statement.by) && statement.by.length === 2 && statement.by.every(Number.isFinite)) {
    return { ...statement, type: "offset", by: statement.by };
  }
  if (statement.type === "match-size" && isMatchSizeAxis(statement.axis)) {
    return { ...statement, type: "match-size", axis: statement.axis };
  }
  if (statement.type === "rotation" && isFiniteNumber(statement.degrees)) {
    return { ...statement, type: "rotation", degrees: statement.degrees };
  }
  if (statement.type === "snap" && typeof statement.grid === "number" && statement.grid > 0) {
    return { ...statement, type: "snap", grid: statement.grid };
  }
  throw new Error(`invalid validated geometry statement: ${statement.type}`);
}

function geometryStatements(
  statements: readonly SemanticStatement[],
  result: RenderableGeometryStatement[] = [],
): RenderableGeometryStatement[] {
  for (const statement of statements) {
    if (isGeometryStatement(statement)) result.push(renderableGeometryStatement(statement));
    if (statement.statements) geometryStatements(statement.statements, result);
  }
  return result;
}

function requiredBounds(scene: SceneGraph, id: string): Bounds {
  const bounds = scene.bounds.get(id);
  if (!bounds) throw new Error(`geometry operation references unplaced node: ${id}`);
  return bounds;
}

function ownedElements(drawing: Drawing, id: string): DrawingElement[] {
  const elements = drawing.elements.filter((element) => element.id.startsWith(`${id}:`));
  if (!elements.length) throw new Error(`geometry operation found no rendered elements for node: ${id}`);
  return elements;
}

function moveSemanticNode(drawing: Drawing, scene: SceneGraph, id: string, bounds: Bounds): void {
  const previous = requiredBounds(scene, id);
  const dx = bounds.x - previous.x;
  const dy = bounds.y - previous.y;
  updateSceneBounds(scene, id, bounds);
  for (const element of ownedElements(drawing, id)) {
    element.x += dx;
    element.y += dy;
  }
}

function updateSceneBounds(scene: SceneGraph, id: string, bounds: Bounds): void {
  scene.bounds.set(id, bounds);
  const record = scene.objects.get(id);
  if (record) record.bounds = bounds;
}

function elementAabb(element: DrawingElement): Bounds {
  const cosine = Math.abs(Math.cos(element.angle));
  const sine = Math.abs(Math.sin(element.angle));
  const width = element.width * cosine + element.height * sine;
  const height = element.width * sine + element.height * cosine;
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

function unionBounds(bounds: readonly Bounds[]): Bounds {
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

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

function transformSemanticNode(drawing: Drawing, scene: SceneGraph, id: string, next: Bounds): void {
  const previous = requiredBounds(scene, id);
  const scaleX = previous.width ? next.width / previous.width : 1;
  const scaleY = previous.height ? next.height / previous.height : 1;
  const elements = ownedElements(drawing, id);
  for (const element of elements) {
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const nextCenterX = next.x + (centerX - previous.x) * scaleX;
    const nextCenterY = next.y + (centerY - previous.y) * scaleY;
    const [localScaleX, localScaleY] = localScaleFor(element, scaleX, scaleY);
    element.width *= localScaleX;
    element.height *= localScaleY;
    scaleElementPoints(element, localScaleX, localScaleY);
    element.x = nextCenterX - element.width / 2;
    element.y = nextCenterY - element.height / 2;
  }
  updateSceneBounds(scene, id, unionBounds(elements.map(elementAabb)));
}

function rotateSemanticNode(drawing: Drawing, scene: SceneGraph, id: string, radians: number): void {
  const previous = requiredBounds(scene, id);
  const centerX = previous.x + previous.width / 2;
  const centerY = previous.y + previous.height / 2;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const elements = ownedElements(drawing, id);
  for (const element of elements) {
    const elementCenterX = element.x + element.width / 2;
    const elementCenterY = element.y + element.height / 2;
    const dx = elementCenterX - centerX;
    const dy = elementCenterY - centerY;
    const rotatedCenterX = centerX + dx * cosine - dy * sine;
    const rotatedCenterY = centerY + dx * sine + dy * cosine;
    element.x = rotatedCenterX - element.width / 2;
    element.y = rotatedCenterY - element.height / 2;
    element.angle += radians;
  }
  updateSceneBounds(scene, id, unionBounds(elements.map(elementAabb)));
}

export function applyGeometryStatements(
  drawing: Drawing,
  scene: SceneGraph,
  statements: readonly SemanticStatement[],
): void {
  for (const statement of geometryStatements(statements)) {
    const bounds = statement.ids.map((id) => requiredBounds(scene, id));
    if (statement.type === "alignment" || statement.type === "distribution") {
      const resolved = statement.type === "alignment"
        ? alignBounds(bounds, statement.mode)
        : distributeBounds(bounds, statement.axis);
      statement.ids.forEach((id, index) => moveSemanticNode(drawing, scene, id, resolved[index]));
    } else if (statement.type === "offset") {
      statement.ids.forEach((id, index) => moveSemanticNode(drawing, scene, id, {
        ...bounds[index], x: bounds[index].x + statement.by[0], y: bounds[index].y + statement.by[1],
      }));
    } else if (statement.type === "match-size") {
      const reference = bounds[0];
      statement.ids.forEach((id, index) => transformSemanticNode(drawing, scene, id, {
        ...bounds[index],
        width: statement.axis === "height" ? bounds[index].width : reference.width,
        height: statement.axis === "width" ? bounds[index].height : reference.height,
      }));
    } else if (statement.type === "rotation") {
      const radians = statement.degrees * Math.PI / 180;
      statement.ids.forEach((id) => rotateSemanticNode(drawing, scene, id, radians));
    } else if (statement.type === "snap") {
      statement.ids.forEach((id, index) => moveSemanticNode(drawing, scene, id, {
        ...bounds[index],
        x: Math.round(bounds[index].x / statement.grid) * statement.grid,
        y: Math.round(bounds[index].y / statement.grid) * statement.grid,
      }));
    }
  }
}
