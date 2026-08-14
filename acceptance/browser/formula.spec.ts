import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { compileAsync } from "../../src/pipeline.ts";
import { parseSource } from "../../src/language/parser.ts";
import type { DrawingJson } from "../../src/render-contracts.ts";
import { downloadDrawing, openDiagram, paintedPixels } from "./helpers";

test("renders formulas as portable SVG assets with inspectable metadata", async ({ page }) => {
  const source = await readFile(resolve("examples/formulas.xdraw"), "utf8");
  const app = await openDiagram(page, source, 25_000);
  const drawing = await downloadDrawing(page, app);
  const browserCompiled = await app.locator("body").evaluate(() => (
    (window as typeof window & { __xdrawCompiled?: DrawingJson }).__xdrawCompiled
  ));
  expect(browserCompiled).toBeDefined();
  const nodeDrawing = (await compileAsync(parseSource(source))).toJSON();
  const formulas = drawing.elements.filter((element: { customData?: { xdraw?: { type?: string } } }) => (
    element.customData?.xdraw?.type === "formula"
  ));

  expect(formulas).toHaveLength(3);
  expect(formulas.every((element: { type: string }) => element.type === "image")).toBe(true);
  expect(Object.keys(drawing.files)).toHaveLength(3);
  expect(formulas[0].customData.xdraw).toMatchObject({
    type: "formula",
    renderer: "mathjax-svg",
    displayMode: true,
  });
  expect(formulas[0].customData.xdraw.source).toContain("\\int_0^\\infty");
  expect(formulas.every((element: { fileId: string }) =>
    drawing.files[element.fileId]?.mimeType === "image/svg+xml",
  )).toBe(true);
  for (const formula of formulas) {
    const nodeFormula = nodeDrawing.elements.find((element) => element.id === formula.id);
    expect(nodeFormula?.type).toBe("image");
    expect(formula.fileId).toBe(nodeFormula?.type === "image" ? nodeFormula.fileId : undefined);
    expect(formula.customData?.xdraw?.digest).toBe(nodeFormula?.customData?.xdraw?.digest);
    expect(browserCompiled?.files[formula.fileId]?.dataURL).toBe(nodeDrawing.files[formula.fileId]?.dataURL);
  }
  expect(await paintedPixels(app)).toBeGreaterThan(5_000);
});
