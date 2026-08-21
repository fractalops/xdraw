import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

const execute = promisify(execFile);
const root = resolve(".");

interface PackedPackage {
  filename: string;
}

interface InstalledDrawing {
  elements: Array<{
    customData?: { xdraw?: { source?: string; type?: string } };
    fileId?: string;
    type: string;
  }>;
  files: Record<string, { dataURL: string; mimeType: string }>;
}

function contentType(path: string): string {
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
  }[extname(path)] ?? "application/octet-stream";
}

async function serve(directory: string): Promise<{ close: () => Promise<void>; url: string }> {
  const server: Server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
      const path = resolve(directory, relativePath);
      if (!path.startsWith(`${resolve(directory)}/`)) {
        response.writeHead(403).end();
        return;
      }
      response.writeHead(200, { "content-type": contentType(path) });
      response.end(await readFile(path));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListening);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("acceptance server did not bind to a TCP port");
  return {
    close: () => new Promise<void>((resolveClosed, reject) => {
      server.close((error) => error ? reject(error) : resolveClosed());
    }),
    url: `http://127.0.0.1:${address.port}`,
  };
}

test("packed package renders a formula through a browser bundler", async ({ page }) => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), "xdraw-browser-package-"));
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    await execute("npm", ["run", "build"], { cwd: root });
    const [packed] = JSON.parse((await execute("npm", [
      "pack", "--json", "--ignore-scripts", "--pack-destination", directory,
    ], { cwd: root })).stdout) as PackedPackage[];
    if (!packed) throw new Error("npm pack returned no package metadata");

    const consumer = join(directory, "consumer");
    await mkdir(consumer);
    await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
    await execute("npm", [
      "install", "--prefix", consumer, "--ignore-scripts", "--no-audit", "--no-fund",
      join(directory, packed.filename),
    ]);
    await writeFile(join(consumer, "index.html"), '<main id="status" data-phase="loading">Loading</main><script type="module" src="/main.js"></script>');
    const source = [
      'use "xdraw/math" as math',
      'diagram "Installed browser formula" {',
      '  result: math.formula """E = mc^2"""',
      "}",
    ].join("\n");
    await writeFile(join(consumer, "main.js"), `
      import { compile, parse } from "xdraw";

      const status = document.querySelector("#status");
      try {
        const drawing = (await compile(parse(${JSON.stringify(source)}))).toJSON();
        window.__xdrawInstalledDrawing = drawing;
        status.dataset.phase = "ready";
        status.textContent = "Ready";
      } catch (error) {
        status.dataset.phase = "error";
        status.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
      }
    `);

    await execute(process.execPath, [
      join(root, "node_modules", "vite", "bin", "vite.js"),
      "build", "--outDir", "dist",
    ], { cwd: consumer });
    server = await serve(join(consumer, "dist"));

    await page.goto(server.url);
    await expect(page.locator("#status")).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });
    const drawing = await page.evaluate(() => (
      (window as typeof window & { __xdrawInstalledDrawing?: InstalledDrawing }).__xdrawInstalledDrawing
    ));
    expect(drawing).toBeDefined();
    const formula = drawing?.elements.find((element) => element.customData?.xdraw?.type === "formula");
    expect(formula).toMatchObject({
      customData: { xdraw: { source: "E = mc^2", type: "formula" } },
      type: "image",
    });
    expect(formula?.fileId).toBeTruthy();
    expect(drawing?.files[formula?.fileId ?? ""]).toMatchObject({ mimeType: "image/svg+xml" });
    expect(drawing?.files[formula?.fileId ?? ""]?.dataURL).toMatch(/^data:image\/svg\+xml;base64,/u);
  } finally {
    await server?.close();
    await rm(directory, { force: true, recursive: true });
  }
});
