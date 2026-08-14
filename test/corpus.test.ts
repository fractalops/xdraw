import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { compileAsync } from "../src/pipeline.ts";
import { resolveAssets } from "../src/io/assets.ts";
import { RootedFileSystem } from "../src/io/filesystem.ts";
import { parseSource } from "../src/language/parser.ts";
import { measureTextWidth } from "../src/text/metrics.ts";

const root = path.resolve("corpus");
const entries = JSON.parse(await readFile(path.join(root, "corpus.json"), "utf8"));
const expected = JSON.parse(await readFile(path.join(root, "expected-output.json"), "utf8"));

test("corpus contains distinct representative diagrams", () => {
  assert.ok(entries.length > 0);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
});

for (const entry of entries) {
  test(`corpus entry ${entry.id} is documented and present`, async () => {
    const source = await readFile(path.join(root, entry.file), "utf8");
    assert.match(source.trim(), /^(?:use\s+"[^"]+"\s+as\s+\w+\s+)*diagram\s+/u);
    assert.ok(entry.tests.length > 0);
  });

  test(`corpus entry ${entry.id} compiles deterministically`, async () => {
    const sourcePath = path.join(root, entry.file);
    const filesystem = new RootedFileSystem(path.dirname(sourcePath));
    const source = await filesystem.readText(path.basename(sourcePath));
    const document = await resolveAssets(parseSource(source), filesystem);
    const first = JSON.stringify((await compileAsync(document)).toJSON());
    const second = JSON.stringify((await compileAsync(document)).toJSON());
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
