import assert from "node:assert/strict";
import test from "node:test";

import { compile } from "../src/compiler.js";
import { expandDocument, loadDocument } from "../src/expander.js";
import { MemoryFileSystem } from "../src/filesystem.js";
import { parse } from "../src/parser.js";
import { resolveAssets } from "../src/assets.js";

test("components expand with hygienic identifiers and bound parameters", () => {
  const source = `diagram "Reuse" {
    component service(name) {
      api: system "{name} API"
      db: database "{name} data"
      api -> db "stores"
    }
    use service orders [name="Orders"]
    use service claims [name="Claims"]
  }`;
  const expanded = expandDocument(parse(source));
  assert.deepEqual(expanded.statements.filter((item) => item.type === "node").map((item) => item.id), [
    "orders.api", "orders.db", "claims.api", "claims.db",
  ]);
  assert.deepEqual(expanded.statements.find((item) => item.type === "connection").nodes, ["orders.api", "orders.db"]);
  const drawing = compile(expanded).toJSON();
  assert.ok(drawing.elements.some((item) => item.id === "orders.api:frame"));
  assert.ok(drawing.elements.some((item) => item.id === "claims.api:frame"));
});

test("component diagnostics identify parameters and expansion cycles", () => {
  assert.throws(
    () => expandDocument(parse('component c(name) { n: card "{name}" }; use c one')),
    /component 'c' at 'one'.*is missing parameters: name/,
  );
  assert.throws(
    () => expandDocument(parse('component a() { use b nested }; component b() { use a nested }; use a root')),
    /component cycle: a -> b -> a/,
  );
});

test("components may compose other components without leaking nested ids", () => {
  const expanded = expandDocument(parse(`diagram "Composition" {
    component leaf(name) { node: card "{name}" }
    component pair(name) { use leaf left [name="{name} left"]; use leaf right [name="{name} right"] }
    use pair first [name="First"]
    use pair second [name="Second"]
  }`));
  assert.deepEqual(expanded.statements.map((item) => item.id), [
    "first.left.node", "first.right.node", "second.left.node", "second.right.node",
  ]);
  assert.throws(
    () => expandDocument(parse('lane nested "Nested" { component invalid() { n: card "N" } }')),
    /must be declared at document scope/,
  );
});

test("nested component references and local styles remain hygienic", () => {
  const drawing = compile(parse(`
    component leaf() { node: card "N" }
    component wrapper() {
      style local { stroke "#dc2626" }
      use leaf inner
      note n "Hi" at inner.node.right
      styled: card "Styled" [style=local]
    }
    use wrapper outer
    use wrapper second
  `)).toJSON();
  assert.ok(drawing.elements.some((item) => item.id === "outer.inner.node:frame"));
  assert.ok(drawing.elements.some((item) => item.id === "second.inner.node:frame"));
});

test("assets resolve after component expansion", async () => {
  const filesystem = new MemoryFileSystem({ "logo.svg": '<svg width="10" height="10"/>' });
  const resolved = await resolveAssets(parse(`
    component badge(path) {
      asset logo "{path}"
      image mark logo at (0,0) size (20,20)
    }
    component unused() { asset missing "missing.svg" }
    use badge first [path="logo.svg"]
  `), filesystem);
  const drawing = compile(resolved).toJSON();
  assert.ok(drawing.elements.some((item) => item.id === "first.mark"));
  assert.equal(Object.keys(drawing.files).length, 1);
});

test("rooted imports resolve deterministically and report complete cycles", async () => {
  const filesystem = new MemoryFileSystem({
    "main.xdraw": 'diagram "Imported" { import "parts/service.xdraw"; use service orders [name="Orders"] }',
    "parts/service.xdraw": 'component service(name) { api: system "{name}" }',
  });
  const document = await loadDocument("main.xdraw", filesystem);
  assert.ok(compile(document).toJSON().elements.some((item) => item.id === "orders.api:frame"));

  const cyclic = new MemoryFileSystem({
    "a.xdraw": 'import "b.xdraw"',
    "b.xdraw": 'import "a.xdraw"',
  });
  await assert.rejects(() => loadDocument("a.xdraw", cyclic), /import cycle: a.xdraw -> b.xdraw -> a.xdraw/);
  await assert.rejects(() => loadDocument("/outside.xdraw", filesystem), /path must be relative/);
});

test("unresolved imports fail instead of silently disappearing", () => {
  assert.throws(
    () => compile(parse('diagram "Unloaded" { import "parts.xdraw" }')),
    /unresolved import 'parts.xdraw'/,
  );
});
