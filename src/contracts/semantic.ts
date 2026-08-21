import type {
  AlignmentMode,
  AttachmentAnchor,
  DiagnosticNode,
  DeferredPoint,
  EmbeddedAssetFiles,
  GeometryStatementKind,
  Point,
  ResolvedAsset,
  SourceSpan,
  SpacingPreset,
} from "./foundation.ts";

export type StatementAttributes = Record<string, unknown>;

export interface ExpansionMetadata {
  template: string;
  useSite: string;
  source: SourceSpan | null;
}

export interface StatementMetadata extends DiagnosticNode {
  id?: string;
  at?: DeferredPoint;
  size?: Point;
  statements?: SemanticStatement[];
  semanticId?: string;
  origin?: SourceSpan | null;
  expansion?: ExpansionMetadata;
  styleDefaults?: StatementAttributes;
}

export interface NestedStatement extends StatementMetadata {
  statements: SemanticStatement[];
}

export interface SubtitleStatement extends StatementMetadata {
  type: "subtitle";
  value: string;
}

export interface LayoutStatement extends StatementMetadata {
  type: "layout";
  kind: string;
  gap?: number;
  columns?: number;
  spacing?: SpacingPreset;
  width?: number;
  ownsChildren?: boolean;
}

export interface GeometryStatement extends StatementMetadata {
  type: GeometryStatementKind;
  ids: string[];
  mode?: string;
  axis?: string;
  by?: Point;
  degrees?: number;
  grid?: number;
}

export interface AttachmentStatement extends StatementMetadata {
  type: "attachment";
  moving: string;
  anchor: AttachmentAnchor;
  target: string;
}

interface RenderableGeometryStatementBase extends StatementMetadata {
  ids: string[];
}

export interface AlignmentStatement extends RenderableGeometryStatementBase {
  type: "alignment";
  mode: AlignmentMode;
}

export interface DistributionStatement extends RenderableGeometryStatementBase {
  type: "distribution";
  axis: "x" | "y";
}

export interface OffsetStatement extends RenderableGeometryStatementBase {
  type: "offset";
  by: Point;
}

export interface MatchSizeStatement extends RenderableGeometryStatementBase {
  type: "match-size";
  axis: "width" | "height" | "both";
}

export interface RotationStatement extends RenderableGeometryStatementBase {
  type: "rotation";
  degrees: number;
}

export interface SnapStatement extends RenderableGeometryStatementBase {
  type: "snap";
  grid: number;
}

export interface LayerStatement extends RenderableGeometryStatementBase {
  type: "layer";
  mode: "front" | "back";
}

export type RenderableGeometryStatement =
  | LayerStatement
  | AlignmentStatement
  | DistributionStatement
  | OffsetStatement
  | MatchSizeStatement
  | RotationStatement
  | SnapStatement;

export interface ConnectionStatement extends StatementMetadata {
  type: "connection";
  id?: string;
  nodes: string[];
  label?: string;
  attributes: StatementAttributes;
  generatedRoute?: boolean;
  locked?: boolean;
}

export interface TemplateStatement extends NestedStatement {
  type: "template";
  id: string;
  parameters: string[];
}

export interface TemplateUseStatement extends StatementMetadata {
  type: "use";
  id: string;
  template: string;
  arguments: Record<string, unknown>;
}

export interface PropertyStatement extends StatementMetadata {
  type: "property";
  key: string;
  value: unknown;
}

export interface StyleStatement extends NestedStatement {
  type: "style";
  id: string;
  statements: PropertyStatement[];
}

export interface ThemeStatement extends NestedStatement {
  type: "theme";
  statements: PropertyStatement[];
}

export interface AssetDeclaration extends StatementMetadata {
  type: "asset";
  id: string;
  source: string;
  attributes: StatementAttributes;
}

export interface AssetUseStatement extends StatementMetadata {
  type: "image" | "icon";
  id: string;
  asset: string;
  at: Point;
  size: Point;
  attributes: StatementAttributes;
  resolvedAsset?: ResolvedAsset;
}

export interface ParticipantStatement extends StatementMetadata {
  type: "participant";
  id: string;
  title: string;
}

export interface SequenceStatement extends NestedStatement {
  type: "sequence";
  id: string;
}

export interface TableRowStatement extends StatementMetadata {
  type: "table-header" | "table-row";
  cells: string[];
}

export interface NoteStatement extends StatementMetadata {
  type: "note" | "callout";
  id: string;
  title: string;
  target?: string;
  at?: Point;
  width?: number;
  locked?: boolean;
  frameId?: string | null;
}

export interface CodeStatement extends StatementMetadata {
  type: "code";
  id: string;
  value: string;
  language?: string;
  title?: string;
  lineNumbers: unknown;
  highlight: unknown;
}

export interface RenderableCodeStatement extends Omit<CodeStatement, "lineNumbers" | "highlight"> {
  lineNumbers: boolean;
  highlight: boolean;
}

export interface FreedrawStatement extends StatementMetadata {
  type: "freedraw";
  id: string;
  at: DeferredPoint;
  points: Point[];
  pressures: number[];
  simulatePressure: unknown;
  attributes: StatementAttributes;
}

/**
 * A curve that has not been drawn yet. It carries the description rather than
 * the points, because sampling it needs values a template supplies later, and
 * a plot lowered eagerly could never see them.
 */
export interface PlotStatement extends StatementMetadata {
  type: "plot";
  id: string;
  /** Drawing-space origin for a standalone plot; omitted for a Cartesian series or the default origin. */
  at?: DeferredPoint;
  label?: string;
  /** The independent variable bound over the closed interval from..to. */
  variable: string;
  x: string;
  y: string;
  from?: number | string;
  to?: number | string;
  /** The zero set of this expression when the plot is implicit. */
  equation?: string;
  tolerance: number;
  attributes: StatementAttributes;
}

export interface CoordinatePlaneConfiguration {
  xDomain?: readonly [number | string, number | string];
  yDomain?: readonly [number | string, number | string];
  xLabel?: string;
  yLabel?: string;
  grid: boolean;
  crossZero: boolean;
  tickCount: number;
}

export interface RenderableFreedrawStatement extends Omit<FreedrawStatement, "simulatePressure"> {
  at: Point;
  simulatePressure: boolean;
}

export interface BodyStatement extends StatementMetadata {
  type: "body" | "text-align" | "vertical-align";
  value: unknown;
}

export interface NodeStatement extends NestedStatement {
  type: "node";
  id: string;
  kind: string;
  title: string;
  authoredSource?: string;
  tone?: string;
  attributes: StatementAttributes;
  at?: DeferredPoint;
  size?: Point;
  /** Natural formula display multiplier; meaningful only for formula nodes. */
  formulaScale?: number;
  plane?: CoordinatePlaneConfiguration;
}

export interface TextStatement extends StatementMetadata {
  type: "text";
  id: string;
  value: string;
  at: DeferredPoint;
  width?: number;
  align: string;
  fontSize?: number;
  attributes: StatementAttributes;
}

export interface LayoutTextStatement extends StatementMetadata {
  type: "layout-text";
  id: string;
  value: string;
  at?: Point;
  width?: number;
  align: string;
  fontSize?: number;
  attributes: StatementAttributes;
}

export type TextStyleStatement = TextStatement | LayoutTextStatement;

export interface ContainerStatement extends NestedStatement {
  type: "lane" | "group" | "frame" | "section";
  id: string;
  title: string;
  kind?: string;
  tone?: string;
  attributes: StatementAttributes;
}

export interface TreeStatement extends NestedStatement {
  type: "tree" | "branch" | "leaf";
  id: string;
  title: string;
  kind: string;
  tone?: string;
  section?: string;
  sectionId?: string;
  direction?: string;
  levelGap?: number;
  siblingGap?: number;
}

export type RootTreeStatement = TreeStatement & { type: "tree" };

export interface DecisionBranchStatement extends StatementMetadata {
  type: "decision-branch";
  target: string;
  label?: string;
}

export type SemanticStatement =
  | SubtitleStatement
  | LayoutStatement
  | GeometryStatement
  | AttachmentStatement
  | ConnectionStatement
  | TemplateStatement
  | TemplateUseStatement
  | PropertyStatement
  | StyleStatement
  | ThemeStatement
  | AssetDeclaration
  | AssetUseStatement
  | ParticipantStatement
  | SequenceStatement
  | TableRowStatement
  | NoteStatement
  | CodeStatement
  | FreedrawStatement
  | PlotStatement
  | BodyStatement
  | NodeStatement
  | TextStatement
  | LayoutTextStatement
  | ContainerStatement
  | TreeStatement
  | DecisionBranchStatement;

export interface DiagramDocument extends StatementMetadata {
  type: "diagram";
  /** Omitted for a patch addition block, which is not a standalone titled diagram. */
  title?: string;
  statements: SemanticStatement[];
  source?: string;
  comments?: readonly unknown[];
  tokens?: readonly unknown[];
  assetFiles?: EmbeddedAssetFiles;
}

export interface SemanticReference {
  source: string;
  target: string;
  endpoint: string;
  index: number;
  targetObject?: SemanticDocument | SemanticStatement;
}

declare const semanticDocumentStage: unique symbol;

export interface SemanticDocument extends DiagnosticNode {
  /** Nominal stage marker: semantic documents are produced by the compiler, not assembled as object literals. */
  readonly [semanticDocumentStage]: true;
  type: "semantic-document";
  title?: string;
  statements: SemanticStatement[];
  objects: Map<string, SemanticDocument | SemanticStatement>;
  origins: Map<string, SourceSpan | null>;
  references: SemanticReference[];
  origin?: SourceSpan | null;
  semanticId?: string;
  source?: string;
  comments?: readonly unknown[];
  tokens?: readonly unknown[];
  assetFiles?: EmbeddedAssetFiles;
  ast?: DiagramDocument;
}
