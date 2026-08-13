import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { downloadDrawing, openDiagram } from "./helpers";

test("renders syntax-highlighted code as editable source runs", async ({ page }) => {
  const source = await readFile(resolve("examples/code-blocks.xdraw"), "utf8");
  const app = await openDiagram(page, source);
  const drawing = await downloadDrawing(page, app);
  const code = drawing.elements.filter((element: { id: string }) => element.id.startsWith("typescript:source:"));
  const frame = drawing.elements.find((element: { id: string }) => element.id === "typescript:frame");
  const sql = drawing.elements.filter((element: { id: string }) => element.id.startsWith("sql:source:"));
  expect(code.length).toBeGreaterThan(1);
  expect(code.some((element: { text: string }) => element.text.includes("return"))).toBe(true);
  expect(new Set(code.map((element: { strokeColor: string }) => element.strokeColor)).size).toBeGreaterThan(1);
  expect(frame.customData.xdraw.source).toContain("  return `Compiling: ${stage}`");
  expect(frame.customData.xdraw.highlighted).toBe(true);
  expect(sql.length).toBeGreaterThan(1);
  expect(drawing.elements.some((element: { id: string }) => element.id === "sql:lines")).toBe(false);
});

test("does not load syntax-highlighting chunks for ordinary diagrams", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const source = 'diagram "Plain" { source: rectangle "Source" }';

  await openDiagram(page, source);

  for (const chunk of ["typescript-", "sql-", "github-light-", "engine-javascript-"]) {
    expect(requests.some((url) => url.includes(chunk))).toBe(false);
  }
});
