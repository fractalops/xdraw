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
import { advance, scope } from "./deferred.ts";
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
 */
function substituteInstance(value: string, repetition: Repetition, id = ""): string {
  const names = instanceScope(id, repetition);
  return value
    .replace(/\$?\{each\}/gu, repetition.item ?? String(repetition.index))
    .replace(/\$?\{([A-Za-z_][A-Za-z0-9_.-]*)\}/gu, (whole, name: string) => {
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
  // A pair is folded to numbers here rather than left as text: every name it
  // could hold is now known, and leaving it would put the burden on a later
  // pass that has no reason to know about repetition.
  for (const key of ["at", "size"] as const) {
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
  const statements = expandRepetitions(document.statements);
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
export function expandRepetitions(statements: readonly SemanticStatement[]): SemanticStatement[] {
  return statements.flatMap((statement) => {
    // Children expand first. An inner repeat's `at` mentions its own index, and
    // instantiating the outer declaration folds every pair it contains — which
    // would reach that expression before the inner instance exists to supply a
    // value for it.
    const children = (statement as { statements?: readonly SemanticStatement[] }).statements;
    let subject = statement;
    if (Array.isArray(children)) {
      const expanded = expandRepetitions(children);
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
    return repetitions.map((repetition) => instantiate(subject, repetition));
  });
}
