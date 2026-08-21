import assert from "node:assert/strict";
import test from "node:test";

import { parse } from "../src/index.ts";
import { compilePrepared as compile } from "../src/compile/pipeline.ts";

function frameDiagram() {
  return compile(parse(`
    diagram "Native frames" {
      outer: frame "Workspace" {
        locked = true
        a: rectangle "Outer node"
        c: rectangle "Second outer node"
        a -> c
        inner: frame "Detail" {
          b: rectangle "Inner node"
        }
        a -> inner.b
      }
    }
  `)).toJSON();
}

test("native frames preserve nested membership, ordering and inherited locks", () => {
  const result = frameDiagram();
  const byId = new Map(result.elements.map((element) => [element.id, element]));
  const element = (id: string) => {
    const found = byId.get(id);
    assert.ok(found, `missing element ${id}`);
    return found;
  };
  assert.equal(element("outer").type, "frame");
  assert.equal(element("outer.inner").type, "frame");
  assert.equal(element("outer.inner").frameId, "outer");
  assert.equal(element("outer.a:frame").frameId, "outer");
  assert.equal(element("outer.inner.b:frame").frameId, "outer.inner");
  assert.equal(element("outer.a:title").locked, true);
  assert.equal(element("outer.inner").locked, true);
  assert.deepEqual(result.appState.frameRendering, { enabled: true, clip: true, name: true, outline: true });

  const descendants = new Set(["outer"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of result.elements) {
      if (element.frameId && descendants.has(element.frameId) && !descendants.has(element.id)) {
        descendants.add(element.id);
        changed = true;
      }
    }
  }
  const outerRange = result.elements.filter((element) => descendants.has(element.id));
  const outerIndices = outerRange.map((element) => result.elements.indexOf(element));
  assert.equal(Math.max(...outerIndices) - Math.min(...outerIndices) + 1, outerIndices.length);
  assert.ok(result.elements.indexOf(element("outer.inner")) > result.elements.indexOf(element("outer.inner.b:title")));
  assert.ok(result.elements.indexOf(element("outer")) > result.elements.indexOf(element("outer.inner")));
});

test("same-frame connectors are contained and cross-frame connectors stay at root", () => {
  const arrows = frameDiagram().elements.filter((element) => element.type === "arrow");
  assert.equal(arrows.length, 2);
  assert.equal(arrows[0].frameId, "outer");
  assert.equal(arrows[0].locked, true);
  assert.equal(arrows[1].frameId, null);
  assert.equal(arrows[1].locked, true);
});

test("frame validation rejects unknown properties", () => {
  assert.throws(
    () => compile(parse('diagram "Bad" { f: frame "F" { mystery = true; a: rectangle "A" } }')),
    /constructor 'frame' does not accept property 'mystery'/,
  );
});
