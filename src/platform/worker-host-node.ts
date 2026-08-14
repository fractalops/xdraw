import type { WorkerHost } from "./worker-host.ts";

export async function createNodeWorkerHost<Outgoing, Incoming>(
  url: URL,
  unref: boolean,
): Promise<WorkerHost<Outgoing, Incoming>> {
  const workerThreadsSpecifier = "node:worker_threads";
  const { Worker } = await import(/* @vite-ignore */ workerThreadsSpecifier) as typeof import("node:worker_threads");
  const worker = new Worker(url, { execArgv: [] });
  if (unref) worker.unref();
  return {
    postMessage: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
    onMessage: (listener) => {
      const handler = (message: Incoming): void => listener(message);
      worker.on("message", handler);
      return () => void worker.off("message", handler);
    },
    onError: (listener) => {
      worker.on("error", listener);
      return () => void worker.off("error", listener);
    },
    onExit: (listener) => {
      worker.on("exit", listener);
      return () => void worker.off("exit", listener);
    },
  };
}
