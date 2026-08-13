export const SECTION_TYPES = new Set(["code", "frame", "group", "lane", "sequence", "tree"]);

export function childSections(statements) {
  return statements.filter((item) => SECTION_TYPES.has(item.type));
}

export function arrangedItems(statements) {
  return statements.filter((item) => (
    (item.type === "node" && !item.at)
    || item.type === "layout-text"
    || SECTION_TYPES.has(item.type)
  ));
}
