import { expect, test } from "@playwright/test";
import { endpointLabelBounds } from "../../src/connector-labels.js";
import { downloadDrawing, openDiagram } from "./helpers";

test("renders reusable components and movable waypoint labels", async ({ page }) => {
  const source = `use "xdraw/architecture" as arch
  diagram "Reusable connector" {
    service: component(name) { node: arch.system "\${name}" }
    source: service("Source")
    target: service("Target")
    source.node@right -> target.node@left "calls" {
      via ((420, 180), (480, 180))
      start-label "caller"
      end-label "callee"
    }
  }`;
  const app = await openDiagram(page, source);
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
  const source = `diagram "Offline image" {
    mark: asset "${data}"
    hero: image(mark) { at (100, 100); size (360, 180); alt "Blue mark" }
  }`;
  const app = await openDiagram(page, source);
  const drawing = await downloadDrawing(page, app);
  expect(Object.keys(drawing.files)).toHaveLength(1);
  expect(drawing.elements.find((item: any) => item.id === "hero").type).toBe("image");
  await app.locator(".canvas").screenshot({ path: "output/assets-acceptance-preview.png" });
});
