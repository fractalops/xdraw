import type {
  Diagnostic,
  EmbeddedAssetFiles,
  Point,
} from "./foundation-contracts.ts";
import type { FontFamily } from "./text-metrics.ts";

export type StrokeStyle = "solid" | "dashed" | "dotted";
export type FillStyle = "solid" | "hachure" | "cross-hatch";
export type TextAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";
export type Arrowhead =
  | "arrow"
  | "bar"
  | "dot"
  | "circle"
  | "circle_outline"
  | "triangle"
  | "triangle_outline"
  | "diamond"
  | "diamond_outline"
  | "crowfoot_one"
  | "crowfoot_many"
  | "crowfoot_one_or_many";

export interface Roundness {
  type: 1 | 2 | 3;
  value?: number;
}

export interface BoundElement {
  id: string;
  type: "arrow" | "line" | "text";
}

export interface ElementBinding {
  elementId: string;
  focus?: number;
  gap?: number;
  fixedPoint?: Point | null;
}

export interface ElementCustomData {
  description?: string;
  xdrawId?: string;
  xdrawLabelId?: string;
  xdrawEndpointLabels?: Partial<Record<"start" | "end", string>>;
  xdraw?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BaseElement<TType extends string = string> {
  id: string;
  type: TType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  opacity: number;
  groupIds: string[];
  frameId: string | null;
  roundness: Roundness | null;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  boundElements: BoundElement[] | null;
  updated: number;
  link: string | null;
  locked: boolean;
  customData?: ElementCustomData;
}

export type RectangleElement = BaseElement<"rectangle">;
export type DiamondElement = BaseElement<"diamond">;
export type EllipseElement = BaseElement<"ellipse">;

export interface FrameElement extends BaseElement<"frame"> {
  name: string | null;
}

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

export interface ImageElement extends BaseElement<"image"> {
  fileId: string;
  status: "saved";
  scale: Point;
  crop: ImageCrop | null;
}

export interface TextElement extends BaseElement<"text"> {
  fontSize: number;
  fontFamily: FontFamily;
  text: string;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  containerId: string | null;
  originalText: string;
  lineHeight: number;
  autoResize: boolean;
}

export interface LinearElementBase<TType extends "arrow" | "line"> extends BaseElement<TType> {
  points: Point[];
  lastCommittedPoint: Point | null;
  startBinding: ElementBinding | null;
  endBinding: ElementBinding | null;
  startArrowhead: Arrowhead | null;
  endArrowhead: Arrowhead | null;
}

export interface ArrowElement extends LinearElementBase<"arrow"> {
  elbowed: boolean;
  fixedSegments?: null;
  startIsSpecial?: false;
  endIsSpecial?: false;
}

export type LineElement = LinearElementBase<"line">;

export interface FreedrawElement extends BaseElement<"freedraw"> {
  points: Point[];
  pressures: number[];
  simulatePressure: boolean;
  lastCommittedPoint: Point | null;
}

export type ShapeElement = RectangleElement | DiamondElement | EllipseElement;
export type LinearElement = ArrowElement | LineElement;
export type DrawingElement =
  | ShapeElement
  | FrameElement
  | ImageElement
  | TextElement
  | LinearElement
  | FreedrawElement;

export interface BaseElementOptions {
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: FillStyle;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  roughness?: number;
  opacity?: number;
  groupIds?: string[];
  frameId?: string | null;
  roundness?: Roundness | false;
  boundElements?: BoundElement[] | null;
  link?: string | null;
  locked?: boolean;
}

export type ShapeElementOptions = BaseElementOptions;

export interface ImageElementOptions extends BaseElementOptions {
  scale?: Point;
  crop?: ImageCrop | null;
  description?: string;
  customData?: ElementCustomData;
}

export interface TextElementOptions extends BaseElementOptions {
  fontSize?: number;
  fontFamily?: FontFamily;
  lineHeight?: number;
  width?: number;
  height?: number;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  containerId?: string | null;
  autoResize?: boolean;
}

export interface LinearElementOptions extends BaseElementOptions {
  type?: "arrow" | "line";
  points?: readonly Point[];
  startBinding?: ElementBinding | null;
  endBinding?: ElementBinding | null;
  startArrowhead?: Arrowhead | null;
  endArrowhead?: Arrowhead | null;
  elbowed?: boolean;
  fixedSegments?: null;
  customData?: ElementCustomData;
}

export interface FreedrawElementOptions extends BaseElementOptions {
  pressures?: readonly number[];
  simulatePressure?: boolean;
}

export type DrawingElementInput =
  | DrawingElement
  | readonly DrawingElementInput[]
  | null
  | undefined
  | false;

export interface DrawingOptions {
  backgroundColor?: string;
  files?: EmbeddedAssetFiles;
  diagnostics?: Diagnostic[];
  syntaxHighlighting?: boolean;
  gridSize?: number;
  gridStep?: number;
  gridModeEnabled?: boolean;
}

export interface DrawingAppState {
  gridSize: number;
  gridStep: number;
  gridModeEnabled: boolean;
  viewBackgroundColor: string;
  frameRendering?: {
    enabled: true;
    clip: true;
    name: true;
    outline: true;
  };
}

export interface DrawingJson {
  type: "excalidraw";
  version: 2;
  source: "https://excalidraw.com";
  elements: DrawingElement[];
  appState: DrawingAppState;
  files: EmbeddedAssetFiles;
}
