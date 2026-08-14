import type { RenderedFormulaSvg } from "./core.ts";

export const FORMULA_RENDER_TIMEOUT_MS = 10_000;

interface FormulaRequest {
  readonly id: number;
  readonly source: string;
}

interface FormulaResponse {
  readonly id: number;
  readonly result?: RenderedFormulaSvg;
  readonly error?: { readonly type: "syntax" | "renderer"; readonly message: string };
}

interface FormulaWorker {
  postMessage(message: FormulaRequest): void;
  terminate(): void | Promise<unknown>;
  onMessage(listener: (message: FormulaResponse) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
}

export class FormulaSyntaxError extends Error {}
export class FormulaRenderTimeoutError extends Error {}
export class FormulaRenderInfrastructureError extends Error {}

let worker: Promise<FormulaWorker> | null = null;
let renderQueue = Promise.resolve();
let requestId = 0;

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason));
}

async function createWorker(): Promise<FormulaWorker> {
  if (typeof Worker === "function") {
    const instance = new Worker(new URL("./worker-browser.ts", import.meta.url), { type: "module" });
    return {
      postMessage: (message) => instance.postMessage(message),
      terminate: () => instance.terminate(),
      onMessage: (listener) => {
        const handler = (event: MessageEvent<FormulaResponse>): void => listener(event.data);
        instance.addEventListener("message", handler);
        return () => instance.removeEventListener("message", handler);
      },
      onError: (listener) => {
        const handler = (event: ErrorEvent): void => listener(
          event.error instanceof Error ? event.error : new Error(event.message),
        );
        instance.addEventListener("error", handler);
        return () => instance.removeEventListener("error", handler);
      },
    };
  }
  const { Worker: NodeWorker } = await import("node:worker_threads");
  const instance = new NodeWorker(new URL("./worker-node.ts", import.meta.url), { execArgv: [] });
  instance.unref();
  return {
    postMessage: (message) => instance.postMessage(message),
    terminate: () => instance.terminate(),
    onMessage: (listener) => {
      instance.on("message", listener);
      return () => instance.off("message", listener);
    },
    onError: (listener) => {
      instance.on("error", listener);
      return () => instance.off("error", listener);
    },
  };
}

async function terminateWorker(): Promise<void> {
  const active = worker;
  worker = null;
  if (!active) return;
  try {
    await (await active).terminate();
  } catch {
    // A worker that failed during startup has nothing left to terminate.
  }
}

async function getWorker(): Promise<FormulaWorker> {
  const pending = worker ??= createWorker();
  try {
    return await pending;
  } catch (error) {
    if (worker === pending) worker = null;
    throw new FormulaRenderInfrastructureError(
      `formula worker could not start: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function requestFormula(source: string, signal: AbortSignal): Promise<RenderedFormulaSvg> {
  if (signal.aborted) throw abortReason(signal);
  const active = await getWorker();
  if (signal.aborted) throw abortReason(signal);
  const id = requestId += 1;
  return new Promise<RenderedFormulaSvg>((resolve, reject) => {
    let removeMessage = (): void => undefined;
    let removeError = (): void => undefined;
    const cleanup = (): void => {
      removeMessage();
      removeError();
      signal.removeEventListener("abort", abort);
    };
    const abort = (): void => {
      cleanup();
      void terminateWorker();
      reject(abortReason(signal));
    };
    const fail = (error: Error): void => {
      cleanup();
      void terminateWorker();
      reject(new FormulaRenderInfrastructureError(`formula worker failed: ${error.message}`));
    };
    removeMessage = active.onMessage((response) => {
      if (response.id !== id) return;
      cleanup();
      if (response.error?.type === "syntax") reject(new FormulaSyntaxError(response.error.message));
      else if (response.error) {
        reject(new FormulaRenderInfrastructureError(`formula renderer produced invalid output: ${response.error.message}`));
      }
      else if (response.result) resolve(response.result);
      else reject(new FormulaRenderInfrastructureError("formula worker returned no result"));
    });
    removeError = active.onError(fail);
    signal.addEventListener("abort", abort, { once: true });
    active.postMessage({ id, source });
  });
}

async function renderAdmitted(
  source: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<RenderedFormulaSvg> {
  if (externalSignal?.aborted) throw abortReason(externalSignal);
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort(abortReason(externalSignal!));
  externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new FormulaRenderTimeoutError(`formula rendering exceeded ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    return await requestFormula(source, controller.signal);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", forwardAbort);
  }
}

export function renderFormulaSvg(
  source: string,
  timeoutMs = FORMULA_RENDER_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<RenderedFormulaSvg> {
  if (timeoutMs <= 0) {
    return Promise.reject(new FormulaRenderTimeoutError(`formula rendering exceeded ${timeoutMs}ms`));
  }
  const scheduled = renderQueue.then(() => renderAdmitted(source, timeoutMs, signal));
  renderQueue = scheduled.then(() => undefined, () => undefined);
  if (!signal) return scheduled;
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(abortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
    scheduled.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}
