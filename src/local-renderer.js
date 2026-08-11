import { Resvg } from "@resvg/resvg-js";

function escape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function visibleElements(scene, frameId) {
  const visible = (scene.elements ?? []).filter((element) => !element.isDeleted);
  if (!frameId) return visible;
  const selected = visible.filter((element) => element.id === frameId || element.frameId === frameId);
  if (!selected.some((element) => element.id === frameId)) throw new Error(`scene does not contain frame '${frameId}'`);
  return selected;
}

function boundsOf(elements) {
  if (!elements.length) return { x: 0, y: 0, width: 1, height: 1 };
  const left = Math.min(...elements.map((item) => item.x ?? 0));
  const top = Math.min(...elements.map((item) => item.y ?? 0));
  const right = Math.max(...elements.map((item) => (item.x ?? 0) + Math.max(item.width ?? 0, 1)));
  const bottom = Math.max(...elements.map((item) => (item.y ?? 0) + Math.max(item.height ?? 0, 1)));
  return { x: left, y: top, width: Math.max(right - left, 1), height: Math.max(bottom - top, 1) };
}

function dash(element) {
  if (element.strokeStyle === "dashed") return ' stroke-dasharray="12 8"';
  if (element.strokeStyle === "dotted") return ' stroke-dasharray="3 6"';
  return "";
}

function shapeStyle(element) {
  const fill = element.backgroundColor && element.backgroundColor !== "transparent" ? element.backgroundColor : "none";
  return `fill="${escape(fill)}" stroke="${escape(element.strokeColor ?? "#1f2937")}" stroke-width="${element.strokeWidth ?? 1}"${dash(element)} opacity="${(element.opacity ?? 100) / 100}"`;
}

function transform(element) {
  if (!element.angle) return "";
  const cx = (element.x ?? 0) + (element.width ?? 0) / 2;
  const cy = (element.y ?? 0) + (element.height ?? 0) / 2;
  return ` transform="rotate(${element.angle * 180 / Math.PI} ${cx} ${cy})"`;
}

function renderText(element) {
  const lines = String(element.text ?? "").split("\n");
  const fontSize = element.fontSize ?? 18;
  const lineHeight = fontSize * (element.lineHeight ?? 1.25);
  const alignment = element.textAlign ?? "left";
  const anchor = alignment === "center" ? "middle" : alignment === "right" ? "end" : "start";
  const x = (element.x ?? 0) + (alignment === "center" ? (element.width ?? 0) / 2 : alignment === "right" ? (element.width ?? 0) : 0);
  const family = element.fontFamily === 3
    ? "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    : element.fontFamily === 1 ? "Virgil, Comic Sans MS, cursive" : "Arial, sans-serif";
  const spans = lines.map((line, index) => (
    `<tspan x="${x}" dy="${index === 0 ? fontSize : lineHeight}">${escape(line)}</tspan>`
  )).join("");
  return `<text x="${x}" y="${element.y ?? 0}" text-anchor="${anchor}" font-family="${escape(family)}" font-size="${fontSize}" fill="${escape(element.strokeColor ?? "#1f2937")}" opacity="${(element.opacity ?? 100) / 100}"${transform(element)}>${spans}</text>`;
}

function linearPoints(element) {
  return (element.points ?? []).map(([x, y]) => `${(element.x ?? 0) + x},${(element.y ?? 0) + y}`).join(" ");
}

function renderElement(element, files) {
  const x = element.x ?? 0;
  const y = element.y ?? 0;
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  const style = shapeStyle(element);
  const rotation = transform(element);
  if (element.type === "text") return renderText(element);
  if (element.type === "rectangle") {
    const radius = element.roundness ? Math.min(8, width / 8, height / 8) : 0;
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" ${style}${rotation}/>`;
  }
  if (element.type === "frame") {
    return `<g${rotation}><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="${escape(element.strokeColor ?? "#94a3b8")}" stroke-width="${element.strokeWidth ?? 1}"/><text x="${x + 8}" y="${y + 20}" font-family="Arial, sans-serif" font-size="14" fill="${escape(element.strokeColor ?? "#64748b")}">${escape(element.name ?? "")}</text></g>`;
  }
  if (element.type === "ellipse") {
    return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" ${style}${rotation}/>`;
  }
  if (element.type === "diamond") {
    const points = `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`;
    return `<polygon points="${points}" ${style}${rotation}/>`;
  }
  if (["arrow", "line", "freedraw"].includes(element.type)) {
    const markerStart = element.startArrowhead ? ' marker-start="url(#arrow-start)"' : "";
    const markerEnd = element.endArrowhead ? ' marker-end="url(#arrow-end)"' : "";
    return `<polyline points="${linearPoints(element)}" fill="none" stroke="${escape(element.strokeColor ?? "#1f2937")}" stroke-width="${element.strokeWidth ?? 1}"${dash(element)}${markerStart}${markerEnd} opacity="${(element.opacity ?? 100) / 100}"${rotation}/>`;
  }
  if (element.type === "image") {
    const href = files?.[element.fileId]?.dataURL;
    return href ? `<image x="${x}" y="${y}" width="${width}" height="${height}" href="${escape(href)}"${rotation}/>` : "";
  }
  return "";
}

export function renderSceneSvg(scene, { frameId, padding = 40, maxWidth } = {}) {
  if (!Number.isFinite(padding) || padding < 0) throw new Error("padding must be a non-negative number");
  const elements = visibleElements(scene, frameId);
  const content = boundsOf(elements);
  const naturalWidth = content.width + padding * 2;
  const naturalHeight = content.height + padding * 2;
  const width = maxWidth ? Math.min(maxWidth, naturalWidth) : naturalWidth;
  const height = naturalHeight * width / naturalWidth;
  const background = scene.appState?.viewBackgroundColor ?? "#ffffff";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="0 0 ${naturalWidth} ${naturalHeight}">
  <defs>
    <marker id="arrow-end" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke"/></marker>
    <marker id="arrow-start" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M9,0 L9,6 L0,3 z" fill="context-stroke"/></marker>
  </defs>
  <rect width="100%" height="100%" fill="${escape(background)}"/>
  <g transform="translate(${padding - content.x} ${padding - content.y})">
    ${elements.map((element) => renderElement(element, scene.files)).join("\n    ")}
  </g>
</svg>`;
}

export function renderScenePng(scene, options = {}) {
  const svg = renderSceneSvg(scene, options);
  return new Resvg(svg).render().asPng();
}
