import { parseExpressionPrefix } from "./expression.ts";
import type {
  SourceLocation,
  Token,
  TokenList,
  TokenType,
} from "../contracts/foundation.ts";

const SYMBOLS = new Set<TokenType>(["{", "}", "(", ")", ":", ",", ";", "@", "$"]);

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


interface ComputedPair {
  readonly open: number;
  readonly comma: number;
  readonly close: number;
  readonly left: string;
  readonly right: string;
}

/**
 * Reads `(a, b)` after an `=`, where a and b are expressions.
 *
 * A single parenthesised expression looks the same until a top-level comma
 * appears, and an expression can never contain one, so the comma is the whole
 * test. Anything else — no parenthesis, no comma, more than one comma —
 * returns null and the caller reads one expression as usual.
 */
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

function computedPair(source: string, from: number): ComputedPair | null {
  let index = from;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  if (source[index] !== "(") return null;
  const open = index;
  let depth = 0;
  let comma = -1;
  for (index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        if (comma === -1) return null;
        return {
          open, comma, close: index,
          left: source.slice(open + 1, comma),
          right: source.slice(comma + 1, index),
        };
      }
    } else if (char === "," && depth === 1) {
      if (comma !== -1) return null;
      comma = index;
    } else if (char === '"' || char === "\n") {
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
      const pair = computedPair(source, offset);
      if (pair) {
        // `at = (a, b)`. A pair is two expressions, and an expression cannot
        // contain a top-level comma, so the comma is what tells them apart from
        // a single parenthesised expression such as `(t + 1) * 2`.
        tokens.push(token(source, starts, "(", "(", start, pair.open + 1));
        tokens.push(token(source, starts, "expression", pair.left.trim(), pair.open + 1, pair.comma));
        tokens.push(token(source, starts, ",", ",", pair.comma, pair.comma + 1));
        tokens.push(token(source, starts, "expression", pair.right.trim(), pair.comma + 1, pair.close));
        tokens.push(token(source, starts, ")", ")", pair.close, pair.close + 1));
        offset = pair.close + 1;
        continue;
      }
      let parsed;
      try {
        parsed = parseExpressionPrefix(probeParameters(source.slice(offset)));
      } catch (error) {
        throw new SyntaxError(expressionFailure(source, offset, error), source, offset);
      }
      const end = offset + parsed.end;
      tokens.push(token(source, starts, "expression", source.slice(offset, end).trim(), start, end));
      offset = end;
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
    const identifier = source.slice(offset).match(/^[A-Za-z_][A-Za-z0-9_.-]*/);
    if (identifier) {
      tokens.push(token(source, starts, "identifier", identifier[0], offset, offset + identifier[0].length));
      offset += identifier[0].length;
      continue;
    }
    throw new SyntaxError(`unexpected character ${JSON.stringify(char)}`, source, offset);
  }

  tokens.push(token(source, starts, "eof", null, source.length, source.length));
  Object.defineProperty(tokens, "comments", { value: comments, enumerable: false });
  return tokens as TokenList;
}
