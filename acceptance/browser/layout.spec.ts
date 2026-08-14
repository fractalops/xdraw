import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { downloadDrawing, openDiagram, paintedPixels } from "./helpers";

test("renders editable nested frames with locked membership", async ({ page }) => {
  const source = await readFile(resolve("examples/frames.xdraw"), "utf8");
  const app = await openDiagram(page, source);
  await expect(app.locator("canvas")).toHaveCount(2);
  expect(await paintedPixels(app)).toBeGreaterThan(1_000);
  await app.locator(".canvas").screenshot({ path: "output/frames-preview.png" });

  const before = await downloadDrawing(page, app);
  const byId = new Map(before.elements.map((element: any) => [element.id, element]));
  expect(byId.get("workspace").type).toBe("frame");
  expect(byId.get("workspace.storage").frameId).toBe("workspace");
  expect(byId.get("workspace.storage.records:frame").frameId).toBe("workspace.storage");
  expect(byId.get("workspace.storage.records:frame").locked).toBe(true);
  expect(byId.get("movable").locked).toBe(false);
  expect(before.appState.frameRendering.clip).toBe(true);

  await app.locator(".canvas").click({ position: { x: 25, y: 25 } });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ArrowRight");
  const after = await downloadDrawing(page, app);
  const afterById = new Map(after.elements.map((element: any) => [element.id, element]));
  expect(afterById.get("workspace").x).toBe(byId.get("workspace").x);
  expect(afterById.get("workspace.storage.records:frame").x).toBe(byId.get("workspace.storage.records:frame").x);
  expect(afterById.get("movable").x).toBe(byId.get("movable").x + 1);

  await app.locator(".canvas").click({ position: { x: 25, y: 25 } });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ControlOrMeta+D");
  const duplicated = await downloadDrawing(page, app);
  expect(duplicated.elements.filter((element: any) => element.type === "frame").length)
    .toBeGreaterThan(before.elements.filter((element: any) => element.type === "frame").length);
});

test("renders deterministic layered placement", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const source = `use "xdraw/architecture" as arch
  diagram "Layered layout" {
    arrange layered { gap 30 }
    request: arch.person "Request"
    api: arch.system "API"
    worker: arch.system "Worker"
    records: arch.database "Records"
    request -> api
    api -> worker
    worker -> records
  }`;
  const app = await openDiagram(page, source);
  expect(await paintedPixels(app)).toBeGreaterThan(1_000);
  await app.locator(".canvas").screenshot({ path: "output/layered-layout-preview.png" });
  const drawing = await downloadDrawing(page, app);
  const frames = ["request", "api", "worker", "records"].map(
    (id) => drawing.elements.find((element: any) => element.id === `${id}:frame`),
  );
  expect(frames.every((frame, index) => index === 0 || frames[index - 1].x < frame.x)).toBe(true);
  expect(requests.some((url) => url.includes("worker-browser-"))).toBe(true);
});

test("does not load ELK for built-in layouts", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await openDiagram(page, 'diagram "Row" { source: rectangle "Source" }');

  expect(requests.some((url) => url.includes("worker-browser-"))).toBe(false);
});
