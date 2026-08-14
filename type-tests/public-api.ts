import {
  BUILTIN_LAYOUT_CAPABILITIES,
  DiagnosticError,
  Drawing,
  EXCALIDRAW_API_URL,
  ExcalidrawApiClient,
  FONT,
  LAYERED_LAYOUT,
  LAYERED_LAYOUT_CAPABILITIES,
  MemoryFileSystem,
  RootedFileSystem,
  alignBounds,
  arrow,
  assertLayoutCapabilities,
  boundText,
  box,
  buildSemanticIR,
  card,
  collectLayoutRequirements,
  column,
  compile,
  compileAsync,
  connect,
  createLayoutAdapter,
  createMeasurer,
  createSceneGraph,
  createStyleResolver,
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
  lane,
  layoutWithAdapter,
  listLibraryManifests,
  measureRouteQuality,
  parse,
  parseSceneDocument,
  rectangle,
  renderScenePng,
  renderSceneSvg,
  resolveAssets,
  row,
  synchronizeEndpointLabels,
  text,
  tone,
  validateSemanticDocument,
  wrapText,
  writeDrawing,
  type FontFamily,
  type CompileOptions,
  type AdapterRoute,
  type FileSystem,
  type ArrowElement,
  type LineElement,
  type LinearElementOptions,
  type CardOptions,
  type ConnectOptions,
  type ConnectorPath,
  type EndpointLabelSynchronization,
  type ResolvedNodeStyle,
  type RenderableCodeStatement,
  type SceneVisual,
  type RectangleElement,
  type LayoutAdapterDefinition,
  type LibraryManifest,
  type RouteQuality,
} from "xdraw";
import { ExcalidrawApiClient as SubpathClient } from "xdraw/excalidraw-api";

const definition: LayoutAdapterDefinition = {
  name: "custom",
  capabilities: { ...BUILTIN_LAYOUT_CAPABILITIES, edgeRouting: true },
  layoutDocument: ({ options }) => ({ bottom: options.startY, routes: [] }),
};

const adapter = createLayoutAdapter(definition);
const adapterRoute: AdapterRoute = {
  connectionIndex: 0,
  segmentIndex: 0,
  points: [[0, 0], [100, 0]],
};
const fontFamily: FontFamily = 3;
const routeQuality: RouteQuality = measureRouteQuality([[[0, 0], [10, 0]]]);
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
const writeResult: Promise<string> = writeDrawing(drawing, "drawing.excalidraw");
const boldFont: 7 = FONT.bold;
const connectorPath: ConnectorPath = [[0, 0], [100, 0]];
const connectorOptions: ConnectOptions = { points: connectorPath, endArrowhead: "triangle" };
const componentOptions: CardOptions = { title: "Typed card", tone: "info", fontFamily: FONT.normal };
const componentElements = card("typed", box(0, 0, 160, 80), componentOptions);
const connectorElements = connect("typed-edge", box(0, 0, 100, 50), box(200, 0, 100, 50), connectorOptions);
const synchronization: EndpointLabelSynchronization = synchronizeEndpointLabels([...drawing.elements]);
const semantic = buildSemanticIR(parse('diagram "Styled" { item: rectangle "Item" }'));
const compileOptions: CompileOptions = { syntaxHighlighting: false };
const synchronousDrawing: Drawing = compile(semantic, compileOptions);
const asynchronousDrawing: Promise<Drawing> = compileAsync(semantic);
const semanticNode = semantic.statements.find((item) => item.type === "node");
if (!semanticNode) throw new Error("expected node");
const resolvedNodeStyle: ResolvedNodeStyle = createStyleResolver(semantic).resolveNode(semanticNode);
const measurer = createMeasurer(createStyleResolver(semantic));
const measuredNode: number = measurer.measureNode(semanticNode, 240);
// @ts-expect-error Tree measurement accepts tree sections, not ordinary nodes.
measurer.measureTree(semanticNode, 240);
const renderableCode: RenderableCodeStatement = {
  type: "code",
  id: "example",
  value: "const answer = 42;",
  lineNumbers: true,
  highlight: true,
};

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

const invalidRenderableCode: RenderableCodeStatement = {
  type: "code",
  id: "invalid-code",
  value: "plain text",
  // @ts-expect-error Render-ready code blocks require validated boolean flags.
  lineNumbers: "yes",
  highlight: false,
};

const invalidArrowVisual: SceneVisual = {
  type: "arrow",
  id: "invalid-arrow",
  start: [0, 0],
  end: [10, 0],
  // @ts-expect-error Arrow visuals cannot emit line elements.
  options: { type: "line" },
};

const resolvedNodeVisual: SceneVisual = {
  type: "node",
  id: "resolved-node",
  node: semanticNode,
  bounds: { x: 0, y: 0, width: 160, height: 80 },
  style: resolvedNodeStyle,
};

const unresolvedNodeVisual: SceneVisual = {
  type: "node",
  id: "unresolved-node",
  node: semanticNode,
  bounds: { x: 0, y: 0, width: 160, height: 80 },
  // @ts-expect-error Render-ready node visuals require a resolved style.
  style: undefined,
};

const conflictingFrameOwnership: SceneVisual = {
  type: "text",
  id: "owned-text",
  position: [0, 0],
  value: "Owned",
  frameId: "frame",
  // @ts-expect-error Visual ownership comes from SceneVisual.frameId only.
  options: { frameId: "other-frame" },
};

const invalidAdapterRoute: AdapterRoute = {
  connectionIndex: 0,
  // @ts-expect-error Adapter routes require at least two points.
  points: [[0, 0]],
};

void [
  DiagnosticError, Drawing, EXCALIDRAW_API_URL, ExcalidrawApiClient, FONT, LAYERED_LAYOUT,
  LAYERED_LAYOUT_CAPABILITIES,
  MemoryFileSystem, RootedFileSystem, SubpathClient, adapter,
  alignBounds, arrow, assertLayoutCapabilities, boundText, box, buildSemanticIR, card,
  collectLayoutRequirements, column, compile, compileAsync, connect, createMeasurer, createSceneGraph,
  createStyleResolver, diamond, distributeBounds, ellipse, endpointLabelBounds,
  fitTextSize, formatSceneResource, frame, heading, image, inset, lane, layoutWithAdapter,
  getLibraryManifest, listLibraryManifests, libraryManifests, architectureManifest,
  measureRouteQuality, parse, parseSceneDocument, rectangle,
  renderScenePng, renderSceneSvg, resolveAssets, row, synchronizeEndpointLabels, text, tone,
  validateSemanticDocument, wrapText, writeDrawing, customFileSystem, fontFamily, routeQuality,
  boldFont, drawing, flowType, lineType, shapeType, stroke, variableLinear, writeResult,
  adapterRoute, componentElements, connectorElements, connectorPath, invalidAdapterRoute, invalidArrowVisual,
  conflictingFrameOwnership, invalidRenderableCode, renderableCode, resolvedNodeVisual, unresolvedNodeVisual,
  measuredNode, measurer, resolvedNodeStyle, synchronization, compileOptions,
  synchronousDrawing, asynchronousDrawing,
];
