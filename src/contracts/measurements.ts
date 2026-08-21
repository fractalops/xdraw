import type { Bounds, Point, Route } from "./foundation.ts";
import type { RouteQuality } from "../routing/quality.ts";

export type MeasurementFormat = "text" | "json";

export interface ElementMeasurement {
  id: string;
  kind: string;
  bounds: Bounds;
  center: Point;
  container?: string;
  frame?: string;
  generated?: true;
  angle?: number;
}

export interface StrokeMeasurement {
  id: string;
  bounds: Bounds;
  start: Point;
  end: Point;
  length: number;
  points: number;
  closed: boolean;
}

export interface ConnectorMeasurement {
  id: string;
  from: string;
  to: string;
  route: Route;
  length: number;
  bends: number;
  obstacleIntersections: number;
}

export interface LabelMeasurement {
  id: string;
  connector: string;
  position: "middle" | "start" | "end";
  bounds: Bounds;
  text: string;
  lines: number;
  routeSegment: number;
  side: "above" | "below" | "left" | "right";
}

export interface ContainerMeasurement {
  id: string;
  bounds: Bounds;
  children: number;
  contentBounds?: Bounds;
  available: number;
  required: number;
  slack: number;
}

export interface TextMeasurement {
  id: string;
  bounds: Bounds;
  text: string;
  lines: number;
  fontSize: number;
}

export interface ConstraintMeasurement {
  type: string;
  elements: string[];
  values: Record<string, string | number | Point>;
  resolvedBounds: Record<string, Bounds>;
}

export interface AssetMeasurement {
  id: string;
  mimeType: string;
  bytes: number;
  uses: Array<{ id: string; bounds: Bounds }>;
}

export interface CompilationMeasurements {
  title: string;
  canvas: Bounds;
  counts: {
    semanticElements: number;
    renderedPrimitives: number;
    renderedByKind: Record<string, number>;
    diagnostics: Record<"error" | "warning" | "remark", number>;
  };
  elements: ElementMeasurement[];
  strokes: StrokeMeasurement[];
  connectors: ConnectorMeasurement[];
  labels: LabelMeasurement[];
  containers: ContainerMeasurement[];
  texts: TextMeasurement[];
  constraints: ConstraintMeasurement[];
  assets: AssetMeasurement[];
  routeQuality: RouteQuality;
}
