import type { Point, SourceSpan } from "./foundation-contracts.ts";

export type SourceScalar = string | number | boolean;

export interface SourceEndpoint {
  reference: string;
  anchor?: string;
}

export type SourcePropertyValue =
  | SourceScalar
  | Point
  | Point[]
  | number[]
  | SourceEndpoint;

export interface SourceNode {
  span?: SourceSpan;
}

export interface SourceProperty extends SourceNode {
  type: "property";
  name: string;
  value: SourcePropertyValue;
}

export interface SourceSubtitle extends SourceNode {
  type: "subtitle";
  value: string;
}

export interface SourceArrangement extends SourceNode {
  type: "arrangement";
  kind: string;
  properties: SourceProperty[];
}

export interface SourceGeometryStatement extends SourceNode {
  type: "alignment" | "distribution" | "offset" | "match-size" | "rotation" | "snap";
  references: string[];
  mode?: string;
  axis?: string;
  by?: Point;
  degrees?: number;
  grid?: number;
}

export interface SourceConnection extends SourceNode {
  type: "connection";
  id?: string;
  operator: "->" | "--";
  endpoints: SourceEndpoint[];
  label?: string;
  properties: SourceProperty[];
}

export interface SourceDeclaration extends SourceNode {
  type: "declaration";
  id: string;
  constructor: string;
  arguments: SourcePropertyValue[];
  statements: SourceStatement[];
}

export type SourceStatement =
  | SourceProperty
  | SourceSubtitle
  | SourceArrangement
  | SourceGeometryStatement
  | SourceConnection
  | SourceDeclaration;

export interface SourceImport extends SourceNode {
  type: "import";
  source: string;
  alias: string;
}

export interface SourceDiagram extends SourceNode {
  type: "diagram";
  title: string;
  statements: SourceStatement[];
}

export interface SourceDocument {
  type: "source-document";
  imports: SourceImport[];
  diagram: SourceDiagram;
  source: string;
  comments: readonly unknown[];
}
