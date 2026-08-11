import { parse } from "./parser.js";

function closeBlocks(source) {
  let depth = 0;
  let string = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    if (string === "triple") {
      if (source.startsWith('"""', index)) {
        string = null;
        index += 2;
      }
      continue;
    }
    const char = source[index];
    if (string === "quoted") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') string = null;
      continue;
    }
    if (source.startsWith('"""', index)) {
      string = "triple";
      index += 2;
    } else if (char === '"') string = "quoted";
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    if (depth < 0) return null;
  }
  if (string !== null) return null;
  return `${source}${"}".repeat(depth)}`;
}

export function parsePartial(source) {
  const boundaries = [source.length];
  for (let index = 0; index < source.length; index += 1) {
    if (["\n", ";", "}"].includes(source[index])) boundaries.push(index + 1);
  }
  boundaries.sort((left, right) => right - left);

  for (const end of [...new Set(boundaries)]) {
    const candidate = closeBlocks(source.slice(0, end));
    if (!candidate) continue;
    try {
      const scene = parse(candidate);
      const hasContent = scene.title || scene.statements.some((item) =>
        ["lane", "group", "tree", "sequence", "node", "text"].includes(item.type));
      if (hasContent) return { scene, consumed: end };
    } catch {
      // The final statement in a partial stream is commonly incomplete.
    }
  }
  return null;
}
