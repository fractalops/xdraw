import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { compile } from "../src/compiler.js";
import { resolveAssets } from "../src/assets.js";
import { loadDocument } from "../src/expander.js";
import { RootedFileSystem } from "../src/filesystem.js";
import { measureTextWidth } from "../src/text-metrics.js";

const root = path.resolve("corpus");
const entries = JSON.parse(await readFile(path.join(root, "corpus.json"), "utf8"));
const expected = JSON.parse(await readFile(path.join(root, "expected-output.json"), "utf8"));

test("corpus contains eighteen distinct representative diagrams", () => {
  assert.equal(entries.length, 18);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
  assert.equal(entries.filter((entry) => entry.status === "supported").length, 18);
});

for (const entry of entries) {
  test(`corpus entry ${entry.id} is documented and present`, async () => {
    const source = await readFile(path.join(root, entry.file), "utf8");
    assert.ok(source.trim().startsWith("diagram"));
    assert.ok(entry.tests.length > 0);
  });

  if (entry.status === "supported") {
    test(`supported corpus entry ${entry.id} compiles deterministically`, async () => {
      const filesystem = new RootedFileSystem(root);
      const first = JSON.stringify(compile(await resolveAssets(await loadDocument(entry.file, filesystem), filesystem)).toJSON());
      const second = JSON.stringify(compile(await resolveAssets(await loadDocument(entry.file, filesystem), filesystem)).toJSON());
      assert.equal(first, second);
      const scene = JSON.parse(first);
      assert.ok(scene.elements.length > 0);
      for (const element of scene.elements.filter((item) => item.type === "text" && item.autoResize === false)) {
        const measured = Math.max(...element.text.split("\n").map((line) => (
          measureTextWidth(line, element.fontSize, element.fontFamily)
        )), 0);
        assert.ok(measured <= element.width + 1, `${entry.id}:${element.id} text exceeds its content width`);
      }
      assert.equal(
        crypto.createHash(expected.algorithm).update(first).digest("hex"),
        expected.diagrams[entry.id],
        "compiled output changed; inspect the scene diff before accepting a new fingerprint",
      );
    });
  }
}
