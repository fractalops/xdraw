/**
 * A bounded expression sublanguage: tokenizer, precedence-climbing parser,
 * static validator, and evaluator.
 *
 * The vocabulary is closed — a fixed function set, no assignment, no control
 * flow, no property access, and one free variable bound by the caller. That
 * follows Vega's expression language, whose restrictions exist to keep it
 * "simple, secure and free of unwanted side effects" — the same properties this
 * compiler needs to stay deterministic.
 *
 * Expressions arrive in document source, so the parser has to survive hostile
 * input. Two size limits do that, and they catch different shapes: see
 * MAXIMUM_NESTING and MAXIMUM_NODES.
 *
 * `evaluateExpression` and `validateExpression` recurse over the tree, and both
 * assume a node that `parseExpression` produced, because that is where the size
 * limits are enforced. `ExpressionNode` is exported so callers can inspect a
 * tree, not so they can build an unbounded one by hand.
 */

export class ExpressionError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.name = "XDrawExpressionError";
    this.offset = offset;
  }
}

export type ExpressionNode =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "name"; readonly name: string; readonly offset: number }
  | { readonly kind: "negate"; readonly operand: ExpressionNode }
  | { readonly kind: "binary"; readonly operator: string; readonly left: ExpressionNode; readonly right: ExpressionNode }
  | { readonly kind: "call"; readonly name: string; readonly args: readonly ExpressionNode[]; readonly offset: number };

export interface ExpressionFunction {
  readonly arity: number;
  apply(args: readonly number[]): number;
}

/**
 * A lookup table that is closed in both directions.
 *
 * Neither obvious representation gives both guarantees. A frozen object literal
 * cannot be extended, but `'constructor' in table` and `table.toString` answer
 * from `Object.prototype` as though those names had been declared. A bare `Map`
 * has no prototype chain to walk, but `Object.freeze` does nothing to one, so
 * any holder of the export could add a function or redefine `pi`. This wraps a
 * private map in a frozen facade, which closes both.
 */
export interface ClosedTable<T> {
  get(name: string): T | undefined;
  has(name: string): boolean;
  readonly names: readonly string[];
}

function closedTable<T>(entries: ReadonlyArray<readonly [string, T]>): ClosedTable<T> {
  const table = new Map(entries);
  return Object.freeze({
    get: (name: string): T | undefined => table.get(name),
    has: (name: string): boolean => table.has(name),
    names: Object.freeze([...table.keys()]),
  });
}

export const FUNCTIONS: ClosedTable<ExpressionFunction> = closedTable<ExpressionFunction>([
  ["sin", { arity: 1, apply: ([x]) => Math.sin(x) }],
  ["cos", { arity: 1, apply: ([x]) => Math.cos(x) }],
  ["tan", { arity: 1, apply: ([x]) => Math.tan(x) }],
  ["asin", { arity: 1, apply: ([x]) => Math.asin(x) }],
  ["acos", { arity: 1, apply: ([x]) => Math.acos(x) }],
  ["atan", { arity: 1, apply: ([x]) => Math.atan(x) }],
  ["atan2", { arity: 2, apply: ([y, x]) => Math.atan2(y, x) }],
  ["sqrt", { arity: 1, apply: ([x]) => Math.sqrt(x) }],
  ["abs", { arity: 1, apply: ([x]) => Math.abs(x) }],
  ["sign", { arity: 1, apply: ([x]) => Math.sign(x) }],
  ["floor", { arity: 1, apply: ([x]) => Math.floor(x) }],
  ["ceil", { arity: 1, apply: ([x]) => Math.ceil(x) }],
  ["round", { arity: 1, apply: ([x]) => Math.round(x) }],
  ["min", { arity: 2, apply: ([a, b]) => Math.min(a, b) }],
  ["max", { arity: 2, apply: ([a, b]) => Math.max(a, b) }],
  ["exp", { arity: 1, apply: ([x]) => Math.exp(x) }],
  ["log", { arity: 1, apply: ([x]) => Math.log(x) }],
  ["hypot", { arity: 2, apply: ([a, b]) => Math.hypot(a, b) }],
]);

export const CONSTANTS: ClosedTable<number> = closedTable<number>([
  ["pi", Math.PI],
  ["tau", Math.PI * 2],
  ["e", Math.E],
]);

const PRECEDENCE = new Map<string, number>([
  ["+", 1], ["-", 1], ["*", 2], ["/", 2], ["^", 3],
]);
const PUNCTUATION = new Set(["+", "-", "*", "/", "^", "(", ")", ","]);

const arityMessage = (name: string, arity: number, received: number): string =>
  `${name} takes ${arity} argument${arity === 1 ? "" : "s"}, received ${received}`;

interface Token {
  readonly kind: "number" | "name" | "punctuation";
  readonly value: string;
  readonly offset: number;
  readonly end: number;
}

/**
 * Turns source into tokens. In `prefix` mode a character the grammar does not
 * recognise ends tokenizing rather than failing, so an expression embedded in a
 * larger document can be read up to wherever it stops.
 */
function tokenize(source: string, prefix = false): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/u.test(character)) {
      const match = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/iu.exec(source.slice(index));
      if (!match) throw new ExpressionError("malformed number", index);
      tokens.push({ kind: "number", value: match[0], offset: index, end: index + match[0].length });
      index += match[0].length;
      continue;
    }
    if (/[a-z_]/iu.test(character)) {
      // A dot inside a name is part of the name — `flow.ingest.right` is one
      // identifier naming an element's geometry, not property access. The
      // vocabulary stays closed because a name still has to be bound by
      // whoever evaluates it.
      const match = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*/iu.exec(source.slice(index));
      if (!match) throw new ExpressionError("malformed name", index);
      tokens.push({ kind: "name", value: match[0], offset: index, end: index + match[0].length });
      index += match[0].length;
      continue;
    }
    if (PUNCTUATION.has(character)) {
      tokens.push({ kind: "punctuation", value: character, offset: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (prefix) break;
    throw new ExpressionError(`unexpected character '${character}'`, index);
  }
  return tokens;
}

/**
 * How deeply the parser may recurse. Parentheses are the shape this catches and
 * the node limit cannot: `((((t))))` builds a single node however deep it goes,
 * because a parenthesised group returns its inner node rather than wrapping it.
 */
export const MAXIMUM_NESTING = 64;

/**
 * How many nodes an expression may hold. This is the limit that catches a long
 * left-associative chain — `t+1+1+1…` is parsed by a loop rather than by
 * recursion, so it builds an arbitrarily deep tree while the parser itself
 * never nests. Every later walk (validating, evaluating, collecting free names)
 * recurses over that tree, so without this limit an 8 KB expression overflows
 * the stack, and does so inside the evaluator rather than the parser.
 *
 * It also bounds cost: the sampler evaluates an expression once per probe, so
 * the node count is a per-sample multiplier.
 *
 * Legible expressions are far below this. The rose in the spike is 11 nodes.
 */
export const MAXIMUM_NODES = 512;

export interface ParsedPrefix {
  readonly node: ExpressionNode;
  /** Offset just past the last character the expression consumed. */
  readonly end: number;
}

function parseFrom(source: string, tokens: Token[]): { node: ExpressionNode; consumed: number } {
  let position = 0;
  let depth = 0;
  let nodes = 0;
  const peek = (): Token | undefined => tokens[position];

  const built = <T extends ExpressionNode>(node: T): T => {
    nodes += 1;
    if (nodes > MAXIMUM_NODES) {
      throw new ExpressionError(
        `expression holds more than ${MAXIMUM_NODES} terms`,
        peek()?.offset ?? source.length,
      );
    }
    return node;
  };

  const take = (value: string): void => {
    const token = peek();
    if (!token || token.kind !== "punctuation" || token.value !== value) {
      throw new ExpressionError(`expected '${value}'`, token?.offset ?? source.length);
    }
    position += 1;
  };

  const primary = (): ExpressionNode => {
    const token = peek();
    if (!token) throw new ExpressionError("unexpected end of expression", source.length);
    if (token.kind === "number") {
      position += 1;
      return built({ kind: "number", value: Number(token.value) });
    }
    if (token.kind === "punctuation" && token.value === "-") {
      // Looser than exponentiation, so -2^2 reads as -(2^2) as it does on paper.
      position += 1;
      return built({ kind: "negate", operand: binary(PRECEDENCE.get("^")!) });
    }
    if (token.kind === "punctuation" && token.value === "(") {
      position += 1;
      const inner = binary(0);
      take(")");
      return inner;
    }
    if (token.kind === "name") {
      position += 1;
      const next = peek();
      if (next?.kind === "punctuation" && next.value === "(") {
        position += 1;
        const args: ExpressionNode[] = [];
        if (!(peek()?.kind === "punctuation" && peek()?.value === ")")) {
          args.push(binary(0));
          while (peek()?.kind === "punctuation" && peek()?.value === ",") {
            position += 1;
            args.push(binary(0));
          }
        }
        take(")");
        return built({ kind: "call", name: token.value, args, offset: token.offset });
      }
      return built({ kind: "name", name: token.value, offset: token.offset });
    }
    throw new ExpressionError(`unexpected '${token.value}'`, token.offset);
  };

  // Every way to nest the parser — parentheses, unary minus, a call argument,
  // and a right-hand operand — descends through here, so one guard covers them
  // all. It does not cover tree depth; MAXIMUM_NODES does that.
  function binary(minimum: number): ExpressionNode {
    if (depth >= MAXIMUM_NESTING) {
      throw new ExpressionError(
        `expression nests deeper than ${MAXIMUM_NESTING} levels`,
        peek()?.offset ?? source.length,
      );
    }
    depth += 1;
    try {
      let left = primary();
      for (;;) {
        const token = peek();
        if (!token || token.kind !== "punctuation") break;
        const precedence = PRECEDENCE.get(token.value);
        if (precedence === undefined || precedence < minimum) break;
        position += 1;
        const right = binary(token.value === "^" ? precedence : precedence + 1);
        left = built({ kind: "binary", operator: token.value, left, right });
      }
      return left;
    } finally {
      depth -= 1;
    }
  }

  const node = binary(0);
  return { node, consumed: position };
}

export function parseExpression(source: string): ExpressionNode {
  const tokens = tokenize(source);
  const { node, consumed } = parseFrom(source, tokens);
  const remaining = tokens[consumed];
  if (remaining) throw new ExpressionError(`unexpected '${remaining.value}'`, remaining.offset);
  return node;
}

/**
 * Parses as much of `source` as forms an expression and reports where it
 * stopped, rather than requiring the whole string to be one.
 *
 * This is what lets an expression sit unquoted in a document. An expression
 * ends where the grammar says it ends: after a complete term, only an operator
 * can continue it, so the first token that is not one — a property name, a
 * closing brace — terminates the expression without needing a delimiter or a
 * significant newline to mark it.
 */
export function parseExpressionPrefix(source: string): ParsedPrefix {
  const tokens = tokenize(source, true);
  const { node, consumed } = parseFrom(source, tokens);
  if (consumed === 0) throw new ExpressionError("expected an expression", 0);
  return { node, end: tokens[consumed - 1].end };
}

export interface ExpressionIssue {
  readonly message: string;
  readonly offset: number;
}

/**
 * Checks an expression against the closed vocabulary before it is evaluated.
 * A bad expression should be reported when the document is read, not part-way
 * through sampling a curve. Reports every issue it finds, in source order.
 */
export function validateExpression(
  node: ExpressionNode,
  bound: ReadonlySet<string>,
  issues: ExpressionIssue[] = [],
): ExpressionIssue[] {
  if (node.kind === "name" && !bound.has(node.name) && !CONSTANTS.has(node.name)) {
    issues.push({ message: `unknown name '${node.name}'`, offset: node.offset });
  } else if (node.kind === "negate") {
    validateExpression(node.operand, bound, issues);
  } else if (node.kind === "binary") {
    validateExpression(node.left, bound, issues);
    validateExpression(node.right, bound, issues);
  } else if (node.kind === "call") {
    const fn = FUNCTIONS.get(node.name);
    if (!fn) {
      issues.push({ message: `unknown function '${node.name}'`, offset: node.offset });
    } else if (node.args.length !== fn.arity) {
      issues.push({ message: arityMessage(node.name, fn.arity, node.args.length), offset: node.offset });
    }
    for (const argument of node.args) validateExpression(argument, bound, issues);
  }
  return issues;
}

export function evaluateExpression(node: ExpressionNode, environment: Readonly<Record<string, number>>): number {
  switch (node.kind) {
    case "number": return node.value;
    case "name": {
      // hasOwn, not `in`: the environment is caller-supplied, so its prototype
      // is reachable too and would answer for 'toString' and 'constructor'.
      if (Object.hasOwn(environment, node.name)) return environment[node.name];
      const constant = CONSTANTS.get(node.name);
      if (constant !== undefined) return constant;
      throw new ExpressionError(`unknown name '${node.name}'`, node.offset);
    }
    case "negate": return -evaluateExpression(node.operand, environment);
    case "binary": {
      const left = evaluateExpression(node.left, environment);
      const right = evaluateExpression(node.right, environment);
      if (node.operator === "+") return left + right;
      if (node.operator === "-") return left - right;
      if (node.operator === "*") return left * right;
      if (node.operator === "/") return left / right;
      return left ** right;
    }
    case "call": {
      const fn = FUNCTIONS.get(node.name);
      if (!fn) throw new ExpressionError(`unknown function '${node.name}'`, node.offset);
      // Arity is checked here as well as in the validator. The two entry points
      // must agree: reaching `apply` with the wrong count returns NaN or drops
      // arguments silently, which is how a wrong number reaches a coordinate.
      if (node.args.length !== fn.arity) {
        throw new ExpressionError(arityMessage(node.name, fn.arity, node.args.length), node.offset);
      }
      return fn.apply(node.args.map((argument) => evaluateExpression(argument, environment)));
    }
  }
  // Unreachable for a parsed tree. A hand-built node of an unknown kind would
  // otherwise fall out of the switch and return undefined typed as number,
  // which every downstream Number.isFinite guard would then read as valid.
  throw new ExpressionError(`unsupported expression node '${(node as { kind: string }).kind}'`, 0);
}


/**
 * Replaces every free name the environment supplies with its value, leaving the
 * rest of the tree alone. Used to fold document-level bindings into expressions
 * that still have a variable to be bound later, such as `t` in a plotted curve.
 */
export function substituteNames(
  node: ExpressionNode,
  values: ReadonlyMap<string, number>,
): ExpressionNode {
  switch (node.kind) {
    case "number": return node;
    case "name": {
      const value = values.get(node.name);
      return value === undefined ? node : { kind: "number", value };
    }
    case "negate": return { kind: "negate", operand: substituteNames(node.operand, values) };
    case "binary": return {
      kind: "binary",
      operator: node.operator,
      left: substituteNames(node.left, values),
      right: substituteNames(node.right, values),
    };
    case "call": return {
      kind: "call",
      name: node.name,
      args: node.args.map((argument) => substituteNames(argument, values)),
      offset: node.offset,
    };
  }
  return node;
}

/**
 * Prints an expression so that it parses back to the same tree.
 *
 * Every compound is parenthesised rather than consulting precedence. The output
 * is machine-written and read by the parser rather than by a person, so being
 * obviously correct is worth more than being tidy — and parentheses cost no
 * nodes, since a parenthesised group returns its inner node.
 */
export function formatExpression(node: ExpressionNode): string {
  switch (node.kind) {
    // A substituted value may be negative, and a bare `-5` beside an operator
    // would reparse as a subtraction. Parentheses make it a term again.
    case "number": return node.value < 0 ? `(${node.value})` : String(node.value);
    case "name": return node.name;
    case "negate": return `(-${formatExpression(node.operand)})`;
    case "binary": return `(${formatExpression(node.left)} ${node.operator} ${formatExpression(node.right)})`;
    case "call": return `${node.name}(${node.args.map(formatExpression).join(", ")})`;
  }
  return "";
}

/** Identifiers an expression depends on, excluding the built-in constants. */
export function freeNames(node: ExpressionNode, found = new Set<string>()): Set<string> {
  if (node.kind === "name" && !CONSTANTS.has(node.name)) found.add(node.name);
  else if (node.kind === "negate") freeNames(node.operand, found);
  else if (node.kind === "binary") {
    freeNames(node.left, found);
    freeNames(node.right, found);
  } else if (node.kind === "call") {
    for (const argument of node.args) freeNames(argument, found);
  }
  return found;
}
