import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

test("renders a large multi-section diagram", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1800 });
  const oversizedResponses: string[] = [];
  page.on("response", (response) => {
    if (response.status() === 413) oversizedResponses.push(response.url());
  });
  const source = await readFile(resolve("examples/platform-overview.xdraw"), "utf8");
  await page.goto(`http://127.0.0.1:4173/host.html?source=${encodeURIComponent(source)}`);
  await expect(page.locator("#status")).toHaveAttribute("data-phase", "ready");

  const app = page.frameLocator("#app");
  await expect(app.getByText("Editable diagram")).toBeVisible();
  await page.waitForTimeout(500);
  const canvases = app.locator("canvas");
  await expect(canvases).toHaveCount(2);
  const paintedPixels = await canvases.evaluateAll((elements: HTMLCanvasElement[]) => elements.reduce((total, element) => {
    const context = element.getContext("2d");
    if (!context) return total;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index + 3] > 0 && (pixels[index] < 235 || pixels[index + 1] < 235 || pixels[index + 2] < 235)) count += 1;
    }
    return total + count;
  }, 0));
  expect(paintedPixels).toBeGreaterThan(10_000);
  expect(oversizedResponses).toEqual([]);
  await app.locator(".canvas").screenshot({ path: "output/platform-overview-preview.png" });
});
