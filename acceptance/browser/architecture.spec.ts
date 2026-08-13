import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { downloadDrawing, openDiagram, paintedPixels } from "./helpers";

test("renders the architecture library as editable composite notation", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1800 });
  const source = await readFile(resolve("examples/xdraw-architecture.xdraw"), "utf8");
  const app = await openDiagram(page, source);
  const drawing = await downloadDrawing(page, app);
  const byId = new Map(drawing.elements.map((element: { id: string }) => [element.id, element]));

  expect(byId.get("context.author:head")?.type).toBe("ellipse");
  expect(byId.get("containers.platform.scene:top")?.type).toBe("ellipse");
  expect(byId.get("components.compiler.parser:tab-1")?.type).toBe("rectangle");
  expect(byId.get("containers.platform")?.type).toBe("frame");
  expect(byId.get("components.compiler")?.type).toBe("frame");
  expect(byId.get("deployment.workstation")?.type).toBe("frame");
  expect(byId.get("containers.platform.compiler:frame")?.frameId).toBe("containers.platform");
  expect(await paintedPixels(app)).toBeGreaterThan(10_000);
});
