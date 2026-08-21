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
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "point"; readonly x: ExpressionNode; readonly y: ExpressionNode }
  | { readonly kind: "name"; readonly name: string; readonly offset: number }
  | { readonly kind: "negate"; readonly operand: ExpressionNode }
  | { readonly kind: "binary"; readonly operator: string; readonly left: ExpressionNode; readonly right: ExpressionNode }
  | { readonly kind: "call"; readonly name: string; readonly args: readonly ExpressionNode[]; readonly offset: number };

export interface ExpressionFunction {
  readonly arity: number;
  apply(args: readonly number[]): number;
}

export type ExpressionValueKind = "number" | "boolean" | "point" | "path";

/**
 * A function that is well-typed before it is necessarily available.
 *
 * Geometry functions live in the expression language's one vocabulary, but
 * are evaluated only after their declared requirements exist. Keeping their
 * signatures here prevents the parser, binding resolver, and geometry planner
 * from maintaining competing private lists.
 */
export interface DeferredExpressionFunction {
  readonly parameters: readonly ExpressionValueKind[];
  readonly result: ExpressionValueKind;
  readonly requires: "value" | "geometry";
}

export type ExpressionValue = number | boolean | readonly [number, number];

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

export const TYPED_FUNCTIONS: ClosedTable<DeferredExpressionFunction> = closedTable([
  ["x", { parameters: ["point"], result: "number", requires: "value" }],
  ["y", { parameters: ["point"], result: "number", requires: "value" }],
  ["start", { parameters: ["path"], result: "point", requires: "geometry" }],
  ["end", { parameters: ["path"], result: "point", requires: "geometry" }],
  ["midpoint", { parameters: ["path"], result: "point", requires: "geometry" }],
  ["along", { parameters: ["path", "number"], result: "point", requires: "geometry" }],
  ["tangent", { parameters: ["path", "number"], result: "point", requires: "geometry" }],
  ["length", { parameters: ["path"], result: "number", requires: "geometry" }],
]);

export function expressionFunctionArity(name: string): number | undefined {
  return FUNCTIONS.get(name)?.arity ?? TYPED_FUNCTIONS.get(name)?.parameters.length;
}

/** True when evaluating the tree needs measured boxes or sampled paths. */
export function expressionRequiresGeometry(node: ExpressionNode): boolean {
  if (node.kind === "call") {
    return TYPED_FUNCTIONS.get(node.name)?.requires === "geometry" || node.args.some(expressionRequiresGeometry);
  }
  if (node.kind === "point") return expressionRequiresGeometry(node.x) || expressionRequiresGeometry(node.y);
  if (node.kind === "negate") return expressionRequiresGeometry(node.operand);
  if (node.kind === "binary") return expressionRequiresGeometry(node.left) || expressionRequiresGeometry(node.right);
  return false;
}

/**
 * Validate the closed function vocabulary without deciding what free names
 * mean. A later symbol pass classifies those names as constants, boxes, or
 * paths; function spelling and arity never need to wait for that pass.
 */
export function validateExpressionFunctions(
  node: ExpressionNode,
  issues: ExpressionIssue[] = [],
): ExpressionIssue[] {
  if (node.kind === "call") {
    const arity = expressionFunctionArity(node.name);
    if (arity === undefined) {
      issues.push({ message: `unknown function '${node.name}'`, offset: node.offset });
    } else if (node.args.length !== arity) {
      issues.push({ message: arityMessage(node.name, arity, node.args.length), offset: node.offset });
    }
    node.args.forEach((argument) => validateExpressionFunctions(argument, issues));
  } else if (node.kind === "point") {
    validateExpressionFunctions(node.x, issues);
    validateExpressionFunctions(node.y, issues);
  } else if (node.kind === "negate") {
    validateExpressionFunctions(node.operand, issues);
  } else if (node.kind === "binary") {
    validateExpressionFunctions(node.left, issues);
    validateExpressionFunctions(node.right, issues);
  }
  return issues;
}

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
      // A dot inside a name is part of the name — `flow.ingest.east` is one
      // identifier naming an element's geometry, not property access. The
      // vocabulary stays closed because a name still has to be bound by
      // whoever evaluates it.
      const match = /^[a-z_][a-z0-9_]*(\.(?:north-east|south-east|south-west|north-west|[a-z_][a-z0-9_]*))*/iu.exec(source.slice(index));
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
 * Ordinary authored expressions are far below this limit.
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

  const parenthesized = (): ExpressionNode => {
    position += 1;
    const inner = binary(0);
    if (peek()?.kind === "punctuation" && peek()?.value === ",") {
      position += 1;
      const y = binary(0);
      take(")");
      return built({ kind: "point", x: inner, y });
    }
    take(")");
    return inner;
  };

  const named = (token: Token): ExpressionNode => {
    position += 1;
    if (token.value === "true" || token.value === "false") {
      return built({ kind: "boolean", value: token.value === "true" });
    }
    if (!(peek()?.kind === "punctuation" && peek()?.value === "(")) {
      return built({ kind: "name", name: token.value, offset: token.offset });
    }
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
      return parenthesized();
    }
    if (token.kind === "name") return named(token);
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

export interface ExpressionTypeResult {
  readonly kind: ExpressionValueKind | null;
  readonly issues: readonly ExpressionIssue[];
}

type ExpressionIssueRecorder = (message: string, offset?: number) => null;

function inferBinaryKind(
  node: Extract<ExpressionNode, { kind: "binary" }>,
  left: ExpressionValueKind,
  right: ExpressionValueKind,
  issue: ExpressionIssueRecorder,
): ExpressionValueKind | null {
  if ((node.operator === "+" || node.operator === "-") && left === right
      && (left === "number" || left === "point")) return left;
  if (node.operator === "*") {
    if (left === "number" && right === "number") return "number";
    if ((left === "point" && right === "number") || (left === "number" && right === "point")) return "point";
  }
  if (node.operator === "/" && right === "number" && (left === "number" || left === "point")) return left;
  if (node.operator === "^" && left === "number" && right === "number") return "number";
  return issue(`operator '${node.operator}' does not accept ${left} and ${right}`);
}

function inferCallKind(
  current: Extract<ExpressionNode, { kind: "call" }>,
  nameKind: (name: string) => ExpressionValueKind | null,
  issue: ExpressionIssueRecorder,
  issues: readonly ExpressionIssue[],
): ExpressionValueKind | null {
  const numeric = FUNCTIONS.get(current.name);
  const typed = TYPED_FUNCTIONS.get(current.name);
  const parameters = numeric ? Array.from({ length: numeric.arity }, () => "number" as const) : typed?.parameters;
  if (!parameters || current.args.length !== parameters.length) {
    current.args.forEach((argument) => inferNodeKind(argument, nameKind, issue, issues));
    return issue(parameters
      ? arityMessage(current.name, parameters.length, current.args.length)
      : `unknown function '${current.name}'`, current.offset);
  }
  const received = current.args.map((argument) => inferNodeKind(argument, nameKind, issue, issues));
  received.forEach((kind, index) => {
    if (kind !== null && kind !== parameters[index]) {
      issue(`${current.name} argument ${index + 1} must be ${parameters[index]}, received ${kind}`, current.offset);
    }
  });
  return issues.length ? null : (typed?.result ?? "number");
}

function inferNodeKind(
  current: ExpressionNode,
  nameKind: (name: string) => ExpressionValueKind | null,
  issue: ExpressionIssueRecorder,
  issues: readonly ExpressionIssue[],
): ExpressionValueKind | null {
  if (current.kind === "number") return "number";
  if (current.kind === "boolean") return "boolean";
  if (current.kind === "name") {
    if (CONSTANTS.has(current.name)) return "number";
    return nameKind(current.name) ?? issue(`unknown name '${current.name}'`, current.offset);
  }
  if (current.kind === "point") {
    const x = inferNodeKind(current.x, nameKind, issue, issues);
    const y = inferNodeKind(current.y, nameKind, issue, issues);
    return x === "number" && y === "number" ? "point" : issue("point coordinates must be numbers");
  }
  if (current.kind === "negate") {
    const operand = inferNodeKind(current.operand, nameKind, issue, issues);
    return operand === "number" || operand === "point" ? operand : issue("negation takes a number or point");
  }
  if (current.kind === "binary") {
    const left = inferNodeKind(current.left, nameKind, issue, issues);
    const right = inferNodeKind(current.right, nameKind, issue, issues);
    return left === null || right === null ? null : inferBinaryKind(current, left, right, issue);
  }
  return inferCallKind(current, nameKind, issue, issues);
}

/**
 * Elaborate a surface expression into one value kind.
 *
 * Names are classified by the caller because only it owns the symbol table;
 * operators and functions are classified here because they are language
 * vocabulary. This is deliberately non-evaluating, so paths can be checked
 * before they are sampled.
 */
export function inferExpressionKind(
  node: ExpressionNode,
  nameKind: (name: string) => ExpressionValueKind | null,
): ExpressionTypeResult {
  const issues: ExpressionIssue[] = [];
  const issue = (message: string, offset = 0): null => {
    issues.push({ message, offset });
    return null;
  };
  return { kind: inferNodeKind(node, nameKind, issue, issues), issues };
}

/** Canonical path identities consumed by a typed expression tree. */
export function expressionPathReferences(node: ExpressionNode, found = new Set<string>()): Set<string> {
  if (node.kind === "call") {
    if (TYPED_FUNCTIONS.get(node.name)?.parameters[0] === "path" && node.args[0]?.kind === "name") {
      found.add(node.args[0].name);
    }
    node.args.forEach((argument) => expressionPathReferences(argument, found));
  } else if (node.kind === "point") {
    expressionPathReferences(node.x, found);
    expressionPathReferences(node.y, found);
  } else if (node.kind === "negate") {
    expressionPathReferences(node.operand, found);
  } else if (node.kind === "binary") {
    expressionPathReferences(node.left, found);
    expressionPathReferences(node.right, found);
  }
  return found;
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
  const result = inferExpressionKind(node, (name) => bound.has(name) ? "number" : null);
  issues.push(...result.issues);
  if (!result.issues.length && result.kind !== "number") {
    issues.push({ message: `expected a number, received ${result.kind ?? "an invalid value"}`, offset: 0 });
  }
  return issues;
}

function valueNode(value: ExpressionValue): ExpressionNode {
  if (typeof value === "number") return { kind: "number", value };
  if (typeof value === "boolean") return { kind: "boolean", value };
  return {
    kind: "point",
    x: { kind: "number", value: value[0] },
    y: { kind: "number", value: value[1] },
  };
}

/** Fold value-only subtrees while leaving variables and geometry requirements structural. */
export function foldConstantExpressions(node: ExpressionNode): ExpressionNode {
  let folded: ExpressionNode;
  switch (node.kind) {
    case "point": folded = { kind: "point", x: foldConstantExpressions(node.x), y: foldConstantExpressions(node.y) }; break;
    case "negate": folded = { kind: "negate", operand: foldConstantExpressions(node.operand) }; break;
    case "binary": folded = {
      ...node,
      left: foldConstantExpressions(node.left),
      right: foldConstantExpressions(node.right),
    }; break;
    case "call": folded = { ...node, args: node.args.map(foldConstantExpressions) }; break;
    default: folded = node;
  }
  if (freeNames(folded).size || expressionRequiresGeometry(folded)) return folded;
  return valueNode(evaluateValueExpression(folded, {}));
}

export function evaluateExpression(node: ExpressionNode, environment: Readonly<Record<string, number>>): number {
  const value = evaluateValueExpression(node, environment);
  if (typeof value !== "number") throw new ExpressionError("expected a number, received a point", 0);
  return value;
}

function point(value: ExpressionValue): value is readonly [number, number] {
  return Array.isArray(value);
}

function evaluatePointBinary(
  operator: string,
  left: ExpressionValue,
  right: ExpressionValue,
): ExpressionValue | null {
  if (operator === "+" && point(left) && point(right)) return [left[0] + right[0], left[1] + right[1]];
  if (operator === "-" && point(left) && point(right)) return [left[0] - right[0], left[1] - right[1]];
  if (operator === "*" && point(left) && typeof right === "number") return [left[0] * right, left[1] * right];
  if (operator === "*" && typeof left === "number" && point(right)) return [left * right[0], left * right[1]];
  if (operator === "/" && point(left) && typeof right === "number") return [left[0] / right, left[1] / right];
  return null;
}

function evaluateBinary(
  node: Extract<ExpressionNode, { kind: "binary" }>,
  environment: Readonly<Record<string, ExpressionValue>>,
): ExpressionValue {
  const left = evaluateValueExpression(node.left, environment);
  const right = evaluateValueExpression(node.right, environment);
  const pointResult = evaluatePointBinary(node.operator, left, right);
  if (pointResult) return pointResult;
  if (point(left) || point(right) || typeof left === "boolean" || typeof right === "boolean") {
    const kind = typeof left === "boolean" || typeof right === "boolean" ? "boolean" : "point";
    throw new ExpressionError(`operator '${node.operator}' does not accept those ${kind} operands`, 0);
  }
  if (node.operator === "+") return left + right;
  if (node.operator === "-") return left - right;
  if (node.operator === "*") return left * right;
  if (node.operator === "/") return left / right;
  return left ** right;
}

function evaluateCall(
  node: Extract<ExpressionNode, { kind: "call" }>,
  environment: Readonly<Record<string, ExpressionValue>>,
): ExpressionValue {
  const typed = TYPED_FUNCTIONS.get(node.name);
  if (typed) {
    if (node.args.length !== typed.parameters.length) {
      throw new ExpressionError(arityMessage(node.name, typed.parameters.length, node.args.length), node.offset);
    }
    if (typed.requires === "geometry") throw new ExpressionError(`${node.name} requires sampled geometry`, node.offset);
    const [value] = node.args.map((argument) => evaluateValueExpression(argument, environment));
    if (!point(value)) throw new ExpressionError(`${node.name} takes a point`, node.offset);
    return value[node.name === "x" ? 0 : 1];
  }
  const fn = FUNCTIONS.get(node.name);
  if (!fn) throw new ExpressionError(`unknown function '${node.name}'`, node.offset);
  if (node.args.length !== fn.arity) {
    throw new ExpressionError(arityMessage(node.name, fn.arity, node.args.length), node.offset);
  }
  const args = node.args.map((argument) => evaluateValueExpression(argument, environment));
  if (!args.every((value): value is number => typeof value === "number")) {
    throw new ExpressionError(`${node.name} takes number arguments`, node.offset);
  }
  return fn.apply(args);
}

/** Evaluate the complete expression value language: scalars and points. */
export function evaluateValueExpression(
  node: ExpressionNode,
  environment: Readonly<Record<string, ExpressionValue>>,
): ExpressionValue {
  switch (node.kind) {
    case "number": return node.value;
    case "boolean": return node.value;
    case "point": {
      const x = evaluateValueExpression(node.x, environment);
      const y = evaluateValueExpression(node.y, environment);
      if (typeof x !== "number" || typeof y !== "number") {
        throw new ExpressionError("point coordinates must be numbers", 0);
      }
      return [x, y];
    }
    case "name": {
      // hasOwn, not `in`: the environment is caller-supplied, so its prototype
      // is reachable too and would answer for 'toString' and 'constructor'.
      if (Object.hasOwn(environment, node.name)) return environment[node.name];
      const constant = CONSTANTS.get(node.name);
      if (constant !== undefined) return constant;
      throw new ExpressionError(`unknown name '${node.name}'`, node.offset);
    }
    case "negate": {
      const value = evaluateValueExpression(node.operand, environment);
      if (typeof value === "boolean") throw new ExpressionError("cannot negate a boolean", 0);
      return point(value) ? [-value[0], -value[1]] : -value;
    }
    case "binary": return evaluateBinary(node, environment);
    case "call": return evaluateCall(node, environment);
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
    case "boolean": return node;
    case "point": return { kind: "point", x: substituteNames(node.x, values), y: substituteNames(node.y, values) };
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

/** Rename free names while preserving the parsed expression structure. */
export function mapExpressionNames(
  node: ExpressionNode,
  rename: (name: string) => string,
): ExpressionNode {
  switch (node.kind) {
    case "number": return node;
    case "boolean": return node;
    case "point": return { kind: "point", x: mapExpressionNames(node.x, rename), y: mapExpressionNames(node.y, rename) };
    case "name": return CONSTANTS.has(node.name) ? node : { ...node, name: rename(node.name) };
    case "negate": return { kind: "negate", operand: mapExpressionNames(node.operand, rename) };
    case "binary": return {
      kind: "binary",
      operator: node.operator,
      left: mapExpressionNames(node.left, rename),
      right: mapExpressionNames(node.right, rename),
    };
    case "call": return {
      ...node,
      args: node.args.map((argument) => mapExpressionNames(argument, rename)),
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
    // would reparse as a subtraction, so parentheses make it a term again.
    // Negative zero needs the same treatment for a different reason: it prints
    // as "0" and would come back positive, which is a different number to
    // Object.is and to anything that divides by it.
    case "number": return node.value < 0 || Object.is(node.value, -0)
      ? `(-${Math.abs(node.value)})`
      : String(node.value);
    case "boolean": return String(node.value);
    case "point": return `(${formatExpression(node.x)}, ${formatExpression(node.y)})`;
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
  else if (node.kind === "point") {
    freeNames(node.x, found);
    freeNames(node.y, found);
  }
  else if (node.kind === "negate") freeNames(node.operand, found);
  else if (node.kind === "binary") {
    freeNames(node.left, found);
    freeNames(node.right, found);
  } else if (node.kind === "call") {
    for (const argument of node.args) freeNames(argument, found);
  }
  return found;
}
