import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveAssets } from "../src/assets.ts";
import { compileAsync } from "../src/compiler.ts";
import { RootedFileSystem } from "../src/filesystem.ts";
import { parseSceneDocument } from "../src/scene-document.ts";
import { parseSource } from "../src/source-language.ts";

for (const file of [
  "README.md",
  "docs/excalidraw-plus-integration.md",
  "docs/language-reference.md",
  "docs/spec.md",
]) {
  test(`${file} contains parseable XDraw examples`, async () => {
    const source = await readFile(file, "utf8");
    const examples = [...source.matchAll(/```xdraw\n([\s\S]*?)```/g)].map((match) => match[1]);
    assert.ok(examples.length >= 1);
    for (const example of examples) {
      if (example.trimStart().startsWith("scene ")) parseSceneDocument(example);
      else (await compileAsync(await resolveAssets(parseSource(example), new RootedFileSystem(process.cwd())))).toJSON();
    }
  });
}
