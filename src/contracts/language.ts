import type { DeferredPoint, GeometryStatementKind, Point, SourceSpan } from "./foundation.ts";

export type SourceScalar = string | number | boolean;

export interface SourceEndpoint {
  reference: string;
  anchor?: string;
}

/** A source value is recursive; manifests, rather than the tokenizer, decide what a tuple means. */
export type SourcePropertyValue =
  | SourceScalar
  | DeferredPoint
  | SourceEndpoint
  | SourcePropertyValue[];

export type SourceValueKind =
  | "string"
  | "raw-string"
  | "identifier"
  | "number"
  | "boolean"
  | "parameter"
  | "tuple"
  | "endpoint" | "expression";

export interface SourceNode {
  span?: SourceSpan;
}

export interface SourceProperty extends SourceNode {
  type: "property";
  name: string;
  value: SourcePropertyValue;
  valueKind: SourceValueKind;
  /**
   * For a tuple, what each element was written as. A tuple may hold a quoted
   * string, an identifier, or an expression, and only the last two may be
   * folded — so the kinds cannot be recovered from the values alone.
   */
  elementKinds?: readonly SourceValueKind[];
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
  type: GeometryStatementKind;
  references: string[];
  mode?: string;
  axis?: string;
  by?: Point;
  degrees?: number;
  grid?: number;
}

export interface SourceAttachmentStatement extends SourceNode {
  type: "attachment";
  moving: string;
  target: string;
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
  argumentKinds: SourceValueKind[];
  statements: SourceStatement[];
}

export interface SourceInvocation extends SourceNode {
  type: "invocation";
  constructor: string;
  arguments: SourcePropertyValue[];
  argumentKinds: SourceValueKind[];
  statements: SourceStatement[];
}

export type SourceConstructorCall = SourceDeclaration | SourceInvocation;

export interface SourceBindingStatement extends SourceNode {
  type: "binding";
  name: string;
  expression: string;
}

/** A closed interval constraint written as `x in [start, end]`. */
export interface SourceMembershipStatement extends SourceNode {
  type: "membership";
  variable: string;
  from: string | number;
  to: string | number;
}

export type SourceStatement =
  | SourceBindingStatement
  | SourceMembershipStatement
  | SourceProperty
  | SourceSubtitle
  | SourceArrangement
  | SourceGeometryStatement
  | SourceAttachmentStatement
  | SourceConnection
  | SourceDeclaration
  | SourceInvocation;

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
