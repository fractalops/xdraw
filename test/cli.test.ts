import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import test from "node:test";

import { run } from "../src/cli.ts";
import { rectangle } from "../src/excalidraw/elements.ts";
import type { DrawingJson } from "../src/contracts/render.ts";

type RunOptions = NonNullable<Parameters<typeof run>[1]>;
type RemoteFactory = NonNullable<RunOptions["remoteFactory"]>;
type RemoteClient = Awaited<ReturnType<RemoteFactory>>;
type FakeRemote = RemoteClient & { closed: boolean };

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("CLI exposes help and version without Node-specific invocation", async () => {
  assert.match(await run(["--help"]), /^XDraw creates editable Excalidraw diagrams/m);
  assert.equal(await run(["--version"]), `xdraw ${packageJson.version}`);
});

test("the formula example in help carries usable TeX and compiles", async () => {
  // Help text is a template literal, so a single backslash in \pi is swallowed
  // before it ever reaches the reader. Compile what help actually prints.
  const help = await run(["--help"]);
  const example = help.split("\n").find((line) => line.includes("math.formula"));
  assert.ok(example, "help must document a formula example");
  assert.match(example, /"""e\^\{i\\pi\} \+ 1 = 0"""/, "TeX escapes must survive into help output");

  const source = /-e '([^']*)'/u.exec(example)?.[1];
  assert.ok(source, "the example must pass source with -e");
  const drawing = JSON.parse(await run(["build", "-e", source, "-o", "-"])) as DrawingJson;
  const image = drawing.elements.find((element) => element.customData?.xdraw?.source);
  assert.equal(image?.customData?.xdraw?.source, "e^{i\\pi} + 1 = 0");
});

test("CLI checks source and chooses a neighboring output by default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-cli-"));
  const input = join(directory, "hello.xdraw");
  await writeFile(input, 'diagram "Hello" { a: rectangle "A"; b: rectangle "B"; a -> b }');
  const checked = await run(["check", input]);
  assert.match(checked, new RegExp(`^OK ${input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(checked, /Elements\n  a \[card\]/u);
  assert.equal(await run(["build", input]), `Created ${join(directory, "hello.excalidraw")}`);
  assert.equal(JSON.parse(await readFile(join(directory, "hello.excalidraw"), "utf8")).type, "excalidraw");
});

test("CLI emits Excalidraw JSON on standard output", async () => {
  const output = await run(["build", "--expression", 'diagram "Hello" { a: rectangle "A" }', "--output", "-"]);
  assert.equal(JSON.parse(output).type, "excalidraw");
});

test("CLI reads redirected or piped source without requiring a dash", async () => {
  const source = 'diagram "Flow" { a: rectangle "Source"; b: rectangle "Target"; a -> b }';
  const implicit = await run(["build"], { stdin: Readable.from([source]) });
  const explicit = await run(["build", "-"], { stdin: Readable.from([source]) });
  assert.equal(JSON.parse(implicit).type, "excalidraw");
  assert.deepEqual(JSON.parse(implicit), JSON.parse(explicit));
  assert.match(await run(["check"], { stdin: Readable.from([source]) }), /^OK stdin\n/u);
});

test("CLI writes piped source to an explicit output path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-stdin-"));
  const output = join(directory, "piped.excalidraw");
  const result = await run(["build", "--output", output], {
    stdin: Readable.from(['diagram "Piped" { a: rectangle "Piped" }']),
  });
  assert.equal(result, `Created ${output}`);
  assert.equal(JSON.parse(await readFile(output, "utf8")).type, "excalidraw");
});

test("CLI renders local PNG and SVG previews from the build command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-preview-"));
  const source = 'diagram "Preview" { a: rectangle "A" }';
  const pngPath = join(directory, "preview.png");
  const svgPath = join(directory, "preview.svg");
  await run(["build", "-e", source, "-o", pngPath]);
  await run(["build", "-e", source, "-o", svgPath]);
  const png = await readFile(pngPath);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(await readFile(svgPath, "utf8"), /^<svg /);
});

test("CLI renders transparent logo previews", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-transparent-preview-"));
  const svgPath = join(directory, "logo.svg");
  await run([
    "build", "-e", 'diagram "" { mark: ellipse "" }',
    "-o", svgPath, "--background", "transparent",
  ]);
  assert.doesNotMatch(await readFile(svgPath, "utf8"), /<rect width="100%" height="100%"/);
});

test("CLI shows help instead of waiting for interactive stdin", async () => {
  const stdin = Readable.from([]) as Readable & { isTTY: boolean };
  stdin.isTTY = true;
  assert.match(await run(["build"], { stdin }), /^XDraw creates editable Excalidraw diagrams/m);
});

test("CLI rejects incomplete or conflicting options", async () => {
  await assert.rejects(() => run(["build", "-e"]), /--expression requires source/);
  await assert.rejects(() => run(["check", "a.xdraw", "-o", "out"]), /check does not create output/);
  await assert.rejects(() => run(["build", "a.xdraw", "-e", "a: card \"A\""]), /either a file\/stdin or --expression/);
  await assert.rejects(() => run(["build", "a.xdraw", "--api-url", "https://example.test/api/v1"]), /build does not accept --api-url/);
  await assert.rejects(() => run(["pull", "scene-1", "--max-width", "1921"]), /no greater than 1920/);
  await assert.rejects(() => run(["pull", "scene-1", "--frame", "main", "-o", "scene.excalidraw"]), /require a .png or .svg output/);
  await assert.rejects(
    () => run(["build", "-e", 'diagram "" {}', "--background", "transparent"]),
    /requires a .png or .svg output/,
  );
  await assert.rejects(() => run(["pull", "scene-1", "-o", "scene.jpeg"]), /must end in/);
  await assert.rejects(() => run(["check", "a.xdraw", "--format", "yaml"]), /--format expects text or json/);
  await assert.rejects(() => run(["build", "a.xdraw", "--format", "json"]), /supported only by check/);
  await assert.rejects(() => run(["inspect", "scene-1"]), /unknown command 'inspect'/);
  await assert.rejects(() => run(["push", "a.xdraw"]), /unknown command 'push'/);
  await assert.rejects(() => run(["patch", "scene-1"]), /unknown command 'patch'/);
  await assert.rejects(() => run(["serve"]), /unknown command 'serve'/);
});

function fakeRemote(overrides: Partial<RemoteClient> = {}): FakeRemote {
  const client: FakeRemote = {
    closed: false,
    async close() { client.closed = true; },
    async applyReplace() { return { sceneId: "scene-new", added: 3, created: true }; },
    async applyPatch(_resource, patch) {
      return {
        sceneId: "scene-existing",
        added: patch?.drawing ? 1 : 0,
        updated: patch?.updates?.length ?? 0,
        deleted: patch?.deletes?.length ?? 0,
      };
    },
    async listScenes() {
      return [{
        address: "excalidraw::default::Architecture::System overview",
        sceneId: "scene-1",
        sceneName: "System overview",
        collectionId: "collection-1",
        collectionName: "Architecture",
      }];
    },
    async pull(_target): Promise<Awaited<ReturnType<RemoteClient["pull"]>>> {
      return {
        type: "excalidraw",
        version: 2,
        source: "https://excalidraw.com",
        appState: {
          gridSize: 20,
          gridStep: 5,
          gridModeEnabled: false,
          viewBackgroundColor: "#ffffff",
        },
        files: {},
        elements: [rectangle("box", { x: 0, y: 0, width: 100, height: 60 })],
      };
    },
    ...overrides,
  };
  return client;
}

test("CLI applies source-authoritative scene replacement", async () => {
  const created = fakeRemote();
  assert.equal(await run(["apply", "-e", `
    scene excalidraw::default::architecture::system_overview {
      replace { diagram "System overview" { a: rectangle "A" } }
    }
  `], {
    remoteFactory: async () => created,
  }), "Created excalidraw::default::architecture::system_overview (3 elements)\nScene ID: scene-new");
  assert.equal(created.closed, true);
});

test("CLI resolves assets inside replacement scene documents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-scene-assets-"));
  await writeFile(join(directory, "mark.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>');
  const input = join(directory, "architecture.scene.xdraw");
  await writeFile(input, `
    scene excalidraw::default::architecture::system_overview {
      replace {
        diagram "Assets" {
          mark: asset "mark.svg"
          logo: image(mark) { at = (80, 80); size = (40, 20) }
        }
      }
    }
  `);
  assert.match(await run(["apply", input], {
    remoteFactory: async () => fakeRemote(),
  }), /^Created excalidraw::default::architecture::system_overview/);
});

test("check validates a scene document without reaching the network", async () => {
  let contacted = false;
  const result = await run(["check", "-e", `
    scene excalidraw::default::architecture::system_overview {
      replace { diagram "System overview" { a: rectangle "A" } }
    }
  `], {
    remoteFactory: async () => { contacted = true; return fakeRemote(); },
  });
  assert.equal(contacted, false, "check contacted the API");
  assert.match(result, /^OK inline expression -> excalidraw::default::architecture::system_overview\n/u);
});

test("check reports a fault inside a scene document instead of a parse error", async () => {
  await assert.rejects(
    () => run(["check", "-e", `
      scene excalidraw::default::architecture::system_overview {
        replace { diagram "Bad" { a: rectangle "A" { at = (0, 0); size = (0, 50) } } }
      }
    `]),
    /XD1209/,
  );
});

test("an address list prints can also be written in a scene document", async () => {
  // `list` prints 'Infrastructure Engineering' as a segment and `pull` accepts it,
  // so a scene document has to accept it too.
  const created = fakeRemote();
  assert.match(await run(["apply", "-e", `
    scene excalidraw::default::"Infrastructure Engineering"::"System overview" {
      replace { diagram "System overview" { a: rectangle "A" } }
    }
  `], { remoteFactory: async () => created }),
  /^Created excalidraw::default::Infrastructure Engineering::System overview/);
});

test("CLI lists copyable hosted-scene addresses", async () => {
  let collection;
  const remote = fakeRemote({
    async listScenes(selector) {
      collection = selector;
      return fakeRemote().listScenes();
    },
  });
  const result = await run(["list", "Architecture"], { remoteFactory: async () => remote });
  assert.equal(collection, "Architecture");
  assert.match(result, /^ADDRESS\s+SCENE ID/m);
  assert.match(result, /excalidraw::default::Architecture::System overview\s+scene-1/);
});

test("CLI accepts inline long-option values", async () => {
  let options;
  await run(["list", "--api-url=https://example.test/api/v1"], {
    remoteFactory: async (value) => {
      options = value;
      return fakeRemote();
    },
  });
  assert.deepEqual(options, { baseUrl: "https://example.test/api/v1" });
});

test("check emits structured compilation measurements as JSON", async () => {
  const output = await run(["check", "-e", `diagram "Measured" {
    a: rectangle "A" { at = (100, 100); size = (120, 80) }
    b: rectangle "B" { at = (400, 100); size = (120, 80) }
    a -> b "sends"
  }`, "--format", "json"]);
  const report = JSON.parse(output);
  assert.equal(report.ok, true);
  assert.equal(report.source, "inline expression");
  assert.equal(report.elements.find((item: { id: string }) => item.id === "a").bounds.width, 120);
  assert.deepEqual(report.connectors[0].route[0], [220, 140]);
  assert.equal(report.labels[0].connector, "document:connection:0:0");
});

test("CLI pulls scene addresses as editable JSON, PNG, or SVG", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-remote-"));
  const scene = join(directory, "scene.excalidraw");
  const png = join(directory, "scene.png");
  const svg = join(directory, "scene.svg");
  const address = "excalidraw::default::Architecture::System overview";
  let pulled;
  const remote = fakeRemote({ async pull(target) { pulled = target; return fakeRemote().pull(target); } });
  assert.match(await run(["pull", address, "-o", scene], { remoteFactory: async () => remote }), /Saved excalidraw::/);
  assert.deepEqual(pulled, {
    provider: "excalidraw", workspace: "default", collection: "Architecture", scene: "System overview",
  });
  assert.equal(JSON.parse(await readFile(scene, "utf8")).type, "excalidraw");
  await run(["pull", "scene-1", "-o", png, "--max-width", "800"], { remoteFactory: async () => fakeRemote() });
  await run(["pull", "scene-1", "-o", svg], { remoteFactory: async () => fakeRemote() });
  assert.deepEqual([...(await readFile(png)).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(await readFile(svg, "utf8"), /^<svg /);
});

test("CLI applies selective patches from XDraw source", async () => {
  const source = `
    scene excalidraw::default::architecture::system_overview {
      patch {
        update api { tone = warning }
        delete obsolete
        add { review: rectangle "Requires review" { at = (80, 80) } }
      }
    }
  `;
  assert.equal(await run(["apply"], {
    stdin: Readable.from([source]),
    remoteFactory: async () => fakeRemote(),
  }), "Patched excalidraw::default::architecture::system_overview (1 added, 1 updated, 1 deleted)\nScene ID: scene-existing");
});

test("CLI rejects malformed scene documents before connecting", async () => {
  let connections = 0;
  const remoteFactory = async () => { connections += 1; return fakeRemote(); };
  await assert.rejects(
    () => run(["apply"], { stdin: Readable.from(["not a scene"]), remoteFactory }),
    /expected 'scene'/,
  );
  await assert.rejects(
    () => run(["apply"], {
      stdin: Readable.from(["scene excalidraw::default::main::one { patch {} }"]),
      remoteFactory,
    }),
    /must add, update, or delete/,
  );
  await assert.rejects(
    () => run(["pull", "bad::address"], { remoteFactory }),
    /provider::workspace::collection::scene/,
  );
  assert.equal(connections, 0);
});

test("build rejects output extensions it cannot produce", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-cli-"));
  const source = 'diagram "D" { a: rectangle "A" }';
  // .pdf used to be written as Excalidraw JSON under a misleading name.
  for (const extension of [".pdf", ".jpg", ".txt", ".excalidraw.bak"]) {
    await assert.rejects(
      () => run(["build", "-e", source, "-o", join(directory, `out${extension}`)]),
      /must end in/,
      `expected ${extension} to be rejected`,
    );
  }
  for (const extension of [".excalidraw", ".json", ".png", ".svg"]) {
    const message = await run(["build", "-e", source, "-o", join(directory, `ok${extension}`)]);
    assert.match(message, /^Created /);
  }
});
