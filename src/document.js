import { hasValidFreedrawPoints, hasValidFreedrawPressures } from "./freedraw-policy.js";

function flatten(elements) {
  return elements.flat(Infinity).filter(Boolean);
}

export class Drawing {
  constructor(options = {}) {
    this.elements = [];
    this.files = options.files ?? {};
    this.appState = {
      gridSize: options.gridSize ?? 20,
      gridStep: options.gridStep ?? 5,
      gridModeEnabled: options.gridModeEnabled ?? false,
      viewBackgroundColor: options.backgroundColor ?? "#eef2f7",
    };
    Object.defineProperties(this, {
      diagnostics: { value: options.diagnostics ?? [], enumerable: false },
      syntaxHighlighting: { value: options.syntaxHighlighting ?? false, enumerable: false },
      highlightRunsUsed: { value: 0, writable: true, enumerable: false },
    });
  }

  add(...elements) {
    this.elements.push(...flatten(elements));
    return this;
  }

  validate() {
    const ids = new Set();
    for (const element of this.elements) {
      if (!element.id) {
        throw new Error("every element must have an id");
      }
      if (ids.has(element.id)) {
        throw new Error(`duplicate element id: ${element.id}`);
      }
      ids.add(element.id);
      if (![element.x, element.y, element.width, element.height].every(Number.isFinite)) {
        throw new Error(`element ${element.id} has invalid geometry`);
      }
      if (["diamond", "ellipse", "frame", "image", "rectangle"].includes(element.type)
        && (!(element.width > 0) || !(element.height > 0))) {
        throw new Error(`element ${element.id} must have positive width and height`);
      }
      if (element.type === "freedraw") {
        if (!hasValidFreedrawPoints(element.points)) {
          throw new Error(`freedraw ${element.id} has invalid points`);
        }
        if (!hasValidFreedrawPressures(element.pressures, element.points.length)) {
          throw new Error(`freedraw ${element.id} has invalid pressures`);
        }
        if (typeof element.simulatePressure !== "boolean") {
          throw new Error(`freedraw ${element.id} has invalid simulatePressure`);
        }
      }
    }
    const byId = new Map(this.elements.map((element) => [element.id, element]));
    for (const element of this.elements) {
      if (element.frameId) {
        const frame = byId.get(element.frameId);
        if (!frame || frame.type !== "frame") throw new Error(`element ${element.id} belongs to unknown frame ${element.frameId}`);
        if (element.id === element.frameId) throw new Error(`frame ${element.id} cannot contain itself`);
      }
      if (element.type === "text" && element.containerId) {
        const container = byId.get(element.containerId);
        if (!container) throw new Error(`text ${element.id} binds to unknown container ${element.containerId}`);
        if (!(container.boundElements ?? []).some((item) => item.type === "text" && item.id === element.id)) {
          throw new Error(`text ${element.id} is not registered by container ${element.containerId}`);
        }
      }
      if (!["arrow", "line"].includes(element.type)) continue;
      for (const binding of [element.startBinding, element.endBinding]) {
        if (!binding) continue;
        const target = byId.get(binding.elementId);
        if (!target) throw new Error(`element ${element.id} binds to unknown element ${binding.elementId}`);
        const bound = target.boundElements ?? [];
        if (!bound.some((item) => item.id === element.id)) {
          target.boundElements = [...bound, { type: element.type, id: element.id }];
        }
      }
    }
    return this;
  }

  orderFrames() {
    const byFrame = Map.groupBy(this.elements.filter((element) => element.frameId), (element) => element.frameId);
    const ordered = [];
    const emitted = new Set();
    const emit = (element) => {
      if (emitted.has(element.id)) return;
      emitted.add(element.id);
      if (element.type === "frame") {
        for (const child of byFrame.get(element.id) ?? []) emit(child);
      }
      ordered.push(element);
    };
    for (const element of this.elements) {
      if (!element.frameId) emit(element);
    }
    for (const element of this.elements) emit(element);
    this.elements = ordered;
    return this;
  }

  toJSON() {
    this.validate();
    this.orderFrames();
    const hasFrames = this.elements.some((element) => element.type === "frame");
    return {
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: this.elements,
      appState: hasFrames ? {
        ...this.appState,
        frameRendering: { enabled: true, clip: true, name: true, outline: true },
      } : this.appState,
      files: this.files,
    };
  }

}
