import { parentPort } from "node:worker_threads";

import {
  FormulaCoreSyntaxError,
  formulaRenderErrorMessage,
  renderFormulaSvgCore,
} from "./math-renderer-core.ts";

interface FormulaRequest {
  readonly id: number;
  readonly source: string;
}

if (!parentPort) throw new Error("formula worker requires a message port");
const port = parentPort;
port.on("message", (request: FormulaRequest) => {
  void renderFormulaSvgCore(request.source).then(
    (result) => port.postMessage({ id: request.id, result }),
    (error: unknown) => port.postMessage({
      id: request.id,
      error: {
        type: error instanceof FormulaCoreSyntaxError ? "syntax" : "renderer",
        message: formulaRenderErrorMessage(error),
      },
    }),
  );
});
