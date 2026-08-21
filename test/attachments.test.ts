import assert from "node:assert/strict";
import test from "node:test";

import { compilePrepared } from "../src/compile/pipeline.ts";
import { parseSource } from "../src/language/parser.ts";
import { requireElementById } from "../test-support/assertions.ts";

function drawing(source: string) {
  return compilePrepared(parseSource(source)).toJSON();
}

test("a node can attach to a stable path before final layout is solved", () => {
  const scene = drawing(`diagram "Node to path" {
    path: freedraw { at = (400, 300); points = ((0, 0), (100, 0)) }
    marker: rectangle "Marker" { size = (80, 60) }
    attach marker.center to end(path)
  }`);
  const marker = requireElementById(scene.elements, "marker:frame");
  assert.deepEqual([marker.x + marker.width / 2, marker.y + marker.height / 2], [500, 300]);
});

test("node-to-path attachment grows the node's containing layout", () => {
  const scene = drawing(`diagram "Contained marker" {
    path: freedraw { at = (600, 300); points = ((0, 0), (100, 0)) }
    panel: frame "Panel" {
      marker: rectangle "Marker" { size = (80, 60) }
      attach marker.center to end(path)
    }
  }`);
  const marker = requireElementById(scene.elements, "panel.marker:frame");
  const panel = requireElementById(scene.elements, "panel");
  assert.deepEqual([marker.x + marker.width / 2, marker.y + marker.height / 2], [700, 300]);
  assert.ok(panel.x <= marker.x && panel.x + panel.width >= marker.x + marker.width);
  assert.ok(panel.y <= marker.y && panel.y + panel.height >= marker.y + marker.height);
});

test("attachment anchors are a closed vocabulary", () => {
  for (const anchor of ["centre", "bananas", "northish"]) {
    assert.throws(
      () => drawing(`diagram "" {
        path: freedraw { at = (0, 0); points = ((0, 0), (10, 0)) }
        attach path.${anchor} to (100, 100)
      }`),
      /attach anchor.*not valid/u,
    );
  }
});

test("attachments reject unknown movers and multiple final positions", () => {
  assert.throws(
    () => drawing(`diagram "" { attach ghost.center to (100, 100) }`),
    /XD1290.*unknown element 'ghost'/u,
  );
  assert.throws(
    () => drawing(`diagram "" {
      marker: rectangle "M"
      attach marker.center to (100, 100)
      attach marker.center to (200, 200)
    }`),
    /XD1290.*only one attachment/u,
  );
  assert.throws(
    () => drawing(`diagram "" {
      anchor: rectangle "A"
      marker: rectangle "M" { at = anchor.east + (20, 0) }
      attach marker.center to anchor.south
    }`),
    /XD1290.*both a relative at expression and an attachment/u,
  );
});

test("a path read must be stable and cannot hide an attachment cycle", () => {
  assert.throws(
    () => drawing(`diagram "" {
      stem: freedraw { at = (100, 100); points = ((0, 0), (100, 0)) }
      leaf: freedraw { at = (0, 0); points = ((0, 0), (20, 0)) }
      offset (stem) by (300, 0)
      attach leaf.origin to end(stem)
    }`),
    /XD1290.*geometry statement moves it/u,
  );
  assert.throws(
    () => drawing(`diagram "" {
      stem: freedraw { at = (100, 100); points = ((0, 0), (100, 0)) }
      attach stem.origin to end(stem)
    }`),
    /XD1290.*attachment moves it|XD1272.*cycle/u,
  );
});

test("template-local path expressions are qualified structurally", () => {
  const scene = drawing(`diagram "Template attachment" {
    flower: template() {
      stem: freedraw { at = (100, 200); points = ((0, 0), (0, -100)) }
      head: freedraw { at = (0, 0); points = ((-10, 0), (10, 0)) }
      attach head.center to end(stem)
    }
    rose: flower()
  }`);
  const stem = requireElementById(scene.elements, "rose.stem:stroke");
  const head = requireElementById(scene.elements, "rose.head:stroke");
  assert.equal(head.x + head.width / 2, stem.x + stem.width / 2);
  assert.equal(head.y + head.height / 2, stem.y);
});

test("path values are partially resolved without freezing live box terms", () => {
  const scene = drawing(`diagram "Mixed attachment" {
    path: freedraw { at = (0, 0); points = ((0, 0), (100, 0)) }
    anchor: rectangle "Anchor" { at = (200, 200); size = (120, 80) }
    marker: rectangle "Marker" { size = (80, 60) }
    attach marker.center to end(path) + anchor.east
    offset (anchor) by (100, 0)
  }`);
  const anchor = requireElementById(scene.elements, "anchor:frame");
  const marker = requireElementById(scene.elements, "marker:frame");
  assert.equal(marker.x + marker.width / 2, 100 + anchor.x + anchor.width);
  assert.equal(marker.y + marker.height / 2, anchor.y + anchor.height / 2);
});
