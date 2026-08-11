import assert from "node:assert/strict";
import test from "node:test";

import { ExcalidrawApiClient } from "../src/excalidraw-api.js";

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

function drawing(elements = [{ id: "api", type: "rectangle", version: 1 }]) {
  return { type: "excalidraw", version: 2, elements, appState: {}, files: {} };
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

test("pull returns editable scene content without mutation", async () => {
  const content = drawing([{ id: "one", type: "rectangle" }]);
  const remote = fakeFetch([{ method: "GET", path: "/api/v1/scenes/scene-1/content", payload: content }]);
  const client = new ExcalidrawApiClient({ apiKey: "secret", fetch: remote.fetch });
  assert.deepEqual(await client.pull("scene-1"), content);
  assert.equal(remote.calls.length, 1);
});
