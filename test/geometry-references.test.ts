// An expression may name another element's geometry: `at = (api.bounds.right + 40, …)`.
//
// These numbers do not exist until measurement and layout have run, so unlike
// `let` this cannot be folded while the document is read. What matters here is
// that the names resolve to the boxes the compiler actually produced, that a
// reference to something unplaceable is a diagnostic rather than a zero, and
// that a referring element does not disturb the layout it refers to.
import assert from "node:assert/strict";
import test from "node:test";

import { parse } from "../src/index.ts";
import { compilePrepared as compile } from "../src/compile/pipeline.ts";
import { buildSemanticIR } from "../src/language/semantic.ts";

const scene = (source: string) => compile(parse(source)).toJSON();
const box = (source: string, id: string) => {
  const found = scene(source).elements.find((e) => e.id === id);
  assert.ok(found, `expected an element '${id}'`);
  return found as unknown as { x: number; y: number; width: number; height: number };
};

// Text and freehand are detached: they are drawn where they are told and take no
// part in document layout. A node with `at` participates in layout; a relative
// node is seeded there and its dependency relation is then solved together
// with the precision geometry constraints.
const laidOut = (body: string) => `diagram "" {
  flow: frame "Flow" {
    arrange row { gap = 70 }
    ingest: rectangle "Ingest"
    parse_: rectangle "Parse"
  }
  ${body}
}`;

test("an expression may name another element's edges", () => {
  const source = laidOut(`tick: text "T" {
    at = (flow.ingest.bounds.right, flow.ingest.bounds.bottom)
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
  ] as Array<[string, number]>) {
    const probe = box(laidOut(`p: text "P" { at = (flow.ingest.bounds.${part}, 40) }`), "p");
    assert.equal(probe.x, expected, `${part} must resolve to ${expected}`);
  }
});

test("centres are point projections, not special box-part spellings", () => {
  const source = laidOut(`p: text "P" { at = (x(flow.ingest.center), y(flow.ingest.center)) }`);
  const referenced = box(source, "flow.ingest:frame");
  const probe = box(source, "p");
  assert.deepEqual([probe.x, probe.y], [
    referenced.x + referenced.width / 2,
    referenced.y + referenced.height / 2,
  ]);
  assert.throws(
    () => scene(laidOut(`p: text "P" { at = (flow.ingest.bounds.center_x, 40) }`)),
    /center_x|unknown name/u,
  );
});

test("anchors are points while bounds remain explicit scalars", () => {
  const source = laidOut(`p: text "P" {
    at = flow.ingest.south-east + (-flow.ingest.bounds.width / 2, 12)
  }`);
  const referenced = box(source, "flow.ingest:frame");
  const probe = box(source, "p");
  assert.equal(probe.x, referenced.x + referenced.width / 2);
  assert.equal(probe.y, referenced.y + referenced.height + 12);
});

test("path values expose endpoints, arc positions, tangents, and length", () => {
  const source = `diagram "Paths" {
    line: freedraw { at = (10, 20); points = ((0, 0), (100, 0), (100, 100)) }
    let route = line
    start_mark: text "S" { at = start(route) + (1, 2) }
    middle_mark: text "M" { at = midpoint(route) }
    end_mark: text "E" { at = end(route) }
    direction: text "T" { at = (200, 200) + 10 * tangent(route, 0.25) }
    measure: text "L" { at = (length(route), 20) }
  }`;
  assert.deepEqual([box(source, "start_mark").x, box(source, "start_mark").y], [11, 22]);
  assert.deepEqual([box(source, "middle_mark").x, box(source, "middle_mark").y], [110, 20]);
  assert.deepEqual([box(source, "end_mark").x, box(source, "end_mark").y], [110, 120]);
  assert.deepEqual([box(source, "direction").x, box(source, "direction").y], [210, 200]);
  assert.equal(box(source, "measure").x, 200);
});

test("a reference composes with arithmetic and with named values", () => {
  const source = `diagram "" {
    let margin = 40
    flow: frame "Flow" {
      arrange row { gap = 70 }
      ingest: rectangle "Ingest"
      parse_: rectangle "Parse"
    }
    label: text "L" {
      at = (flow.parse_.bounds.right + margin, flow.ingest.bounds.top - margin)
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
    at = (flow.ingest.bounds.left, flow.parse_.bounds.bottom + 30)
    points = ((0, 0), (10, 0))
  }`);
  const ingestBox = box(source, "flow.ingest:frame");
  const parseBox = box(source, "flow.parse_:frame");
  const bar = box(source, "bar:stroke");
  assert.equal(bar.x, ingestBox.x, "the bar starts at the first element's left edge");
  assert.equal(bar.y, parseBox.y + parseBox.height + 30);
});

test("a reference to an element that does not exist is a diagnostic", () => {
  assert.throws(
    () => scene(laidOut(`tick: text "T" { at = (mystery.bounds.right, 10) }`)),
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
    a: text "A" { at = (10, 10) }
    b: text "B" { at = (a.bounds.right + 10, 10) }
  }`;
  assert.throws(() => scene(source), /no element 'a'.*a\.bounds\.right/);
});

test("a document that uses no references is untouched", () => {
  const source = `diagram "" { a: rectangle "A" { at = (10, 20); size = (120, 80) } }`;
  const a = box(source, "a:frame");
  assert.deepEqual([a.x, a.y, a.width, a.height], [10, 20, 120, 80]);
});

test("geometry resolution does not mutate a caller-owned semantic document", () => {
  const semantic = buildSemanticIR(parse(`diagram "" {
    box: rectangle "B" { at = (100, 100); size = (120, 80) }
    label: text "L" { at = box.south-east + (10, 10) }
  }`));
  const before = structuredClone(semantic.statements);
  const first = compile(semantic).toJSON();
  const second = compile(semantic).toJSON();
  assert.deepEqual(semantic.statements, before);
  assert.deepEqual(second, first);
});

test("a node may take a relative position without leaving layout", () => {
  const source = `diagram "" {
    ingest: rectangle "Ingest" { size = (120, 80) }
    tag: rectangle "Tag" {
      at = (ingest.bounds.right + 20, ingest.bounds.top)
      size = (120, 80)
    }
  }`;
  const ingest = box(source, "ingest:frame");
  const tag = box(source, "tag:frame");
  assert.equal(tag.x, ingest.x + ingest.width + 20);
  assert.equal(tag.y, ingest.y);

  // And a name nothing supplies is a language error rather than a layout one.
  assert.throws(
    () => scene(`diagram "" { a: rectangle "A" { at = (mystery, 0); size = (120, 80) } }`),
    /mystery/,
  );
});

test("detached references do not disturb layout while relative nodes reserve space", () => {
  const bare = box(laidOut(""), "flow.ingest:frame");
  const withText = box(laidOut(`t: text "T" { at = (500, 900) }`), "flow.ingest:frame");
  assert.deepEqual(withText, bare, "a detached element leaves the layout alone");

  const withNode = box(laidOut(`t: rectangle "T" { at = (500, 900); size = (120, 80) }`), "flow.ingest:frame");
  assert.notDeepEqual(withNode, bare, "an explicitly placed node still contributes to document extent");

  const relativeSource = `diagram "" {
    ingest: rectangle "Ingest" { size = (120, 80) }
    t: rectangle "T" {
      at = (ingest.bounds.right + 20, ingest.bounds.top)
      size = (120, 80)
    }
  }`;
  const ingest = box(relativeSource, "ingest:frame");
  const relative = box(relativeSource, "t:frame");
  assert.equal(relative.x, ingest.x + ingest.width + 20);
  assert.equal(relative.y, ingest.y);
});

test("references read node geometry after precision statements", () => {
  const source = laidOut(`
    offset (flow.ingest) by (300, 0)
    marker: text "M" { at = (flow.ingest.bounds.right, y(flow.ingest.center)) }
  `);
  const referenced = box(source, "flow.ingest:frame");
  const marker = box(source, "marker");
  assert.equal(marker.x, referenced.x + referenced.width);
  assert.equal(marker.y, referenced.y + referenced.height / 2);
});

test("references read the final axis-aligned bounds of a planned rotation", () => {
  const source = `diagram "" {
    target: rectangle "Target" { at = (200, 180); size = (160, 80) }
    rotate (target) 90
    marker: text "M" { at = (target.bounds.right, target.bounds.bottom) }
  }`;
  const target = box(source, "target:frame");
  const marker = box(source, "marker");
  const rotatedRight = target.x + target.width / 2 + target.height / 2;
  const rotatedBottom = target.y + target.height / 2 + target.width / 2;
  assert.equal(marker.x, rotatedRight);
  assert.equal(marker.y, rotatedBottom);
});

test("freedraw references also read final node geometry", () => {
  const source = laidOut(`
    offset (flow.ingest) by (150, 25)
    marker: freedraw {
      at = (flow.ingest.bounds.right, flow.ingest.bounds.bottom)
      points = ((0, 0), (20, 0))
    }
  `);
  const referenced = box(source, "flow.ingest:frame");
  const marker = box(source, "marker:stroke");
  assert.equal(marker.x, referenced.x + referenced.width);
  assert.equal(marker.y, referenced.y + referenced.height);
});

test("along rejects a stroke that a geometry statement moves", () => {
  assert.throws(() => scene(`diagram "" {
    curve: freedraw { at = (100, 100); points = ((0, 0), (100, 0)) }
    offset (curve) by (300, 0)
    marker: text "M" { at = along(curve, 1) }
  }`), /(?:stroke|path) 'curve'.*geometry statement moves it/u);
});

test("along rejects a stroke whose own position is late-bound", () => {
  assert.throws(() => scene(laidOut(`
    curve: freedraw {
      at = (flow.ingest.bounds.right, flow.ingest.bounds.bottom)
      points = ((0, 0), (100, 0))
    }
    marker: text "M" { at = along(curve, 1) }
  `)), /(?:stroke 'curve'.*own position is a geometry reference|path 'curve'.*position is resolved)/u);
});
