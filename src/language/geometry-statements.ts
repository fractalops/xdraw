import type { GeometryStatementKind } from "../contracts/foundation.ts";
import type { SourceGeometryStatement, SourceStatement } from "../contracts/language.ts";
import type { GeometryStatement, SemanticStatement } from "../contracts/semantic.ts";

/**
 * Which statement kinds are geometry statements, as a value.
 *
 * `satisfies` keeps the runtime vocabulary and `GeometryStatementKind` exact:
 * adding a kind on only one side fails to compile.
 */
const KINDS = {
  alignment: true,
  distribution: true,
  offset: true,
  "match-size": true,
  rotation: true,
  snap: true,
  layer: true,
} satisfies Record<GeometryStatementKind, true>;

export const GEOMETRY_STATEMENT_KINDS: readonly GeometryStatementKind[] = Object.keys(KINDS) as GeometryStatementKind[];

export function isGeometryStatementKind(type: string): type is GeometryStatementKind {
  return Object.hasOwn(KINDS, type);
}

/** A geometry statement as written in source, before lowering. */
export function isSourceGeometryStatement(
  statement: SourceStatement,
): statement is SourceGeometryStatement {
  return isGeometryStatementKind(statement.type);
}

/** A geometry statement in the semantic document, which is what the geometry pass applies. */
export function isSemanticGeometryStatement(
  statement: SemanticStatement,
): statement is GeometryStatement {
  return isGeometryStatementKind(statement.type);
}
