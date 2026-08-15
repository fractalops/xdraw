import { FONT_ADVANCES } from "./font-metrics.generated.ts";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const WIDE_GLYPH = /[\p{Extended_Pictographic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const DEFAULT_ADVANCE = 0.61;
export type FontFamily = 1 | 2 | 3 | 7;
const FONT_METRICS: Partial<Record<FontFamily, Readonly<Record<string, number>>>> = FONT_ADVANCES;

export function containsWideGlyph(value: string): boolean {
  return WIDE_GLYPH.test(value);
}

export function graphemes(value: string): string[] {
  return [...segmenter.segment(value)].map(({ segment }) => segment);
}

function glyphFactor(value: string, fontFamily: FontFamily): number {
  if (WIDE_GLYPH.test(value)) return 1;
  return FONT_METRICS[fontFamily]?.[value] ?? DEFAULT_ADVANCE;
}

export function measureTextWidth(value: string | number, fontSize: number, fontFamily: FontFamily = 3): number {
  return graphemes(String(value)).reduce(
    (width, glyph) => width + glyphFactor(glyph, fontFamily) * fontSize,
    0,
  );
}

export const DEFAULT_CONNECTOR_LABEL_SIZE = 15;

export function measureConnectorLabelWidth(
  value: string | number,
  fontSize = DEFAULT_CONNECTOR_LABEL_SIZE,
  fontFamily: FontFamily = 3,
): number {
  const width = Math.max(...String(value).split("\n").map((line) => measureTextWidth(line, fontSize, fontFamily)), 1);
  return Math.min(220, Math.max(70, width + 16));
}

function splitToken(token: string, width: number, fontSize: number, fontFamily: FontFamily): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const glyph of graphemes(token)) {
    if (chunk && measureTextWidth(`${chunk}${glyph}`, fontSize, fontFamily) > width) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += glyph;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function wrapTextToWidth(value: string, width: number, fontSize: number, fontFamily: FontFamily = 3): string {
  if (!(width > 0) || !(fontSize > 0)) return value;
  return value.split("\n").flatMap((paragraph) => {
    if (!paragraph) return [""];
    const tokens = paragraph.split(/\s+/u).filter(Boolean)
      .flatMap((token) => measureTextWidth(token, fontSize, fontFamily) <= width
        ? [token]
        : splitToken(token, width, fontSize, fontFamily));
    const lines: string[] = [];
    let line = "";
    for (const token of tokens) {
      const candidate = line ? `${line} ${token}` : token;
      if (line && measureTextWidth(candidate, fontSize, fontFamily) > width) {
        lines.push(line);
        line = token;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }).join("\n");
}

const FIT_TOLERANCE = 0.01;

export function fitTextSize(
  value: string,
  width: number,
  preferredSize: number,
  minimumSize = 12,
  fontFamily: FontFamily = 3,
): number {
  const longest = value.split(/\s+/u).reduce((current, token) => (
    measureTextWidth(token, 1, fontFamily) > measureTextWidth(current, 1, fontFamily) ? token : current
  ), "");
  const advance = Math.max(measureTextWidth(longest, 1, fontFamily), 1);
  // Solving for the size that fills the width exactly leaves the result a
  // rounding step over it, and wrapping then splits the word it was shrunk to
  // fit. Give up a hundredth of a pixel so the fit survives the arithmetic.
  return Math.max(minimumSize, Math.min(preferredSize, (width - FIT_TOLERANCE) / advance));
}
