export const SPACING_PRESETS = Object.freeze({
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

export function layoutGap(layout, fallback) {
  if (layout?.gap !== undefined) return layout.gap;
  if (layout?.spacing !== undefined) return SPACING_PRESETS[layout.spacing];
  return fallback;
}
