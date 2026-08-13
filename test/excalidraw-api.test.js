import assert from "node:assert/strict";
import test from "node:test";

import { ExcalidrawApiClient } from "../src/excalidraw-api.ts";

function reply(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async text() { return payload === undefined ? "" : JSON.stringify(payload); },
  };
}

function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    const parsed = new URL(url);
    const call = {
      method: init.method,
      path: `${parsed.pathname}${parsed.search}`,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
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

function resource(scene = "system_overview") {
  return { provider: "excalidraw", workspace: "default", collection: "architecture", scene };
}

function sceneElement(overrides) {
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
  return { ...base, ...byType, ...overrides };
}

function drawing(elements = [{ id: "api", type: "rectangle", version: 1 }]) {
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

function inventoryRoutes(scenePayload = []) {
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
  assert.equal(remote.calls[0].headers.Authorization, "Bearer secret");
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
  assert.deepEqual(remote.calls.at(-2).body, {
    name: "System Overview", pinned: false, collectionId: "collection-1",
  });
  assert.equal(remote.calls.at(-1).method, "PUT");
  assert.equal(remote.calls.at(-1).body.elements[0].customData.xdrawId, "api");
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

  const indices = remote.calls.at(-1).body.elements.map((element) => element.index);
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
  const [shape, label] = remote.calls.at(-1).body.elements;
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
  assert.deepEqual(remote.calls.at(-1).body.elements.map((item) => item.id), ["label"]);
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
  assert.deepEqual(remote.calls.at(-1).body.elements.map(({ id, isDeleted }) => ({ id, isDeleted })), [
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

  const additions = remote.calls.at(-1).body.elements;
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
  assert.equal(remote.calls.at(-1).path, "/api/v1/scenes/scene-1/content");
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

test("requests stop when the configured timeout expires", async () => {
  const fetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
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
