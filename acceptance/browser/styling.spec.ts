import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { downloadDrawing, openDiagram, paintedPixels } from "./helpers";

test("renders named styles, ellipses and controlled text", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const source = await readFile(resolve("examples/styling.xdraw"), "utf8");
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const app = await openDiagram(page, source);
  await expect(app.getByText("Editable diagram")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(app.locator("canvas")).toHaveCount(2);
  expect(await paintedPixels(app)).toBeGreaterThan(1_000);
  await app.locator(".canvas").screenshot({ path: "output/styling-preview.png" });
  const before = await downloadDrawing(page, app);
  const beforeById = new Map(before.elements.map((element: any) => [element.id, element]));

  await app.locator(".canvas").click({ position: { x: 25, y: 25 } });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  const after = await downloadDrawing(page, app);
  const afterById = new Map(after.elements.map((element: any) => [element.id, element]));
  expect(afterById.get("examples.source:frame").x).toBe(beforeById.get("examples.source:frame").x + 1);
  expect(afterById.get("examples.source:title").x).toBe(beforeById.get("examples.source:title").x + 1);
  expect(afterById.get("examples.source:title").containerId).toBe("examples.source:frame");
  expect(afterById.get("examples.target:frame").x).toBe(beforeById.get("examples.target:frame").x);
  expect(afterById.get("examples.target:frame").locked).toBe(true);
  expect(afterById.get("examples.target:frame").link).toBe("https://example.com");
  expect(afterById.get("caption").width).toBe(300);

  expect(errors).toEqual([]);
});
