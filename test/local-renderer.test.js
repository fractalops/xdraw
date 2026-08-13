import assert from "node:assert/strict";
import test from "node:test";

import { renderScenePng, renderSceneSvg } from "../src/local-renderer.ts";

const scene = {
  type: "excalidraw",
  version: 2,
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
  elements: [
    { id: "frame", type: "frame", x: 0, y: 0, width: 240, height: 160, name: "Main" },
    {
      id: "box", type: "rectangle", frameId: "frame", x: 20, y: 40, width: 120, height: 60,
      strokeColor: "#1f2937", backgroundColor: "#dbeafe", strokeWidth: 2, opacity: 100,
    },
    {
      id: "label", type: "text", frameId: "frame", x: 40, y: 55, width: 80, height: 24,
      text: "A < B", fontSize: 18, strokeColor: "#111827", opacity: 100,
    },
    { id: "outside", type: "ellipse", x: 400, y: 0, width: 100, height: 100 },
  ],
};

test("local SVG renderer escapes text and can select one frame", () => {
  const svg = renderSceneSvg(scene, { frameId: "frame", padding: 20, maxWidth: 300 });
  assert.match(svg, /^<svg/);
  assert.match(svg, /A &lt; B/);
  assert.doesNotMatch(svg, /<ellipse/);
});

test("local renderer can preserve a transparent preview background", () => {
  const svg = renderSceneSvg(scene, { backgroundColor: "transparent" });
  assert.doesNotMatch(svg, /<rect width="100%" height="100%"/);
});

test("local PNG renderer returns a real PNG", () => {
  const png = renderScenePng(scene, { padding: 20 });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("local renderer rejects invalid frame and padding selectors", () => {
  assert.throws(() => renderSceneSvg(scene, { frameId: "missing" }), /does not contain frame/);
  assert.throws(() => renderSceneSvg(scene, { padding: -1 }), /non-negative/);
  assert.throws(() => renderSceneSvg(scene, { backgroundColor: "" }), /non-empty string/);
});

test("local renderer rejects malformed external scene data", () => {
  assert.throws(() => renderSceneSvg(null), /scene must be an object/);
  assert.throws(
    () => renderSceneSvg({ elements: [{ id: "bad", type: "rectangle", x: 0, y: 0, width: Number.NaN, height: 20 }] }),
    /element 'bad' width must be a finite number/,
  );
  assert.throws(
    () => renderSceneSvg({ elements: [{ id: "line", type: "line", x: 0, y: 0, width: 20, height: 20, points: [[0, 0], [20]] }] }),
    /points\[1\] must be an \[x, y\] point/,
  );
  assert.throws(
    () => renderSceneSvg({ elements: [{ id: "logo", type: "image", x: 0, y: 0, width: 20, height: 20, fileId: "missing" }] }),
    /references missing scene file 'missing'/,
  );
  assert.throws(() => renderSceneSvg(scene, { maxWidth: 0 }), /maxWidth must be a positive number/);
});
