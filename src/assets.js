import { expandDocument } from "./expander.js";

const MIME_BY_EXTENSION = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const SUPPORTED_MIME = new Set(Object.values(MIME_BY_EXTENSION));
const DEFAULT_LIMITS = { fileBytes: 10 * 1024 * 1024, aggregateBytes: 25 * 1024 * 1024, dimension: 8192 };

function base64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function decodeDataUrl(value) {
  const match = value.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!match) throw new Error("malformed asset data URL");
  const mimeType = match[1].toLowerCase();
  if (!match[2]) return { mimeType, bytes: new TextEncoder().encode(decodeURIComponent(match[3])) };
  const binary = atob(match[3]);
  return { mimeType, bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)) };
}

function extensionOf(path) {
  const name = path.split("/").at(-1);
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

function joinRelative(sourceFile, source) {
  const parts = sourceFile.replaceAll("\\", "/").split("/");
  parts.pop();
  for (const part of source.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function mimeFor(path, declared) {
  const extension = extensionOf(path);
  return String(declared ?? MIME_BY_EXTENSION[extension] ?? "").toLowerCase();
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

function gifDimensions(bytes) {
  if (bytes.length < 10 || !new TextDecoder().decode(bytes.subarray(0, 3)).startsWith("GIF")) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint16(6, true), view.getUint16(8, true)];
}

function jpegDimensions(bytes) {
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

function svgDimensions(bytes) {
  const source = new TextDecoder().decode(bytes);
  if (!/^\s*<svg\b/i.test(source)) return null;
  const activeMarkup = /<!DOCTYPE\b|<\?(?:xml-stylesheet)\b|<(?:script|foreignObject|iframe|object|embed|style)\b/i;
  const eventHandler = /\son[a-z][a-z0-9_-]*\s*=/i;
  const externalReference = /\b(?:href|xlink:href|src)\s*=\s*["'](?!#)[^"']*["']/i;
  const cssReference = /@import\b|url\s*\(/i;
  if ([activeMarkup, eventHandler, externalReference, cssReference].some((pattern) => pattern.test(source))) {
    throw new Error("SVG assets may not contain executable or remote content");
  }
  const width = source.match(/\bwidth=["']([0-9.]+)(?:px)?["']/i)?.[1];
  const height = source.match(/\bheight=["']([0-9.]+)(?:px)?["']/i)?.[1];
  if (width && height) return [Number(width), Number(height)];
  const viewBox = source.match(/\bviewBox=["'][^"']*?([0-9.]+)[ ,]+([0-9.]+)["']/i);
  return viewBox ? [Number(viewBox[1]), Number(viewBox[2])] : null;
}

function dimensions(bytes, mimeType) {
  if (mimeType === "image/png") return pngDimensions(bytes);
  if (mimeType === "image/gif") return gifDimensions(bytes);
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
  if (mimeType === "image/svg+xml") return svgDimensions(bytes);
  throw new Error(`image dimensions are not supported for ${mimeType}`);
}

async function digest(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function collect(statements, predicate, result = []) {
  for (const statement of statements) {
    if (predicate(statement)) result.push(statement);
    if (statement.statements) collect(statement.statements, predicate, result);
  }
  return result;
}

export async function resolveAssets(document, filesystem, options = {}) {
  document = expandDocument(document);
  const limits = { ...DEFAULT_LIMITS, ...options };
  const declarations = collect(document.statements, (item) => item.type === "asset");
  const uses = collect(document.statements, (item) => ["image", "icon"].includes(item.type));
  const assets = new Map();
  const files = {};
  let aggregateBytes = 0;
  for (const declaration of declarations) {
    if (assets.has(declaration.id)) throw new Error(`duplicate asset '${declaration.id}'`);
    let bytes;
    let mimeType;
    if (declaration.source.startsWith("data:")) {
      ({ bytes, mimeType } = decodeDataUrl(declaration.source));
    } else {
      if (/^(?:\/|[A-Za-z]:[\\/])/.test(declaration.source)) {
        throw new Error(`asset '${declaration.id}' path must be relative to the configured root`);
      }
      const sourceFile = declaration.sourceFile ?? ".";
      const path = joinRelative(sourceFile, declaration.source);
      bytes = await filesystem.readBinary(path);
      mimeType = mimeFor(path, declaration.attributes.mime);
    }
    if (!SUPPORTED_MIME.has(mimeType)) throw new Error(`asset '${declaration.id}' has unsupported format '${mimeType || "unknown"}'`);
    if (bytes.length > limits.fileBytes) throw new Error(`asset '${declaration.id}' exceeds the ${limits.fileBytes}-byte file limit`);
    const measured = dimensions(bytes, mimeType);
    if (!measured || !measured.every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error(`asset '${declaration.id}' has malformed or missing dimensions`);
    }
    if (measured.some((value) => value > limits.dimension)) {
      throw new Error(`asset '${declaration.id}' exceeds the ${limits.dimension}-pixel dimension limit`);
    }
    const fileId = (await digest(bytes)).slice(0, 40);
    const dataURL = `data:${mimeType};base64,${base64(bytes)}`;
    const resolved = { fileId, mimeType, width: measured[0], height: measured[1], bytes: bytes.length };
    assets.set(declaration.id, resolved);
    if (!files[fileId]) {
      aggregateBytes += bytes.length;
      if (aggregateBytes > limits.aggregateBytes) throw new Error(`assets exceed the ${limits.aggregateBytes}-byte document limit`);
      files[fileId] = { id: fileId, dataURL, mimeType, created: 1, lastRetrieved: 1 };
    }
  }
  for (const use of uses) {
    const resolved = assets.get(use.asset);
    if (!resolved) throw new Error(`${use.type} '${use.id}' references unknown asset '${use.asset}'`);
    use.resolvedAsset = resolved;
  }
  Object.defineProperty(document, "assetFiles", { value: files, enumerable: false, configurable: true });
  return document;
}
