import { HIGHLIGHT_LANGUAGES, hasProperty } from "./language-registry.js";
import { tokenize } from "./tokenizer.js";
import { MAX_HIGHLIGHT_LINE_CHARACTERS } from "./code-policy.js";

const DEFAULT_COLOR = "#24292f";
const SUPPORTED_LANGUAGES = new Set(HIGHLIGHT_LANGUAGES);
const XDRAW_KEYWORDS = new Set([
  "add", "align", "arrange", "as", "by", "delete", "diagram", "distribute",
  "match-size", "offset", "patch", "replace", "rotate", "scene", "snap",
  "subtitle", "to", "update", "use",
]);
const XDRAW_COLORS = {
  comment: "#6e7781",
  constructor: "#0550ae",
  identifier: DEFAULT_COLOR,
  keyword: "#8250df",
  number: "#0550ae",
  operator: "#cf222e",
  plain: DEFAULT_COLOR,
  property: "#953800",
  string: "#0a3069",
};

const highlighters = new Map();
const preparations = new Map();

function mergeRun(line, run) {
  if (!run.text) return;
  const previous = line.at(-1);
  if (previous?.color === run.color) previous.text += run.text;
  else line.push(run);
}

function appendSegment(lines, value, color) {
  const parts = value.split("\n");
  for (let index = 0; index < parts.length; index += 1) {
    mergeRun(lines.at(-1), { text: parts[index], color });
    if (index < parts.length - 1) lines.push([]);
  }
}

function xdrawLines(source) {
  const tokens = tokenize(source);
  const items = [
    ...tokens.filter((item) => item.type !== "eof"),
    ...(tokens.comments ?? []),
  ].sort((left, right) => left.offset - right.offset);
  const lines = [[]];
  let offset = 0;
  let previous;
  for (const item of items) {
    if (item.offset < offset) continue;
    appendSegment(lines, source.slice(offset, item.offset), DEFAULT_COLOR);
    let role = item.type;
    if (item.type === "identifier") {
      if (XDRAW_KEYWORDS.has(item.value)) role = "keyword";
      else if (hasProperty(item.value)) role = "property";
      else if (previous?.type === ":") role = "constructor";
      else role = "identifier";
    } else if (["arrow", "line", "namespace", "{", "}", "(", ")", ":", ",", "@", "$"].includes(item.type)) {
      role = "operator";
    }
    appendSegment(lines, item.raw, XDRAW_COLORS[role] ?? DEFAULT_COLOR);
    offset = item.end;
    if (item.type !== "comment") previous = item;
  }
  appendSegment(lines, source.slice(offset), DEFAULT_COLOR);
  return lines;
}

function shikiLines(source, language) {
  const highlighter = highlighters.get(language);
  if (!highlighter) throw new Error(`highlighting language '${language}' has not been prepared`);
  return highlighter.codeToTokens(source, {
    lang: language,
    theme: "github-light",
    tokenizeMaxLineLength: MAX_HIGHLIGHT_LINE_CHARACTERS,
    tokenizeTimeLimit: 0,
  }).tokens.map((line) => {
    const compacted = [];
    for (const token of line) {
      mergeRun(compacted, { text: token.content, color: token.color ?? DEFAULT_COLOR });
    }
    return compacted;
  });
}

export function supportsHighlighting(language) {
  return SUPPORTED_LANGUAGES.has(language);
}

async function prepareLanguage(language) {
  if (language === "xdraw" || highlighters.has(language)) return;
  if (!supportsHighlighting(language)) throw new Error(`unsupported highlight language '${language}'`);
  if (!preparations.has(language)) {
    preparations.set(language, Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
      import("@shikijs/themes/github-light"),
      language === "typescript"
        ? import("@shikijs/langs/typescript")
        : import("@shikijs/langs/sql"),
    ]).then(([{ createHighlighterCoreSync }, { createJavaScriptRegexEngine }, theme, grammar]) => {
      highlighters.set(language, createHighlighterCoreSync({
        themes: [theme.default],
        langs: [grammar.default],
        engine: createJavaScriptRegexEngine(),
      }));
    }));
  }
  await preparations.get(language);
}

export async function prepareSyntaxHighlighting(languages) {
  await Promise.allSettled([...new Set(languages)].map(prepareLanguage));
}

export async function prepareDocumentSyntaxHighlighting(document) {
  const languages = [];
  const visit = (statements = []) => {
    for (const statement of statements) {
      if (statement.type === "code" && statement.highlight && supportsHighlighting(statement.language)) {
        languages.push(statement.language);
      }
      visit(statement.statements);
    }
  };
  visit(document.statements);
  await prepareSyntaxHighlighting(languages);
}

export function highlightSource(source, language) {
  if (!supportsHighlighting(language)) throw new Error(`unsupported highlight language '${language}'`);
  return language === "xdraw" ? xdrawLines(source) : shikiLines(source, language);
}

export function sourceFromHighlight(lines) {
  return lines.map((line) => line.map((run) => run.text).join("")).join("\n");
}
