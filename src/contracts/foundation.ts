export type Point = [number, number];
/** A point carried honestly until layout/geometry can evaluate it. */
export type DeferredPoint = Point | string | [number | string, number | string];
export type StyleStrokeStyle = "solid" | "dashed" | "dotted";
export type StyleFillStyle = "solid" | "hachure" | "cross-hatch";

export interface FileSystem {
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
}

export type AssetMimeType = "image/gif" | "image/jpeg" | "image/png" | "image/svg+xml";

export interface AssetLimits {
  fileBytes: number;
  aggregateBytes: number;
  dimension: number;
}

export interface ResolvedAsset {
  fileId: string;
  mimeType: AssetMimeType;
  width: number;
  height: number;
  bytes: number;
}

export interface EmbeddedAssetFile {
  id: string;
  dataURL: string;
  mimeType: AssetMimeType;
  created: number;
  lastRetrieved: number;
}

export type EmbeddedAssetFiles = Record<string, EmbeddedAssetFile>;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Axis = "x" | "y";
export type CompassAnchor =
  | "center"
  | "north"
  | "north-east"
  | "east"
  | "south-east"
  | "south"
  | "south-west"
  | "west"
  | "north-west";
export type AttachmentAnchor = CompassAnchor | "origin";
export type AlignmentMode = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";
export type SpacingPreset = "tight" | "normal" | "airy";

/**
 * The precision-placement statements, applied after automatic layout.
 *
 * Both IR stages carry the same set, so this is the one place it is written.
 * The runtime companion is `GEOMETRY_STATEMENT_KINDS` in
 * `language/geometry-statements.ts`, which will not compile if the two drift.
 */
export type GeometryStatementKind =
  | "alignment"
  | "distribution"
  | "offset"
  | "match-size"
  | "rotation"
  | "snap"
  | "layer";

export interface SourceLocation {
  offset?: number;
  line: number;
  column: number;
  file?: string;
}

export type TokenType =
  | "{" | "}" | "(" | ")" | "[" | "]" | ":" | "," | ";" | "@" | "$" | "="
  | "arrow" | "line" | "namespace" | "comment" | "string" | "number" | "expression"
  | "identifier" | "eof";

export interface Token {
  type: TokenType;
  value: string | number | null;
  raw: string;
  offset: number;
  end: number;
  start: SourceLocation;
  finish: SourceLocation;
}

export type TokenList = Token[] & { readonly comments: Token[] };

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

/**
 * `remark` is informational and opt-in: a record of what the compiler decided,
 * rather than something wrong. Kept distinct from `warning` so a consumer can
 * filter it out, and so enabling remarks never changes what a warning means.
 */
export type DiagnosticSeverity = "error" | "warning" | "remark";

/**
 * The numbers a diagnostic may carry, as a closed vocabulary.
 *
 * Closed so that codes cannot each invent a synonym for the same quantity: a
 * value = the author asked for against the value the compiler used, and space
 * content = needs against the space it has. A new name is a deliberate addition
 * here rather than a local choice at one call site.
 */
/**
 * How a run of diagnostics is presented. Rendering is a consumer of the
 * diagnostic record rather than the compiler's job, so the record carries the
 * facts and this decides who is reading.
 */
export type DiagnosticFormat = "text" | "json";

export type DiagnosticMeasure = "requested" | "resolved" | "required" | "available";

/**
 * Machine-readable facts behind a diagnostic's prose.
 *
 * The message stays the human surface and is unaffected by these. They exist so
 * a consumer, a test asserting an invariant or a future fix applier, does not
 * have to parse an English sentence to recover numbers the compiler already had.
 */
export interface DiagnosticDetails {
  /** Element ids the diagnostic is about, in the order its message names them. */
  subjects?: readonly string[];
  /** The quantities behind the message. */
  measures?: Readonly<Partial<Record<DiagnosticMeasure, number>>>;
  /** Source a document can accept unchanged to clear the diagnostic. */
  suggestion?: string;
}

export interface Diagnostic extends DiagnosticDetails {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  location: SourceLocation | null;
}

export interface DiagnosticCollector {
  diagnostics: Diagnostic[];
  error(code: string, message: string, node?: DiagnosticNode | null, details?: DiagnosticDetails): Diagnostic;
  warn(code: string, message: string, node?: DiagnosticNode | null, details?: DiagnosticDetails): Diagnostic;
  remark(code: string, message: string, node?: DiagnosticNode | null, details?: DiagnosticDetails): Diagnostic;
}

export interface Segment {
  start: Point;
  end: Point;
}

export type Route = [Point, Point, ...Point[]];
export type EndpointSide = "left" | "right" | "top" | "bottom" | "center";

export interface Endpoint {
  id: string;
  side?: EndpointSide;
}
