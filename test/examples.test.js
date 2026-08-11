import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { run } from "../src/cli.js";
import { parseSceneDocument } from "../src/scene-document.js";

const examples = resolve("examples");

for (const entry of await readdir(examples, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".xdraw")) continue;
  test(`example ${entry.name} is runnable`, async () => {
    const file = resolve(examples, entry.name);
    if (entry.name.endsWith(".scene.xdraw")) {
      const source = await readFile(file, "utf8");
      assert.equal(parseSceneDocument(source).operation.type, "replace");
      return;
    }
    assert.equal(await run(["check", file]), `OK ${file}`);
  });
}
