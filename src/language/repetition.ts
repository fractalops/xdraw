/**
 * One declaration producing several elements.
 *
 * `each ("Ingest", "Parse")` binds a list and identifies each instance by its
 * item — `stage.Ingest`. `count 8` identifies by position — `spoke.0`. The
 * difference is not cosmetic: a key describes identity and an index describes
 * position, so inserting an item into an `each` leaves every other instance
 * named exactly as it was, while inserting into a `count` renumbers everything
 * after it. Terraform learned this distinction the hard way, and it decides
 * which form an author should reach for.
 *
 * Instances are produced by cloning the declaration, so everything a
 * declaration can hold works inside one. What each instance gets is its own
 * `index`, `count`, and item, reaching expressions through the same
 * substitution templates already use.
 */
import { advance, advanceValue, scope } from "./deferred.ts";
import { isSemanticGeometryStatement } from "./geometry-statements.ts";
import type { DiagramDocument, SemanticStatement } from "../contracts/semantic.ts";

export class RepetitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XDrawRepetitionError";
  }
}

/**
 * How many instances one declaration may produce. A repeated declaration is
 * cheap to write and expensive to draw, and a document of ten thousand
 * elements is not a diagram.
 */
export const MAXIMUM_INSTANCES = 512;

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/u;

interface Repetition {
  /** The name each instance is identified by. */
  readonly key: string;
  /** The item bound for this instance, if the declaration used `each`. */
  readonly item?: string;
  readonly index: number;
  readonly total: number;
}

function repetitionsOf(statement: SemanticStatement): readonly Repetition[] | null {
  const carrier = statement as unknown as {
    id?: string;
    attributes?: Record<string, unknown>;
  };
  const attributes = carrier.attributes;
  if (!attributes) return null;
  const each = attributes.each;
  const count = attributes.count;
  if (each === undefined && count === undefined) return null;
  const owner = `'${carrier.id ?? "?"}'`;

  if (each !== undefined && count !== undefined) {
    throw new RepetitionError(`${owner} uses both each and count; a declaration repeats one way or the other`);
  }

  if (each !== undefined) {
    if (!Array.isArray(each) || each.length === 0) {
      throw new RepetitionError(`${owner} each needs at least one item, written as ("a", "b")`);
    }
    if (each.length > MAXIMUM_INSTANCES) {
      throw new RepetitionError(`${owner} each has ${each.length} items, beyond the limit of ${MAXIMUM_INSTANCES}`);
    }
    const seen = new Set<string>();
    return each.map((item, index) => {
      if (typeof item !== "string" || !NAME_PATTERN.test(item)) {
        throw new RepetitionError(`${owner} each item ${JSON.stringify(item)} cannot be used as a name`);
      }
      if (seen.has(item)) throw new RepetitionError(`${owner} each has a duplicate item '${item}'`);
      seen.add(item);
      return { key: item, item, index, total: each.length };
    });
  }

  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
    throw new RepetitionError(`${owner} count must be a whole number of at least 1`);
  }
  if (count > MAXIMUM_INSTANCES) {
    throw new RepetitionError(`${owner} count is ${count}, beyond the limit of ${MAXIMUM_INSTANCES}`);
  }
  return Array.from({ length: count }, (_, index) => ({
    key: String(index),
    index,
    total: count,
  }));
}

/**
 * Substitutes `${each}` and friends in a string.
 *
 * Only the marked form is replaced, and only in text. An unmarked name such as
 * `t1.index` is left alone: it is a value inside an expression and prose
 * elsewhere, and the previous regex pass could not tell the difference — it
 * rewrote `body "see t1.index in the manual"` into `see 0 in the manual`.
 *
 * Every name this repeat supplies to expressions is substituted here too, so a
 * qualified form agrees with itself across the two. `spoke.index` reaching a
 * number in `at = (spoke.index * 60, 0)` while `${spoke.index}` reached the
 * drawing as literal text was the sort of difference nobody would predict and
 * everyone would hit.
 *
 * A name this repeat does not supply is left untouched rather than refused: a
 * template parameter is written `${name}` as well, and repetition runs before
 * templates expand, so an unknown name here is usually one the template pass
 * will bind.
 *
 * A qualified name requires its `$`, and a bare `index` or `count` does not,
 * because that is what reaches here: the parser normalises `${name}` to
 * `{name}` in a title and its pattern admits no dots. Matching the unmarked form
 * for dotted names as well turned `body "the {row.index} column"` into
 * `the 0 column`, and braces are ordinary prose in TeX, in code, and in much of
 * what a diagram carries.
 */
function substituteInstance(value: string, repetition: Repetition, id = ""): string {
  const names = instanceScope(id, repetition);
  return value
    // `interpolationValue` in the parser rewrites `${name}` to `{name}` in a
    // title, so the unmarked form has to be honoured for the names it could have
    // come from. Its regex admits no dots, so a qualified name still carries its
    // `$` when it arrives and only the marked form is matched for those. That is
    // what keeps prose like "the {row.index} column" as prose.
    .replace(/\$?\{each\}/gu, repetition.item ?? String(repetition.index))
    .replace(/\$?\{(index|count)\}/gu, (whole, name: string) => {
      const bound = names.get(name);
      return bound === undefined ? whole : String(bound);
    })
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_.-]*)\}/gu, (whole, name: string) => {
      const bound = names.get(name);
      return bound === undefined ? whole : String(bound);
    });
}

/** The names a repeat supplies to expressions inside it. */
function instanceScope(id: string, repetition: Repetition): ReadonlyMap<string, number> {
  const local = id.slice(id.lastIndexOf(".") + 1);
  return scope({
    index: repetition.index,
    count: repetition.total,
    [`${id}.index`]: repetition.index,
    [`${id}.count`]: repetition.total,
    [`${local}.index`]: repetition.index,
    [`${local}.count`]: repetition.total,
    "each.index": repetition.index,
    "each.count": repetition.total,
  });
}

function substituteDeep(value: unknown, repetition: Repetition, id = ""): unknown {
  if (typeof value === "string") return substituteInstance(value, repetition, id);
  if (Array.isArray(value)) return value.map((item) => substituteDeep(item, repetition, id));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substituteDeep(item, repetition, id)]),
  );
}

function instantiate(statement: SemanticStatement, repetition: Repetition): SemanticStatement {
  const source = statement as unknown as Record<string, unknown>;
  const id = String(source.id ?? "");
  const clone = structuredClone(statement) as unknown as Record<string, unknown>;
  const span = (statement as { span?: unknown }).span;

  const names = instanceScope(id, repetition);
  clone.id = `${id}.${repetition.key}`;
  for (const key of ["title", "value", "authoredSource"] as const) {
    if (typeof clone[key] === "string") clone[key] = substituteInstance(clone[key], repetition, id);
  }
  if (clone.type === "plot") {
    for (const key of ["x", "y", "equation", "from", "to"] as const) {
      if (typeof clone[key] !== "string") continue;
      const substituted = substituteInstance(clone[key], repetition, id);
      const resolved = substituted.includes("${") ? substituted : advance(substituted, names);
      clone[key] = key === "x" || key === "y" || key === "equation" ? String(resolved) : resolved;
    }
  }
  // A pair is folded to numbers here rather than left as text: every name it
  // could hold is now known, and leaving it would put the burden on a later
  // pass that has no reason to know about repetition.
  for (const key of ["at", "size"] as const) {
    if (typeof clone[key] === "string") {
      clone[key] = advanceValue(clone[key], names);
      continue;
    }
    if (!Array.isArray(clone[key])) continue;
    // A pair is advanced through this instance's names. Anything still waiting
    // belongs to a later stage — an outer repeat, or geometry layout has not
    // produced yet — and is carried on as written.
    clone[key] = (substituteDeep(clone[key], repetition, id) as unknown[]).map((part) => (
      typeof part === "string" ? advance(part, names) : part
    ));
  }
  if (clone.attributes && typeof clone.attributes === "object") {
    const attributes = { ...(clone.attributes as Record<string, unknown>) };
    delete attributes.each;
    delete attributes.count;
    clone.attributes = substituteDeep(attributes, repetition, id);
  }
  if (Array.isArray(clone.statements)) {
    clone.statements = (clone.statements as SemanticStatement[]).map((child) => (
      substituteDeep(child, repetition, id) as SemanticStatement
    ));
  }
  if (span) Object.defineProperty(clone, "span", { value: span, enumerable: false });
  return clone as unknown as SemanticStatement;
}

/** Replaces every repeated declaration in a document with its instances. */
export function expandRepeats(document: DiagramDocument): DiagramDocument {
  const collections = new Map<string, string[]>();
  const statements = rewriteCollectionSelections(expandRepetitions(document.statements, collections), collections);
  if (statements.length === document.statements.length
      && statements.every((statement, index) => statement === document.statements[index])) {
    return document;
  }
  const copy = { ...document, statements };
  for (const key of ["span", "source", "comments", "assetFiles"] as const) {
    const value = (document as unknown as Record<string, unknown>)[key];
    if (value !== undefined) Object.defineProperty(copy, key, { value, enumerable: false });
  }
  return copy;
}

/** Replaces every repeated declaration with its instances. */
export function expandRepetitions(
  statements: readonly SemanticStatement[],
  collections = new Map<string, string[]>(),
): SemanticStatement[] {
  return statements.flatMap((statement) => {
    // Children expand first. An inner repeat's `at` mentions its own index, and
    // instantiating the outer declaration folds every pair it contains — which
    // would reach that expression before the inner instance exists to supply a
    // value for it.
    const children = (statement as { statements?: readonly SemanticStatement[] }).statements;
    let subject = statement;
    if (Array.isArray(children)) {
      const expanded = expandRepetitions(children, collections);
      if (expanded.length !== children.length
          || expanded.some((child, index) => child !== children[index])) {
        const copy = { ...statement, statements: expanded };
        const span = (statement as { span?: unknown }).span;
        if (span) Object.defineProperty(copy, "span", { value: span, enumerable: false });
        subject = copy as SemanticStatement;
      }
    }
    const repetitions = repetitionsOf(subject);
    if (!repetitions) return [subject];
    const instances = repetitions.map((repetition) => instantiate(subject, repetition));
    const owner = (subject as { id?: string }).id;
    if (owner) collections.set(owner, instances.map((instance) => (instance as { id: string }).id));
    return instances;
  });
}

/**
 * A repeated declaration is also a collection selector. Geometry statements
 * name that declaration exactly as they would a single element; this pass
 * replaces the collection name with its stable instance identities before
 * validation and solving. No geometry implementation needs repetition logic.
 */
function rewriteCollectionSelections(
  statements: readonly SemanticStatement[],
  collections: ReadonlyMap<string, readonly string[]>,
): SemanticStatement[] {
  return statements.map((statement) => {
    let result = statement;
    if (isSemanticGeometryStatement(statement)) {
      const ids = statement.ids.flatMap((id) => collections.get(id) ?? [id]);
      if (ids.length !== statement.ids.length || ids.some((id, index) => id !== statement.ids[index])) {
        result = { ...statement, ids };
      }
    }
    if (result.statements) {
      const children = rewriteCollectionSelections(result.statements, collections);
      if (children.some((child, index) => child !== result.statements![index])) {
        result = { ...result, statements: children } as SemanticStatement;
      }
    }
    const span = (statement as { span?: unknown }).span;
    if (span && result !== statement) Object.defineProperty(result, "span", { value: span, enumerable: false });
    return result;
  });
}
