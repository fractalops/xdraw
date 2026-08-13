import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { openDiagram } from "./helpers";

test("renders native connection styles", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const source = await readFile(resolve("examples/connections.xdraw"), "utf8");
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const app = await openDiagram(page, source);
  await expect(app.getByText("Editable diagram")).toBeVisible();
  await page.waitForTimeout(500);
  await app.locator(".canvas").screenshot({ path: "output/connections-preview.png" });

  expect(errors).toEqual([]);
});
