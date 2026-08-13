import assert from "node:assert/strict";
import test from "node:test";

import { resolveAssets } from "../src/assets.js";
import { compile } from "../src/compiler.js";
import { MemoryFileSystem } from "../src/filesystem.js";
import { parseSource as parse } from "../src/source-language.js";
import { buildSemanticIR } from "../src/semantic.js";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/></svg>';

test("local assets become deterministic offline Excalidraw files", async () => {
  const filesystem = new MemoryFileSystem({ "logo.svg": SVG });
  const source = `use "xdraw/assets" as assets
  diagram "Assets" {
    logo: asset "logo.svg"
    hero: image(logo) { at (100, 100); size (240, 120); fit contain; alt "Example logo" }
    mark: assets.icon(logo) { at (380, 100); size (60, 60); fit contain }
  }`;
  const first = compile(await resolveAssets(parse(source), filesystem)).toJSON();
  const second = compile(await resolveAssets(parse(source), filesystem)).toJSON();
  assert.deepEqual(first, second);
  assert.equal(Object.keys(first.files).length, 1);
  assert.match(Object.values(first.files)[0].dataURL, /^data:image\/svg\+xml;base64,/);
  const hero = first.elements.find((item) => item.id === "hero");
  assert.equal(hero.type, "image");
  assert.equal(hero.customData.description, "Example logo");
  assert.equal(hero.fileId, first.elements.find((item) => item.id === "mark").fileId);
});

test("asset limits and malformed content fail with bounded messages", async () => {
  const filesystem = new MemoryFileSystem({
    "active.svg": '<svg width="10" height="10"><script>alert(1)</script></svg>',
    "large.svg": SVG,
  });
  await assert.rejects(
    () => resolveAssets(parse('diagram "Unsafe" { bad: asset "active.svg"; x: image(bad) { at (0,0); size (10,10) } }'), filesystem),
    /may not contain executable or remote content/,
  );
  for (const active of [
    '<svg width="10" height="10" onload="alert(1)"/>',
    '<svg width="10" height="10"><image href="//example.com/x.png"/></svg>',
    '<svg width="10" height="10"><style>@import url(https://example.com/x.css)</style></svg>',
  ]) {
    await assert.rejects(
      () => resolveAssets(parse('diagram "Unsafe" { bad: asset "active.svg" }'), new MemoryFileSystem({ "active.svg": active })),
      /may not contain executable or remote content/,
    );
  }
  await assert.rejects(
    () => resolveAssets(parse('diagram "Large" { big: asset "large.svg"; x: image(big) { at (0,0); size (10,10) } }'), filesystem, { fileBytes: 10 }),
    /exceeds the 10-byte file limit/,
  );
});

test("asset files survive the semantic IR boundary", async () => {
  const filesystem = new MemoryFileSystem({ "logo.svg": SVG });
  const resolved = await resolveAssets(
    parse('diagram "Boundary" { logo: asset "logo.svg"; hero: image(logo) { at (0,0); size (80,40) } }'),
    filesystem,
  );
  const drawing = compile(buildSemanticIR(resolved)).toJSON();
  assert.equal(Object.keys(drawing.files).length, 1);
  assert.equal(drawing.elements.find((item) => item.id === "hero").fileId, Object.keys(drawing.files)[0]);
});

test("images reject non-positive target dimensions", async () => {
  const filesystem = new MemoryFileSystem({ "logo.svg": SVG });
  for (const size of ["(-10,20)", "(0,20)"]) {
    const resolved = await resolveAssets(
      parse(`diagram "Dimensions" { logo: asset "logo.svg"; hero: image(logo) { at (0,0); size ${size} } }`),
      filesystem,
    );
    assert.throws(() => compile(resolved), /requires finite positive dimensions/);
  }
});

test("data URL assets require no filesystem access", async () => {
  const data = `data:image/svg+xml,${encodeURIComponent(SVG)}`;
  const document = await resolveAssets(
    parse(`diagram "Inline" { inline: asset "${data}"; picture: image(inline) { at (0,0); size (80,40) } }`),
    new MemoryFileSystem(),
  );
  assert.equal(Object.keys(compile(document).toJSON().files).length, 1);
});

test("asset paths and nested image membership stay within their declared boundaries", async () => {
  const filesystem = new MemoryFileSystem({ "logo.svg": SVG });
  await assert.rejects(
    () => resolveAssets(parse('diagram "Absolute" { bad: asset "/tmp/logo.svg" }'), filesystem),
    /path must be relative/,
  );
  const source = `diagram "Nested" {
    logo: asset "logo.svg"
    panel: frame "Panel" { locked true; nested: image(logo) { at (100,100); size (80,40) } }
  }`;
  const drawing = compile(await resolveAssets(parse(source), filesystem)).toJSON();
  const nested = drawing.elements.find((item) => item.id === "panel.nested");
  assert.equal(nested.frameId, "panel");
  assert.equal(nested.locked, true);
});
