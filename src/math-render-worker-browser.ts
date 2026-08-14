import {
  FormulaCoreSyntaxError,
  formulaRenderErrorMessage,
  renderFormulaSvgCore,
} from "./math-renderer-core.ts";

interface FormulaRequest {
  readonly id: number;
  readonly source: string;
}

addEventListener("message", (event: MessageEvent<FormulaRequest>) => {
  void renderFormulaSvgCore(event.data.source).then(
    (result) => postMessage({ id: event.data.id, result }),
    (error: unknown) => postMessage({
      id: event.data.id,
      error: {
        type: error instanceof FormulaCoreSyntaxError ? "syntax" : "renderer",
        message: formulaRenderErrorMessage(error),
      },
    }),
  );
});
