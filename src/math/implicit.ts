import {
  evaluateExpression,
  parseExpression,
  validateExpression,
} from "../language/expression.ts";
import type { ExpressionNode } from "../language/expression.ts";

export type ImplicitPoint = readonly [number, number];

export interface ImplicitTraceRequest {
  readonly equation: string;
  readonly xDomain: readonly [number, number];
  readonly yDomain: readonly [number, number];
  readonly columns: number;
  readonly rows: number;
}

interface Segment {
  readonly start: ImplicitPoint;
  readonly end: ImplicitPoint;
}

type CellCorners = readonly [ImplicitPoint, ImplicitPoint, ImplicitPoint, ImplicitPoint];
type CellSamples = readonly [number, number, number, number];

function pointKey(point: ImplicitPoint): string {
  return `${point[0].toPrecision(13)},${point[1].toPrecision(13)}`;
}

function interpolate(
  a: ImplicitPoint,
  b: ImplicitPoint,
  fa: number,
  fb: number,
): ImplicitPoint {
  const denominator = fa - fb;
  const amount = denominator === 0 ? 0.5 : Math.max(0, Math.min(1, fa / denominator));
  return [a[0] + amount * (b[0] - a[0]), a[1] + amount * (b[1] - a[1])];
}

function joinSegments(segments: readonly Segment[]): ImplicitPoint[][] {
  const incident = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    for (const point of [segment.start, segment.end]) {
      const key = pointKey(point);
      const entries = incident.get(key) ?? [];
      entries.push(index);
      incident.set(key, entries);
    }
  });
  const used = new Set<number>();
  const paths: ImplicitPoint[][] = [];

  const walk = (first: number, start: ImplicitPoint): ImplicitPoint[] => {
    const path: ImplicitPoint[] = [start];
    let segmentIndex = first;
    let current = start;
    while (!used.has(segmentIndex)) {
      used.add(segmentIndex);
      const segment = segments[segmentIndex];
      const next = pointKey(segment.start) === pointKey(current) ? segment.end : segment.start;
      path.push(next);
      current = next;
      const continuation = (incident.get(pointKey(current)) ?? []).find((index) => !used.has(index));
      if (continuation === undefined) break;
      segmentIndex = continuation;
    }
    return path;
  };

  // Open contours start at degree-one vertices. Closed contours are handled by
  // the second pass, which can begin anywhere because their endpoints coincide.
  for (const [key, entries] of incident) {
    if (entries.length !== 1 || used.has(entries[0])) continue;
    const segment = segments[entries[0]];
    const start = pointKey(segment.start) === key ? segment.start : segment.end;
    paths.push(walk(entries[0], start));
  }
  segments.forEach((segment, index) => {
    if (!used.has(index)) paths.push(walk(index, segment.start));
  });
  return paths.filter((path) => path.length > 1);
}

function sampleField(
  expression: ExpressionNode,
  request: ImplicitTraceRequest,
): { values: number[][]; points: ImplicitPoint[][] } {
  const [x0, x1] = request.xDomain;
  const [y0, y1] = request.yDomain;
  const values: number[][] = [];
  const points: ImplicitPoint[][] = [];
  for (let row = 0; row <= request.rows; row += 1) {
    const y = y0 + (y1 - y0) * row / request.rows;
    const valueRow: number[] = [];
    const pointRow: ImplicitPoint[] = [];
    for (let column = 0; column <= request.columns; column += 1) {
      const x = x0 + (x1 - x0) * column / request.columns;
      valueRow.push(evaluateExpression(expression, { x, y }));
      pointRow.push([x, y]);
    }
    values.push(valueRow);
    points.push(pointRow);
  }
  return { values, points };
}

function cellSegments(
  expression: ExpressionNode,
  corners: CellCorners,
  samples: CellSamples,
): Segment[] {
  if (!samples.every(Number.isFinite)) return [];
  const crossings: ImplicitPoint[] = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const next = (edge + 1) % 4;
    if ((samples[edge] >= 0) === (samples[next] >= 0)) continue;
    crossings.push(interpolate(corners[edge], corners[next], samples[edge], samples[next]));
  }
  if (crossings.length === 2) return [{ start: crossings[0], end: crossings[1] }];
  if (crossings.length !== 4) return [];

  const centre = evaluateExpression(expression, {
    x: (corners[0][0] + corners[2][0]) / 2,
    y: (corners[0][1] + corners[2][1]) / 2,
  });
  const pairs = (centre >= 0) === (samples[0] >= 0)
    ? [[0, 1], [2, 3]] as const
    : [[0, 3], [1, 2]] as const;
  return pairs.map(([a, b]) => ({ start: crossings[a], end: crossings[b] }));
}

/** Trace the zero set of an expression with deterministic marching squares. */
export function traceImplicitCurve(request: ImplicitTraceRequest): ImplicitPoint[][] {
  if (!Number.isInteger(request.columns) || request.columns < 2
      || !Number.isInteger(request.rows) || request.rows < 2) {
    throw new Error("implicit trace resolution must use at least two rows and columns");
  }
  const expression = parseExpression(request.equation);
  const issues = validateExpression(expression, new Set(["x", "y"]));
  if (issues.length) throw new Error(issues[0].message);
  const { values, points } = sampleField(expression, request);

  const segments: Segment[] = [];
  for (let row = 0; row < request.rows; row += 1) {
    for (let column = 0; column < request.columns; column += 1) {
      // Corner order is bottom-left, bottom-right, top-right, top-left.
      const corners = [
        points[row][column],
        points[row][column + 1],
        points[row + 1][column + 1],
        points[row + 1][column],
      ] as const;
      const samples = [
        values[row][column],
        values[row][column + 1],
        values[row + 1][column + 1],
        values[row + 1][column],
      ] as const;
      segments.push(...cellSegments(expression, corners, samples));
    }
  }
  return joinSegments(segments);
}
