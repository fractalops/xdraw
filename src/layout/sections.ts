import type { ArrangedStatement, LayoutSectionStatement } from "../contracts/layout.ts";
import type { SemanticStatement } from "../contracts/semantic.ts";
import { isFinitePoint } from "../excalidraw/freedraw-policy.ts";

export const SECTION_TYPES = new Set<SemanticStatement["type"]>([
  "code", "frame", "group", "lane", "section", "sequence", "tree",
]);

export function isSectionStatement(item: SemanticStatement): item is LayoutSectionStatement {
  return item.type === "code"
    || item.type === "frame"
    || item.type === "group"
    || item.type === "lane"
    || item.type === "section"
    || item.type === "sequence"
    || item.type === "tree";
}

export function childSections(statements: readonly SemanticStatement[]): LayoutSectionStatement[] {
  return statements.filter(isSectionStatement);
}

export function arrangedItems(statements: readonly SemanticStatement[]): ArrangedStatement[] {
  return statements.filter((item): item is ArrangedStatement => (
    (item.type === "node" && !isFinitePoint(item.at))
    || item.type === "layout-text"
    || SECTION_TYPES.has(item.type)
  ));
}
