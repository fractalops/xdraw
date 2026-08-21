import assert from "node:assert/strict";
import test from "node:test";

import { compilePrepared as compile } from "../src/compile/pipeline.ts";
import { parseSource } from "../src/language/parser.ts";

test("compilation preserves semantic geometry, paths, labels, containers, and constraints", () => {
  const drawing = compile(parseSource(`diagram "Measured" {
    flow: frame "Flow" {
      arrange row { gap = 180 }
      a: rectangle "A" { size = (120, 80) }
      b: rectangle "B" { size = (120, 80) }
    }
    mark: freedraw { at = (80, 500); points = ((0,0),(30,-20),(60,0)) }
    flow.a -> flow.b "sends"
    align top (flow.a, flow.b)
  }`));
  const report = drawing.measurements;
  assert.ok(report);
  assert.equal(report.title, "Measured");
  assert.ok(report.canvas.width > 0 && report.canvas.height > 0);
  assert.equal(report.counts.renderedPrimitives, drawing.elements.length);
  const first = report.elements.find((item) => item.id === "flow.a");
  const second = report.elements.find((item) => item.id === "flow.b");
  assert.ok(first && second);
  assert.equal(first.bounds.height, 80);
  assert.equal(second.bounds.height, 80);
  assert.equal(first.bounds.y, second.bounds.y);
  assert.equal(second.bounds.x - first.bounds.x - first.bounds.width, 180);
  assert.equal(report.strokes.find((item) => item.id === "mark")?.points, 3);
  assert.equal(report.connectors[0]?.from, "flow.a");
  assert.equal(report.connectors[0]?.to, "flow.b");
  assert.equal(report.labels[0]?.text, "sends");
  assert.equal(report.containers.find((item) => item.id === "flow")?.children, 2);
  assert.deepEqual(report.constraints[0]?.elements, ["flow.a", "flow.b"]);
  assert.equal(Object.keys(drawing).includes("measurements"), false);
  assert.equal(JSON.stringify(drawing.toJSON()).includes("semanticElements"), false);
});
