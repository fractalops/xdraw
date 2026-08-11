import { writeFile } from "node:fs/promises";

export async function writeDrawing(drawing, path) {
  const payload = `${JSON.stringify(drawing.toJSON(), null, 2)}\n`;
  await writeFile(path, payload, "utf8");
  return path;
}
