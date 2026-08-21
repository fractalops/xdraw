import { renderCompilation } from "./render.ts";
import { prepareLayeredLayout } from "../layout/elk/prepare.ts";
import { buildSemanticIR, cloneSemanticDocument } from "../language/semantic.ts";
import { expandDocument } from "../language/expander.ts";
import { drawPlots } from "./plot-pass.ts";
import { expandRepeats } from "../language/repetition.ts";
import { prepareDocumentSyntaxHighlighting } from "../text/syntax-highlighter.ts";
import { documentHasFormulas, prepareDocumentFormulas } from "../nodes/math/formula.ts";
import type { Drawing } from "../excalidraw/document.ts";
import type { DiagramDocument, SemanticDocument } from "../contracts/semantic.ts";

type CompileInput = DiagramDocument | SemanticDocument;

export interface CompileOptions {
  syntaxHighlighting?: boolean;
  /** Emit container-geometry remarks alongside diagnostics. */
  remarks?: boolean;
}

function normalizeCompileInput(document: CompileInput): SemanticDocument {
  if (document.type === "semantic-document") {
    return cloneSemanticDocument(document);
  }
  // Curves are drawn after templates expand and before validation, so a
  // template may supply a value to an equation and the freehand limits still
  // apply to the resulting stroke.
  return buildSemanticIR(drawPlots(expandDocument(expandRepeats(document))));
}

/** Internal synchronous seam for inputs that require no asynchronous preparation. */
export function compilePrepared(document: CompileInput, options: CompileOptions = {}): Drawing {
  const scene = normalizeCompileInput(document);
  if (documentHasFormulas(scene)) {
    throw new Error("math.formula requires compilation through the asynchronous public compile API");
  }
  return renderCompilation(scene, options);
}

export async function compile(document: DiagramDocument, options: CompileOptions = {}): Promise<Drawing> {
  if (!document || document.type !== "diagram") {
    throw new TypeError("public compiler input must be a diagram document; semantic documents are an internal stage");
  }
  const scene = normalizeCompileInput(document);
  const syntax = prepareDocumentSyntaxHighlighting(document);
  const formulaPreparation = await prepareDocumentFormulas(scene);
  const [, layered] = await Promise.all([
    syntax,
    prepareLayeredLayout(scene, { formulaPreparation }),
  ]);
  return renderCompilation(scene, { ...options, syntaxHighlighting: true }, layered.bounds, formulaPreparation);
}
