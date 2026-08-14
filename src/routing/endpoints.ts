import type { Endpoint, EndpointSide } from "../contracts/foundation.ts";

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
} satisfies Record<string, EndpointSide>);

type Port = keyof typeof PORTS;

function isPort(value: string): value is Port {
  return Object.hasOwn(PORTS, value);
}

export function splitEndpoint(
  value: string,
  knownIds?: { has(value: string): boolean } | null,
): Endpoint {
  if (knownIds?.has(value)) return { id: value, side: undefined };
  const segments = value.split(".");
  const candidate = segments.at(-1);
  if (candidate && isPort(candidate)) {
    return { id: segments.slice(0, -1).join("."), side: PORTS[candidate] };
  }
  return { id: value, side: undefined };
}
