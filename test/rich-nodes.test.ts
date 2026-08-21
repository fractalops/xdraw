import assert from "node:assert/strict";
import test from "node:test";

import { createMeasurer } from "../src/compile/measurement.ts";
import {
  renderRichNode,
  richNodeFamilyName,
} from "../src/nodes/rich-nodes.ts";
import { createSceneGraph } from "../src/compile/scene.ts";
import { buildSemanticIR } from "../src/language/semantic.ts";
import { parseSource } from "../src/language/parser.ts";
import { createStyleResolver } from "../src/compile/styles.ts";
import { planTable, renderTable } from "../src/nodes/table.ts";
import type { ArchitectureNodePlan, TableNodePlan } from "../src/contracts/rich-node.ts";
import type { NodeStatement } from "../src/contracts/semantic.ts";

function onlyNode(source: string): { document: ReturnType<typeof buildSemanticIR>; node: NodeStatement } {
  const document = buildSemanticIR(parseSource(source));
  const node = document.statements.find((statement): statement is NodeStatement => statement.type === "node");
  assert.ok(node);
  return { document, node };
}

test("rich-node families are closed over supported built-in kinds", () => {
  assert.equal(richNodeFamilyName({ kind: "table", title: "Orders", statements: [] }), "table");
  assert.equal(richNodeFamilyName({ kind: "cartesian", title: "Signals", statements: [] }), "cartesian");
  assert.equal(richNodeFamilyName({ kind: "architecture-system", title: "Billing" }), "architecture");
  assert.equal(richNodeFamilyName({ kind: "card", title: "Ordinary" }), null);
});

test("scene visuals retain the immutable rich plan measured at their final width", () => {
  const { document, node } = onlyNode(`
    use "xdraw/table" as table
    diagram "Orders" {
      orders: table.table "Orders" {
        table.header "Order" "Total"
        table.row "1001" "R450"
      }
    }
  `);
  const styles = createStyleResolver(document);
  const measurer = createMeasurer(styles);
  const measured = measurer.planRichNode(node, 480, styles.resolveNode(node));
  assert.ok(measured?.type === "table");
  assert.ok(Object.isFrozen(measured));
  assert.ok(Object.isFrozen(measured.columnWidths));
  assert.equal(measurer.planRichNode(node, 480, styles.resolveNode(node)), measured);

  const scene = createSceneGraph(document, {
    diagramWidth: 1120,
    contentWidth: 1120,
    annotationGutterWidth: 0,
    measurer,
    styles,
  });
  scene.addVisual({
    type: "node",
    id: node.id,
    node,
    bounds: { x: 0, y: 0, width: 480, height: measured.height },
  });
  const visual = scene.visuals[0];
  assert.equal(visual.type, "node");
  assert.equal(visual.richPlan, measured);
});

test("table rendering consumes the supplied wrapping plan", () => {
  const { node } = onlyNode(`
    use "xdraw/table" as table
    diagram "Orders" {
      orders: table.table "Orders" {
        table.header "Order"
        table.row "1001"
      }
    }
  `);
  const measured = planTable(node, 300);
  const supplied: TableNodePlan = {
    ...measured,
    wrappedRows: [["HEADER FROM PLAN"], ["VALUE FROM PLAN"]],
  };
  const elements = renderTable(node, { x: 0, y: 0, width: 300, height: measured.height }, supplied);
  const header = elements.find((element) => element.id === "orders:header:cell:0:text");
  const value = elements.find((element) => element.id === "orders:row:0:cell:0:text");
  assert.equal(header?.type === "text" ? header.text : null, "HEADER FROM PLAN");
  assert.equal(value?.type === "text" ? value.text : null, "VALUE FROM PLAN");
});

test("rich-node rendering rejects a plan owned by another family", () => {
  const { document, node } = onlyNode(`
    use "xdraw/table" as table
    diagram "Orders" {
      orders: table.table "Orders" {
        table.header "Order"
        table.row "1001"
      }
    }
  `);
  const style = createStyleResolver(document).resolveNode(node);
  const wrongPlan: ArchitectureNodePlan = { type: "architecture", width: 300, height: 120 };
  assert.throws(
    () => renderRichNode(node, { x: 0, y: 0, width: 300, height: 120 }, style, wrongPlan),
    /received an incompatible plan/u,
  );
});
