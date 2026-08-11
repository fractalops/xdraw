import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

function normalizeRelative(path) {
  if (isAbsolute(path)) throw new Error(`path must be relative to the configured root: ${path}`);
  const normalized = relative(".", resolve(".", path));
  if (normalized === ".." || normalized.startsWith(`..${sep}`) || isAbsolute(normalized)) {
    throw new Error(`path escapes the configured root: ${path}`);
  }
  return normalized;
}

function readableFileError(error, path) {
  if (error?.code === "ENOENT") return new Error(`file not found: ${path}`);
  if (error?.code === "EACCES" || error?.code === "EPERM") return new Error(`file is not readable: ${path}`);
  return error;
}

export class RootedFileSystem {
  constructor(root, options = {}) {
    this.root = resolve(root);
    this.read = options.read ?? readFile;
    this.realpath = options.realpath ?? realpath;
  }

  resolve(path) {
    const relativePath = normalizeRelative(path);
    const target = resolve(this.root, relativePath);
    const fromRoot = relative(this.root, target);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`path escapes the configured root: ${path}`);
    }
    return target;
  }

  async readText(path) {
    try {
      return await this.read(await this.#resolveCanonical(path), "utf8");
    } catch (error) {
      throw readableFileError(error, path);
    }
  }

  async readBinary(path) {
    try {
      return new Uint8Array(await this.read(await this.#resolveCanonical(path)));
    } catch (error) {
      throw readableFileError(error, path);
    }
  }

  async #resolveCanonical(path) {
    const target = this.resolve(path);
    const [canonicalRoot, canonicalTarget] = await Promise.all([
      this.realpath(this.root),
      this.realpath(target),
    ]);
    const fromRoot = relative(canonicalRoot, canonicalTarget);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`path escapes the configured root through a symbolic link: ${path}`);
    }
    return canonicalTarget;
  }
}

export class MemoryFileSystem {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries).map(([path, value]) => [normalizeRelative(path), value]));
  }

  async readText(path) {
    const value = this.#get(path);
    return typeof value === "string" ? value : new TextDecoder().decode(value);
  }

  async readBinary(path) {
    const value = this.#get(path);
    return typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  }

  #get(path) {
    const relativePath = normalizeRelative(path);
    if (!this.entries.has(relativePath)) throw new Error(`file not found in memory filesystem: ${path}`);
    return this.entries.get(relativePath);
  }
}
