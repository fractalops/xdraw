import {
  evaluateExpression,
  freeNames,
  parseExpression,
  type ExpressionNode,
} from "./expression.ts";
import { splitAnchorName, splitGeometryName, type BoxPart, type GeometryAnchor } from "./geometry-names.ts";

export interface LinearGeometryTerm {
  element: string;
  part: BoxPart;
  coefficient: number;
}

export interface LinearGeometryExpression {
  constant: number;
  terms: LinearGeometryTerm[];
}

export interface RelativePositionConstraint {
  id: string;
  x: LinearGeometryExpression;
  y: LinearGeometryExpression;
}

export interface LinearPointExpression {
  x: LinearGeometryExpression;
  y: LinearGeometryExpression;
}

export class RelativePositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XDrawRelativePositionError";
  }
}

function constantValue(node: ExpressionNode): number | null {
  if (freeNames(node).size) return null;
  const value = evaluateExpression(node, {});
  return Number.isFinite(value) ? value : null;
}

function scale(expression: LinearGeometryExpression, coefficient: number): LinearGeometryExpression {
  return {
    constant: expression.constant * coefficient,
    terms: expression.terms.map((term) => ({ ...term, coefficient: term.coefficient * coefficient })),
  };
}

function combine(
  left: LinearGeometryExpression,
  right: LinearGeometryExpression,
  coefficient: number,
): LinearGeometryExpression {
  const terms = new Map<string, LinearGeometryTerm>();
  for (const term of [...left.terms, ...scale(right, coefficient).terms]) {
    const key = `${term.element}.${term.part}`;
    const previous = terms.get(key);
    terms.set(key, { ...term, coefficient: term.coefficient + (previous?.coefficient ?? 0) });
  }
  return {
    constant: left.constant + right.constant * coefficient,
    terms: [...terms.values()].filter((term) => term.coefficient !== 0)
      .sort((a, b) => `${a.element}.${a.part}`.localeCompare(`${b.element}.${b.part}`)),
  };
}

function term(element: string, part: BoxPart, coefficient = 1): LinearGeometryExpression {
  return { constant: 0, terms: [{ element, part, coefficient }] };
}

function anchorCoordinates(element: string, anchor: GeometryAnchor): LinearPointExpression {
  const x = anchor.includes("west") ? term(element, "left")
    : anchor.includes("east") ? term(element, "right")
      : combine(term(element, "left"), term(element, "width"), 0.5);
  const y = anchor.startsWith("north") ? term(element, "top")
    : anchor.startsWith("south") ? term(element, "bottom")
      : combine(term(element, "top"), term(element, "height"), 0.5);
  return { x, y };
}

function pointScale(value: LinearPointExpression, coefficient: number): LinearPointExpression {
  return { x: scale(value.x, coefficient), y: scale(value.y, coefficient) };
}

function pointCombine(left: LinearPointExpression, right: LinearPointExpression, coefficient: number): LinearPointExpression {
  return { x: combine(left.x, right.x, coefficient), y: combine(left.y, right.y, coefficient) };
}

function analyzePoint(node: ExpressionNode): LinearPointExpression {
  if (node.kind === "point") return { x: analyze(node.x), y: analyze(node.y) };
  if (node.kind === "name") {
    const reference = splitAnchorName(node.name);
    if (!reference) throw new RelativePositionError(`'${node.name}' is not a placed element anchor`);
    return anchorCoordinates(reference.element, reference.anchor);
  }
  if (node.kind === "negate") return pointScale(analyzePoint(node.operand), -1);
  if (node.kind === "binary") {
    if (node.operator === "+") return pointCombine(analyzePoint(node.left), analyzePoint(node.right), 1);
    if (node.operator === "-") return pointCombine(analyzePoint(node.left), analyzePoint(node.right), -1);
    const left = constantValue(node.left);
    const right = constantValue(node.right);
    if (node.operator === "*" && left !== null) return pointScale(analyzePoint(node.right), left);
    if (node.operator === "*" && right !== null) return pointScale(analyzePoint(node.left), right);
    if (node.operator === "/" && right !== null && right !== 0) return pointScale(analyzePoint(node.left), 1 / right);
  }
  throw new RelativePositionError("relative point positions must use a point, an anchor, and linear arithmetic");
}

function analyze(node: ExpressionNode): LinearGeometryExpression {
  const constant = constantValue(node);
  if (constant !== null) return { constant, terms: [] };
  if (node.kind === "name") {
    const reference = splitGeometryName(node.name);
    if (!reference) {
      throw new RelativePositionError(`'${node.name}' is not a placed element box reference`);
    }
    return { constant: 0, terms: [{ ...reference, coefficient: 1 }] };
  }
  if (node.kind === "call" && (node.name === "x" || node.name === "y") && node.args.length === 1) {
    return analyzePoint(node.args[0])[node.name];
  }
  if (node.kind === "negate") return scale(analyze(node.operand), -1);
  if (node.kind === "binary") {
    if (node.operator === "+") return combine(analyze(node.left), analyze(node.right), 1);
    if (node.operator === "-") return combine(analyze(node.left), analyze(node.right), -1);
    const leftConstant = constantValue(node.left);
    const rightConstant = constantValue(node.right);
    if (node.operator === "*" && leftConstant !== null) return scale(analyze(node.right), leftConstant);
    if (node.operator === "*" && rightConstant !== null) return scale(analyze(node.left), rightConstant);
    if (node.operator === "/" && rightConstant !== null && rightConstant !== 0) {
      return scale(analyze(node.left), 1 / rightConstant);
    }
  }
  throw new RelativePositionError("relative positions must be linear expressions over placed element box parts");
}

/** Analyze one relative coordinate into deterministic, structured-clone-safe linear data. */
export function analyzeRelativeCoordinate(value: number | string): LinearGeometryExpression {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RelativePositionError("relative position coordinate must be finite");
    return { constant: value, terms: [] };
  }
  return analyze(parseExpression(value));
}

/** Analyze a first-class point used to place one element relative to another. */
export function analyzeRelativePoint(value: string): LinearPointExpression {
  return analyzePoint(parseExpression(value));
}
