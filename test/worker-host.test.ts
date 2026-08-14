import assert from "node:assert/strict";
import test from "node:test";

import { createWorkerHost, nodeWorkerUrl } from "../src/platform/worker-host.ts";

test("node worker specifiers follow the caller's own extension", () => {
  assert.equal(
    nodeWorkerUrl("worker-node", "file:///pkg/src/nodes/math/renderer.ts").href,
    "file:///pkg/src/nodes/math/worker-node.ts",
  );
  assert.equal(
    nodeWorkerUrl("worker-node", "file:///pkg/lib/nodes/math/renderer.js").href,
    "file:///pkg/lib/nodes/math/worker-node.js",
  );
  assert.equal(
    nodeWorkerUrl("elk", "file:///pkg/src/layout/elk/worker-transport.ts").href,
    "file:///pkg/src/layout/elk/elk.ts",
  );
});

test("the worker host exposes one lifecycle surface and removable listeners", async () => {
  const host = await createWorkerHost<{ value: number }, { doubled: number }>({
    base: new URL("../test-support/echo-worker.ts", import.meta.url).href,
    nodeModule: "echo-worker",
    unref: true,
    browserWorker: () => {
      throw new Error("browser construction must not run under Node");
    },
  });

  try {
    const seen: number[] = [];
    const stop = host.onMessage((message) => seen.push(message.doubled));
    assert.equal(typeof stop, "function");
    assert.equal(typeof host.onError(() => undefined), "function");
    assert.equal(typeof host.onExit?.(() => undefined), "function");

    const first = await new Promise<number>((resolve) => {
      const done = host.onMessage((message) => {
        done();
        resolve(message.doubled);
      });
      host.postMessage({ value: 21 });
    });
    assert.equal(first, 42);
    assert.deepEqual(seen, [42]);

    // After unsubscribing, the listener must stop receiving messages.
    stop();
    await new Promise<void>((resolve) => {
      const done = host.onMessage(() => {
        done();
        resolve();
      });
      host.postMessage({ value: 1 });
    });
    assert.deepEqual(seen, [42], "removed listener must not receive further messages");
  } finally {
    await host.terminate();
  }
});
