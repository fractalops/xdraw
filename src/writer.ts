import { writeFile } from "node:fs/promises";

import type { Drawing } from "./document.ts";

export async function writeDrawing(drawing: Drawing, path: string): Promise<string> {
  const payload = `${JSON.stringify(drawing.toJSON(), null, 2)}\n`;
  await writeFile(path, payload, "utf8");
  return path;
}
