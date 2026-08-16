/**
 * Named values: a document may bind a number to a name and reuse it.
 *
 * Names resolve by what they depend on rather than by where they appear, so a
 * document reads in whatever order suits its author. That ordering is the only
 * subtle part, and it is what makes two failures possible: a cycle, and a name
 * that is used but never bound. Both are document errors carrying enough to
 * find them — a cycle reports the path that closes it, an unbound name reports
 * who used it — rather than looping or defaulting to zero.
 *
 * Bindings are constants. They may use the expression sublanguage's functions
 * and constants and each other, and nothing else, so they can be resolved while
 * the document is read.
 */
import {
  ExpressionError,
  evaluateExpression,
  freeNames,
  parseExpression,
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
    try {
      parsed.set(name, { name, node: parseExpression(source) });
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
