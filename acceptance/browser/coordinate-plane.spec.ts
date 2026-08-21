import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { compile } from "../../src/compile/pipeline.ts";
import { parseSource } from "../../src/language/parser.ts";
import { downloadDrawing, openDiagram, paintedPixels } from "./helpers";
import type { DrawingJson } from "../../src/contracts/render.ts";

test("renders coordinate planes as native, clipped, inspectable line geometry", async ({ page }) => {
  const source = await readFile(resolve("examples/coordinate-plane.xdraw"), "utf8");
  const app = await openDiagram(page, source);
  const browserDrawing = await downloadDrawing(page, app);
  const browserCompiled = await app.locator("body").evaluate(() => (
    (window as typeof window & { __xdrawCompiled?: DrawingJson }).__xdrawCompiled
  ));
  const nodeDrawing = (await compile(parseSource(source))).toJSON();
  const series = browserDrawing.elements.filter((element) => (
    element.customData?.xdraw?.role === "cartesian-series"
  ));

  expect(series.length).toBeGreaterThanOrEqual(2);
  expect(series.every((element) => element.type === "line")).toBe(true);
  expect(series.every((element) => element.points.length >= 2)).toBe(true);
  expect(browserDrawing.elements.some((element) => element.id === "response:axis:x")).toBe(true);
  expect(browserDrawing.elements.some((element) => element.id === "response:axis:y")).toBe(true);
  expect(browserDrawing.elements.some((element) => element.id === "response:axis:x:title")).toBe(true);
  expect(browserDrawing.elements.some((element) => element.id === "response:axis:y:title")).toBe(true);
  expect(browserDrawing.elements.filter((element) => element.id.startsWith("response:grid:")).length).toBeGreaterThan(4);
  for (const element of series) {
    expect(element.customData?.xdraw).toMatchObject({ role: "cartesian-series", plane: "response" });
    expect(element.points.flat().every(Number.isFinite)).toBe(true);
    expect(browserCompiled?.elements.find((candidate) => candidate.id === element.id)).toEqual(
      nodeDrawing.elements.find((candidate) => candidate.id === element.id),
    );
  }
  expect(await paintedPixels(app)).toBeGreaterThan(7_000);
});
