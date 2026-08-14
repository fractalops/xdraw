import { renderCompilation } from "./render.ts";
import { prepareLayeredLayout } from "../layout/elk/prepare.ts";
import { buildSemanticIR, DiagnosticError, validateSemanticDocument } from "../language/semantic.ts";
import { expandDocument } from "../language/expander.ts";
import { prepareDocumentSyntaxHighlighting } from "../text/syntax-highlighter.ts";
import { documentHasFormulas, prepareDocumentFormulas } from "../nodes/math/formula.ts";
import type { Drawing } from "../excalidraw/document.ts";
import type { DiagramDocument, SemanticDocument } from "../semantic-contracts.ts";

type CompileInput = DiagramDocument | SemanticDocument;

export interface CompileOptions {
  syntaxHighlighting?: boolean;
}

function normalizeCompileInput(document: CompileInput): SemanticDocument {
  if (document.type === "semantic-document") {
    const diagnostics = validateSemanticDocument(document);
    if (diagnostics.length) throw new DiagnosticError(diagnostics);
    return document;
  }
  return buildSemanticIR(expandDocument(document));
}

export function compile(document: CompileInput, options: CompileOptions = {}): Drawing {
  const scene = normalizeCompileInput(document);
  if (documentHasFormulas(scene)) {
    throw new Error("math.formula requires asynchronous compilation with compileAsync");
  }
  return renderCompilation(scene, options);
}

export async function compileAsync(document: CompileInput): Promise<Drawing> {
  const scene = normalizeCompileInput(document);
  const syntax = prepareDocumentSyntaxHighlighting(document);
  const formulaPreparation = await prepareDocumentFormulas(scene);
  const [, layered] = await Promise.all([
    syntax,
    prepareLayeredLayout(scene, { formulaPreparation }),
  ]);
  return renderCompilation(scene, { syntaxHighlighting: true }, layered.bounds, formulaPreparation);
}
