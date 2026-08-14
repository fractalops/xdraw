import type { ElkWorkerMessage, LayoutWorker } from "./worker-transport.ts";

export function createBrowserLayoutWorker(): LayoutWorker {
  const worker = new Worker(new URL("./worker-browser.js", import.meta.url), { type: "module" });
  return {
    postMessage: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
    onMessage: (handler) => worker.addEventListener("message", (event) => handler(event.data as ElkWorkerMessage)),
    onError: (handler) => worker.addEventListener("error", (event) => {
      const error: unknown = event.error;
      handler(error instanceof Error ? error : new Error(event.message));
    }),
  };
}
