import { createWorkerHost } from "../../platform/worker-host.ts";
import type { WorkerHost } from "../../platform/worker-host.ts";
import type { ElkNode } from "elkjs/lib/elk-api.js";

const LAYOUT_TIMEOUT_MS = 3_000;

export interface ElkWorkerMessage {
  id: number;
  data?: ElkNode;
  error?: unknown;
}

export type LayoutWorker = WorkerHost<unknown, ElkWorkerMessage>;

export interface ElkTransportOptions {
  timeoutMs?: number;
  createWorker?: () => Promise<LayoutWorker>;
}

function createLayoutWorker(): Promise<LayoutWorker> {
  return createWorkerHost<unknown, ElkWorkerMessage>({
    base: import.meta.url,
    browserWorker: () => new Worker(new URL("./worker-browser.js", import.meta.url), { type: "module" }),
  });
}

export async function runElkLayout(
  graph: ElkNode,
  options: ElkTransportOptions = {},
): Promise<ElkNode> {
  const timeoutMs = options.timeoutMs ?? LAYOUT_TIMEOUT_MS;
  const workerPromise = (options.createWorker ?? createLayoutWorker)();
  let worker: LayoutWorker | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  try {
    return await new Promise<ElkNode>((resolve, reject) => {
      const succeed = (value: ElkNode): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      timeout = setTimeout(() => fail(new Error(`ELK layout exceeded ${timeoutMs} ms`)), timeoutMs);
      void workerPromise.then((created) => {
        worker = created;
        if (settled) return;
        let registered = false;
        created.onError(fail);
        created.onExit?.((code) => fail(new Error(
          code === 0 ? "ELK worker exited before returning layout" : `ELK worker exited with code ${code}`,
        )));
        created.onMessage((message) => {
          if (message.error) {
            fail(message.error);
            return;
          }
          if (!registered && message.id === 0) {
            registered = true;
            created.postMessage({ id: 1, cmd: "layout", graph, layoutOptions: {}, options: {} });
            return;
          }
          if (message.id === 1 && message.data) succeed(message.data);
        });
        created.postMessage({ id: 0, cmd: "register", algorithms: ["layered"] });
      }, fail);
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    if (worker) await worker.terminate();
    else void workerPromise.then(async (created) => { await created.terminate(); }, () => undefined);
  }
}
