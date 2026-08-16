export type Point = [number, number];
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
export type AlignmentMode = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";
export type SpacingPreset = "tight" | "normal" | "airy";

export interface SourceLocation {
  offset?: number;
  line: number;
  column: number;
  file?: string;
}

export type TokenType =
  | "{" | "}" | "(" | ")" | ":" | "," | ";" | "@" | "$"
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

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  location: SourceLocation | null;
}

export interface DiagnosticCollector {
  diagnostics: Diagnostic[];
  error(code: string, message: string, node?: DiagnosticNode | null): Diagnostic;
  warn(code: string, message: string, node?: DiagnosticNode | null): Diagnostic;
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
