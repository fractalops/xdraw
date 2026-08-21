import type { CompassAnchor } from "../contracts/foundation.ts";

/** Scalar parts exposed below an element's explicit `bounds` value. */
export const BOX_PARTS = Object.freeze([
  "left", "right", "top", "bottom", "width", "height",
] as const);

export type BoxPart = (typeof BOX_PARTS)[number];

export const ANCHORS: readonly CompassAnchor[] = Object.freeze([
  "center", "north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west",
] as const);

export type GeometryAnchor = CompassAnchor;

/** Split `card.bounds.right` into a placed element and a scalar box part. */
export function splitGeometryName(name: string): { element: string; part: BoxPart } | null {
  const match = /^(.*)\.bounds\.(left|right|top|bottom|width|height)$/u.exec(name);
  if (!match?.[1]) return null;
  return { element: match[1], part: match[2] as BoxPart };
}

/** Split `card.north-east` into a placed element and a compass anchor. */
export function splitAnchorName(name: string): { element: string; anchor: GeometryAnchor } | null {
  const separator = name.lastIndexOf(".");
  if (separator <= 0) return null;
  const anchor = name.slice(separator + 1);
  if (!(ANCHORS as readonly string[]).includes(anchor)) return null;
  return { element: name.slice(0, separator), anchor: anchor as GeometryAnchor };
}
