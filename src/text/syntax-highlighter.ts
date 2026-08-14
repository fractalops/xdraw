import { HIGHLIGHT_LANGUAGES, hasProperty, isHighlightLanguage } from "../language-registry.ts";
import type { HighlightLanguage } from "../language-registry.ts";
import { tokenize } from "../tokenizer.ts";
import { MAX_HIGHLIGHT_LINE_CHARACTERS } from "./code-policy.ts";
import type { DiagramDocument, SemanticDocument, SemanticStatement } from "../semantic-contracts.ts";
import type { Token } from "../foundation-contracts.ts";
import type { HighlighterCore } from "shiki/core";

export interface HighlightRun {
  text: string;
  color: string;
}

export type HighlightLine = HighlightRun[];
export type HighlightLines = HighlightLine[];

type XDrawTokenRole =
  | "comment"
  | "constructor"
  | "identifier"
  | "keyword"
  | "number"
  | "operator"
  | "plain"
  | "property"
  | "string";

const DEFAULT_COLOR = "#24292f";
const SUPPORTED_LANGUAGES = new Set<HighlightLanguage>(HIGHLIGHT_LANGUAGES);
const XDRAW_KEYWORDS = new Set([
  "add", "align", "arrange", "as", "by", "delete", "diagram", "distribute",
  "match-size", "offset", "patch", "replace", "rotate", "scene", "snap",
  "subtitle", "to", "update", "use",
]);
const XDRAW_COLORS: Readonly<Record<XDrawTokenRole, string>> = {
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

const highlighters = new Map<HighlightLanguage, HighlighterCore>();
const preparations = new Map<HighlightLanguage, Promise<void>>();

function mergeRun(line: HighlightLine, run: HighlightRun): void {
  if (!run.text) return;
  const previous = line.at(-1);
  if (previous?.color === run.color) previous.text += run.text;
  else line.push(run);
}

function appendSegment(lines: HighlightLines, value: string, color: string): void {
  const parts = value.split("\n");
  for (let index = 0; index < parts.length; index += 1) {
    mergeRun(lines[lines.length - 1], { text: parts[index], color });
    if (index < parts.length - 1) lines.push([]);
  }
}

function tokenRole(item: Token, previous: Token | undefined): XDrawTokenRole {
  if (item.type === "identifier" && typeof item.value === "string") {
    if (XDRAW_KEYWORDS.has(item.value)) return "keyword";
    if (hasProperty(item.value)) return "property";
    if (previous?.type === ":") return "constructor";
    return "identifier";
  }
  if (["arrow", "line", "namespace", "{", "}", "(", ")", ":", ",", "@", "$"].includes(item.type)) {
    return "operator";
  }
  switch (item.type) {
    case "comment":
    case "number":
    case "string":
      return item.type;
    case "eof":
      return "plain";
    default:
      return "operator";
  }
}

function xdrawLines(source: string): HighlightLines {
  const tokens = tokenize(source);
  const items = [
    ...tokens.filter((item) => item.type !== "eof"),
    ...(tokens.comments ?? []),
  ].sort((left, right) => left.offset - right.offset);
  const lines: HighlightLines = [[]];
  let offset = 0;
  let previous: Token | undefined;
  for (const item of items) {
    if (item.offset < offset) continue;
    appendSegment(lines, source.slice(offset, item.offset), DEFAULT_COLOR);
    const role = tokenRole(item, previous);
    appendSegment(lines, item.raw, XDRAW_COLORS[role] ?? DEFAULT_COLOR);
    offset = item.end;
    if (item.type !== "comment") previous = item;
  }
  appendSegment(lines, source.slice(offset), DEFAULT_COLOR);
  return lines;
}

function shikiLines(source: string, language: HighlightLanguage): HighlightLines {
  const highlighter = highlighters.get(language);
  if (!highlighter) throw new Error(`highlighting language '${language}' has not been prepared`);
  return highlighter.codeToTokens(source, {
    lang: language,
    theme: "github-light",
    tokenizeMaxLineLength: MAX_HIGHLIGHT_LINE_CHARACTERS,
    tokenizeTimeLimit: 0,
  }).tokens.map((line) => {
    const compacted: HighlightLine = [];
    for (const token of line) {
      mergeRun(compacted, { text: token.content, color: token.color ?? DEFAULT_COLOR });
    }
    return compacted;
  });
}

export function supportsHighlighting(language: string | undefined): language is HighlightLanguage {
  return isHighlightLanguage(language) && SUPPORTED_LANGUAGES.has(language);
}

async function loadGrammar(language: Exclude<HighlightLanguage, "xdraw">) {
  switch (language) {
    case "typescript":
      return import("@shikijs/langs/typescript");
    case "sql":
      return import("@shikijs/langs/sql");
  }
}

async function prepareLanguage(language: HighlightLanguage): Promise<void> {
  if (language === "xdraw" || highlighters.has(language)) return;
  if (!supportsHighlighting(language)) throw new Error("unsupported highlight language");
  if (!preparations.has(language)) {
    preparations.set(language, Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
      import("@shikijs/themes/github-light"),
      loadGrammar(language),
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

export async function prepareSyntaxHighlighting(languages: Iterable<HighlightLanguage>): Promise<void> {
  await Promise.allSettled([...new Set(languages)].map(prepareLanguage));
}

export async function prepareDocumentSyntaxHighlighting(
  document: DiagramDocument | SemanticDocument,
): Promise<void> {
  const languages: HighlightLanguage[] = [];
  const visit = (statements: readonly SemanticStatement[] = []): void => {
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

export function highlightSource(source: string, language: string | undefined): HighlightLines {
  if (!supportsHighlighting(language)) throw new Error(`unsupported highlight language '${language}'`);
  return language === "xdraw" ? xdrawLines(source) : shikiLines(source, language);
}

export function sourceFromHighlight(lines: readonly (readonly HighlightRun[])[]): string {
  return lines.map((line) => line.map((run) => run.text).join("")).join("\n");
}
