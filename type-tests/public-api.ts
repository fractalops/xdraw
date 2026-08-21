import {
  DiagnosticError,
  Drawing,
  EXCALIDRAW_API_URL,
  ExcalidrawApiClient,
  FONT,
  MemoryFileSystem,
  RootedFileSystem,
  alignBounds,
  arrow,
  boundText,
  box,
  card,
  column,
  compile,
  connect,
  diamond,
  distributeBounds,
  ellipse,
  endpointLabelBounds,
  fitTextSize,
  formatSceneResource,
  frame,
  freedraw,
  getLibraryManifest,
  heading,
  image,
  inset,
  invertLinearValue,
  lane,
  listLibraryManifests,
  measureRouteQuality,
  parse,
  parseSceneDocument,
  planLinearAxis,
  planLinearScale,
  rectangle,
  renderScenePng,
  renderSceneSvg,
  resolveAssets,
  row,
  scaleLinearValue,
  synchronizeEndpointLabels,
  text,
  tone,
  wrapText,
  writeDrawing,
  type FontFamily,
  type CompileOptions,
  type FileSystem,
  type ArrowElement,
  type LineElement,
  type LinearElementOptions,
  type CardOptions,
  type ConnectOptions,
  type ConnectorPath,
  type EndpointLabelSynchronization,
  type RectangleElement,
  type LinearAxisPlan,
  type LinearScalePlan,
  type LibraryManifest,
  type RouteQuality,
  type CompilationMeasurements,
  type MeasurementFormat,
} from "xdraw";
import { ExcalidrawApiClient as SubpathClient } from "xdraw/excalidraw-api";

const fontFamily: FontFamily = 3;
const routeQuality: RouteQuality = measureRouteQuality([[[0, 0], [10, 0]]]);
const linearScale: LinearScalePlan = planLinearScale([0, 100], [0, 400], { count: 5 });
const linearAxis: LinearAxisPlan = planLinearAxis(linearScale, { orientation: "bottom" });
const scaledValue: number = scaleLinearValue(linearScale, 50);
const invertedValue: number = invertLinearValue(linearScale, 200);
const libraryManifests: readonly LibraryManifest[] = listLibraryManifests();
const architectureManifest: LibraryManifest | undefined = getLibraryManifest("xdraw/architecture");
const customFileSystem: FileSystem = {
  async readText() { return ""; },
  async readBinary() { return new Uint8Array(); },
};

const shape: RectangleElement = rectangle("shape", { x: 0, y: 0, width: 120, height: 80 }, {
  strokeStyle: "dashed",
});
const shapeType: "rectangle" = shape.type;
const flow: ArrowElement = arrow("flow", [0, 0], [100, 0], {
  customData: { description: "A public connector" },
});
const flowType: "arrow" = flow.type;
const line: LineElement = arrow("line", [0, 0], [100, 0], { type: "line" });
const lineType: "line" = line.type;
const variableOptions = {} as LinearElementOptions;
const variableLinear = arrow("variable", [0, 0], [100, 0], variableOptions);
const label = text("label", [10, 20], "Label", { fontFamily: FONT.bold });
const stroke = freedraw("stroke", [0, 0], [[0, 0], [10, 10]], {
  pressures: [0.2, 0.8],
});
const drawing = new Drawing({ gridSize: 10, gridStep: 2, gridModeEnabled: true })
  .add(shape, [[flow, false], [line, label]], stroke);
const compilationMeasurements: CompilationMeasurements | null = drawing.measurements;
const measurementFormat: MeasurementFormat = "json";
const writeResult: Promise<string> = writeDrawing(drawing, "drawing.excalidraw");
const boldFont: 7 = FONT.bold;
const connectorPath: ConnectorPath = [[0, 0], [100, 0]];
const connectorOptions: ConnectOptions = { points: connectorPath, endArrowhead: "triangle" };
const componentOptions: CardOptions = { title: "Typed card", tone: "info", fontFamily: FONT.normal };
const componentElements = card("typed", box(0, 0, 160, 80), componentOptions);
const connectorElements = connect("typed-edge", box(0, 0, 100, 50), box(200, 0, 100, 50), connectorOptions);
const synchronization: EndpointLabelSynchronization = synchronizeEndpointLabels([...drawing.elements]);
const parsed = parse('diagram "Styled" { item: rectangle "Item" }');
const compileOptions: CompileOptions = { syntaxHighlighting: false };
const asynchronousDrawing: Promise<Drawing> = compile(parsed, compileOptions);

// @ts-expect-error Stroke styles are a closed Excalidraw vocabulary.
rectangle("invalid", { x: 0, y: 0, width: 10, height: 10 }, { strokeStyle: "wavy" });

// @ts-expect-error Use false to disable roundness; null has ambiguous legacy behavior.
rectangle("ambiguous", { x: 0, y: 0, width: 10, height: 10 }, { roundness: null });

// @ts-expect-error Roundness uses Excalidraw's closed numeric modes.
rectangle("roundness", { x: 0, y: 0, width: 10, height: 10 }, { roundness: { type: 4 } });

// @ts-expect-error Connector paths require at least two points.
connect("short", box(0, 0, 10, 10), box(20, 0, 10, 10), { points: [[0, 0]] });

// @ts-expect-error Tone names are a closed semantic vocabulary.
card("tone", box(0, 0, 10, 10), { tone: "urgent" });

void [
  DiagnosticError, Drawing, EXCALIDRAW_API_URL, ExcalidrawApiClient, FONT,
  MemoryFileSystem, RootedFileSystem, SubpathClient,
  alignBounds, arrow, boundText, box, card,
  column, compile, connect,
  diamond, distributeBounds, ellipse, endpointLabelBounds,
  fitTextSize, formatSceneResource, frame, heading, image, inset, invertLinearValue, lane,
  getLibraryManifest, listLibraryManifests, libraryManifests, architectureManifest,
  measureRouteQuality, parse, parseSceneDocument, planLinearAxis, planLinearScale, rectangle,
  renderScenePng, renderSceneSvg, resolveAssets, row, scaleLinearValue, synchronizeEndpointLabels, text, tone,
  wrapText, writeDrawing, customFileSystem, fontFamily, routeQuality,
  boldFont, drawing, flowType, lineType, shapeType, stroke, variableLinear, writeResult,
  componentElements, connectorElements, connectorPath,
  synchronization, compileOptions,
  linearScale, linearAxis, scaledValue, invertedValue,
  asynchronousDrawing,
  compilationMeasurements, measurementFormat,
];
