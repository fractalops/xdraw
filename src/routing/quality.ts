import type {
  Bounds,
  Point,
  Route,
  Segment,
} from "../contracts/foundation.ts";

type Orientation = "vertical" | "horizontal" | "diagonal";

export interface RouteQuality {
  crossings: number;
  obstacleIntersections: number;
  bends: number;
  sharedSegmentLength: number;
}

function segments(route: Route): Segment[] {
  return route.slice(0, -1).map((start, index) => ({ start, end: route[index + 1] }));
}

function orientation(segment: Segment): Orientation {
  if (segment.start[0] === segment.end[0]) return "vertical";
  if (segment.start[1] === segment.end[1]) return "horizontal";
  return "diagonal";
}

function cross(first: Point, second: Point, third: Point): number {
  return (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0]);
}

function crosses(left: Segment, right: Segment): boolean {
  const first = cross(left.start, left.end, right.start);
  const second = cross(left.start, left.end, right.end);
  const third = cross(right.start, right.end, left.start);
  const fourth = cross(right.start, right.end, left.end);
  return first * second < 0 && third * fourth < 0;
}

function sharedLength(left: Segment, right: Segment): number {
  const kind = orientation(left);
  if (kind !== orientation(right) || kind === "diagonal") return 0;
  if (kind === "vertical" && left.start[0] !== right.start[0]) return 0;
  if (kind === "horizontal" && left.start[1] !== right.start[1]) return 0;
  const axis = kind === "vertical" ? 1 : 0;
  return Math.max(0, Math.min(Math.max(left.start[axis], left.end[axis]), Math.max(right.start[axis], right.end[axis]))
    - Math.max(Math.min(left.start[axis], left.end[axis]), Math.min(right.start[axis], right.end[axis])));
}

function intersectsBounds(segment: Segment, bounds: Bounds): boolean {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  const kind = orientation(segment);
  if (kind === "vertical") {
    return segment.start[0] > left && segment.start[0] < right
      && Math.max(segment.start[1], segment.end[1]) > top
      && Math.min(segment.start[1], segment.end[1]) < bottom;
  }
  if (kind === "horizontal") {
    return segment.start[1] > top && segment.start[1] < bottom
      && Math.max(segment.start[0], segment.end[0]) > left
      && Math.min(segment.start[0], segment.end[0]) < right;
  }
  const inside = ([x, y]: Point): boolean => x > left && x < right && y > top && y < bottom;
  if (inside(segment.start) || inside(segment.end)) return true;
  const edges: Segment[] = [
    { start: [left, top], end: [right, top] },
    { start: [right, top], end: [right, bottom] },
    { start: [right, bottom], end: [left, bottom] },
    { start: [left, bottom], end: [left, top] },
  ];
  return edges.some((edge) => crosses(segment, edge));
}

function bendCount(route: Route): number {
  let count = 0;
  for (let index = 1; index < route.length - 1; index += 1) {
    if (cross(route[index - 1], route[index], route[index + 1]) !== 0) count += 1;
  }
  return count;
}

export function measureRouteQuality(routes: Route[], obstacles: Bounds[] = []): RouteQuality {
  const routeSegments = routes.map(segments);
  let crossings = 0;
  let obstacleIntersections = 0;
  let sharedSegmentLength = 0;
  for (let routeIndex = 0; routeIndex < routeSegments.length; routeIndex += 1) {
    for (const segment of routeSegments[routeIndex]) {
      obstacleIntersections += obstacles.filter((bounds) => intersectsBounds(segment, bounds)).length;
      for (let otherIndex = routeIndex + 1; otherIndex < routeSegments.length; otherIndex += 1) {
        for (const other of routeSegments[otherIndex]) {
          if (crosses(segment, other)) crossings += 1;
          sharedSegmentLength += sharedLength(segment, other);
        }
      }
    }
  }
  return {
    crossings,
    obstacleIntersections,
    bends: routes.reduce((sum, route) => sum + bendCount(route), 0),
    sharedSegmentLength,
  };
}
