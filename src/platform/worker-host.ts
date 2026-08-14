/**
 * One way to run a module in a worker on either Node or the browser.
 *
 * This module owns environment detection, the Node adapter, and the lifecycle
 * surface. It deliberately does NOT own browser worker construction: bundlers
 * only detect a worker when they can statically see
 * `new Worker(new URL("./name.js", import.meta.url), { type: "module" })`, so
 * that expression must appear literally at each call site and is passed in as
 * `browserWorker`. See CONTEXT.md.
 */

export interface WorkerHost<Outgoing = unknown, Incoming = unknown> {
  postMessage(message: Outgoing): void;
  terminate(): void | Promise<unknown>;
  /** Registers a listener and returns a function that removes it. */
  onMessage(listener: (message: Incoming) => void): () => void;
  /** Registers a listener and returns a function that removes it. */
  onError(listener: (error: Error) => void): () => void;
  /** Node only: the browser exposes no equivalent. */
  onExit?(listener: (code: number) => void): () => void;
}

export interface WorkerHostOptions {
  /** `import.meta.url` of the module that owns the Node worker file. */
  readonly base: string;
  /** Node worker module name, without extension. */
  readonly nodeModule?: string;
  /** Must contain a literal `new Worker(new URL(…), { type: "module" })`. */
  readonly browserWorker: () => Worker;
  /** Node only: allow the process to exit while this worker is alive. */
  readonly unref?: boolean;
}

/**
 * Resolves a sibling Node worker module, matching the caller's own extension so
 * the same source works before and after the TypeScript build. Safe to compute
 * dynamically because the Node path is never bundled.
 */
export function nodeWorkerUrl(name: string, base: string): URL {
  const extension = base.endsWith(".ts") ? "ts" : "js";
  return new globalThis.URL(`./${name}.${extension}`, base);
}

function isNode(): boolean {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}

export async function createWorkerHost<Outgoing = unknown, Incoming = unknown>(
  options: WorkerHostOptions,
): Promise<WorkerHost<Outgoing, Incoming>> {
  if (isNode()) {
    const { createNodeWorkerHost } = await import("./worker-host-node.ts");
    return createNodeWorkerHost<Outgoing, Incoming>(
      nodeWorkerUrl(options.nodeModule ?? "worker-node", options.base),
      options.unref ?? false,
    );
  }
  const { wrapBrowserWorker } = await import("./worker-host-browser.ts");
  return wrapBrowserWorker<Outgoing, Incoming>(options.browserWorker());
}
