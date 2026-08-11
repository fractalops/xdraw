import { alignBounds, distributeBounds } from "./layout.js";

function geometryStatements(statements, result = []) {
  for (const statement of statements) {
    if (["alignment", "distribution", "offset", "match-size", "rotation", "snap"].includes(statement.type)) result.push(statement);
    if (statement.statements) geometryStatements(statement.statements, result);
  }
  return result;
}

function moveSemanticNode(drawing, scene, id, bounds) {
  const previous = scene.bounds.get(id);
  const dx = bounds.x - previous.x;
  const dy = bounds.y - previous.y;
  updateSceneBounds(scene, id, bounds);
  for (const element of drawing.elements) {
    if (element.id.startsWith(`${id}:`)) {
      element.x += dx;
      element.y += dy;
    }
  }
}

function updateSceneBounds(scene, id, bounds) {
  scene.bounds.set(id, bounds);
  const record = scene.objects.get(id);
  if (record) record.bounds = bounds;
}

function elementAabb(element) {
  const cosine = Math.abs(Math.cos(element.angle));
  const sine = Math.abs(Math.sin(element.angle));
  const width = element.width * cosine + element.height * sine;
  const height = element.width * sine + element.height * cosine;
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

function unionBounds(bounds) {
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function transformSemanticNode(drawing, scene, id, next) {
  const previous = scene.bounds.get(id);
  const scaleX = previous.width ? next.width / previous.width : 1;
  const scaleY = previous.height ? next.height / previous.height : 1;
  updateSceneBounds(scene, id, next);
  for (const element of drawing.elements) {
    if (!element.id.startsWith(`${id}:`)) continue;
    element.x = next.x + (element.x - previous.x) * scaleX;
    element.y = next.y + (element.y - previous.y) * scaleY;
    element.width *= scaleX;
    element.height *= scaleY;
  }
}

function rotateSemanticNode(drawing, scene, id, radians) {
  const previous = scene.bounds.get(id);
  const centerX = previous.x + previous.width / 2;
  const centerY = previous.y + previous.height / 2;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const elements = drawing.elements.filter((element) => element.id.startsWith(`${id}:`));
  for (const element of elements) {
    const elementCenterX = element.x + element.width / 2;
    const elementCenterY = element.y + element.height / 2;
    const dx = elementCenterX - centerX;
    const dy = elementCenterY - centerY;
    const rotatedCenterX = centerX + dx * cosine - dy * sine;
    const rotatedCenterY = centerY + dx * sine + dy * cosine;
    element.x = rotatedCenterX - element.width / 2;
    element.y = rotatedCenterY - element.height / 2;
    element.angle += radians;
  }
  updateSceneBounds(scene, id, unionBounds(elements.map(elementAabb)));
}

export function applyGeometryStatements(drawing, scene, statements) {
  for (const statement of geometryStatements(statements)) {
    const bounds = statement.ids.map((id) => scene.bounds.get(id));
    if (statement.type === "alignment" || statement.type === "distribution") {
      const resolved = statement.type === "alignment"
        ? alignBounds(bounds, statement.mode)
        : distributeBounds(bounds, statement.axis);
      statement.ids.forEach((id, index) => moveSemanticNode(drawing, scene, id, resolved[index]));
    } else if (statement.type === "offset") {
      statement.ids.forEach((id, index) => moveSemanticNode(drawing, scene, id, {
        ...bounds[index], x: bounds[index].x + statement.by[0], y: bounds[index].y + statement.by[1],
      }));
    } else if (statement.type === "match-size") {
      const reference = bounds[0];
      statement.ids.forEach((id, index) => transformSemanticNode(drawing, scene, id, {
        ...bounds[index],
        width: statement.axis === "height" ? bounds[index].width : reference.width,
        height: statement.axis === "width" ? bounds[index].height : reference.height,
      }));
    } else if (statement.type === "rotation") {
      const radians = statement.degrees * Math.PI / 180;
      statement.ids.forEach((id) => rotateSemanticNode(drawing, scene, id, radians));
    } else if (statement.type === "snap") {
      statement.ids.forEach((id, index) => moveSemanticNode(drawing, scene, id, {
        ...bounds[index],
        x: Math.round(bounds[index].x / statement.grid) * statement.grid,
        y: Math.round(bounds[index].y / statement.grid) * statement.grid,
      }));
    }
  }
}
