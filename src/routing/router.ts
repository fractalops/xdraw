import { anchor } from "../geometry.ts";
import { ROUTING_CLEARANCE } from "./clearances.ts";
import type {
  Bounds,
  EndpointSide,
  Point,
  Route,
} from "../contracts/foundation.ts";


export interface RoutingContext {
  fromContainerBounds?: Bounds;
  toContainerBounds?: Bounds;
}

export type CardinalSide = Exclude<EndpointSide, "center">;

export interface InferredSides {
  startSide: CardinalSide;
  endSide: CardinalSide;
}

export interface RouteOptions {
  around?: string;
  avoidEndpointInteriors?: boolean;
}

export interface RoutingScene {
  bounds: ReadonlyMap<string, Bounds>;
  nodeIds: ReadonlySet<string>;
  containers: readonly string[];
  routes: Route[];
  labelBounds?: readonly Bounds[];
}

export function inferredSides(
  fromBounds: Bounds,
  toBounds: Bounds,
  context: RoutingContext = {},
): InferredSides {
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

function offsetPoint(point: Point, side: EndpointSide, distance = ROUTING_CLEARANCE.endpoint): Point {
  const offsets: Record<EndpointSide, Point> = {
    left: [-distance, 0],
    right: [distance, 0],
    top: [0, -distance],
    bottom: [0, distance],
    center: [0, 0],
  };
  const [dx, dy] = offsets[side];
  return [point[0] + dx, point[1] + dy];
}

function point(x: number, y: number): Point {
  return [x, y];
}

function followsDirection(
  actualStart: Point,
  actualEnd: Point,
  expectedStart: Point,
  expectedEnd: Point,
): boolean {
  return (actualEnd[0] - actualStart[0]) * (expectedEnd[0] - expectedStart[0])
    + (actualEnd[1] - actualStart[1]) * (expectedEnd[1] - expectedStart[1]) > 0;
}

function samePoint(actual: Point, expected: Point): boolean {
  return actual[0] === expected[0] && actual[1] === expected[1];
}

function isSegment(
  actualStart: Point,
  actualEnd: Point,
  expectedStart: Point,
  expectedEnd: Point,
): boolean {
  return samePoint(actualStart, expectedStart) && samePoint(actualEnd, expectedEnd);
}

function endpointInteriorCollisions(
  segmentStart: Point,
  segmentEnd: Point,
  index: number,
  pathLength: number,
  fromBounds: Bounds,
  toBounds: Bounds,
  start: Point,
  startExit: Point,
  endExit: Point,
  end: Point,
): number {
  const leavesSource = index === 0
    && samePoint(segmentStart, start)
    && followsDirection(segmentStart, segmentEnd, start, startExit);
  const entersTarget = index === pathLength - 2
    && samePoint(segmentEnd, end)
    && followsDirection(segmentStart, segmentEnd, endExit, end);
  return Number(!leavesSource && segmentHitsBounds(segmentStart, segmentEnd, fromBounds))
    + Number(!entersTarget && segmentHitsBounds(segmentStart, segmentEnd, toBounds));
}

function compactPath(points: readonly Point[]): Route {
  const compacted = points.filter((point, index) => {
    if (index && point[0] === points[index - 1][0] && point[1] === points[index - 1][1]) return false;
    if (!index || index === points.length - 1) return true;
    const previous = points[index - 1];
    const next = points[index + 1];
    return !((previous[0] === point[0] && point[0] === next[0]) || (previous[1] === point[1] && point[1] === next[1]));
  });
  const first = compacted[0] ?? points[0];
  const second = compacted[1] ?? points.at(-1) ?? first;
  if (!first || !second) throw new Error("route requires at least two points");
  return [first, second, ...compacted.slice(2)];
}

function segmentHitsBounds(
  start: Point,
  end: Point,
  bounds: Bounds,
  margin = ROUTING_CLEARANCE.obstacle,
): boolean {
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

function containsBounds(container: Bounds, bounds: Bounds): boolean {
  return bounds.x >= container.x && bounds.y >= container.y
    && bounds.x + bounds.width <= container.x + container.width
    && bounds.y + bounds.height <= container.y + container.height;
}

function sharedSegmentLength(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
): number {
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

function segmentsCross(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
): boolean {
  const cross = (first: Point, second: Point, third: Point): number => (
    (second[0] - first[0]) * (third[1] - first[1])
      - (second[1] - first[1]) * (third[0] - first[0])
  );
  const first = cross(firstStart, firstEnd, secondStart);
  const second = cross(firstStart, firstEnd, secondEnd);
  const third = cross(secondStart, secondEnd, firstStart);
  const fourth = cross(secondStart, secondEnd, firstEnd);
  return first * second < 0 && third * fourth < 0;
}

function existingBounds(scene: RoutingScene, ids: Iterable<string>): Bounds[] {
  const result: Bounds[] = [];
  for (const id of ids) {
    const bounds = scene.bounds.get(id);
    if (bounds) result.push(bounds);
  }
  return result;
}

export function routeConnection(
  scene: RoutingScene,
  fromId: string,
  toId: string,
  fromBounds: Bounds,
  toBounds: Bounds,
  startSide: EndpointSide,
  endSide: EndpointSide,
  options: RouteOptions = {},
): Route {
  const start = anchor[startSide](fromBounds);
  const end = anchor[endSide](toBounds);
  const startExit = offsetPoint(start, startSide);
  const endExit = offsetPoint(end, endSide);
  const obstacleIds = [...scene.nodeIds].filter((id) => id !== fromId && id !== toId);
  const obstacles = existingBounds(scene, obstacleIds);
  const unrelatedContainers = existingBounds(scene, scene.containers)
    .filter((bounds) => !containsBounds(bounds, fromBounds) && !containsBounds(bounds, toBounds));
  obstacles.push(...unrelatedContainers);
  obstacles.push(...(scene.labelBounds ?? []));
  if (options.around) {
    const required = scene.bounds.get(options.around);
    if (!required) throw new Error(`route constraint references unknown node: ${options.around}`);
    if (!obstacles.includes(required)) obstacles.push(required);
  }
  const channelBounds = options.avoidEndpointInteriors
    ? [...obstacles, fromBounds, toBounds]
    : obstacles;
  const xChannels = channelBounds.flatMap((bounds) => [
    bounds.x - ROUTING_CLEARANCE.channel,
    bounds.x + bounds.width + ROUTING_CLEARANCE.channel,
  ]);
  const yChannels = channelBounds.flatMap((bounds) => [
    bounds.y - ROUTING_CLEARANCE.channel,
    bounds.y + bounds.height + ROUTING_CLEARANCE.channel,
  ]);
  const candidates: Route[] = [
    [start, startExit, point(endExit[0], startExit[1]), endExit, end],
    [start, startExit, point(startExit[0], endExit[1]), endExit, end],
    ...xChannels.map((x): Route => [start, startExit, point(x, startExit[1]), point(x, endExit[1]), endExit, end]),
    ...yChannels.map((y): Route => [start, startExit, point(startExit[0], y), point(endExit[0], y), endExit, end]),
  ].map(compactPath);
  const score = (path: Route): number => {
    let collisions = 0;
    let length = 0;
    let shared = 0;
    let crossings = 0;
    for (let index = 0; index < path.length - 1; index += 1) {
      const segmentStart = path[index];
      const segmentEnd = path[index + 1];
      length += Math.abs(segmentEnd[0] - segmentStart[0]) + Math.abs(segmentEnd[1] - segmentStart[1]);
      collisions += obstacles.filter((bounds) => segmentHitsBounds(segmentStart, segmentEnd, bounds)).length;
      const sourceExitStub = isSegment(segmentStart, segmentEnd, start, startExit);
      const targetEntryStub = isSegment(segmentStart, segmentEnd, endExit, end);
      if (options.avoidEndpointInteriors) {
        // Compaction may merge an exit stub into the first segment, or an entry
        // stub into the last. A segment that travels outward from its endpoint
        // border does not cross that endpoint's interior.
        collisions += endpointInteriorCollisions(
          segmentStart,
          segmentEnd,
          index,
          path.length,
          fromBounds,
          toBounds,
          start,
          startExit,
          endExit,
          end,
        );
      }
      for (const route of scene.routes) {
        for (let routeIndex = 0; routeIndex < route.length - 1; routeIndex += 1) {
          if (!options.avoidEndpointInteriors || (!sourceExitStub && !targetEntryStub)) {
            shared += sharedSegmentLength(segmentStart, segmentEnd, route[routeIndex], route[routeIndex + 1]);
          }
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
