import { anchor } from "./layout.js";

const PORTS = {
  east: "right",
  west: "left",
  north: "top",
  south: "bottom",
  right: "right",
  left: "left",
  top: "top",
  bottom: "bottom",
  center: "center",
};

export function splitEndpoint(value, knownIds) {
  if (knownIds?.has(value)) return { id: value, side: undefined };
  const segments = value.split(".");
  const candidate = segments.at(-1);
  if (candidate in PORTS) return { id: segments.slice(0, -1).join("."), side: PORTS[candidate] };
  return { id: value, side: undefined };
}

export function inferredSides(fromBounds, toBounds, context = {}) {
  const guideFrom = context.fromContainerBounds ?? fromBounds;
  const guideTo = context.toContainerBounds ?? toBounds;
  const fromCenter = anchor.center(guideFrom);
  const toCenter = anchor.center(guideTo);
  const overlapsHorizontally = guideFrom.x < guideTo.x + guideTo.width
    && guideFrom.x + guideFrom.width > guideTo.x;
  const overlapsVertically = guideFrom.y < guideTo.y + guideTo.height
    && guideFrom.y + guideFrom.height > guideTo.y;
  if (overlapsHorizontally && !overlapsVertically) {
    return toCenter[1] >= fromCenter[1]
      ? { startSide: "bottom", endSide: "top" }
      : { startSide: "top", endSide: "bottom" };
  }
  if (overlapsVertically && !overlapsHorizontally) {
    return toCenter[0] >= fromCenter[0]
      ? { startSide: "right", endSide: "left" }
      : { startSide: "left", endSide: "right" };
  }
  if (Math.abs(toCenter[0] - fromCenter[0]) >= Math.abs(toCenter[1] - fromCenter[1])) {
    return toCenter[0] >= fromCenter[0]
      ? { startSide: "right", endSide: "left" }
      : { startSide: "left", endSide: "right" };
  }
  return toCenter[1] >= fromCenter[1]
    ? { startSide: "bottom", endSide: "top" }
    : { startSide: "top", endSide: "bottom" };
}

function offsetPoint(point, side, distance = ROUTING_CLEARANCE.endpoint) {
  const offsets = { left: [-distance, 0], right: [distance, 0], top: [0, -distance], bottom: [0, distance] };
  const [dx, dy] = offsets[side] ?? [0, 0];
  return [point[0] + dx, point[1] + dy];
}

function compactPath(points) {
  return points.filter((point, index) => {
    if (index && point[0] === points[index - 1][0] && point[1] === points[index - 1][1]) return false;
    if (!index || index === points.length - 1) return true;
    const previous = points[index - 1];
    const next = points[index + 1];
    return !((previous[0] === point[0] && point[0] === next[0]) || (previous[1] === point[1] && point[1] === next[1]));
  });
}

function segmentHitsBounds(start, end, bounds, margin = ROUTING_CLEARANCE.obstacle) {
  const left = bounds.x - margin;
  const right = bounds.x + bounds.width + margin;
  const top = bounds.y - margin;
  const bottom = bounds.y + bounds.height + margin;
  if (start[0] === end[0]) {
    return start[0] > left && start[0] < right
      && Math.max(start[1], end[1]) > top && Math.min(start[1], end[1]) < bottom;
  }
  if (start[1] === end[1]) {
    return start[1] > top && start[1] < bottom
      && Math.max(start[0], end[0]) > left && Math.min(start[0], end[0]) < right;
  }
  return true;
}

function containsBounds(container, bounds) {
  return bounds.x >= container.x && bounds.y >= container.y
    && bounds.x + bounds.width <= container.x + container.width
    && bounds.y + bounds.height <= container.y + container.height;
}

function sharedSegmentLength(firstStart, firstEnd, secondStart, secondEnd) {
  if (firstStart[0] === firstEnd[0] && secondStart[0] === secondEnd[0] && firstStart[0] === secondStart[0]) {
    return Math.max(0, Math.min(Math.max(firstStart[1], firstEnd[1]), Math.max(secondStart[1], secondEnd[1]))
      - Math.max(Math.min(firstStart[1], firstEnd[1]), Math.min(secondStart[1], secondEnd[1])));
  }
  if (firstStart[1] === firstEnd[1] && secondStart[1] === secondEnd[1] && firstStart[1] === secondStart[1]) {
    return Math.max(0, Math.min(Math.max(firstStart[0], firstEnd[0]), Math.max(secondStart[0], secondEnd[0]))
      - Math.max(Math.min(firstStart[0], firstEnd[0]), Math.min(secondStart[0], secondEnd[0])));
  }
  return 0;
}

function segmentsCross(firstStart, firstEnd, secondStart, secondEnd) {
  const cross = (first, second, third) => (
    (second[0] - first[0]) * (third[1] - first[1])
      - (second[1] - first[1]) * (third[0] - first[0])
  );
  const first = cross(firstStart, firstEnd, secondStart);
  const second = cross(firstStart, firstEnd, secondEnd);
  const third = cross(secondStart, secondEnd, firstStart);
  const fourth = cross(secondStart, secondEnd, firstEnd);
  return first * second < 0 && third * fourth < 0;
}

export function routeConnection(scene, fromId, toId, fromBounds, toBounds, startSide, endSide, options = {}) {
  const start = anchor[startSide](fromBounds);
  const end = anchor[endSide](toBounds);
  const startExit = offsetPoint(start, startSide);
  const endExit = offsetPoint(end, endSide);
  const obstacles = [...scene.nodeIds]
    .filter((id) => id !== fromId && id !== toId)
    .map((id) => scene.bounds.get(id));
  const unrelatedContainers = scene.containers
    .map((id) => scene.bounds.get(id))
    .filter((bounds) => !containsBounds(bounds, fromBounds) && !containsBounds(bounds, toBounds));
  obstacles.push(...unrelatedContainers);
  obstacles.push(...(scene.labelBounds ?? []));
  if (options.around) {
    const required = scene.bounds.get(options.around);
    if (!required) throw new Error(`route constraint references unknown node: ${options.around}`);
    if (!obstacles.includes(required)) obstacles.push(required);
  }
  const xChannels = obstacles.flatMap((bounds) => [
    bounds.x - ROUTING_CLEARANCE.channel,
    bounds.x + bounds.width + ROUTING_CLEARANCE.channel,
  ]);
  const yChannels = obstacles.flatMap((bounds) => [
    bounds.y - ROUTING_CLEARANCE.channel,
    bounds.y + bounds.height + ROUTING_CLEARANCE.channel,
  ]);
  const candidates = [
    [start, startExit, [endExit[0], startExit[1]], endExit, end],
    [start, startExit, [startExit[0], endExit[1]], endExit, end],
    ...xChannels.map((x) => [start, startExit, [x, startExit[1]], [x, endExit[1]], endExit, end]),
    ...yChannels.map((y) => [start, startExit, [startExit[0], y], [endExit[0], y], endExit, end]),
  ].map(compactPath);
  const score = (path) => {
    let collisions = 0;
    let length = 0;
    let shared = 0;
    let crossings = 0;
    for (let index = 0; index < path.length - 1; index += 1) {
      const segmentStart = path[index];
      const segmentEnd = path[index + 1];
      length += Math.abs(segmentEnd[0] - segmentStart[0]) + Math.abs(segmentEnd[1] - segmentStart[1]);
      collisions += obstacles.filter((bounds) => segmentHitsBounds(segmentStart, segmentEnd, bounds)).length;
      for (const route of scene.routes) {
        for (let routeIndex = 0; routeIndex < route.length - 1; routeIndex += 1) {
          shared += sharedSegmentLength(segmentStart, segmentEnd, route[routeIndex], route[routeIndex + 1]);
          if (segmentsCross(segmentStart, segmentEnd, route[routeIndex], route[routeIndex + 1])) crossings += 1;
        }
      }
    }
    return collisions * 1_000_000 + crossings * 10_000 + shared * 3 + length + path.length * 8;
  };
  const selected = candidates
    .map((path) => ({ path, score: score(path) }))
    .sort((left, right) => left.score - right.score)[0].path;
  scene.routes.push(selected);
  return selected;
}
import { ROUTING_CLEARANCE } from "./clearances.js";
