import {
  DEFAULT_ASSET_LIMITS,
  digestAssetBytes,
  encodeAssetBase64,
  inspectSvgDimensions,
} from "../../assets.ts";
import { image, rectangle } from "../../elements.ts";
import {
  FORMULA_RENDER_TIMEOUT_MS,
  FormulaRenderInfrastructureError,
  FormulaRenderTimeoutError,
  FormulaSyntaxError,
  renderFormulaSvg,
} from "./renderer.ts";
import { createDiagnosticCollector } from "../../diagnostics.ts";
import { DiagnosticError } from "../../semantic.ts";
import type { Bounds, EmbeddedAssetFiles } from "../../foundation-contracts.ts";
import type { NodeMeasurementTarget, ResolvedNodeStyle } from "../../layout-contracts.ts";
import type { FormulaNodePlan } from "../../rich-node-contracts.ts";
import type { DrawingElement } from "../../render-contracts.ts";
import type { NodeStatement, SemanticDocument, SemanticStatement } from "../../semantic-contracts.ts";

export const FORMULA_LIMITS = Object.freeze({
  count: 100,
  sourceCharacters: 2 * 1024,
  aggregateSourceCharacters: 32 * 1024,
  fileBytes: 256 * 1024,
  aggregateBytes: 5 * 1024 * 1024,
  preparationMilliseconds: 30_000,
});

const MAX_AUTO_HEIGHT = 240;

export interface PreparedFormula {
  readonly source: string;
  readonly width: number;
  readonly height: number;
  readonly fileId: string;
  readonly digest: string;
  readonly rendererVersion: string;
}

type PreparedFormulaAsset = Omit<PreparedFormula, "source">;

export interface FormulaPreparation {
  readonly files: EmbeddedAssetFiles;
  readonly formulas: ReadonlyMap<NodeMeasurementTarget, PreparedFormula>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
}

function formulaError(
  code: string,
  node: NodeStatement,
  message: string,
  cause?: unknown,
): DiagnosticError {
  const collector = createDiagnosticCollector();
  collector.error(code, message, node);
  const error = new DiagnosticError(collector.diagnostics);
  if (cause !== undefined) Object.defineProperty(error, "cause", { value: cause });
  return error;
}

function formulaNodes(
  statements: readonly SemanticStatement[],
  result: NodeStatement[] = [],
): NodeStatement[] {
  for (const statement of statements) {
    if (statement.type === "node" && statement.kind === "formula") result.push(statement);
    if (statement.statements) formulaNodes(statement.statements, result);
  }
  return result;
}

function normalizeFormulaSource(source: string): string {
  const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const nonEmpty = lines.filter((line) => line.trim());
  const indentation = nonEmpty.length
    ? Math.min(...nonEmpty.map((line) => line.match(/^\s*/u)?.[0].length ?? 0))
    : 0;
  return lines.map((line) => line.slice(Math.min(indentation, line.length))).join("\n").trim();
}

async function prepare(document: SemanticDocument): Promise<FormulaPreparation> {
  const nodes = formulaNodes(document.statements);
  if (nodes.length > FORMULA_LIMITS.count) {
    throw formulaError(
      "XD1260",
      nodes[FORMULA_LIMITS.count],
      `a document may contain at most ${FORMULA_LIMITS.count} formulas`,
    );
  }
  if (!nodes.length) return { files: {}, formulas: new Map() };

  let aggregateSourceCharacters = 0;
  const formulas = nodes.map((node) => {
    const source = node.authoredSource ?? node.title;
    const renderSource = normalizeFormulaSource(node.title);
    if (!renderSource) throw formulaError("XD1261", node, `formula '${node.id}' must not be empty`);
    if (source.length > FORMULA_LIMITS.sourceCharacters || renderSource.length > FORMULA_LIMITS.sourceCharacters) {
      throw formulaError(
        "XD1262",
        node,
        `formula '${node.id}' exceeds the ${FORMULA_LIMITS.sourceCharacters}-character source limit`,
      );
    }
    aggregateSourceCharacters += source.length;
    return { node, source, renderSource };
  });
  if (aggregateSourceCharacters > FORMULA_LIMITS.aggregateSourceCharacters) {
    throw formulaError(
      "XD1263",
      formulas.at(-1)!.node,
      `formula sources exceed the ${FORMULA_LIMITS.aggregateSourceCharacters}-character document limit`,
    );
  }

  const files: EmbeddedAssetFiles = {};
  const preparedFormulas = new Map<NodeMeasurementTarget, PreparedFormula>();
  const renderedBySource = new Map<string, PreparedFormulaAsset>();
  let aggregateBytes = 0;
  const preparation = new AbortController();
  const preparationTimer = setTimeout(() => {
    preparation.abort(new FormulaRenderTimeoutError(
      `formula preparation exceeded ${FORMULA_LIMITS.preparationMilliseconds}ms`,
    ));
  }, FORMULA_LIMITS.preparationMilliseconds);

  try {
    for (const { node, source, renderSource } of formulas) {
      let asset = renderedBySource.get(renderSource);
      if (!asset) {
        let rendered;
        try {
          rendered = await renderFormulaSvg(renderSource, FORMULA_RENDER_TIMEOUT_MS, preparation.signal);
        } catch (error) {
          if (error instanceof FormulaSyntaxError) {
            throw formulaError("XD1264", node, `formula '${node.id}' is invalid: ${error.message}`, error);
          }
          if (error instanceof FormulaRenderTimeoutError) {
            throw formulaError("XD1270", node, `formula '${node.id}' could not be rendered in time`, error);
          }
          const detail = error instanceof FormulaRenderInfrastructureError
            ? error.message
            : errorMessage(error);
          throw formulaError("XD1271", node, `formula renderer is unavailable: ${detail}`, error);
        }
        const bytes = new TextEncoder().encode(rendered.svg);
        if (bytes.length > FORMULA_LIMITS.fileBytes) {
          throw formulaError(
            "XD1265",
            node,
            `formula '${node.id}' exceeds the ${FORMULA_LIMITS.fileBytes}-byte output limit`,
          );
        }
        let dimensions;
        try {
          dimensions = inspectSvgDimensions(bytes);
        } catch (error) {
          throw formulaError(
            "XD1266",
            node,
            `formula '${node.id}' produced unsafe SVG: ${errorMessage(error)}`,
            error,
          );
        }
        if (!dimensions || dimensions[0] !== rendered.width || dimensions[1] !== rendered.height) {
          throw formulaError("XD1267", node, `formula '${node.id}' produced malformed SVG dimensions`);
        }
        if (dimensions.some((value) => value > DEFAULT_ASSET_LIMITS.dimension)) {
          throw formulaError(
            "XD1268",
            node,
            `formula '${node.id}' exceeds the ${DEFAULT_ASSET_LIMITS.dimension}-pixel dimension limit`,
          );
        }
        const digest = await digestAssetBytes(bytes);
        asset = Object.freeze({
          width: rendered.width,
          height: rendered.height,
          fileId: digest.slice(0, 40),
          digest,
          rendererVersion: rendered.rendererVersion,
        });
        renderedBySource.set(renderSource, asset);
        aggregateBytes += bytes.length;
        if (aggregateBytes > FORMULA_LIMITS.aggregateBytes) {
          throw formulaError(
            "XD1269",
            node,
            `formula assets exceed the ${FORMULA_LIMITS.aggregateBytes}-byte document limit`,
          );
        }
        files[asset.fileId] = {
          id: asset.fileId,
          dataURL: `data:image/svg+xml;base64,${encodeAssetBase64(bytes)}`,
          mimeType: "image/svg+xml",
          created: 1,
          lastRetrieved: 1,
        };
      }
      preparedFormulas.set(node, Object.freeze({ ...asset, source }));
    }
  } finally {
    clearTimeout(preparationTimer);
  }
  return { files, formulas: preparedFormulas };
}

export function prepareDocumentFormulas(document: SemanticDocument): Promise<FormulaPreparation> {
  return prepare(document);
}

export function documentHasFormulas(document: SemanticDocument): boolean {
  return formulaNodes(document.statements).length > 0;
}

function preparedFormula(node: NodeMeasurementTarget, preparation?: FormulaPreparation): PreparedFormula {
  const prepared = preparation?.formulas.get(node);
  if (!prepared) {
    throw new Error("math.formula requires asynchronous compilation with compileAsync");
  }
  return prepared;
}

export function formulaNodeMinimumWidth(
  node: NodeMeasurementTarget,
  preparation?: FormulaPreparation,
): number {
  if (!preparation) return 160;
  const prepared = preparedFormula(node, preparation);
  return Math.min(480, Math.max(160, prepared.width * 1.5));
}

export function planFormulaNode(
  node: NodeMeasurementTarget,
  width: number,
  preparation?: FormulaPreparation,
): FormulaNodePlan {
  const prepared = preparedFormula(node, preparation);
  const naturalHeight = width * prepared.height / prepared.width;
  return Object.freeze({
    type: "formula",
    width,
    height: node.size?.[1] ?? Math.min(MAX_AUTO_HEIGHT, naturalHeight),
    naturalWidth: prepared.width,
    naturalHeight: prepared.height,
    fileId: prepared.fileId,
    source: prepared.source,
    digest: prepared.digest,
    renderer: "mathjax-svg",
    rendererVersion: prepared.rendererVersion,
  });
}

export function renderFormulaNode(
  node: NodeStatement,
  bounds: Bounds,
  style: ResolvedNodeStyle,
  plan: FormulaNodePlan,
): DrawingElement[] {
  const ratio = Math.min(bounds.width / plan.naturalWidth, bounds.height / plan.naturalHeight);
  const width = plan.naturalWidth * ratio;
  const height = plan.naturalHeight * ratio;
  const groupIds = [`${node.id}:group`];
  return [
    rectangle(`${node.id}:frame`, bounds, {
      strokeColor: "transparent",
      backgroundColor: "transparent",
      opacity: 0,
      locked: style.locked,
      groupIds,
    }),
    image(`${node.id}:image`, {
      x: bounds.x + (bounds.width - width) / 2,
      y: bounds.y + (bounds.height - height) / 2,
      width,
      height,
    }, plan.fileId, {
      locked: style.locked,
      groupIds,
      description: "Mathematical formula",
      customData: {
        xdraw: {
          type: "formula",
          source: plan.source,
          renderer: plan.renderer,
          rendererVersion: plan.rendererVersion,
          displayMode: true,
          digest: plan.digest,
        },
      },
    }),
  ];
}
