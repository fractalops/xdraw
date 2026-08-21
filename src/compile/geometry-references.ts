/**
 * Resolves expressions that name another element's geometry.
 *
 * `at = flow.ingest.east + (40, 0)` needs a point that does not exist until
 * measurement and layout have run, so unlike a constant `let` binding
 * this cannot be folded while the document is read. It runs after layout, over
 * the boxes the compiler actually produced.
 *
 * This pass handles detached text, plot, and freehand positions. Relative node
 * positions participate in layout and are handled as linear relations by the
 * geometry solver instead.
 */
import {
  type ExpressionNode,
  type ExpressionValue,
  ExpressionError,
  TYPED_FUNCTIONS,
  evaluateValueExpression,
  expressionPathReferences,
  foldConstantExpressions,
  formatExpression,
  freeNames,
  parseExpression,
} from "../language/expression.ts";
import { splitAnchorName, splitGeometryName, type BoxPart, type GeometryAnchor } from "../language/geometry-names.ts";
import type { Bounds, Point } from "../contracts/foundation.ts";
import type { SemanticStatement } from "../contracts/semantic.ts";

export { BOX_PARTS } from "../language/geometry-names.ts";
export type { BoxPart } from "../language/geometry-names.ts";

export class GeometryReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XDrawGeometryReferenceError";
  }
}

function partOf(bounds: Bounds, part: BoxPart): number {
  switch (part) {
    case "left": return bounds.x;
    case "right": return bounds.x + bounds.width;
    case "top": return bounds.y;
    case "bottom": return bounds.y + bounds.height;
    case "width": return bounds.width;
    case "height": return bounds.height;
  }
}

function anchorOf(bounds: Bounds, anchor: GeometryAnchor): Point {
  const x = anchor.includes("west") ? bounds.x
    : anchor.includes("east") ? bounds.x + bounds.width : bounds.x + bounds.width / 2;
  const y = anchor.startsWith("north") ? bounds.y
    : anchor.startsWith("south") ? bounds.y + bounds.height : bounds.y + bounds.height / 2;
  return [x, y];
}

/**
 * Splits `flow.ingest.bounds.right` into an element and a scalar bound. The
 * explicit namespace and closed part vocabulary keep dotted element IDs
 * unambiguous.
 */
export const splitReference = splitGeometryName;

/**
 * Walks a polyline by arc length and returns the point at `fraction` of its
 * total length.
 *
 * By length rather than by index, because the points are not evenly spaced: the
 * sampler puts them where a curve bends. Halfway along a spiral by index is
 * nowhere in particular; halfway by length is halfway along the line you can
 * see.
 */
export function pointAlong(points: readonly Point[], fraction: number): Point {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0];
  const segments: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
    segments.push(total);
  }
  if (total === 0) return points[0];
  const target = Math.max(0, Math.min(1, fraction)) * total;
  let index = segments.findIndex((distance) => distance >= target);
  if (index < 0) index = segments.length - 1;
  const before = index === 0 ? 0 : segments[index - 1];
  const span = segments[index] - before;
  const along = span === 0 ? 0 : (target - before) / span;
  const [x0, y0] = points[index];
  const [x1, y1] = points[index + 1];
  return [x0 + (x1 - x0) * along, y0 + (y1 - y0) * along];
}

export interface GeometryEnvironment {
  /** Every name the expression may use, resolved on demand. */
  lookup(name: string): number | undefined;
  point(name: string): Point | undefined;
  /** True when the name looks like a geometry reference at all. */
  describes(name: string): boolean;
  /** A point at a fraction along a named stroke. */
  path(id: string): readonly Point[];
}

/**
 * An environment backed by the placed boxes. Names are resolved on demand
 * rather than materialised: eight parts times every element in a document is a
 * lot of strings to build for the handful an expression actually uses.
 */
export function geometryEnvironment(
  bounds: ReadonlyMap<string, Bounds>,
  strokes: ReadonlyMap<string, readonly Point[]> = new Map(),
): GeometryEnvironment {
  return {
    describes: (name) => splitReference(name) !== null || splitAnchorName(name) !== null,
    lookup: (name) => {
      const reference = splitReference(name);
      if (!reference) return undefined;
      const box = bounds.get(reference.element);
      return box ? partOf(box, reference.part) : undefined;
    },
    point: (name) => {
      const reference = splitAnchorName(name);
      if (!reference) return undefined;
      const box = bounds.get(reference.element);
      return box ? anchorOf(box, reference.anchor) : undefined;
    },
    path: (id) => {
      const points = strokes.get(id);
      if (!points) {
        throw new GeometryReferenceError(
          bounds.has(id)
            ? `path functions require a drawn path, and '${id}' is not one`
            : `path function names '${id}', which is not a drawn path in this document`,
        );
      }
      return points;
    },
  };
}

/**
 * Evaluates one expression against the placed boxes.
 *
 * Layout is the last stage that can supply a name, so this is where a value
 * that is still waiting becomes a diagnostic rather than being carried further.
 */
export function resolveGeometryExpression(
  source: string,
  environment: GeometryEnvironment,
  owner: string,
): number {
  const result = resolveGeometryValue(source, environment, owner);
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new GeometryReferenceError(`${owner}: '${source}' is not a finite number`);
  }
  return result;
}

export function resolveGeometryPoint(
  source: string,
  environment: GeometryEnvironment,
  owner: string,
): Point {
  const result = resolveGeometryValue(source, environment, owner);
  if (!Array.isArray(result) || result.length !== 2 || !result.every(Number.isFinite)) {
    throw new GeometryReferenceError(`${owner}: '${source}' is not a point`);
  }
  return [...result] as Point;
}

function resolveGeometryValue(
  source: string,
  environment: GeometryEnvironment,
  owner: string,
): ExpressionValue {
  let node;
  try {
    node = parseExpression(source);
  } catch (error) {
    const detail = error instanceof ExpressionError ? error.message : String(error);
    throw new GeometryReferenceError(`${owner}: '${source}' is not a valid expression: ${detail}`);
  }
  const resolved = resolveGeometryNodes(node, environment, owner, true);
  try {
    return evaluateValueExpression(resolved, {});
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new GeometryReferenceError(`${owner}: ${detail}`);
  }
}

function isPathFunction(name: string): boolean {
  return TYPED_FUNCTIONS.get(name)?.parameters[0] === "path";
}

function numberNode(value: number): ExpressionNode {
  return { kind: "number", value };
}

function isPointValue(value: ExpressionValue): value is readonly [number, number] {
  return Array.isArray(value);
}

function pointNode([x, y]: readonly [number, number]): ExpressionNode {
  return { kind: "point", x: numberNode(x), y: numberNode(y) };
}

function pathLength(points: readonly Point[]): number {
  let result = 0;
  for (let index = 1; index < points.length; index += 1) {
    result += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
  }
  return result;
}

function tangentAlong(points: readonly Point[], fraction: number): Point | null {
  if (points.length < 2) return null;
  const epsilon = 1e-4;
  const before = pointAlong(points, Math.max(0, fraction - epsilon));
  const after = pointAlong(points, Math.min(1, fraction + epsilon));
  const length = Math.hypot(after[0] - before[0], after[1] - before[1]);
  return length === 0 ? null : [(after[0] - before[0]) / length, (after[1] - before[1]) / length];
}

/**
 * Replaces point, anchor, bound, and path operations with concrete values.
 *
 * A path argument remains symbolic until sampled points exist. Rewriting the
 * operation to a point or number here keeps ordinary expression evaluation
 * independent of compilation stages.
 */
function resolveProjection(
  node: Extract<ExpressionNode, { kind: "call" }>,
  environment: GeometryEnvironment,
  owner: string,
  resolveBoxes: boolean,
): ExpressionNode {
  const argument = resolveGeometryNodes(node.args[0], environment, owner, resolveBoxes);
  if (freeNames(argument).size) return { ...node, args: [argument] };
  const value = evaluateValueExpression(argument, {});
  if (!isPointValue(value)) throw new GeometryReferenceError(`${owner}: ${node.name} takes a point`);
  return numberNode(value[node.name === "x" ? 0 : 1]);
}

function resolvePathCall(
  node: Extract<ExpressionNode, { kind: "call" }>,
  environment: GeometryEnvironment,
  owner: string,
  resolveBoxes: boolean,
): ExpressionNode {
  const [target, parameter] = node.args;
  const signature = TYPED_FUNCTIONS.get(node.name)!;
  const needsParameter = signature.parameters.length === 2;
  if (target?.kind !== "name" || node.args.length !== signature.parameters.length) {
    throw new GeometryReferenceError(`${owner}: ${node.name} takes a path${needsParameter ? " and a fraction from 0 to 1" : ""}`);
  }
  const points = environment.path(target.name);
  const fractionValue = parameter
    ? evaluateValueExpression(resolveGeometryNodes(parameter, environment, owner, resolveBoxes), {}) : 0;
  if (parameter && typeof fractionValue !== "number") {
    throw new GeometryReferenceError(`${owner}: ${node.name} fraction must be a number`);
  }
  const fraction = typeof fractionValue === "number" ? fractionValue : 0;
  if (parameter && (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)) {
    throw new GeometryReferenceError(`${owner}: ${node.name} fraction must be finite and between 0 and 1`);
  }
  if (node.name === "along") return pointNode(pointAlong(points, fraction));
  if (node.name === "start") return pointNode(pointAlong(points, 0));
  if (node.name === "end") return pointNode(pointAlong(points, 1));
  if (node.name === "midpoint") return pointNode(pointAlong(points, 0.5));
  if (node.name === "tangent") {
    const tangent = tangentAlong(points, fraction);
    if (!tangent) throw new GeometryReferenceError(`${owner}: tangent is undefined on a zero-length path segment`);
    return pointNode(tangent);
  }
  return numberNode(pathLength(points));
}

function resolveCall(
  node: Extract<ExpressionNode, { kind: "call" }>,
  environment: GeometryEnvironment,
  owner: string,
  resolveBoxes: boolean,
): ExpressionNode {
  if ((node.name === "x" || node.name === "y") && node.args.length === 1) {
    return resolveProjection(node, environment, owner, resolveBoxes);
  }
  if (isPathFunction(node.name)) return resolvePathCall(node, environment, owner, resolveBoxes);
  return { ...node, args: node.args.map((argument) => resolveGeometryNodes(argument, environment, owner, resolveBoxes)) };
}

function resolveName(
  node: Extract<ExpressionNode, { kind: "name" }>,
  environment: GeometryEnvironment,
  owner: string,
  resolveBoxes: boolean,
): ExpressionNode {
  if (!resolveBoxes) return node;
  const scalar = environment.lookup(node.name);
  if (scalar !== undefined) return numberNode(scalar);
  const point = environment.point(node.name);
  if (point) return pointNode(point);
  const reference = splitReference(node.name) ?? splitAnchorName(node.name);
  if (reference) throw new GeometryReferenceError(`${owner}: no element '${reference.element}' for '${node.name}'`);
  return node;
}

function resolveGeometryNodes(
  node: ExpressionNode,
  environment: GeometryEnvironment,
  owner: string,
  resolveBoxes: boolean,
): ExpressionNode {
  switch (node.kind) {
    case "call": return resolveCall(node, environment, owner, resolveBoxes);
    case "name": return resolveName(node, environment, owner, resolveBoxes);
    case "point": return {
      kind: "point",
      x: resolveGeometryNodes(node.x, environment, owner, resolveBoxes),
      y: resolveGeometryNodes(node.y, environment, owner, resolveBoxes),
    };
    case "negate": return { kind: "negate", operand: resolveGeometryNodes(node.operand, environment, owner, resolveBoxes) };
    case "binary": return {
      ...node,
      left: resolveGeometryNodes(node.left, environment, owner, resolveBoxes),
      right: resolveGeometryNodes(node.right, environment, owner, resolveBoxes),
    };
    default: return node;
  }
}

/** Resolve stable path operations while preserving live placed-box terms for the constraint solve. */
export function resolveStablePathOperations(
  source: string,
  environment: GeometryEnvironment,
  owner: string,
): string {
  let node: ExpressionNode;
  try {
    node = parseExpression(source);
  } catch (error) {
    const detail = error instanceof ExpressionError ? error.message : String(error);
    throw new GeometryReferenceError(`${owner}: '${source}' is not a valid expression: ${detail}`);
  }
  return formatExpression(foldConstantExpressions(resolveGeometryNodes(node, environment, owner, false)));
}

/** Path identities consumed by path functions in detached positions. */
export function geometryStrokeReferences(statements: readonly SemanticStatement[]): Set<string> {
  const result = new Set<string>();
  const visit = (items: readonly SemanticStatement[]): void => {
    for (const statement of items) {
      const positions = typeof statement.at === "string" ? [statement.at] : statement.at ?? [];
      const expressions = statement.type === "attachment" ? [...positions, statement.target] : positions;
      for (const expression of expressions) {
        if (typeof expression !== "string") continue;
        try { expressionPathReferences(parseExpression(expression), result); } catch { /* resolved with context later */ }
      }
      const children = statement.statements;
      if (Array.isArray(children)) visit(children);
    }
  };
  visit(statements);
  return result;
}

/**
 * Resolves every detached `at` expression in place.
 *
 * Only the detached kinds are considered. A node placed with `at` takes part in
 * document layout, so resolving one against a box it had already displaced
 * would need resolving again — the dependency would be between placement and
 * layout rather than between two names, which no symbol table can see.
 */
export function resolveGeometryReferences(
  statements: readonly SemanticStatement[],
  bounds: ReadonlyMap<string, Bounds>,
  strokes: ReadonlyMap<string, readonly Point[]> = new Map(),
): void {
  const environment = geometryEnvironment(bounds, strokes);
  const visit = (items: readonly SemanticStatement[]): void => {
    for (const statement of items) {
      if ((statement.type === "text" || statement.type === "freedraw") && typeof statement.at === "string") {
        const owner = `${statement.type} '${statement.id}'`;
        statement.at = resolveGeometryPoint(statement.at, environment, owner);
      }
      if ((statement.type === "text" || statement.type === "freedraw")
          && Array.isArray(statement.at)
          && statement.at.some((part) => typeof part === "string")) {
        const owner = `${statement.type} '${statement.id}'`;
        const [x, y] = statement.at;
        statement.at = [
          typeof x === "string" ? resolveGeometryExpression(x, environment, owner) : x,
          typeof y === "string" ? resolveGeometryExpression(y, environment, owner) : y,
        ];
      }
      const children = statement.statements;
      if (Array.isArray(children)) visit(children);
    }
  };
  visit(statements);
}
