import { Constraint, Expression, Operator, Solver, Strength, Variable } from "@lume/kiwi";

import { alignBounds, distributeBounds } from "../geometry.ts";
import type {
  LinearGeometryExpression,
  LinearGeometryTerm,
  RelativePositionConstraint,
} from "../language/relative-position.ts";
import type { Bounds } from "../contracts/foundation.ts";
import type { LayoutFlow } from "../contracts/layout.ts";
import type { RenderableGeometryStatement } from "../contracts/semantic.ts";

interface BoxVariables {
  x: Variable;
  y: Variable;
  width: Variable;
  height: Variable;
}

type ExpressionPart = number | Variable | Expression | readonly [number, Variable | Expression];

export interface ConstraintLayoutRelations {
  containers: readonly string[];
  membership: ReadonlyMap<string, string>;
  flows: readonly LayoutFlow[];
  envelopes?: ReadonlyMap<string, GeometryEnvelope>;
  containmentTargets?: ReadonlySet<string>;
}

export interface GeometryEnvelope {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const EMPTY_ENVELOPE: GeometryEnvelope = Object.freeze({ left: 0, right: 0, top: 0, bottom: 0 });

function isWeighted(part: ExpressionPart): part is readonly [number, Variable | Expression] {
  return Array.isArray(part);
}

function expression(...parts: readonly ExpressionPart[]): Expression {
  return parts.reduce<Expression>((result, part) => {
    if (isWeighted(part)) return result.plus(new Expression(part[1]).multiply(part[0]));
    return result.plus(part);
  }, new Expression());
}

function horizontal(box: BoxVariables, part: "left" | "center-x" | "right"): Expression {
  if (part === "left") return expression(box.x);
  if (part === "right") return expression(box.x, box.width);
  return expression(box.x, [0.5, box.width]);
}

function vertical(box: BoxVariables, part: "top" | "center-y" | "bottom"): Expression {
  if (part === "top") return expression(box.y);
  if (part === "bottom") return expression(box.y, box.height);
  return expression(box.y, [0.5, box.height]);
}

function geometryTerm(term: LinearGeometryTerm, boxFor: (id: string) => BoxVariables): Expression {
  const box = boxFor(term.element);
  let value: Expression;
  switch (term.part) {
    case "left": value = expression(box.x); break;
    case "right": value = expression(box.x, box.width); break;
    case "top": value = expression(box.y); break;
    case "bottom": value = expression(box.y, box.height); break;
    case "width": value = expression(box.width); break;
    case "height": value = expression(box.height); break;
  }
  return value.multiply(term.coefficient);
}

function geometryExpression(
  value: LinearGeometryExpression,
  boxFor: (id: string) => BoxVariables,
): Expression {
  return value.terms.reduce(
    (result, term) => result.plus(geometryTerm(term, boxFor)),
    expression(value.constant),
  );
}

export class ConstraintLayoutError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "XDrawConstraintLayoutError";
  }
}

function statementKey(statement: RenderableGeometryStatement): string {
  return JSON.stringify(statement);
}

function required(solver: Solver, left: Expression | Variable, right: Expression | Variable | number): void {
  solver.addConstraint(new Constraint(left, Operator.Eq, right, Strength.required));
}

const LAYOUT_COHESION = Strength.create(10, 0, 0);

function prefer(solver: Solver, left: Expression | Variable, right: Expression | Variable | number): void {
  solver.addConstraint(new Constraint(left, Operator.Eq, right, LAYOUT_COHESION));
}

function atLeast(solver: Solver, left: Expression | Variable, right: Expression | Variable | number): void {
  solver.addConstraint(new Constraint(left, Operator.Ge, right, Strength.required));
}

function atMost(solver: Solver, left: Expression | Variable, right: Expression | Variable | number): void {
  solver.addConstraint(new Constraint(left, Operator.Le, right, Strength.required));
}

function initialBounds(initial: ReadonlyMap<string, Bounds>, id: string): Bounds {
  const bounds = initial.get(id);
  if (!bounds) throw new ConstraintLayoutError(`constraint references unplaced node: ${id}`);
  return bounds;
}

function createVariables(
  solver: Solver,
  initial: ReadonlyMap<string, Bounds>,
  ids: readonly string[],
): Map<string, BoxVariables> {
  const variables = new Map<string, BoxVariables>();
  for (const id of ids) {
    const bounds = initialBounds(initial, id);
    const box = {
      x: new Variable(`${id}.x`), y: new Variable(`${id}.y`),
      width: new Variable(`${id}.width`), height: new Variable(`${id}.height`),
    };
    variables.set(id, box);
    for (const [variable, value] of [
      [box.x, bounds.x], [box.y, bounds.y],
      [box.width, bounds.width], [box.height, bounds.height],
    ] as const) {
      solver.addEditVariable(variable, Strength.strong);
      solver.suggestValue(variable, value);
    }
    solver.addConstraint(new Constraint(box.width, Operator.Ge, 1));
    solver.addConstraint(new Constraint(box.height, Operator.Ge, 1));
  }
  return variables;
}

function addAlignment(
  solver: Solver,
  initial: ReadonlyMap<string, Bounds>,
  statement: Extract<RenderableGeometryStatement, { type: "alignment" }>,
  boxes: readonly BoxVariables[],
  fixed: ReadonlySet<string>,
): void {
  const aligned = alignBounds(statement.ids.map((id) => initialBounds(initial, id)), statement.mode);
  const fixedIndex = statement.ids.findIndex((id) => fixed.has(id));
  const reference = fixedIndex >= 0 ? initialBounds(initial, statement.ids[fixedIndex]) : aligned[0];
  if (statement.mode === "left" || statement.mode === "center-x" || statement.mode === "right") {
    const anchor = statement.mode === "left" ? reference.x
      : statement.mode === "right" ? reference.x + reference.width
        : reference.x + reference.width / 2;
    for (const box of boxes) required(solver, horizontal(box, statement.mode), anchor);
    return;
  }
  const anchor = statement.mode === "top" ? reference.y
    : statement.mode === "bottom" ? reference.y + reference.height
      : reference.y + reference.height / 2;
  for (const box of boxes) required(solver, vertical(box, statement.mode), anchor);
}

function addDistribution(
  solver: Solver,
  initial: ReadonlyMap<string, Bounds>,
  statement: Extract<RenderableGeometryStatement, { type: "distribution" }>,
  boxes: readonly BoxVariables[],
): void {
  if (boxes.length <= 2) return;
  const distributed = distributeBounds(statement.ids.map((id) => initialBounds(initial, id)), statement.axis);
  const axis = statement.axis === "x" ? "x" : "y";
  const size = statement.axis === "x" ? "width" : "height";
  required(solver, boxes[0][axis], distributed[0][axis]);
  required(
    solver,
    expression(boxes.at(-1)![axis], boxes.at(-1)![size]),
    distributed.at(-1)![axis] + distributed.at(-1)![size],
  );
  const firstGap = expression(boxes[1][axis], [-1, boxes[0][axis]], [-1, boxes[0][size]]);
  for (let index = 1; index < boxes.length - 1; index += 1) {
    const gap = expression(boxes[index + 1][axis], [-1, boxes[index][axis]], [-1, boxes[index][size]]);
    required(solver, gap, firstGap);
  }
}

function addOffset(
  solver: Solver,
  initial: ReadonlyMap<string, Bounds>,
  statement: Extract<RenderableGeometryStatement, { type: "offset" }>,
  boxFor: (id: string) => BoxVariables,
): void {
  for (const id of statement.ids) {
    const box = boxFor(id);
    const bounds = initialBounds(initial, id);
    required(solver, box.x, bounds.x + statement.by[0]);
    required(solver, box.y, bounds.y + statement.by[1]);
  }
}

function addMatchSize(
  solver: Solver,
  initial: ReadonlyMap<string, Bounds>,
  statement: Extract<RenderableGeometryStatement, { type: "match-size" }>,
  boxes: readonly BoxVariables[],
): void {
  const referenceBounds = initialBounds(initial, statement.ids[0]);
  for (const box of boxes) {
    if (statement.axis !== "height") required(solver, box.width, referenceBounds.width);
    if (statement.axis !== "width") required(solver, box.height, referenceBounds.height);
  }
}

function addSnap(
  solver: Solver,
  initial: ReadonlyMap<string, Bounds>,
  statement: Extract<RenderableGeometryStatement, { type: "snap" }>,
  boxFor: (id: string) => BoxVariables,
): void {
  for (const id of statement.ids) {
    const box = boxFor(id);
    const bounds = initialBounds(initial, id);
    required(solver, box.x, Math.round(bounds.x / statement.grid) * statement.grid);
    required(solver, box.y, Math.round(bounds.y / statement.grid) * statement.grid);
  }
}

function addStatement(
  solver: Solver,
  initial: ReadonlyMap<string, Bounds>,
  statement: RenderableGeometryStatement,
  boxFor: (id: string) => BoxVariables,
  fixed: ReadonlySet<string>,
): void {
  const boxes = statement.ids.map(boxFor);
  switch (statement.type) {
    case "alignment": addAlignment(solver, initial, statement, boxes, fixed); break;
    case "distribution": addDistribution(solver, initial, statement, boxes); break;
    case "offset": addOffset(solver, initial, statement, boxFor); break;
    case "match-size": addMatchSize(solver, initial, statement, boxes); break;
    case "snap": addSnap(solver, initial, statement, boxFor); break;
  }
}

function addRelativePosition(
  solver: Solver,
  placement: RelativePositionConstraint,
  boxFor: (id: string) => BoxVariables,
): void {
  const target = boxFor(placement.id);
  required(solver, target.x, geometryExpression(placement.x, boxFor));
  required(solver, target.y, geometryExpression(placement.y, boxFor));
}

function flowFlexibleAxes(flows: readonly LayoutFlow[]): Map<string, Set<"x" | "y">> {
  const result = new Map<string, Set<"x" | "y">>();
  for (const flow of flows) {
    for (const id of flow.after) {
      const axes = result.get(id) ?? new Set<"x" | "y">();
      axes.add(flow.axis);
      result.set(id, axes);
    }
  }
  return result;
}

function positionTargets(
  statements: readonly RenderableGeometryStatement[],
  placements: readonly RelativePositionConstraint[],
): Set<string> {
  return new Set([
    ...placements.map((placement) => placement.id),
    ...statements.flatMap((statement) => (
      statement.type === "match-size" ? [] : [...statement.ids]
    )),
  ]);
}

function sizeTargets(statements: readonly RenderableGeometryStatement[]): {
  width: Set<string>;
  height: Set<string>;
} {
  const width = new Set<string>();
  const height = new Set<string>();
  for (const statement of statements) {
    if (statement.type !== "match-size") continue;
    if (statement.axis !== "height") statement.ids.forEach((id) => width.add(id));
    if (statement.axis !== "width") statement.ids.forEach((id) => height.add(id));
  }
  return { width, height };
}

function childrenByContainer(
  membership: ReadonlyMap<string, string>,
  ids: ReadonlySet<string>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [child, parent] of membership) {
    if (!ids.has(child) || !ids.has(parent)) continue;
    const children = result.get(parent) ?? [];
    children.push(child);
    result.set(parent, children);
  }
  return result;
}

interface ContainerRelationContext {
  solver: Solver,
  initial: ReadonlyMap<string, Bounds>,
  layout: ConstraintLayoutRelations,
  boxFor: (id: string) => BoxVariables,
  ids: ReadonlySet<string>,
  containers: ReadonlySet<string>;
  position: ReadonlySet<string>;
  sizes: { width: ReadonlySet<string>; height: ReadonlySet<string> };
  flexible: ReadonlyMap<string, ReadonlySet<"x" | "y">>;
}

function constrainElementSizes(context: ContainerRelationContext): void {
  for (const id of context.ids) {
    const box = context.boxFor(id);
    const bounds = initialBounds(context.initial, id);
    if (context.containers.has(id)) {
      atLeast(context.solver, box.width, bounds.width);
      atLeast(context.solver, box.height, bounds.height);
    } else {
      if (!context.sizes.width.has(id)) required(context.solver, box.width, bounds.width);
      if (!context.sizes.height.has(id)) required(context.solver, box.height, bounds.height);
    }
  }
}

function anchorRootContainers(context: ContainerRelationContext): void {
  const owned = new Set(context.layout.membership.keys());
  for (const id of context.containers) {
    if (owned.has(id)) continue;
    const box = context.boxFor(id);
    const bounds = initialBounds(context.initial, id);
    const axes = context.flexible.get(id);
    if (!axes?.has("x")) required(context.solver, box.x, bounds.x);
    if (!axes?.has("y")) required(context.solver, box.y, bounds.y);
  }
}

function preserveLayoutCohesion(context: ContainerRelationContext): void {
  for (const [childId, parentId] of context.layout.membership) {
    if (!context.ids.has(childId) || !context.ids.has(parentId)) continue;
    const child = context.boxFor(childId);
    const parent = context.boxFor(parentId);
    const childBounds = initialBounds(context.initial, childId);
    const parentBounds = initialBounds(context.initial, parentId);
    const axes = context.flexible.get(childId);
    if (!context.position.has(childId) && !axes?.has("x")) {
      prefer(context.solver, expression(child.x, [-1, parent.x]), childBounds.x - parentBounds.x);
    }
    if (!context.position.has(childId) && !axes?.has("y")) {
      prefer(context.solver, expression(child.y, [-1, parent.y]), childBounds.y - parentBounds.y);
    }
  }
}

function preserveContainerInsets(context: ContainerRelationContext): void {
  const children = childrenByContainer(context.layout.membership, context.ids);
  for (const [parentId, childIds] of children) {
    const parent = context.boxFor(parentId);
    const parentBounds = initialBounds(context.initial, parentId);
    const containedIds = childIds.filter((id) => {
      if (context.layout.containmentTargets && !context.layout.containmentTargets.has(id)) return false;
      const bounds = initialBounds(context.initial, id);
      return bounds.x >= parentBounds.x && bounds.y >= parentBounds.y
        && bounds.x + bounds.width <= parentBounds.x + parentBounds.width
        && bounds.y + bounds.height <= parentBounds.y + parentBounds.height;
    });
    if (containedIds.length === 0) continue;
    const childBounds = containedIds.map((id) => {
      const bounds = initialBounds(context.initial, id);
      const envelope = context.layout.envelopes?.get(id) ?? EMPTY_ENVELOPE;
      return {
        id,
        x: bounds.x - envelope.left,
        y: bounds.y - envelope.top,
        width: bounds.width + envelope.left + envelope.right,
        height: bounds.height + envelope.top + envelope.bottom,
      };
    });
    const preserveInsets = context.layout.containmentTargets === undefined;
    const left = preserveInsets
      ? Math.max(0, Math.min(...childBounds.map((item) => item.x)) - parentBounds.x)
      : 0;
    const top = preserveInsets
      ? Math.max(0, Math.min(...childBounds.map((item) => item.y)) - parentBounds.y)
      : 0;
    const right = preserveInsets
      ? Math.max(0, parentBounds.x + parentBounds.width
        - Math.max(...childBounds.map((item) => item.x + item.width)))
      : 0;
    const bottom = preserveInsets
      ? Math.max(0, parentBounds.y + parentBounds.height
        - Math.max(...childBounds.map((item) => item.y + item.height)))
      : 0;
    for (const childId of containedIds) {
      const child = context.boxFor(childId);
      const envelope = context.layout.envelopes?.get(childId) ?? EMPTY_ENVELOPE;
      atLeast(context.solver, child.x, expression(parent.x, left + envelope.left));
      atLeast(context.solver, child.y, expression(parent.y, top + envelope.top));
      atMost(
        context.solver,
        expression(child.x, child.width, envelope.right),
        expression(parent.x, parent.width, -right),
      );
      atMost(
        context.solver,
        expression(child.y, child.height, envelope.bottom),
        expression(parent.y, parent.height, -bottom),
      );
    }
  }
}

function preserveLayoutFlows(context: ContainerRelationContext): void {
  for (const flow of context.layout.flows) {
    for (const beforeId of flow.before) {
      if (!context.ids.has(beforeId)) continue;
      for (const afterId of flow.after) {
        if (!context.ids.has(afterId) || context.position.has(afterId)) continue;
        const before = context.boxFor(beforeId);
        const after = context.boxFor(afterId);
        if (flow.axis === "x") {
          atLeast(
            context.solver,
            after.x,
            expression(before.x, before.width, flow.gap),
          );
        } else {
          atLeast(
            context.solver,
            after.y,
            expression(before.y, before.height, flow.gap),
          );
        }
      }
    }
  }
}

function addContainerRelations(
  solver: Solver,
  initial: ReadonlyMap<string, Bounds>,
  statements: readonly RenderableGeometryStatement[],
  placements: readonly RelativePositionConstraint[],
  layout: ConstraintLayoutRelations,
  boxFor: (id: string) => BoxVariables,
  ids: ReadonlySet<string>,
): void {
  const context: ContainerRelationContext = {
    solver,
    initial,
    layout,
    boxFor,
    ids,
    containers: new Set(layout.containers.filter((id) => ids.has(id))),
    position: positionTargets(statements, placements),
    sizes: sizeTargets(statements),
    flexible: flowFlexibleAxes(layout.flows),
  };
  constrainElementSizes(context);
  anchorRootContainers(context);
  preserveLayoutCohesion(context);
  preserveContainerInsets(context);
  preserveLayoutFlows(context);
}

function fixGeometry(
  solver: Solver,
  initial: ReadonlyMap<string, Bounds>,
  fixed: ReadonlySet<string>,
  boxFor: (id: string) => BoxVariables,
  ids: ReadonlySet<string>,
): void {
  for (const id of fixed) {
    if (!ids.has(id)) continue;
    const bounds = initialBounds(initial, id);
    const box = boxFor(id);
    required(solver, box.x, bounds.x);
    required(solver, box.y, bounds.y);
    required(solver, box.width, bounds.width);
    required(solver, box.height, bounds.height);
  }
}

/**
 * Solve precision geometry as one system. Canonical insertion makes the result
 * independent of source declaration order; measured layout remains a strong
 * stay and authored relations are required.
 */
export function solveGeometryConstraints(
  initial: ReadonlyMap<string, Bounds>,
  statements: readonly RenderableGeometryStatement[],
  placements: readonly RelativePositionConstraint[] = [],
  layout?: ConstraintLayoutRelations,
  fixed: ReadonlySet<string> = new Set(),
): ReadonlyMap<string, Bounds> {
  const placementIds = placements.flatMap((placement) => [
    placement.id,
    ...placement.x.terms.map((term) => term.element),
    ...placement.y.terms.map((term) => term.element),
  ]);
  const ids = [...new Set([
    ...statements.flatMap((statement) => [...statement.ids]),
    ...placementIds,
    ...(layout ? [...initial.keys()] : []),
  ])].sort();
  if (!ids.length) return new Map();
  const solver = new Solver();
  const variables = createVariables(solver, initial, ids);

  const boxFor = (id: string): BoxVariables => {
    const box = variables.get(id);
    if (!box) throw new ConstraintLayoutError(`constraint references unplaced node: ${id}`);
    return box;
  };
  try {
    for (const placement of [...placements].sort((left, right) => left.id.localeCompare(right.id))) {
      addRelativePosition(solver, placement, boxFor);
    }
    for (const statement of [...statements].sort((left, right) => statementKey(left).localeCompare(statementKey(right)))) {
      addStatement(solver, initial, statement, boxFor, fixed);
    }
    if (layout) addContainerRelations(solver, initial, statements, placements, layout, boxFor, new Set(ids));
    fixGeometry(solver, initial, fixed, boxFor, new Set(ids));
    solver.updateVariables();
  } catch (error) {
    throw new ConstraintLayoutError("geometry constraints cannot be satisfied together", { cause: error });
  }
  return new Map(ids.map((id) => {
    const box = boxFor(id);
    return [id, { x: box.x.value(), y: box.y.value(), width: box.width.value(), height: box.height.value() }];
  }));
}
