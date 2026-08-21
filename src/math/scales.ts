import { measureTextWidth } from "../text/metrics.ts";
import type { FontFamily } from "../text/metrics.ts";

export type NumericExtent = readonly [number, number];

export interface LinearTick {
  value: number;
  label: string;
  position: number;
}

export interface LinearScalePlan {
  type: "linear";
  /** The data extent supplied by the caller. */
  dataDomain: NumericExtent;
  /** The effective mapping extent, expanded when covering ticks win. */
  domain: NumericExtent;
  range: NumericExtent;
  ticks: LinearTick[];
}

export interface LinearScaleOptions {
  count?: number;
  fontSize?: number;
  fontFamily?: FontFamily;
  format?: (value: number, step: number) => string;
}

const NICE_MULTIPLIERS = [1, 5, 2, 2.5, 4, 3] as const;

function finiteExtent(value: NumericExtent, name: string): void {
  if (value.length !== 2 || !value.every(Number.isFinite) || value[0] === value[1]) {
    throw new Error(`${name} must contain two distinct finite numbers`);
  }
}

function stable(value: number): number {
  return Number(value.toPrecision(14));
}

function defaultFormat(value: number, step: number): string {
  const decimals = Math.max(0, Math.min(12, -Math.floor(Math.log10(Math.abs(step)))
    + (Number.isInteger(step / 10 ** Math.floor(Math.log10(Math.abs(step)))) ? 0 : 1)));
  const rendered = stable(value).toFixed(decimals);
  const trimmed = rendered.replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
  return trimmed === "-0" ? "0" : trimmed;
}

function mapped(domain: NumericExtent, range: NumericExtent, value: number): number {
  return range[0] + (value - domain[0]) / (domain[1] - domain[0]) * (range[1] - range[0]);
}

interface TickCandidate {
  values: number[];
  labels: string[];
  domain: NumericExtent;
  step: number;
  score: number;
  key: string;
}

interface TickSearch {
  dataDomain: NumericExtent;
  range: NumericExtent;
  count: number;
  fontSize: number;
  fontFamily: FontFamily;
  format: (value: number, step: number) => string;
  low: number;
  high: number;
}

function candidateScore(
  values: readonly number[],
  labels: readonly string[],
  step: number,
  multiplierIndex: number,
  dataDomain: NumericExtent,
  mappingDomain: NumericExtent,
  range: NumericExtent,
  count: number,
  fontSize: number,
  fontFamily: FontFamily,
): number {
  const low = Math.min(...dataDomain);
  const high = Math.max(...dataDomain);
  const span = high - low;
  const first = values[0];
  const last = values.at(-1)!;
  const uncovered = Math.max(0, first - low) + Math.max(0, high - last);
  const overshoot = Math.max(0, low - first) + Math.max(0, last - high);
  const coverage = Math.max(0, 1 - (uncovered + 0.6 * overshoot) / span);
  const density = Math.max(0, 1 - Math.abs(values.length - count) / Math.max(1, count));
  const zeroBonus = low <= 0 && high >= 0 && values.some((value) => Math.abs(value) < step * 1e-9) ? 0.1 : 0;
  const simplicity = Math.max(0, 1 - multiplierIndex / NICE_MULTIPLIERS.length + zeroBonus);
  let collisions = 0;
  for (let index = 1; index < values.length; index += 1) {
    const distance = Math.abs(
      mapped(mappingDomain, range, values[index]) - mapped(mappingDomain, range, values[index - 1]),
    );
    const required = (measureTextWidth(labels[index - 1], fontSize, fontFamily)
      + measureTextWidth(labels[index], fontSize, fontFamily)) / 2 + 8;
    if (distance < required) collisions += (required - distance) / required;
  }
  const legibility = Math.max(0, 1 - collisions / Math.max(1, values.length - 1));
  return simplicity * 0.2 + coverage * 0.3 + density * 0.25 + legibility * 0.25;
}

function scaleSearch(
  domain: NumericExtent,
  range: NumericExtent,
  options: LinearScaleOptions,
): TickSearch {
  finiteExtent(domain, "scale domain");
  finiteExtent(range, "scale range");
  const count = options.count ?? 5;
  if (!Number.isInteger(count) || count < 2 || count > 100) {
    throw new Error("tick count must be an integer from 2 to 100");
  }
  const fontSize = options.fontSize ?? 14;
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    throw new Error("tick font size must be positive and finite");
  }
  return {
    dataDomain: domain,
    range,
    count,
    fontSize,
    fontFamily: options.fontFamily ?? 3,
    format: options.format ?? defaultFormat,
    low: Math.min(...domain),
    high: Math.max(...domain),
  };
}

function tickCandidate(
  search: TickSearch,
  power: number,
  multiplierIndex: number,
  cover: boolean,
): TickCandidate | null {
  const step = NICE_MULTIPLIERS[multiplierIndex] * 10 ** power;
  const start = (cover ? Math.floor(search.low / step) : Math.ceil(search.low / step)) * step;
  const end = (cover ? Math.ceil(search.high / step) : Math.floor(search.high / step)) * step;
  const size = Math.round((end - start) / step) + 1;
  if (size < 2 || size > Math.max(200, search.count * 4)) return null;
  const values = Array.from({ length: size }, (_, index) => stable(start + index * step));
  const labels = values.map((value) => search.format(value, step));
  const domain: NumericExtent = cover ? [values[0], values.at(-1)!] : [search.low, search.high];
  const score = candidateScore(
    values,
    labels,
    step,
    multiplierIndex,
    search.dataDomain,
    domain,
    search.range,
    search.count,
    search.fontSize,
    search.fontFamily,
  );
  return { values, labels, domain, step, score, key: `${step}:${values.join(",")}` };
}

function searchTicks(search: TickSearch): TickCandidate {
  const span = search.high - search.low;
  const exponent = Math.floor(Math.log10(span / Math.max(1, search.count - 1)));
  const candidates: TickCandidate[] = [];
  for (let power = exponent - 2; power <= exponent + 2; power += 1) {
    for (let index = 0; index < NICE_MULTIPLIERS.length; index += 1) {
      for (const cover of [false, true]) {
        const candidate = tickCandidate(search, power, index, cover);
        if (candidate) candidates.push(candidate);
      }
    }
  }
  const winner = candidates.sort((left, right) => (
    right.score - left.score || left.key.localeCompare(right.key)
  ))[0];
  if (!winner) throw new Error("linear scale could not produce ticks");
  return winner;
}

/**
 * Build a deterministic linear scale using an extended Wilkinson-style search.
 * Candidate ticks may sit inside or outside the data extremes; label = measurement
 * participates in the same score as numerical simplicity and coverage.
 */
export function planLinearScale(
  domain: NumericExtent,
  range: NumericExtent,
  options: LinearScaleOptions = {},
): LinearScalePlan {
  const winner = searchTicks(scaleSearch(domain, range, options));
  const values = domain[0] <= domain[1] ? winner.values : [...winner.values].reverse();
  const labels = domain[0] <= domain[1] ? winner.labels : [...winner.labels].reverse();
  const effectiveDomain: NumericExtent = domain[0] <= domain[1]
    ? winner.domain
    : [winner.domain[1], winner.domain[0]];
  return {
    type: "linear",
    dataDomain: [...domain],
    domain: effectiveDomain,
    range: [...range],
    ticks: values.map((value, index) => ({
      value,
      label: labels[index],
      position: mapped(effectiveDomain, range, value),
    })),
  };
}

export function scaleLinearValue(scale: Pick<LinearScalePlan, "domain" | "range">, value: number): number {
  if (!Number.isFinite(value)) throw new Error("scale value must be finite");
  finiteExtent(scale.domain, "scale domain");
  finiteExtent(scale.range, "scale range");
  return mapped(scale.domain, scale.range, value);
}

export function invertLinearValue(scale: Pick<LinearScalePlan, "domain" | "range">, position: number): number {
  if (!Number.isFinite(position)) throw new Error("scale position must be finite");
  return mapped(scale.range, scale.domain, position);
}

export type AxisOrientation = "bottom" | "top" | "left" | "right";
export type AxisTextAlign = "left" | "center" | "right";
export type AxisVerticalAlign = "top" | "middle" | "bottom";
export type AxisPoint = readonly [number, number];

export interface AxisLine {
  start: AxisPoint;
  end: AxisPoint;
}

export interface LinearAxisTick extends LinearTick {
  mark: AxisLine;
  labelPosition: AxisPoint;
  textAlign: AxisTextAlign;
  verticalAlign: AxisVerticalAlign;
}

export interface LinearAxisPlan {
  type: "linear-axis";
  orientation: AxisOrientation;
  line: AxisLine;
  ticks: LinearAxisTick[];
}

export interface LinearAxisOptions {
  orientation?: AxisOrientation;
  cross?: number;
  tickSize?: number;
  labelGap?: number;
}

/** Turn a scale plan into clone-safe axis geometry without choosing a renderer. */
export function planLinearAxis(
  scale: LinearScalePlan,
  options: LinearAxisOptions = {},
): LinearAxisPlan {
  const orientation = options.orientation ?? "bottom";
  const cross = options.cross ?? 0;
  const tickSize = options.tickSize ?? 6;
  const labelGap = options.labelGap ?? 4;
  if (!Number.isFinite(cross)) throw new Error("axis cross position must be finite");
  if (!Number.isFinite(tickSize) || tickSize < 0) throw new Error("axis tick size must be finite and non-negative");
  if (!Number.isFinite(labelGap) || labelGap < 0) throw new Error("axis label gap must be finite and non-negative");
  finiteExtent(scale.range, "scale range");

  const horizontal = orientation === "bottom" || orientation === "top";
  const direction = orientation === "bottom" || orientation === "right" ? 1 : -1;
  const point = (along: number, across: number): AxisPoint => horizontal
    ? [along, across]
    : [across, along];
  const markEnd = cross + direction * tickSize;
  const labelCross = markEnd + direction * labelGap;
  const textAlign: AxisTextAlign = horizontal ? "center" : direction > 0 ? "left" : "right";
  const verticalAlign: AxisVerticalAlign = horizontal
    ? direction > 0 ? "top" : "bottom"
    : "middle";

  return {
    type: "linear-axis",
    orientation,
    line: {
      start: point(scale.range[0], cross),
      end: point(scale.range[1], cross),
    },
    ticks: scale.ticks.map((tick) => ({
      ...tick,
      mark: {
        start: point(tick.position, cross),
        end: point(tick.position, markEnd),
      },
      labelPosition: point(tick.position, labelCross),
      textAlign,
      verticalAlign,
    })),
  };
}
