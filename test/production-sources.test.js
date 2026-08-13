import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { productionSourceViolations } from "../scripts/check-production-sources.mjs";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

test("production source policy accepts TypeScript-only trees", async () => {
  const root = await mkdtemp(join(tmpdir(), "xdraw-ts-sources-"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "index.ts"), "export {};\n");
  await writeFile(join(root, "nested", "types.ts"), "export type Value = string;\n");

  assert.deepEqual(await productionSourceViolations(root), []);
});

test("production source policy rejects JavaScript and declaration bridges", async () => {
  const root = await mkdtemp(join(tmpdir(), "xdraw-mixed-sources-"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "legacy.js"), "export {};\n");
  await writeFile(join(root, "nested", "legacy.d.ts"), "export {};\n");
  await writeFile(join(root, "nested", "valid.ts"), "export {};\n");

  assert.deepEqual(await productionSourceViolations(root), ["legacy.js", "nested/legacy.d.ts"]);
});

test("internal modules import contracts from their owning stage", async () => {
  const sourceRoot = join(root, "src");
  const violations = [];
  for (const entry of await readdir(sourceRoot)) {
    if (!entry.endsWith(".ts") || entry === "index.ts" || entry === "contracts.ts") continue;
    const source = await readFile(join(sourceRoot, entry), "utf8");
    if (source.includes('from "./contracts.ts"')) violations.push(entry);
  }

  assert.deepEqual(violations, []);
});
