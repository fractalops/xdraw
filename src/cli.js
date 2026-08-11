import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";

import { resolveAssets } from "./assets.js";
import { compile } from "./compiler.js";
import { ExcalidrawApiClient } from "./excalidraw-api.js";
import { loadDocument, loadParsedDocument } from "./expander.js";
import { RootedFileSystem } from "./filesystem.js";
import { renderScenePng, renderSceneSvg } from "./local-renderer.js";
import { parse } from "./parser.js";
import { formatSceneResource, parseSceneDocument } from "./scene-document.js";
import { writeDrawing } from "./writer.js";
import { formatDiagnostic } from "./diagnostics.js";

const HELP = `XDraw creates editable Excalidraw diagrams from concise text files.

Usage:
  xdraw build <file> [-o <output>]
  xdraw build [<file>|-] [-o <output>]
  xdraw build -e <source> [-o <output>]
  xdraw check <file>
  xdraw check [<file>|-]
  xdraw check -e <source>
  xdraw apply <file>
  xdraw apply [<file>|-]
  xdraw apply -e <source>
  xdraw pull <scene-id> [-o <output>]
  xdraw inspect <scene-id> [-o <png|svg>]
  xdraw --help
  xdraw --version

Commands:
  build    Create an editable .excalidraw file.
  check    Validate source, imports, assets, and generated geometry.
  apply    Apply a replace or patch scene document to Excalidraw+.
  pull     Download an Excalidraw+ scene as editable JSON.
  inspect  Save a local PNG or SVG preview of an Excalidraw+ scene.

Options:
  -e, --expression <source>  Read XDraw source from the command line.
  -o, --output <path>       Choose the output path. Use - for JSON on stdout.
  --api-url <url>           Override the Excalidraw+ REST API base URL.
  --frame <id>              Preview one frame instead of the full scene.
  --max-width <pixels>      Limit preview width.
  --padding <pixels>        Set preview padding.
  -h, --help                Show this help.
  -v, --version             Show the installed version.

Examples:
  xdraw build architecture.xdraw
  xdraw build architecture.xdraw -o ~/Desktop/architecture.excalidraw
  xdraw build < architecture.xdraw > architecture.excalidraw
  cat architecture.xdraw | xdraw build -o architecture.excalidraw
  xdraw check architecture.xdraw
  xdraw apply architecture.scene.xdraw
  cat architecture.scene.xdraw | xdraw apply
  xdraw pull <scene-id> -o architecture.excalidraw
  xdraw inspect <scene-id> -o architecture.png`;

async function version() {
  const packageFile = new URL("../package.json", import.meta.url);
  return JSON.parse(await readFile(packageFile, "utf8")).version;
}

async function readStdin(stream) {
  let source = "";
  for await (const chunk of stream) source += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  return source;
}

function defaultOutput(input) {
  if (!input || input === "-") return "-";
  const extension = extname(input);
  const name = extension ? basename(input, extension) : basename(input);
  return resolve(dirname(input), `${name}.excalidraw`);
}

function parseArguments(argv) {
  const args = [...argv];
  if (!args.length || args.includes("-h") || args.includes("--help")) return { action: "help" };
  if (args.includes("-v") || args.includes("--version")) return { action: "version" };
  const command = args.shift();
  if (!["build", "check", "apply", "pull", "inspect"].includes(command)) throw new Error(`unknown command '${command}'\n\n${HELP}`);
  let input;
  let expression;
  let output;
  const remote = {};
  while (args.length) {
    const arg = args.shift();
    if (arg === "-e" || arg === "--expression") expression = args.shift();
    else if (arg.startsWith("--expression=")) expression = arg.slice("--expression=".length);
    else if (arg === "-o" || arg === "--output") output = args.shift();
    else if (arg.startsWith("--output=")) output = arg.slice("--output=".length);
    else if (["--api-url", "--frame", "--max-width", "--padding"].includes(arg)) remote[arg.slice(2).replaceAll("-", "_")] = args.shift();
    else if (!input) input = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  if ((argv.includes("-e") || argv.includes("--expression")) && expression === undefined) throw new Error("--expression requires source");
  if ((argv.includes("-o") || argv.includes("--output")) && output === undefined) throw new Error("--output requires a path");
  for (const option of ["api-url", "frame", "max-width", "padding"]) {
    if (argv.includes(`--${option}`) && remote[option.replaceAll("-", "_")] === undefined) throw new Error(`--${option} requires a value`);
  }
  if (expression !== undefined && input !== undefined) throw new Error("use either a file/stdin or --expression, not both");
  if (output === "") throw new Error("--output requires a path");
  if (command === "check" && output !== undefined) throw new Error("check does not create output; remove --output");
  if (command === "apply" && output !== undefined) throw new Error("apply writes to Excalidraw+; remove --output");
  if (["pull", "inspect"].includes(command) && !input) throw new Error(`${command} requires a scene ID`);
  if (["pull", "inspect"].includes(command) && expression !== undefined) throw new Error(`${command} does not accept --expression`);
  if (command !== "inspect" && ["frame", "max_width", "padding"].some((key) => remote[key] !== undefined)) {
    throw new Error(`${command} does not accept preview options`);
  }
  if (!["apply", "pull", "inspect"].includes(command) && remote.api_url !== undefined) {
    throw new Error(`${command} does not accept --api-url`);
  }
  for (const key of ["max_width", "padding"]) {
    if (remote[key] !== undefined) {
      remote[key] = Number(remote[key]);
      if (!Number.isInteger(remote[key]) || remote[key] < 0) throw new Error(`--${key.replace("_", "-")} must be a non-negative integer`);
    }
  }
  if (remote.max_width > 1920) throw new Error("--max-width must be no greater than 1920");
  return { action: command, input, expression, output, remote };
}

async function loadInput(input, expression, stdin) {
  if (expression !== undefined) {
    const filesystem = new RootedFileSystem(process.cwd());
    return resolveAssets(parse(expression), filesystem);
  }
  if (input === undefined || input === "-") {
    const filesystem = new RootedFileSystem(process.cwd());
    const source = await readStdin(stdin);
    if (!source.trim()) throw new Error("stdin did not contain XDraw source");
    return resolveAssets(parse(source), filesystem);
  }
  const entry = resolve(input);
  const filesystem = new RootedFileSystem(dirname(entry));
  return resolveAssets(await loadDocument(basename(entry), filesystem), filesystem);
}

async function withRemote(options, remoteFactory, action) {
  const remote = await remoteFactory({ baseUrl: options.remote.api_url });
  try { return await action(remote); }
  finally { await remote.close(); }
}

async function loadSceneInput(input, expression, stdin) {
  let source;
  let filesystem;
  let sourcePath;
  if (expression !== undefined) {
    source = expression;
    filesystem = new RootedFileSystem(process.cwd());
    sourcePath = "inline.scene.xdraw";
  } else if (input === undefined || input === "-") {
    source = await readStdin(stdin);
    filesystem = new RootedFileSystem(process.cwd());
    sourcePath = "stdin.scene.xdraw";
  } else {
    const entry = resolve(input);
    source = await readFile(entry, "utf8");
    filesystem = new RootedFileSystem(dirname(entry));
    sourcePath = basename(entry);
  }
  if (!source.trim()) throw new Error("scene document input is empty");
  const document = parseSceneDocument(source);
  if (document.operation.type === "replace") {
    const loaded = await loadParsedDocument(document.operation.diagram, sourcePath, filesystem);
    document.operation.diagram = await resolveAssets(loaded, filesystem);
  } else if (document.operation.additions) {
    const loaded = await loadParsedDocument(document.operation.additions, sourcePath, filesystem);
    document.operation.additions = await resolveAssets(loaded, filesystem);
  }
  return document;
}

export async function run(argv, {
  stdin = process.stdin,
  stderr = process.stderr,
  remoteFactory = (options) => ExcalidrawApiClient.connect(options),
} = {}) {
  const options = parseArguments(argv);
  if (options.action === "help") return HELP;
  if (options.action === "version") return `xdraw ${await version()}`;
  if (["build", "check", "apply"].includes(options.action)
      && options.input === undefined && options.expression === undefined && stdin.isTTY === true) return HELP;

  if (options.action === "apply") {
    const scene = await loadSceneInput(options.input, options.expression, stdin);
    return withRemote(options, remoteFactory, async (remote) => {
      const resource = formatSceneResource(scene.resource);
      if (scene.operation.type === "replace") {
        const drawing = compile(scene.operation.diagram);
        if (drawing.diagnostics.length) stderr.write(`${drawing.diagnostics.map(formatDiagnostic).join("\n")}\n`);
        const result = await remote.applyReplace(scene.resource, drawing.toJSON());
        return `${result.created ? "Created" : "Replaced"} ${resource} (${result.added} elements)`;
      }
      let drawing;
      if (scene.operation.additions) {
        const compiled = compile(scene.operation.additions);
        if (compiled.diagnostics.length) stderr.write(`${compiled.diagnostics.map(formatDiagnostic).join("\n")}\n`);
        drawing = compiled.toJSON();
      }
      const result = await remote.applyPatch(scene.resource, {
        updates: scene.operation.updates,
        deletes: scene.operation.deletes,
        drawing,
      });
      return `Patched ${resource} (${result.added} added, ${result.updated} updated, ${result.deleted} deleted)`;
    });
  }

  if (options.action === "pull") {
    return withRemote(options, remoteFactory, async (remote) => {
      const content = await remote.pull(options.input);
      const payload = JSON.stringify(content, null, 2);
      const target = options.output ?? `${options.input}.excalidraw`;
      if (target === "-") return payload;
      const resolvedTarget = resolve(target);
      await mkdir(dirname(resolvedTarget), { recursive: true });
      await writeFile(resolvedTarget, `${payload}\n`, "utf8");
      return `Downloaded scene ${options.input} to ${resolvedTarget}`;
    });
  }

  if (options.action === "inspect") {
    return withRemote(options, remoteFactory, async (remote) => {
      const target = resolve(options.output ?? `${options.input}.png`);
      await mkdir(dirname(target), { recursive: true });
      const content = await remote.pull(options.input);
      const renderOptions = {
        frameId: options.remote.frame,
        maxWidth: options.remote.max_width,
        padding: options.remote.padding,
      };
      if (extname(target).toLocaleLowerCase() === ".svg") {
        await writeFile(target, `${renderSceneSvg(content, renderOptions)}\n`, "utf8");
      } else await writeFile(target, renderScenePng(content, renderOptions));
      return `Saved scene ${options.input} preview to ${target}`;
    });
  }

  const document = await loadInput(options.input, options.expression, stdin);
  const drawing = compile(document);
  if (drawing.diagnostics.length) {
    stderr.write(`${drawing.diagnostics.map(formatDiagnostic).join("\n")}\n`);
  }
  if (options.action === "check") {
    drawing.toJSON();
    return `OK ${options.expression !== undefined ? "inline expression" : options.input ?? "stdin"}`;
  }

  const target = options.output === undefined ? defaultOutput(options.input) : options.output;
  if (target === "-") return JSON.stringify(drawing.toJSON(), null, 2);
  const resolvedTarget = resolve(target);
  await mkdir(dirname(resolvedTarget), { recursive: true });
  await writeDrawing(drawing, resolvedTarget);
  return `Created ${resolvedTarget}`;
}
