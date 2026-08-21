import type { Bounds, Point } from "../contracts/foundation.ts";
import type { CompilationMeasurements, MeasurementFormat } from "../contracts/measurements.ts";

function scalar(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
}

function point(value: Point): string {
  return `(${scalar(value[0])},${scalar(value[1])})`;
}

function bounds(value: Bounds): string {
  return `${point([value.x, value.y])} ${scalar(value.width)}×${scalar(value.height)}`;
}

function elementSection(report: CompilationMeasurements): string[] {
  if (!report.elements.length) return [];
  const lines = ["", "Elements"];
  const strokes = new Map(report.strokes.map((stroke) => [stroke.id, stroke]));
  for (const element of report.elements) {
    const stroke = strokes.get(element.id);
    lines.push(`  ${element.id} [${element.kind}] ${bounds(element.bounds)} center ${point(element.center)}`
      + `${element.container ? ` container ${element.container}` : ""}`
      + `${element.frame ? ` frame ${element.frame}` : ""}`
      + `${element.angle ? ` angle ${scalar(element.angle)}rad` : ""}`);
    if (stroke) {
      lines.push(`    stroke ${point(stroke.start)} → ${point(stroke.end)}, length ${scalar(stroke.length)},`
        + ` ${stroke.points} points, ${stroke.closed ? "closed" : "open"}`);
    }
  }
  return lines;
}

function containerSection(report: CompilationMeasurements): string[] {
  if (!report.containers.length) return [];
  return ["", "Containers", ...report.containers.map((container) => (
    `  ${container.id} ${container.children} children, required ${scalar(container.required)},`
      + ` available ${scalar(container.available)}, slack ${scalar(container.slack)}`
  ))];
}

function connectorSection(report: CompilationMeasurements): string[] {
  if (!report.connectors.length) return [];
  const connectors = report.connectors.map((connector) => (
    `  ${connector.id} ${connector.from} → ${connector.to}, length ${scalar(connector.length)},`
      + ` ${connector.bends} bends, ${connector.obstacleIntersections} obstacle intersections`
  ));
  return [
    "", "Connectors", ...connectors,
    `  total: ${report.routeQuality.crossings} crossings, ${report.routeQuality.bends} bends,`
      + ` ${report.routeQuality.obstacleIntersections} obstacle intersections,`
      + ` shared length ${scalar(report.routeQuality.sharedSegmentLength)}`,
  ];
}

function labelSection(report: CompilationMeasurements): string[] {
  if (!report.labels.length) return [];
  return ["", "Connector labels", ...report.labels.map((label) => (
    `  ${label.id} ${bounds(label.bounds)}, ${label.side} segment ${label.routeSegment}: ${JSON.stringify(label.text)}`
  ))];
}

function constraintSection(report: CompilationMeasurements): string[] {
  if (!report.constraints.length) return [];
  return ["", "Constraints", ...report.constraints.map((constraint) => {
    const values = Object.entries(constraint.values).map(([key, value]) => (
      `${key}=${Array.isArray(value) ? point(value) : value}`
    )).join(" ");
    return `  ${constraint.type} (${constraint.elements.join(", ")})${values ? ` ${values}` : ""}`;
  })];
}

function assetSection(report: CompilationMeasurements): string[] {
  if (!report.assets.length) return [];
  return ["", "Assets", ...report.assets.map((asset) => (
    `  ${asset.id} ${asset.mimeType}, ${asset.bytes} bytes, ${asset.uses.length} uses`
  ))];
}

function textReport(report: CompilationMeasurements, source: string): string {
  return [
    `OK ${source}`,
    `Diagram ${JSON.stringify(report.title)} — canvas ${bounds(report.canvas)}`,
    `${report.counts.semanticElements} semantic elements, ${report.counts.renderedPrimitives} rendered primitives,`
      + ` ${report.texts.length} text runs, ${report.assets.length} embedded assets`,
    ...elementSection(report),
    ...containerSection(report),
    ...connectorSection(report),
    ...labelSection(report),
    ...constraintSection(report),
    ...assetSection(report),
  ].join("\n");
}

export function renderMeasurementReport(
  report: CompilationMeasurements,
  format: MeasurementFormat,
  source: string,
): string {
  if (format === "json") return JSON.stringify({ ok: true, source, ...report }, null, 2);
  return textReport(report, source);
}
