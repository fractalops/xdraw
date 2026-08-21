import {
  architectureNodeMinimumWidth,
  isArchitectureNodeKind,
  planArchitectureNode,
  renderArchitectureNode,
} from "./architecture.ts";
import { planTable, renderTable } from "./table.ts";
import {
  cartesianNodeMinimumWidth,
  planCartesianNode,
  renderCartesianNode,
} from "./cartesian.ts";
import {
  formulaNodeMinimumWidth,
  planFormulaNode,
  renderFormulaNode,
} from "./math/formula.ts";
import type { Bounds } from "../contracts/foundation.ts";
import type {
  NodeMeasurementTarget,
  ResolvedNodeStyle,
  StyleResolver,
} from "../contracts/layout.ts";
import type { DrawingElement } from "../contracts/render.ts";
import type { NodeStatement } from "../contracts/semantic.ts";
import type { RichNodePlan } from "../contracts/rich-node.ts";
import type { FormulaPreparation } from "./math/formula.ts";

interface RichNodeFamily {
  readonly name: string;
  supports(node: NodeMeasurementTarget): boolean;
  minimumWidth(node: NodeMeasurementTarget, preparation?: FormulaPreparation): number;
  plan(
    node: NodeMeasurementTarget,
    width: number,
    style?: ResolvedNodeStyle,
    preparation?: FormulaPreparation,
    resolver?: StyleResolver,
  ): RichNodePlan;
  render(
    node: NodeStatement,
    bounds: Bounds,
    style: ResolvedNodeStyle,
    plan: RichNodePlan,
  ): DrawingElement[];
}

const RICH_NODE_FAMILIES: readonly RichNodeFamily[] = Object.freeze([
  Object.freeze({
    name: "cartesian",
    supports: (node: NodeMeasurementTarget) => node.kind === "cartesian",
    minimumWidth: () => cartesianNodeMinimumWidth(),
    plan: (
      node: NodeMeasurementTarget,
      width: number,
      style?: ResolvedNodeStyle,
      _preparation?: FormulaPreparation,
      resolver?: StyleResolver,
    ) => planCartesianNode(node, width, style, resolver),
    render: (node: NodeStatement, bounds: Bounds, style: ResolvedNodeStyle, plan: RichNodePlan) => {
      if (plan.type !== "cartesian") throw new Error(`cartesian node '${node.id}' received an incompatible plan`);
      return renderCartesianNode(node, bounds, style, plan);
    },
  }),
  Object.freeze({
    name: "formula",
    supports: (node: NodeMeasurementTarget) => node.kind === "formula",
    minimumWidth: (node: NodeMeasurementTarget, preparation?: FormulaPreparation) => (
      formulaNodeMinimumWidth(node, preparation)
    ),
    plan: (
      node: NodeMeasurementTarget,
      width: number,
      _style?: ResolvedNodeStyle,
      preparation?: FormulaPreparation,
    ) => planFormulaNode(node, width, preparation),
    render: (node: NodeStatement, bounds: Bounds, style: ResolvedNodeStyle, plan: RichNodePlan) => {
      if (plan.type !== "formula") throw new Error(`formula node '${node.id}' received an incompatible plan`);
      return renderFormulaNode(node, bounds, style, plan);
    },
  }),
  Object.freeze({
    name: "table",
    supports: (node: NodeMeasurementTarget) => node.kind === "table",
    minimumWidth: () => 360,
    plan: (node: NodeMeasurementTarget, width: number) => planTable(node, width),
    render: (node: NodeStatement, bounds: Bounds, _style: ResolvedNodeStyle, plan: RichNodePlan) => {
      if (plan.type !== "table") throw new Error(`table node '${node.id}' received an incompatible plan`);
      return renderTable(node, bounds, plan);
    },
  }),
  Object.freeze({
    name: "architecture",
    supports: (node: NodeMeasurementTarget) => isArchitectureNodeKind(node.kind),
    minimumWidth: (node: NodeMeasurementTarget) => architectureNodeMinimumWidth(node.kind),
    plan: (node: NodeMeasurementTarget, width: number, style?: ResolvedNodeStyle) => (
      planArchitectureNode(node, width, style)
    ),
    render: (node: NodeStatement, bounds: Bounds, style: ResolvedNodeStyle, plan: RichNodePlan) => {
      if (plan.type !== "architecture") {
        throw new Error(`architecture node '${node.id}' received an incompatible plan`);
      }
      return renderArchitectureNode(node, bounds, style);
    },
  }),
]);

function familyFor(node: NodeMeasurementTarget): RichNodeFamily | undefined {
  return RICH_NODE_FAMILIES.find((family) => family.supports(node));
}

export function richNodeMinimumWidth(node: NodeMeasurementTarget): number | null {
  return familyFor(node)?.minimumWidth(node) ?? null;
}

export function planRichNode(
  node: NodeMeasurementTarget,
  width: number,
  style?: ResolvedNodeStyle,
  preparation?: FormulaPreparation,
  resolver?: StyleResolver,
): RichNodePlan | null {
  return familyFor(node)?.plan(node, width, style, preparation, resolver) ?? null;
}

export function renderRichNode(
  node: NodeStatement,
  bounds: Bounds,
  style: ResolvedNodeStyle,
  plan: RichNodePlan,
): DrawingElement[] {
  const family = familyFor(node);
  if (!family) throw new Error(`node '${node.id}' has a rich plan but no rich-node family`);
  return family.render(node, bounds, style, plan);
}

export function richNodeFamilyName(node: NodeMeasurementTarget): string | null {
  return familyFor(node)?.name ?? null;
}
