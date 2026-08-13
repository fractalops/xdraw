import { readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const forbidden = new Set([".js", ".jsx", ".cjs", ".mjs"]);

export async function productionSourceViolations(root) {
  const violations = [];

  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await inspect(path);
      else if (forbidden.has(extname(entry.name)) || entry.name.endsWith(".d.ts")) {
        violations.push(relative(root, path));
      }
    }
  }

  await inspect(root);
  return violations.sort();
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const violations = await productionSourceViolations(root);
  if (violations.length) {
    console.error(`production sources must be TypeScript implementations:\n${violations.join("\n")}`);
    process.exitCode = 1;
  }
}
