/**
 * Resolves expressions that name another element's geometry.
 *
 * `at = (flow.ingest.right + 40, flow.ingest.center_y)` needs numbers that do
 * not exist until measurement and layout have run, so unlike a `let` binding
 * this cannot be folded while the document is read. It runs after layout, over
 * the boxes the compiler actually produced.
 *
 * A referring element is placed absolutely, so it does not take part in the
 * layout it refers to. That is what keeps the dependency between names rather
 * than between placement and layout, which a symbol table could not see.
 */
import { type ExpressionNode, ExpressionError, evaluateExpression, formatExpression, freeNames, parseExpression } from "../language/expression.ts";
import { advance, demand } from "../language/deferred.ts";
import type { Bounds, Point } from "../contracts/foundation.ts";
import type { SemanticStatement } from "../contracts/semantic.ts";

/** The parts of a box an expression may name. Closed, like every vocabulary. */
export const BOX_PARTS = Object.freeze([
  "left", "right", "top", "bottom", "width", "height", "center_x", "center_y",
] as const);

export type BoxPart = (typeof BOX_PARTS)[number];

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
    case "center_x": return bounds.x + bounds.width / 2;
    case "center_y": return bounds.y + bounds.height / 2;
  }
}

/**
 * Splits `flow.ingest.right` into an element and a part.
 *
 * A nested element is itself `flow.ingest`, so the name is ambiguous by
 * construction — `flow.ingest.right` could be element `flow.ingest` part
 * `right`, or element `flow` part `ingest.right`. The parts are a closed set of
 * eight and none contains a dot, so taking the last segment as the part is the
 * only reading that can be right.
 */
export function splitReference(name: string): { element: string; part: BoxPart } | null {
  const separator = name.lastIndexOf(".");
  if (separator <= 0) return null;
  const part = name.slice(separator + 1);
  if (!(BOX_PARTS as readonly string[]).includes(part)) return null;
  return { element: name.slice(0, separator), part: part as BoxPart };
}

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
  /** True when the name looks like a geometry reference at all. */
  describes(name: string): boolean;
  /** A point at a fraction along a named stroke. */
  along(id: string, fraction: number, axis: 0 | 1): number;
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
    describes: (name) => splitReference(name) !== null,
    lookup: (name) => {
      const reference = splitReference(name);
      if (!reference) return undefined;
      const box = bounds.get(reference.element);
      return box ? partOf(box, reference.part) : undefined;
    },
    along: (id, fraction, axis) => {
      const points = strokes.get(id);
      if (!points) {
        throw new GeometryReferenceError(
          bounds.has(id)
            ? `along expects a stroke, and '${id}' is not one`
            : `along names '${id}', which is not a stroke in this document`,
        );
      }
      return pointAlong(points, fraction)[axis];
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
  let node;
  try {
    node = parseExpression(source);
  } catch (error) {
    const detail = error instanceof ExpressionError ? error.message : String(error);
    throw new GeometryReferenceError(`${owner}: '${source}' is not a valid expression: ${detail}`);
  }
  const resolved = resolveAlongCalls(node, environment, owner);
  const names = new Map<string, number>();
  for (const name of freeNames(resolved)) {
    const value = environment.lookup(name);
    if (value === undefined) {
      // A name that looks like a geometry reference gets the better message;
      // anything else is reported by the shared resolver, which names it and
      // says nobody defined it.
      if (environment.describes(name)) {
        const reference = splitReference(name);
        throw new GeometryReferenceError(
          `${owner}: no element '${reference?.element}' to take '${reference?.part}' from`,
        );
      }
      continue;
    }
    names.set(name, value);
  }
  const advanced = advance(formatExpression(resolved), names);
  const result = demand(advanced, owner);
  if (!Number.isFinite(result)) {
    throw new GeometryReferenceError(`${owner}: '${source}' is not a finite number`);
  }
  return result;
}

const ALONG = new Map([["along_x", 0], ["along_y", 1]] as const);

/**
 * Replaces every `along_x(curve, u)` with the number it resolves to.
 *
 * The first argument names a stroke rather than a value, so it cannot be an
 * ordinary free name — it would be reported unknown. Rewriting the call to a
 * number keeps the rest of evaluation entirely conventional.
 */
function resolveAlongCalls(
  node: ExpressionNode,
  environment: GeometryEnvironment,
  owner: string,
): ExpressionNode {
  switch (node.kind) {
    case "call": {
      const axis = ALONG.get(node.name as "along_x" | "along_y");
      if (axis === undefined) {
        return { ...node, args: node.args.map((argument) => resolveAlongCalls(argument, environment, owner)) };
      }
      const [target, fraction] = node.args;
      if (node.args.length !== 2 || target?.kind !== "name") {
        throw new GeometryReferenceError(`${owner}: ${node.name} takes a stroke and a fraction from 0 to 1`);
      }
      const resolved = resolveAlongCalls(fraction, environment, owner);
      const value = environment.along(target.name, evaluateExpression(resolved, {}), axis);
      return { kind: "number", value };
    }
    case "negate": return { kind: "negate", operand: resolveAlongCalls(node.operand, environment, owner) };
    case "binary": return {
      ...node,
      left: resolveAlongCalls(node.left, environment, owner),
      right: resolveAlongCalls(node.right, environment, owner),
    };
    default: return node;
  }
}

/**
 * Resolves every `at` that was written as a pair of expressions, in place.
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
      const carrier = statement as unknown as { type: string; id?: string; at?: unknown[] };
      if ((carrier.type === "text" || carrier.type === "freedraw")
          && Array.isArray(carrier.at)
          && carrier.at.some((part) => typeof part === "string")) {
        const owner = `${carrier.type} '${carrier.id ?? "?"}'`;
        carrier.at = carrier.at.map((part) => (
          typeof part === "string" ? resolveGeometryExpression(part, environment, owner) : part
        ));
      }
      const children = (statement as { statements?: readonly SemanticStatement[] }).statements;
      if (Array.isArray(children)) visit(children);
    }
  };
  visit(statements);
}
