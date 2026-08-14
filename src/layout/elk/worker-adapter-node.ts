import type { LayoutWorker } from "./worker-transport.ts";

export async function createNodeLayoutWorker(): Promise<LayoutWorker> {
  const workerThreadsSpecifier = "node:worker_threads";
  const { Worker } = await import(/* @vite-ignore */ workerThreadsSpecifier) as typeof import("node:worker_threads");
  const sourceExtension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const workerUrl = new globalThis.URL(`./worker-node.${sourceExtension}`, import.meta.url);
  const worker = new Worker(workerUrl, { execArgv: [] });
  return {
    postMessage: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
    onMessage: (handler) => worker.on("message", handler),
    onError: (handler) => worker.on("error", handler),
    onExit: (handler) => worker.on("exit", handler),
  };
}
