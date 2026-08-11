export type Point = [number, number];

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Axis = "x" | "y";
export type AlignmentMode = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";
export type SpacingPreset = "tight" | "normal" | "airy";

export interface SourceLocation {
  line: number;
  column: number;
  file?: string;
}

export interface SourceSpan {
  start?: SourceLocation;
  end?: SourceLocation;
}

export interface DiagnosticNode {
  span?: SourceSpan;
  start?: SourceLocation;
  sourceFile?: string;
  file?: string;
}

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  location: SourceLocation | null;
}

export interface DiagnosticCollector {
  diagnostics: Diagnostic[];
  error(code: string, message: string, node?: DiagnosticNode): Diagnostic;
  warn(code: string, message: string, node?: DiagnosticNode): Diagnostic;
}

export interface Segment {
  start: Point;
  end: Point;
}

export type Route = Point[];

export type LayoutCapability =
  | "nestedNodes"
  | "explicitPorts"
  | "crossContainerEdges"
  | "fixedPositions"
  | "fixedDimensions"
  | "edgeRouting"
  | "selfEdges"
  | "multiEdges"
  | "labels"
  | "disconnectedComponents";

export type LayoutCapabilities = Readonly<Record<LayoutCapability, boolean>>;
export type EndpointSide = "left" | "right" | "top" | "bottom" | "center";

export interface Endpoint {
  id: string;
  side?: EndpointSide;
}

export interface SemanticStatement {
  type: string;
  id?: string;
  semanticId?: string;
  title?: string;
  label?: string;
  at?: Point;
  size?: Point;
  nodes?: string[];
  statements?: SemanticStatement[];
  [property: string]: unknown;
}

export interface ConnectionStatement extends SemanticStatement {
  type: "connection";
  nodes: string[];
}

export interface SemanticDocument {
  type?: string;
  title?: string;
  statements: SemanticStatement[];
  objects: Map<string, SemanticDocument | SemanticStatement>;
  origins: Map<string, SourceSpan | null>;
  origin?: SourceSpan | null;
}

export interface AdapterRoute {
  connectionIndex: number;
  segmentIndex?: number;
  points: Point[];
}

export interface LayoutOptions {
  columnGap?: number;
  columns?: number;
  contentWidth: number;
  gap: number;
  kind?: string;
  startY: number;
  x?: number;
}

export interface LayoutContext {
  state: SceneGraph;
  registerBounds?(graph: SceneGraph, id: string, bounds: Bounds): unknown;
  [property: string]: unknown;
}

export interface LayoutRequest {
  context: LayoutContext;
  sections: readonly SemanticStatement[];
  options: Readonly<LayoutOptions>;
  required: readonly LayoutCapability[];
}

export type LayoutResponse = number | {
  bottom: number;
  routes?: AdapterRoute[];
};

export interface LayoutAdapterDefinition {
  name: string;
  capabilities: LayoutCapabilities;
  layoutDocument(request: Readonly<LayoutRequest>): LayoutResponse;
}

export interface LayoutAdapter extends Readonly<LayoutAdapterDefinition> {}

export interface SceneVisualBase {
  id: string;
  source?: string;
  frameId?: string | null;
  locked?: boolean;
  origin?: SourceSpan | null;
  style?: Record<string, unknown>;
}

export interface ContainerVisual extends SceneVisualBase {
  type: "container" | "frame";
  bounds: Bounds;
  title: string;
  tone?: string;
}

export interface NodeVisual extends SceneVisualBase {
  type: "node";
  node: SemanticStatement & { id: string };
  bounds: Bounds;
}

export interface ArrowVisual extends SceneVisualBase {
  type: "arrow";
  start: Point;
  end: Point;
  options?: Record<string, unknown>;
}

export interface TextVisual extends SceneVisualBase {
  type: "text";
  position: Point;
  value: string;
  options?: Record<string, unknown>;
}

export type SceneVisual = ContainerVisual | NodeVisual | ArrowVisual | TextVisual;

export interface SceneObjectRecord {
  id: string;
  semantic: unknown;
  origin: SourceSpan | null;
  bounds: Bounds | null;
  generated: boolean;
}

export interface Measurer {
  measureNode(node: SemanticStatement, width: number): number;
  measureContainer(node: SemanticStatement, width: number, y?: number): number;
  measureSection(node: SemanticStatement, width: number, y?: number): number;
  measureSequence(node: SemanticStatement, width: number): number;
  measureTree(node: SemanticStatement, width: number): number;
}

export interface StyleResolver {
  diagnostics?: DiagnosticCollector;
  resolveNode(node: SemanticStatement): Record<string, unknown>;
}

export interface SceneGraphOptions {
  diagramWidth: number;
  contentWidth: number;
  annotationGutterWidth: number;
  measurer: Measurer;
  styles?: StyleResolver;
  diagnostics?: DiagnosticCollector;
}

export interface SceneGraph {
  document: SemanticDocument;
  measurer: Measurer;
  styles?: StyleResolver;
  capabilities: LayoutCapabilities;
  objects: Map<string, SceneObjectRecord>;
  origins: Map<string, SourceSpan | null>;
  bounds: Map<string, Bounds>;
  nodeIds: Set<string>;
  containers: string[];
  routes: Route[];
  adapterRoutes: Map<string, Point[]>;
  connections: SemanticStatement[];
  annotations: SemanticStatement[];
  diagnostics?: DiagnosticCollector;
  labelBounds: Bounds[];
  visuals: SceneVisual[];
  sequenceCount: number;
  frameMembership: Map<string, string>;
  containerMembership: Map<string, string>;
  frameLocks: Map<string, boolean>;
  canvas: { left: number; right: number; top: number };
  annotationGutter: { x: number; width: number } | null;
  registerGenerated(id: string, semantic: unknown, origin?: SourceSpan | null): SceneObjectRecord;
  place(id: string, bounds: Bounds, semantic?: unknown): SceneObjectRecord;
  addVisual(visual: SceneVisual): void;
}

export interface LayoutResult {
  bottom: number;
  required: readonly LayoutCapability[];
  placements: Map<string, Bounds>;
  visuals: SceneVisual[];
}
