import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function rewriteDeclarationImports(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteDeclarationImports(path);
    } else if (entry.name.endsWith(".d.ts")) {
      const source = await readFile(path, "utf8");
      const rewritten = source.replace(/(from\s+|import\()(["']\.\.?\/[^"']+)\.ts(["'])/g, "$1$2.js$3");
      if (rewritten !== source) await writeFile(path, rewritten);
    }
  }
}
