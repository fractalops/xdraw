import assert from "node:assert/strict";
import test from "node:test";

import { mergeEmbeddedAssetFiles, resolveAssets } from "../src/io/assets.ts";
import { compilePrepared as compile } from "../src/compile/pipeline.ts";
import { MemoryFileSystem } from "../src/io/filesystem.ts";
import { parseSource as parse } from "../src/language/parser.ts";
import { buildSemanticIR } from "../src/language/semantic.ts";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/></svg>';

function embeddedSvg(id: string, svg = SVG) {
  return {
    id,
    dataURL: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    mimeType: "image/svg+xml" as const,
    created: 1,
    lastRetrieved: 1,
  };
}

test("local assets become deterministic offline Excalidraw files", async () => {
  const filesystem = new MemoryFileSystem({ "logo.svg": SVG });
  const source = `use "xdraw/assets" as assets
  diagram "Assets" {
    logo: asset "logo.svg"
    hero: image(logo) { at = (100, 100); size = (240, 120); fit = contain; alt = "Example logo" }
    mark: assets.icon(logo) { at = (380, 100); size = (60, 60); fit = contain }
  }`;
  const first = compile(await resolveAssets(parse(source), filesystem)).toJSON();
  const second = compile(await resolveAssets(parse(source), filesystem)).toJSON();
  assert.deepEqual(first, second);
  assert.equal(Object.keys(first.files).length, 1);
  const [file] = Object.values(first.files);
  assert.ok(file);
  assert.match(file.dataURL, /^data:image\/svg\+xml;base64,/);
  const hero = first.elements.find((item) => item.id === "hero");
  const mark = first.elements.find((item) => item.id === "mark");
  assert.ok(hero?.type === "image");
  assert.ok(mark?.type === "image");
  assert.equal(hero.customData?.description, "Example logo");
  assert.equal(hero.fileId, mark.fileId);
});

test("asset limits and malformed content fail with bounded messages", async () => {
  const filesystem = new MemoryFileSystem({
    "active.svg": '<svg width="10" height="10"><script>alert(1)</script></svg>',
    "large.svg": SVG,
  });
  await assert.rejects(
    () => resolveAssets(parse('diagram "Unsafe" { bad: asset "active.svg"; x: image(bad) { at = (0,0); size = (10,10) } }'), filesystem),
    /may not contain executable or remote content/,
  );
  for (const active of [
    '<svg width="10" height="10" onload="alert(1)"/>',
    '<svg width="10" height="10"><image href="//example.com/x.png"/></svg>',
    '<svg width="10" height="10"><style>@import url(https://example.com/x.css)</style></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg" width="10" height="10"><s:script/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect style="fill:u\\72l(https://example.com/x)"/></svg>',
  ]) {
    await assert.rejects(
      () => resolveAssets(parse('diagram "Unsafe" { bad: asset "active.svg" }'), new MemoryFileSystem({ "active.svg": active })),
      /may not contain executable or remote content/,
    );
  }
  await assert.rejects(
    () => resolveAssets(parse('diagram "Large" { big: asset "large.svg"; x: image(big) { at = (0,0); size = (10,10) } }'), filesystem, { fileBytes: 10 }),
    /exceeds the 10-byte file limit/,
  );
});

test("design-tool exports are accepted despite their inert root metadata", async () => {
  // Illustrator and Sketch stamp version="1.1" and an xlink namespace onto
  // everything they export, which is how most published icon sets arrive.
  // Neither can carry a URL or a script, so refusing them turned real icons
  // away over metadata.
  const exported = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
    + ' width="80px" height="80px" viewBox="0 0 80 80" version="1.1">'
    + '<title>Icon</title><g fill="none"><rect width="80" height="80" fill="#8C4FFF"/></g></svg>';
  const drawing = compile(await resolveAssets(
    parse('diagram "Icons" { mark: asset "mark.svg"; hero: image(mark) { at = (0,0); size = (80,80) } }'),
    new MemoryFileSystem({ "mark.svg": exported }),
  )).toJSON();
  assert.equal(Object.keys(drawing.files).length, 1);
  assert.equal(drawing.elements.find((item) => item.id === "hero")?.type, "image");

  // The allowance is for 'version' alone; a style attribute still carries CSS.
  await assert.rejects(
    () => resolveAssets(
      parse('diagram "Unsafe" { bad: asset "bad.svg" }'),
      new MemoryFileSystem({ "bad.svg": exported.replace("version=", "style=\"fill:red\" version=") }),
    ),
    /may not contain executable or remote content/,
  );
});

test("asset files survive the semantic IR boundary", async () => {
  const filesystem = new MemoryFileSystem({ "logo.svg": SVG });
  const resolved = await resolveAssets(
    parse('diagram "Boundary" { logo: asset "logo.svg"; hero: image(logo) { at = (0,0); size = (80,40) } }'),
    filesystem,
  );
  const drawing = compile(buildSemanticIR(resolved)).toJSON();
  assert.equal(Object.keys(drawing.files).length, 1);
  const hero = drawing.elements.find((item) => item.id === "hero");
  assert.ok(hero?.type === "image");
  assert.equal(hero.fileId, Object.keys(drawing.files)[0]);
});

test("images reject non-positive target dimensions", async () => {
  const filesystem = new MemoryFileSystem({ "logo.svg": SVG });
  for (const size of ["(-10,20)", "(0,20)"]) {
    const resolved = await resolveAssets(
      parse(`diagram "Dimensions" { logo: asset "logo.svg"; hero: image(logo) { at = (0,0); size = ${size} } }`),
      filesystem,
    );
    assert.throws(() => compile(resolved), /requires finite positive dimensions/);
  }
});

test("data URL assets require no filesystem access", async () => {
  const data = `data:image/svg+xml,${encodeURIComponent(SVG)}`;
  const document = await resolveAssets(
    parse(`diagram "Inline" { inline: asset "${data}"; picture: image(inline) { at = (0,0); size = (80,40) } }`),
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
    panel: frame "Panel" { locked = true; nested: image(logo) { at = (100,100); size = (80,40) } }
  }`;
  const drawing = compile(await resolveAssets(parse(source), filesystem)).toJSON();
  const nested = drawing.elements.find((item) => item.id === "panel.nested");
  assert.ok(nested);
  assert.equal(nested.frameId, "panel");
  assert.equal(nested.locked, true);
});

test("final scene assets reject identity conflicts and share one aggregate budget", () => {
  const first = embeddedSvg("same");
  const conflicting = embeddedSvg(
    "same",
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><circle r="10"/></svg>',
  );
  assert.throws(
    () => mergeEmbeddedAssetFiles([{ same: first }, { same: conflicting }]),
    /asset file 'same' has conflicting content/u,
  );
  assert.throws(
    () => mergeEmbeddedAssetFiles([{ one: embeddedSvg("one") }, { two: embeddedSvg("two") }], {
      aggregateBytes: new TextEncoder().encode(SVG).length,
    }),
    /assets exceed the .* document limit/u,
  );
  const oversized = embeddedSvg("oversized");
  oversized.dataURL = `data:image/svg+xml;base64,${"A".repeat(64)}`;
  assert.throws(
    () => mergeEmbeddedAssetFiles([{ oversized }], { fileBytes: 4 }),
    /asset data exceeds the 4-byte file limit/u,
  );
});
