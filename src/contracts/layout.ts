import type {
  Bounds,
  DiagnosticCollector,
  Point,
  Route,
  SourceSpan,
  StyleFillStyle,
  StyleStrokeStyle,
} from "./foundation.ts";
import type { ImageCrop, LinearElementOptions, TextElementOptions } from "./render.ts";
import type { RichNodePlan } from "./rich-node.ts";
import type {
  CoordinatePlaneConfiguration,
  CodeStatement,
  ConnectionStatement,
  ContainerStatement,
  FreedrawStatement,
  LayoutTextStatement,
  NodeStatement,
  NoteStatement,
  RenderableCodeStatement,
  RenderableFreedrawStatement,
  RootTreeStatement,
  SemanticDocument,
  SemanticStatement,
  SequenceStatement,
  StatementAttributes,
  TextStyleStatement,
  TreeStatement,
} from "./semantic.ts";
import type { FontFamily } from "../text/metrics.ts";

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

export interface AdapterRoute {
  connectionIndex: number;
  segmentIndex?: number;
  points: Route;
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
  preparedLayeredBounds?: ReadonlyMap<string, Bounds>;
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
  layoutDocument(this: void, request: Readonly<LayoutRequest>): LayoutResponse;
}

export type LayoutAdapter = Readonly<LayoutAdapterDefinition>;

/** A required gap between two layout groups along one axis. */
export interface LayoutFlow {
  axis: "x" | "y";
  before: string[];
  after: string[];
  gap: number;
}

/** An affine transform the Excalidraw adapter applies while emitting one visual. */
export interface SceneTransform {
  from: Bounds;
  to: Bounds;
  angle: number;
}

/** A final element-array ordering operation, applied after every visual exists. */
export interface SceneLayerOperation {
  ids: string[];
  mode: "front" | "back";
}

export interface SceneVisualBase {
  id: string;
  source?: string;
  frameId?: string | null;
  locked?: boolean;
  origin?: SourceSpan | null;
  transform?: SceneTransform;
}

export interface ContainerVisual extends SceneVisualBase {
  type: "container";
  bounds: Bounds;
  title: string;
  kind?: string;
  tone?: string;
}

export interface FrameVisual extends SceneVisualBase {
  type: "frame";
  bounds: Bounds;
  title: string;
  kind?: string;
  tone?: string;
}

export interface NodeVisual extends SceneVisualBase {
  type: "node";
  node: NodeStatement;
  bounds: Bounds;
  style: ResolvedNodeStyle;
  richPlan: RichNodePlan | null;
}

export type NodeVisualInput = Omit<NodeVisual, "style" | "richPlan"> & {
  style?: ResolvedNodeStyle;
  richPlan?: RichNodePlan | null;
};

export interface ArrowVisual extends SceneVisualBase {
  type: "arrow";
  start: Point;
  end: Point;
  options?: Omit<LinearElementOptions, "type" | "frameId"> & { type?: "arrow" };
}

export interface TextVisual extends SceneVisualBase {
  type: "text";
  position: Point;
  value: string;
  options?: Omit<TextElementOptions, "frameId">;
}

export interface ImageVisual extends SceneVisualBase {
  type: "image";
  bounds: Bounds;
  fileId: string;
  crop: ImageCrop | null;
  description?: string;
}

export interface CodeVisual extends SceneVisualBase {
  type: "code";
  block: RenderableCodeStatement;
  bounds: Bounds;
}

export interface FreedrawVisual extends SceneVisualBase {
  type: "freedraw";
  statement: RenderableFreedrawStatement;
  bounds: Bounds;
  style: ResolvedFreedrawStyle;
}

export type FreedrawVisualInput = Omit<FreedrawVisual, "style"> & { style?: ResolvedFreedrawStyle };

export type SceneVisual = ContainerVisual | FrameVisual | NodeVisual | ArrowVisual | TextVisual | ImageVisual | CodeVisual | FreedrawVisual;
export type SceneVisualInput = Exclude<SceneVisual, NodeVisual | FreedrawVisual> | NodeVisualInput | FreedrawVisualInput;

export interface SceneObjectRecord {
  id: string;
  semantic: unknown;
  origin: SourceSpan | null;
  bounds: Bounds | null;
  generated: boolean;
}

export interface NodeMeasurementTarget extends NodeStyleTarget {
  id?: string;
  size?: Point;
  formulaScale?: number;
  statements?: readonly SemanticStatement[];
  plane?: CoordinatePlaneConfiguration;
}

export type LayoutSectionStatement = CodeStatement | ContainerStatement | SequenceStatement | RootTreeStatement;
export type ArrangedStatement = NodeStatement | LayoutTextStatement | LayoutSectionStatement;

export interface Measurer {
  planRichNode(node: NodeMeasurementTarget, width: number, style?: ResolvedNodeStyle): RichNodePlan | null;
  measureNode(node: NodeMeasurementTarget, width: number): number;
  measureAnnotation(node: NoteStatement, width: number): number;
  measureLayoutText(node: LayoutTextStatement, width: number): number;
  measureArrangedItem(node: ArrangedStatement, width: number, y: number): number;
  measureCodeBlock(node: RenderableCodeStatement): number;
  measureContainer(node: ContainerStatement, width: number, y?: number): number;
  measureSection(node: LayoutSectionStatement, width: number, y?: number): number;
  measureSequence(node: SequenceStatement, width: number): number;
  measureTree(node: TreeStatement, width: number): number;
}

export interface StyleProperties {
  strokeColor?: string;
  backgroundColor?: string;
  textColor?: string;
  strokeWidth?: number;
  strokeStyle?: StyleStrokeStyle;
  fillStyle?: StyleFillStyle;
  roughness?: number;
  opacity?: number;
  fontFamily?: FontFamily;
  fontSize?: number;
  titleSize?: number;
  bodySize?: number;
  lineHeight?: number;
  padding?: number;
  link?: string;
  locked?: boolean;
  autoSize?: boolean;
  wrapWidth?: number;
}

export interface ResolvedNodeStyle {
  strokeColor: string;
  backgroundColor: string;
  textColor: string;
  strokeWidth: number;
  strokeStyle: StyleStrokeStyle;
  fillStyle?: StyleFillStyle;
  roughness?: number;
  opacity?: number;
  fontFamily: FontFamily;
  titleSize: number;
  bodySize: number;
  lineHeight: number;
  titleLineHeight: number;
  padding: number;
  link: string | null;
  locked: boolean;
}

export interface ResolvedTextStyle {
  fontFamily: FontFamily;
  fontSize: number;
  lineHeight: number;
  textColor: string;
  autoSize: boolean;
  wrapWidth?: number;
  link: string | null;
  locked: boolean;
}

export interface ResolvedFreedrawStyle {
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  strokeStyle: StyleStrokeStyle;
  fillStyle: StyleFillStyle;
  roughness: number;
  opacity: number;
  link: string | null;
  locked: boolean;
}

export interface NodeStyleTarget {
  kind: string;
  title: string;
  tone?: string;
  styleDefaults?: StatementAttributes;
  attributes?: StatementAttributes;
}

export interface StyleResolver {
  diagnostics?: DiagnosticCollector;
  resolveFreedraw(statement: FreedrawStatement): ResolvedFreedrawStyle;
  resolveNode(node: NodeStyleTarget): ResolvedNodeStyle;
  resolveText(node: TextStyleStatement): ResolvedTextStyle;
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
  adapterRoutes: Map<string, Route>;
  connections: ConnectionStatement[];
  annotations: NoteStatement[];
  diagnostics?: DiagnosticCollector;
  labelBounds: Bounds[];
  /**
   * Absolute points of every drawn stroke, so a connector can meet a plotted
   * shape on the line it actually draws rather than on its bounding box.
   */
  strokePoints: Map<string, readonly Point[]>;
  visuals: SceneVisual[];
  frameMembership: Map<string, string>;
  containerMembership: Map<string, string>;
  layoutFlows: LayoutFlow[];
  frameLocks: Map<string, boolean>;
  canvas: { left: number; right: number; top: number };
  annotationGutter: { x: number; width: number } | null;
  registerGenerated(id: string, semantic: unknown, origin?: SourceSpan | null): SceneObjectRecord;
  place(id: string, bounds: Bounds, semantic?: unknown): SceneObjectRecord;
  addVisual(visual: SceneVisualInput): void;
}

export interface LayoutResult {
  bottom: number;
  required: readonly LayoutCapability[];
  placements: Map<string, Bounds>;
  visuals: SceneVisual[];
}
