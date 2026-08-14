import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { promisify } from "node:util";

import { compile, compileAsync } from "../src/compile/pipeline.ts";
import { prepareLayeredLayout } from "../src/layout/elk/prepare.ts";
import { runElkLayout } from "../src/layout/elk/worker-transport.ts";
import { parseSource } from "../src/language/parser.ts";
import { buildSemanticIR } from "../src/language/semantic.ts";
import { expandDocument } from "../src/language/expander.ts";
import { requireArrow, requireElementById } from "../test-support/assertions.ts";
import { budgetMs } from "../test-support/budget.ts";
import type { Drawing } from "../src/excalidraw/document.ts";
import type { SemanticDocument } from "../src/contracts/semantic.ts";
import type { DrawingElement } from "../src/contracts/render.ts";

const execFileAsync = promisify(execFile);

function semantic(source: string): SemanticDocument {
  return buildSemanticIR(expandDocument(parseSource(source)));
}

function frames(drawing: Drawing, ids: readonly string[]): DrawingElement[] {
  const elements = drawing.toJSON().elements;
  return ids.map((id) => requireElementById(elements, `${id}:frame`));
}

test("public compilation uses deterministic ELK placement for cyclic layered graphs", async () => {
  const source = `diagram "Cycle" {
    arrange layered {}
    a: rectangle "A"
    b: rectangle "B"
    c: rectangle "C"
    a -> b
    b -> c
    c -> a
  }`;
  const first = await compileAsync(parseSource(source));
  const second = await compileAsync(parseSource(source));
  assert.deepEqual(first.toJSON(), second.toJSON());
  const placed = frames(first, ["a", "b", "c"]);
  assert.equal(new Set(placed.map((frame) => frame.x)).size, 3);
  assert.equal(first.toJSON().elements.filter((element) => element.type === "arrow").length, 3);
});

test("ELK placement preserves XDraw labels and explicit connector sides", async () => {
  const drawing = await compileAsync(parseSource(`diagram "Ports" {
    arrange layered {}
    producer: rectangle "Producer"
    consumer: rectangle "Consumer"
    producer@right -> consumer@left "HTTPS"
  }`));
  const elements = drawing.toJSON().elements;
  const connector = requireArrow(elements, "document:connection:0:0");
  assert.ok(connector.startBinding);
  assert.ok(connector.endBinding);
  assert.deepEqual(connector.startBinding.fixedPoint, [1, 0.5]);
  assert.deepEqual(connector.endBinding.fixedPoint, [0, 0.5]);
  assert.ok(elements.some((element) => element.type === "text" && element.text === "HTTPS"));
});

test("opposing explicit ports route around their endpoint nodes", async () => {
  const drawing = (await compileAsync(parseSource(`diagram "Opposing ports" {
    arrange layered {}
    a: rectangle "A"
    b: rectangle "B"
    a@left -> b@right
  }`))).toJSON();
  const arrow = requireArrow(drawing.elements);
  const absolute = arrow.points.map(([x, y]) => [x + arrow.x, y + arrow.y]);
  const a = requireElementById(drawing.elements, "a:frame");
  const b = requireElementById(drawing.elements, "b:frame");
  const centerY = a.y + a.height / 2;
  assert.ok(absolute.some(([, y]) => y < Math.min(a.y, b.y) || y > Math.max(a.y + a.height, b.y + b.height)));
  assert.notDeepEqual(absolute, [[a.x, centerY], [b.x + b.width, centerY]]);
});

test("parallel layered connections use distinguishable routes", async () => {
  const drawing = (await compileAsync(parseSource(`diagram "Parallel" {
    arrange layered {}
    a: rectangle "A"
    b: rectangle "B"
    a -> b
    a -> b
  }`))).toJSON();
  const routes = drawing.elements
    .filter((element) => element.type === "arrow")
    .map((arrow) => arrow.points.map(([x, y]) => [x + arrow.x, y + arrow.y]));
  assert.equal(routes.length, 2);
  assert.notDeepEqual(routes[0], routes[1]);
});

test("ELK preparation is lazy for non-layered documents", async () => {
  let calls = 0;
  const result = await prepareLayeredLayout(semantic('diagram "Row" { a: rectangle "A" }'), {
    layout: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.status, "not-requested");
  assert.equal(result.bounds, null);
});

test("empty layered documents use the built-in empty layout", async () => {
  let calls = 0;
  const result = await prepareLayeredLayout(semantic('diagram "Empty" { arrange layered {} }'), {
    layout: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.status, "built-in");
  if (result.status === "built-in") assert.equal(result.reason, "empty");
  assert.equal(result.bounds, null);
});

test("layered preparation reports why compound layouts use the built-in adapter", async () => {
  const result = await prepareLayeredLayout(semantic(`diagram "Compound" {
    arrange layered {}
    scope: frame "Scope" { a: rectangle "A" }
  }`));
  assert.deepEqual(result, { status: "built-in", reason: "compound-layout", bounds: null });
});

test("ELK transport bounds worker creation and reports premature exits", async () => {
  await assert.rejects(
    runElkLayout({ id: "root" }, {
      timeoutMs: 1,
      createWorker: () => new Promise(() => undefined),
    }),
    /exceeded 1 ms/,
  );

  let exit: ((code: number) => void) | undefined;
  await assert.rejects(
    runElkLayout({ id: "root" }, {
      createWorker: async () => ({
        postMessage: () => exit?.(2),
        terminate: () => undefined,
        onMessage: () => () => undefined,
        onError: () => () => undefined,
        onExit: (handler) => { exit = handler; return () => undefined; },
      }),
    }),
    /exited with code 2/,
  );
});

test("layered output is deterministic across compiler processes", async () => {
  const source = `diagram "Process" {
    arrange layered {}
    a: rectangle "A"
    b: rectangle "B"
    c: rectangle "C"
    a -> b
    a -> c
    c -> b
  }`;
  const script = `
    import { compileAsync } from "./src/compile/pipeline.ts";
    import { parseSource } from "./src/language/parser.ts";
    const drawing = await compileAsync(parseSource(${JSON.stringify(source)}));
    process.stdout.write(JSON.stringify(drawing.toJSON()));
  `;
  const options = {
    cwd: new URL("..", import.meta.url),
    maxBuffer: 10 * 1024 * 1024,
  };
  const [first, second] = await Promise.all([
    execFileAsync(process.execPath, ["--input-type=module", "--eval", script], options),
    execFileAsync(process.execPath, ["--input-type=module", "--eval", script], options),
  ]);
  assert.equal(first.stdout, second.stdout);
});

test("ELK preparation fails closed instead of changing layout algorithms", async () => {
  const document = semantic('diagram "Layered" { arrange layered {}; a: rectangle "A" }');
  await assert.rejects(
    prepareLayeredLayout(document, { layout: async () => { throw new Error("worker unavailable"); } }),
    /worker unavailable/,
  );
  await assert.rejects(
    prepareLayeredLayout(document, { layout: async (graph) => ({ ...graph, children: [] }) }),
    /incomplete node geometry/,
  );
  const started = performance.now();
  await assert.rejects(prepareLayeredLayout(document, { timeoutMs: 1 }), /exceeded 1 ms/);
  assert.ok(performance.now() - started < budgetMs(500), "worker termination must bound timeout latency");
  const recovered = await prepareLayeredLayout(document);
  assert.equal(recovered.status, "prepared");
  assert.equal(recovered.bounds?.size, 1);
});

test("ELK rejects geometry that becomes invalid after normalization", async () => {
  const document = semantic('diagram "Layered" { arrange layered {}; a: rectangle "A"; b: rectangle "B" }');
  await assert.rejects(prepareLayeredLayout(document, {
    layout: async (graph) => ({
      ...graph,
      children: graph.children?.map((child) => ({ ...child, x: 0, y: 0, width: 0.1, height: 0.1 })),
    }),
  }), /invalid a width/);
  await assert.rejects(prepareLayeredLayout(document, {
    layout: async (graph) => ({
      ...graph,
      children: graph.children?.map((child, index) => ({
        ...child,
        x: index ? Number.MAX_VALUE : -Number.MAX_VALUE,
        y: 0,
      })),
    }),
  }), /invalid .* x/);
});

test("ELK placement honors the shared spacing policy", async () => {
  const source = (layout: string) => `diagram "Spacing" {
      arrange layered { ${layout} }
      a: rectangle "A"
      b: rectangle "B"
      a -> b
    }`;
  const positions = (drawing: Drawing) => frames(drawing, ["a", "b"]).map((frame) => frame.x);
  const synchronousTight = positions(compile(parseSource(source("spacing tight"))));
  const asynchronousTight = positions(await compileAsync(parseSource(source("spacing tight"))));
  const wide = positions(await compileAsync(parseSource(source("gap 120"))));
  assert.deepEqual(asynchronousTight, synchronousTight);
  assert.ok(wide[1] - wide[0] > asynchronousTight[1] - asynchronousTight[0]);
});

test("layered preparation rejects excessive graph density before routing", async () => {
  const count = 30;
  const nodes = Array.from({ length: count }, (_, index) => `n${index}: rectangle "${index}"`).join("\n");
  const edges = Array.from({ length: count }, (_, from) => (
    Array.from({ length: count - from - 1 }, (_, offset) => `n${from} -> n${from + offset + 1}`)
  )).flat().join("\n");
  await assert.rejects(
    compileAsync(parseSource(`diagram "Dense" { arrange layered {}; ${nodes}; ${edges} }`)),
    /at most 400 connection segments/,
  );
});

for (const [sectionType, source] of [
  ["code", 'diagram "Code" { arrange layered {}; sample: code "const x = 1" }'],
  ["sequence", `use "xdraw/sequence" as seq
    diagram "Sequence" {
      arrange layered {}
      interaction: seq.sequence {
        client: seq.participant "Client"
        server: seq.participant "Server"
        client -> server "Request"
      }
    }`],
  ["tree", `diagram "Tree" {
      arrange layered {}
      map: section "Map" {
        arrange tree { root root }
        root: rectangle "Root"
        child: rectangle "Child"
        root -> child
      }
    }`],
]) {
  test(`layered layout rejects top-level ${sectionType} sections it cannot place`, async () => {
    await assert.rejects(
      compileAsync(parseSource(source)),
      new RegExp(`cannot place top-level ${sectionType} sections`),
    );
  });
}

test("layered preparation rejects non-node connection endpoints explicitly", async () => {
  await assert.rejects(
    compileAsync(parseSource(`use "xdraw/annotations" as annotations
    diagram "Annotation endpoint" {
      arrange layered {}
      a: rectangle "A"
      n: annotations.note "N" { attach a@bottom }
      a -> n
    }`)),
    /layered connection requires node endpoints: a -> n/,
  );
});

test("ELK remains pinned as an output-affecting runtime dependency", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.dependencies.elkjs, "0.11.0");
  assert.equal(packageJson.devDependencies.elkjs, undefined);
});

test("ELK places 200 layered nodes within the acceptance budget", async () => {
  const count = 200;
  const nodes = Array.from({ length: count }, (_, index) => `n${index}: rectangle "Node ${index}"`).join("\n");
  const edges = Array.from({ length: count - 1 }, (_, index) => `n${Math.floor(index / 2)} -> n${index + 1}`).join("\n");
  const started = performance.now();
  const drawing = await compileAsync(parseSource(`diagram "Scale" { arrange layered { gap 12 } ${nodes} ${edges} }`));
  const elapsed = performance.now() - started;
  assert.equal(drawing.toJSON().elements.filter((element) => element.id.endsWith(":frame")).length, count);
  assert.ok(elapsed < budgetMs(4_000), `200-node asynchronous compile took ${elapsed.toFixed(1)} ms`);
});
