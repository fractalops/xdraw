export const MAX_FREEDRAW_POINTS = 5_000;
export const MAX_DOCUMENT_FREEDRAW_POINTS = 50_000;
export const MAX_FREEDRAW_COORDINATE = 1_000_000;

import type { Point } from "../foundation-contracts.ts";

export function isFinitePoint(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

export function hasValidFreedrawPoints(points: unknown): points is Point[] {
  return Array.isArray(points) && points.length >= 2 && points.every(isFinitePoint);
}

export function hasValidFreedrawPressures(pressures: unknown, pointCount: number | undefined): pressures is number[] {
  return Array.isArray(pressures)
    && (pressures.length === 0 || pressures.length === pointCount)
    && pressures.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
}
