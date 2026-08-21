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

import { parse } from "../src/index.ts";
import { compilePrepared as compile } from "../src/compile/pipeline.ts";

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
      each = ("Ingest", "Parse", "Emit")
      at = (100 + 200 * each.index, 200)
      size = (160, 90)
    }
  }`;
  assert.deepEqual(ids(source), ["stage.Ingest:frame", "stage.Parse:frame", "stage.Emit:frame"]);
});

test("inserting an item leaves the other identities alone", () => {
  // This is the whole reason `each` binds keys rather than positions.
  const before = ids(`diagram "" {
    s: rectangle "S" { each = ("a", "c"); at = (100 * s.index, 100); size = (120, 80) }
  }`);
  const after = ids(`diagram "" {
    s: rectangle "S" { each = ("a", "b", "c"); at = (100 * s.index, 100); size = (120, 80) }
  }`);
  assert.deepEqual(before, ["s.a:frame", "s.c:frame"]);
  assert.deepEqual(after, ["s.a:frame", "s.b:frame", "s.c:frame"]);
  for (const id of before) assert.ok(after.includes(id), `${id} must survive the insertion`);
});

test("count produces positional identities and says so", () => {
  const source = `diagram "" {
    spoke: rectangle "S" {
      count = 3
      at = (100 + 150 * spoke.index, 200)
      size = (120, 80)
    }
  }`;
  assert.deepEqual(ids(source), ["spoke.0:frame", "spoke.1:frame", "spoke.2:frame"]);
});

test("the index reaches an expression, which is the point", () => {
  const source = `diagram "" {
    s: rectangle "S" { count = 4; at = (100 + 150 * s.index, 300); size = (120, 80) }
  }`;
  for (let index = 0; index < 4; index += 1) {
    assert.equal(boxOf(source, `s.${index}:frame`).x, 100 + 150 * index);
  }
});

test("a whole point expression receives the repetition scope", () => {
  const source = `diagram "" {
    s: rectangle "S" {
      count = 3
      at = (0, 0) + (s.index * 100, 0)
      size = (80, 60)
    }
  }`;
  for (let index = 0; index < 3; index += 1) {
    assert.equal(boxOf(source, `s.${index}:frame`).x, index * 100);
  }
});

test("the total is available, so a ring does not repeat its own size", () => {
  const source = `diagram "" {
    s: rectangle "S" {
      count = 8
      at = (400 + 220 * cos(tau * s.index / s.count), 400 + 220 * sin(tau * s.index / s.count))
      size = (120, 80)
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
    s: rectangle "\${each}" { each = ("Alpha", "Beta"); at = (100 + 200 * s.index, 100); size = (140, 80) }
  }`;
  const titles = elements(source).filter((e) => String(e.id).endsWith(":title")).map((e) => (e as unknown as { text: string }).text);
  assert.deepEqual(titles, ["Alpha", "Beta"]);
});

test("a declaration may not use both each and count", () => {
  assert.throws(
    () => compile(parse(`diagram "" { s: rectangle "S" { each = ("a"); count = 2; at = (0, 0); size = (120, 80) } }`)),
    /each.*count|count.*each/i,
  );
});

test("a repeated declaration is bounded", () => {
  assert.throws(
    () => compile(parse(`diagram "" { s: rectangle "S" { count = 100000; at = (0, 0); size = (120, 80) } }`)),
    /count|instances|limit/i,
  );
});

test("count must be a whole number of at least one", () => {
  for (const bad of ["0", "-3", "2.5"]) {
    assert.throws(
      () => compile(parse(`diagram "" { s: rectangle "S" { count = ${bad}; at = (0, 0); size = (120, 80) } }`)),
      /count/i,
      `count ${bad} must be rejected`,
    );
  }
});

test("each requires at least one item, and items must be usable as names", () => {
  assert.throws(() => compile(parse(`diagram "" { s: rectangle "S" { each = (); at = (0, 0); size = (120, 80) } }`)), /each/i);
  assert.throws(
    () => compile(parse(`diagram "" { s: rectangle "S" { each = ("a", "a"); at = (0, 0); size = (120, 80) } }`)),
    /duplicate|twice|'a'/i,
  );
});

test("a repeat inside a container expands too", () => {
  // Children expand before their parent, because an inner repeat's `at`
  // mentions its own index and the parent would otherwise fold that expression
  // before an instance existed to supply a value for it.
  const source = `diagram "" {
    panel: frame "P" {
      cell: rectangle "C" { count = 3; at = (100 + 150 * cell.index, 100); size = (120, 80) }
    }
  }`;
  for (let index = 0; index < 3; index += 1) {
    assert.equal(boxOf(source, `panel.cell.${index}:frame`).x, 100 + 150 * index);
  }
});

test("an item may not repeat, because two instances cannot share a name", () => {
  assert.throws(
    () => compile(parse(`diagram "" {
      s: rectangle "S" { each = ("a", "b", "a"); at = (100 * s.index, 100); size = (120, 80) }
    }`)),
    /duplicate item 'a'/,
  );
});

test("an index in prose is left alone", () => {
  // Substitution used to be a regex run over every string in the subtree, so a
  // body mentioning `t1.index` in a sentence was rewritten. A name is only a
  // value inside an expression; in text it is text.
  const source = `diagram "" {
    t1: rectangle "\${each}" {
      each = ("one", "two")
      at = (100 + 200 * index, 100)
      size = (200, 110)
      body = "see t1.index in the manual"
    }
  }`;
  const bodies = elements(source)
    .filter((e) => String(e.id).includes("body"))
    .map((e) => String((e as unknown as { text: string }).text));
  assert.ok(bodies.length > 0, "the fixture must produce body text");
  for (const body of bodies) {
    assert.match(body, /t1\.index/, `prose was rewritten: ${body}`);
  }
});

test("a document that repeats nothing is untouched", () => {
  const source = `diagram "" { a: rectangle "A" { at = (10, 20); size = (120, 80) } }`;
  assert.deepEqual(ids(source), ["a:frame"]);
  const box = boxOf(source, "a:frame");
  assert.deepEqual([box.x, box.y], [10, 20]);
});

// --------------------------------------------------------------- properties

test("property: count produces exactly that many elements", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 24 }), (n) => {
    const source = `diagram "" {
      s: rectangle "S" { count = ${n}; at = (100 + 140 * s.index, 200); size = (120, 80) }
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
        s: rectangle "S" { count = ${n}; at = (50 + ${step} * s.index, 200); size = (120, 80) }
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
      s: rectangle "S" { each = (${list}); at = (100 + 150 * s.index, 200); size = (120, 80) }
    }`;
    assert.deepEqual(ids(source), items.map((item) => `s.${item}:frame`));
  }), { numRuns: Math.min(RUNS, 40) });
});

test("a qualified instance name substitutes in a string as it does in an expression", () => {
  // `spoke.index` reaching a number inside an expression while `${spoke.index}`
  // reached the drawing as literal text was a difference nobody would predict.
  const drawing = compile(parse(`diagram "Q" {
    spoke: text "\${spoke.index} of \${spoke.count}" {
      count = 3
      at = (100 + 60 * spoke.index, 200)
    }
  }`)).toJSON();
  const texts = drawing.elements
    .filter((item) => item.type === "text" && item.id.startsWith("spoke."))
    .map((item) => (item as unknown as { text: string }).text);
  assert.deepEqual(texts, ["0 of 3", "1 of 3", "2 of 3"]);

  // The bare and 'each'-qualified spellings agree with it.
  const other = compile(parse(`diagram "Q" {
    tick: text "\${index}/\${each.count}" { count = 2; at = (100, 100 + 40 * tick.index) }
  }`)).toJSON();
  assert.deepEqual(
    other.elements.filter((item) => item.type === "text" && item.id.startsWith("tick.")).map((item) => (item as unknown as { text: string }).text),
    ["0/2", "1/2"],
  );
});

test("a qualified name in prose keeps its braces", () => {
  // Matching the unmarked form for dotted names turned `the {row.index} column`
  // into `the 0 column`. The parser only de-dollars undotted names, so a
  // qualified one always arrives marked and the unmarked spelling is prose.
  const drawing = compile(parse(`diagram "Prose" {
    row: rectangle "R" {
      count = 2
      at = (100, 100 + 200 * row.index)
      size = (460, 160)
      body = "the {row.index} column, and \${row.index} substituted"
    }
  }`)).toJSON();
  const bodies = drawing.elements
    .filter((item) => item.id.endsWith(":body"))
    .map((item) => (item as unknown as { text: string }).text);
  assert.equal(bodies.length, 2);
  assert.match(bodies[0], /the \{row\.index\} column/u, "the unmarked form is prose");
  assert.match(bodies[0], /and 0 substituted/u, "the marked form is a value");
  assert.match(bodies[1], /and 1 substituted/u);
});

test("a name no repeat supplies is left for the template pass", () => {
  // Repetition runs before templates expand, and a template parameter is
  // written the same way, so an unknown name must survive rather than be
  // substituted or refused.
  const drawing = compile(parse(`diagram "T" {
    card: template(label) {
      row: text "\${label}" { count = 2; at = (100, 100 + 40 * row.index) }
    }
    a: card("kept")
  }`)).toJSON();
  assert.deepEqual(
    drawing.elements
      .filter((item) => item.type === "text" && item.id.startsWith("a.row."))
      .map((item) => (item as unknown as { text: string }).text),
    ["kept", "kept"],
  );
});

test("a stroke repeats, so a row of ticks is one declaration", () => {
  const drawing = compile(parse(`diagram "Ticks" {
    tick: freedraw {
      count = 9
      at = (160 + 80 * tick.index, 520)
      points = ((0, 0), (0, 8))
    }
  }`)).toJSON();
  const strokes = drawing.elements.filter((item) => item.type === "freedraw");
  assert.equal(strokes.length, 9);
  assert.deepEqual(
    strokes.map((item) => Math.round(item.x)),
    [160, 240, 320, 400, 480, 560, 640, 720, 800],
  );
});

test("a repeated declaration is a collection for geometry statements", () => {
  const source = `diagram "Collection" {
    row: group {
      arrange row { gap = 30 }
      item: rectangle "Item" { count = 3; size = (140, 70 + 20 * item.index) }
      align bottom (item)
    }
  }`;
  const boxes = [0, 1, 2].map((index) => boxOf(source, `row.item.${index}:frame`));
  assert.deepEqual(boxes.map((item) => item.y + item.height), Array(3).fill(boxes[0].y + boxes[0].height));
});

test("plots repeat with their mathematical expressions and stable identities", () => {
  const drawing = compile(parse(`use "xdraw/math" as math
diagram "Families" {
  chart: math.plane {
    x in [-pi, pi]
    y in [-2, 4]
    wave: math.plot {
      count = 3
      y = sin(x) + wave.index
      x in [-pi, pi]
    }
  }
}`)).toJSON();
  const series = drawing.elements
    .filter((item) => item.customData?.xdraw?.role === "cartesian-series")
    .map((item) => String(item.customData?.xdraw?.series));
  assert.deepEqual([...new Set(series)], ["chart.wave.0", "chart.wave.1", "chart.wave.2"]);
});
