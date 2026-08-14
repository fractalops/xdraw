import { measureCard } from "./components.ts";
import {
  DEFAULT_CONNECTOR_LABEL_SIZE,
  measureConnectorLabelWidth,
  wrapTextToWidth,
} from "./text-metrics.ts";
import { layoutGap } from "./routing/clearances.ts";
import { codeBlockRequiredWidth, measureCodeBlock } from "./code-block.ts";
import { arrangedItems, childSections } from "./layout/sections.ts";
import {
  planRichNode,
  registerRichNodePlanner,
  richNodeMinimumWidth,
} from "./rich-nodes.ts";
import type {
  ArrangedStatement,
  Measurer,
  NodeMeasurementTarget,
  StyleResolver,
} from "./layout-contracts.ts";
import type {
  CodeStatement,
  ConnectionStatement,
  ContainerStatement,
  LayoutStatement,
  NodeStatement,
  NoteStatement,
  RenderableCodeStatement,
  SemanticStatement,
  TreeStatement,
} from "./semantic-contracts.ts";
import type { DiagnosticCollector } from "./foundation-contracts.ts";
import type { RichNodePlan } from "./rich-node-contracts.ts";
import type { FormulaPreparation } from "./math/formula.ts";

interface ArrangedRow {
  items: ArrangedStatement[];
  widths: number[];
}

export interface RowPlan {
  columns: number;
  rows: number;
  slotWidth: number;
}

function bodyOf(node: NodeMeasurementTarget): string | undefined {
  const value = node.statements?.find((item) => item.type === "body");
  return value?.type === "body" && typeof value.value === "string" ? value.value : undefined;
}

function nodeStatements(statements: readonly SemanticStatement[]): NodeStatement[] {
  return statements.filter((item): item is NodeStatement => item.type === "node");
}

function connectionLabels(connection: ConnectionStatement): string[] {
  const relationship = typeof connection.attributes?.technology === "string"
    ? [connection.label, `[${connection.attributes.technology}]`].filter(Boolean).join("\n")
    : connection.label;
  return [relationship, connection.attributes["start-label"], connection.attributes["end-label"]]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function resolveContainerGap(
  node: ContainerStatement,
  layout: LayoutStatement | undefined,
  diagnostics: DiagnosticCollector | null = null,
): number {
  const requested = layoutGap(layout, layout?.kind === "column" ? 20 : 40);
  const connections = node.statements.filter((item) => item.type === "connection");
  if (!connections.length) return requested;
  const labels = connections.flatMap(connectionLabels);
  if (!labels.length) {
    if (layout?.ownsChildren) return Math.max(requested, layout.kind === "column" ? 36 : 40);
    const resolved = Math.max(requested, layout?.kind === "column" ? 52 : 64);
    if (layout?.gap !== undefined && resolved > requested) {
      diagnostics?.warn("XD2001", `layout gap ${requested} was raised to ${resolved} so connectors remain visible`, layout);
    }
    return resolved;
  }
  if (layout?.kind === "column") {
    const labelHeight = labels.reduce((height, label) => {
      const width = measureConnectorLabelWidth(label);
      const lines = wrapTextToWidth(label, width, DEFAULT_CONNECTOR_LABEL_SIZE).split("\n").length;
      return Math.max(height, lines * DEFAULT_CONNECTOR_LABEL_SIZE * 1.25);
    }, 0);
    const resolved = Math.max(requested, 52, Math.ceil(labelHeight + 28));
    if (layout?.gap !== undefined && resolved > requested) {
      diagnostics?.warn("XD2001", `layout gap ${requested} was raised to ${resolved} so connector labels fit`, layout);
    }
    return resolved;
  }
  const labelWidth = labels.reduce((width, label) => Math.max(width, measureConnectorLabelWidth(label)), 0);
  const resolved = Math.max(requested, 64, Math.ceil(labelWidth + 28));
  if (layout?.gap !== undefined && resolved > requested) {
    diagnostics?.warn("XD2001", `layout gap ${requested} was raised to ${resolved} so connector labels fit`, layout);
  }
  return resolved;
}

export function calculateSlotWidth(
  totalWidth: number,
  count: number,
  gap: number,
  label: string,
  minimumWidth = 40,
): number {
  if (!Number.isFinite(totalWidth) || totalWidth <= 0) throw new Error(`${label} width must be positive and finite`);
  if (!Number.isFinite(gap) || gap < 0) throw new Error(`${label} gap must be finite and non-negative`);
  if (!Number.isFinite(minimumWidth) || minimumWidth <= 0) {
    throw new Error(`${label} minimum width must be positive and finite`);
  }
  if (!Number.isInteger(count) || count < 1) throw new Error(`${label} requires at least one item`);
  const width = (totalWidth - gap * (count - 1)) / count;
  if (width < minimumWidth) {
    throw new Error(`${label} cannot fit ${count} items at a minimum width of ${minimumWidth}`);
  }
  return width;
}

export function calculateRowPlan(
  totalWidth: number,
  count: number,
  gap: number,
  label: string,
  minimumWidth = 140,
): RowPlan {
  if (!Number.isInteger(count) || count < 1) throw new Error(`${label} requires at least one item`);
  const columns = Math.min(count, Math.max(1, Math.floor((totalWidth + gap) / (minimumWidth + gap))));
  return {
    columns,
    rows: Math.ceil(count / columns),
    slotWidth: calculateSlotWidth(totalWidth, columns, gap, label),
  };
}

export function renderableCode(statement: CodeStatement): RenderableCodeStatement {
  if (typeof statement.lineNumbers !== "boolean" || typeof statement.highlight !== "boolean") {
    throw new Error(`code block '${statement.id}' has not been normalized for rendering`);
  }
  return {
    ...statement,
    lineNumbers: statement.lineNumbers,
    highlight: statement.highlight,
  };
}

function arrangedItemMinimumWidth(item: ArrangedStatement): number {
  if (item.size?.[0]) return item.size[0];
  if (item.type === "node") {
    const richMinimum = richNodeMinimumWidth(item);
    if (richMinimum !== null) return richMinimum;
  }
  if (item.type === "layout-text") {
    return item.width ?? Math.min(220, Math.max(100, String(item.value).length * 10 + 20));
  }
  if (item.type === "code") return codeBlockRequiredWidth(renderableCode(item));
  return 120;
}

function completeArrangedRow(
  totalWidth: number,
  gap: number,
  items: ArrangedStatement[],
  minimums: number[],
): ArrangedRow {
  const required = minimums.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, items.length - 1);
  const extra = Math.max(0, totalWidth - required) / items.length;
  return { items, widths: minimums.map((width) => width + extra) };
}

export function calculateArrangedRows(
  totalWidth: number,
  items: readonly ArrangedStatement[],
  gap: number,
): ArrangedRow[] {
  if (!Number.isFinite(totalWidth) || totalWidth <= 0) throw new Error("arranged row width must be positive and finite");
  if (!Number.isFinite(gap) || gap < 0) throw new Error("arranged row gap must be finite and non-negative");
  const rows: ArrangedRow[] = [];
  let rowItems: ArrangedStatement[] = [];
  let minimums: number[] = [];
  let used = 0;
  for (const item of items) {
    const minimum = Math.min(totalWidth, arrangedItemMinimumWidth(item));
    const required = minimum + (rowItems.length ? gap : 0);
    if (rowItems.length && used + required > totalWidth) {
      rows.push(completeArrangedRow(totalWidth, gap, rowItems, minimums));
      rowItems = [];
      minimums = [];
      used = 0;
    }
    rowItems.push(item);
    minimums.push(minimum);
    used += minimum + (rowItems.length > 1 ? gap : 0);
  }
  if (rowItems.length) rows.push(completeArrangedRow(totalWidth, gap, rowItems, minimums));
  return rows;
}

function nodeMinimumHeight(node: NodeMeasurementTarget): number {
  if (node.kind === "junction") return 20;
  if (node.kind === "decision") return 120;
  return ["person", "database"].includes(node.kind) ? 112 : 88;
}

function cached<T extends object, K, V>(
  cache: WeakMap<T, Map<K, V>>,
  node: T,
  key: K,
  calculate: () => V,
): V {
  let widths = cache.get(node);
  if (!widths) {
    widths = new Map();
    cache.set(node, widths);
  }
  const existing = widths.get(key);
  if (existing !== undefined) return existing;
  const measured = calculate();
  widths.set(key, measured);
  return measured;
}

export function createMeasurer(
  styles?: StyleResolver,
  formulaPreparation?: FormulaPreparation,
): Measurer {
  const nodeCache = new WeakMap<NodeMeasurementTarget, Map<number, number>>();
  const richPlanCache = new WeakMap<NodeMeasurementTarget, Map<number, RichNodePlan | null>>();
  const containerCache = new WeakMap<ContainerStatement, Map<string, number>>();

  const planNode = (node: NodeMeasurementTarget, width: number): RichNodePlan | null => cached(
    richPlanCache,
    node,
    width,
    () => planRichNode(node, width, styles?.resolveNode(node), formulaPreparation),
  );

  const measureNode: Measurer["measureNode"] = (node, width) => cached(nodeCache, node, width, () => {
    if (node.size) return node.size[1];
    const richPlan = planNode(node, width);
    if (richPlan) return richPlan.height;
    const style = styles?.resolveNode(node);
    return measureCard({
      title: node.title,
      body: bodyOf(node),
      minimumHeight: nodeMinimumHeight(node),
      padding: node.kind === "decision" ? Math.max(32, style?.padding ?? 20) : style?.padding,
      titleSize: style?.titleSize,
      bodySize: style?.bodySize,
      lineHeight: style?.lineHeight,
      titleLineHeight: style?.titleLineHeight,
      fontFamily: style?.fontFamily,
    }, width);
  });

  const measureAnnotation: Measurer["measureAnnotation"] = (annotation, width) => measureNode({
    kind: "card",
    title: annotation.title,
  }, width);

  const measureLayoutText: Measurer["measureLayoutText"] = (statement, width) => {
    const style = styles?.resolveText(statement);
    const fontSize = style?.fontSize ?? statement.fontSize ?? 18;
    const lineHeight = style?.lineHeight ?? 1.25;
    const wrapWidth = Math.min(statement.width ?? style?.wrapWidth ?? width, width);
    const lines = wrapTextToWidth(statement.value, wrapWidth, fontSize, style?.fontFamily).split("\n").length;
    return Math.max(fontSize * lineHeight, lines * fontSize * lineHeight);
  };

  const measureTree: Measurer["measureTree"] = (tree, width) => {
    const levels = new Map<number, TreeStatement[]>();
    const visit = (node: TreeStatement, depth = 0): void => {
      const items = levels.get(depth) ?? [];
      items.push(node);
      levels.set(depth, items);
      node.statements.filter((child): child is TreeStatement => (
        child.type === "tree" || child.type === "branch" || child.type === "leaf"
      )).forEach((child) => visit(child, depth + 1));
    };
    visit(tree);
    const direction = tree.direction ?? "down";
    const siblingGap = tree.siblingGap ?? 45;
    const levelGap = tree.levelGap ?? 45;
    if (direction === "right") {
      const slotWidth = calculateSlotWidth(width - 90, levels.size, levelGap, "tree levels", 120);
      const height = Math.max(...[...levels].map(([, items]) => {
        const itemHeight = Math.max(...items.map((item) => measureNode(item, slotWidth)));
        return items.length * itemHeight + Math.max(0, items.length - 1) * siblingGap;
      }));
      return Math.max(320, 125 + height);
    }
    return 95 + [...levels].reduce((sum, [depth, items]) => {
      const slotWidth = calculateSlotWidth(width - 90, items.length, siblingGap, `tree level ${depth}`);
      const height = Math.max(...items.map((item) => measureNode(item, slotWidth)));
      return sum + height + levelGap;
    }, 0);
  };

  const measureSequence: Measurer["measureSequence"] = (sequence, width) => {
    const participants = sequence.statements.filter((item) => item.type === "participant");
    const messages = sequence.statements.filter((item) => item.type === "connection");
    if (participants.length < 2) throw new Error("sequence requires at least two participants");
    const slotWidth = calculateSlotWidth(width - 90, participants.length, 60, "sequence participants");
    const participantHeight = Math.max(...participants.map((participant) => measureNode({ ...participant, kind: "person" }, slotWidth)));
    const messageCount = messages.reduce((count, message) => count + message.nodes.length - 1, 0);
    return Math.max(320, 120 + participantHeight + messageCount * 72);
  };

  const measureSection: Measurer["measureSection"] = (section, width, y = 0) => {
    if (section.type === "code") return measureCodeBlock(renderableCode(section));
    if (section.type === "tree") {
      return measureTree(section, width);
    }
    if (section.type === "sequence") return measureSequence(section, width);
    if (["lane", "group", "frame", "section"].includes(section.type)) {
      return measureContainer(section, width, y);
    }
    throw new Error("unsupported measured section");
  };

  const measureArrangedItem: Measurer["measureArrangedItem"] = (item, width, y) => {
    if (item.type === "node") return measureNode(item, item.size?.[0] ?? width);
    if (item.type === "layout-text") return measureLayoutText(item, width);
    if (item.type === "code") return measureCodeBlock(renderableCode(item));
    return measureSection(item, width, y);
  };

  function measureContainer(node: ContainerStatement, width: number, y = 0): number {
    return cached(containerCache, node, `${width}:${y}`, () => {
      const nodes = nodeStatements(node.statements);
      const automatic = nodes.filter((item) => !item.at);
      const explicit = nodes.filter((item): item is NodeStatement & { at: [number, number] } => Boolean(item.at));
      const layout = node.statements.find((item) => item.type === "layout");
      const gap = resolveContainerGap(node, layout, styles?.diagnostics);
      const contentWidth = width - 80;
      const scopedNotes = node.statements.filter((item): item is NoteStatement => (
        item.type === "note" && !item.target && !item.at
      ));
      const scopedNoteHeight = scopedNotes.reduce((sum, note) => (
        sum + measureAnnotation(note, Math.min(420, contentWidth)) + 16
      ), 0);
      const explicitBottom = explicit.reduce((bottom, item) => {
        const itemHeight = item.size?.[1] ?? 110;
        return Math.max(bottom, item.at[1] + itemHeight - y);
      }, 0);
      const automaticStart = explicit.length ? Math.max(76, explicitBottom + gap) : 76;
      if (layout?.ownsChildren) {
        const items = arrangedItems(node.statements);
        let arrangedHeight = 0;
        if (items.length && layout.kind === "column") {
          arrangedHeight = items.reduce((sum, item, itemIndex) => (
            sum + measureArrangedItem(item, item.size?.[0] ?? contentWidth, y + automaticStart + sum)
            + (itemIndex < items.length - 1 ? gap : 0)
          ), 0);
        } else if (items.length) {
          const rows = calculateArrangedRows(contentWidth, items, gap);
          for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const row = rows[rowIndex];
            arrangedHeight += Math.max(...row.items.map((item, itemIndex) => (
              measureArrangedItem(item, row.widths[itemIndex], y + automaticStart + arrangedHeight)
            )));
            if (rowIndex < rows.length - 1) arrangedHeight += gap;
          }
        }
        const contentBottom = Math.max(
          88,
          explicitBottom + (explicit.length ? 24 : 0),
          automaticStart + arrangedHeight + (items.length ? 35 : 0),
        );
        return Math.max(220, contentBottom + scopedNoteHeight);
      }
      let nodeHeight = 0;
      if (automatic.length) {
        if (layout?.kind === "column") {
          nodeHeight = automatic.reduce(
            (sum, item) => sum + measureNode(item, item.size?.[0] ?? contentWidth),
            0,
          ) + gap * (automatic.length - 1);
        } else {
          const plan = calculateRowPlan(contentWidth, automatic.length, gap, "row layout");
          for (let index = 0; index < automatic.length; index += plan.columns) {
            const rowItems = automatic.slice(index, index + plan.columns);
            nodeHeight += Math.max(...rowItems.map((item) => measureNode(item, item.size?.[0] ?? plan.slotWidth)));
            if (index + plan.columns < automatic.length) nodeHeight += gap;
          }
        }
      }
      const contentBottom = Math.max(
        88,
        explicitBottom + (explicit.length ? 24 : 0),
        automaticStart + nodeHeight + (automatic.length ? 35 : 0),
      );
      let childY = y + contentBottom;
      let childrenHeight = 0;
      for (const child of childSections(node.statements)) {
        const childHeight = measureSection(child, width - 60, childY);
        childrenHeight += childHeight + 24;
        childY += childHeight + 24;
      }
      return Math.max(220, contentBottom + childrenHeight + scopedNoteHeight);
    });
  }

  const measurer = {
    measureNode,
    measureAnnotation,
    measureLayoutText,
    measureArrangedItem,
    measureCodeBlock,
    measureContainer,
    measureSection,
    measureSequence,
    measureTree,
  };
  registerRichNodePlanner(measurer, planNode);
  return measurer;
}
