import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type FrameLocator, type Page } from "@playwright/test";

async function downloadDrawing(page: Page, app: FrameLocator) {
  const pending = page.waitForEvent("download");
  await app.getByRole("button", { name: "Download" }).click();
  const download = await pending;
  const file = await download.path();
  if (!file) throw new Error("download did not produce a local file");
  return JSON.parse(await readFile(file, "utf8"));
}

test("renders named styles, ellipses and controlled text", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const source = await readFile(resolve("examples/styling.xdraw"), "utf8");
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

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
  expect(paintedPixels).toBeGreaterThan(1_000);
  await app.locator(".canvas").screenshot({ path: "output/styling-preview.png" });
  const before = await downloadDrawing(page, app);
  const beforeById = new Map(before.elements.map((element: any) => [element.id, element]));

  await app.locator(".canvas").click({ position: { x: 25, y: 25 } });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  const after = await downloadDrawing(page, app);
  const afterById = new Map(after.elements.map((element: any) => [element.id, element]));
  expect(afterById.get("source:frame").x).toBe(beforeById.get("source:frame").x + 1);
  expect(afterById.get("source:title").x).toBe(beforeById.get("source:title").x + 1);
  expect(afterById.get("source:title").containerId).toBe("source:frame");
  expect(afterById.get("target:frame").x).toBe(beforeById.get("target:frame").x);
  expect(afterById.get("target:frame").locked).toBe(true);
  expect(afterById.get("target:frame").link).toBe("https://example.com");
  expect(afterById.get("caption").width).toBe(300);

  expect(errors).toEqual([]);
});
