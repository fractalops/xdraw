/**
 * Draws the curves a document described.
 *
 * A plot is lowered as a description — its equations, its domain, its tolerance
 * — rather than as points, and this pass turns it into the freehand stroke that
 * everything downstream already understands. It runs after templates have been
 * expanded and before the document is validated, which is the whole reason it
 * exists as a separate pass: sampling in the parser froze a curve before a
 * template could supply a value to it, so `y = $amp * sin(t)` could never work.
 * Validation still sees the resulting stroke, so the freehand limits apply to a
 * plotted curve exactly as they do to a drawn one.
 */
import { sampleCurve } from "../language/curve-sampler.ts";
import type {
  DiagramDocument,
  FreedrawStatement,
  PlotStatement,
  SemanticStatement,
} from "../contracts/semantic.ts";

export class PlotError extends Error {
  readonly id: string;

  constructor(id: string, reason: string) {
    super(`plot '${id}' could not be drawn: ${reason}`);
    this.name = "XDrawPlotError";
    this.id = id;
  }
}

const UNRESOLVED_PARAMETER = /\$\{([A-Za-z_][A-Za-z0-9_-]*)\}/u;

function draw(statement: PlotStatement): FreedrawStatement {
  // A parameter that no template supplied is still text here, and would
  // otherwise reach the expression tokenizer as a stray '$'.
  const orphan = UNRESOLVED_PARAMETER.exec(statement.x) ?? UNRESOLVED_PARAMETER.exec(statement.y);
  if (orphan) {
    throw new PlotError(statement.id, `'${orphan[0]}' is not supplied by any template`);
  }
  const result = sampleCurve({
    x: statement.x,
    y: statement.y,
    from: statement.from,
    to: statement.to,
    tolerance: statement.tolerance,
  });
  if (result.status === "refused") throw new PlotError(statement.id, result.reason);

  // Points are relative to `at`, as freedraw expects, and the first is the
  // origin of the stroke rather than the first sample.
  const [originX, originY] = result.points[0];
  const drawn: FreedrawStatement = {
    ...statement,
    type: "freedraw",
    at: [statement.at[0] + originX, statement.at[1] + originY],
    points: result.points.map(([x, y]) => [x - originX, y - originY] as [number, number]),
    pressures: [],
    simulatePressure: false,
  } as unknown as FreedrawStatement;
  // The span belongs to the source the author wrote, so a diagnostic about the
  // stroke still points at the plot that described it.
  const span = (statement as { span?: unknown }).span;
  if (span) Object.defineProperty(drawn, "span", { value: span, enumerable: false });
  return drawn;
}

function walk(statements: readonly SemanticStatement[]): SemanticStatement[] {
  return statements.map((statement) => {
    if (statement.type === "plot") return draw(statement);
    const children = (statement as { statements?: readonly SemanticStatement[] }).statements;
    if (Array.isArray(children)) {
      const replaced = walk(children);
      if (replaced.some((item, index) => item !== children[index])) {
        const copy = { ...statement, statements: replaced };
        const span = (statement as { span?: unknown }).span;
        if (span) Object.defineProperty(copy, "span", { value: span, enumerable: false });
        return copy as SemanticStatement;
      }
    }
    return statement;
  });
}

/** Replaces every described curve with the stroke that draws it. */
export function drawPlots(document: DiagramDocument): DiagramDocument {
  const statements = walk(document.statements);
  if (statements.every((statement, index) => statement === document.statements[index])) {
    return document;
  }
  const copy = { ...document, statements };
  for (const key of ["span", "source", "comments"] as const) {
    const value = (document as unknown as Record<string, unknown>)[key];
    if (value !== undefined) Object.defineProperty(copy, key, { value, enumerable: false });
  }
  return copy;
}
