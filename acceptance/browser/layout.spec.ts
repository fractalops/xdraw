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

async function paintedPixels(app: FrameLocator) {
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

test("renders editable nested frames with locked membership", async ({ page }) => {
  const source = await readFile(resolve("examples/frames.xdraw"), "utf8");
  await page.goto(`http://127.0.0.1:4173/host.html?source=${encodeURIComponent(source)}`);
  await expect(page.locator("#status")).toHaveAttribute("data-phase", "ready");
  const app = page.frameLocator("#app");
  await expect(app.locator("canvas")).toHaveCount(2);
  expect(await paintedPixels(app)).toBeGreaterThan(1_000);
  await app.locator(".canvas").screenshot({ path: "output/frames-preview.png" });

  const before = await downloadDrawing(page, app);
  const byId = new Map(before.elements.map((element: any) => [element.id, element]));
  expect(byId.get("workspace").type).toBe("frame");
  expect(byId.get("storage").frameId).toBe("workspace");
  expect(byId.get("database:frame").frameId).toBe("storage");
  expect(byId.get("database:frame").locked).toBe(true);
  expect(byId.get("movable").locked).toBe(false);
  expect(before.appState.frameRendering.clip).toBe(true);

  await app.locator(".canvas").click({ position: { x: 25, y: 25 } });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ArrowRight");
  const after = await downloadDrawing(page, app);
  const afterById = new Map(after.elements.map((element: any) => [element.id, element]));
  expect(afterById.get("workspace").x).toBe(byId.get("workspace").x);
  expect(afterById.get("database:frame").x).toBe(byId.get("database:frame").x);
  expect(afterById.get("movable").x).toBe(byId.get("movable").x + 1);

  await app.locator(".canvas").click({ position: { x: 25, y: 25 } });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ControlOrMeta+D");
  const duplicated = await downloadDrawing(page, app);
  expect(duplicated.elements.filter((element: any) => element.type === "frame").length)
    .toBeGreaterThan(before.elements.filter((element: any) => element.type === "frame").length);
});

test("renders deterministic layered placement", async ({ page }) => {
  const source = `diagram "Layered layout" {
    layout layered gap 30
    request: person "Request"
    api: system "API"
    worker: system "Worker"
    records: database "Records"
    request -> api
    api -> worker
    worker -> records
  }`;
  await page.goto(`http://127.0.0.1:4173/host.html?source=${encodeURIComponent(source)}`);
  await expect(page.locator("#status")).toHaveAttribute("data-phase", "ready");
  const app = page.frameLocator("#app");
  expect(await paintedPixels(app)).toBeGreaterThan(1_000);
  await app.locator(".canvas").screenshot({ path: "output/layered-layout-preview.png" });
  const drawing = await downloadDrawing(page, app);
  const frames = ["request", "api", "worker", "records"].map(
    (id) => drawing.elements.find((element: any) => element.id === `${id}:frame`),
  );
  expect(frames.every((frame, index) => index === 0 || frames[index - 1].x < frame.x)).toBe(true);
});
