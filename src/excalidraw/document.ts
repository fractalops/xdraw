import { hasValidFreedrawPoints, hasValidFreedrawPressures } from "./freedraw-policy.ts";
import type { Diagnostic, EmbeddedAssetFiles } from "../contracts/foundation.ts";
import type { CompilationMeasurements } from "../contracts/measurements.ts";
import type {
  DrawingAppState,
  DrawingElement,
  DrawingElementInput,
  DrawingJson,
  DrawingOptions,
  LinearElement,
  TextElement,
} from "../contracts/render.ts";

function isElementCollection(
  input: DrawingElementInput,
): input is readonly DrawingElementInput[] {
  return Array.isArray(input);
}

function appendElements(input: DrawingElementInput, result: DrawingElement[]): void {
  if (input === null || input === undefined || input === false) return;
  if (isElementCollection(input)) {
    input.forEach((element) => appendElements(element, result));
    return;
  }
  result.push(input);
}

function flatten(elements: readonly DrawingElementInput[]): DrawingElement[] {
  const result: DrawingElement[] = [];
  elements.forEach((element) => appendElements(element, result));
  return result;
}

function isTextElement(element: DrawingElement): element is TextElement {
  return element.type === "text";
}

function isLinearElement(element: DrawingElement): element is LinearElement {
  return element.type === "arrow" || element.type === "line";
}

function unsupportedElement(): never {
  throw new Error("unsupported drawing element type");
}

export class Drawing {
  elements: DrawingElement[];
  files: EmbeddedAssetFiles;
  appState: DrawingAppState;
  readonly diagnostics!: Diagnostic[];
  readonly measurements!: CompilationMeasurements | null;
  readonly syntaxHighlighting!: boolean;
  highlightRunsUsed!: number;

  constructor(options: DrawingOptions = {}) {
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
      measurements: { value: options.measurements ?? null, writable: true, enumerable: false },
      syntaxHighlighting: { value: options.syntaxHighlighting ?? false, enumerable: false },
      highlightRunsUsed: { value: 0, writable: true, enumerable: false },
    });
  }

  withMeasurements(measurements: CompilationMeasurements): this {
    Object.defineProperty(this, "measurements", { value: measurements, writable: true, enumerable: false });
    return this;
  }

  add(...elements: DrawingElementInput[]): this {
    this.elements.push(...flatten(elements));
    return this;
  }

  validate(): this {
    const ids = new Set<string>();
    for (const element of this.elements) {
      if (!element.id) throw new Error("every element must have an id");
      if (ids.has(element.id)) throw new Error(`duplicate element id: ${element.id}`);
      ids.add(element.id);
      if (![element.x, element.y, element.width, element.height].every(Number.isFinite)) {
        throw new Error(`element ${element.id} has invalid geometry`);
      }
      switch (element.type) {
        case "image":
          if (!this.files[element.fileId] || this.files[element.fileId].id !== element.fileId) {
            throw new Error(`image ${element.id} references missing embedded file ${element.fileId}`);
          }
          if (!(element.width > 0) || !(element.height > 0)) {
            throw new Error(`element ${element.id} must have positive width and height`);
          }
          break;
        case "diamond":
        case "ellipse":
        case "frame":
        case "rectangle":
          if (!(element.width > 0) || !(element.height > 0)) {
            throw new Error(`element ${element.id} must have positive width and height`);
          }
          break;
        case "freedraw":
          if (!hasValidFreedrawPoints(element.points)) {
            throw new Error(`freedraw ${element.id} has invalid points`);
          }
          if (!hasValidFreedrawPressures(element.pressures, element.points.length)) {
            throw new Error(`freedraw ${element.id} has invalid pressures`);
          }
          if (typeof element.simulatePressure !== "boolean") {
            throw new Error(`freedraw ${element.id} has invalid simulatePressure`);
          }
          break;
        case "arrow":
        case "line":
        case "text":
          break;
        default:
          unsupportedElement();
      }
    }
    const byId = new Map(this.elements.map((element) => [element.id, element]));
    for (const element of this.elements) {
      if (element.frameId) {
        const parent = byId.get(element.frameId);
        if (!parent || parent.type !== "frame") {
          throw new Error(`element ${element.id} belongs to unknown frame ${element.frameId}`);
        }
        if (element.id === element.frameId) throw new Error(`frame ${element.id} cannot contain itself`);
      }
      if (isTextElement(element) && element.containerId) {
        const container = byId.get(element.containerId);
        if (!container) throw new Error(`text ${element.id} binds to unknown container ${element.containerId}`);
        if (!(container.boundElements ?? []).some((item) => item.type === "text" && item.id === element.id)) {
          throw new Error(`text ${element.id} is not registered by container ${element.containerId}`);
        }
      }
      if (!isLinearElement(element)) continue;
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
    for (const element of this.elements) {
      if (element.type !== "frame") continue;
      const ancestors = new Set([element.id]);
      let parentId = element.frameId;
      while (parentId) {
        if (ancestors.has(parentId)) {
          throw new Error(`frame ${element.id} has cyclic frame membership`);
        }
        ancestors.add(parentId);
        const parent = byId.get(parentId);
        parentId = parent?.frameId ?? null;
      }
    }
    return this;
  }

  orderFrames(): this {
    const byFrame = Map.groupBy(
      this.elements.filter((element) => element.frameId),
      (element) => element.frameId,
    );
    const ordered: DrawingElement[] = [];
    const emitted = new Set<string>();
    const emit = (element: DrawingElement): void => {
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

  toJSON(): DrawingJson {
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
