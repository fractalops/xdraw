import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { productionSourceViolations } from "../scripts/check-production-sources.ts";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

test("source policy accepts TypeScript-only trees", async () => {
  const root = await mkdtemp(join(tmpdir(), "xdraw-ts-sources-"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "index.ts"), "export {};\n");
  await writeFile(join(root, "nested", "types.ts"), "export type Value = string;\n");

  assert.deepEqual(await productionSourceViolations(root), []);
});

test("source policy rejects JavaScript and declaration bridges", async () => {
  const root = await mkdtemp(join(tmpdir(), "xdraw-mixed-sources-"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "legacy.js"), "export {};\n");
  await writeFile(join(root, "nested", "legacy.d.ts"), "export {};\n");
  await writeFile(join(root, "nested", "valid.ts"), "export {};\n");

  assert.deepEqual(await productionSourceViolations(root), ["legacy.js", "nested/legacy.d.ts"]);
});

test("internal modules import contracts from their owning stage", async () => {
  const sourceRoot = join(root, "src");
  const umbrella = join(sourceRoot, "contracts.ts");
  const publicEntries = new Set([join(sourceRoot, "browser.ts"), join(sourceRoot, "index.ts")]);
  const violations: string[] = [];
  const inspect = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await inspect(path);
        continue;
      }
      if (!entry.name.endsWith(".ts") || path === umbrella || publicEntries.has(path)) continue;
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/gu)) {
        if (resolve(dirname(path), match[1]) === umbrella) violations.push(path.slice(sourceRoot.length + 1));
      }
    }
  };
  await inspect(sourceRoot);

  assert.deepEqual(violations, []);
});
