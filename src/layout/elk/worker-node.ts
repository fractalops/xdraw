import { parentPort } from "node:worker_threads";

import * as ElkWorkerModule from "elkjs/lib/elk-worker.js";

if (!parentPort) throw new Error("ELK worker requires a parent port");
const port = parentPort;

const ElkWorker = (ElkWorkerModule as unknown as {
  Worker: new () => { onmessage?: (event: MessageEvent<unknown>) => void; postMessage(message: unknown): void };
}).Worker;
const worker = new ElkWorker();
worker.onmessage = (event: MessageEvent<unknown>): void => port.postMessage(event.data);
port.on("message", (message: unknown) => worker.postMessage(message));
