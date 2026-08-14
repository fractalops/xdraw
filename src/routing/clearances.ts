import type { SpacingPreset } from "../contracts/foundation.ts";

export const SPACING_PRESETS: Readonly<Record<SpacingPreset, number>> = Object.freeze({
  tight: 24,
  normal: 40,
  airy: 72,
});

export const ROUTING_CLEARANCE = Object.freeze({
  endpoint: 20,
  obstacle: 12,
  channel: 16,
  label: 8,
});

export function layoutGap(
  layout: { gap?: number; spacing?: SpacingPreset } | null | undefined,
  fallback: number,
): number {
  if (layout?.gap !== undefined) return layout.gap;
  if (layout?.spacing !== undefined) return SPACING_PRESETS[layout.spacing];
  return fallback;
}
