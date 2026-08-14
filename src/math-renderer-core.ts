import { liteAdaptor } from "@mathjax/src/mjs/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/mjs/handlers/html.js";
import { TeX } from "@mathjax/src/mjs/input/tex.js";
import "@mathjax/src/mjs/input/tex/ams/AmsConfiguration.js";
import { mathjax } from "@mathjax/src/mjs/mathjax.js";
import { SVG } from "@mathjax/src/mjs/output/svg.js";
import "@mathjax/src/mjs/util/asyncLoad/esm.js";
import "./math-font-data.ts";

const FORMULA_HEIGHT = 72;

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const input = new TeX({
  packages: ["base", "ams"],
  maxBuffer: 5 * 1024,
  maxTemplateSubtitutions: 1_000,
  formatError: (_jax: unknown, error: unknown) => {
    throw error;
  },
});
const output = new SVG({ fontCache: "local", localID: "xdraw-formula" });
const document = mathjax.document("", { InputJax: input, OutputJax: output });

export interface RenderedFormulaSvg {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly rendererVersion: string;
}

export class FormulaCoreSyntaxError extends Error {}

export function formulaRenderErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function standaloneSvg(container: unknown): Omit<RenderedFormulaSvg, "rendererVersion"> {
  const serialized = adaptor.outerHTML(container as never);
  const match = serialized.match(/<svg\b[\s\S]*<\/svg>/iu);
  if (!match) throw new Error("MathJax did not produce an SVG element");
  const viewBox = match[0].match(/\bviewBox="([^"]+)"/iu)?.[1]
    ?.trim()
    .split(/[ ,]+/u)
    .map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
    throw new Error("MathJax SVG has no usable viewBox");
  }
  const [, , viewWidth, viewHeight] = viewBox;
  if (!(viewWidth > 0) || !(viewHeight > 0)) throw new Error("MathJax SVG has invalid dimensions");
  const height = FORMULA_HEIGHT;
  const width = Math.max(16, round(height * viewWidth / viewHeight));
  const svg = match[0]
    .replace(/\sdata-[\w:-]+="[^"]*"/giu, "")
    .replace(/\sstyle="[^"]*"/giu, "")
    .replace(/\swidth="[^"]*"/iu, ` width="${width}"`)
    .replace(/\sheight="[^"]*"/iu, ` height="${height}"`);
  return { svg, width, height };
}

export async function renderFormulaSvgCore(source: string): Promise<RenderedFormulaSvg> {
  input.reset();
  let container: unknown;
  try {
    container = await Promise.resolve(
      mathjax.handleRetriesFor((): unknown => document.convert(source, { display: true })) as unknown,
    );
  } catch (error) {
    throw new FormulaCoreSyntaxError(formulaRenderErrorMessage(error), { cause: error });
  }
  return { ...standaloneSvg(container), rendererVersion: mathjax.version };
}
