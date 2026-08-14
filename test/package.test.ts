import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { requireElementById } from "../test-support/assertions.ts";
import type { DrawingJson } from "../src/render-contracts.ts";

const execute = promisify(execFile);
const root = resolve(".");

interface PackedFile {
  path: string;
}

interface PackedPackage {
  filename: string;
  files: PackedFile[];
  unpackedSize: number;
}

interface PackageManifest {
  version: string;
  main: string;
  types: string;
  bin: Record<string, string>;
  exports: unknown;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

async function filesBelow(directory: string): Promise<string[]> {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }))).flat();
}

function publicationTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(publicationTargets);
}

test("packed package installs a working xdraw executable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-package-"));
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as PackageManifest;
  assert.equal(packageJson.dependencies["@resvg/resvg-js"], "^2.6.2");
  assert.equal(packageJson.dependencies["@mathjax/src"], "4.1.3");
  assert.equal(packageJson.dependencies["@mathjax/mathjax-newcm-font"], "4.1.3");
  await execute("npm", ["run", "build"], { cwd: root });
  const [packed] = JSON.parse((await execute(
    "npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", directory], { cwd: root },
  )).stdout) as PackedPackage[];
  assert.ok(packed, "npm pack returned no package metadata");
  const packedPaths = new Set(packed.files.map((file) => file.path));
  assert.ok(packed.files.every((file) => ["LICENSE", "README.md", "package.json", "bin/", "lib/", "examples/", "docs/"]
    .some((prefix) => file.path === prefix || file.path.startsWith(prefix))));
  assert.ok(packed.files.every((file) => !/(?:^|\/)(?:\.env|\.DS_Store)|\.(?:key|log|pem|tmp)$/i.test(file.path)));
  assert.ok(packed.files.some((file) => file.path === "LICENSE"));
  assert.ok(packed.files.some((file) => file.path === "lib/compiler.js"));
  assert.ok(packed.files.some((file) => file.path === "lib/index.d.ts"));
  assert.ok(packed.files.some((file) => file.path === "lib/excalidraw-api.js"));
  assert.ok(packed.files.some((file) => file.path === "lib/excalidraw-api.d.ts"));
  for (const target of [packageJson.main, packageJson.types, ...Object.values(packageJson.bin),
    ...publicationTargets(packageJson.exports)]) {
    assert.ok(packedPaths.has(target.replace(/^\.\//, "")), `published target is missing: ${target}`);
  }
  assert.ok(packed.unpackedSize < 12_000_000, `package is unexpectedly large: ${packed.unpackedSize}`);
  for (const output of await filesBelow(join(root, "lib"))) {
    if (!output.endsWith(".js") && !output.endsWith(".d.ts")) continue;
    const source = await readFile(output, "utf8");
    const specifiers = source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)["'](\.\.?\/[^"']+)["']/g);
    for (const [, specifier] of specifiers) {
      assert.match(specifier, /\.js$/, `${output} contains an invalid relative specifier: ${specifier}`);
      const target = resolve(dirname(output), specifier);
      assert.ok(packedPaths.has(relative(root, target)), `${output} imports missing output: ${specifier}`);
    }
  }

  const prefix = join(directory, "installed");
  await execute("npm", [
    "install", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund",
    "--install-strategy=nested", join(directory, packed.filename),
  ]);
  const executable = join(prefix, "node_modules", ".bin", "xdraw");
  assert.equal((await execute(executable, ["--version"])).stdout.trim(), `xdraw ${packageJson.version}`);
  assert.match((await execute(executable, ["library", "list"])).stdout, /xdraw\/architecture/);
  const installedManifest = JSON.parse((await execute(
    executable, ["library", "show", "xdraw/sequence", "--json"],
  )).stdout);
  assert.equal(installedManifest.name, "xdraw/sequence");
  await execute(process.execPath, [
    "--input-type=module",
    "--eval",
    "const xdraw = await import('xdraw'); if (xdraw.compile(xdraw.parse('diagram \\\"Sync\\\" { a: rectangle \\\"A\\\" }')) instanceof Promise) throw new Error('compile must stay synchronous'); await xdraw.compileAsync(xdraw.parse('diagram \\\"Async\\\" { arrange layered {}; a: rectangle \\\"A\\\"; b: rectangle \\\"B\\\"; a -> b }')); await xdraw.compileAsync(xdraw.parse('use \\\"xdraw/math\\\" as math; diagram \\\"Formula\\\" { value: math.formula \\\"\\\"\\\"x^2\\\"\\\"\\\" }')); if (!xdraw.getLibraryManifest('xdraw/core')) throw new Error('core manifest missing'); if (!xdraw.listLibraryManifests().length) throw new Error('library catalog empty'); await import('xdraw/excalidraw-api');",
  ], { cwd: prefix });

  const consumer = join(prefix, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "index.ts"), [
    'import { compile, compileAsync, getLibraryManifest, listLibraryManifests, parse, type Drawing, type LibraryManifest } from "xdraw";',
    'import { ExcalidrawApiClient } from "xdraw/excalidraw-api";',
    'const source = parse(\'diagram "Typed" { item: rectangle "Item" }\');',
    "const synchronous: Drawing = compile(source);",
    "const asynchronous: Promise<Drawing> = compileAsync(source);",
    'const manifests: readonly LibraryManifest[] = listLibraryManifests();',
    'const core: LibraryManifest | undefined = getLibraryManifest("xdraw/core");',
    "void synchronous;",
    "void asynchronous;",
    "void manifests;",
    "void core;",
    "void ExcalidrawApiClient;",
  ].join("\n"));
  await writeFile(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      module: "NodeNext",
      moduleResolution: "NodeNext",
      noEmit: true,
      skipLibCheck: false,
      strict: true,
      target: "ES2024",
      typeRoots: [join(root, "node_modules", "@types")],
      types: ["node"],
    },
    include: ["index.ts"],
  }, null, 2));
  await execute(join(root, "node_modules", ".bin", "tsc"), ["-p", join(consumer, "tsconfig.json")], { cwd: consumer });

  const source = join(directory, "installed-example.xdraw");
  await writeFile(source, 'diagram "Installed" { source: rectangle "Source"; target: rectangle "Target"; source -> target }');
  await execute(executable, ["build", source]);
  assert.equal(JSON.parse(await readFile(join(dirname(source), "installed-example.excalidraw"), "utf8")).type, "excalidraw");

  const highlighted = join(directory, "installed-highlighted.xdraw");
  await writeFile(highlighted, 'diagram "Installed" { source: code "const value = 42" { language typescript; highlight true } }');
  await execute(executable, ["build", highlighted]);
  const highlightedDrawing = JSON.parse(
    await readFile(join(dirname(highlighted), "installed-highlighted.excalidraw"), "utf8"),
  ) as DrawingJson;
  assert.ok(highlightedDrawing.elements.some((element) => element.id.startsWith("source:source:")));

  const formula = join(directory, "installed-formula.xdraw");
  await writeFile(formula, 'use "xdraw/math" as math\ndiagram "Installed formula" { result: math.formula """E = mc^2""" }');
  await execute(executable, ["build", formula]);
  const formulaDrawing = JSON.parse(
    await readFile(join(dirname(formula), "installed-formula.excalidraw"), "utf8"),
  ) as DrawingJson;
  assert.ok(formulaDrawing.elements.some((element) => element.id === "result:image" && element.type === "image"));
  assert.equal(Object.values(formulaDrawing.files)[0]?.mimeType, "image/svg+xml");

  const layered = join(directory, "installed-layered.xdraw");
  await writeFile(layered, 'diagram "Installed layered" { arrange layered {}; source: rectangle "Source"; target: rectangle "Target"; source -> target }');
  await execute(executable, ["build", layered]);
  const layeredDrawing = JSON.parse(
    await readFile(join(dirname(layered), "installed-layered.excalidraw"), "utf8"),
  ) as DrawingJson;
  const sourceFrame = requireElementById(layeredDrawing.elements, "source:frame");
  const targetFrame = requireElementById(layeredDrawing.elements, "target:frame");
  assert.ok(sourceFrame.x < targetFrame.x);
});
