import { wrapText } from "./components.js";
import { anchor, box, row } from "./layout.js";
import { splitEndpoint } from "./router.js";
import { BUILTIN_LAYOUT_CAPABILITIES, createLayoutAdapter } from "./scene.ts";
import { calculateRowPlan, calculateSlotWidth, resolveContainerGap } from "./measurement.js";
import { wrapTextToWidth } from "./text-metrics.js";

function nodeStatements(statements) {
  return statements.filter((item) => item.type === "node");
}

function childSections(statements) {
  return statements.filter((item) => ["group", "lane", "frame", "tree", "sequence"].includes(item.type));
}

function addVisual(state, visual, context, owner = visual.id) {
  const frameId = context.frameId ?? null;
  state.addVisual({ ...visual, frameId, locked: visual.locked ?? context.frameLocked ?? false });
  if (owner && frameId) state.frameMembership.set(owner, frameId);
}

function flattenTree(node, depth = 0, parent = null, result = []) {
  result.push({
    id: node.id,
    semanticId: node.semanticId,
    title: node.title,
    depth,
    parent,
    kind: depth === 0 ? "system" : "card",
  });
  for (const child of node.statements ?? []) flattenTree(child, depth + 1, node.id, result);
  return result;
}

function layoutContainer(context, node, x, y, width) {
  const { state, registerBounds } = context;
  const height = state.measurer.measureContainer(node, width, y);
  const bounds = box(x, y, width, height);
  registerBounds(state, node.id, bounds);
  state.containers.push(node.id);
  const isFrame = node.type === "frame";
  addVisual(state, {
    type: isFrame ? "frame" : "container",
    id: node.id,
    source: node.semanticId,
    bounds,
    title: node.title,
    tone: node.type === "group" ? "info" : "neutral",
    locked: context.frameLocked || (isFrame && node.attributes?.locked === true),
  }, context);
  const childContext = isFrame
    ? {
      ...context,
      containerId: node.id,
      frameId: node.id,
      frameLocked: context.frameLocked || node.attributes?.locked === true,
    }
    : { ...context, containerId: node.id };
  if (isFrame) state.frameLocks.set(node.id, childContext.frameLocked);
  const nodes = nodeStatements(node.statements);
  const layout = node.statements.find((item) => item.type === "layout");
  if (layout && !["row", "column"].includes(layout.kind)) throw new Error(`unsupported layout: ${layout.kind}`);
  if (nodes.length) {
    const gap = resolveContainerGap(node, layout, state.diagnostics);
    const content = box(x + 40, y + 76, width - 80, 1);
    const automatic = nodes.filter((item) => !item.at);
    const explicitBottom = nodes.filter((item) => item.at).reduce((bottom, item) => (
      Math.max(bottom, item.at[1] + (item.size?.[1] ?? 110))
    ), content.y);
    const automaticStartY = nodes.some((item) => item.at) ? Math.max(content.y, explicitBottom + gap) : content.y;
    const automaticBounds = [];
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
  const scopedNotes = node.statements.filter((item) => item.type === "note" && !item.target && !item.at);
  let noteY = childY;
  for (const note of scopedNotes) {
    const noteWidth = Math.min(420, width - 80);
    const noteHeight = state.measurer.measureNode({ ...note, kind: "card" }, noteWidth);
    state.annotations.push({
      ...note,
      at: [x + 40, noteY],
      width: noteWidth,
      locked: childContext.frameLocked ?? false,
    });
    noteY += noteHeight + 16;
  }
  state.connections.push(...node.statements
    .filter((item) => item.type === "connection")
    .map((item) => ({ ...item, span: item.span, locked: childContext.frameLocked ?? false })));
  state.annotations.push(...node.statements
    .filter((item) => ["note", "callout"].includes(item.type) && !scopedNotes.includes(item))
    .map((item) => ({ ...item, locked: childContext.frameLocked ?? false })));
  return height;
}

function layoutTree(context, tree, x, y, width) {
  const { state, registerBounds } = context;
  const entries = flattenTree(tree);
  const levels = Map.groupBy(entries, (entry) => entry.depth);
  const levelMetrics = [...levels].map(([depth, items]) => {
    const slotWidth = calculateSlotWidth(width - 90, items.length, 45, `tree level ${depth}`);
    return { depth, items, height: Math.max(...items.map((item) => state.measurer.measureNode(item, slotWidth))) };
  });
  const height = 95 + levelMetrics.reduce((sum, level) => sum + level.height + 45, 0);
  const frameBounds = box(x, y, width, height);
  const frameId = `tree:${tree.id}`;
  registerBounds(state, frameId, frameBounds);
  state.containers.push(frameId);
  addVisual(state, { type: "container", id: frameId, source: tree.semanticId, bounds: frameBounds, title: tree.section ?? tree.title, tone: "accent" }, context, tree.id);
  let levelY = y + 75;
  for (const { depth, items, height: levelHeight } of levelMetrics) {
    const levelBounds = row(box(x + 45, levelY, width - 90, levelHeight), items.length, 45);
    items.forEach((item, index) => {
      const bounds = levelBounds[index];
      registerBounds(state, item.id, bounds);
      state.nodeIds.add(item.id);
      const renderedNode = { ...item, type: "node", tone: depth === 0 ? "accent" : "neutral", statements: [] };
      addVisual(state, {
        type: "node",
        id: item.id,
        source: item.semanticId,
        node: renderedNode,
        bounds,
      }, context);
      if (item.parent) state.connections.push({ type: "connection", nodes: [`${item.parent}.south`, `${item.id}.north`], attributes: {} });
    });
    levelY += levelHeight + 45;
  }
  return height;
}

function layoutSequence(context, sequence, x, y, width) {
  const { state, registerBounds } = context;
  const participants = sequence.statements.filter((item) => item.type === "participant");
  const messages = sequence.statements.filter((item) => item.type === "connection");
  const messageCount = messages.reduce((count, message) => count + message.nodes.length - 1, 0);
  if (participants.length < 2) throw new Error("sequence requires at least two participants");
  calculateSlotWidth(width - 90, participants.length, 60, "sequence participants");
  const participantSlots = row(box(x + 45, y + 70, width - 90, 1), participants.length, 60);
  const participantHeight = Math.max(...participants.map((participant, index) => state.measurer.measureNode({ ...participant, kind: "person" }, participantSlots[index].width)));
  const messageGap = 72;
  const messageStart = y + 70 + participantHeight + 55;
  const height = Math.max(320, 120 + participantHeight + messageCount * messageGap);
  const sequenceNumber = state.sequenceCount++;
  const sequenceId = sequenceNumber === 0 ? "sequence" : `sequence:${sequenceNumber}`;
  const sequenceBounds = box(x, y, width, height);
  registerBounds(state, sequenceId, sequenceBounds);
  state.containers.push(sequenceId);
  addVisual(state, { type: "container", id: sequenceId, source: sequence.semanticId, bounds: sequenceBounds, title: "Sequence", tone: "neutral" }, context, sequenceId);
  const participantBounds = participantSlots.map((bounds) => ({ ...bounds, height: participantHeight }));
  participants.forEach((participant, index) => {
    const bounds = participantBounds[index];
    registerBounds(state, participant.id, bounds);
    state.nodeIds.add(participant.id);
    const renderedParticipant = { ...participant, kind: "person", tone: "accent", statements: [] };
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
      const start = [anchor.center(fromBounds)[0], messageY];
      const end = [anchor.center(toBounds)[0], messageY];
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
          id: `sequence:message:${messageIndex}:label`,
          source: message.semanticId,
          position: {
            x: Math.min(start[0], end[0]) + Math.abs(end[0] - start[0]) / 2 - labelWidth / 2,
            y: messageY - 28,
          },
          value: wrapTextToWidth(message.label, labelWidth, 14),
          options: { width: labelWidth, textAlign: "center", fontSize: 14, autoResize: false },
        }, context, `sequence:message:${messageIndex}:label`);
      }
      messageIndex += 1;
    }
  }
  return height;
}

export function layoutBuiltInSection(context, node, bounds) {
  const { x, y, width } = bounds;
  if (node.type === "tree") return layoutTree(context, node, x, y, width);
  if (node.type === "sequence") return layoutSequence(context, node, x, y, width);
  if (["lane", "group", "frame"].includes(node.type)) return layoutContainer(context, node, x, y, width);
  throw new Error(`unsupported layout section: ${node.type}`);
}

export function layoutBuiltInDocument(context, sections, options) {
  const { columnGap = 24, columns = 2, contentWidth, gap, kind, startY, x = 70 } = options;
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
  layoutDocument: ({ context, sections, options }) => layoutBuiltInDocument(context, sections, options),
});
