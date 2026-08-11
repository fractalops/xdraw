import { readFile } from "node:fs/promises";

import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { endpointLabelBounds } from "../../src/connector-labels.js";

async function downloadDrawing(page: Page, app: FrameLocator) {
  const pending = page.waitForEvent("download");
  await app.getByRole("button", { name: "Download" }).click();
  const download = await pending;
  const file = await download.path();
  if (!file) throw new Error("download did not produce a local file");
  return JSON.parse(await readFile(file, "utf8"));
}

test("renders reusable components and movable waypoint labels", async ({ page }) => {
  const source = `diagram "Reusable connector" {
    component service(name) { node: system "{name}" }
    use service source [name="Source"]
    use service target [name="Target"]
    source.node.east -> target.node.west "calls" [via="420,180;480,180", start-label="caller", end-label="callee"]
  }`;
  await page.goto(`http://127.0.0.1:4173/host.html?source=${encodeURIComponent(source)}`);
  await expect(page.locator("#status")).toHaveAttribute("data-phase", "ready");
  const app = page.frameLocator("#app");
  const before = await downloadDrawing(page, app);
  const arrow = before.elements.find((item: any) => item.id === "document:connection:0:0");
  const startLabel = before.elements.find((item: any) => item.id === `${arrow.id}:start-label`);
  expect(arrow.points).toHaveLength(4);
  expect(startLabel.groupIds).toEqual(arrow.groupIds);

  await app.locator(".canvas").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ArrowRight");
  const after = await downloadDrawing(page, app);
  expect(after.elements.find((item: any) => item.id === arrow.id).x).toBe(arrow.x + 1);
  expect(after.elements.find((item: any) => item.id === startLabel.id).x).toBe(startLabel.x + 1);

  const target = after.elements.find((item: any) => item.id === "target.node:frame");
  const canvas = await app.locator(".canvas").boundingBox();
  if (!canvas) throw new Error("canvas has no browser bounds");
  const zoom = after.appState.zoom.value;
  const sceneToViewport = (x: number, y: number) => ({
    x: canvas.x + (x + after.appState.scrollX) * zoom,
    y: canvas.y + (y + after.appState.scrollY) * zoom,
  });
  const center = sceneToViewport(target.x + target.width / 2, target.y + target.height / 2);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 60, center.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(750);

  const rerouted = await downloadDrawing(page, app);
  const movedTarget = rerouted.elements.find((item: any) => item.id === target.id);
  const reroutedArrow = rerouted.elements.find((item: any) => item.id === arrow.id);
  const reroutedEndLabel = rerouted.elements.find((item: any) => item.id === `${arrow.id}:end-label`);
  const path = reroutedArrow.points.map(([x, y]: number[]) => [x + reroutedArrow.x, y + reroutedArrow.y]);
  const expected = endpointLabelBounds(reroutedEndLabel.text, path.at(-1), path.at(-2), reroutedEndLabel.fontSize);
  expect(movedTarget.x).toBeGreaterThan(target.x + 20);
  expect(reroutedEndLabel.x).not.toBe(after.elements.find((item: any) => item.id === reroutedEndLabel.id).x);
  expect(reroutedEndLabel.x).toBe(expected.x);
  expect(reroutedEndLabel.y).toBe(expected.y);
});

test("renders an embedded image without network access", async ({ page }) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#2563eb"/></svg>';
  const data = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  const source = `diagram "Offline image" { asset mark "${data}"; image hero mark at (100,100) size (360,180) [alt="Blue mark"] }`;
  await page.goto(`http://127.0.0.1:4173/host.html?source=${encodeURIComponent(source)}`);
  await expect(page.locator("#status")).toHaveAttribute("data-phase", "ready");
  const app = page.frameLocator("#app");
  const drawing = await downloadDrawing(page, app);
  expect(Object.keys(drawing.files)).toHaveLength(1);
  expect(drawing.elements.find((item: any) => item.id === "hero").type).toBe("image");
  await app.locator(".canvas").screenshot({ path: "output/assets-acceptance-preview.png" });
});
