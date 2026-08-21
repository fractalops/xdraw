import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { compile } from "../src/compile/pipeline.ts";
import { resolveAssets } from "../src/io/assets.ts";
import { RootedFileSystem } from "../src/io/filesystem.ts";
import { parseSource } from "../src/language/parser.ts";
import type { Diagnostic } from "../src/contracts/foundation.ts";

export async function compiledSourceFiles(): Promise<string[]> {
  const entries = JSON.parse(await readFile(path.join("corpus", "corpus.json"), "utf8")) as { file: string }[];
  const examples = (await readdir("examples"))
    .filter((name) => name.endsWith(".xdraw") && !name.endsWith(".scene.xdraw"))
    .map((name) => path.join("examples", name));
  return [...entries.map((entry) => path.join("corpus", entry.file)), ...examples].sort();
}

export async function collectInvariant(
  code: string,
  select: (diagnostic: Diagnostic) => string | undefined,
): Promise<Record<string, string[]>> {
  const observed: Record<string, string[]> = {};
  for (const file of await compiledSourceFiles()) {
    const filesystem = new RootedFileSystem(path.dirname(file));
    const source = await filesystem.readText(path.basename(file));
    const document = await resolveAssets(parseSource(source), filesystem);
    const drawing = await compile(document, { remarks: true });
    const findings = drawing.diagnostics
      .filter((item) => item.code === code)
      .map(select)
      .filter((item): item is string => item !== undefined)
      .sort();
    if (findings.length) observed[file] = findings;
  }
  return observed;
}
