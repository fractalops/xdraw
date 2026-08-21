/**
 * Named values: a document may bind a value to a name and reuse it.
 *
 * Names resolve by what they depend on rather than by where they appear, so a
 * document reads in whatever order suits its author. That ordering is the only
 * subtle part, and it is what makes two failures possible: a cycle, and a name
 * that is used but never bound. Both are document errors carrying enough to
 * find them — a cycle reports the path that closes it, an unbound name reports
 * who used it — rather than looping or defaulting to zero.
 *
 * Scalar and point constants resolve while the document is read. Geometry
 * values, including path aliases, remain symbolic until layout and sampling
 * have produced the geometry they name.
 */
import {
  CONSTANTS,
  ExpressionError,
  FUNCTIONS,
  TYPED_FUNCTIONS,
  evaluateExpression,
  evaluateValueExpression,
  freeNames,
  inferExpressionKind,
  parseExpression,
  validateExpressionFunctions,
  type ExpressionNode,
} from "./expression.ts";

export class BindingError extends Error {
  /** The binding the problem belongs to, for a caller that can locate it. */
  readonly name: string;

  constructor(message: string, name: string) {
    super(message);
    this.name = "XDrawBindingError";
    this.binding = name;
  }

  readonly binding: string;
}

export interface SourceBinding {
  readonly name: string;
  readonly source: string;
}

interface ParsedBinding {
  readonly name: string;
  readonly node: ExpressionNode;
}

function parseAll(bindings: readonly SourceBinding[]): Map<string, ParsedBinding> {
  const parsed = new Map<string, ParsedBinding>();
  for (const { name, source } of bindings) {
    if (parsed.has(name)) {
      throw new BindingError(`'${name}' is bound more than once`, name);
    }
    // A binding that shadows a constant cannot be resolved in dependency order,
    // because `freeNames` excludes constants and so never reports one as a
    // dependency. The result fell back to source order and drew different
    // geometry depending on which line came first, silently. Refusing the name
    // is the honest fix; the vocabulary is closed, so it is a small set.
    if (CONSTANTS.has(name)) {
      throw new BindingError(`'${name}' is a constant of the expression language and cannot be bound`, name);
    }
    if (FUNCTIONS.has(name) || TYPED_FUNCTIONS.has(name)) {
      throw new BindingError(`'${name}' is a function of the expression language and cannot be bound`, name);
    }
    try {
      const node = parseExpression(source);
      const [issue] = validateExpressionFunctions(node);
      if (issue) throw new BindingError(`'${name}' is not a valid expression: ${issue.message}`, name);
      parsed.set(name, { name, node });
    } catch (error) {
      const detail = error instanceof ExpressionError ? error.message : String(error);
      throw new BindingError(`'${name}' is not a valid expression: ${detail}`, name);
    }
  }
  return parsed;
}

/**
 * Resolves every binding, in dependency order.
 *
 * The walk is depth-first with three colours: unvisited, in progress, and done.
 * Meeting a name that is in progress means the document has closed a loop, and
 * the stack holds exactly the path that closed it.
 */
export function resolveBindings(bindings: readonly SourceBinding[]): Map<string, number> {
  const parsed = parseAll(bindings);
  const values = new Map<string, number>();
  const visiting = new Set<string>();

  const visit = (name: string, path: readonly string[]): void => {
    if (values.has(name)) return;
    if (visiting.has(name)) {
      const loop = [...path.slice(path.indexOf(name)), name];
      throw new BindingError(`'${name}' depends on itself: ${loop.join(" -> ")}`, name);
    }
    const own = parsed.get(name);
    if (!own) return;
    visiting.add(name);
    for (const dependency of freeNames(own.node)) {
      if (!parsed.has(dependency)) {
        throw new BindingError(`unknown name '${dependency}', used by '${name}'`, name);
      }
      visit(dependency, [...path, name]);
    }
    visiting.delete(name);

    const value = evaluateExpression(own.node, Object.fromEntries(values));
    if (!Number.isFinite(value)) {
      throw new BindingError(`'${name}' is not a finite number`, name);
    }
    values.set(name, value);
  };

  for (const { name } of parsed.values()) visit(name, []);
  return values;
}

/**
 * Resolve bindings as expression trees instead of requiring every binding to
 * already be a number. This is the authoring symbol table: points and aliases
 * to paths survive until geometry exists, while cycles remain document errors.
 */
export function resolveBindingExpressions(
  bindings: readonly SourceBinding[],
): Map<string, ExpressionNode> {
  const parsed = parseAll(bindings);
  const resolved = new Map<string, ExpressionNode>();
  const visiting = new Set<string>();

  const substitute = (node: ExpressionNode): ExpressionNode => {
    switch (node.kind) {
      case "number": return node;
      case "boolean": return node;
      case "point": return { kind: "point", x: substitute(node.x), y: substitute(node.y) };
      case "name": return resolved.get(node.name) ?? node;
      case "negate": return { kind: "negate", operand: substitute(node.operand) };
      case "binary": return { ...node, left: substitute(node.left), right: substitute(node.right) };
      case "call": return { ...node, args: node.args.map(substitute) };
    }
  };

  const visit = (name: string, path: readonly string[]): void => {
    if (resolved.has(name)) return;
    if (visiting.has(name)) {
      const loop = [...path.slice(path.indexOf(name)), name];
      throw new BindingError(`'${name}' depends on itself: ${loop.join(" -> ")}`, name);
    }
    const own = parsed.get(name);
    if (!own) return;
    visiting.add(name);
    for (const dependency of freeNames(own.node)) {
      if (parsed.has(dependency)) visit(dependency, [...path, name]);
    }
    visiting.delete(name);
    const value = substitute(own.node);
    if (freeNames(value).size === 0) {
      const typed = inferExpressionKind(value, () => null);
      if (typed.issues.length) {
        throw new BindingError(`'${name}' is not a valid value: ${typed.issues.map((issue) => issue.message).join("; ")}`, name);
      }
      try {
        const constant = evaluateValueExpression(value, {});
        const finite = typeof constant === "number"
          ? Number.isFinite(constant)
          : typeof constant === "boolean" || constant.every(Number.isFinite);
        if (!finite) throw new BindingError(`'${name}' is not finite`, name);
      } catch (error) {
        if (error instanceof BindingError) throw error;
        // Geometry functions are intentionally unresolved until paths and
        // element bounds exist. Their eventual consumer reports bad calls.
      }
    }
    resolved.set(name, value);
  };

  for (const { name } of parsed.values()) visit(name, []);
  return resolved;
}

/** Inline a resolved binding table into an arbitrary expression. */
export function expandBindingExpression(
  node: ExpressionNode,
  bindings: ReadonlyMap<string, ExpressionNode>,
): ExpressionNode {
  switch (node.kind) {
    case "number": return node;
    case "boolean": return node;
    case "point": return {
      kind: "point",
      x: expandBindingExpression(node.x, bindings),
      y: expandBindingExpression(node.y, bindings),
    };
    case "name": return bindings.get(node.name) ?? node;
    case "negate": return { kind: "negate", operand: expandBindingExpression(node.operand, bindings) };
    case "binary": return {
      ...node,
      left: expandBindingExpression(node.left, bindings),
      right: expandBindingExpression(node.right, bindings),
    };
    case "call": return { ...node, args: node.args.map((arg) => expandBindingExpression(arg, bindings)) };
  }
}
