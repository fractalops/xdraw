import type {
  AlignmentMode,
  DiagnosticNode,
  EmbeddedAssetFiles,
  Point,
  ResolvedAsset,
  SourceSpan,
  SpacingPreset,
} from "./foundation-contracts.ts";

export type StatementAttributes = Record<string, unknown>;

export interface ExpansionMetadata {
  component: string;
  useSite: string;
  source: SourceSpan | null;
}

export interface StatementMetadata extends DiagnosticNode {
  id?: string;
  at?: Point;
  size?: Point;
  statements?: SemanticStatement[];
  semanticId?: string;
  origin?: SourceSpan | null;
  expansion?: ExpansionMetadata;
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
  type: "alignment" | "distribution" | "offset" | "match-size" | "rotation" | "snap";
  ids: string[];
  mode?: string;
  axis?: string;
  by?: Point;
  degrees?: number;
  grid?: number;
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

export type RenderableGeometryStatement =
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

export interface ComponentStatement extends NestedStatement {
  type: "component";
  id: string;
  parameters: string[];
}

export interface ComponentUseStatement extends StatementMetadata {
  type: "use";
  id: string;
  component: string;
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
  at: Point;
  points: Point[];
  pressures: number[];
  simulatePressure: unknown;
  attributes: StatementAttributes;
}

export interface RenderableFreedrawStatement extends Omit<FreedrawStatement, "simulatePressure"> {
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
  tone?: string;
  attributes: StatementAttributes;
  at?: Point;
  size?: Point;
}

export interface TextStatement extends StatementMetadata {
  type: "text";
  id: string;
  value: string;
  at: Point;
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
  type: "lane" | "group" | "frame";
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
  | ConnectionStatement
  | ComponentStatement
  | ComponentUseStatement
  | PropertyStatement
  | StyleStatement
  | ThemeStatement
  | AssetDeclaration
  | AssetUseStatement
  | ParticipantStatement
  | SequenceStatement
  | NoteStatement
  | CodeStatement
  | FreedrawStatement
  | BodyStatement
  | NodeStatement
  | TextStatement
  | LayoutTextStatement
  | ContainerStatement
  | TreeStatement
  | DecisionBranchStatement;

export interface DiagramDocument extends StatementMetadata {
  type: "diagram";
  title: string;
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

export interface SemanticDocument extends DiagnosticNode {
  type: "semantic-document";
  title: string;
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
