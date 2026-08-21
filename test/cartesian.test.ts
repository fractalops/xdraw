import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import { compilePrepared } from "../src/compile/pipeline.ts";
import { createStyleResolver } from "../src/compile/styles.ts";
import { planCartesianNode } from "../src/nodes/cartesian.ts";
import { parseSource } from "../src/language/parser.ts";
import { buildSemanticIR } from "../src/language/semantic.ts";
import type { NodeStatement, PlotStatement } from "../src/contracts/semantic.ts";

const source = (body: string) => `use "xdraw/math" as math
diagram "Chart" {
  chart: math.plane "Signals" {
    size = (680, 440)
    x in [-pi, pi]
    y in [-1.2, 1.2]
    x-label = "t"
    y-label = "amplitude"
    ${body}
  }
}`;

test("a plane owns coordinate intervals while nested plots remain curve descriptions", () => {
  const document = parseSource(source(`
    sine: math.plot "sin(x)" { y = sin(x); x in [-pi, pi] }
  `));
  const chart = document.statements.find((item): item is NodeStatement => item.type === "node");
  assert.ok(chart);
  assert.equal(chart.kind, "cartesian");
  assert.deepEqual(chart.plane?.xDomain, [-Math.PI, Math.PI]);
  assert.deepEqual(chart.plane?.yDomain, [-1.2, 1.2]);
  assert.deepEqual(chart.plane, {
    xDomain: [-Math.PI, Math.PI],
    yDomain: [-1.2, 1.2],
    xLabel: "t",
    yLabel: "amplitude",
    grid: true,
    crossZero: false,
    tickCount: 5,
  });
  const series = chart.statements.find((item): item is PlotStatement => item.type === "plot");
  assert.ok(series);
  assert.equal(series.id, "chart.sine");
  assert.equal(series.label, "sin(x)");
  assert.equal(series.at, undefined);
  assert.equal(series.variable, "x");
  assert.equal(series.x, "x");
  assert.equal(series.y, "sin(x)");
});

test("cartesian emits editable native axes, grid lines, and clipped series", () => {
  const drawing = compilePrepared(parseSource(source(`
    rising: math.plot "rising" { x = t; y = 4 * t; t in [-pi, pi] }
    cosine: math.plot "cos(t)" { x = t; y = cos(t); t in [-pi, pi]; stroke = "#dc2626" }
  `))).toJSON();
  const frame = drawing.elements.find((item) => item.id === "chart:frame");
  assert.ok(frame);
  assert.ok(drawing.elements.some((item) => item.id === "chart:axis:x" && item.type === "line"));
  assert.ok(drawing.elements.some((item) => item.id === "chart:axis:y" && item.type === "line"));
  assert.ok(drawing.elements.some((item) => item.id.startsWith("chart:grid:vertical:") && item.type === "line"));
  assert.ok(drawing.elements.some((item) => item.id === "chart:axis:x:title" && item.type === "text"));
  assert.ok(drawing.elements.some((item) => item.id === "chart:axis:y:title" && item.type === "text"));
  assert.equal(drawing.elements.some((item) => item.type === "freedraw"), false);

  const series = drawing.elements.filter((item) => item.customData?.xdraw?.role === "cartesian-series");
  assert.ok(series.length >= 2);
  assert.ok(series.every((item) => item.type === "line"));
  assert.ok(series.some((item) => item.strokeColor === "#2563eb"));
  assert.ok(series.some((item) => item.strokeColor === "#dc2626"));
  for (const item of series) {
    assert.ok(item.x >= frame.x && item.y >= frame.y);
    assert.ok(item.x + item.width <= frame.x + frame.width + 1e-6);
    assert.ok(item.y + item.height <= frame.y + frame.height + 1e-6);
  }
});

test("cross-zero places both axes on zero when zero is visible", () => {
  const document = buildSemanticIR(parseSource(source(`
    cross-zero = true
    diagonal: math.plot { x = t; y = t; t in [-1, 1] }
  `)));
  const chart = document.statements.find((item): item is NodeStatement => item.type === "node");
  assert.ok(chart);
  const styles = createStyleResolver(document);
  const plan = planCartesianNode(chart, 680, styles.resolveNode(chart), styles);
  const expectedX = plan.xScale.range[0]
    + (0 - plan.xScale.domain[0]) / (plan.xScale.domain[1] - plan.xScale.domain[0])
      * (plan.xScale.range[1] - plan.xScale.range[0]);
  const expectedY = plan.yScale.range[0]
    + (0 - plan.yScale.domain[0]) / (plan.yScale.domain[1] - plan.yScale.domain[0])
      * (plan.yScale.range[1] - plan.yScale.range[0]);
  assert.equal(plan.yAxis.line.start[0], expectedX);
  assert.equal(plan.xAxis.line.start[1], expectedY);
});

test("a closed data-space curve remains a closed native series", () => {
  const document = buildSemanticIR(parseSource(source(`
    circle: math.plot { x = cos(t); y = sin(t); t in [0, tau]; background = "#bfdbfe" }
  `)));
  const chart = document.statements.find((item): item is NodeStatement => item.type === "node");
  assert.ok(chart);
  const styles = createStyleResolver(document);
  const plan = planCartesianNode(chart, 680, styles.resolveNode(chart), styles);
  assert.equal(plan.series[0].segments.length, 1);
  const segment = plan.series[0].segments[0];
  assert.ok(Math.hypot(
    segment[0][0] - segment.at(-1)![0],
    segment[0][1] - segment.at(-1)![1],
  ) < 1e-9);
  assert.equal(plan.series[0].backgroundColor, "#bfdbfe");
});

test("standalone plots default to the drawing origin", () => {
  const drawing = compilePrepared(parseSource(`use "xdraw/math" as math
diagram "" { curve: math.plot { x = t; y = t; t in [0, 1] } }`)).toJSON();
  const curve = drawing.elements.find((item) => item.id === "curve:stroke");
  assert.ok(curve);
  assert.deepEqual([curve.x, curve.y], [0, 0]);
});

test("cartesian rejects invalid scale configuration before rendering", () => {
  assert.throws(
    () => compilePrepared(parseSource(source(`
      tick-count = 1
      line: math.plot { x = t; y = t; t in [-1, 1] }
    `))),
    /XD1283.*tick-count/s,
  );
});

test("a plane infers finite coordinate intervals from its plotted mathematics", () => {
  const document = buildSemanticIR(parseSource(`use "xdraw/math" as math
diagram "Inferred" {
  chart: math.plane "Circle" {
    circle: math.plot { x = cos(t); y = sin(t); t in [0, tau] }
  }
}`));
  const chart = document.statements.find((item): item is NodeStatement => item.type === "node");
  assert.ok(chart);
  const styles = createStyleResolver(document);
  const plan = planCartesianNode(chart, 680, styles.resolveNode(chart), styles);
  assert.ok(plan.xScale.dataDomain[0] < -1 && plan.xScale.dataDomain[1] > 1);
  assert.ok(plan.yScale.dataDomain[0] < -1 && plan.yScale.dataDomain[1] > 1);
});

test("a function inherits its independent interval from the plane", () => {
  const document = buildSemanticIR(parseSource(`use "xdraw/math" as math
diagram "Inherited" {
  chart: math.plane {
    x in [-pi, pi]
    sine: math.plot { y = sin(x) }
  }
}`));
  const chart = document.statements.find((item): item is NodeStatement => item.type === "node");
  assert.ok(chart);
  const styles = createStyleResolver(document);
  const plan = planCartesianNode(chart, 680, styles.resolveNode(chart), styles);
  assert.deepEqual(plan.xScale.dataDomain, [-Math.PI, Math.PI]);
  assert.ok(plan.yScale.dataDomain[0] < -1 && plan.yScale.dataDomain[1] > 1);
  assert.ok(plan.series[0].segments.flat().length > 2);
});

test("an implicit equation traces its zero set inside an explicit plane", () => {
  const drawing = compilePrepared(parseSource(`use "xdraw/math" as math
diagram "Implicit" {
  chart: math.plane "Unit circle" {
    x in [-1.5, 1.5]
    y in [-1.5, 1.5]
    circle: math.plot { equation = x^2 + y^2 - 1; stroke-style = dotted }
  }
}`)).toJSON();
  const series = drawing.elements.filter((item) => item.customData?.xdraw?.series === "chart.circle");
  assert.ok(series.length >= 1);
  assert.ok(series.every((item) => item.strokeStyle === "dotted"));
});

test("implicit equations reject an inferred viewport", () => {
  assert.throws(
    () => compilePrepared(parseSource(`use "xdraw/math" as math
diagram "Implicit" { chart: math.plane { circle: math.plot { equation = x^2 + y^2 - 1 } } }`)),
    /implicit equation requires explicit x and y plane intervals/u,
  );
});

test("arbitrary mapped line series remain finite and clipped to the plot viewport", () => {
  fc.assert(fc.property(
    fc.integer({ min: -200, max: 200 }),
    (slopeTenths) => {
      const slope = slopeTenths / 10;
      const node: NodeStatement = {
        type: "node",
        id: "chart",
        kind: "cartesian",
        title: "",
        attributes: {},
        plane: {
          xDomain: [-10, 10],
          yDomain: [-10, 10],
          grid: true,
          crossZero: true,
          tickCount: 5,
        },
        statements: [{
          type: "plot",
          id: "chart.line",
          variable: "t",
          x: "t",
          y: `${slope} * t`,
          from: -20,
          to: 20,
          tolerance: 0.5,
          attributes: {},
        }],
      };
      const plan = planCartesianNode(node, 600);
      for (const point of plan.series[0].segments.flat()) {
        assert.ok(point.every(Number.isFinite));
        assert.ok(point[0] >= plan.plotBounds.x - 1e-8);
        assert.ok(point[0] <= plan.plotBounds.x + plan.plotBounds.width + 1e-8);
        assert.ok(point[1] >= plan.plotBounds.y - 1e-8);
        assert.ok(point[1] <= plan.plotBounds.y + plan.plotBounds.height + 1e-8);
      }
    },
  ), { numRuns: 100 });
});
