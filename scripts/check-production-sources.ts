import { readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const forbidden = new Set([".js", ".jsx", ".cjs", ".mjs"]);

export async function productionSourceViolations(root: string): Promise<string[]> {
  const violations: string[] = [];

  async function inspect(directory: string): Promise<void> {
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
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const sourceRoots = ["acceptance", "scripts", "src", "test", "test-support"];
  const violations = (await Promise.all(sourceRoots.map(async (sourceRoot) => (
    (await productionSourceViolations(join(projectRoot, sourceRoot)))
      .map((path) => join(sourceRoot, path))
  )))).flat().sort();
  if (violations.length) {
    console.error(`first-party sources must be TypeScript implementations:\n${violations.join("\n")}`);
    process.exitCode = 1;
  }
}
