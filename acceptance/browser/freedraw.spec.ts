import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { downloadDrawing, openDiagram, paintedPixels } from "./helpers";

test("restores freedraw as an editable native Excalidraw element", async ({ page }) => {
  const source = `diagram "" {
    mark: freedraw {
      at (160, 120)
      points ((0, 30), (35, 0), (75, 55), (115, 10))
      pressures (0.2, 0.5, 0.9, 0.3)
      simulate-pressure false
      stroke "#7c3aed"
      stroke-width 8
    }
  }`;
  const app = await openDiagram(page, source);

  const before = await downloadDrawing(page, app);
  const mark = before.elements.find((element: { id: string }) => element.id === "mark:stroke");
  expect(mark.type).toBe("freedraw");
  expect(mark.pressures).toEqual([0.2, 0.5, 0.9, 0.3]);
  expect(mark.simulatePressure).toBe(false);

  await app.locator(".canvas").click({ position: { x: 25, y: 25 } });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ArrowRight");
  const after = await downloadDrawing(page, app);
  const moved = after.elements.find((element: { id: string }) => element.id === "mark:stroke");
  expect(moved.x).toBe(mark.x + 1);
  expect(moved.points).toEqual(mark.points);
});

test("renders the XDraw logo from editable freehand strokes", async ({ page }) => {
  const source = await readFile(resolve("examples/xdraw-logo.xdraw"), "utf8");
  const app = await openDiagram(page, source);

  expect(await paintedPixels(app)).toBeGreaterThan(1_000);
  await app.locator(".canvas").screenshot({ path: "output/xdraw-logo-browser.png" });
  const scene = await downloadDrawing(page, app);
  expect(scene.elements.filter((element: { type: string }) => element.type === "freedraw")).toHaveLength(6);
  expect(scene.elements.some((element: { id: string; text?: string }) => (
    element.id === "wordmark" && element.text === "xdraw"
  ))).toBe(true);
});
