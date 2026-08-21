import { parseExpressionPrefix, type ExpressionNode } from "./expression.ts";
import type {
  SourceLocation,
  Token,
  TokenList,
  TokenType,
} from "../contracts/foundation.ts";

const SYMBOLS = new Set<TokenType>(["{", "}", "(", ")", "[", "]", ":", ",", ";", "@", "$", "="]);

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function position(starts: readonly number[], offset: number): SourceLocation {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle;
  }
  return { offset, line: low + 1, column: offset - starts[low] + 1 };
}

function token(
  source: string,
  starts: readonly number[],
  type: TokenType,
  value: string | number | null,
  start: number,
  end: number,
): Token {
  return {
    type,
    value,
    raw: source.slice(start, end),
    offset: start,
    end,
    start: position(starts, start),
    finish: position(starts, end),
  };
}

export class SyntaxError extends Error {
  readonly offset: number;
  readonly line: number;
  readonly column: number;

  constructor(message: string, source: string, offset: number) {
    const { line, column } = position(lineStarts(source), offset);
    super(`${message} at ${line}:${column}`);
    this.name = "XDrawSyntaxError";
    this.offset = offset;
    this.line = line;
    this.column = column;
  }
}

/**
 * Turns a failure to read an expression into a message that names the cause.
 * The expression parser reports what its own grammar saw, which after a '=' is
 * usually "unexpected end of expression" — true, and useless for finding the
 * mistake. The common mistakes are quoting the expression, leaving it out, and
 * reaching for a template parameter, so each says so.
 */
function expressionFailure(source: string, offset: number, error: unknown): string {
  const rest = source.slice(offset).trimStart();
  const first = rest[0];
  if (first === '"') {
    return "an expression is written after '=' without quotes";
  }
  // Asking what may start an expression is more reliable than listing what may
  // not: a property block ends with '}', statements may be separated by ';',
  // and a stray '=' or ')' is just as much a missing expression.
  if (first === undefined || !/[0-9._a-z(+-]/iu.test(first)) {
    return "expected an expression after '='";
  }
  return error instanceof Error ? error.message : "expected an expression after '='";
}


interface ClosedInterval {
  readonly open: number;
  readonly comma: number;
  readonly close: number;
  readonly left: string;
  readonly right: string;
}

/**
 * A copy of the source in which every `${name}` is a plain identifier of the
 * same length, so the expression grammar can measure how far the expression
 * runs without knowing about template parameters. Same length matters: the
 * offset the probe reports is used to slice the real source.
 */
const PARAMETER = /\$\{([A-Za-z_][A-Za-z0-9_-]*)\}/gu;
function probeParameters(source: string): string {
  return source.replace(PARAMETER, (match, name: string) => `_${name.replace(/-/gu, "_")}__`.slice(0, match.length).padEnd(match.length, "_"));
}

function sourceScalar(node: ExpressionNode): boolean {
  return node.kind === "number"
    || node.kind === "boolean"
    || node.kind === "name"
    || (node.kind === "negate" && node.operand.kind === "number");
}

/**
 * Parentheses are shared by mathematical points and recursive source tuples.
 * Keep literal/identifier tuples in the source grammar so manifests can later
 * classify them as points, point lists, number lists, or string lists. A point
 * containing operators or calls remains one expression token.
 */
function sourceTuple(node: ExpressionNode): boolean {
  return node.kind === "point"
    && ((sourceScalar(node.x) && sourceScalar(node.y))
      || node.x.kind === "point"
      || node.y.kind === "point");
}

/** Reads the two expression bounds in `[a, b]`, ignoring parentheses inside them. */
function closedInterval(source: string, from: number): ClosedInterval | null {
  if (source[from] !== "[") return null;
  let parentheses = 0;
  let comma = -1;
  for (let index = from + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parentheses += 1;
    else if (char === ")") parentheses -= 1;
    else if (char === "," && parentheses === 0) {
      if (comma !== -1) return null;
      comma = index;
    } else if (char === "]" && parentheses === 0) {
      if (comma === -1) return null;
      return {
        open: from,
        comma,
        close: index,
        left: source.slice(from + 1, comma),
        right: source.slice(comma + 1, index),
      };
    } else if (char === '"' || parentheses < 0) {
      return null;
    }
  }
  return null;
}

export function tokenize(source: string): TokenList {
  const tokens: Token[] = [];
  const comments: Token[] = [];
  const starts = lineStarts(source);
  let offset = 0;

  while (offset < source.length) {
    const char = source[offset];
    if (/\s/.test(char) || char === ";") {
      offset += 1;
      continue;
    }
    if (char === "#") {
      const start = offset;
      while (offset < source.length && source[offset] !== "\n") offset += 1;
      comments.push(token(source, starts, "comment", source.slice(start + 1, offset).trimStart(), start, offset));
      continue;
    }
    if (source.startsWith("->", offset)) {
      tokens.push(token(source, starts, "arrow", "->", offset, offset + 2));
      offset += 2;
      continue;
    }
    if (source.startsWith("--", offset)) {
      tokens.push(token(source, starts, "line", "--", offset, offset + 2));
      offset += 2;
      continue;
    }
    if (source.startsWith("::", offset)) {
      tokens.push(token(source, starts, "namespace", "::", offset, offset + 2));
      offset += 2;
      continue;
    }
    if (source.startsWith('"""', offset)) {
      const start = offset;
      offset += 3;
      const end = source.indexOf('"""', offset);
      if (end === -1) throw new SyntaxError("unterminated triple-quoted string", source, start);
      let value = source.slice(offset, end);
      if (value.startsWith("\n")) value = value.slice(1);
      if (value.endsWith("\n")) value = value.slice(0, -1);
      tokens.push(token(source, starts, "string", value, start, end + 3));
      offset = end + 3;
      continue;
    }
    if (char === '"') {
      const start = offset;
      offset += 1;
      let value = "";
      while (offset < source.length && source[offset] !== '"') {
        if (source[offset] === "\\") {
          offset += 1;
          const escaped = source[offset];
          const replacements: Readonly<Record<string, string>> = {
            n: "\n",
            t: "\t",
            '"': '"',
            "\\": "\\",
          };
          if (!(escaped in replacements)) {
            throw new SyntaxError(`unknown escape \\${escaped}`, source, offset - 1);
          }
          value += replacements[escaped];
        } else {
          value += source[offset];
        }
        offset += 1;
      }
      if (source[offset] !== '"') throw new SyntaxError("unterminated string", source, start);
      tokens.push(token(source, starts, "string", value, start, offset + 1));
      offset += 1;
      continue;
    }
    if (char === "=") {
      // '=' means an expression follows. Its extent is decided by the
      // expression grammar rather than by a delimiter or a line ending: after a
      // complete term only an operator can continue, so the next property name
      // or closing brace ends it. The expression tokenizer reads it, not this
      // one, which is why `5 - 3` stays a subtraction here instead of becoming
      // two numbers the way this tokenizer would read it.
      const start = offset;
      offset += 1;
      tokens.push(token(source, starts, "=", "=", start, offset));
      let valueStart = offset;
      while (valueStart < source.length && /\s/u.test(source[valueStart])) valueStart += 1;
      const bindingAssignment = tokens.at(-3)?.value === "let";
      // Strings and endpoints belong to the document value grammar rather
      // than the mathematical expression grammar.
      if (source[valueStart] === '"'
          || (source[valueStart] === "$" && source[valueStart + 1] !== "{")
          || /^[A-Za-z_][A-Za-z0-9_.-]*\s*@/u.test(source.slice(valueStart))) {
        continue;
      }
      let parsed;
      try {
        parsed = parseExpressionPrefix(probeParameters(source.slice(valueStart)));
      } catch (error) {
        if (source[valueStart] === "(") continue;
        throw new SyntaxError(expressionFailure(source, valueStart, error), source, valueStart);
      }
      const parsedSource = source.slice(valueStart, valueStart + parsed.end);
      if (!bindingAssignment
          && source[valueStart] === "("
          && !parsedSource.includes("${")
          && sourceTuple(parsed.node)) continue;
      const end = valueStart + parsed.end;
      tokens.push(token(source, starts, "expression", source.slice(valueStart, end).trim(), valueStart, end));
      offset = end;
      continue;
    }
    if (char === "[") {
      const interval = closedInterval(source, offset);
      if (!interval || !interval.left.trim() || !interval.right.trim()) {
        throw new SyntaxError("expected a closed interval such as [0, tau]", source, offset);
      }
      for (const [text, start] of [[interval.left, interval.open + 1], [interval.right, interval.comma + 1]] as const) {
        try {
          const candidate = probeParameters(text.trim());
          const parsed = parseExpressionPrefix(candidate);
          if (candidate.slice(parsed.end).trim()) throw new Error("unexpected content after interval bound");
        } catch (error) {
          throw new SyntaxError(expressionFailure(source, start, error), source, start);
        }
      }
      tokens.push(token(source, starts, "[", "[", interval.open, interval.open + 1));
      tokens.push(token(source, starts, "expression", interval.left.trim(), interval.open + 1, interval.comma));
      tokens.push(token(source, starts, ",", ",", interval.comma, interval.comma + 1));
      tokens.push(token(source, starts, "expression", interval.right.trim(), interval.comma + 1, interval.close));
      tokens.push(token(source, starts, "]", "]", interval.close, interval.close + 1));
      offset = interval.close + 1;
      continue;
    }
    if (SYMBOLS.has(char as TokenType)) {
      const type = char as TokenType;
      tokens.push(token(source, starts, type, char, offset, offset + 1));
      offset += 1;
      continue;
    }
    const number = source.slice(offset).match(/^-?\d+(?:\.\d+)?/);
    if (number) {
      tokens.push(token(source, starts, "number", Number(number[0]), offset, offset + number[0].length));
      offset += number[0].length;
      continue;
    }
    // A leading sign belongs to a bare literal outside the expression grammar.
    const identifier = source.slice(offset).match(/^-?[A-Za-z_][A-Za-z0-9_.-]*/);
    if (identifier) {
      tokens.push(token(source, starts, "identifier", identifier[0], offset, offset + identifier[0].length));
      offset += identifier[0].length;
      const previous = tokens.at(-2);
      const beforePrevious = tokens.at(-3);
      if (identifier[0] === "to" && beforePrevious?.value === "attach" && previous?.type === "identifier") {
        let valueStart = offset;
        while (valueStart < source.length && /\s/u.test(source[valueStart])) valueStart += 1;
        try {
          const parsed = parseExpressionPrefix(source.slice(valueStart));
          const end = valueStart + parsed.end;
          tokens.push(token(source, starts, "expression", source.slice(valueStart, end).trim(), valueStart, end));
          offset = end;
        } catch (error) {
          throw new SyntaxError(expressionFailure(source, valueStart, error), source, valueStart);
        }
      }
      continue;
    }
    throw new SyntaxError(`unexpected character ${JSON.stringify(char)}`, source, offset);
  }

  tokens.push(token(source, starts, "eof", null, source.length, source.length));
  Object.defineProperty(tokens, "comments", { value: comments, enumerable: false });
  return tokens as TokenList;
}
