import { createLayeredGraph, readLayeredBounds } from "./graph.ts";
import { runElkLayout } from "./worker-transport.ts";
import type { Bounds } from "../../foundation-contracts.ts";
import type { SemanticDocument } from "../../semantic-contracts.ts";
import type { ElkLayout } from "./graph.ts";
import type { FormulaPreparation } from "../../nodes/math/formula.ts";

export type LayeredPreparation =
  | { status: "not-requested"; bounds: null }
  | { status: "built-in"; reason: "compound-layout" | "empty"; bounds: null }
  | { status: "prepared"; bounds: ReadonlyMap<string, Bounds> };

export async function prepareLayeredLayout(
  document: SemanticDocument,
  options: {
    formulaPreparation?: FormulaPreparation;
    layout?: ElkLayout;
    timeoutMs?: number;
  } = {},
): Promise<LayeredPreparation> {
  const layout = document.statements.find((statement) => statement.type === "layout");
  if (layout?.kind !== "layered") return { status: "not-requested", bounds: null };

  // ELK placement currently models only top-level nodes and their connections.
  if (document.statements.some((statement) => ["frame", "group", "lane", "section"].includes(statement.type))) {
    return { status: "built-in", reason: "compound-layout", bounds: null };
  }

  const prepared = createLayeredGraph(document, layout, options.formulaPreparation);
  if (!prepared) return { status: "built-in", reason: "empty", bounds: null };
  const result = options.layout
    ? await options.layout(prepared.graph)
    : await runElkLayout(prepared.graph, { timeoutMs: options.timeoutMs });
  return { status: "prepared", bounds: readLayeredBounds(result, prepared.nodeIds) };
}
