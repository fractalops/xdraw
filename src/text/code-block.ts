import { FONT, rectangle, text } from "../excalidraw/elements.ts";
import { measureTextWidth } from "./metrics.ts";
import { highlightSource, sourceFromHighlight } from "./syntax-highlighter.ts";
import type { HighlightLines } from "./syntax-highlighter.ts";
import type { Bounds } from "../foundation-contracts.ts";
import type { RenderableCodeStatement } from "../semantic-contracts.ts";
import type { Drawing } from "../excalidraw/document.ts";
import {
  MAX_DRAWING_HIGHLIGHT_RUNS,
  MAX_HIGHLIGHT_LINE_CHARACTERS,
  MAX_HIGHLIGHT_LINES,
  MAX_HIGHLIGHT_RUNS,
  MAX_HIGHLIGHT_SOURCE_CHARACTERS,
} from "./code-policy.ts";

const FONT_SIZE = 16;
const LINE_HEIGHT = 1.45;
const HEADER_HEIGHT = 40;
const PADDING = 20;
const GUTTER_WIDTH = 42;

export type HighlightFallbackReason =
  | "not-requested"
  | "not-prepared"
  | "source-budget"
  | "empty-source"
  | "block-budget"
  | "drawing-budget"
  | "source-mismatch"
  | "highlight-error";

export type HighlightResult =
  | { lines: HighlightLines; reason: null }
  | { lines: null; reason: HighlightFallbackReason };

interface Position {
  x: number;
  y: number;
}

export interface XDrawCodeMetadata extends Record<string, unknown> {
  type: "code";
  source: string;
  language: string | null;
  title: string | null;
  highlighted: boolean;
  highlightFallback: HighlightFallbackReason | null;
}

function linesOf(block: Pick<RenderableCodeStatement, "value">): string[] {
  return String(block.value).split("\n");
}

export function codeBlockRequiredWidth(block: RenderableCodeStatement): number {
  const content = linesOf(block).reduce((width, line) => (
    Math.max(width, measureTextWidth(line, FONT_SIZE, FONT.code))
  ), 1);
  return Math.ceil(PADDING * 2 + (block.lineNumbers ? GUTTER_WIDTH : 0) + content);
}

export function measureCodeBlock(block: RenderableCodeStatement): number {
  return Math.ceil(HEADER_HEIGHT + PADDING * 2 + linesOf(block).length * FONT_SIZE * LINE_HEIGHT);
}

function highlightedLines(drawing: Drawing, block: RenderableCodeStatement): HighlightResult {
  if (!block.highlight) return { lines: null, reason: "not-requested" };
  if (!drawing.syntaxHighlighting) return { lines: null, reason: "not-prepared" };
  const sourceLines = linesOf(block);
  if (block.value.length > MAX_HIGHLIGHT_SOURCE_CHARACTERS
      || sourceLines.length > MAX_HIGHLIGHT_LINES
      || sourceLines.some((line) => line.length > MAX_HIGHLIGHT_LINE_CHARACTERS)) {
    return { lines: null, reason: "source-budget" };
  }
  try {
    const lines = highlightSource(block.value, block.language);
    const runCount = lines.reduce((count, line) => count + line.filter((run) => run.text.length).length, 0);
    if (!runCount) return { lines: null, reason: "empty-source" };
    if (runCount > MAX_HIGHLIGHT_RUNS) return { lines: null, reason: "block-budget" };
    if (drawing.highlightRunsUsed + runCount > MAX_DRAWING_HIGHLIGHT_RUNS) {
      return { lines: null, reason: "drawing-budget" };
    }
    if (sourceFromHighlight(lines) !== block.value) return { lines: null, reason: "source-mismatch" };
    drawing.highlightRunsUsed += runCount;
    return { lines, reason: null };
  } catch {
    return { lines: null, reason: "highlight-error" };
  }
}

function renderPlainSource(
  drawing: Drawing,
  block: RenderableCodeStatement,
  position: Position,
  groupIds: string[],
): void {
  drawing.add(text(`${block.id}:source`, position, block.value, {
    fontFamily: FONT.code,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    strokeColor: "#24292f",
    groupIds,
  }));
}

function renderHighlightedSource(
  drawing: Drawing,
  block: RenderableCodeStatement,
  position: Position,
  lines: HighlightLines,
  groupIds: string[],
): void {
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    let consumed = "";
    let runIndex = 0;
    for (const run of lines[lineIndex]) {
      if (run.text.length) {
        drawing.add(text(
          `${block.id}:source:${lineIndex + 1}:${runIndex + 1}`,
          {
            x: position.x + measureTextWidth(consumed, FONT_SIZE, FONT.code),
            y: position.y + lineIndex * FONT_SIZE * LINE_HEIGHT,
          },
          run.text,
          {
            fontFamily: FONT.code,
            fontSize: FONT_SIZE,
            lineHeight: LINE_HEIGHT,
            strokeColor: run.color,
            groupIds,
          },
        ));
        runIndex += 1;
      }
      consumed += run.text;
    }
  }
}

export function renderCodeBlock(drawing: Drawing, block: RenderableCodeStatement, bounds: Bounds): void {
  const groupIds = [`${block.id}:group`];
  const sourceX = bounds.x + PADDING + (block.lineNumbers ? GUTTER_WIDTH : 0);
  const sourceY = bounds.y + HEADER_HEIGHT + PADDING;
  const highlight = highlightedLines(drawing, block);
  const frameElement = rectangle(`${block.id}:frame`, bounds, {
      backgroundColor: "#f6f8fa",
      strokeColor: "#d0d7de",
      strokeWidth: 1,
      groupIds,
    });
  const metadata: XDrawCodeMetadata = {
      type: "code",
      source: block.value,
      language: block.language ?? null,
      title: block.title ?? null,
      highlighted: Boolean(highlight.lines),
      highlightFallback: highlight.reason,
  };
  frameElement.customData = { xdraw: metadata };
  drawing.add(
    frameElement,
  );
  if (block.title) {
    drawing.add(text(`${block.id}:title`, { x: bounds.x + PADDING, y: bounds.y + 10 }, block.title, {
      fontFamily: FONT.bold,
      fontSize: 17,
      strokeColor: "#24292f",
      groupIds,
    }));
  }
  drawing.add(
    text(`${block.id}:language`, { x: bounds.x + PADDING, y: bounds.y + 10 }, block.language ?? "code", {
      fontFamily: FONT.normal,
      fontSize: 14,
      width: bounds.width - PADDING * 2,
      textAlign: block.title ? "right" : "left",
      autoResize: false,
      strokeColor: "#57606a",
      groupIds,
    }),
  );
  if (block.lineNumbers) {
    drawing.add(text(
      `${block.id}:lines`,
      { x: bounds.x + PADDING, y: sourceY },
      linesOf(block).map((_, index) => String(index + 1)).join("\n"),
      {
        fontFamily: FONT.code,
        fontSize: FONT_SIZE,
        lineHeight: LINE_HEIGHT,
        width: GUTTER_WIDTH - 12,
        textAlign: "right",
        autoResize: false,
        strokeColor: "#8c959f",
        groupIds,
      },
    ));
  }
  if (highlight.lines) {
    renderHighlightedSource(drawing, block, { x: sourceX, y: sourceY }, highlight.lines, groupIds);
  } else {
    renderPlainSource(drawing, block, { x: sourceX, y: sourceY }, groupIds);
  }
}
