import assert from "node:assert/strict";
import test from "node:test";

import { Drawing } from "../src/excalidraw/document.ts";
import { arrow, frame, rectangle, text } from "../src/excalidraw/elements.ts";

const box = (x: number, y: number, width = 100, height = 60) => ({ x, y, width, height });

test("Drawing.add recursively flattens optional element collections", () => {
  const first = rectangle("first", box(0, 0));
  const second = rectangle("second", box(120, 0));
  const drawing = new Drawing().add(first, [null, [false, second]], undefined);
  assert.deepEqual(drawing.elements.map((element) => element.id), ["first", "second"]);
});

test("drawing registers linear bindings once and rejects unknown targets", () => {
  const source = rectangle("source", box(0, 0));
  const target = rectangle("target", box(200, 0));
  const flow = arrow("flow", [100, 30], [200, 30], {
    startBinding: { elementId: "source" },
    endBinding: { elementId: "target" },
  });
  const drawing = new Drawing().add(source, target, flow);
  drawing.toJSON();
  drawing.toJSON();
  assert.deepEqual(source.boundElements, [{ type: "arrow", id: "flow" }]);
  assert.deepEqual(target.boundElements, [{ type: "arrow", id: "flow" }]);

  const invalid = new Drawing().add(arrow("missing", [0, 0], [10, 0], {
    endBinding: { elementId: "unknown" },
  }));
  assert.throws(() => invalid.toJSON(), /binds to unknown element unknown/u);
});

test("drawing validates frame membership and orders nested frames idempotently", () => {
  const outer = frame("outer", box(0, 0, 400, 300), "Outer");
  const inner = frame("inner", box(40, 40, 300, 200), "Inner", { frameId: "outer" });
  const child = rectangle("child", box(80, 80), { frameId: "inner" });
  const drawing = new Drawing().add(outer, inner, child);
  const first = drawing.toJSON().elements.map((element) => element.id);
  const second = drawing.toJSON().elements.map((element) => element.id);
  assert.deepEqual(first, ["child", "inner", "outer"]);
  assert.deepEqual(second, first);

  assert.throws(
    () => new Drawing().add(rectangle("orphan", box(0, 0), { frameId: "missing" })).toJSON(),
    /belongs to unknown frame missing/u,
  );
  assert.throws(
    () => new Drawing().add(frame("self", box(0, 0), "Self", { frameId: "self" })).toJSON(),
    /cannot contain itself/u,
  );
  assert.throws(
    () => new Drawing().add(
      frame("a", box(0, 0), "A", { frameId: "b" }),
      frame("b", box(20, 20), "B", { frameId: "a" }),
    ).toJSON(),
    /cyclic frame membership/u,
  );
});

test("drawing serializes stable application state, files, and non-public diagnostics", () => {
  const files = {
    logo: {
      id: "logo",
      dataURL: "data:image/png;base64,AA==",
      mimeType: "image/png" as const,
      created: 1,
      lastRetrieved: 1,
    },
  };
  const diagnostics = [{
    code: "XD0001",
    severity: "warning" as const,
    message: "Example",
    location: null,
  }];
  const plain = new Drawing({
    backgroundColor: "#ffffff",
    gridSize: 10,
    gridStep: 2,
    gridModeEnabled: true,
    files,
    diagnostics,
  }).add(text("label", [10, 20], "Label"));
  const json = plain.toJSON();
  assert.deepEqual(json.appState, {
    gridSize: 10,
    gridStep: 2,
    gridModeEnabled: true,
    viewBackgroundColor: "#ffffff",
  });
  assert.equal(json.files, files);
  assert.equal(plain.diagnostics, diagnostics);
  assert.equal(plain.measurements, null);
  assert.equal(Object.keys(plain).includes("diagnostics"), false);
  assert.equal(Object.keys(plain).includes("measurements"), false);
  assert.equal(JSON.stringify(json).includes("XD0001"), false);

  const framed = new Drawing().add(frame("frame", box(0, 0), "Frame")).toJSON();
  assert.deepEqual(framed.appState.frameRendering, {
    enabled: true,
    clip: true,
    name: true,
    outline: true,
  });
});
