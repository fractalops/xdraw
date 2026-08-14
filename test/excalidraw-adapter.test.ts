import assert from "node:assert/strict";
import test from "node:test";

import { tone } from "../src/components.ts";
import { compile } from "../src/pipeline.ts";
import { Drawing } from "../src/document.ts";
import { image } from "../src/elements.ts";
import {
  renderableFreedraw,
  renderFreedraw,
  renderImage,
  renderSceneVisuals,
} from "../src/excalidraw-adapter.ts";
import { parseSource } from "../src/source-language.ts";

const embeddedFile = {
  id: "asset-file",
  dataURL: "data:image/png;base64,AA==",
  mimeType: "image/png",
  created: 1,
  lastRetrieved: 1,
};

function imageStatement(overrides = {}) {
  return {
    type: "image",
    id: "hero",
    asset: "logo",
    at: [10, 20],
    size: [200, 100],
    attributes: {},
    resolvedAsset: {
      fileId: embeddedFile.id,
      mimeType: "image/png",
      width: 400,
      height: 200,
      bytes: 1,
    },
    ...overrides,
  };
}

test("images require a matching embedded file and valid natural dimensions", () => {
  assert.throws(
    () => renderImage(new Drawing(), imageStatement()),
    /references missing embedded file 'asset-file'/,
  );
  assert.throws(
    () => renderImage(new Drawing({ files: { "asset-file": { ...embeddedFile, id: "other" } } }), imageStatement()),
    /references missing embedded file 'asset-file'/,
  );
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const drawing = new Drawing({ files: { "asset-file": embeddedFile } });
    const statement = imageStatement({
      resolvedAsset: { ...imageStatement().resolvedAsset, width: value },
    });
    assert.throws(() => renderImage(drawing, statement), /invalid natural dimensions/);
  }
});

test("image fit modes preserve finite positive output geometry", () => {
  for (const fit of ["contain", "cover", "fill"]) {
    const drawing = new Drawing({ files: { "asset-file": embeddedFile } });
    renderImage(drawing, imageStatement({ attributes: { fit } }));
    const element = drawing.validate().elements[0];
    assert.ok([element.x, element.y, element.width, element.height].every(Number.isFinite));
    assert.ok(element.width > 0);
    assert.ok(element.height > 0);
  }
});

test("drawing validation rejects image elements without embedded files", () => {
  const drawing = new Drawing();
  drawing.add(image("hero", { x: 0, y: 0, width: 100, height: 50 }, "missing"));
  assert.throws(() => drawing.validate(), /references missing embedded file missing/);
});

test("ordinary frames render their declared tone", () => {
  for (const name of ["neutral", "success", "danger", "warning", "info", "accent"]) {
    const drawing = new Drawing();
    renderSceneVisuals(drawing, [{
      type: "frame",
      id: `frame-${name}`,
      bounds: { x: 0, y: 0, width: 300, height: 180 },
      title: name,
      tone: name,
    }]);
    const element = drawing.elements[0];
    assert.equal(element.strokeColor, tone(name).stroke);
    assert.equal(element.backgroundColor, tone(name).background);
  }
});

test("compact decision nodes fail before rendering", () => {
  assert.throws(
    () => compile(parseSource('diagram "Decision" { gate: diamond "Proceed?" { at (20, 20); size (60, 40) } }')),
    /decision size must be at least 96 by 72/,
  );
});

test("freedraw rendering returns the precise element kind", () => {
  const drawing = new Drawing();
  const statement = renderableFreedraw({
    type: "freedraw",
    id: "stroke",
    at: [0, 0],
    points: [[0, 0], [10, 10]],
    pressures: [],
    simulatePressure: true,
    attributes: {},
  });
  assert.equal(renderFreedraw(drawing, statement).type, "freedraw");
});
