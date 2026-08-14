import { createWorkerHost } from "../../platform/worker-host.ts";
import type { WorkerHost } from "../../platform/worker-host.ts";
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

type FormulaWorker = WorkerHost<FormulaRequest, FormulaResponse>;

export class FormulaSyntaxError extends Error {}
export class FormulaRenderTimeoutError extends Error {}
export class FormulaRenderInfrastructureError extends Error {}

let worker: Promise<FormulaWorker> | null = null;
let renderQueue = Promise.resolve();
let requestId = 0;

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason));
}

function createWorker(): Promise<FormulaWorker> {
  return createWorkerHost<FormulaRequest, FormulaResponse>({
    base: import.meta.url,
    unref: true,
    browserWorker: () => new Worker(new URL("./worker-browser.js", import.meta.url), { type: "module" }),
  });
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
