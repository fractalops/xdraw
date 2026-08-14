import { readFile } from "node:fs/promises";

import { expect, type FrameLocator, type Page } from "@playwright/test";

export async function openDiagram(page: Page, source: string, timeout = 10_000) {
  await page.goto(`http://127.0.0.1:4173/host.html?source=${encodeURIComponent(source)}`);
  await expect(page.locator("#status")).toHaveAttribute("data-phase", "ready", { timeout });
  return page.frameLocator("#app");
}

export async function downloadDrawing(page: Page, app: FrameLocator) {
  const pending = page.waitForEvent("download");
  await app.getByRole("button", { name: "Download" }).click();
  const download = await pending;
  const file = await download.path();
  if (!file) throw new Error("download did not produce a local file");
  return JSON.parse(await readFile(file, "utf8"));
}

export async function paintedPixels(app: FrameLocator) {
  return app.locator("canvas").evaluateAll((elements: HTMLCanvasElement[]) => elements.reduce((total, element) => {
    const context = element.getContext("2d");
    if (!context) return total;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index + 3] > 0 && (pixels[index] < 235 || pixels[index + 1] < 235 || pixels[index + 2] < 235)) count += 1;
    }
    return total + count;
  }, 0));
}
