import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { resolveAssets } from "./assets.ts";
import { compileAsync } from "./pipeline.ts";
import { ExcalidrawApiClient } from "./excalidraw-api.ts";
import { RootedFileSystem } from "./filesystem.ts";
import { renderScenePng, renderSceneSvg } from "./local-renderer.ts";
import { parseSource } from "./source-language.ts";
import { formatSceneResource, parseSceneDocument, parseSceneResource } from "./scene-document.ts";
import { writeDrawing } from "./writer.ts";
import { formatDiagnostic } from "./diagnostics.ts";
import {
  summarizeLibraryManifest,
  type ConstructorArgumentManifest,
  type ConstructorManifest,
  type LibraryManifest,
} from "./library-manifest.ts";
import { getLibraryManifest, listLibraryManifests } from "./language-registry.ts";
import type {
  SceneDocument,
} from "./scene-document.ts";

type Command = "build" | "check" | "apply" | "list" | "pull" | "library-list" | "library-show";
type Action = Command | "help" | "version";

interface RemoteOptions {
  api_url?: string;
  background?: string;
  frame?: string;
  max_width?: number;
  padding?: number;
}

interface ParsedArguments {
  action: Action;
  help?: string;
  input?: string;
  expression?: string;
  output?: string;
  json?: boolean;
  remote: RemoteOptions;
}

const COMMAND_OPTIONS = {
  expression: { type: "string", short: "e" },
  output: { type: "string", short: "o" },
  "api-url": { type: "string" },
  background: { type: "string" },
  frame: { type: "string" },
  "max-width": { type: "string" },
  padding: { type: "string" },
} as const;

const LIBRARY_SHOW_OPTIONS = {
  json: { type: "boolean" },
} as const;

function parseCommandArguments(args: readonly string[]) {
  return parseArgs({ args, allowPositionals: true, strict: true, options: COMMAND_OPTIONS });
}

function parseLibraryShowArguments(args: readonly string[]) {
  return parseArgs({ args, allowPositionals: true, strict: true, options: LIBRARY_SHOW_OPTIONS });
}

type RemoteClient = Pick<
  ExcalidrawApiClient,
  "close" | "applyReplace" | "applyPatch" | "listScenes" | "pull"
>;

interface RemoteFactoryOptions {
  baseUrl?: string;
}

type RemoteFactory = (options: RemoteFactoryOptions) => RemoteClient | Promise<RemoteClient>;

interface RunDependencies {
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  stderr?: NodeJS.WritableStream;
  remoteFactory?: RemoteFactory;
}

const HELP = `XDraw creates editable Excalidraw diagrams from concise text files.

Usage:
  xdraw build [<file>|-] [-o <output>]
  xdraw build -e <source> [-o <output>]
  xdraw check [<file>|-]
  xdraw check -e <source>
  xdraw apply [<file>|-]
  xdraw apply -e <source>
  xdraw list [<collection>]
  xdraw pull <address-or-id> [-o <output>]
  xdraw library list
  xdraw library show <canonical-name> [--json]
  xdraw --help
  xdraw --version

Commands:
  build    Create an editable .excalidraw file or a PNG/SVG preview.
  check    Validate source, assets, references, layout, and geometry.
  apply    Apply a replace or patch scene document to Excalidraw+.
  list     List hosted scenes and their copyable addresses.
  pull     Retrieve a hosted scene as editable JSON, PNG, or SVG.
  library  Inspect built-in language libraries.

Options:
  -e, --expression <source>  Read XDraw source from the command line.
  -o, --output <path>       Choose the output path. Use - for JSON on stdout.
  --api-url <url>           Override the Excalidraw+ REST API base URL.
  --background <color>      Set the PNG/SVG preview background; use transparent for logos.
  --frame <id>              Preview one frame instead of the full scene.
  --max-width <pixels>      Limit preview width.
  --padding <pixels>        Set preview padding.
  -h, --help                Show this help.
  -v, --version             Show the installed version.

Examples:
  xdraw build architecture.xdraw
  xdraw build architecture.xdraw -o output/architecture.excalidraw
  xdraw build < architecture.xdraw > architecture.excalidraw
  cat architecture.xdraw | xdraw build -o architecture.excalidraw
  xdraw check architecture.xdraw
  xdraw apply architecture.scene.xdraw
  cat architecture.scene.xdraw | xdraw apply
  xdraw list
  xdraw pull "excalidraw::default::Architecture::System overview"
  xdraw pull <scene-id> -o architecture.png
  xdraw library list
  xdraw library show xdraw/architecture`;

const LIBRARY_HELP = `Inspect XDraw's built-in language libraries.

Usage:
  xdraw library list
  xdraw library show <canonical-name> [--json]

Commands:
  list  List canonical library names and summaries.
  show  Show a library's constructors and usage.

Examples:
  xdraw library list
  xdraw library show xdraw/sequence
  xdraw library show xdraw/architecture --json`;

const LIBRARY_LIST_HELP = `List XDraw's built-in language libraries.

Usage:
  xdraw library list`;

const LIBRARY_SHOW_HELP = `Show one built-in language library.

Usage:
  xdraw library show <canonical-name> [--json]

Options:
  --json  Emit the complete manifest as JSON.`;

async function version(): Promise<string> {
  const packageFile = new URL("../package.json", import.meta.url);
  const parsed: unknown = JSON.parse(await readFile(packageFile, "utf8"));
  if (!parsed || typeof parsed !== "object" || !("version" in parsed) || typeof parsed.version !== "string") {
    throw new Error("package metadata does not contain a version");
  }
  return parsed.version;
}

async function readStdin(stream: NodeJS.ReadableStream): Promise<string> {
  let source = "";
  for await (const chunk of stream) source += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  return source;
}

function defaultOutput(input: string | undefined): string {
  if (!input || input === "-") return "-";
  const extension = extname(input);
  const name = extension ? basename(input, extension) : basename(input);
  return resolve(dirname(input), `${name}.excalidraw`);
}

function defaultPullOutput(selector: string): string {
  const label = selector.includes("::") ? selector.split("::").at(-1) ?? selector : selector;
  const name = label.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "scene";
  return resolve(`${name}.excalidraw`);
}

function remoteSelector(value: string): string | ReturnType<typeof parseSceneResource> {
  return value.includes("::") ? parseSceneResource(value) : value;
}

function parseLibraryArguments(args: readonly string[]): ParsedArguments {
  if (!args.length || args[0] === "-h" || args[0] === "--help") {
    return { action: "help", help: LIBRARY_HELP, remote: {} };
  }
  const [command, ...rest] = args;
  if (command === "list") {
    if (rest.includes("-h") || rest.includes("--help")) {
      return { action: "help", help: LIBRARY_LIST_HELP, remote: {} };
    }
    if (rest.length > 0) throw new Error(`unexpected argument: ${rest[0]}`);
    return { action: "library-list", remote: {} };
  }
  if (command === "show") {
    if (rest.includes("-h") || rest.includes("--help")) {
      return { action: "help", help: LIBRARY_SHOW_HELP, remote: {} };
    }
    let parsed: ReturnType<typeof parseLibraryShowArguments>;
    try {
      parsed = parseLibraryShowArguments(rest);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
    if (parsed.positionals.length === 0) throw new Error("library show requires a canonical library name");
    if (parsed.positionals.length > 1) throw new Error(`unexpected argument: ${parsed.positionals[1]}`);
    return {
      action: "library-show",
      input: parsed.positionals[0],
      json: parsed.values.json,
      remote: {},
    };
  }
  throw new Error(`unknown library command '${command}'\n\n${LIBRARY_HELP}`);
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  if (!argv.length) return { action: "help", help: HELP, remote: {} };
  if (argv[0] === "library") return parseLibraryArguments(argv.slice(1));
  if (argv.includes("-h") || argv.includes("--help")) return { action: "help", help: HELP, remote: {} };
  if (argv.includes("-v") || argv.includes("--version")) return { action: "version", remote: {} };
  const [command, ...args] = argv;
  if (!command || !["build", "check", "apply", "list", "pull"].includes(command)) {
    throw new Error(`unknown command '${command}'\n\n${HELP}`);
  }
  let parsed: ReturnType<typeof parseCommandArguments>;
  try {
    parsed = parseCommandArguments(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("--expression")) throw new Error("--expression requires source");
    throw new Error(message.replace(/^Option ['"]?([^'"]+)['"]? argument missing$/, "$1 requires a value"));
  }
  if (parsed.positionals.length > 1) throw new Error(`unexpected argument: ${parsed.positionals[1]}`);
  const input = parsed.positionals[0];
  const expression = parsed.values.expression;
  const output = parsed.values.output;
  const remote: RemoteOptions = {
    api_url: parsed.values["api-url"],
    background: parsed.values.background,
    frame: parsed.values.frame,
    max_width: parsed.values["max-width"] === undefined ? undefined : Number(parsed.values["max-width"]),
    padding: parsed.values.padding === undefined ? undefined : Number(parsed.values.padding),
  };
  if (expression !== undefined && input !== undefined) throw new Error("use either a file/stdin or --expression, not both");
  if (output === "") throw new Error("--output requires a path");
  if (command === "check" && output !== undefined) throw new Error("check does not create output; remove --output");
  if (command === "apply" && output !== undefined) throw new Error("apply writes to Excalidraw+; remove --output");
  if (command === "list" && output !== undefined) throw new Error("list writes to stdout; remove --output");
  if (command === "pull" && !input) throw new Error("pull requires a scene address or ID");
  if (["list", "pull"].includes(command) && expression !== undefined) throw new Error(`${command} does not accept --expression`);
  if (command !== "pull" && (
    remote.frame !== undefined || remote.max_width !== undefined || remote.padding !== undefined
  )) {
    throw new Error(`${command} does not accept preview options`);
  }
  if (!["apply", "list", "pull"].includes(command) && remote.api_url !== undefined) {
    throw new Error(`${command} does not accept --api-url`);
  }
  if (!["build", "pull"].includes(command) && remote.background !== undefined) {
    throw new Error(`${command} does not accept --background`);
  }
  for (const key of ["max_width", "padding"] as const) {
    const value = remote[key];
    if (value !== undefined) {
      if (!Number.isInteger(value) || value < 0) throw new Error(`--${key.replace("_", "-")} must be a non-negative integer`);
    }
  }
  if (remote.max_width !== undefined && remote.max_width > 1920) throw new Error("--max-width must be no greater than 1920");
  if (command === "pull" && (
    remote.frame !== undefined || remote.max_width !== undefined
    || remote.padding !== undefined || remote.background !== undefined
  )) {
    const extension = extname(output ?? "scene.excalidraw").toLocaleLowerCase();
    if (extension !== ".png" && extension !== ".svg") {
      throw new Error("preview options require a .png or .svg output");
    }
  }
  if (command === "pull" && output !== undefined && output !== "-") {
    const extension = extname(output).toLocaleLowerCase();
    if (![".excalidraw", ".json", ".png", ".svg"].includes(extension)) {
      throw new Error("pull output must end in .excalidraw, .json, .png, or .svg");
    }
  }
  return { action: command as Command, input, expression, output, remote };
}

function argumentUsage(argument: ConstructorArgumentManifest): string {
  const value = `${argument.name}: ${argument.kind}${argument.variadic ? "..." : ""}`;
  return argument.required ? `<${value}>` : `[${value}]`;
}

function constructorUsage(constructor: ConstructorManifest): string {
  const argumentsUsage = constructor.arguments.map(argumentUsage).join(" ");
  return argumentsUsage ? `${constructor.name} ${argumentsUsage}` : constructor.name;
}

function renderLibraryList(): string {
  const summaries = listLibraryManifests().map(summarizeLibraryManifest);
  const nameWidth = Math.max("LIBRARY".length, ...summaries.map((summary) => summary.name.length));
  const constructorWidth = Math.max("CONSTRUCTORS".length, ...summaries.map((summary) => String(summary.constructors.length).length));
  const valueWidth = Math.max("VALUES".length, ...summaries.map((summary) => String(summary.values.length).length));
  return [
    `${"LIBRARY".padEnd(nameWidth)}  ${"CONSTRUCTORS".padStart(constructorWidth)}  ${"VALUES".padStart(valueWidth)}  DESCRIPTION`,
    ...summaries.map((summary) => (
      `${summary.name.padEnd(nameWidth)}  ${String(summary.constructors.length).padStart(constructorWidth)}  ${String(summary.values.length).padStart(valueWidth)}  ${summary.synopsis}`
    )),
  ].join("\n");
}

function renderLibrary(manifest: LibraryManifest): string {
  const constructors = manifest.constructors.flatMap((constructor) => {
    const properties = constructor.properties.map((property) => (
      `${property.name}: ${property.kind}${property.required ? " (required)" : ""}`
    )).join(", ");
    return [
      `  ${constructorUsage(constructor)}`,
      `    ${constructor.documentation.synopsis}`,
      ...(properties ? [`    Properties: ${properties}`] : []),
    ];
  });
  const values = manifest.values.map((value) => `  ${value.name}: ${value.kind} - ${value.synopsis}`);
  return [
    manifest.name,
    manifest.documentation.synopsis,
    "",
    "Constructors:",
    ...(constructors.length ? constructors : ["  None"]),
    "",
    "Values:",
    ...(values.length ? values : ["  None"]),
    "",
    "Examples:",
    ...manifest.documentation.examples.map((example) => `  ${example}`),
  ].join("\n");
}

function requiredInput(options: ParsedArguments): string {
  if (!options.input) throw new Error(`${options.action} requires a scene address or ID`);
  return options.input;
}

async function loadInput(
  input: string | undefined,
  expression: string | undefined,
  stdin: NodeJS.ReadableStream,
) {
  if (expression !== undefined) {
    const filesystem = new RootedFileSystem(process.cwd());
    return resolveAssets(parseSource(expression), filesystem);
  }
  if (input === undefined || input === "-") {
    const filesystem = new RootedFileSystem(process.cwd());
    const source = await readStdin(stdin);
    if (!source.trim()) throw new Error("stdin did not contain XDraw source");
    return resolveAssets(parseSource(source), filesystem);
  }
  const entry = resolve(input);
  const filesystem = new RootedFileSystem(dirname(entry));
  try {
    return resolveAssets(parseSource(await readFile(entry, "utf8")), filesystem);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "XDrawSyntaxError") {
      error.message = `${basename(entry)}: ${error.message}`;
    }
    throw error;
  }
}

async function withRemote<T>(
  options: ParsedArguments,
  remoteFactory: RemoteFactory,
  action: (remote: RemoteClient) => Promise<T>,
): Promise<T> {
  const remote = await remoteFactory({ baseUrl: options.remote.api_url });
  try { return await action(remote); }
  finally { await remote.close(); }
}

async function loadSceneInput(
  input: string | undefined,
  expression: string | undefined,
  stdin: NodeJS.ReadableStream,
): Promise<SceneDocument> {
  let source: string;
  let filesystem: RootedFileSystem;
  if (expression !== undefined) {
    source = expression;
    filesystem = new RootedFileSystem(process.cwd());
  } else if (input === undefined || input === "-") {
    source = await readStdin(stdin);
    filesystem = new RootedFileSystem(process.cwd());
  } else {
    const entry = resolve(input);
    source = await readFile(entry, "utf8");
    filesystem = new RootedFileSystem(dirname(entry));
  }
  if (!source.trim()) throw new Error("scene document input is empty");
  const document = parseSceneDocument(source);
  if (document.operation.type === "replace") {
    document.operation.diagram = await resolveAssets(document.operation.diagram, filesystem);
  } else if (document.operation.additions) {
    document.operation.additions = await resolveAssets({
      ...document.operation.additions,
      title: document.operation.additions.title ?? "",
    }, filesystem);
  }
  return document;
}

export async function run(argv: readonly string[], {
  stdin = process.stdin,
  stderr = process.stderr,
  remoteFactory = (options) => ExcalidrawApiClient.connect(options),
}: RunDependencies = {}): Promise<string> {
  const options = parseArguments(argv);
  if (options.action === "help") return options.help ?? HELP;
  if (options.action === "version") return `xdraw ${await version()}`;
  if (options.action === "library-list") return renderLibraryList();
  if (options.action === "library-show") {
    const name = requiredInput(options);
    const manifest = getLibraryManifest(name);
    if (!manifest) throw new Error(`unknown library '${name}'; run 'xdraw library list' to see available libraries`);
    return options.json ? JSON.stringify(manifest, null, 2) : renderLibrary(manifest);
  }
  if (["build", "check", "apply"].includes(options.action)
      && options.input === undefined && options.expression === undefined && stdin.isTTY === true) return HELP;

  if (options.action === "apply") {
    const scene = await loadSceneInput(options.input, options.expression, stdin);
    return withRemote(options, remoteFactory, async (remote) => {
      const resource = formatSceneResource(scene.resource);
      if (scene.operation.type === "replace") {
        const drawing = await compileAsync(scene.operation.diagram);
        if (drawing.diagnostics.length) stderr.write(`${drawing.diagnostics.map(formatDiagnostic).join("\n")}\n`);
        const result = await remote.applyReplace(scene.resource, drawing.toJSON());
        return `${result.created ? "Created" : "Replaced"} ${resource} (${result.added} elements)\nScene ID: ${result.sceneId}`;
      }
      let drawing;
      if (scene.operation.additions) {
        const compiled = await compileAsync({
          ...scene.operation.additions,
          title: scene.operation.additions.title ?? "",
        });
        if (compiled.diagnostics.length) stderr.write(`${compiled.diagnostics.map(formatDiagnostic).join("\n")}\n`);
        drawing = compiled.toJSON();
      }
      const result = await remote.applyPatch(scene.resource, {
        updates: scene.operation.updates,
        deletes: scene.operation.deletes,
        drawing,
      });
      return `Patched ${resource} (${result.added} added, ${result.updated} updated, ${result.deleted} deleted)\nScene ID: ${result.sceneId}`;
    });
  }

  if (options.action === "list") {
    return withRemote(options, remoteFactory, async (remote) => {
      const scenes = await remote.listScenes(options.input);
      if (!scenes.length) return "No hosted scenes found.";
      const addressWidth = Math.max("ADDRESS".length, ...scenes.map((scene) => scene.address.length));
      return [
        `${"ADDRESS".padEnd(addressWidth)}  SCENE ID`,
        ...scenes.map((scene) => `${scene.address.padEnd(addressWidth)}  ${scene.sceneId}`),
      ].join("\n");
    });
  }

  if (options.action === "pull") {
    const selector = requiredInput(options);
    const targetSelector = remoteSelector(selector);
    return withRemote(options, remoteFactory, async (remote) => {
      const content = await remote.pull(targetSelector);
      const payload = JSON.stringify(content, null, 2);
      const target = options.output ?? defaultPullOutput(selector);
      if (target === "-") return payload;
      const resolvedTarget = resolve(target);
      await mkdir(dirname(resolvedTarget), { recursive: true });
      const renderOptions = {
        backgroundColor: options.remote.background,
        frameId: options.remote.frame,
        maxWidth: options.remote.max_width,
        padding: options.remote.padding,
      };
      const extension = extname(resolvedTarget).toLocaleLowerCase();
      if (extension === ".png") await writeFile(resolvedTarget, renderScenePng(content, renderOptions));
      else if (extension === ".svg") await writeFile(resolvedTarget, `${renderSceneSvg(content, renderOptions)}\n`, "utf8");
      else await writeFile(resolvedTarget, `${payload}\n`, "utf8");
      return `Saved ${selector} to ${resolvedTarget}`;
    });
  }

  const document = await loadInput(options.input, options.expression, stdin);
  const drawing = await compileAsync(document);
  if (drawing.diagnostics.length) {
    stderr.write(`${drawing.diagnostics.map(formatDiagnostic).join("\n")}\n`);
  }
  if (options.action === "check") {
    drawing.toJSON();
    return `OK ${options.expression !== undefined ? "inline expression" : options.input ?? "stdin"}`;
  }

  const target = options.output === undefined ? defaultOutput(options.input) : options.output;
  const targetExtension = target === "-" ? "" : extname(target).toLocaleLowerCase();
  if (options.remote.background !== undefined && targetExtension !== ".png" && targetExtension !== ".svg") {
    throw new Error("--background requires a .png or .svg output");
  }
  if (target === "-") return JSON.stringify(drawing.toJSON(), null, 2);
  const resolvedTarget = resolve(target);
  await mkdir(dirname(resolvedTarget), { recursive: true });
  const renderOptions = { backgroundColor: options.remote.background };
  if (targetExtension === ".png") await writeFile(resolvedTarget, renderScenePng(drawing.toJSON(), renderOptions));
  else if (targetExtension === ".svg") {
    await writeFile(resolvedTarget, `${renderSceneSvg(drawing.toJSON(), renderOptions)}\n`, "utf8");
  }
  else await writeDrawing(drawing, resolvedTarget);
  return `Created ${resolvedTarget}`;
}
