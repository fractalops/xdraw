import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Drawing } from "../src/document.ts";
import { FONT, arrow, freedraw, image, rectangle, text } from "../src/elements.ts";
import { writeDrawing } from "../src/writer.ts";

test("writeDrawing writes validated pretty JSON with a trailing newline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-writer-"));
  try {
    const path = join(directory, "scene.excalidraw");
    const drawing = new Drawing().add(rectangle("shape", { x: 0, y: 0, width: 100, height: 60 }));
    assert.equal(await writeDrawing(drawing, path), path);
    const payload = await readFile(path, "utf8");
    assert.ok(payload.endsWith("\n"));
    assert.equal(payload, `${JSON.stringify(drawing.toJSON(), null, 2)}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rendering foundation preserves its complete serialized wire shape", async () => {
  const expected = await readFile(
    new URL("fixtures/rendering-foundation.excalidraw", import.meta.url),
    "utf8",
  );
  const drawing = new Drawing({
    backgroundColor: "#ffffff",
    files: {
      file: {
        id: "file",
        dataURL: "data:image/png;base64,AA==",
        mimeType: "image/png",
        created: 1,
        lastRetrieved: 1,
      },
    },
  }).add(
    image("image", { x: 1, y: 2, width: 30, height: 40 }, "file", { description: "Asset" }),
    text("text", [50, 60], "Bold", {
      fontFamily: FONT.bold,
      width: 80,
      height: 20,
      autoResize: false,
    }),
    arrow("line", [0, 0], [20, 10], { type: "line" }),
    arrow("elbow", [10, 10], [40, 30], {
      points: [[10, 10], [40, 10], [40, 30]],
      elbowed: true,
    }),
    freedraw("stroke", [100, 100], [[0, 0], [5, 10]], {
      pressures: [0.25, 0.75],
      simulatePressure: false,
    }),
  );
  assert.equal(`${JSON.stringify(drawing.toJSON(), null, 2)}\n`, expected);
});

test("writeDrawing propagates drawing validation and filesystem failures", async () => {
  const invalid = new Drawing().add(rectangle("bad", { x: 0, y: 0, width: 0, height: 10 }));
  await assert.rejects(writeDrawing(invalid, "/tmp/unused.excalidraw"), /positive width and height/u);

  const directory = await mkdtemp(join(tmpdir(), "xdraw-writer-error-"));
  try {
    const valid = new Drawing().add(rectangle("shape", { x: 0, y: 0, width: 10, height: 10 }));
    await assert.rejects(writeDrawing(valid, directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
