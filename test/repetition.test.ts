// One declaration producing several elements.
//
// `each` binds a list of items and gives key-based identity — `stage.Ingest` —
// so inserting an item does not disturb the others. `count` gives positional
// identity, `spoke.0`, and is honest about it. Terraform learned this
// distinction the hard way: with a numeric index, removing an item shifts every
// index after it and everything downstream is destroyed and recreated.
//
// The capability that matters is computed placement — a position that depends
// on which instance this is — so most of what follows is about `index` and
// `count` reaching an expression.
import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { compile, parse } from "../src/index.ts";

const RUNS = Number.parseInt(process.env.XDRAW_PROPERTY_RUNS ?? "100", 10);
const elements = (source: string) => compile(parse(source)).toJSON().elements;
const ids = (source: string) => elements(source).map((e) => String(e.id)).filter((id) => id.endsWith(":frame") && !id.startsWith("diagram"));
const boxOf = (source: string, id: string) => {
  const found = elements(source).find((e) => e.id === id);
  assert.ok(found, `expected an element '${id}'`);
  return found as unknown as { x: number; y: number; width: number; height: number };
};

test("each produces one element per item, named by the item", () => {
  const source = `diagram "" {
    stage: rectangle "S" {
      each ("Ingest", "Parse", "Emit")
      at = (100 + 200 * each.index, 200)
      size (160, 90)
    }
  }`;
  assert.deepEqual(ids(source), ["stage.Ingest:frame", "stage.Parse:frame", "stage.Emit:frame"]);
});

test("inserting an item leaves the other identities alone", () => {
  // This is the whole reason `each` binds keys rather than positions.
  const before = ids(`diagram "" {
    s: rectangle "S" { each ("a", "c"); at = (100 * s.index, 100); size (120, 80) }
  }`);
  const after = ids(`diagram "" {
    s: rectangle "S" { each ("a", "b", "c"); at = (100 * s.index, 100); size (120, 80) }
  }`);
  assert.deepEqual(before, ["s.a:frame", "s.c:frame"]);
  assert.deepEqual(after, ["s.a:frame", "s.b:frame", "s.c:frame"]);
  for (const id of before) assert.ok(after.includes(id), `${id} must survive the insertion`);
});

test("count produces positional identities and says so", () => {
  const source = `diagram "" {
    spoke: rectangle "S" {
      count 3
      at = (100 + 150 * spoke.index, 200)
      size (120, 80)
    }
  }`;
  assert.deepEqual(ids(source), ["spoke.0:frame", "spoke.1:frame", "spoke.2:frame"]);
});

test("the index reaches an expression, which is the point", () => {
  const source = `diagram "" {
    s: rectangle "S" { count 4; at = (100 + 150 * s.index, 300); size (120, 80) }
  }`;
  for (let index = 0; index < 4; index += 1) {
    assert.equal(boxOf(source, `s.${index}:frame`).x, 100 + 150 * index);
  }
});

test("the total is available, so a ring does not repeat its own size", () => {
  const source = `diagram "" {
    s: rectangle "S" {
      count 8
      at = (400 + 220 * cos(tau * s.index / s.count), 400 + 220 * sin(tau * s.index / s.count))
      size (120, 80)
    }
  }`;
  const centre = 400;
  for (let index = 0; index < 8; index += 1) {
    const box = boxOf(source, `s.${index}:frame`);
    const radius = Math.hypot(box.x - centre, box.y - centre);
    assert.ok(Math.abs(radius - 220) < 0.001, `spoke ${index} sits at radius ${radius}, not 220`);
  }
});

test("the item is available to the title", () => {
  const source = `diagram "" {
    s: rectangle "\${each}" { each ("Alpha", "Beta"); at = (100 + 200 * s.index, 100); size (140, 80) }
  }`;
  const titles = elements(source).filter((e) => String(e.id).endsWith(":title")).map((e) => (e as unknown as { text: string }).text);
  assert.deepEqual(titles, ["Alpha", "Beta"]);
});

test("a declaration may not use both each and count", () => {
  assert.throws(
    () => compile(parse(`diagram "" { s: rectangle "S" { each ("a"); count 2; at (0, 0); size (120, 80) } }`)),
    /each.*count|count.*each/i,
  );
});

test("a repeated declaration is bounded", () => {
  assert.throws(
    () => compile(parse(`diagram "" { s: rectangle "S" { count 100000; at (0, 0); size (120, 80) } }`)),
    /count|instances|limit/i,
  );
});

test("count must be a whole number of at least one", () => {
  for (const bad of ["0", "-3", "2.5"]) {
    assert.throws(
      () => compile(parse(`diagram "" { s: rectangle "S" { count ${bad}; at (0, 0); size (120, 80) } }`)),
      /count/i,
      `count ${bad} must be rejected`,
    );
  }
});

test("each requires at least one item, and items must be usable as names", () => {
  assert.throws(() => compile(parse(`diagram "" { s: rectangle "S" { each (); at (0, 0); size (120, 80) } }`)), /each/i);
  assert.throws(
    () => compile(parse(`diagram "" { s: rectangle "S" { each ("a", "a"); at (0, 0); size (120, 80) } }`)),
    /duplicate|twice|'a'/i,
  );
});

test("a repeat inside a container expands too", () => {
  // Children expand before their parent, because an inner repeat's `at`
  // mentions its own index and the parent would otherwise fold that expression
  // before an instance existed to supply a value for it.
  const source = `diagram "" {
    panel: frame "P" {
      cell: rectangle "C" { count 3; at = (100 + 150 * cell.index, 100); size (120, 80) }
    }
  }`;
  for (let index = 0; index < 3; index += 1) {
    assert.equal(boxOf(source, `panel.cell.${index}:frame`).x, 100 + 150 * index);
  }
});

test("an item may not repeat, because two instances cannot share a name", () => {
  assert.throws(
    () => compile(parse(`diagram "" {
      s: rectangle "S" { each ("a", "b", "a"); at = (100 * s.index, 100); size (120, 80) }
    }`)),
    /duplicate item 'a'/,
  );
});

test("a document that repeats nothing is untouched", () => {
  const source = `diagram "" { a: rectangle "A" { at (10, 20); size (120, 80) } }`;
  assert.deepEqual(ids(source), ["a:frame"]);
  const box = boxOf(source, "a:frame");
  assert.deepEqual([box.x, box.y], [10, 20]);
});

// --------------------------------------------------------------- properties

test("property: count produces exactly that many elements", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 24 }), (n) => {
    const source = `diagram "" {
      s: rectangle "S" { count ${n}; at = (100 + 140 * s.index, 200); size (120, 80) }
    }`;
    assert.equal(ids(source).length, n);
  }), { numRuns: Math.min(RUNS, 24) });
});

test("property: every instance is placed where its own index says", () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 20, max: 200 }),
    (n, step) => {
      const source = `diagram "" {
        s: rectangle "S" { count ${n}; at = (50 + ${step} * s.index, 200); size (120, 80) }
      }`;
      for (let index = 0; index < n; index += 1) {
        assert.equal(boxOf(source, `s.${index}:frame`).x, 50 + step * index);
      }
    },
  ), { numRuns: Math.min(RUNS, 40) });
});

test("property: each item becomes exactly one element, keyed by the item", () => {
  const name = fc.stringMatching(/^[a-z][a-z0-9_]{0,7}$/);
  fc.assert(fc.property(fc.uniqueArray(name, { minLength: 1, maxLength: 8 }), (items) => {
    const list = items.map((item) => `"${item}"`).join(", ");
    const source = `diagram "" {
      s: rectangle "S" { each (${list}); at = (100 + 150 * s.index, 200); size (120, 80) }
    }`;
    assert.deepEqual(ids(source), items.map((item) => `s.${item}:frame`));
  }), { numRuns: Math.min(RUNS, 40) });
});
