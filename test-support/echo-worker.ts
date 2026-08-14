import { parentPort } from "node:worker_threads";

parentPort?.on("message", (message: { value: number }) => {
  parentPort?.postMessage({ doubled: message.value * 2 });
});
