import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { openDiagram, paintedPixels } from "./helpers";

test("renders a large multi-section diagram", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1800 });
  const oversizedResponses: string[] = [];
  page.on("response", (response) => {
    if (response.status() === 413) oversizedResponses.push(response.url());
  });
  const source = await readFile(resolve("examples/platform-overview.xdraw"), "utf8");
  const app = await openDiagram(page, source);
  await expect(app.getByText("Editable diagram")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(app.locator("canvas")).toHaveCount(2);
  expect(await paintedPixels(app)).toBeGreaterThan(10_000);
  expect(oversizedResponses).toEqual([]);
  await app.locator(".canvas").screenshot({ path: "output/platform-overview-preview.png" });
});
