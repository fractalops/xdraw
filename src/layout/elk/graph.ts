import { layoutGap, ROUTING_CLEARANCE } from "../../routing/clearances.ts";
import { splitEndpoint } from "../../routing/endpoints.ts";
import { createMeasurer } from "../../compile/measurement.ts";
import { measureConnectorLabelWidth } from "../../text/metrics.ts";
import { createStyleResolver } from "../../compile/styles.ts";
import type { Bounds } from "../../contracts/foundation.ts";
import type {
  ConnectionStatement,
  LayoutStatement,
  NodeStatement,
  SemanticDocument,
  SemanticStatement,
} from "../../contracts/semantic.ts";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import type { FormulaPreparation } from "../../nodes/math/formula.ts";

const NODE_WIDTH = 240;
const MAXIMUM_LAYOUT_COORDINATE = 10_000_000;
const MAXIMUM_LAYERED_NODES = 500;
const MAXIMUM_LAYERED_SEGMENTS = 400;
const MINIMUM_ROUTABLE_GAP = ROUTING_CLEARANCE.endpoint * 2 + ROUTING_CLEARANCE.channel * 2;

export type ElkLayout = (graph: ElkNode) => Promise<ElkNode>;

export interface LayeredGraph {
  graph: ElkNode;
  nodeIds: ReadonlySet<string>;
}

function isNode(statement: SemanticStatement): statement is NodeStatement {
  return statement.type === "node";
}

function isConnection(statement: SemanticStatement): statement is ConnectionStatement {
  return statement.type === "connection";
}

function finiteDimension(value: number | undefined, label: string): number {
  const rounded = Math.round(value ?? Number.NaN);
  if (!Number.isFinite(rounded) || rounded <= 0 || rounded > MAXIMUM_LAYOUT_COORDINATE) {
    throw new Error(`ELK returned an invalid ${label}`);
  }
  return rounded;
}

function finiteCoordinate(value: number | undefined, label: string): number {
  const rounded = Math.round(value ?? Number.NaN);
  if (!Number.isFinite(rounded) || Math.abs(rounded) > MAXIMUM_LAYOUT_COORDINATE) {
    throw new Error(`ELK returned an invalid ${label}`);
  }
  return rounded;
}

export function createLayeredGraph(
  document: SemanticDocument,
  layout: LayoutStatement,
  formulaPreparation?: FormulaPreparation,
): LayeredGraph | null {
  const nodes = document.statements.filter(isNode);
  if (nodes.length === 0) return null;
  if (nodes.length > MAXIMUM_LAYERED_NODES) {
    throw new Error(`layered layout supports at most ${MAXIMUM_LAYERED_NODES} nodes`);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const connections = document.statements.filter(isConnection);
  const styles = createStyleResolver(document);
  const measurer = createMeasurer(styles, formulaPreparation);
  const requestedGap = layoutGap(layout, 36);
  const rowGap = Math.max(MINIMUM_ROUTABLE_GAP, requestedGap);
  const labelWidth = connections.reduce((maximum, connection) => {
    const technology = typeof connection.attributes?.technology === "string"
      ? `[${connection.attributes.technology}]`
      : "";
    const label = [connection.label, technology].filter(Boolean).join("\n");
    return label ? Math.max(maximum, measureConnectorLabelWidth(label) + 28) : maximum;
  }, 0);
  const layerGap = Math.max(MINIMUM_ROUTABLE_GAP, requestedGap, labelWidth);

  const edges: ElkExtendedEdge[] = connections.flatMap((connection, connectionIndex) => (
    connection.nodes.slice(0, -1).map((endpoint, segmentIndex) => {
      const source = splitEndpoint(endpoint, nodeIds).id;
      const target = splitEndpoint(connection.nodes[segmentIndex + 1], nodeIds).id;
      if (!nodeIds.has(source) || !nodeIds.has(target)) {
        throw new Error(`layered connection requires node endpoints: ${source} -> ${target}`);
      }
      return {
        id: `edge-${connectionIndex}-${segmentIndex}`,
        sources: [source],
        targets: [target],
      };
    })
  ));
  if (edges.length > MAXIMUM_LAYERED_SEGMENTS) {
    throw new Error(`layered layout supports at most ${MAXIMUM_LAYERED_SEGMENTS} connection segments`);
  }

  return {
    nodeIds,
    graph: {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.randomSeed": "1",
        "elk.separateConnectedComponents": "true",
        "elk.spacing.componentComponent": String(Math.max(80, rowGap)),
        "elk.spacing.nodeNode": String(rowGap),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(layerGap),
      },
      children: nodes.map((node) => ({
        id: node.id,
        width: NODE_WIDTH,
        height: measurer.measureNode(node, NODE_WIDTH),
      })),
      edges,
    },
  };
}

export function readLayeredBounds(
  result: ElkNode,
  nodeIds: ReadonlySet<string>,
): ReadonlyMap<string, Bounds> {
  const bounds = new Map<string, Bounds>();
  for (const child of result.children ?? []) {
    if (!nodeIds.has(child.id)) throw new Error(`ELK returned an unknown node: ${child.id}`);
    if (bounds.has(child.id)) throw new Error(`ELK returned duplicate node geometry: ${child.id}`);
    bounds.set(child.id, {
      x: finiteCoordinate(child.x, `${child.id} x`),
      y: finiteCoordinate(child.y, `${child.id} y`),
      width: finiteDimension(child.width, `${child.id} width`),
      height: finiteDimension(child.height, `${child.id} height`),
    });
  }
  if (bounds.size !== nodeIds.size) throw new Error("ELK returned incomplete node geometry");

  const left = Math.min(...[...bounds.values()].map((item) => item.x));
  const top = Math.min(...[...bounds.values()].map((item) => item.y));
  return new Map([...bounds].map(([id, placement]) => [id, {
    ...placement,
    x: finiteCoordinate(placement.x - left, `${id} normalized x`),
    y: finiteCoordinate(placement.y - top, `${id} normalized y`),
  }]));
}
