import assert from "node:assert/strict";
import test from "node:test";

import { compile, parse } from "../src/index.ts";

function frameDiagram() {
  return compile(parse(`
    diagram "Native frames" {
      outer: frame "Workspace" {
        locked true
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
  assert.equal(byId.get("outer").type, "frame");
  assert.equal(byId.get("outer.inner").type, "frame");
  assert.equal(byId.get("outer.inner").frameId, "outer");
  assert.equal(byId.get("outer.a:frame").frameId, "outer");
  assert.equal(byId.get("outer.inner.b:frame").frameId, "outer.inner");
  assert.equal(byId.get("outer.a:title").locked, true);
  assert.equal(byId.get("outer.inner").locked, true);
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
  assert.ok(result.elements.indexOf(byId.get("outer.inner")) > result.elements.indexOf(byId.get("outer.inner.b:title")));
  assert.ok(result.elements.indexOf(byId.get("outer")) > result.elements.indexOf(byId.get("outer.inner")));
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
    () => compile(parse('diagram "Bad" { f: frame "F" { mystery true; a: rectangle "A" } }')),
    /constructor 'frame' does not accept property 'mystery'/,
  );
});
