import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { FileSystem } from "../contracts/foundation.ts";

type FileValue = string | Uint8Array;

export interface RootedFileSystemOptions {
  read?: typeof readFile;
  realpath?: typeof realpath;
}

function normalizeRelative(path: string): string {
  if (isAbsolute(path)) throw new Error(`path must be relative to the configured root: ${path}`);
  const normalized = relative(".", resolve(".", path));
  if (normalized === ".." || normalized.startsWith(`..${sep}`) || isAbsolute(normalized)) {
    throw new Error(`path escapes the configured root: ${path}`);
  }
  return normalized;
}

function hasErrorCode(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function readableFileError(error: unknown, path: string): Error {
  if (hasErrorCode(error) && error.code === "ENOENT") return new Error(`file not found: ${path}`);
  if (hasErrorCode(error) && (error.code === "EACCES" || error.code === "EPERM")) {
    return new Error(`file is not readable: ${path}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export class RootedFileSystem implements FileSystem {
  readonly root: string;
  readonly #read: typeof readFile;
  readonly #realpath: typeof realpath;

  constructor(root: string, options: RootedFileSystemOptions = {}) {
    this.root = resolve(root);
    this.#read = options.read ?? readFile;
    this.#realpath = options.realpath ?? realpath;
  }

  resolve(path: string): string {
    const relativePath = normalizeRelative(path);
    const target = resolve(this.root, relativePath);
    const fromRoot = relative(this.root, target);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`path escapes the configured root: ${path}`);
    }
    return target;
  }

  async readText(path: string): Promise<string> {
    try {
      return await this.#read(await this.#resolveCanonical(path), "utf8");
    } catch (error) {
      throw readableFileError(error, path);
    }
  }

  async readBinary(path: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await this.#read(await this.#resolveCanonical(path)));
    } catch (error) {
      throw readableFileError(error, path);
    }
  }

  async #resolveCanonical(path: string): Promise<string> {
    const target = this.resolve(path);
    const [canonicalRoot, canonicalTarget] = await Promise.all([
      this.#realpath(this.root),
      this.#realpath(target),
    ]);
    const fromRoot = relative(canonicalRoot, canonicalTarget);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`path escapes the configured root through a symbolic link: ${path}`);
    }
    return canonicalTarget;
  }
}

export class MemoryFileSystem implements FileSystem {
  readonly #entries: Map<string, FileValue>;

  constructor(entries: Readonly<Record<string, FileValue>> = {}) {
    this.#entries = new Map(Object.entries(entries).map(([path, value]) => [normalizeRelative(path), value]));
  }

  async readText(path: string): Promise<string> {
    const value = this.#get(path);
    return typeof value === "string" ? value : new TextDecoder().decode(value);
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const value = this.#get(path);
    return typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  }

  #get(path: string): FileValue {
    const relativePath = normalizeRelative(path);
    const value = this.#entries.get(relativePath);
    if (value === undefined) throw new Error(`file not found in memory filesystem: ${path}`);
    return value;
  }
}
