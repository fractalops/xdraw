import { isSemanticGeometryStatement as isGeometryStatement } from "../language/geometry-statements.ts";
import { solveGeometryConstraints, type GeometryEnvelope } from "../layout/constraints.ts";
import { resolveStablePathOperations, type GeometryEnvironment } from "./geometry-references.ts";
import { analyzeRelativeCoordinate, analyzeRelativePoint, type RelativePositionConstraint } from "../language/relative-position.ts";
import type { AlignmentMode, Bounds } from "../contracts/foundation.ts";
import type { GeometryStatement, RenderableGeometryStatement, SemanticStatement } from "../contracts/semantic.ts";
import type { SceneGraph, SceneLayerOperation, SceneVisual } from "../contracts/layout.ts";

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
  if (statement.type === "layer" && (statement.mode === "front" || statement.mode === "back")) {
    return { ...statement, type: "layer", mode: statement.mode };
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

function nodeRelativePosition(statement: SemanticStatement): RelativePositionConstraint | null {
  if (statement.type !== "node") return null;
  const at = statement.at;
  if (typeof at === "string") return { id: statement.id, ...analyzeRelativePoint(at) };
  if (!Array.isArray(at) || at.length !== 2 || !at.some((coordinate) => typeof coordinate === "string")) return null;
  return {
    id: statement.id,
    x: analyzeRelativeCoordinate(at[0]),
    y: analyzeRelativeCoordinate(at[1]),
  };
}

function attachmentRelativePosition(
  statement: SemanticStatement,
  available: ReadonlySet<string>,
  geometry?: GeometryEnvironment,
): RelativePositionConstraint | null {
  if (statement.type !== "attachment" || !available.has(statement.moving)) return null;
  const source = geometry
    ? resolveStablePathOperations(statement.target, geometry, `attachment '${statement.moving}.${statement.anchor}'`)
    : statement.target;
  const point = analyzeRelativePoint(source);
  const horizontal = statement.anchor.includes("west") || statement.anchor === "origin" ? 0
    : statement.anchor.includes("east") ? 1 : 0.5;
  const vertical = statement.anchor.startsWith("north") || statement.anchor === "origin" ? 0
    : statement.anchor.startsWith("south") ? 1 : 0.5;
  if (horizontal) point.x.terms.push({ element: statement.moving, part: "width", coefficient: -horizontal });
  if (vertical) point.y.terms.push({ element: statement.moving, part: "height", coefficient: -vertical });
  return { id: statement.moving, ...point };
}

function relativePositions(
  statements: readonly SemanticStatement[],
  available: ReadonlySet<string>,
  geometry?: GeometryEnvironment,
  result: RelativePositionConstraint[] = [],
): RelativePositionConstraint[] {
  for (const statement of statements) {
    const placement = nodeRelativePosition(statement)
      ?? attachmentRelativePosition(statement, available, geometry);
    if (placement) result.push(placement);
    if (statement.statements) relativePositions(statement.statements, available, geometry, result);
  }
  return result;
}

export function geometryTargetIds(statements: readonly SemanticStatement[]): Set<string> {
  return new Set(geometryStatements(statements)
    .filter((statement) => statement.type !== "layer")
    .flatMap((statement) => [...statement.ids]));
}

function requiredBounds(scene: SceneGraph, id: string): Bounds {
  const bounds = scene.bounds.get(id);
  if (!bounds) throw new Error(`geometry operation references unplaced node: ${id}`);
  return bounds;
}

function updateSceneBounds(scene: SceneGraph, id: string, bounds: Bounds): void {
  scene.bounds.set(id, bounds);
  const record = scene.objects.get(id);
  if (record) record.bounds = bounds;
}

function sameBounds(left: Bounds, right: Bounds): boolean {
  return (["x", "y", "width", "height"] as const).every((key) => (
    Math.abs(left[key] - right[key]) < 1e-9
  ));
}

function updateSceneVisualBounds(
  scene: SceneGraph,
  id: string,
  previous: Bounds,
  next: Bounds,
): void {
  updateSceneBounds(scene, id, next);
  const visual = scene.visuals.find((item) => item.id === id);
  if (!visual) return;
  if (visual.type === "node") {
    if (previous.width !== next.width || previous.height !== next.height) {
      const rendered = { ...previous, x: next.x, y: next.y };
      visual.bounds = rendered;
      visual.transform = { from: rendered, to: next, angle: 0 };
    } else {
      visual.bounds = next;
    }
  } else if (visual.type === "container" || visual.type === "frame" || visual.type === "code") {
    visual.bounds = next;
  } else if (visual.type === "freedraw") {
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    visual.statement = {
      ...visual.statement,
      at: [visual.statement.at[0] + dx, visual.statement.at[1] + dy],
    };
    visual.bounds = next;
  } else if (visual.type === "text") {
    visual.position = [next.x, next.y];
  }
}

function statementWithIds(
  statement: RenderableGeometryStatement,
  ids: string[],
): RenderableGeometryStatement {
  return { ...statement, ids };
}

function hasEnoughTargets(statement: RenderableGeometryStatement): boolean {
  if (statement.type === "alignment" || statement.type === "match-size") return statement.ids.length >= 2;
  if (statement.type === "distribution") return statement.ids.length >= 3;
  return statement.ids.length > 0;
}

function projectLinearStatements(
  statements: readonly SemanticStatement[],
  targets: ReadonlySet<string>,
  keepRelationalPeers: boolean,
): RenderableGeometryStatement[] {
  const result: RenderableGeometryStatement[] = [];
  for (const statement of geometryStatements(statements)) {
    if (statement.type === "layer" || statement.type === "rotation") continue;
    const selected = statement.ids.filter((id) => targets.has(id));
    if (!selected.length) continue;
    const relational = statement.type === "alignment" || statement.type === "distribution";
    const projected = statementWithIds(statement, keepRelationalPeers && relational ? [...statement.ids] : selected);
    if (hasEnoughTargets(projected)) result.push(projected);
  }
  return result;
}

function boundedVisual(scene: SceneGraph, id: string): SceneVisual & { bounds: Bounds } {
  const visual = scene.visuals.find((item) => item.id === id);
  if (!visual || !("bounds" in visual)) {
    throw new Error(`geometry operation found no scene visual for: ${id}`);
  }
  return visual;
}

function rotatedBounds(bounds: Bounds, angle: number): Bounds {
  const cosine = Math.abs(Math.cos(angle));
  const sine = Math.abs(Math.sin(angle));
  const width = bounds.width * cosine + bounds.height * sine;
  const height = bounds.width * sine + bounds.height * cosine;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

function rotationEnvelopes(
  bounds: ReadonlyMap<string, Bounds>,
  statements: readonly SemanticStatement[],
  targets: ReadonlySet<string>,
): ReadonlyMap<string, GeometryEnvelope> {
  const angles = new Map<string, number>();
  for (const statement of geometryStatements(statements)) {
    if (statement.type !== "rotation") continue;
    const radians = statement.degrees * Math.PI / 180;
    for (const id of statement.ids) {
      if (targets.has(id)) angles.set(id, (angles.get(id) ?? 0) + radians);
    }
  }
  const result = new Map<string, GeometryEnvelope>();
  for (const [id, angle] of angles) {
    const linear = bounds.get(id);
    if (!linear) continue;
    const rotated = rotatedBounds(linear, angle);
    result.set(id, {
      left: linear.x - rotated.x,
      right: rotated.x + rotated.width - (linear.x + linear.width),
      top: linear.y - rotated.y,
      bottom: rotated.y + rotated.height - (linear.y + linear.height),
    });
  }
  return result;
}

function planRotations(
  scene: SceneGraph,
  statements: readonly SemanticStatement[],
  targets: ReadonlySet<string>,
): void {
  for (const statement of geometryStatements(statements)) {
    if (statement.type !== "rotation") continue;
    const radians = statement.degrees * Math.PI / 180;
    for (const id of statement.ids.filter((candidate) => targets.has(candidate))) {
      const visual = boundedVisual(scene, id);
      const linear = visual.transform?.to ?? visual.bounds;
      const angle = (visual.transform?.angle ?? 0) + radians;
      visual.transform = { from: visual.transform?.from ?? linear, to: linear, angle };
      updateSceneBounds(scene, id, rotatedBounds(linear, angle));
    }
  }
}

export interface SceneGeometryOptions {
  targets?: ReadonlySet<string>;
  keepRelationalPeers?: boolean;
  includeRelativePositions?: boolean;
  includeLayoutRelations?: boolean;
  fixed?: ReadonlySet<string>;
  attachmentEnvironment?: GeometryEnvironment;
}

/** Solve and record final geometry while the scene is still renderer-independent data. */
export function solveSceneGeometry(
  scene: SceneGraph,
  statements: readonly SemanticStatement[],
  options: SceneGeometryOptions = {},
): void {
  const targets = options.targets ?? new Set(scene.bounds.keys());
  const selected = projectLinearStatements(statements, targets, options.keepRelationalPeers ?? false);
  const placements = options.includeRelativePositions === false
    ? []
    : relativePositions(statements, new Set(scene.bounds.keys()), options.attachmentEnvironment);
  const envelopes = rotationEnvelopes(scene.bounds, statements, targets);
  const includeRelationalLayout = placements.length > 0;
  const includeLayout = options.includeLayoutRelations ?? (includeRelationalLayout || envelopes.size > 0);
  const layout = includeLayout ? {
    containers: scene.containers,
    membership: scene.containerMembership,
    // A rotation needs containment but must not reactivate an arrangement's
    // already-consumed flow constraints. Relative placement does need the
    // original flows to remain coherent while it moves boxes.
    flows: includeRelationalLayout ? scene.layoutFlows : [],
    envelopes,
    containmentTargets: includeRelationalLayout ? undefined : new Set(envelopes.keys()),
  } : undefined;
  const solved = solveGeometryConstraints(
    scene.bounds,
    selected,
    placements,
    layout,
    options.fixed,
  );
  let changed = false;
  for (const [id, next] of solved) {
    const previous = requiredBounds(scene, id);
    if (!sameBounds(previous, next)) {
      changed = true;
      updateSceneVisualBounds(scene, id, previous, next);
    }
  }
  if (geometryStatements(statements).some((statement) => statement.type === "rotation"
      && statement.ids.some((id) => targets.has(id)))) changed = true;
  planRotations(scene, statements, targets);
  // Adapter routes were computed against pre-constraint bounds. Let the final
  // router derive fresh waypoints whenever precision geometry changed them.
  if (changed) scene.adapterRoutes.clear();
}

/** Bounds of a detached stroke before target-format point normalization. */
export function freedrawBounds(statement: { at: readonly [number, number]; points: readonly (readonly [number, number])[] }): Bounds {
  const xs = statement.points.map(([x]) => statement.at[0] + x);
  const ys = statement.points.map(([, y]) => statement.at[1] + y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

export function collectLayerOperations(statements: readonly SemanticStatement[]): SceneLayerOperation[] {
  return geometryStatements(statements).flatMap((statement) => (
    statement.type === "layer" ? [{ ids: [...statement.ids], mode: statement.mode }] : []
  ));
}
