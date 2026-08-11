/** @type {Readonly<Record<string, import("./contracts.js").EndpointSide>>} */
const PORTS = Object.freeze({
  east: "right",
  west: "left",
  north: "top",
  south: "bottom",
  right: "right",
  left: "left",
  top: "top",
  bottom: "bottom",
  center: "center",
});

/**
 * @param {string} value
 * @param {{ has(value: string): boolean } | null | undefined} knownIds
 * @returns {import("./contracts.js").Endpoint}
 */
export function splitEndpoint(value, knownIds) {
  if (knownIds?.has(value)) return { id: value, side: undefined };
  const segments = value.split(".");
  const candidate = segments.at(-1);
  if (candidate && candidate in PORTS) {
    return { id: segments.slice(0, -1).join("."), side: PORTS[candidate] };
  }
  return { id: value, side: undefined };
}
