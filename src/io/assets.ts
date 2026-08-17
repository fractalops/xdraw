import { expandDocument } from "../language/expander.ts";
import { SaxesParser } from "saxes";

import type {
  AssetDeclaration,
  AssetUseStatement,
  DiagramDocument,
  SemanticStatement,
} from "../contracts/semantic.ts";
import type {
  AssetLimits,
  AssetMimeType,
  EmbeddedAssetFiles,
  FileSystem,
  Point,
  ResolvedAsset,
} from "../contracts/foundation.ts";

const MIME_BY_EXTENSION: Readonly<Record<string, AssetMimeType>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const SUPPORTED_MIME = new Set<AssetMimeType>(Object.values(MIME_BY_EXTENSION));
export const DEFAULT_ASSET_LIMITS: Readonly<AssetLimits> = Object.freeze({
  fileBytes: 10 * 1024 * 1024,
  aggregateBytes: 25 * 1024 * 1024,
  dimension: 8192,
});

export function encodeAssetBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function decodeDataUrl(value: string, maxBytes = Number.POSITIVE_INFINITY): { mimeType: string; bytes: Uint8Array } {
  const match = value.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!match) throw new Error("malformed asset data URL");
  const mimeType = match[1].toLowerCase();
  if (!match[2]) {
    if (match[3].length > maxBytes * 3) throw new Error(`asset data exceeds the ${maxBytes}-byte file limit`);
    return { mimeType, bytes: new TextEncoder().encode(decodeURIComponent(match[3])) };
  }
  if (match[3].length > Math.ceil(maxBytes * 4 / 3) + 4) {
    throw new Error(`asset data exceeds the ${maxBytes}-byte file limit`);
  }
  const binary = atob(match[3]);
  return {
    mimeType,
    bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  };
}

function extensionOf(path: string): string {
  const name = path.split("/").at(-1) ?? "";
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

function joinRelative(sourceFile: string, source: string): string {
  const parts = sourceFile.replaceAll("\\", "/").split("/");
  parts.pop();
  for (const part of source.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function mimeFor(path: string, declared: unknown): string {
  return String(declared ?? MIME_BY_EXTENSION[extensionOf(path)] ?? "").toLowerCase();
}

function pngDimensions(bytes: Uint8Array): Point | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

function gifDimensions(bytes: Uint8Array): Point | null {
  if (bytes.length < 10 || !new TextDecoder().decode(bytes.subarray(0, 3)).startsWith("GIF")) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint16(6, true), view.getUint16(8, true)];
}

function jpegDimensions(bytes: Uint8Array): Point | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const length = view.getUint16(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return [view.getUint16(offset + 7), view.getUint16(offset + 5)];
    }
    offset += 2 + length;
  }
  return null;
}

export function inspectSvgDimensions(bytes: Uint8Array): Point | null {
  const source = new TextDecoder().decode(bytes);
  const svgNamespace = "http://www.w3.org/2000/svg";
  const xlinkNamespace = "http://www.w3.org/1999/xlink";
  const allowedElements = new Set([
    "circle", "clippath", "defs", "desc", "ellipse", "g", "line", "lineargradient",
    "marker", "mask", "path", "pattern", "polygon", "polyline", "radialgradient", "rect",
    "stop", "svg", "symbol", "text", "title", "tspan", "use",
  ]);
  const allowedAttributes = new Set([
    "aria-label", "aria-labelledby", "class", "clip-path", "clip-rule", "cx", "cy", "d",
    "dx", "dy", "fill", "fill-opacity", "fill-rule", "focusable", "font-family", "font-size",
    "font-style", "font-weight", "fx", "fy", "gradienttransform", "gradientunits", "height", "id",
    "marker-end", "marker-mid", "marker-start", "mask", "offset", "opacity", "pathlength", "points",
    "preserveaspectratio", "r", "refx", "refy", "role", "rx", "ry", "spreadmethod", "stop-color",
    "stop-opacity", "stroke", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap",
    "stroke-linejoin", "stroke-miterlimit", "stroke-opacity", "stroke-width", "text-anchor", "transform",
    // 'version' is inert enumerated metadata, but Illustrator and Sketch stamp
    // it on the root of everything they export, so refusing it turned away
    // published icon sets over a string that cannot carry a URL or a script.
    "version", "viewbox", "width", "x", "x1", "x2", "y", "y1", "y2",
  ]);
  let rootSeen = false;
  let rootDimensions: Point | null = null;
  const reject = (): void => {
    throw new Error("SVG assets may not contain executable or remote content");
  };
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", reject);
  parser.on("processinginstruction", reject);
  parser.on("error", (error) => {
    throw error;
  });
  parser.on("opentag", (tag) => {
    const localName = tag.local.toLowerCase();
    if (tag.uri !== svgNamespace || !allowedElements.has(localName)) reject();
    if (!rootSeen) {
      rootSeen = true;
      if (localName !== "svg") reject();
    }
    const values = new Map<string, string>();
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.uri === "http://www.w3.org/2000/xmlns/") continue;
      const name = attribute.local.toLowerCase();
      if (name.startsWith("on") || name === "style") reject();
      const isHref = name === "href" && (!attribute.uri || attribute.uri === xlinkNamespace);
      if (!isHref && (attribute.uri || !allowedAttributes.has(name))) reject();
      if (isHref && !attribute.value.startsWith("#")) reject();
      if (/url\s*\(\s*(?!#[^)]+\))/iu.test(attribute.value) || /@import/iu.test(attribute.value)) reject();
      values.set(name, attribute.value);
    }
    if (localName === "svg" && !rootDimensions) {
      const width = Number.parseFloat(values.get("width") ?? "");
      const height = Number.parseFloat(values.get("height") ?? "");
      if (Number.isFinite(width) && Number.isFinite(height)) rootDimensions = [width, height];
      else {
        const viewBox = (values.get("viewbox") ?? "").trim().split(/[ ,]+/u).map(Number);
        if (viewBox.length === 4 && viewBox.every(Number.isFinite)) rootDimensions = [viewBox[2], viewBox[3]];
      }
    }
  });
  try {
    parser.write(source).close();
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  return rootSeen ? rootDimensions : null;
}

function dimensions(bytes: Uint8Array, mimeType: AssetMimeType): Point | null {
  if (mimeType === "image/png") return pngDimensions(bytes);
  if (mimeType === "image/gif") return gifDimensions(bytes);
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
  return inspectSvgDimensions(bytes);
}

export function mergeEmbeddedAssetFiles(
  sources: readonly EmbeddedAssetFiles[],
  options: Partial<AssetLimits> = {},
): EmbeddedAssetFiles {
  const limits: AssetLimits = { ...DEFAULT_ASSET_LIMITS, ...options };
  const files: EmbeddedAssetFiles = {};
  let aggregateBytes = 0;
  for (const source of sources) {
    for (const [key, file] of Object.entries(source)) {
      if (file.id !== key) throw new Error(`asset file '${key}' has mismatched identity '${file.id}'`);
      const { mimeType, bytes } = decodeDataUrl(file.dataURL, limits.fileBytes);
      if (mimeType !== file.mimeType || !SUPPORTED_MIME.has(file.mimeType)) {
        throw new Error(`asset file '${key}' has inconsistent MIME metadata`);
      }
      if (bytes.length > limits.fileBytes) {
        throw new Error(`asset file '${key}' exceeds the ${limits.fileBytes}-byte file limit`);
      }
      const measured = dimensions(bytes, file.mimeType);
      if (!measured || !measured.every((value) => Number.isFinite(value) && value > 0)) {
        throw new Error(`asset file '${key}' has malformed or missing dimensions`);
      }
      if (measured.some((value) => value > limits.dimension)) {
        throw new Error(`asset file '${key}' exceeds the ${limits.dimension}-pixel dimension limit`);
      }
      const existing = files[key];
      if (existing) {
        if (existing.dataURL !== file.dataURL || existing.mimeType !== file.mimeType) {
          throw new Error(`asset file '${key}' has conflicting content`);
        }
        continue;
      }
      aggregateBytes += bytes.length;
      if (aggregateBytes > limits.aggregateBytes) {
        throw new Error(`assets exceed the ${limits.aggregateBytes}-byte document limit`);
      }
      files[key] = file;
    }
  }
  return files;
}

export async function digestAssetBytes(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function digestEmbeddedAssetFile(dataURL: string): Promise<string> {
  return digestAssetBytes(decodeDataUrl(dataURL).bytes);
}

function collect<T extends SemanticStatement>(
  statements: readonly SemanticStatement[],
  predicate: (statement: SemanticStatement) => statement is T,
  result: T[] = [],
): T[] {
  for (const statement of statements) {
    if (predicate(statement)) result.push(statement);
    if (statement.statements) collect(statement.statements, predicate, result);
  }
  return result;
}

function isAssetDeclaration(statement: SemanticStatement): statement is AssetDeclaration {
  return statement.type === "asset";
}

function isAssetUse(statement: SemanticStatement): statement is AssetUseStatement {
  return statement.type === "image" || statement.type === "icon";
}

export async function resolveAssets(
  document: DiagramDocument,
  filesystem: FileSystem,
  options: Partial<AssetLimits> = {},
): Promise<DiagramDocument> {
  document = expandDocument(document);
  const limits: AssetLimits = { ...DEFAULT_ASSET_LIMITS, ...options };
  const declarations = collect(document.statements, isAssetDeclaration);
  const uses = collect(document.statements, isAssetUse);
  const assets = new Map<string, ResolvedAsset>();
  const files: EmbeddedAssetFiles = {};
  let aggregateBytes = 0;

  for (const declaration of declarations) {
    if (assets.has(declaration.id)) throw new Error(`duplicate asset '${declaration.id}'`);
    let bytes: Uint8Array;
    let mimeType: string;
    if (declaration.source.startsWith("data:")) {
      ({ bytes, mimeType } = decodeDataUrl(declaration.source, limits.fileBytes));
    } else {
      if (/^(?:\/|[A-Za-z]:[\\/])/.test(declaration.source)) {
        throw new Error(`asset '${declaration.id}' path must be relative to the configured root`);
      }
      const sourceFile = declaration.sourceFile ?? ".";
      const path = joinRelative(sourceFile, declaration.source);
      bytes = await filesystem.readBinary(path);
      mimeType = mimeFor(path, declaration.attributes.mime);
    }
    if (!SUPPORTED_MIME.has(mimeType as AssetMimeType)) {
      throw new Error(`asset '${declaration.id}' has unsupported format '${mimeType || "unknown"}'`);
    }
    const supportedMimeType = mimeType as AssetMimeType;
    if (bytes.length > limits.fileBytes) {
      throw new Error(`asset '${declaration.id}' exceeds the ${limits.fileBytes}-byte file limit`);
    }
    const measured = dimensions(bytes, supportedMimeType);
    if (!measured || !measured.every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error(`asset '${declaration.id}' has malformed or missing dimensions`);
    }
    if (measured.some((value) => value > limits.dimension)) {
      throw new Error(`asset '${declaration.id}' exceeds the ${limits.dimension}-pixel dimension limit`);
    }
    const fileId = (await digestAssetBytes(bytes)).slice(0, 40);
    const dataURL = `data:${supportedMimeType};base64,${encodeAssetBase64(bytes)}`;
    const resolved: ResolvedAsset = {
      fileId,
      mimeType: supportedMimeType,
      width: measured[0],
      height: measured[1],
      bytes: bytes.length,
    };
    assets.set(declaration.id, resolved);
    if (!files[fileId]) {
      aggregateBytes += bytes.length;
      if (aggregateBytes > limits.aggregateBytes) {
        throw new Error(`assets exceed the ${limits.aggregateBytes}-byte document limit`);
      }
      files[fileId] = {
        id: fileId,
        dataURL,
        mimeType: supportedMimeType,
        created: 1,
        lastRetrieved: 1,
      };
    }
  }
  for (const use of uses) {
    const resolved = assets.get(use.asset);
    if (!resolved) throw new Error(`${use.type} '${use.id}' references unknown asset '${use.asset}'`);
    use.resolvedAsset = resolved;
  }
  Object.defineProperty(document, "assetFiles", {
    value: files,
    enumerable: false,
    configurable: true,
  });
  return document;
}
