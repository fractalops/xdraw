import { generateNKeysBetween } from "fractional-indexing";

import { digestEmbeddedAssetFile, mergeEmbeddedAssetFiles } from "./assets.ts";
import { tone } from "./components.ts";
import type { ToneName } from "./components.ts";
import { nonceFor } from "./identity.ts";
import type { EmbeddedAssetFiles, Point } from "./foundation-contracts.ts";
import type { DrawingAppState, DrawingElement, DrawingJson } from "./render-contracts.ts";

const DEFAULT_BASE_URL = "https://api.excalidraw.com/api/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PAGES = 100;

export type ExcalidrawApiMethod = "GET" | "POST" | "PUT" | "PATCH";
export type ExcalidrawFetch = typeof globalThis.fetch;

export interface ExcalidrawApiClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: ExcalidrawFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxPages?: number;
}

export interface ExcalidrawPagination<T> {
  data: T[];
  hasNextPage?: boolean;
}

export interface ExcalidrawResourceMetadata {
  id?: string;
  sceneId?: string;
  collectionId?: string;
  name?: string;
  title?: string;
  isDefault?: boolean;
}

export interface ExcalidrawResourceRecord extends ExcalidrawResourceMetadata {
  metadata?: ExcalidrawResourceMetadata;
}

export interface SceneResource {
  provider: string;
  workspace: string;
  collection: string;
  scene: string;
}

export interface ExcalidrawSceneResource extends SceneResource {
  provider: "excalidraw";
  workspace: "default";
}

export type SceneElementResource = DrawingElement & {
  index?: string;
};

export type SceneDrawingInput = DrawingJson;

export interface SceneContentResource extends Omit<DrawingJson, "elements"> {
  elements: SceneElementResource[];
}

export interface CreateSceneRequest {
  name: string;
  collectionId: string;
  pinned?: boolean;
}

export interface ResolveSceneOptions {
  allowCreate?: boolean;
}

export interface ResolvedSceneResource {
  sceneId: string;
  collectionId: string;
  created: boolean;
}

export interface HostedSceneSummary {
  address: string;
  sceneId: string;
  sceneName: string;
  collectionId: string;
  collectionName: string;
}

export interface SceneUpdateProperties {
  tone?: ToneName;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  "stroke-width"?: number;
  opacity?: number;
  angle?: number;
  stroke?: string;
  background?: string;
  text?: string;
}

export interface SceneUpdate {
  target: string;
  properties: SceneUpdateProperties;
}

export interface ScenePatchRequest {
  updates?: readonly SceneUpdate[];
  deletes?: readonly string[];
  drawing?: SceneDrawingInput;
}

export interface ReplaceSceneResponse {
  sceneId: string;
  added: number;
  created: boolean;
}

export interface PatchSceneResponse {
  sceneId: string;
  added: number;
  updated: number;
  deleted: number;
}

interface TaggedSceneDrawing extends Omit<DrawingJson, "elements"> {
  elements: SceneElementResource[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOptionalString(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "string";
}

function resourceMetadata(value: unknown): ExcalidrawResourceMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const item = value.metadata === undefined ? value : value.metadata;
  if (!isRecord(item)) return undefined;
  if (!["id", "sceneId", "collectionId", "name", "title"].every((key) => hasOptionalString(item, key))) {
    return undefined;
  }
  if (item.isDefault !== undefined && typeof item.isDefault !== "boolean") return undefined;
  return item;
}

function isResourceRecord(value: unknown): value is ExcalidrawResourceRecord {
  return resourceMetadata(value) !== undefined;
}

function pagination(value: unknown, path: string): ExcalidrawPagination<ExcalidrawResourceRecord> {
  const data = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.data)
      ? value.data
      : undefined;
  if (!data) throw new Error(`Excalidraw API ${path} did not return a list`);
  if (isRecord(value) && value.hasNextPage !== undefined && typeof value.hasNextPage !== "boolean") {
    throw new Error(`Excalidraw API ${path} returned an invalid pagination marker`);
  }
  if (!data.every(isResourceRecord)) {
    throw new Error(`Excalidraw API ${path} returned an invalid resource record`);
  }
  return {
    data,
    ...(isRecord(value) && typeof value.hasNextPage === "boolean"
      ? { hasNextPage: value.hasNextPage }
      : {}),
  };
}

function recordId(value: ExcalidrawResourceRecord): string | undefined {
  const item = resourceMetadata(value);
  return item?.id ?? item?.sceneId ?? item?.collectionId;
}

function recordName(value: ExcalidrawResourceRecord): string | undefined {
  const item = resourceMetadata(value);
  return item?.name ?? item?.title;
}

function normalizedSelector(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s_.:/\\-]+/g, "");
}

function copyableSelector(
  item: ExcalidrawResourceRecord,
  siblings: readonly ExcalidrawResourceRecord[],
): string {
  const name = recordName(item);
  if (name && !name.includes("::") && siblings.filter((sibling) => {
    const siblingName = recordName(sibling);
    return siblingName !== undefined && normalizedSelector(siblingName) === normalizedSelector(name);
  }).length === 1) return name;
  const id = recordId(item);
  if (!id) throw new Error("Excalidraw API response did not contain a resource ID");
  return id;
}

function selectNamed(
  items: readonly ExcalidrawResourceRecord[],
  selector: string,
  kind: string,
): ExcalidrawResourceRecord | undefined {
  const byId = items.filter((item) => recordId(item) === selector);
  if (byId.length === 1) return byId[0];
  const normalized = normalizedSelector(selector);
  const byName = items.filter((item) => {
    const name = recordName(item);
    return name !== undefined && normalizedSelector(name) === normalized;
  });
  if (byName.length > 1) throw new Error(`${kind} selector '${selector}' is ambiguous`);
  return byName[0];
}

function sceneId(value: ExcalidrawResourceRecord): string {
  const id = recordId(value);
  if (!id) throw new Error("Excalidraw API response did not contain a scene ID");
  return id;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber);
}

function isBoundElement(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.type === "arrow" || value.type === "line" || value.type === "text");
}

function isBinding(value: unknown): boolean {
  if (!isRecord(value) || typeof value.elementId !== "string") return false;
  if (value.focus !== undefined && !isFiniteNumber(value.focus)) return false;
  if (value.gap !== undefined && !isFiniteNumber(value.gap)) return false;
  return value.fixedPoint === undefined || value.fixedPoint === null || isPoint(value.fixedPoint);
}

function isRoundness(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value) || ![1, 2, 3].includes(value.type as number)) return false;
  return value.value === undefined || isFiniteNumber(value.value);
}

function isBaseElement(value: Record<string, unknown>): boolean {
  const numeric = [
    "x", "y", "width", "height", "angle", "strokeWidth", "roughness", "opacity",
    "seed", "version", "versionNonce", "updated",
  ];
  if (!numeric.every((key) => isFiniteNumber(value[key]))) return false;
  if (!["id", "type", "strokeColor", "backgroundColor", "fillStyle", "strokeStyle"].every(
    (key) => typeof value[key] === "string",
  )) return false;
  if (!Array.isArray(value.groupIds) || !value.groupIds.every((item) => typeof item === "string")) return false;
  if (typeof value.isDeleted !== "boolean" || typeof value.locked !== "boolean") return false;
  if (value.frameId !== null && typeof value.frameId !== "string") return false;
  if (value.link !== null && typeof value.link !== "string") return false;
  if (!isRoundness(value.roundness)) return false;
  if (value.customData !== undefined && !isRecord(value.customData)) return false;
  if (value.boundElements !== null) {
    if (!Array.isArray(value.boundElements) || !value.boundElements.every(isBoundElement)) return false;
  }
  return value.index === undefined || typeof value.index === "string";
}

function isLinearElement(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.points) || !value.points.every(isPoint)) return false;
  if (value.lastCommittedPoint !== null && !isPoint(value.lastCommittedPoint)) return false;
  for (const key of ["startBinding", "endBinding"]) {
    if (value[key] !== null && !isBinding(value[key])) return false;
  }
  for (const key of ["startArrowhead", "endArrowhead"]) {
    if (value[key] !== null && typeof value[key] !== "string") return false;
  }
  return true;
}

function isSceneElement(value: unknown): value is SceneElementResource {
  if (!isRecord(value) || !isBaseElement(value)) return false;
  switch (value.type) {
    case "rectangle":
    case "diamond":
    case "ellipse":
      return true;
    case "frame":
      return value.name === null || typeof value.name === "string";
    case "image": {
      const crop = value.crop;
      return typeof value.fileId === "string"
        && value.status === "saved"
        && isPoint(value.scale)
        && (crop === null || (
          isRecord(crop)
          && ["x", "y", "width", "height", "naturalWidth", "naturalHeight"].every(
            (key) => isFiniteNumber(crop[key]),
          )
        ));
    }
    case "text":
      return isFiniteNumber(value.fontSize)
        && isFiniteNumber(value.fontFamily)
        && typeof value.text === "string"
        && ["left", "center", "right"].includes(String(value.textAlign))
        && ["top", "middle", "bottom"].includes(String(value.verticalAlign))
        && (value.containerId === null || typeof value.containerId === "string")
        && typeof value.originalText === "string"
        && isFiniteNumber(value.lineHeight)
        && typeof value.autoResize === "boolean";
    case "arrow":
      return isLinearElement(value) && typeof value.elbowed === "boolean";
    case "line":
      return isLinearElement(value);
    case "freedraw":
      return Array.isArray(value.points)
        && value.points.every(isPoint)
        && Array.isArray(value.pressures)
        && value.pressures.every(isFiniteNumber)
        && typeof value.simulatePressure === "boolean"
        && (value.lastCommittedPoint === null || isPoint(value.lastCommittedPoint));
    default:
      return false;
  }
}

function isAppState(value: unknown): value is DrawingAppState {
  if (!isRecord(value)) return false;
  return isFiniteNumber(value.gridSize)
    && isFiniteNumber(value.gridStep)
    && typeof value.gridModeEnabled === "boolean"
    && typeof value.viewBackgroundColor === "string";
}

function isEmbeddedFiles(value: unknown): value is EmbeddedAssetFiles {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([fileId, file]) => (
    isRecord(file)
    && file.id === fileId
    && typeof file.dataURL === "string"
    && ["image/gif", "image/jpeg", "image/png", "image/svg+xml"].includes(String(file.mimeType))
    && isFiniteNumber(file.created)
    && isFiniteNumber(file.lastRetrieved)
  ));
}

async function sceneContent(value: unknown): Promise<SceneContentResource> {
  if (
    !isRecord(value)
    || value.type !== "excalidraw"
    || value.version !== 2
    || value.source !== "https://excalidraw.com"
    || !Array.isArray(value.elements)
    || !value.elements.every(isSceneElement)
    || !isAppState(value.appState)
    || !isEmbeddedFiles(value.files)
  ) {
    throw new Error("Excalidraw API did not return valid scene content");
  }
  const files = mergeEmbeddedAssetFiles([value.files]);
  for (const element of value.elements) {
    if (element.type === "image" && (typeof element.fileId !== "string" || !files[element.fileId])) {
      throw new Error(`Excalidraw API returned image '${element.id}' without its embedded file`);
    }
    if (!isRecord(element) || !isRecord(element.customData) || !isRecord(element.customData.xdraw)) continue;
    const metadata = element.customData.xdraw;
    if (metadata.type !== "formula") continue;
    if (element.type !== "image" || typeof element.fileId !== "string") {
      throw new Error("Excalidraw API returned formula metadata on a non-image element");
    }
    const file = files[element.fileId];
    if (!file || typeof metadata.digest !== "string") {
      throw new Error("Excalidraw API returned incomplete formula asset metadata");
    }
    const digest = await digestEmbeddedAssetFile(file.dataURL);
    if (digest !== metadata.digest || element.fileId !== digest.slice(0, 40)) {
      throw new Error("Excalidraw API returned a formula asset with invalid integrity metadata");
    }
  }
  return {
    type: value.type,
    version: value.version,
    source: value.source,
    elements: value.elements,
    appState: value.appState,
    files,
  };
}

function sceneElement(value: DrawingElement): SceneElementResource {
  if (!isSceneElement(value)) throw new Error("scene drawing contains an invalid element");
  return value;
}

function taggedDrawing(
  drawing: SceneDrawingInput,
  { afterIndex = null }: { afterIndex?: string | null } = {},
): TaggedSceneDrawing {
  if (!isRecord(drawing) || !Array.isArray(drawing.elements)) {
    throw new Error("scene drawing must contain an elements array");
  }
  const result = structuredClone(drawing);
  const elements = result.elements.map(sceneElement);
  const indices = generateNKeysBetween(afterIndex, null, elements.length);
  return {
    ...result,
    elements: elements.map((element, position) => ({
      ...element,
      index: indices[position],
      customData: { ...(element.customData ?? {}), xdrawId: element.id },
    })),
  };
}

function lastOrderingKey(elements: readonly SceneElementResource[]): string | null {
  const indices = elements
    .map((element) => element.index)
    .filter((index): index is string => typeof index === "string" && index.length > 0);
  return indices.length ? indices.sort().at(-1) ?? null : null;
}

function semanticElement(content: SceneContentResource, target: string): SceneElementResource {
  const matches = content.elements.filter((element) => (
    !element.isDeleted && (element.id === target || element.customData?.xdrawId === target)
  ));
  if (!matches.length) throw new Error(`scene does not contain XDraw element '${target}'`);
  if (matches.length > 1) throw new Error(`XDraw element selector '${target}' is ambiguous`);
  return matches[0];
}

function elementVersion(element: SceneElementResource): number {
  return element.version ?? 0;
}

function revised(element: SceneElementResource, changes: Record<string, unknown>): SceneElementResource {
  const version = elementVersion(element) + 1;
  return {
    ...structuredClone(element),
    ...changes,
    version,
    versionNonce: nonceFor(`${element.id}:${version}`),
    updated: Date.now(),
  };
}

function labelElement(
  content: SceneContentResource,
  element: SceneElementResource,
): SceneElementResource | undefined {
  const ids = new Set<string>();
  for (const item of element.boundElements ?? []) {
    if (item.type === "text") ids.add(item.id);
  }
  if (element.customData?.xdrawLabelId) ids.add(element.customData.xdrawLabelId);
  return content.elements.find((item) => !item.isDeleted && ids.has(item.id));
}

function toneName(value: unknown): ToneName {
  if (
    value === "neutral"
    || value === "success"
    || value === "danger"
    || value === "warning"
    || value === "info"
    || value === "accent"
  ) return value;
  throw new Error(`unknown tone: ${String(value)}`);
}

function semanticUpdates(
  content: SceneContentResource,
  element: SceneElementResource,
  properties: SceneUpdateProperties,
): SceneElementResource[] {
  const changes: Record<string, unknown> = {};
  const labelChanges: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(properties)) {
    if (name === "tone") {
      const colors = tone(toneName(value));
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

function deletionElements(
  content: SceneContentResource,
  element: SceneElementResource,
): SceneElementResource[] {
  const result = [revised(element, { isDeleted: true })];
  const label = labelElement(content, element);
  if (label) result.push(revised(label, { isDeleted: true }));
  return result;
}

function errorMessage(payload: unknown, text: string, statusText: string): string {
  if (isRecord(payload)) {
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.error === "string") return payload.error;
  }
  return text || statusText;
}

function assertSceneResource(resource: SceneResource): void {
  for (const key of ["provider", "workspace", "collection", "scene"] as const) {
    if (typeof resource[key] !== "string" || resource[key].length === 0) {
      throw new Error(`scene resource ${key} must be a non-empty string`);
    }
  }
}

function assertPatchTargets(updates: readonly SceneUpdate[], deletes: readonly string[]): void {
  const updateTargets = updates.map(({ target }) => target);
  const duplicateUpdate = updateTargets.find((target, position) => updateTargets.indexOf(target) !== position);
  if (duplicateUpdate) throw new Error(`duplicate update target '${duplicateUpdate}'`);
  const duplicateDelete = deletes.find((target, position) => deletes.indexOf(target) !== position);
  if (duplicateDelete) throw new Error(`duplicate delete target '${duplicateDelete}'`);
  const conflict = updateTargets.find((target) => deletes.includes(target));
  if (conflict) throw new Error(`patch cannot update and delete '${conflict}'`);
}

export class ExcalidrawApiClient {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: ExcalidrawFetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly maxPages: number;

  constructor({
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    fetch: fetch_ = globalThis.fetch,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxPages = DEFAULT_MAX_PAGES,
  }: ExcalidrawApiClientOptions = {}) {
    if (!apiKey) throw new Error("EXCALIDRAW_API_KEY is required for remote commands");
    if (typeof fetch_ !== "function") throw new Error("a Fetch API implementation is required");
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive integer");
    if (!Number.isInteger(maxPages) || maxPages <= 0) throw new Error("maxPages must be a positive integer");
    this.apiKey = apiKey.replace(/^Bearer\s+/i, "");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetch_;
    this.signal = signal;
    this.timeoutMs = timeoutMs;
    this.maxPages = maxPages;
  }

  static connect({
    apiKey = process.env.EXCALIDRAW_API_KEY,
    baseUrl = process.env.EXCALIDRAW_API_URL ?? DEFAULT_BASE_URL,
    fetch,
    signal,
    timeoutMs,
    maxPages,
  }: ExcalidrawApiClientOptions = {}): ExcalidrawApiClient {
    return new ExcalidrawApiClient({ apiKey, baseUrl, fetch, signal, timeoutMs, maxPages });
  }

  async close(): Promise<void> {}

  async request(method: ExcalidrawApiMethod, path: string, body?: unknown): Promise<unknown> {
    const timeout = new AbortController();
    const timer = setTimeout(
      () => timeout.abort(new DOMException("The request timed out", "TimeoutError")),
      this.timeoutMs,
    );
    const signal = this.signal ? AbortSignal.any([this.signal, timeout.signal]) : timeout.signal;
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let payload: unknown;
      try { payload = text ? JSON.parse(text) : undefined; }
      catch { payload = text; }
      if (!response.ok) {
        throw new Error(
          `Excalidraw API ${method} ${path} failed (${response.status}): ${errorMessage(payload, text, response.statusText)}`,
        );
      }
      return payload;
    } catch (error) {
      if (timeout.signal.aborted && !this.signal?.aborted) {
        throw new Error(`Excalidraw API ${method} ${path} timed out after ${this.timeoutMs}ms`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async listAll(path: string): Promise<ExcalidrawResourceRecord[]> {
    const result: ExcalidrawResourceRecord[] = [];
    let offset = 0;
    for (let pageNumber = 0; pageNumber < this.maxPages; pageNumber += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const page = pagination(
        await this.request("GET", `${path}${separator}limit=100&offset=${offset}`),
        path,
      );
      result.push(...page.data);
      if (page.hasNextPage === false || page.data.length < 100) return result;
      if (!page.data.length) return result;
      offset += page.data.length;
    }
    throw new Error(`Excalidraw API ${path} exceeded the ${this.maxPages}-page inventory limit`);
  }

  async createScene({ name, collectionId, pinned = false }: CreateSceneRequest): Promise<string> {
    return sceneId(awaitResourceRecord(
      await this.request("POST", "/scenes", { name, pinned, collectionId }),
      "scene creation",
    ));
  }

  async getSceneContent(id: string): Promise<SceneContentResource> {
    return sceneContent(await this.request("GET", `/scenes/${encodeURIComponent(id)}/content`));
  }

  async resolveSceneResource(
    resource: SceneResource,
    { allowCreate = false }: ResolveSceneOptions = {},
  ): Promise<ResolvedSceneResource> {
    assertSceneResource(resource);
    if (resource.provider !== "excalidraw") throw new Error(`unsupported scene provider '${resource.provider}'`);
    if (resource.workspace !== "default") {
      throw new Error("the API key selects the workspace; use 'default' as the workspace segment");
    }
    const collections = await this.listAll("/collections");
    let collection: ExcalidrawResourceRecord | undefined;
    if (resource.collection === "default") {
      collection = collections.find((item) => resourceMetadata(item)?.isDefault)
        ?? (collections.length === 1 ? collections[0] : undefined);
    } else if (resource.collection === "private") collection = { id: "private", name: "private" };
    else collection = selectNamed(collections, resource.collection, "collection");
    if (!collection) throw new Error(`Excalidraw+ collection '${resource.collection}' was not found`);
    const collectionId = recordId(collection);
    if (!collectionId) throw new Error("Excalidraw API response did not contain a collection ID");
    const scenes = await this.listAll(`/collections/${encodeURIComponent(collectionId)}/scenes`);
    const scene = selectNamed(scenes, resource.scene, "scene");
    if (scene) return { sceneId: sceneId(scene), collectionId, created: false };
    if (!allowCreate) throw new Error(`Excalidraw+ scene '${resource.scene}' was not found in collection '${resource.collection}'`);
    const name = resource.scene.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toLocaleUpperCase());
    return { sceneId: await this.createScene({ name, collectionId }), collectionId, created: true };
  }

  async listScenes(collectionSelector?: string): Promise<HostedSceneSummary[]> {
    const collections = await this.listAll("/collections");
    const selected = collectionSelector === undefined
      ? collections
      : [selectNamed(collections, collectionSelector, "collection")].filter(
        (item): item is ExcalidrawResourceRecord => item !== undefined,
      );
    if (collectionSelector !== undefined && selected.length === 0) {
      throw new Error(`Excalidraw+ collection '${collectionSelector}' was not found`);
    }
    const scenes = await Promise.all(selected.map(async (collection) => {
      const collectionId = recordId(collection);
      if (!collectionId) throw new Error("Excalidraw API response did not contain a collection ID");
      const collectionName = recordName(collection) ?? collectionId;
      const collectionAddress = copyableSelector(collection, collections);
      const inventory = await this.listAll(`/collections/${encodeURIComponent(collectionId)}/scenes`);
      return inventory.map((scene) => {
        const id = sceneId(scene);
        const sceneName = recordName(scene) ?? id;
        return {
          address: ["excalidraw", "default", collectionAddress, copyableSelector(scene, inventory)].join("::"),
          sceneId: id,
          sceneName,
          collectionId,
          collectionName,
        };
      });
    }));
    return scenes.flat().sort((left, right) => (
      left.collectionName.localeCompare(right.collectionName)
      || left.sceneName.localeCompare(right.sceneName)
      || left.sceneId.localeCompare(right.sceneId)
    ));
  }

  async applyReplace(resource: SceneResource, drawing: SceneDrawingInput): Promise<ReplaceSceneResponse> {
    const target = await this.resolveSceneResource(resource, { allowCreate: true });
    const content = taggedDrawing(drawing);
    await this.request("PUT", `/scenes/${encodeURIComponent(target.sceneId)}/content`, content);
    return { sceneId: target.sceneId, added: content.elements.length, created: target.created };
  }

  async applyPatch(
    resource: SceneResource,
    { updates = [], deletes = [], drawing }: ScenePatchRequest = {},
  ): Promise<PatchSceneResponse> {
    assertPatchTargets(updates, deletes);
    const { sceneId: id } = await this.resolveSceneResource(resource);
    const content = await this.getSceneContent(id);
    const changed = updates.flatMap(({ target, properties }) => (
      semanticUpdates(content, semanticElement(content, target), properties)
    ));
    const removed = deletes.flatMap((target) => deletionElements(content, semanticElement(content, target)));
    const additions = drawing
      ? taggedDrawing(drawing, { afterIndex: lastOrderingKey(content.elements) })
      : undefined;
    const existingIds = new Set(content.elements.map((item) => item.id));
    const liveSelectors = new Set(content.elements.flatMap((item) => {
      if (item.isDeleted) return [];
      const semanticId = item.customData?.xdrawId;
      return typeof semanticId === "string" ? [item.id, semanticId] : [item.id];
    }));
    const collision = additions?.elements.find((item) => (
      existingIds.has(item.id)
      || liveSelectors.has(typeof item.customData?.xdrawId === "string" ? item.customData.xdrawId : item.id)
    ));
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

  async pull(target: string | SceneResource): Promise<SceneContentResource> {
    const id = typeof target === "string"
      ? target
      : (await this.resolveSceneResource(target)).sceneId;
    return this.getSceneContent(id);
  }
}

function awaitResourceRecord(value: unknown, operation: string): ExcalidrawResourceRecord {
  if (!isResourceRecord(value)) {
    throw new Error(`Excalidraw API ${operation} returned an invalid resource record`);
  }
  return value;
}

export { DEFAULT_BASE_URL as EXCALIDRAW_API_URL };
