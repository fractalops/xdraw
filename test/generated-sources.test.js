import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { generatedFileMatches } from "../scripts/generate-font-metrics.mjs";

test("generated source freshness fails closed for missing or altered output", async () => {
  const root = await mkdtemp(join(tmpdir(), "xdraw-generated-"));
  const target = join(root, "generated.ts");

  assert.equal(generatedFileMatches(target, "expected\n"), false);
  await writeFile(target, "altered\n");
  assert.equal(generatedFileMatches(target, "expected\n"), false);
  await writeFile(target, "expected\n");
  assert.equal(generatedFileMatches(target, "expected\n"), true);
});
