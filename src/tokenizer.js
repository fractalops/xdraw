const SYMBOLS = new Set(["{", "}", "[", "]", "(", ")", ":", ",", ";", "="]);

function lineStarts(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function position(starts, offset) {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle;
  }
  return { line: low + 1, column: offset - starts[low] + 1 };
}

function token(source, starts, type, value, start, end) {
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
  constructor(message, source, offset) {
    const { line, column } = position(lineStarts(source), offset);
    super(`${message} at ${line}:${column}`);
    this.name = "XDrawSyntaxError";
    this.offset = offset;
    this.line = line;
    this.column = column;
  }
}

export function tokenize(source) {
  const tokens = [];
  const comments = [];
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
          const replacements = { n: "\n", t: "\t", '"': '"', "\\": "\\" };
          if (!(escaped in replacements)) throw new SyntaxError(`unknown escape \\${escaped}`, source, offset - 1);
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
    if (SYMBOLS.has(char)) {
      tokens.push(token(source, starts, char, char, offset, offset + 1));
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
  return tokens;
}
