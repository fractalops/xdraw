import { FONT_ADVANCES } from "./font-metrics.generated.js";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const WIDE_GLYPH = /[\p{Extended_Pictographic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const DEFAULT_ADVANCE = 0.61;

export function containsWideGlyph(value) {
  return WIDE_GLYPH.test(value);
}

export function graphemes(value) {
  return [...segmenter.segment(value)].map(({ segment }) => segment);
}

function glyphFactor(value, fontFamily) {
  if (WIDE_GLYPH.test(value)) return 1;
  return FONT_ADVANCES[fontFamily]?.[value] ?? DEFAULT_ADVANCE;
}

export function measureTextWidth(value, fontSize, fontFamily = 3) {
  return graphemes(String(value)).reduce(
    (width, glyph) => width + glyphFactor(glyph, fontFamily) * fontSize,
    0,
  );
}

export const DEFAULT_CONNECTOR_LABEL_SIZE = 15;

export function measureConnectorLabelWidth(value, fontSize = DEFAULT_CONNECTOR_LABEL_SIZE, fontFamily = 3) {
  const width = Math.max(...String(value).split("\n").map((line) => measureTextWidth(line, fontSize, fontFamily)), 1);
  return Math.min(220, Math.max(70, width + 16));
}

function splitToken(token, width, fontSize, fontFamily) {
  const chunks = [];
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

export function wrapTextToWidth(value, width, fontSize, fontFamily = 3) {
  if (!(width > 0) || !(fontSize > 0)) return value;
  return value.split("\n").flatMap((paragraph) => {
    if (!paragraph) return [""];
    const tokens = paragraph.split(/\s+/u).filter(Boolean)
      .flatMap((token) => measureTextWidth(token, fontSize, fontFamily) <= width
        ? [token]
        : splitToken(token, width, fontSize, fontFamily));
    const lines = [];
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

export function fitTextSize(value, width, preferredSize, minimumSize = 12, fontFamily = 3) {
  const longest = value.split(/\s+/u).reduce((current, token) => (
    measureTextWidth(token, 1, fontFamily) > measureTextWidth(current, 1, fontFamily) ? token : current
  ), "");
  const advance = Math.max(measureTextWidth(longest, 1, fontFamily), 1);
  return Math.max(minimumSize, Math.min(preferredSize, width / advance));
}
