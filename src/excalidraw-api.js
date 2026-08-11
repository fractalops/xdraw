import { nonceFor } from "./identity.js";
import { tone } from "./components.js";

const DEFAULT_BASE_URL = "https://api.excalidraw.com/api/v1";

function records(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.data)) return value.data;
  return undefined;
}

function metadata(value) {
  return value?.metadata ?? value;
}

function recordId(value) {
  const item = metadata(value);
  return item?.id ?? item?.sceneId ?? item?.collectionId;
}

function recordName(value) {
  const item = metadata(value);
  return item?.name ?? item?.title;
}

function selectNamed(items, selector, kind) {
  const byId = items.filter((item) => recordId(item) === selector);
  if (byId.length === 1) return byId[0];
  const normalize = (value) => value.toLocaleLowerCase().replace(/[\s_.:/\\-]+/g, "");
  const normalized = normalize(selector);
  const byName = items.filter((item) => recordName(item) && normalize(recordName(item)) === normalized);
  if (byName.length > 1) throw new Error(`${kind} selector '${selector}' is ambiguous`);
  return byName[0];
}

function sceneId(value) {
  const id = recordId(value);
  if (!id) throw new Error("Excalidraw API response did not contain a scene ID");
  return id;
}

function taggedDrawing(drawing) {
  const result = structuredClone(drawing);
  result.elements = (result.elements ?? []).map((element) => ({
    ...element,
    customData: { ...(element.customData ?? {}), xdrawId: element.id },
  }));
  return result;
}

function semanticElement(content, target) {
  const matches = content.elements.filter((element) => (
    !element.isDeleted && (element.id === target || element.customData?.xdrawId === target)
  ));
  if (!matches.length) throw new Error(`scene does not contain XDraw element '${target}'`);
  if (matches.length > 1) throw new Error(`XDraw element selector '${target}' is ambiguous`);
  return matches[0];
}

function revised(element, changes) {
  return {
    ...structuredClone(element),
    ...changes,
    version: (element.version ?? 0) + 1,
    versionNonce: nonceFor(`${element.id}:${(element.version ?? 0) + 1}`),
    updated: Date.now(),
  };
}

function labelElement(content, element) {
  const ids = new Set([
    ...(element.boundElements ?? []).filter((item) => item.type === "text").map((item) => item.id),
    element.customData?.xdrawLabelId,
  ].filter(Boolean));
  return content.elements.find((item) => !item.isDeleted && ids.has(item.id));
}

function semanticUpdates(content, element, properties) {
  const changes = {};
  const labelChanges = {};
  for (const [name, value] of Object.entries(properties)) {
    if (name === "tone") {
      const colors = tone(value);
      if (element.type === "text") changes.strokeColor = colors.text;
      else {
        changes.strokeColor = colors.stroke;
        changes.backgroundColor = colors.background;
        labelChanges.strokeColor = colors.text;
      }
    } else if (name === "title") {
      if (typeof value !== "string") throw new Error("title must be a quoted string");
      if (element.type === "text") {
        changes.text = value;
        changes.originalText = value;
      } else {
        labelChanges.text = value;
        labelChanges.originalText = value;
      }
    } else if (["x", "y", "width", "height", "stroke-width", "opacity", "angle"].includes(name)) {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a number`);
      if (["width", "height", "stroke-width"].includes(name) && value <= 0) throw new Error(`${name} must be positive`);
      if (name === "opacity" && (value < 0 || value > 100)) throw new Error("opacity must be between 0 and 100");
      if (name === "stroke-width") changes.strokeWidth = value;
      else if (name === "angle") changes.angle = value * Math.PI / 180;
      else changes[name] = value;
    } else if (name === "stroke") changes.strokeColor = value;
    else if (name === "background") changes.backgroundColor = value;
    else if (name === "text") {
      if (element.type === "text") changes.strokeColor = value;
      else labelChanges.strokeColor = value;
    }
  }
  const updates = Object.keys(changes).length ? [revised(element, changes)] : [];
  if (Object.keys(labelChanges).length) {
    const label = labelElement(content, element);
    if (!label) throw new Error(`XDraw element '${element.customData?.xdrawId ?? element.id}' has no editable label`);
    updates.push(revised(label, labelChanges));
  }
  return updates;
}

function deletionElements(content, element) {
  const result = [revised(element, { isDeleted: true })];
  const label = labelElement(content, element);
  if (label) result.push(revised(label, { isDeleted: true }));
  return result;
}

export class ExcalidrawApiClient {
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, fetch: fetch_ = globalThis.fetch } = {}) {
    if (!apiKey) throw new Error("EXCALIDRAW_API_KEY is required for remote commands");
    if (typeof fetch_ !== "function") throw new Error("a Fetch API implementation is required");
    this.apiKey = apiKey.replace(/^Bearer\s+/i, "");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetch_;
  }

  static connect({
    apiKey = process.env.EXCALIDRAW_API_KEY,
    baseUrl = process.env.EXCALIDRAW_API_URL ?? DEFAULT_BASE_URL,
    fetch,
  } = {}) {
    return new ExcalidrawApiClient({ apiKey, baseUrl, fetch });
  }

  async close() {}

  async request(method, path, body) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : undefined; }
    catch { payload = text; }
    if (!response.ok) {
      const message = payload?.message ?? payload?.error ?? text ?? response.statusText;
      throw new Error(`Excalidraw API ${method} ${path} failed (${response.status}): ${message}`);
    }
    return payload;
  }

  async listAll(path) {
    const result = [];
    let offset = 0;
    while (true) {
      const separator = path.includes("?") ? "&" : "?";
      const page = await this.request("GET", `${path}${separator}limit=100&offset=${offset}`);
      const items = records(page);
      if (!items) throw new Error(`Excalidraw API ${path} did not return a list`);
      result.push(...items);
      if (page.hasNextPage === false || items.length < 100) return result;
      if (!items.length) return result;
      offset += items.length;
    }
  }

  async createScene({ name, collectionId, pinned = false }) {
    return sceneId(await this.request("POST", "/scenes", { name, pinned, collectionId }));
  }

  async getSceneContent(id) {
    const content = await this.request("GET", `/scenes/${encodeURIComponent(id)}/content`);
    if (!content || !Array.isArray(content.elements)) {
      throw new Error("Excalidraw API did not return valid scene content");
    }
    return content;
  }

  async resolveSceneResource(resource, { allowCreate = false } = {}) {
    if (resource.provider !== "excalidraw") throw new Error(`unsupported scene provider '${resource.provider}'`);
    if (resource.workspace !== "default") {
      throw new Error("the API key selects the workspace; use 'default' as the workspace segment");
    }
    const collections = await this.listAll("/collections");
    let collection;
    if (resource.collection === "default") {
      collection = collections.find((item) => metadata(item)?.isDefault) ?? (collections.length === 1 ? collections[0] : undefined);
    } else if (resource.collection === "private") collection = { id: "private", name: "private" };
    else collection = selectNamed(collections, resource.collection, "collection");
    if (!collection) throw new Error(`Excalidraw+ collection '${resource.collection}' was not found`);
    const collectionId = recordId(collection);
    const scenes = await this.listAll(`/collections/${encodeURIComponent(collectionId)}/scenes`);
    const scene = selectNamed(scenes, resource.scene, "scene");
    if (scene) return { sceneId: recordId(scene), collectionId, created: false };
    if (!allowCreate) throw new Error(`Excalidraw+ scene '${resource.scene}' was not found in collection '${resource.collection}'`);
    const name = resource.scene.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toLocaleUpperCase());
    return { sceneId: await this.createScene({ name, collectionId }), collectionId, created: true };
  }

  async applyReplace(resource, drawing) {
    const target = await this.resolveSceneResource(resource, { allowCreate: true });
    const content = taggedDrawing(drawing);
    await this.request("PUT", `/scenes/${encodeURIComponent(target.sceneId)}/content`, content);
    return { sceneId: target.sceneId, added: content.elements.length, created: target.created };
  }

  async applyPatch(resource, { updates = [], deletes = [], drawing } = {}) {
    const { sceneId: id } = await this.resolveSceneResource(resource);
    const content = await this.getSceneContent(id);
    const changed = updates.flatMap(({ target, properties }) => (
      semanticUpdates(content, semanticElement(content, target), properties)
    ));
    const removed = deletes.flatMap((target) => deletionElements(content, semanticElement(content, target)));
    const additions = drawing ? taggedDrawing(drawing) : undefined;
    const existingIds = new Set(content.elements.map((item) => item.id));
    const collision = additions?.elements.find((item) => existingIds.has(item.id));
    if (collision) throw new Error(`added XDraw element '${collision.id}' already exists in the scene`);
    const body = {
      elements: [...changed, ...removed, ...(additions?.elements ?? [])],
      ...(additions && Object.keys(additions.files ?? {}).length ? { files: additions.files } : {}),
    };
    await this.request("PATCH", `/scenes/${encodeURIComponent(id)}/content`, body);
    return {
      sceneId: id,
      added: additions?.elements.length ?? 0,
      updated: updates.length,
      deleted: deletes.length,
    };
  }

  async pull(id) {
    return this.getSceneContent(id);
  }
}

export { DEFAULT_BASE_URL as EXCALIDRAW_API_URL };
