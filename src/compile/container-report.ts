/**
 * Reports what each container reserved against what its contents occupy.
 *
 * A container's height is decided during layout and then thrown away: the
 * emitted scene records where elements ended up and nothing about the room a
 * container set aside for them. A `group` draws no elements at all, so no tool
 * reading the output can see one, which is why the space groups over-reserve
 * went undiagnosed through two rounds of measuring from compiled scenes.
 *
 * `required` deliberately includes the heading band above the first child, so
 * `available - required` is exactly the space left below the last child. A
 * section that reserves a band and draws a heading in it is doing its job; a
 * container that reserves room after its last child is not.
 *
 * Off unless asked for. Every container produces a remark, so a document with
 * sixty of them would bury its warnings, and the message strings are not built
 * at = all when the pass is skipped.
 */
import type { Bounds } from "../contracts/foundation.ts";
import type { DiagnosticCollector } from "../contracts/foundation.ts";
import type { SceneGraph } from "../contracts/layout.ts";

function union(items: readonly Bounds[]): Bounds {
  const x = Math.min(...items.map((item) => item.x));
  const y = Math.min(...items.map((item) => item.y));
  return {
    x,
    y,
    width: Math.max(...items.map((item) => item.x + item.width)) - x,
    height: Math.max(...items.map((item) => item.y + item.height)) - y,
  };
}

export function reportContainerGeometry(state: SceneGraph, diagnostics: DiagnosticCollector): void {
  const children = new Map<string, string[]>();
  for (const [child, parent] of state.containerMembership) {
    const siblings = children.get(parent);
    if (siblings) siblings.push(child);
    else children.set(parent, [child]);
  }
  for (const [id, members] of children) {
    const own = state.bounds.get(id);
    if (!own) continue;
    const placed = members
      .map((member) => state.bounds.get(member))
      .filter((bounds): bounds is Bounds => bounds !== undefined);
    if (!placed.length) continue;
    const content = union(placed);
    const available = Math.round(own.height);
    const required = Math.round(content.y + content.height - own.y);
    diagnostics.remark(
      "XD3001",
      `container '${id}' reserved ${available}px and used ${required}px`
        + ` for ${placed.length} ${placed.length === 1 ? "child" : "children"}`,
      state.origins.get(id) ?? null,
      { subjects: [id], measures: { available, required } },
    );
  }
}
