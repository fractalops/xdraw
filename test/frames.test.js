import assert from "node:assert/strict";
import test from "node:test";

import { compile, parse } from "../src/index.js";

function frameDiagram() {
  return compile(parse(`
    diagram "Native frames" {
      frame outer "Workspace" [locked] {
        a: card "Outer node"
        c: card "Second outer node"
        a -> c
        frame inner "Detail" {
          b: card "Inner node"
        }
        a -> b
      }
    }
  `)).toJSON();
}

test("native frames preserve nested membership, ordering and inherited locks", () => {
  const result = frameDiagram();
  const byId = new Map(result.elements.map((element) => [element.id, element]));
  assert.equal(byId.get("outer").type, "frame");
  assert.equal(byId.get("inner").type, "frame");
  assert.equal(byId.get("inner").frameId, "outer");
  assert.equal(byId.get("a:frame").frameId, "outer");
  assert.equal(byId.get("b:frame").frameId, "inner");
  assert.equal(byId.get("a:title").locked, true);
  assert.equal(byId.get("inner").locked, true);
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
  assert.ok(result.elements.indexOf(byId.get("inner")) > result.elements.indexOf(byId.get("b:title")));
  assert.ok(result.elements.indexOf(byId.get("outer")) > result.elements.indexOf(byId.get("inner")));
});

test("same-frame connectors are contained and cross-frame connectors stay at root", () => {
  const arrows = frameDiagram().elements.filter((element) => element.type === "arrow");
  assert.equal(arrows.length, 2);
  assert.equal(arrows[0].frameId, "outer");
  assert.equal(arrows[0].locked, true);
  assert.equal(arrows[1].frameId, null);
  assert.equal(arrows[1].locked, true);
});

test("frame validation rejects unsupported attributes", () => {
  assert.throws(
    () => compile(parse('diagram "Bad" { frame f "F" [mystery] { a: card "A" } }')),
    /unsupported frame attributes: mystery/,
  );
  assert.throws(
    () => compile(parse('diagram "Bad" { frame f "F" [clip] { a: card "A" } }')),
    /unsupported frame attributes: clip/,
  );
});
