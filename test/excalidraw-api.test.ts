import assert from "node:assert/strict";
import test from "node:test";

import { digestAssetBytes } from "../src/io/assets.ts";
import { ExcalidrawApiClient } from "../src/excalidraw-api.ts";
import type { ExcalidrawFetch, SceneResource } from "../src/excalidraw-api.ts";
import type { DrawingElement, DrawingJson } from "../src/contracts/render.ts";

interface FakeCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, any> & { elements: Array<Record<string, any>> };
}

interface FakeRoute {
  method: string;
  path: string | RegExp;
  status?: number;
  payload?: unknown | ((call: FakeCall) => unknown);
}

function reply(status: number, payload: unknown): Response {
  return new Response(payload === undefined ? "" : JSON.stringify(payload), {
    status,
    statusText: status === 200 ? "OK" : "Error",
  });
}

function fakeFetch(routes: FakeRoute[]): { fetch: ExcalidrawFetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetch: ExcalidrawFetch = async (input, init = {}) => {
    const parsed = new URL(input instanceof Request ? input.url : input);
    const call = {
      method: init.method ?? "GET",
      path: `${parsed.pathname}${parsed.search}`,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: (typeof init.body === "string" ? JSON.parse(init.body) : {}) as FakeCall["body"],
    };
    calls.push(call);
    const route = routes.find((item) => (
      item.method === call.method
      && (typeof item.path === "string" ? item.path === call.path : item.path.test(call.path))
    ));
    if (!route) throw new Error(`unexpected request: ${call.method} ${call.path}`);
    return reply(route.status ?? 200, typeof route.payload === "function" ? route.payload(call) : route.payload);
  };
  return { fetch, calls };
}

function callAt(calls: FakeCall[], index = -1): FakeCall {
  const call = calls.at(index);
  assert.ok(call, `missing recorded call at ${index}`);
  return call;
}

function resource(scene = "system_overview"): SceneResource {
  return { provider: "excalidraw", workspace: "default", collection: "architecture", scene };
}

type SceneElementSeed = { id: string; type: DrawingElement["type"] } & Record<string, unknown>;

function sceneElement(overrides: SceneElementSeed): DrawingElement {
  const type = overrides.type;
  const base = {
    id: overrides.id,
    type,
    x: 0,
    y: 0,
    width: 120,
    height: 72,
    angle: 0,
    strokeColor: "#1f2937",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
  const byType = type === "text" ? {
    fontSize: 20,
    fontFamily: 3,
    text: "Text",
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    originalText: "Text",
    lineHeight: 1.25,
    autoResize: true,
  } : type === "arrow" || type === "line" ? {
    points: [[0, 0], [120, 0]],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: type === "arrow" ? "arrow" : null,
    ...(type === "arrow" ? { elbowed: false } : {}),
  } : type === "freedraw" ? {
    points: [[0, 0], [20, 20]],
    pressures: [],
    simulatePressure: true,
    lastCommittedPoint: null,
  } : type === "frame" ? {
    name: null,
  } : type === "image" ? {
    fileId: "image-1",
    status: "saved",
    scale: [1, 1],
    crop: null,
  } : {};
  return { ...base, ...byType, ...overrides } as DrawingElement;
}

function drawing(elements: SceneElementSeed[] = [{ id: "api", type: "rectangle", version: 1 }]): DrawingJson {
  return {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: elements.map(sceneElement),
    appState: {
      gridSize: 20,
      gridStep: 5,
      gridModeEnabled: false,
      viewBackgroundColor: "#eef2f7",
    },
    files: {},
  };
}

function inventoryRoutes(scenePayload: unknown[] = []): FakeRoute[] {
  return [
    {
      method: "GET",
      path: "/api/v1/collections?limit=100&offset=0",
      payload: { data: [{ metadata: { id: "collection-1", name: "Architecture" } }], hasNextPage: false },
    },
    {
      method: "GET",
      path: "/api/v1/collections/collection-1/scenes?limit=100&offset=0",
      payload: { data: scenePayload, hasNextPage: false },
    },
  ];
}

test("REST client requires an API key and sends bearer authentication", async () => {
  assert.throws(() => new ExcalidrawApiClient(), /EXCALIDRAW_API_KEY is required/);
  const remote = fakeFetch([{ method: "GET", path: "/api/v1/scenes/scene-1/content", payload: drawing([]) }]);
  const client = new ExcalidrawApiClient({ apiKey: "Bearer secret", fetch: remote.fetch });
  await client.pull("scene-1");
  assert.equal(callAt(remote.calls, 0).headers.Authorization, "Bearer secret");
});

test("REST errors retain the operation, status, and remote message", async () => {
  const remote = fakeFetch([{
    method: "GET",
    path: "/api/v1/scenes/missing/content",
    status: 404,
    payload: { message: "Scene not found" },
  }]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  await assert.rejects(() => client.pull("missing"), /GET \/scenes\/missing\/content failed \(404\): Scene not found/);
});

test("collection and scene inventories are paginated", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ metadata: { id: `c-${index}`, name: `Other ${index}` } }));
  const remote = fakeFetch([
    {
      method: "GET",
      path: "/api/v1/collections?limit=100&offset=0",
      payload: { data: firstPage, hasNextPage: true },
    },
    {
      method: "GET",
      path: "/api/v1/collections?limit=100&offset=100",
      payload: { data: [{ metadata: { id: "collection-1", name: "Architecture" } }], hasNextPage: false },
    },
    {
      method: "GET",
      path: "/api/v1/collections/collection-1/scenes?limit=100&offset=0",
      payload: { data: [{ metadata: { id: "scene-1", name: "System overview" } }], hasNextPage: false },
    },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  assert.deepEqual(await client.resolveSceneResource(resource()), {
    sceneId: "scene-1", collectionId: "collection-1", created: false,
  });
});

test("a missing collection names the ones that exist and says who creates them", async () => {
  const remote = fakeFetch([{
    method: "GET",
    path: "/api/v1/collections?limit=100&offset=0",
    payload: {
      data: [
        { metadata: { id: "collection-2", name: "Infrastructure Engineering" } },
        { metadata: { id: "collection-1", name: "Architecture" } },
      ],
      hasNextPage: false,
    },
  }]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  // A scene is created on demand, a collection is not, so the reader needs to know
  // this is a wrong name and where the right ones come from.
  await assert.rejects(
    () => client.resolveSceneResource({ ...resource(), collection: "DataAnalytics" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /no collection 'DataAnalytics'/);
      assert.match(error.message, /created in the Excalidraw\+ app/);
      assert.match(error.message, /'Architecture', 'Infrastructure Engineering'/);
      return true;
    },
  );
});

test("hosted scene inventory exposes copyable addresses and stable IDs", async () => {
  const remote = fakeFetch([
    {
      method: "GET",
      path: "/api/v1/collections?limit=100&offset=0",
      payload: { data: [
        { metadata: { id: "collection-2", name: "Product" } },
        { metadata: { id: "collection-1", name: "Architecture" } },
      ], hasNextPage: false },
    },
    {
      method: "GET",
      path: "/api/v1/collections/collection-1/scenes?limit=100&offset=0",
      payload: { data: [{ metadata: { id: "scene-1", name: "System overview" } }], hasNextPage: false },
    },
    {
      method: "GET",
      path: "/api/v1/collections/collection-2/scenes?limit=100&offset=0",
      payload: { data: [{ metadata: { id: "scene-2", name: "User journey" } }], hasNextPage: false },
    },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  assert.deepEqual(await client.listScenes(), [
    {
      address: "excalidraw::default::Architecture::System overview",
      sceneId: "scene-1",
      sceneName: "System overview",
      collectionId: "collection-1",
      collectionName: "Architecture",
    },
    {
      address: "excalidraw::default::Product::User journey",
      sceneId: "scene-2",
      sceneName: "User journey",
      collectionId: "collection-2",
      collectionName: "Product",
    },
  ]);
});

test("hosted scene inventory falls back to IDs when names are ambiguous", async () => {
  const remote = fakeFetch([
    {
      method: "GET",
      path: "/api/v1/collections?limit=100&offset=0",
      payload: { data: [{ metadata: { id: "collection-1", name: "Architecture" } }], hasNextPage: false },
    },
    {
      method: "GET",
      path: "/api/v1/collections/collection-1/scenes?limit=100&offset=0",
      payload: { data: [
        { metadata: { id: "scene-1", name: "Overview" } },
        { metadata: { id: "scene-2", name: "Overview" } },
      ], hasNextPage: false },
    },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  assert.deepEqual((await client.listScenes()).map(({ address }) => address), [
    "excalidraw::default::Architecture::scene-1",
    "excalidraw::default::Architecture::scene-2",
  ]);
});

test("bare-array inventories remain supported", async () => {
  const remote = fakeFetch([
    {
      method: "GET",
      path: "/api/v1/collections?limit=100&offset=0",
      payload: [{ id: "collection-1", name: "Architecture" }],
    },
    {
      method: "GET",
      path: "/api/v1/collections/collection-1/scenes?limit=100&offset=0",
      payload: [{ sceneId: "scene-1", title: "System overview" }],
    },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  assert.deepEqual(await client.resolveSceneResource(resource()), {
    sceneId: "scene-1", collectionId: "collection-1", created: false,
  });
});

test("inventory responses validate pagination and resource records", async () => {
  const invalidMarker = fakeFetch([{
    method: "GET",
    path: "/api/v1/collections?limit=100&offset=0",
    payload: { data: [], hasNextPage: "yes" },
  }]);
  await assert.rejects(
    () => new ExcalidrawApiClient({ apiKey: "secret", fetch: invalidMarker.fetch }).listAll("/collections"),
    /invalid pagination marker/,
  );

  const invalidRecord = fakeFetch([{
    method: "GET",
    path: "/api/v1/collections?limit=100&offset=0",
    payload: { data: [{ metadata: { id: 42, name: "Architecture" } }], hasNextPage: false },
  }]);
  await assert.rejects(
    () => new ExcalidrawApiClient({ apiKey: "secret", fetch: invalidRecord.fetch }).listAll("/collections"),
    /invalid resource record/,
  );
});

test("replace creates a missing scene and PUTs the complete tagged drawing", async () => {
  const remote = fakeFetch([
    ...inventoryRoutes(),
    {
      method: "POST",
      path: "/api/v1/scenes",
      payload: { metadata: { id: "scene-new" } },
    },
    { method: "PUT", path: "/api/v1/scenes/scene-new/content", payload: {} },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  assert.deepEqual(await client.applyReplace(resource(), drawing()), {
    sceneId: "scene-new", added: 1, created: true,
  });
  assert.deepEqual(callAt(remote.calls, -2).body, {
    name: "System Overview", pinned: false, collectionId: "collection-1",
  });
  assert.equal(callAt(remote.calls).method, "PUT");
  assert.equal(callAt(remote.calls).body.elements[0]?.customData.xdrawId, "api");
});

test("replace preserves formula metadata while adding the hosted scene identity", async () => {
  const remote = fakeFetch([
    ...inventoryRoutes(),
    {
      method: "POST",
      path: "/api/v1/scenes",
      payload: { metadata: { id: "scene-new" } },
    },
    { method: "PUT", path: "/api/v1/scenes/scene-new/content", payload: {} },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  await client.applyReplace(resource(), drawing([{
    id: "formula:image",
    type: "image",
    fileId: "image-1",
    customData: {
      xdraw: {
        type: "formula",
        source: String.raw`E = mc^2`,
        renderer: "mathjax-svg",
      },
    },
  }]));
  assert.deepEqual(callAt(remote.calls).body.elements[0]?.customData, {
    xdraw: {
      type: "formula",
      source: String.raw`E = mc^2`,
      renderer: "mathjax-svg",
    },
    xdrawId: "formula:image",
  });
});

test("scene creation validates the returned resource", async () => {
  const remote = fakeFetch([{
    method: "POST",
    path: "/api/v1/scenes",
    payload: { metadata: { id: 42 } },
  }]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  await assert.rejects(
    () => client.createScene({ name: "System overview", collectionId: "collection-1" }),
    /scene creation returned an invalid resource record/,
  );
});

test("replace assigns deterministic Excalidraw ordering keys", async () => {
  const remote = fakeFetch([
    ...inventoryRoutes(),
    {
      method: "POST",
      path: "/api/v1/scenes",
      payload: { metadata: { id: "scene-new" } },
    },
    { method: "PUT", path: "/api/v1/scenes/scene-new/content", payload: {} },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  await client.applyReplace(resource(), drawing([
    { id: "first", type: "rectangle", index: "stale" },
    { id: "second", type: "rectangle" },
    { id: "third", type: "rectangle" },
  ]));

  const indices = callAt(remote.calls).body.elements.map((element) => element.index as string);
  assert.ok(indices.every((index) => typeof index === "string" && index.length > 0));
  assert.deepEqual(indices, [...indices].sort());
  assert.equal(new Set(indices).size, indices.length);
  assert.notEqual(indices[0], "stale");
});

test("replace resolves normalized scene names and never reads existing content", async () => {
  const remote = fakeFetch([
    ...inventoryRoutes([{ metadata: { id: "scene-1", name: "System overview" } }]),
    { method: "PUT", path: "/api/v1/scenes/scene-1/content", payload: {} },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  const result = await client.applyReplace(resource(), drawing());
  assert.equal(result.created, false);
  assert.deepEqual(remote.calls.map((item) => item.method), ["GET", "GET", "PUT"]);
});

test("patch updates a semantic shape and its bound label as complete newer elements", async () => {
  const content = drawing([
    {
      id: "shape-remote", type: "rectangle", version: 4, versionNonce: 10,
      strokeColor: "#111111", backgroundColor: "#eeeeee",
      customData: { xdrawId: "api" }, boundElements: [{ id: "label-remote", type: "text" }],
    },
    {
      id: "label-remote", type: "text", version: 2, versionNonce: 11,
      text: "API", originalText: "API", strokeColor: "#111111", containerId: "shape-remote",
    },
  ]);
  const remote = fakeFetch([
    ...inventoryRoutes([{ metadata: { id: "scene-1", name: "System overview" } }]),
    { method: "GET", path: "/api/v1/scenes/scene-1/content", payload: content },
    { method: "PATCH", path: "/api/v1/scenes/scene-1/content", payload: {} },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  await client.applyPatch(resource(), { updates: [{ target: "api", properties: { tone: "warning", title: "API v2" } }] });
  const [shape, label] = callAt(remote.calls).body.elements;
  assert.ok(shape && label);
  assert.equal(shape.id, "shape-remote");
  assert.equal(shape.version, 5);
  assert.notEqual(shape.versionNonce, 10);
  assert.equal(label.id, "label-remote");
  assert.equal(label.version, 3);
  assert.equal(label.text, "API v2");
  assert.equal(label.containerId, "shape-remote");
});

test("title-only patches do not rewrite the containing shape", async () => {
  const content = drawing([
    { id: "shape", type: "rectangle", version: 1, customData: { xdrawId: "api" }, boundElements: [{ id: "label", type: "text" }] },
    { id: "label", type: "text", version: 1, text: "API", containerId: "shape" },
  ]);
  const remote = fakeFetch([
    ...inventoryRoutes([{ metadata: { id: "scene-1", name: "System overview" } }]),
    { method: "GET", path: "/api/v1/scenes/scene-1/content", payload: content },
    { method: "PATCH", path: "/api/v1/scenes/scene-1/content", payload: {} },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  await client.applyPatch(resource(), { updates: [{ target: "api", properties: { title: "New" } }] });
  assert.deepEqual(callAt(remote.calls).body.elements.map((item) => item.id), ["label"]);
});

test("delete soft-deletes the shape and its bound label", async () => {
  const content = drawing([
    { id: "shape", type: "rectangle", version: 1, customData: { xdrawId: "obsolete" }, boundElements: [{ id: "label", type: "text" }] },
    { id: "label", type: "text", version: 1, text: "Old", containerId: "shape" },
  ]);
  const remote = fakeFetch([
    ...inventoryRoutes([{ metadata: { id: "scene-1", name: "System overview" } }]),
    { method: "GET", path: "/api/v1/scenes/scene-1/content", payload: content },
    { method: "PATCH", path: "/api/v1/scenes/scene-1/content", payload: {} },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  await client.applyPatch(resource(), { deletes: ["obsolete"] });
  assert.deepEqual(callAt(remote.calls).body.elements.map(({ id, isDeleted }) => ({ id, isDeleted })), [
    { id: "shape", isDeleted: true }, { id: "label", isDeleted: true },
  ]);
});

test("add rejects collisions with live or deleted historical element IDs", async () => {
  const content = drawing([{ id: "review", type: "text", version: 2, isDeleted: true }]);
  const remote = fakeFetch([
    ...inventoryRoutes([{ metadata: { id: "scene-1", name: "System overview" } }]),
    { method: "GET", path: "/api/v1/scenes/scene-1/content", payload: content },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  await assert.rejects(
    () => client.applyPatch(resource(), { drawing: drawing([{ id: "review", type: "text", version: 1 }]) }),
    /already exists in the scene/,
  );
});

test("add rejects collisions with live XDraw identities after manual scene edits", async () => {
  const content = drawing([{
    id: "remote-api",
    type: "rectangle",
    version: 2,
    customData: { xdrawId: "api" },
  }]);
  const remote = fakeFetch([
    ...inventoryRoutes([{ metadata: { id: "scene-1", name: "System overview" } }]),
    { method: "GET", path: "/api/v1/scenes/scene-1/content", payload: content },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  await assert.rejects(
    () => client.applyPatch(resource(), { drawing: drawing([{ id: "api", type: "rectangle", version: 1 }]) }),
    /already exists in the scene/,
  );
});

test("programmatic patches reject duplicate and conflicting targets before connecting", async () => {
  let requests = 0;
  const client = new ExcalidrawApiClient({
    apiKey: "secret",
    fetch: async () => {
      requests += 1;
      throw new Error("unexpected request");
    },
  });
  await assert.rejects(
    () => client.applyPatch(resource(), {
      updates: [
        { target: "api", properties: { title: "One" } },
        { target: "api", properties: { title: "Two" } },
      ],
    }),
    /duplicate update target 'api'/,
  );
  await assert.rejects(
    () => client.applyPatch(resource(), { deletes: ["api", "api"] }),
    /duplicate delete target 'api'/,
  );
  await assert.rejects(
    () => client.applyPatch(resource(), {
      updates: [{ target: "api", properties: { title: "New" } }],
      deletes: ["api"],
    }),
    /patch cannot update and delete 'api'/,
  );
  assert.equal(requests, 0);
});

test("patch additions receive ordering keys after the existing scene", async () => {
  const content = drawing([
    { id: "existing-a", type: "rectangle", version: 1, index: "a0" },
    { id: "existing-b", type: "rectangle", version: 1, index: "a1" },
  ]);
  const remote = fakeFetch([
    ...inventoryRoutes([{ metadata: { id: "scene-1", name: "System overview" } }]),
    { method: "GET", path: "/api/v1/scenes/scene-1/content", payload: content },
    { method: "PATCH", path: "/api/v1/scenes/scene-1/content", payload: {} },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  await client.applyPatch(resource(), {
    drawing: drawing([
      { id: "added-a", type: "ellipse", version: 1 },
      { id: "added-b", type: "text", version: 1 },
    ]),
  });

  const additions = callAt(remote.calls).body.elements;
  assert.ok(additions[0] && additions[1]);
  assert.ok(additions[0].index > "a1");
  assert.ok(additions[1].index > additions[0].index);
});

test("pull returns editable scene content without mutation", async () => {
  const content = drawing([{ id: "one", type: "rectangle" }]);
  const remote = fakeFetch([{ method: "GET", path: "/api/v1/scenes/scene-1/content", payload: content }]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  assert.deepEqual(await client.pull("scene-1"), content);
  assert.equal(remote.calls.length, 1);
});

test("pull resolves a readable scene address before retrieving content", async () => {
  const content = drawing([{ id: "one", type: "rectangle" }]);
  const remote = fakeFetch([
    ...inventoryRoutes([{ metadata: { id: "scene-1", name: "System overview" } }]),
    { method: "GET", path: "/api/v1/scenes/scene-1/content", payload: content },
  ]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  assert.deepEqual(await client.pull(resource()), content);
  assert.equal(callAt(remote.calls).path, "/api/v1/scenes/scene-1/content");
});

test("pull rejects malformed scene content before it reaches patch logic", async () => {
  const malformed = fakeFetch([{
    method: "GET",
    path: "/api/v1/scenes/scene-1/content",
    payload: drawing([{ id: "one", type: "rectangle", version: "new" }]),
  }]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: malformed.fetch });
  await assert.rejects(() => client.pull("scene-1"), /did not return valid scene content/);
});

test("pull rejects unsafe remote SVG assets", async () => {
  const content = drawing([{ id: "image", type: "image", fileId: "image-1" }]);
  content.files["image-1"] = {
    id: "image-1",
    dataURL: `data:image/svg+xml;base64,${Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script/></svg>',
    ).toString("base64")}`,
    mimeType: "image/svg+xml",
    created: 1,
    lastRetrieved: 1,
  };
  const remote = fakeFetch([{ method: "GET", path: "/api/v1/scenes/scene-1/content", payload: content }]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  await assert.rejects(() => client.pull("scene-1"), /executable or remote content/u);
});

test("pull rejects images without embedded files", async () => {
  const content = drawing([{ id: "image", type: "image", fileId: "missing" }]);
  const remote = fakeFetch([{ method: "GET", path: "/api/v1/scenes/scene-1/content", payload: content }]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  await assert.rejects(() => client.pull("scene-1"), /image 'image' without its embedded file/u);
});

test("pull verifies formula asset integrity metadata", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
  const bytes = new TextEncoder().encode(svg);
  const digest = await digestAssetBytes(bytes);
  const fileId = digest.slice(0, 40);
  const content = drawing([{
    id: "formula",
    type: "image",
    fileId,
    customData: { xdraw: { type: "formula", source: "x", digest: "0".repeat(64) } },
  }]);
  content.files[fileId] = {
    id: fileId,
    dataURL: `data:image/svg+xml;base64,${Buffer.from(bytes).toString("base64")}`,
    mimeType: "image/svg+xml",
    created: 1,
    lastRetrieved: 1,
  };
  const remote = fakeFetch([{ method: "GET", path: "/api/v1/scenes/scene-1/content", payload: content }]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  await assert.rejects(() => client.pull("scene-1"), /invalid integrity metadata/u);
});

test("requests stop when the configured timeout expires", async () => {
  const fetch: ExcalidrawFetch = (_url, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    assert.ok(signal);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch, timeoutMs: 5 });

  await assert.rejects(
    () => client.listAll("/collections"),
    /GET \/collections\?limit=100&offset=0 timed out after 5ms/,
  );
});

test("inventory pagination stops at the configured ceiling", async () => {
  const fetch = async () => new Response(JSON.stringify({
    data: Array.from({ length: 100 }, (_, index) => ({ id: `item-${index}` })),
    hasNextPage: true,
  }), { status: 200 });
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch, maxPages: 2 });

  await assert.rejects(
    () => client.listAll("/collections"),
    /exceeded the 2-page inventory limit/,
  );
});

test("request bounds must be positive integers", () => {
  assert.throws(
    () => new ExcalidrawApiClient({ apiKey: "secret", timeoutMs: 0 }),
    /timeoutMs must be a positive integer/,
  );
  assert.throws(
    () => new ExcalidrawApiClient({ apiKey: "secret", maxPages: 1.5 }),
    /maxPages must be a positive integer/,
  );
});

test("the API base URL must be a transport that can protect the credential", () => {
  // The client sends the API key as a bearer token to whatever baseUrl says,
  // and baseUrl can come from EXCALIDRAW_API_URL. An unvalidated value sends
  // the credential to an arbitrary host, in cleartext.
  for (const baseUrl of [
    "http://attacker.example.com",
    "file:///etc",
    "javascript:alert(1)",
    "not-a-url",
    "ftp://example.com",
  ]) {
    assert.throws(
      () => new ExcalidrawApiClient({ apiKey: "secret", baseUrl, fetch: async () => new Response("{}") }),
      /base URL/,
      `expected ${baseUrl} to be rejected`,
    );
  }

  // https anywhere, and plain http only for loopback development.
  for (const baseUrl of [
    "https://api.excalidraw.com/api/v1",
    "http://localhost:3000",
    "http://127.0.0.1:8080/api",
  ]) {
    assert.ok(new ExcalidrawApiClient({ apiKey: "secret", baseUrl, fetch: async () => new Response("{}") }));
  }
});
