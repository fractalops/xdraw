import { arrow, rectangle, text } from "../excalidraw/elements.ts";
import { box } from "../geometry.ts";
import { enclosureOf, sampleCurve } from "../language/curve-sampler.ts";
import { demand } from "../language/deferred.ts";
import { interval } from "../language/interval.ts";
import { planLinearAxis, planLinearScale, scaleLinearValue } from "../math/scales.ts";
import { traceImplicitCurve } from "../math/implicit.ts";
import { measureTextWidth } from "../text/metrics.ts";
import type { Bounds, Point } from "../contracts/foundation.ts";
import type {
  NodeMeasurementTarget,
  ResolvedFreedrawStyle,
  ResolvedNodeStyle,
  StyleResolver,
} from "../contracts/layout.ts";
import type { DrawingElement, TextAlign, VerticalAlign } from "../contracts/render.ts";
import type { CartesianNodePlan, CartesianSeriesPlan } from "../contracts/rich-node.ts";
import type { FreedrawStatement, NodeStatement, PlotStatement, SemanticStatement } from "../contracts/semantic.ts";

const MINIMUM_WIDTH = 480;
const DEFAULT_HEIGHT = 420;
const MINIMUM_HEIGHT = 300;
const AXIS_FONT_SIZE = 14;
const TITLE_FONT_SIZE = 20;
const FONT = 3;
const SERIES_COLORS = ["#2563eb", "#dc2626", "#059669", "#7c3aed", "#ea580c", "#0891b2"] as const;

export class CartesianChartError extends Error {
  readonly id: string;

  constructor(id: string, reason: string) {
    super(`coordinate plane '${id}' could not be planned: ${reason}`);
    this.name = "XDrawCartesianChartError";
    this.id = id;
  }
}

export function cartesianNodeMinimumWidth(): number {
  return MINIMUM_WIDTH;
}

function chartSeries(node: NodeMeasurementTarget): PlotStatement[] {
  return (node.statements ?? []).filter((statement): statement is PlotStatement => statement.type === "plot");
}

function inside(domain: readonly [number, number], value: number): boolean {
  return value >= Math.min(...domain) && value <= Math.max(...domain);
}

function samePoint(left: readonly [number, number], right: readonly [number, number]): boolean {
  return Math.abs(left[0] - right[0]) < 1e-9 && Math.abs(left[1] - right[1]) < 1e-9;
}

/** Clip one segment to a rectangle with the Liang-Barsky inequalities. */
function clipSegment(start: Point, end: Point, bounds: Bounds): readonly [Point, Point] | null {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const p = [-dx, dx, -dy, dy];
  const q = [
    start[0] - bounds.x,
    bounds.x + bounds.width - start[0],
    start[1] - bounds.y,
    bounds.y + bounds.height - start[1],
  ];
  let low = 0;
  let high = 1;
  for (let index = 0; index < 4; index += 1) {
    if (p[index] === 0) {
      if (q[index] < 0) return null;
      continue;
    }
    const ratio = q[index] / p[index];
    if (p[index] < 0) low = Math.max(low, ratio);
    else high = Math.min(high, ratio);
    if (low > high) return null;
  }
  return [
    [start[0] + low * dx, start[1] + low * dy],
    [start[0] + high * dx, start[1] + high * dy],
  ];
}

function clippedPolyline(points: readonly Point[], bounds: Bounds): Point[][] {
  const segments: Point[][] = [];
  let current: Point[] | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const clipped = clipSegment(points[index - 1], points[index], bounds);
    if (!clipped) {
      current = null;
      continue;
    }
    const [start, end] = clipped;
    if (!current || !samePoint(current.at(-1)!, start)) {
      current = [[...start], [...end]];
      segments.push(current);
    } else if (!samePoint(current.at(-1)!, end)) {
      current.push([...end]);
    }
  }
  return segments.filter((segment) => (
    segment.length > 1 && segment.some((point) => !samePoint(point, segment[0]))
  ));
}

function fallbackSeriesStyle(series: PlotStatement, index: number): ResolvedFreedrawStyle {
  const number = (name: string, fallback: number): number => {
    const value = series.attributes[name];
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new CartesianChartError(series.id, `${name} must be a finite number`);
    }
    return value;
  };
  const stroke = series.attributes.stroke;
  if (stroke !== undefined && typeof stroke !== "string") {
    throw new CartesianChartError(series.id, "stroke must be a string");
  }
  const background = series.attributes.background;
  if (background !== undefined && typeof background !== "string") {
    throw new CartesianChartError(series.id, "background must be a string");
  }
  const fillStyle = series.attributes["fill-style"];
  if (fillStyle !== undefined && fillStyle !== "solid" && fillStyle !== "hachure" && fillStyle !== "cross-hatch") {
    throw new CartesianChartError(series.id, `unsupported fill style: ${String(fillStyle)}`);
  }
  return {
    strokeColor: stroke ?? SERIES_COLORS[index % SERIES_COLORS.length],
    backgroundColor: background ?? "transparent",
    strokeWidth: number("stroke-width", 2),
    strokeStyle: series.attributes["stroke-style"] === "dashed" || series.attributes["stroke-style"] === "dotted"
      ? series.attributes["stroke-style"]
      : "solid",
    fillStyle: fillStyle ?? "solid",
    roughness: number("roughness", 0),
    opacity: number("opacity", 100),
    link: typeof series.attributes.link === "string" ? series.attributes.link : null,
    locked: series.attributes.locked === true,
  };
}

function seriesStyle(
  series: PlotStatement,
  index: number,
  resolver?: StyleResolver,
): ResolvedFreedrawStyle {
  if (!resolver) return fallbackSeriesStyle(series, index);
  const drawable: FreedrawStatement = {
    ...series,
    type: "freedraw",
    at: [0, 0],
    points: [[0, 0], [1, 1]],
    pressures: [],
    simulatePressure: false,
  };
  const resolved = resolver.resolveFreedraw(drawable);
  const hasExplicitColor = series.attributes.stroke !== undefined
    || series.attributes.style !== undefined
    || series.styleDefaults?.stroke !== undefined;
  return hasExplicitColor ? resolved : {
    ...resolved,
    strokeColor: SERIES_COLORS[index % SERIES_COLORS.length],
  };
}

type NumericDomain = readonly [number, number];

function plotInterval(
  series: PlotStatement,
  xDomain?: NumericDomain,
  yDomain?: NumericDomain,
): NumericDomain | null {
  if (series.from !== undefined || series.to !== undefined) {
    if (series.from === undefined || series.to === undefined) return null;
    return [
      demand(series.from, `plot '${series.id}' interval`),
      demand(series.to, `plot '${series.id}' interval`),
    ];
  }
  if (series.variable === "x") return xDomain ?? null;
  if (series.variable === "y") return yDomain ?? null;
  return null;
}

function unionExtent(left: NumericDomain | null, right: NumericDomain): NumericDomain {
  if (!left) return [Math.min(...right), Math.max(...right)];
  return [Math.min(left[0], ...right), Math.max(left[1], ...right)];
}

function paddedExtent(domain: NumericDomain): NumericDomain {
  const low = Math.min(...domain);
  const high = Math.max(...domain);
  const padding = high === low ? Math.max(1, Math.abs(low) * 0.1) : (high - low) * 0.05;
  return [low - padding, high + padding];
}

function seriesExtents(series: PlotStatement, over: NumericDomain): { x: NumericDomain; y: NumericDomain } | null {
  try {
    const parameter = interval(Math.min(...over), Math.max(...over));
    const x = enclosureOf(series.x, parameter, series.variable);
    const y = enclosureOf(series.y, parameter, series.variable);
    if (![x.lo, x.hi, y.lo, y.hi].every(Number.isFinite)) return null;
    return { x: [x.lo, x.hi], y: [y.lo, y.hi] };
  } catch {
    return null;
  }
}

function resolvedDomain(
  values: readonly [number | string, number | string] | undefined,
  label: string,
): NumericDomain | undefined {
  if (!values) return undefined;
  return values.map((value) => demand(value, label)) as [number, number];
}

interface DomainInference {
  x: NumericDomain | null;
  y: NumericDomain | null;
  readonly inherit: PlotStatement[];
}

function includeSeriesExtents(
  inference: DomainInference,
  series: PlotStatement,
  over: NumericDomain,
): void {
  const extents = seriesExtents(series, over);
  if (!extents) return;
  inference.x = unionExtent(inference.x, extents.x);
  inference.y = unionExtent(inference.y, extents.y);
}

function inferOwnedSeries(series: readonly PlotStatement[]): DomainInference {
  const inference: DomainInference = { x: null, y: null, inherit: [] };
  for (const item of series) {
    if (item.equation) continue;
    const own = plotInterval(item);
    if (own) includeSeriesExtents(inference, item, own);
    else inference.inherit.push(item);
  }
  return inference;
}

function includeInheritedSeries(
  inference: DomainInference,
  xDomain: NumericDomain | undefined,
  yDomain: NumericDomain | undefined,
): void {
  for (const item of inference.inherit) {
    const inherited = plotInterval(item, xDomain, yDomain);
    if (inherited) includeSeriesExtents(inference, item, inherited);
  }
}

function inferredDomain(domain: NumericDomain | null): NumericDomain | undefined {
  return domain ? paddedExtent(domain) : undefined;
}

function resolvePlaneDomains(node: NodeMeasurementTarget, series: readonly PlotStatement[]): {
  x: NumericDomain;
  y: NumericDomain;
} {
  const explicitX = resolvedDomain(node.plane?.xDomain, `plane '${node.id}' x interval`);
  const explicitY = resolvedDomain(node.plane?.yDomain, `plane '${node.id}' y interval`);
  if (series.some((item) => item.equation) && (!explicitX || !explicitY)) {
    throw new CartesianChartError(node.id ?? "unknown", "an implicit equation requires explicit x and y plane intervals");
  }
  const inference = inferOwnedSeries(series);
  includeInheritedSeries(
    inference,
    explicitX ?? inferredDomain(inference.x),
    explicitY ?? inferredDomain(inference.y),
  );
  const x = explicitX ?? inferredDomain(inference.x);
  const y = explicitY ?? inferredDomain(inference.y);
  if (!x || !y) {
    throw new CartesianChartError(
      node.id ?? "unknown",
      "x and y intervals could not be inferred from finite plot intervals; declare the missing plane interval",
    );
  }
  return { x, y };
}

function planSeries(
  series: PlotStatement,
  index: number,
  xScale: ReturnType<typeof planLinearScale>,
  yScale: ReturnType<typeof planLinearScale>,
  plotBounds: Bounds,
  resolver?: StyleResolver,
): CartesianSeriesPlan {
  const style = seriesStyle(series, index, resolver);
  if (series.equation) {
    const cellPixels = Math.max(1, series.tolerance * 4);
    const columns = Math.min(256, Math.max(32, Math.ceil(plotBounds.width / cellPixels)));
    const rows = Math.min(256, Math.max(32, Math.ceil(plotBounds.height / cellPixels)));
    let traced: ReturnType<typeof traceImplicitCurve>;
    try {
      traced = traceImplicitCurve({
        equation: series.equation,
        xDomain: xScale.dataDomain,
        yDomain: yScale.dataDomain,
        columns,
        rows,
      });
    } catch (error) {
      throw new CartesianChartError(series.id, error instanceof Error ? error.message : String(error));
    }
    if (!traced.length) throw new CartesianChartError(series.id, "the implicit equation does not cross the visible plane");
    const segments = traced.map((segment) => segment.map(([x, y]): Point => [
      scaleLinearValue(xScale, x),
      scaleLinearValue(yScale, y),
    ]));
    return Object.freeze({
      id: series.id,
      label: series.label,
      segments: Object.freeze(segments.map((segment) => Object.freeze(segment))),
      strokeColor: style.strokeColor,
      backgroundColor: style.backgroundColor,
      fillStyle: style.fillStyle,
      strokeWidth: style.strokeWidth,
      strokeStyle: style.strokeStyle,
      roughness: style.roughness,
      opacity: style.opacity,
      link: style.link ?? undefined,
      locked: style.locked,
    });
  }
  const xFactor = Math.abs((xScale.range[1] - xScale.range[0]) / (xScale.domain[1] - xScale.domain[0]));
  const yFactor = Math.abs((yScale.range[1] - yScale.range[0]) / (yScale.domain[1] - yScale.domain[0]));
  const coordinateTolerance = series.tolerance / Math.max(xFactor, yFactor);
  const parameter = plotInterval(series, xScale.dataDomain, yScale.dataDomain);
  if (!parameter) throw new CartesianChartError(series.id, "its independent interval cannot be inherited from the plane");
  const sampled = sampleCurve({
    x: series.x,
    y: series.y,
    variable: series.variable,
    from: parameter[0],
    to: parameter[1],
    tolerance: coordinateTolerance,
  });
  if (sampled.status === "refused") throw new CartesianChartError(series.id, sampled.reason);
  const mapped = sampled.points.map(([x, y]): Point => [
    scaleLinearValue(xScale, x),
    scaleLinearValue(yScale, y),
  ]);
  return Object.freeze({
    id: series.id,
    label: series.label,
    segments: Object.freeze(clippedPolyline(mapped, plotBounds).map((segment) => Object.freeze(segment))),
    strokeColor: style.strokeColor,
    backgroundColor: style.backgroundColor,
    fillStyle: style.fillStyle,
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    roughness: style.roughness,
    opacity: style.opacity,
    link: style.link ?? undefined,
    locked: style.locked,
  });
}

export function planCartesianNode(
  node: NodeMeasurementTarget,
  width: number,
  _style?: ResolvedNodeStyle,
  resolver?: StyleResolver,
): CartesianNodePlan {
  if (!node.plane) throw new CartesianChartError(node.id ?? "unknown", "plane configuration is missing");
  if (!(width >= MINIMUM_WIDTH) || !Number.isFinite(width)) {
    throw new CartesianChartError(node.id ?? "unknown", `width must be at least ${MINIMUM_WIDTH}`);
  }
  const height = node.size?.[1] ?? DEFAULT_HEIGHT;
  if (!(height >= MINIMUM_HEIGHT) || !Number.isFinite(height)) {
    throw new CartesianChartError(node.id ?? "unknown", `height must be at least ${MINIMUM_HEIGHT}`);
  }
  const series = chartSeries(node);
  if (!series.length) throw new CartesianChartError(node.id ?? "unknown", "at least one plot series is required");

  const top = node.title ? 66 : 30;
  const plotBounds = box(82, top, width - 108, height - top - 68);
  const { x: xDomain, y: yDomain } = resolvePlaneDomains(node, series);
  const xScale = planLinearScale(xDomain, [plotBounds.x, plotBounds.x + plotBounds.width], {
    count: node.plane.tickCount,
    fontSize: AXIS_FONT_SIZE,
    fontFamily: FONT,
  });
  const yScale = planLinearScale(yDomain, [plotBounds.y + plotBounds.height, plotBounds.y], {
    count: node.plane.tickCount,
    fontSize: AXIS_FONT_SIZE,
    fontFamily: FONT,
  });
  const xCross = node.plane.crossZero && inside(yScale.domain, 0)
    ? scaleLinearValue(yScale, 0)
    : plotBounds.y + plotBounds.height;
  const yCross = node.plane.crossZero && inside(xScale.domain, 0)
    ? scaleLinearValue(xScale, 0)
    : plotBounds.x;
  const xAxis = planLinearAxis(xScale, { orientation: "bottom", cross: xCross });
  const yAxis = planLinearAxis(yScale, { orientation: "left", cross: yCross });

  return Object.freeze({
    type: "cartesian",
    width,
    height,
    plotBounds: Object.freeze(plotBounds),
    xScale: Object.freeze({ dataDomain: xScale.dataDomain, domain: xScale.domain, range: xScale.range }),
    yScale: Object.freeze({ dataDomain: yScale.dataDomain, domain: yScale.domain, range: yScale.range }),
    xAxis: Object.freeze(xAxis),
    yAxis: Object.freeze(yAxis),
    verticalGrid: Object.freeze(node.plane.grid ? xScale.ticks.map((tick) => ({
      start: [tick.position, plotBounds.y] as const,
      end: [tick.position, plotBounds.y + plotBounds.height] as const,
    })) : []),
    horizontalGrid: Object.freeze(node.plane.grid ? yScale.ticks.map((tick) => ({
      start: [plotBounds.x, tick.position] as const,
      end: [plotBounds.x + plotBounds.width, tick.position] as const,
    })) : []),
    series: Object.freeze(series.map((item, index) => planSeries(item, index, xScale, yScale, plotBounds, resolver))),
    xLabel: node.plane.xLabel,
    yLabel: node.plane.yLabel,
  });
}

function absolute(bounds: Bounds, point: readonly [number, number]): Point {
  return [bounds.x + point[0], bounds.y + point[1]];
}

function lineElement(
  id: string,
  bounds: Bounds,
  line: { start: readonly [number, number]; end: readonly [number, number] },
  options: Parameters<typeof arrow>[3],
): DrawingElement {
  return arrow(id, absolute(bounds, line.start), absolute(bounds, line.end), { ...options, type: "line" });
}

function anchoredText(
  id: string,
  bounds: Bounds,
  position: readonly [number, number],
  value: string,
  textAlign: TextAlign,
  verticalAlign: VerticalAlign,
  color: string,
  groupIds: string[],
): DrawingElement {
  const width = measureTextWidth(value, AXIS_FONT_SIZE, FONT);
  const height = AXIS_FONT_SIZE * 1.25;
  const x = position[0] - (textAlign === "center" ? width / 2 : textAlign === "right" ? width : 0);
  const y = position[1] - (verticalAlign === "middle" ? height / 2 : verticalAlign === "bottom" ? height : 0);
  return text(id, absolute(bounds, [x, y]), value, {
    fontFamily: FONT,
    fontSize: AXIS_FONT_SIZE,
    strokeColor: color,
    textAlign,
    verticalAlign,
    groupIds,
  });
}

export function renderCartesianNode(
  node: NodeStatement,
  bounds: Bounds,
  style: ResolvedNodeStyle,
  plan: CartesianNodePlan,
): DrawingElement[] {
  const groupIds = [`${node.id}:group`];
  const elements: DrawingElement[] = [rectangle(`${node.id}:frame`, box(bounds.x, bounds.y, plan.width, plan.height), {
    ...style,
    groupIds,
  })];
  if (node.title) {
    elements.push(text(`${node.id}:title`, [bounds.x + 20, bounds.y + 16], node.title, {
      fontFamily: style.fontFamily,
      fontSize: TITLE_FONT_SIZE,
      strokeColor: style.textColor,
      groupIds,
    }));
  }

  for (const [kind, lines] of [["vertical", plan.verticalGrid], ["horizontal", plan.horizontalGrid]] as const) {
    lines.forEach((line, index) => elements.push(lineElement(`${node.id}:grid:${kind}:${index}`, bounds, line, {
      type: "line",
      strokeColor: "#cbd5e1",
      strokeWidth: 1,
      opacity: 65,
      groupIds,
      locked: style.locked,
    })));
  }
  for (const series of plan.series) {
    series.segments.forEach((segment, index) => {
      const points = segment.map((point) => absolute(bounds, point));
      elements.push(arrow(`${series.id}:segment:${index}`, points[0], points.at(-1)!, {
        type: "line",
        points,
        strokeColor: series.strokeColor,
        backgroundColor: series.backgroundColor,
        fillStyle: series.fillStyle,
        strokeWidth: series.strokeWidth,
        strokeStyle: series.strokeStyle,
        roughness: series.roughness,
        opacity: series.opacity,
        link: series.link,
        locked: series.locked,
        groupIds,
        customData: { xdraw: { role: "cartesian-series", plane: node.id, series: series.id, label: series.label } },
      }));
    });
  }
  elements.push(
    lineElement(`${node.id}:axis:x`, bounds, plan.xAxis.line, { type: "line", strokeColor: style.strokeColor, strokeWidth: 1, groupIds }),
    lineElement(`${node.id}:axis:y`, bounds, plan.yAxis.line, { type: "line", strokeColor: style.strokeColor, strokeWidth: 1, groupIds }),
  );
  for (const [axisName, axis] of [["x", plan.xAxis], ["y", plan.yAxis]] as const) {
    axis.ticks.forEach((tick, index) => {
      elements.push(lineElement(`${node.id}:axis:${axisName}:tick:${index}`, bounds, tick.mark, {
        type: "line",
        strokeColor: style.strokeColor,
        strokeWidth: 1,
        groupIds,
      }));
      elements.push(anchoredText(
        `${node.id}:axis:${axisName}:label:${index}`,
        bounds,
        tick.labelPosition,
        tick.label,
        tick.textAlign,
        tick.verticalAlign,
        style.textColor,
        groupIds,
      ));
    });
  }

  if (plan.xLabel) {
    elements.push(anchoredText(`${node.id}:axis:x:title`, bounds, [
      plan.plotBounds.x + plan.plotBounds.width / 2,
      plan.height - 14,
    ], plan.xLabel, "center", "bottom", style.textColor, groupIds));
  }
  if (plan.yLabel) {
    const label = anchoredText(`${node.id}:axis:y:title`, bounds, [
      20,
      plan.plotBounds.y + plan.plotBounds.height / 2,
    ], plan.yLabel, "center", "middle", style.textColor, groupIds);
    label.angle = -Math.PI / 2;
    elements.push(label);
  }
  return elements;
}

export interface CartesianValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly node: SemanticStatement;
}

function validateChartConfiguration(node: NodeStatement): CartesianValidationIssue[] {
  const plane = node.plane!;
  const issues: CartesianValidationIssue[] = [];
  const finiteDomain = (domain: readonly (number | string)[]): boolean => domain.length === 2
    && domain.every((value) => typeof value === "number" && Number.isFinite(value)) && domain[0] !== domain[1];
  if (plane.xDomain !== undefined && !finiteDomain(plane.xDomain)) {
    issues.push({ code: "XD1281", message: "plane x interval must contain two distinct finite numbers", node });
  }
  if (plane.yDomain !== undefined && !finiteDomain(plane.yDomain)) {
    issues.push({ code: "XD1282", message: "plane y interval must contain two distinct finite numbers", node });
  }
  if (!Number.isInteger(plane.tickCount) || plane.tickCount < 2 || plane.tickCount > 100) {
    issues.push({ code: "XD1283", message: "cartesian tick-count must be an integer from 2 to 100", node });
  }
  if (typeof plane.grid !== "boolean" || typeof plane.crossZero !== "boolean"
      || (plane.xLabel !== undefined && typeof plane.xLabel !== "string")
      || (plane.yLabel !== undefined && typeof plane.yLabel !== "string")) {
    issues.push({ code: "XD1283", message: "cartesian grid and cross-zero must be boolean and axis labels must be text", node });
  }
  if (node.size && (node.size[0] < MINIMUM_WIDTH || node.size[1] < MINIMUM_HEIGHT)) {
    issues.push({
      code: "XD1288",
      message: `cartesian size must be at least (${MINIMUM_WIDTH}, ${MINIMUM_HEIGHT})`,
      node,
    });
  }
  return issues;
}

function validateChartSeries(item: PlotStatement): CartesianValidationIssue[] {
  const issues: CartesianValidationIssue[] = [];
  const hasInterval = item.from !== undefined || item.to !== undefined;
  const invalidInterval = hasInterval && (
    typeof item.from !== "number" || !Number.isFinite(item.from)
    || typeof item.to !== "number" || !Number.isFinite(item.to) || item.from === item.to
  );
  const invalidCurve = (item.equation ? !item.equation.trim() : !item.x.trim() || !item.y.trim())
    || invalidInterval
    || !(item.tolerance > 0) || !Number.isFinite(item.tolerance);
  if (invalidCurve) {
    issues.push({
      code: "XD1285",
      message: "plane plot requires coordinate expressions, a distinct finite interval, and positive tolerance",
      node: item,
    });
  }
  if (item.at) {
    issues.push({ code: "XD1286", message: "cartesian plot series uses data coordinates and may not declare at", node: item });
  }
  return issues;
}

export function validateCartesianNode(node: NodeStatement): CartesianValidationIssue[] {
  const issues: CartesianValidationIssue[] = [];
  const plane = node.plane;
  if (!plane) return [{ code: "XD1280", message: "coordinate plane configuration is required", node }];
  issues.push(...validateChartConfiguration(node));
  const series = chartSeries(node);
  if (!series.length) issues.push({ code: "XD1284", message: "coordinate plane requires at least one plot series", node });
  for (const item of series) issues.push(...validateChartSeries(item));
  const unexpected = node.statements.filter((statement) => statement.type !== "plot");
  if (unexpected.length) issues.push({ code: "XD1287", message: "coordinate plane children must all be plot series", node: unexpected[0] });
  return issues;
}
