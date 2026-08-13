import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { compile } from "../src/compiler.js";
import { parseSceneDocument } from "../src/scene-document.js";
import { parseSource } from "../src/source-language.js";

for (const file of [
  "README.md",
  "docs/excalidraw-plus-integration.md",
  "docs/language-reference.md",
]) {
  test(`${file} contains parseable XDraw examples`, async () => {
    const source = await readFile(file, "utf8");
    const examples = [...source.matchAll(/```xdraw\n([\s\S]*?)```/g)].map((match) => match[1]);
    assert.ok(examples.length >= 1);
    examples.forEach((example) => {
      if (example.trimStart().startsWith("scene ")) parseSceneDocument(example);
      else compile(parseSource(example)).toJSON();
    });
  });
}
