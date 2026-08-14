import type { WorkerHost } from "./worker-host.ts";

/**
 * Wraps an already-constructed worker. Construction stays at the call site so
 * bundlers can statically detect it; see worker-host.ts.
 */
export function wrapBrowserWorker<Outgoing, Incoming>(worker: Worker): WorkerHost<Outgoing, Incoming> {
  return {
    postMessage: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
    onMessage: (listener) => {
      const handler = (event: MessageEvent<Incoming>): void => listener(event.data);
      worker.addEventListener("message", handler);
      return () => worker.removeEventListener("message", handler);
    },
    onError: (listener) => {
      const handler = (event: ErrorEvent): void => listener(
        event.error instanceof Error ? event.error : new Error(event.message),
      );
      worker.addEventListener("error", handler);
      return () => worker.removeEventListener("error", handler);
    },
  };
}
