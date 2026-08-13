import { expandDocument } from "./expander.ts";

import type {
  AssetDeclaration,
  AssetUseStatement,
  DiagramDocument,
  SemanticStatement,
} from "./semantic-contracts.ts";
import type {
  AssetLimits,
  AssetMimeType,
  EmbeddedAssetFiles,
  FileSystem,
  Point,
  ResolvedAsset,
} from "./foundation-contracts.ts";

const MIME_BY_EXTENSION: Readonly<Record<string, AssetMimeType>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const SUPPORTED_MIME = new Set<AssetMimeType>(Object.values(MIME_BY_EXTENSION));
const DEFAULT_LIMITS: Readonly<AssetLimits> = Object.freeze({
  fileBytes: 10 * 1024 * 1024,
  aggregateBytes: 25 * 1024 * 1024,
  dimension: 8192,
});

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function decodeDataUrl(value: string): { mimeType: string; bytes: Uint8Array } {
  const match = value.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!match) throw new Error("malformed asset data URL");
  const mimeType = match[1].toLowerCase();
  if (!match[2]) {
    return { mimeType, bytes: new TextEncoder().encode(decodeURIComponent(match[3])) };
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

function svgDimensions(bytes: Uint8Array): Point | null {
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

function dimensions(bytes: Uint8Array, mimeType: AssetMimeType): Point | null {
  if (mimeType === "image/png") return pngDimensions(bytes);
  if (mimeType === "image/gif") return gifDimensions(bytes);
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
  return svgDimensions(bytes);
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
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
  const limits: AssetLimits = { ...DEFAULT_LIMITS, ...options };
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
    const fileId = (await digest(bytes)).slice(0, 40);
    const dataURL = `data:${supportedMimeType};base64,${base64(bytes)}`;
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
