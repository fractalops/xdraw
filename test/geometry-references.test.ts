// An expression may name another element's geometry: `at = (api.right + 40, …)`.
//
// These numbers do not exist until measurement and layout have run, so unlike
// `let` this cannot be folded while the document is read. What matters here is
// that the names resolve to the boxes the compiler actually produced, that a
// reference to something unplaceable is a diagnostic rather than a zero, and
// that a referring element does not disturb the layout it refers to.
import assert from "node:assert/strict";
import test from "node:test";

import { compile, parse } from "../src/index.ts";

const scene = (source: string) => compile(parse(source)).toJSON();
const box = (source: string, id: string) => {
  const found = scene(source).elements.find((e) => e.id === id);
  assert.ok(found, `expected an element '${id}'`);
  return found as unknown as { x: number; y: number; width: number; height: number };
};

// Text and freehand are detached: they are drawn where they are told and take no
// part in document layout. A node with `at` does participate — the document
// grows to contain it and everything else shifts — so an element referring to a
// laid-out box has to be one of the detached kinds, or resolving its position
// would move the very thing it measured. See "a reference does not disturb".
const laidOut = (body: string) => `diagram "" {
  flow: frame "Flow" {
    arrange row { gap 70 }
    ingest: rectangle "Ingest"
    parse_: rectangle "Parse"
  }
  ${body}
}`;

test("an expression may name another element's edges", () => {
  const source = laidOut(`tick: text "T" {
    at = (flow.ingest.right, flow.ingest.bottom)
  }`);
  const referenced = box(source, "flow.ingest:frame");
  const tick = box(source, "tick");
  assert.equal(tick.x, referenced.x + referenced.width, "right is the far edge");
  assert.equal(tick.y, referenced.y + referenced.height, "bottom is the lower edge");
});

test("every part of a box is available", () => {
  const referenced = box(laidOut(""), "flow.ingest:frame");
  for (const [part, expected] of [
    ["left", referenced.x],
    ["right", referenced.x + referenced.width],
    ["top", referenced.y],
    ["bottom", referenced.y + referenced.height],
    ["width", referenced.width],
    ["height", referenced.height],
    ["center_x", referenced.x + referenced.width / 2],
    ["center_y", referenced.y + referenced.height / 2],
  ] as Array<[string, number]>) {
    const probe = box(laidOut(`p: text "P" { at = (flow.ingest.${part}, 40) }`), "p");
    assert.equal(probe.x, expected, `${part} must resolve to ${expected}`);
  }
});

test("a reference composes with arithmetic and with named values", () => {
  const source = `diagram "" {
    let margin = 40
    flow: frame "Flow" {
      arrange row { gap 70 }
      ingest: rectangle "Ingest"
      parse_: rectangle "Parse"
    }
    label: text "L" {
      at = (flow.parse_.right + margin, flow.ingest.top - margin)
    }
  }`;
  const parseBox = box(source, "flow.parse_:frame");
  const ingestBox = box(source, "flow.ingest:frame");
  const label = box(source, "label");
  assert.equal(label.x, parseBox.x + parseBox.width + 40);
  assert.equal(label.y, ingestBox.y - 40);
});

test("a span between two elements is expressible", () => {
  // The number nobody can write down: it depends on measured text and a gap
  // the layout chose.
  const source = laidOut(`bar: freedraw {
    at = (flow.ingest.left, flow.parse_.bottom + 30)
    points ((0, 0), (10, 0))
  }`);
  const ingestBox = box(source, "flow.ingest:frame");
  const parseBox = box(source, "flow.parse_:frame");
  const bar = box(source, "bar:stroke");
  assert.equal(bar.x, ingestBox.x, "the bar starts at the first element's left edge");
  assert.equal(bar.y, parseBox.y + parseBox.height + 30);
});

test("a reference to an element that does not exist is a diagnostic", () => {
  assert.throws(
    () => scene(laidOut(`tick: text "T" { at = (mystery.right, 10) }`)),
    /mystery/,
  );
});

test("a part that is not part of a box is a diagnostic", () => {
  assert.throws(
    () => scene(laidOut(`tick: text "T" { at = (flow.ingest.middle, 10) }`)),
    /middle|unknown/i,
  );
});

test("a detached element cannot be referred to, and says so", () => {
  // Text and freehand are drawn where they are told and never registered as
  // boxes, so they are not addressable. That also disposes of mutual
  // reference: two elements pointing at each other cannot both be detached and
  // both be measurable, so the case reports a missing element rather than
  // needing cycle detection.
  const source = `diagram "" {
    a: text "A" { at (10, 10) }
    b: text "B" { at = (a.right + 10, 10) }
  }`;
  assert.throws(() => scene(source), /no element 'a' to take 'right' from/);
});

test("a document that uses no references is untouched", () => {
  const source = `diagram "" { a: rectangle "A" { at (10, 20); size (120, 80) } }`;
  const a = box(source, "a:frame");
  assert.deepEqual([a.x, a.y, a.width, a.height], [10, 20, 120, 80]);
});

test("a node that refers to geometry is refused, not crashed into the layout", () => {
  // The rule that only detached elements may refer was documented and argued
  // for, but nothing enforced it: the pair validator accepted any string
  // element, so an unresolved name reached the layout engine and died there
  // with an internal message and no source location.
  assert.throws(
    () => scene(laidOut(`tag: rectangle "Tag" { at = (flow.ingest.right + 20, flow.ingest.top); size (120, 80) }`)),
    /'tag'.*only text and freehand/is,
  );
  // And a name nothing supplies is a language error rather than a layout one.
  assert.throws(
    () => scene(`diagram "" { a: rectangle "A" { at = (mystery, 0); size (120, 80) } }`),
    /mystery/,
  );
});

test("a reference does not disturb the layout it refers to", () => {
  // The feature only holds because the referring element is detached. A node
  // with `at` takes part in document layout, so the document grows to contain
  // it and the box it measured moves — resolving would then need resolving
  // again. This pins the difference that makes the pass safe.
  const bare = box(laidOut(""), "flow.ingest:frame");
  const withText = box(laidOut(`t: text "T" { at (500, 900) }`), "flow.ingest:frame");
  assert.deepEqual(withText, bare, "a detached element leaves the layout alone");

  const withNode = box(laidOut(`t: rectangle "T" { at (500, 900); size (120, 80) }`), "flow.ingest:frame");
  assert.notDeepEqual(withNode, bare, "a placed node does take part, which is why it may not refer");
});
