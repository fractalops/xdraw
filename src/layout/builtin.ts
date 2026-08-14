import { anchor, box, row } from "../geometry.ts";
import { splitEndpoint } from "../routing/router.ts";
import { BUILTIN_LAYOUT_CAPABILITIES, createLayoutAdapter } from "../compile/scene.ts";
import {
  calculateArrangedRows,
  calculateRowPlan,
  calculateSlotWidth,
  renderableCode,
  resolveContainerGap,
} from "../compile/measurement.ts";
import { wrapTextToWidth } from "../text/metrics.ts";
import { codeBlockRequiredWidth } from "../text/code-block.ts";
import { arrangedItems, childSections } from "./sections.ts";
import type {
  ArrangedStatement,
  LayoutContext,
  LayoutOptions,
  NodeMeasurementTarget,
  LayoutSectionStatement,
  SceneGraph,
  SceneVisualInput,
  StyleResolver,
} from "../layout-contracts.ts";
import type { Bounds, Point } from "../foundation-contracts.ts";
import type {
  CodeStatement,
  ContainerStatement,
  NodeStatement,
  NoteStatement,
  ParticipantStatement,
  SemanticStatement,
  SequenceStatement,
  TreeStatement,
} from "../semantic-contracts.ts";
import type { TextAlign } from "../render-contracts.ts";

type RegisterBounds = NonNullable<LayoutContext["registerBounds"]>;

export interface BuiltinLayoutContext extends LayoutContext {
  registerBounds: RegisterBounds;
  containerId?: string;
  frameId?: string | null;
  frameLocked?: boolean;
}

export interface SectionBounds {
  x: number;
  y: number;
  width: number;
}

interface FlatTreeEntry extends NodeMeasurementTarget {
  id: string;
  semanticId?: string;
  depth: number;
  parent: string | null;
  tone?: string;
}

function builtinContext(context: LayoutContext): BuiltinLayoutContext {
  if (typeof context.registerBounds !== "function") {
    throw new TypeError("built-in layout requires a registerBounds function");
  }
  return context as BuiltinLayoutContext;
}

function styleResolver(state: SceneGraph): StyleResolver {
  if (!state.styles) throw new Error("built-in layout requires a style resolver");
  return state.styles;
}

function nodeStatements(statements: readonly SemanticStatement[]): NodeStatement[] {
  return statements.filter((item): item is NodeStatement => item.type === "node");
}

function noteStatements(statements: readonly SemanticStatement[]): NoteStatement[] {
  return statements.filter(
    (item): item is NoteStatement => item.type === "note" || item.type === "callout",
  );
}

function textAlign(value: string): TextAlign {
  if (value === "left" || value === "center" || value === "right") return value;
  throw new Error(`unsupported text alignment: ${value}`);
}

function addVisual(
  state: SceneGraph,
  visual: SceneVisualInput,
  context: BuiltinLayoutContext,
  owner: string | null = visual.id,
): void {
  const frameId = context.frameId ?? null;
  state.addVisual({ ...visual, frameId, locked: visual.locked ?? context.frameLocked ?? false });
  if (owner && frameId) state.frameMembership.set(owner, frameId);
}

function placeCodeBlock(
  context: BuiltinLayoutContext,
  node: CodeStatement,
  bounds: Bounds,
): void {
  const { state, registerBounds } = context;
  registerBounds(state, node.id, bounds);
  const block = renderableCode(node);
  if (codeBlockRequiredWidth(block) > bounds.width) {
    state.diagnostics?.warn(
      "XD2005",
      `code block '${node.id}' exceeds its ${Math.round(bounds.width)}px content width`,
      node,
    );
  }
  addVisual(state, {
    type: "code",
    id: node.id,
    source: node.semanticId,
    block,
    bounds,
  }, context);
}

function flattenTree(
  node: TreeStatement,
  depth = 0,
  parent: string | null = null,
  result: FlatTreeEntry[] = [],
): FlatTreeEntry[] {
  result.push({
    id: node.id,
    semanticId: node.semanticId,
    title: node.title,
    depth,
    parent,
    kind: node.kind ?? (depth === 0 ? "system" : "card"),
    tone: node.tone,
  });
  for (const child of node.statements) {
    if (child.type === "tree" || child.type === "branch" || child.type === "leaf") {
      flattenTree(child, depth + 1, node.id, result);
    }
  }
  return result;
}

function layoutContainer(
  context: BuiltinLayoutContext,
  node: ContainerStatement,
  x: number,
  y: number,
  width: number,
): number {
  const { state, registerBounds } = context;
  const height = state.measurer.measureContainer(node, width, y);
  const bounds = box(x, y, width, height);
  registerBounds(state, node.id, bounds);
  state.containers.push(node.id);
  const isFrame = node.type === "frame";
  if (!node.attributes?.invisible) {
    addVisual(state, {
      type: isFrame ? "frame" : "container",
      id: node.id,
      source: node.semanticId,
      bounds,
      title: node.title,
      kind: node.kind,
      tone: node.tone ?? (node.type === "group" ? "info" : "neutral"),
      locked: context.frameLocked || (isFrame && node.attributes?.locked === true),
    }, context);
  }
  const childContext = isFrame
    ? {
      ...context,
      containerId: node.id,
      frameId: node.id,
      frameLocked: context.frameLocked || node.attributes?.locked === true,
    }
    : { ...context, containerId: node.id };
  if (isFrame) state.frameLocks.set(node.id, childContext.frameLocked ?? false);
  const nodes = nodeStatements(node.statements);
  const layout = node.statements.find((item) => item.type === "layout");
  if (layout && !["row", "column"].includes(layout.kind)) throw new Error(`unsupported layout: ${layout.kind}`);
  if (layout?.ownsChildren) {
    const gap = resolveContainerGap(node, layout, state.diagnostics);
    const content = box(x + 40, y + 76, width - 80, 1);
    const explicit = nodes.filter((item): item is NodeStatement & { at: Point } => Boolean(item.at));
    const explicitBottom = explicit.reduce((bottom, item) => (
      Math.max(bottom, item.at[1] + (item.size?.[1] ?? 110))
    ), content.y);
    for (const item of explicit) {
      const itemBounds = box(item.at[0], item.at[1], item.size?.[0] ?? 240, item.size?.[1] ?? 110);
      registerBounds(state, item.id, itemBounds);
      state.nodeIds.add(item.id);
      state.containerMembership.set(item.id, node.id);
      addVisual(state, { type: "node", id: item.id, source: item.semanticId, node: item, bounds: itemBounds }, childContext);
    }
    const startY = explicit.length ? Math.max(content.y, explicitBottom + gap) : content.y;
    const items = arrangedItems(node.statements);
    let arrangedBottom = startY;
    const placeItem = (item: ArrangedStatement, itemBounds: Bounds): void => {
      state.containerMembership.set(item.id, node.id);
      if (item.type === "node") {
        registerBounds(state, item.id, itemBounds);
        state.nodeIds.add(item.id);
        addVisual(state, { type: "node", id: item.id, source: item.semanticId, node: item, bounds: itemBounds }, childContext);
      } else if (item.type === "layout-text") {
        registerBounds(state, item.id, itemBounds);
        const style = styleResolver(state).resolveText(item);
        const fontSize = style.fontSize ?? item.fontSize ?? 18;
        const textWidth = Math.min(item.width ?? style.wrapWidth ?? itemBounds.width, itemBounds.width);
        addVisual(state, {
          type: "text",
          id: item.id,
          source: item.semanticId,
          position: [itemBounds.x, itemBounds.y],
          value: wrapTextToWidth(item.value, textWidth, fontSize, style.fontFamily),
          options: {
            width: textWidth,
            fontSize,
            textAlign: textAlign(item.align),
            autoResize: false,
            strokeColor: style.textColor,
            fontFamily: style.fontFamily,
            lineHeight: style.lineHeight,
            locked: style.locked,
          },
        }, childContext);
      } else if (item.type === "code") {
        placeCodeBlock(childContext, item, itemBounds);
      } else {
        layoutBuiltInSection(childContext, item, itemBounds);
      }
    };
    if (items.length && layout.kind === "column") {
      let itemY = startY;
      for (const item of items) {
        const itemWidth = item.size?.[0] ?? content.width;
        const itemHeight = state.measurer.measureArrangedItem(item, itemWidth, itemY);
        placeItem(item, box(content.x, itemY, itemWidth, itemHeight));
        itemY += itemHeight + gap;
      }
      arrangedBottom = itemY - gap;
    } else if (items.length) {
      const rows = calculateArrangedRows(content.width, items, gap);
      let itemY = startY;
      for (const arrangedRow of rows) {
        let itemX = content.x;
        const itemBounds = arrangedRow.items.map((item, itemIndex) => {
          const itemWidth = arrangedRow.widths[itemIndex];
          const itemHeight = state.measurer.measureArrangedItem(item, itemWidth, itemY);
          const bounds = box(itemX, itemY, itemWidth, itemHeight);
          itemX += itemWidth + gap;
          return bounds;
        });
        arrangedRow.items.forEach((item, itemIndex) => placeItem(item, itemBounds[itemIndex]));
        itemY += Math.max(...itemBounds.map((itemBounds_) => itemBounds_.height)) + gap;
      }
      arrangedBottom = itemY - gap;
    }
    const scopedNotes = node.statements.filter((item): item is NoteStatement => (
      item.type === "note" && !item.target && !item.at
    ));
    let noteY = items.length ? arrangedBottom + 16 : startY;
    for (const note of scopedNotes) {
      const noteWidth = Math.min(420, width - 80);
      const noteHeight = state.measurer.measureAnnotation(note, noteWidth);
      state.annotations.push({
        ...note,
        at: [content.x, noteY],
        width: noteWidth,
        frameId: childContext.frameId ?? null,
        locked: childContext.frameLocked ?? false,
      });
      noteY += noteHeight + 16;
    }
    state.connections.push(...node.statements
      .filter((item) => item.type === "connection")
      .map((item) => ({ ...item, span: item.span, locked: childContext.frameLocked ?? false })));
    state.annotations.push(...noteStatements(node.statements)
      .filter((item) => !scopedNotes.includes(item))
      .map((item) => ({
        ...item,
        frameId: childContext.frameId ?? null,
        locked: childContext.frameLocked ?? false,
      })));
    return height;
  }
  if (nodes.length) {
    const gap = resolveContainerGap(node, layout, state.diagnostics);
    const content = box(x + 40, y + 76, width - 80, 1);
    const automatic = nodes.filter((item) => !item.at);
    const explicitNodes = nodes.filter((item): item is NodeStatement & { at: Point } => Boolean(item.at));
    const explicitBottom = explicitNodes.reduce((bottom, item) => (
      Math.max(bottom, item.at[1] + (item.size?.[1] ?? 110))
    ), content.y);
    const automaticStartY = nodes.some((item) => item.at) ? Math.max(content.y, explicitBottom + gap) : content.y;
    const automaticBounds: Bounds[] = [];
    if (automatic.length && layout?.kind === "column") {
      let itemY = automaticStartY;
      for (const item of automatic) {
        const itemWidth = item.size?.[0] ?? content.width;
        const itemHeight = state.measurer.measureNode(item, itemWidth);
        automaticBounds.push(box(content.x, itemY, itemWidth, itemHeight));
        itemY += itemHeight + gap;
      }
    } else if (automatic.length) {
      const plan = calculateRowPlan(content.width, automatic.length, gap, "row layout");
      let itemY = automaticStartY;
      for (let index = 0; index < automatic.length; index += plan.columns) {
        const rowItems = automatic.slice(index, index + plan.columns);
        const slots = row(box(content.x, itemY, content.width, 1), rowItems.length, gap);
        const rowBounds = slots.map((slot, rowIndex) => ({
          ...slot,
          height: state.measurer.measureNode(rowItems[rowIndex], rowItems[rowIndex].size?.[0] ?? slot.width),
        }));
        automaticBounds.push(...rowBounds);
        itemY += Math.max(...rowBounds.map((bounds) => bounds.height)) + gap;
      }
    }
    let automaticIndex = 0;
    for (const item of nodes) {
      const itemBounds = item.at
        ? box(item.at[0], item.at[1], item.size?.[0] ?? 240, item.size?.[1] ?? 110)
        : { ...automaticBounds[automaticIndex++], width: item.size?.[0] ?? automaticBounds[automaticIndex - 1].width };
      registerBounds(state, item.id, itemBounds);
      state.nodeIds.add(item.id);
      state.containerMembership.set(item.id, node.id);
      addVisual(state, { type: "node", id: item.id, source: item.semanticId, node: item, bounds: itemBounds }, childContext);
    }
  }
  const children = childSections(node.statements);
  const nodeBottom = nodes.reduce((bottom, item) => {
    const bounds = state.bounds.get(item.id);
    return bounds ? Math.max(bottom, bounds.y + bounds.height) : bottom;
  }, y + 53);
  let childY = Math.max(y + 88, nodeBottom + (nodes.length ? 35 : 0));
  for (const child of children) {
    state.containerMembership.set(child.id, node.id);
    const childHeight = layoutBuiltInSection(childContext, child, { x: x + 30, y: childY, width: width - 60 });
    childY += childHeight + 24;
  }
  const scopedNotes = node.statements.filter((item): item is NoteStatement => (
    item.type === "note" && !item.target && !item.at
  ));
  let noteY = childY;
  for (const note of scopedNotes) {
    const noteWidth = Math.min(420, width - 80);
    const noteHeight = state.measurer.measureAnnotation(note, noteWidth);
    state.annotations.push({
      ...note,
      at: [x + 40, noteY],
      width: noteWidth,
      frameId: childContext.frameId ?? null,
      locked: childContext.frameLocked ?? false,
    });
    noteY += noteHeight + 16;
  }
  state.connections.push(...node.statements
    .filter((item) => item.type === "connection")
    .map((item) => ({ ...item, span: item.span, locked: childContext.frameLocked ?? false })));
  state.annotations.push(...noteStatements(node.statements)
    .filter((item) => !scopedNotes.includes(item))
    .map((item) => ({
      ...item,
      frameId: childContext.frameId ?? null,
      locked: childContext.frameLocked ?? false,
    })));
  return height;
}

function layoutTree(
  context: BuiltinLayoutContext,
  tree: TreeStatement,
  x: number,
  y: number,
  width: number,
): number {
  const { state, registerBounds } = context;
  const entries = flattenTree(tree);
  const levels = Map.groupBy(entries, (entry) => entry.depth);
  const direction = tree.direction ?? "down";
  if (!["down", "right"].includes(direction)) throw new Error(`unsupported tree direction: ${direction}`);
  const siblingGap = tree.siblingGap ?? 45;
  const levelGap = tree.levelGap ?? 45;
  const levelCount = levels.size;
  const horizontalSlotWidth = direction === "right"
    ? calculateSlotWidth(width - 90, levelCount, levelGap, "tree levels", 120)
    : 0;
  const levelMetrics = [...levels].map(([depth, items]) => {
    const slotWidth = direction === "right"
      ? horizontalSlotWidth
      : calculateSlotWidth(width - 90, items.length, siblingGap, `tree level ${depth}`);
    return { depth, items, height: Math.max(...items.map((item) => state.measurer.measureNode(item, slotWidth))) };
  });
  const height = direction === "right"
    ? Math.max(320, 125 + Math.max(...levelMetrics.map((level) => (
      level.items.length * level.height + Math.max(0, level.items.length - 1) * siblingGap
    ))))
    : 95 + levelMetrics.reduce((sum, level) => sum + level.height + levelGap, 0);
  const frameBounds = box(x, y, width, height);
  const frameId = tree.sectionId ?? `tree:${tree.id}`;
  registerBounds(state, frameId, frameBounds);
  state.containers.push(frameId);
  addVisual(state, { type: "container", id: frameId, source: tree.semanticId, bounds: frameBounds, title: tree.section ?? tree.title, tone: "accent" }, context, tree.id);
  let levelY = y + 75;
  for (const { depth, items, height: levelHeight } of levelMetrics) {
    const levelBounds = direction === "right"
      ? items.map((_item, itemIndex) => box(
        x + 45 + depth * (horizontalSlotWidth + levelGap),
        y + 75 + itemIndex * (levelHeight + siblingGap),
        horizontalSlotWidth,
        levelHeight,
      ))
      : row(box(x + 45, levelY, width - 90, levelHeight), items.length, siblingGap);
    items.forEach((item, index) => {
      const bounds = levelBounds[index];
      registerBounds(state, item.id, bounds);
      state.nodeIds.add(item.id);
      const renderedNode: NodeStatement = {
        type: "node",
        id: item.id,
        semanticId: item.semanticId,
        title: item.title,
        kind: item.kind,
        tone: depth === 0 ? "accent" : "neutral",
        attributes: {},
        statements: [],
      };
      addVisual(state, {
        type: "node",
        id: item.id,
        source: item.semanticId,
        node: renderedNode,
        bounds,
      }, context);
      if (item.parent) {
        const parentBounds = state.bounds.get(item.parent);
        if (!parentBounds) throw new Error(`tree references unknown parent: ${item.parent}`);
        const parentY = parentBounds.y + parentBounds.height / 2;
        const childY = bounds.y + bounds.height / 2;
        const channelX = parentBounds.x + parentBounds.width
          + Math.max(12, levelGap * ((index + 1) / (items.length + 1)));
        const attributes = direction === "right"
          ? parentY === childY
            ? { style: "straight" }
            : { via: `${channelX},${parentY};${channelX},${childY}` }
          : {};
        state.connections.push({
          type: "connection",
          nodes: direction === "right"
            ? [`${item.parent}.right`, `${item.id}.left`]
            : [`${item.parent}.south`, `${item.id}.north`],
          attributes,
          generatedRoute: direction === "right",
        });
      }
    });
    levelY += levelHeight + levelGap;
  }
  return height;
}

function participantNode(participant: ParticipantStatement): NodeStatement {
  return {
    ...participant,
    type: "node",
    kind: "person",
    tone: "accent",
    attributes: {},
    statements: [],
  };
}

function layoutSequence(
  context: BuiltinLayoutContext,
  sequence: SequenceStatement,
  x: number,
  y: number,
  width: number,
): number {
  const { state, registerBounds } = context;
  const participants = sequence.statements.filter((item) => item.type === "participant");
  const messages = sequence.statements.filter((item) => item.type === "connection");
  const messageCount = messages.reduce((count, message) => count + message.nodes.length - 1, 0);
  if (participants.length < 2) throw new Error("sequence requires at least two participants");
  calculateSlotWidth(width - 90, participants.length, 60, "sequence participants");
  const participantSlots = row(box(x + 45, y + 70, width - 90, 1), participants.length, 60);
  const participantHeight = Math.max(...participants.map((participant, index) => (
    state.measurer.measureNode(participantNode(participant), participantSlots[index].width)
  )));
  const messageGap = 72;
  const messageStart = y + 70 + participantHeight + 55;
  const height = Math.max(320, 120 + participantHeight + messageCount * messageGap);
  const sequenceId = sequence.id;
  const sequenceBounds = box(x, y, width, height);
  registerBounds(state, sequenceId, sequenceBounds);
  state.containers.push(sequenceId);
  addVisual(state, { type: "container", id: sequenceId, source: sequence.semanticId, bounds: sequenceBounds, title: "Sequence", tone: "neutral" }, context, sequenceId);
  const participantBounds = participantSlots.map((bounds) => ({ ...bounds, height: participantHeight }));
  participants.forEach((participant, index) => {
    const bounds = participantBounds[index];
    registerBounds(state, participant.id, bounds);
    state.nodeIds.add(participant.id);
    const renderedParticipant = participantNode(participant);
    addVisual(state, {
      type: "node",
      id: participant.id,
      source: participant.semanticId,
      node: renderedParticipant,
      bounds,
    }, context);
    const center = anchor.bottom(bounds);
    addVisual(state, {
      type: "arrow",
      id: `${participant.id}:lifeline`,
      source: participant.semanticId,
      start: center,
      end: [center[0], y + height - 25],
      options: { strokeColor: "#94a3b8", strokeStyle: "dashed", endArrowhead: null },
    }, context, `${participant.id}:lifeline`);
  });
  let messageIndex = 0;
  for (const message of messages) {
    for (let nodeIndex = 0; nodeIndex < message.nodes.length - 1; nodeIndex += 1) {
      const from = splitEndpoint(message.nodes[nodeIndex], state.bounds).id;
      const to = splitEndpoint(message.nodes[nodeIndex + 1], state.bounds).id;
      const fromBounds = state.bounds.get(from);
      const toBounds = state.bounds.get(to);
      if (!fromBounds || !toBounds) throw new Error(`sequence message references unknown participant: ${from} -> ${to}`);
      const messageY = messageStart + messageIndex * messageGap;
      const start: Point = [anchor.center(fromBounds)[0], messageY];
      const end: Point = [anchor.center(toBounds)[0], messageY];
      addVisual(state, {
        type: "arrow",
        id: `${sequenceId}:message:${messageIndex}`,
        source: message.semanticId,
        start,
        end,
        options: { strokeWidth: 2, endArrowhead: "triangle" },
      }, context);
      if (nodeIndex === 0 && message.label) {
        const labelWidth = Math.min(200, Math.max(60, Math.abs(end[0] - start[0]) - 16));
        addVisual(state, {
          type: "text",
          id: `${sequenceId}:message:${messageIndex}:label`,
          source: message.semanticId,
          position: [
            Math.min(start[0], end[0]) + Math.abs(end[0] - start[0]) / 2 - labelWidth / 2,
            messageY - 28,
          ],
          value: wrapTextToWidth(message.label, labelWidth, 14),
          options: { width: labelWidth, textAlign: "center", fontSize: 14, autoResize: false },
        }, context, `${sequenceId}:message:${messageIndex}:label`);
      }
      messageIndex += 1;
    }
  }
  return height;
}

export function layoutBuiltInSection(
  context: BuiltinLayoutContext,
  node: LayoutSectionStatement,
  bounds: SectionBounds,
): number {
  const { x, y, width } = bounds;
  if (node.type === "code") {
    const block = renderableCode(node);
    const height = context.state.measurer.measureCodeBlock(block);
    const codeBounds = { x, y, width, height };
    placeCodeBlock(context, node, codeBounds);
    return height;
  }
  if (node.type === "tree") return layoutTree(context, node, x, y, width);
  if (node.type === "sequence") return layoutSequence(context, node, x, y, width);
  if (["lane", "group", "frame", "section"].includes(node.type)) {
    return layoutContainer(context, node, x, y, width);
  }
  throw new Error("unsupported layout section");
}

export function layoutBuiltInDocument(
  context: BuiltinLayoutContext,
  sections: readonly LayoutSectionStatement[],
  options: LayoutOptions,
): number {
  const { columnGap = 24, columns = 2, contentWidth, gap, kind, startY, x = 70 } = options;
  if (!Number.isInteger(columns) || columns <= 0) {
    throw new Error("grid columns must be a positive integer");
  }
  let y = startY;
  if (kind === "grid") {
    const columnWidth = (contentWidth - columnGap * (columns - 1)) / columns;
    for (let index = 0; index < sections.length; index += columns) {
      const heights = sections.slice(index, index + columns).map((section, column) => layoutBuiltInSection(context, section, {
        x: x + column * (columnWidth + columnGap),
        y,
        width: columnWidth,
      }));
      y += Math.max(...heights) + gap;
    }
    return y;
  }
  for (const section of sections) {
    y += layoutBuiltInSection(context, section, { x, y, width: contentWidth }) + gap;
  }
  return y;
}

export const BUILTIN_LAYOUT = createLayoutAdapter({
  name: "built-in",
  capabilities: BUILTIN_LAYOUT_CAPABILITIES,
  layoutDocument: ({ context, sections, options }) => {
    const supported = sections.filter((section): section is LayoutSectionStatement => (
      section.type === "code"
      || section.type === "frame"
      || section.type === "group"
      || section.type === "lane"
      || section.type === "section"
      || section.type === "sequence"
      || section.type === "tree"
    ));
    if (supported.length !== sections.length) throw new Error("built-in layout received an unsupported section");
    return layoutBuiltInDocument(builtinContext(context), supported, options);
  },
});
