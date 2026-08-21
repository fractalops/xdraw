import { renderableFreedraw } from "../excalidraw/adapter.ts";
import { isFinitePoint } from "../excalidraw/freedraw-policy.ts";
import type { Point } from "../contracts/foundation.ts";
import type { SceneGraph } from "../contracts/layout.ts";
import type { FreedrawStatement, SemanticDocument, SemanticStatement } from "../contracts/semantic.ts";
import {
  freedrawBounds,
  geometryTargetIds,
  solveSceneGeometry,
} from "./geometry-pass.ts";
import {
  GeometryReferenceError,
  geometryEnvironment,
  geometryStrokeReferences,
  resolveGeometryPoint,
  resolveGeometryReferences,
} from "./geometry-references.ts";

interface DetachedStatement<T extends SemanticStatement> {
  statement: T;
  frameId: string | null;
  locked: boolean;
}

function isFreedraw(statement: SemanticStatement): statement is FreedrawStatement {
  return statement.type === "freedraw";
}

function detached<T extends SemanticStatement>(
  statements: readonly SemanticStatement[],
  accepts: (statement: SemanticStatement) => statement is T,
  result: DetachedStatement<T>[] = [],
  frameId: string | null = null,
  locked = false,
): DetachedStatement<T>[] {
  for (const statement of statements) {
    if (accepts(statement)) result.push({ statement, frameId, locked });
    const childFrame = statement.type === "frame" ? statement.id : frameId;
    const childLocked = locked || (statement.type === "frame" && statement.attributes?.locked === true);
    if (statement.statements) detached(statement.statements, accepts, result, childFrame, childLocked);
  }
  return result;
}

function authoredStrokes(scene: SemanticDocument): Map<string, readonly Point[]> {
  const strokes = new Map<string, readonly Point[]>();
  for (const { statement } of detached(scene.statements, isFreedraw)) {
    if (!isFinitePoint(statement.at)) continue;
    const [originX, originY] = statement.at;
    strokes.set(statement.id, statement.points.map(([x, y]) => [originX + x, originY + y]));
  }
  return strokes;
}

function validateReadableStrokes(
  statements: readonly DetachedStatement<FreedrawStatement>[],
  readStrokes: ReadonlySet<string>,
  geometryTargets: ReadonlySet<string>,
  attachmentTargets: ReadonlySet<string>,
): void {
  for (const { statement } of statements) {
    if (!readStrokes.has(statement.id)) continue;
    if (!isFinitePoint(statement.at)) {
      throw new GeometryReferenceError(
        `stroke '${statement.id}' cannot be read with along because its own position is a geometry reference`,
      );
    }
    if (geometryTargets.has(statement.id)) {
      throw new GeometryReferenceError(
        `stroke '${statement.id}' cannot be read with along because a geometry statement moves it`,
      );
    }
    if (attachmentTargets.has(statement.id)) {
      throw new GeometryReferenceError(
        `path '${statement.id}' cannot be read while an attachment also moves it`,
      );
    }
  }
}

function addStrokeVisuals(
  state: SceneGraph,
  statements: readonly DetachedStatement<FreedrawStatement>[],
): void {
  for (const { statement, frameId, locked } of statements) {
    const renderable = renderableFreedraw(statement);
    const bounds = freedrawBounds(renderable);
    if (state.bounds.has(statement.id)) throw new Error(`duplicate semantic id: ${statement.id}`);
    state.place(statement.id, bounds);
    state.addVisual({
      type: "freedraw",
      id: statement.id,
      source: statement.semanticId,
      statement: renderable,
      bounds,
      frameId,
      locked,
    });
  }
}

function applyAttachments(
  state: SceneGraph,
  attachments: readonly Extract<SemanticStatement, { type: "attachment" }>[],
  strokes: ReadonlyMap<string, readonly Point[]>,
): void {
  const environment = geometryEnvironment(state.bounds, strokes);
  for (const attachment of attachments) {
    const visual = state.visuals.find((item) => item.id === attachment.moving && item.type === "freedraw");
    if (!visual || visual.type !== "freedraw") continue;
    const target = resolveGeometryPoint(
      attachment.target,
      environment,
      `attachment '${attachment.moving}.${attachment.anchor}'`,
    );
    const horizontal = attachment.anchor.includes("west") || attachment.anchor === "origin" ? 0
      : attachment.anchor.includes("east") ? 1 : 0.5;
    const vertical = attachment.anchor.startsWith("north") || attachment.anchor === "origin" ? 0
      : attachment.anchor.startsWith("south") ? 1 : 0.5;
    const current: Point = attachment.anchor === "origin"
      ? [...visual.statement.at]
      : [
        visual.bounds.x + visual.bounds.width * horizontal,
        visual.bounds.y + visual.bounds.height * vertical,
      ];
    const dx = target[0] - current[0];
    const dy = target[1] - current[1];
    visual.statement = { ...visual.statement, at: [visual.statement.at[0] + dx, visual.statement.at[1] + dy] };
    visual.bounds = { ...visual.bounds, x: visual.bounds.x + dx, y: visual.bounds.y + dy };
    state.bounds.set(visual.id, visual.bounds);
  }
}

function recordStrokePoints(state: SceneGraph): void {
  for (const visual of state.visuals) {
    if (visual.type !== "freedraw") continue;
    const angle = visual.transform?.angle ?? 0;
    const center = visual.transform?.to ?? visual.bounds;
    const centerX = center.x + center.width / 2;
    const centerY = center.y + center.height / 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    state.strokePoints.set(visual.id, visual.statement.points.map(([x, y]) => {
      const dx = visual.statement.at[0] + x - centerX;
      const dy = visual.statement.at[1] + y - centerY;
      return [centerX + dx * cosine - dy * sine, centerY + dx * sine + dy * cosine];
    }));
  }
}

function planDetachedStrokes(state: SceneGraph, scene: SemanticDocument): void {
  const statements = detached(scene.statements, isFreedraw);
  const ids = new Set(statements.map(({ statement }) => statement.id));
  const readStrokes = geometryStrokeReferences(scene.statements);
  const geometryTargets = geometryTargetIds(scene.statements);
  const attachments = detached(
    scene.statements,
    (statement): statement is Extract<SemanticStatement, { type: "attachment" }> => statement.type === "attachment",
  ).map(({ statement }) => statement);
  const attachmentTargets = new Set(attachments.map((attachment) => attachment.moving));
  validateReadableStrokes(statements, readStrokes, geometryTargets, attachmentTargets);
  const strokes = authoredStrokes(scene);
  resolveGeometryReferences(scene.statements, state.bounds, strokes);
  addStrokeVisuals(state, statements);
  applyAttachments(state, attachments, strokes);
  const fixed = new Set([...state.bounds.keys()].filter((id) => !ids.has(id)));
  solveSceneGeometry(state, scene.statements, {
    targets: ids,
    keepRelationalPeers: true,
    includeRelativePositions: false,
    includeLayoutRelations: false,
    fixed,
  });

  recordStrokePoints(state);
}

/**
 * Complete geometry planning before target-format emission. This is the one
 * ordering seam for box constraints, path dependencies, attachments, and
 * transformed stroke samples.
 */
export function planFinalGeometry(state: SceneGraph, scene: SemanticDocument): void {
  solveSceneGeometry(state, scene.statements, {
    attachmentEnvironment: geometryEnvironment(state.bounds, authoredStrokes(scene)),
  });
  planDetachedStrokes(state, scene);
}
