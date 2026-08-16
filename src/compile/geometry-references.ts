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
import { ExpressionError, evaluateExpression, freeNames, parseExpression } from "../language/expression.ts";
import type { Bounds } from "../contracts/foundation.ts";
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

export interface GeometryEnvironment {
  /** Every name the expression may use, resolved on demand. */
  lookup(name: string): number | undefined;
  /** True when the name looks like a geometry reference at all. */
  describes(name: string): boolean;
}

/**
 * An environment backed by the placed boxes. Names are resolved on demand
 * rather than materialised: eight parts times every element in a document is a
 * lot of strings to build for the handful an expression actually uses.
 */
export function geometryEnvironment(bounds: ReadonlyMap<string, Bounds>): GeometryEnvironment {
  return {
    describes: (name) => splitReference(name) !== null,
    lookup: (name) => {
      const reference = splitReference(name);
      if (!reference) return undefined;
      const box = bounds.get(reference.element);
      return box ? partOf(box, reference.part) : undefined;
    },
  };
}

/**
 * Evaluates one expression against the placed boxes, naming what it could not
 * resolve rather than defaulting to zero.
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
  const values: Record<string, number> = {};
  for (const name of freeNames(node)) {
    const value = environment.lookup(name);
    if (value === undefined) {
      throw new GeometryReferenceError(
        environment.describes(name)
          ? `${owner}: no element '${splitReference(name)?.element}' to take '${splitReference(name)?.part}' from`
          : `${owner}: unknown name '${name}'`,
      );
    }
    values[name] = value;
  }
  const result = evaluateExpression(node, values);
  if (!Number.isFinite(result)) {
    throw new GeometryReferenceError(`${owner}: '${source}' is not a finite number`);
  }
  return result;
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
): void {
  const environment = geometryEnvironment(bounds);
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
