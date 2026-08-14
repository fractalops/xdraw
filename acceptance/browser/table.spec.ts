import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { downloadDrawing, openDiagram, paintedPixels } from "./helpers";

test("renders tables as editable grouped primitives", async ({ page }) => {
  const source = await readFile(resolve("examples/tables.xdraw"), "utf8");
  const app = await openDiagram(page, source);
  const drawing = await downloadDrawing(page, app);
  const tableElements = drawing.elements.filter((element: { id: string }) =>
    element.id.startsWith("orders:"),
  );

  expect(tableElements.length).toBeGreaterThan(0);
  expect(tableElements.every((element: { type: string }) =>
    element.type === "rectangle" || element.type === "text",
  )).toBe(true);
  expect(tableElements.every((element: { groupIds: string[] }) =>
    element.groupIds.includes("orders:group"),
  )).toBe(true);
  expect(tableElements.find((element: { id: string }) =>
    element.id === "orders:row:1:cell:2:text",
  )?.text).toContain("\n");
  expect(await paintedPixels(app)).toBeGreaterThan(5_000);
});
