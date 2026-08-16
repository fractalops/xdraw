import type { SourceLocation } from "../contracts/foundation.ts";
import type {
  SourceConnection,
  SourceConstructorCall,
  SourceDeclaration,
  SourceDocument,
  SourceGeometryStatement,
  SourceInvocation,
  SourceNode,
  SourceProperty,
  SourcePropertyValue,
  SourceStatement,
  SourceValueKind,
} from "../contracts/language.ts";
import type { ConstructorArgumentManifest, ConstructorManifest, LibraryManifest, ManifestValueKind } from "./manifests/contracts.ts";
import { BUILTIN_LIBRARY_MANIFESTS } from "./manifests/builtins.ts";
import { CONSTANTS } from "./expression.ts";

export class LanguageValidationError extends Error {
  readonly code: string;
  readonly location: SourceLocation | null;

  constructor(code: string, message: string, node?: SourceNode | null) {
    const location = node?.span?.start ?? null;
    const suffix = location ? ` at line ${location.line}, column ${location.column}` : "";
    super(`${message}${suffix}`);
    this.name = "LanguageValidationError";
    this.code = code;
    this.location = location;
  }
}

interface ResolvedImport {
  readonly alias: string;
  readonly manifest: LibraryManifest;
}

interface DocumentTemplate {
  readonly declaration: SourceDeclaration;
  readonly parameters: readonly string[];
  readonly parameterUses: ReadonlyMap<string, Map<ManifestValueKind, SourceNode>>;
}

interface TemplateInvocation {
  readonly declaration: SourceDeclaration;
  readonly template: DocumentTemplate;
  readonly ownerTemplate: DocumentTemplate | null;
}

interface ResolvedConstructor {
  readonly name: string;
  readonly manifest: ConstructorManifest | null;
  readonly template: DocumentTemplate | null;
}

interface ValidationContext {
  readonly core: LibraryManifest;
  readonly libraries: ReadonlyMap<string, LibraryManifest>;
  readonly imports: ReadonlyMap<string, ResolvedImport>;
  readonly templates: ReadonlyMap<string, DocumentTemplate>;
  readonly templateInvocations: TemplateInvocation[];
}

type ChildStatement = SourceDeclaration | SourceInvocation | SourceConnection | SourceGeometryStatement | Extract<SourceStatement, { type: "arrangement" }>;

const CHILD_STATEMENT_TYPES = new Set([
  "declaration", "invocation", "connection", "arrangement", "alignment", "distribution", "offset", "match-size", "rotation", "snap",
]);

const TEMPLATE_PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/u;
const COMPLETE_PARAMETER_PATTERN = /^\{([A-Za-z_][A-Za-z0-9_-]*)\}$/u;
const INTERPOLATED_PARAMETER_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_-]*)\}/gu;
const TREE_OWNER_KINDS = new Set(["frame", "group", "lane", "section"]);

interface StatementPropertySpecification {
  readonly kind: ManifestValueKind;
  readonly values?: ReadonlySet<string>;
}

function statementProperty(
  kind: ManifestValueKind,
  values?: readonly string[],
): StatementPropertySpecification {
  return { kind, values: values ? new Set(values) : undefined };
}

const CONNECTION_PROPERTIES: ReadonlyMap<string, StatementPropertySpecification> = new Map([
  ["background", statementProperty("string")],
  ["end-label", statementProperty("string")],
  ["fill-style", statementProperty("identifier")],
  ["font-family", statementProperty("identifier")],
  ["font-size", statementProperty("number")],
  ["head", statementProperty("identifier", [
    "none", "arrow", "bar", "dot", "circle", "circle_outline", "triangle", "triangle_outline",
    "diamond", "diamond_outline", "crowfoot_one", "crowfoot_many", "crowfoot_one_or_many",
  ])],
  ["line-height", statementProperty("number")],
  ["link", statementProperty("string")],
  ["locked", statementProperty("boolean")],
  ["opacity", statementProperty("number")],
  ["roughness", statementProperty("number")],
  ["route", statementProperty("identifier", ["auto", "straight", "elbow", "curved", "line"])],
  ["start-label", statementProperty("string")],
  ["stroke", statementProperty("string")],
  ["stroke-style", statementProperty("identifier", ["solid", "dashed"])],
  ["stroke-width", statementProperty("number")],
  ["style", statementProperty("identifier")],
  ["technology", statementProperty("string")],
  ["text-color", statementProperty("string")],
  ["via", statementProperty("points")],
  ["width", statementProperty("number")],
]);

const GAP_PROPERTIES: ReadonlyMap<string, StatementPropertySpecification> = new Map([
  ["gap", statementProperty("number")],
  ["spacing", statementProperty("identifier", ["tight", "normal", "airy"])],
]);

const ARRANGEMENT_PROPERTIES: ReadonlyMap<string, ReadonlyMap<string, StatementPropertySpecification>> = new Map([
  ["compact", new Map([...GAP_PROPERTIES, ["width", statementProperty("number")]])],
  ["grid", new Map([
    ...GAP_PROPERTIES,
    ["columns", statementProperty("number")],
    ["width", statementProperty("number")],
  ])],
  ["layered", new Map([...GAP_PROPERTIES, ["width", statementProperty("number")]])],
  ["row", GAP_PROPERTIES],
  ["column", GAP_PROPERTIES],
  ["tree", new Map([
    ["root", statementProperty("identifier")],
    ["direction", statementProperty("identifier", ["down", "right"])],
    ["level-gap", statementProperty("number")],
    ["sibling-gap", statementProperty("number")],
  ])],
]);

function fail(code: string, message: string, node?: SourceNode | null): never {
  throw new LanguageValidationError(code, message, node);
}

function indexManifests(manifests: readonly LibraryManifest[]): ReadonlyMap<string, LibraryManifest> {
  const result = new Map<string, LibraryManifest>();
  for (const manifest of manifests) {
    if (result.has(manifest.name)) {
      fail("duplicate-library", `library catalog contains duplicate library '${manifest.name}'`);
    }
    result.set(manifest.name, manifest);
  }
  return result;
}

function constructorByName(
  manifest: LibraryManifest,
  name: string,
): ConstructorManifest | undefined {
  return manifest.constructors.find((constructor) => constructor.name === name);
}

function resolveImports(
  document: SourceDocument,
  libraries: ReadonlyMap<string, LibraryManifest>,
  core: LibraryManifest,
): ReadonlyMap<string, ResolvedImport> {
  const imports = new Map<string, ResolvedImport>();
  const coreNames = new Set(core.constructors.map(({ name }) => name));

  for (const sourceImport of document.imports) {
    const manifest = libraries.get(sourceImport.source);
    if (!manifest) {
      fail("unknown-library", `unknown library '${sourceImport.source}'`, sourceImport);
    }
    if (manifest === core) {
      fail("core-import", "xdraw/core constructors are available without an import", sourceImport);
    }
    if (imports.has(sourceImport.alias)) {
      fail("duplicate-import-alias", `duplicate import alias '${sourceImport.alias}'`, sourceImport);
    }
    if (coreNames.has(sourceImport.alias)) {
      fail(
        "import-core-collision",
        `import alias '${sourceImport.alias}' conflicts with core constructor '${sourceImport.alias}'`,
        sourceImport,
      );
    }
    imports.set(sourceImport.alias, { alias: sourceImport.alias, manifest });
  }
  return imports;
}

function documentTemplates(
  document: SourceDocument,
  core: LibraryManifest,
  imports: ReadonlyMap<string, ResolvedImport>,
): ReadonlyMap<string, DocumentTemplate> {
  const templates = new Map<string, DocumentTemplate>();
  const coreNames = new Set(core.constructors.map(({ name }) => name));

  for (const statement of document.diagram.statements) {
    if (statement.type !== "declaration" || statement.constructor !== "template") continue;
    if (statement.id.includes(".")) {
      fail(
        "qualified-template-name",
        `template declaration name '${statement.id}' must be unqualified`,
        statement,
      );
    }
    if (templates.has(statement.id)) {
      fail("duplicate-template", `duplicate template '${statement.id}'`, statement);
    }
    if (coreNames.has(statement.id)) {
      fail(
        "template-core-collision",
        `template '${statement.id}' conflicts with core constructor '${statement.id}'`,
        statement,
      );
    }
    if (imports.has(statement.id)) {
      fail(
        "template-import-collision",
        `template '${statement.id}' conflicts with import alias '${statement.id}'`,
        statement,
      );
    }
    const parameters = statement.arguments.map((value, index) => {
      if (typeof value !== "string"
          || statement.argumentKinds[index] !== "identifier"
          || !TEMPLATE_PARAMETER_NAME_PATTERN.test(value)) {
        fail(
          "invalid-template-parameter",
          `template '${statement.id}' parameter ${index + 1} must be an identifier`,
          statement,
        );
      }
      return value;
    });
    if (new Set(parameters).size !== parameters.length) {
      fail("duplicate-template-parameter", `template '${statement.id}' has duplicate parameters`, statement);
    }
    templates.set(statement.id, {
      declaration: statement,
      parameters: Object.freeze(parameters),
      parameterUses: new Map(parameters.map((parameter) => [parameter, new Map()])),
    });
  }
  return templates;
}


/**
 * The manifests already record which library exports each constructor, so an
 * unresolved name can carry its own fix rather than sending the reader to
 * search. Returns "" when nothing provides the name.
 */
function importHint(constructorName: string, alias?: string): string {
  const providers = BUILTIN_LIBRARY_MANIFESTS.filter((manifest) => (
    manifest.constructors.some((item) => item.name === constructorName)
  ));
  const provider = providers[0];
  if (!provider || providers.length > 1) return "";
  const suggested = alias ?? provider.name.split("/").at(-1) ?? provider.name;
  const importLine = `use "${provider.name}" as ${suggested}`;
  // Without an alias the reader wrote a bare name, so importing is only half
  // the fix: the call has to be qualified as well.
  return alias === undefined
    ? `; add: ${importLine}, then write ${suggested}.${constructorName}`
    : `; add: ${importLine}`;
}


/**
 * Vocabulary a reader brings from CSS or other diagram tools. These are not
 * misspellings, so edit distance finds the wrong answer for them: 'fill' is
 * two edits from 'fit' but one concept away from 'background'.
 */
const PROPERTY_SYNONYMS: Readonly<Record<string, string>> = Object.freeze({
  fill: "background",
  "background-color": "background",
  color: "stroke",
  "stroke-color": "stroke",
  "font-size": "font-size",
  font: "font-family",
  fontfamily: "font-family",
  width: "size (width, height)",
  height: "size (width, height)",
  w: "size (width, height)",
  h: "size (width, height)",
  x: "at (x, y)",
  y: "at (x, y)",
  position: "at (x, y)",
  text: "body",
  label: "body",
  border: "stroke",
  "border-width": "stroke-width",
});

/**
 * Damerau-Levenshtein: like Levenshtein, but a transposition costs one rather
 * than two. Swapped letters are among the most common typos, and 'gird' should
 * read as one keystroke away from 'grid', not two.
 */
function editDistance(left: string, right: string): number {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => (
    [index, ...Array.from({ length: right.length }, () => 0)]
  ));
  for (let column = 0; column <= right.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + substitution,
      );
      if (
        row > 1 && column > 1
        && left[row - 1] === right[column - 2]
        && left[row - 2] === right[column - 1]
      ) {
        rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 1);
      }
    }
  }
  return rows[left.length][right.length];
}

/**
 * Suggests a replacement for an unaccepted property: a known synonym first,
 * then a near-miss typo. Silent when neither is confident, because a wrong
 * suggestion costs more than none.
 */

/**
 * Words a diagram author reaches for that are one or two edits from a real
 * constructor but mean something else. Edit distance cannot separate these:
 * 'node' is one edit from 'code' with a margin of three over the runner-up,
 * and taking that advice compiles cleanly into a code block. Silence is the
 * only honest answer.
 */
const NOT_A_TYPO = new Set([
  "node", "state", "box", "shape", "line", "arrow", "actor", "entity",
  "class", "component", "container", "edge", "link", "label", "cluster",
]);

/**
 * Names the closest candidate when it is close enough to be a typo rather than
 * a guess. Silent otherwise, because a wrong suggestion costs more than none.
 */
function nearestName(typed: string, candidates: Iterable<string>): string {
  if (NOT_A_TYPO.has(typed.toLocaleLowerCase())) return "";
  const ranked = [...candidates]
    .map((candidate) => ({ candidate, distance: editDistance(typed.toLocaleLowerCase(), candidate) }))
    .sort((left, right) => left.distance - right.distance);
  const best = ranked[0];
  if (!best) return "";
  const limit = typed.length <= 4 ? 1 : 2;
  return best.distance <= limit ? `; did you mean '${best.candidate}'?` : "";
}

function propertySuggestion(typed: string, accepted: readonly string[]): string {
  const synonym = PROPERTY_SYNONYMS[typed.toLocaleLowerCase()];
  if (synonym && accepted.includes(synonym.split(" ")[0])) return `; did you mean '${synonym}'?`;
  return nearestName(typed, accepted);
}

function resolveConstructor(name: string, context: ValidationContext, node: SourceNode): ResolvedConstructor {
  const separator = name.indexOf(".");
  if (separator >= 0) {
    const alias = name.slice(0, separator);
    const constructorName = name.slice(separator + 1);
    const imported = context.imports.get(alias);
    if (!imported) {
      fail(
        "unknown-import-alias",
        `unknown import alias '${alias}'${importHint(constructorName, alias)}`,
        node,
      );
    }
    const manifest = constructorByName(imported.manifest, constructorName);
    if (!manifest) {
      fail(
        "unknown-constructor",
        `library '${imported.manifest.name}' has no constructor '${constructorName}'`,
        node,
      );
    }
    return { name, manifest, template: null };
  }

  const coreConstructor = constructorByName(context.core, name);
  if (coreConstructor) return { name, manifest: coreConstructor, template: null };

  const template = context.templates.get(name);
  if (template) return { name, manifest: null, template };

  const known = [...context.core.constructors.map((item) => item.name), ...context.templates.keys()];
  const hint = importHint(name) || nearestName(name, known);
  fail("unknown-constructor", `unknown constructor '${name}'${hint}`, node);
}

function completeParameterName(value: SourcePropertyValue, node: SourceNode): string {
  const match = typeof value === "string" ? COMPLETE_PARAMETER_PATTERN.exec(value) : null;
  if (!match) fail("invalid-parameter-reference", "invalid template parameter reference", node);
  return match[1];
}

function recordParameterUse(
  template: DocumentTemplate | null,
  parameter: string,
  kind: ManifestValueKind | null,
  node: SourceNode,
): boolean {
  if (!template) {
    fail("parameter-outside-template", `parameter '${parameter}' may be used only inside a template`, node);
  }
  const uses = template.parameterUses.get(parameter);
  if (!uses) {
    fail(
      "undeclared-template-parameter",
      `template '${template.declaration.id}' does not declare parameter '${parameter}'`,
      node,
    );
  }
  if (kind === null || uses.has(kind)) return false;
  const conflictingKind = uses.keys().next().value;
  if (conflictingKind !== undefined) {
    fail(
      "conflicting-template-parameter-kinds",
      `template '${template.declaration.id}' parameter '${parameter}' has conflicting use kinds '${conflictingKind}' and '${kind}'`,
      node,
    );
  }
  uses.set(kind, node);
  return true;
}

function validateParameterReferences(
  value: SourcePropertyValue,
  sourceKind: SourceValueKind,
  expected: ManifestValueKind | null,
  template: DocumentTemplate | null,
  node: SourceNode,
): void {
  if (sourceKind === "parameter") {
    recordParameterUse(template, completeParameterName(value, node), expected, node);
    return;
  }
  if (!template || sourceKind !== "string" || typeof value !== "string") return;
  for (const match of value.matchAll(INTERPOLATED_PARAMETER_PATTERN)) {
    recordParameterUse(template, match[1], "string", node);
  }
}

function matchesKind(
  value: SourcePropertyValue,
  sourceKind: SourceValueKind,
  expected: ManifestValueKind,
): boolean {
  if (sourceKind === "parameter") return true;
  if (expected === "string") {
    return (sourceKind === "string" || sourceKind === "raw-string") && typeof value === "string";
  }
  if (expected === "raw-string") return sourceKind === "raw-string" && typeof value === "string";
  if (expected === "expression") return sourceKind === "expression" && typeof value === "string";
  if (expected === "identifier") return sourceKind === "identifier" && typeof value === "string";
  if (expected === "number") return sourceKind === "number" && typeof value === "number";
  if (expected === "boolean") return sourceKind === "boolean" && typeof value === "boolean";
  if (expected === "endpoint") {
    return sourceKind === "endpoint"
      && typeof value === "object"
      && value !== null
      && !Array.isArray(value)
      && "reference" in value
      && typeof value.reference === "string";
  }
  if (expected === "pair") {
    // An element written after '=' is an expression rather than a literal, and
    // it is a number by the time anything reads it: either the binding pass
    // folded it, or a template supplies its parameter before the pass that
    // needs it runs. A parameter reaching here is legitimate for the same
    // reason a bare `${name}` is, handled above.
    return sourceKind === "tuple"
      && Array.isArray(value)
      && value.length === 2
      && value.every((item) => typeof item === "number" || typeof item === "string");
  }
  if (expected === "strings") {
    return sourceKind === "tuple"
      && Array.isArray(value)
      && value.every((item) => typeof item === "string");
  }
  if (expected === "numbers") {
    return sourceKind === "tuple"
      && Array.isArray(value)
      && value.every((item) => typeof item === "number");
  }
  if (expected === "interval") {
    // Either end may be written as a number or as one of the constants the
    // expression sublanguage defines, so `(0, tau)` reads the way an interval
    // does on paper.
    return sourceKind === "tuple"
      && Array.isArray(value)
      && value.length === 2
      && value.every((item) => typeof item === "number"
        || (typeof item === "string" && CONSTANTS.has(item)));
  }
  return sourceKind === "tuple"
    && Array.isArray(value)
    && value.every((point) => Array.isArray(point)
      && point.length === 2
      && point.every((item) => typeof item === "number"));
}

function valueDescription(value: SourcePropertyValue, kind?: SourceValueKind): string {
  if (kind === "raw-string") return "raw string";
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "number")) return "number list";
    return "point list";
  }
  if (typeof value === "object") return "endpoint";
  return typeof value;
}

function argumentAt(
  arguments_: readonly ConstructorArgumentManifest[],
  index: number,
): ConstructorArgumentManifest | undefined {
  const direct = arguments_[index];
  if (direct) return direct;
  const variadic = arguments_.at(-1);
  return variadic?.variadic ? variadic : undefined;
}

function validateArguments(
  declaration: SourceConstructorCall,
  resolved: ResolvedConstructor,
  context: ValidationContext,
  template: DocumentTemplate | null,
): void {
  if (resolved.template) {
    if (declaration.type !== "declaration") {
      fail("anonymous-template-use", `template '${resolved.name}' requires a declaration id`, declaration);
    }
    const expected = resolved.template.parameters.length;
    if (declaration.arguments.length !== expected) {
      fail(
        "template-arity",
        `template '${resolved.name}' expects ${expected} argument(s), received ${declaration.arguments.length}`,
        declaration,
      );
    }
    declaration.arguments.forEach((value, index) => {
      validateParameterReferences(value, declaration.argumentKinds[index], null, template, declaration);
    });
    context.templateInvocations.push({
      declaration,
      template: resolved.template,
      ownerTemplate: template,
    });
    return;
  }

  const manifest = resolved.manifest!;
  const required = manifest.arguments.filter(({ required }) => required).length;
  const variadic = manifest.arguments.at(-1)?.variadic === true;
  const maximum = variadic ? null : manifest.arguments.length;
  if (declaration.arguments.length < required || (maximum !== null && declaration.arguments.length > maximum)) {
    const expected = maximum === null ? `at least ${required}` : required === maximum ? `${required}` : `${required}-${maximum}`;
    fail(
      "constructor-arity",
      `constructor '${resolved.name}' expects ${expected} argument(s), received ${declaration.arguments.length}`,
      declaration,
    );
  }

  declaration.arguments.forEach((value, index) => {
    const argument = argumentAt(manifest.arguments, index);
    if (!argument) return;
    validateParameterReferences(value, declaration.argumentKinds[index], argument.kind, template, declaration);
    if (matchesKind(value, declaration.argumentKinds[index], argument.kind)) return;
    fail(
      "wrong-argument-kind",
      `constructor '${resolved.name}' argument '${argument.name}' expects ${argument.kind}, received ${valueDescription(value, declaration.argumentKinds[index])}`,
      declaration,
    );
  });
}

function validateProperties(
  declaration: SourceConstructorCall,
  resolved: ResolvedConstructor,
  context: ValidationContext,
  template: DocumentTemplate | null,
): void {
  if (resolved.template) {
    const properties = declaration.statements.filter((statement): statement is SourceProperty => statement.type === "property");
    if (properties.length > 0) {
      fail("template-use-property", `template use '${resolved.name}' does not accept properties`, properties[0]);
    }
    return;
  }

  const manifest = resolved.manifest!;
  const specifications = new Map(manifest.properties.map((property) => [property.name, property]));
  const seen = new Set<string>();
  for (const property of declaration.statements.filter(
    (statement): statement is SourceProperty => statement.type === "property",
  )) {
    if (seen.has(property.name)) {
      fail("duplicate-property", `constructor '${resolved.name}' has duplicate property '${property.name}'`, property);
    }
    seen.add(property.name);
    const specification = specifications.get(property.name);
    if (!specification) {
      fail(
        "unknown-property",
        `constructor '${resolved.name}' does not accept property '${property.name}'`
          + propertySuggestion(property.name, [...specifications.keys()]),
        property,
      );
    }
    validateParameterReferences(property.value, property.valueKind, specification.kind, template, property);
    if (!matchesKind(property.value, property.valueKind, specification.kind)) {
      fail(
        "wrong-property-kind",
        `property '${property.name}' on '${resolved.name}' expects ${specification.kind}, received ${valueDescription(property.value)}`,
        property,
      );
    }
    validateQualifiedStyleValue(property, context);
  }

  for (const property of manifest.properties) {
    if (property.required && !seen.has(property.name)) {
      fail(
        "missing-property",
        `constructor '${resolved.name}' requires property '${property.name}'`,
        declaration,
      );
    }
  }
}

function validateQualifiedStyleValue(
  property: SourceProperty,
  context: ValidationContext,
): void {
  if (property.name !== "style"
      || property.valueKind === "parameter"
      || typeof property.value !== "string"
      || !property.value.includes(".")) return;

  const parts = property.value.split(".");
  const alias = parts[0];
  const valueName = parts[1];
  const imported = context.imports.get(alias);
  if (!imported) {
    fail("unknown-value-alias", `unknown library alias '${alias}' in style value '${property.value}'`, property);
  }
  if (parts.length !== 2 || !valueName) {
    fail("invalid-qualified-value", `style value '${property.value}' must have the form alias.value`, property);
  }
  if (!imported.manifest.values.some(({ name }) => name === valueName)) {
    fail(
      "unknown-library-value",
      `library '${imported.manifest.name}' has no exported value '${valueName}'`,
      property,
    );
  }
}

function validateStatementProperties(
  owner: string,
  properties: readonly SourceProperty[],
  specifications: ReadonlyMap<string, StatementPropertySpecification>,
  context: ValidationContext,
  template: DocumentTemplate | null,
): void {
  const seen = new Set<string>();
  for (const property of properties) {
    if (seen.has(property.name)) fail("duplicate-property", `${owner} has duplicate property '${property.name}'`, property);
    seen.add(property.name);
    const specification = specifications.get(property.name);
    if (!specification) fail("unknown-property", `${owner} does not accept property '${property.name}'`, property);
    validateParameterReferences(property.value, property.valueKind, specification.kind, template, property);
    if (!matchesKind(property.value, property.valueKind, specification.kind)) {
      fail(
        "wrong-property-kind",
        `property '${property.name}' on ${owner} expects ${specification.kind}, received ${valueDescription(property.value)}`,
        property,
      );
    }
    if (specification.values
        && property.valueKind !== "parameter"
        && (typeof property.value !== "string" || !specification.values.has(property.value))) {
      fail(
        "unsupported-property-value",
        `property '${property.name}' on ${owner} must be one of ${[...specification.values].join(", ")}`,
        property,
      );
    }
    validateQualifiedStyleValue(property, context);
  }
}

function childStatements(statements: readonly SourceStatement[]): readonly ChildStatement[] {
  return statements.filter(
    (statement): statement is ChildStatement => CHILD_STATEMENT_TYPES.has(statement.type),
  );
}

function childKinds(
  child: ChildStatement,
  context: ValidationContext,
  templateStack: readonly string[],
): readonly string[] {
  if (child.type === "connection") return ["connection"];
  if (child.type === "arrangement") return ["arrangement"];
  if (child.type !== "declaration" && child.type !== "invocation") return ["geometry"];
  const resolved = resolveConstructor(child.constructor, context, child);
  if (resolved.manifest) return [resolved.manifest.lowering.semanticKind];
  if (templateStack.includes(resolved.name)) {
    fail("template-cycle", `template cycle: ${[...templateStack, resolved.name].join(" -> ")}`, child);
  }
  return childStatements(resolved.template!.declaration.statements).flatMap((statement) => (
    childKinds(statement, context, [...templateStack, resolved.name])
  ));
}

function validateChildren(
  declaration: SourceConstructorCall,
  resolved: ResolvedConstructor,
  context: ValidationContext,
): void {
  if (resolved.template) {
    const children = childStatements(declaration.statements);
    if (children.length > 0) {
      fail("template-use-children", `template use '${resolved.name}' does not accept children`, children[0]);
    }
    return;
  }

  const policy = resolved.manifest!.children;
  const children = childStatements(declaration.statements);
  if (policy.mode === "none") {
    if (children.length > 0) {
      fail("children-not-allowed", `constructor '${resolved.name}' does not accept children`, children[0]);
    }
    return;
  }

  const counts = new Map(policy.roles.map((role) => [role.name, 0]));
  const templateStack = resolved.manifest?.name === "template" && declaration.type === "declaration"
    ? [declaration.id]
    : [];
  for (const child of children) {
    const kinds = childKinds(child, context, templateStack);
    for (const kind of kinds) {
      const role = policy.roles.find(({ accepts }) => accepts.includes(kind));
      if (!role) {
        fail(
          "invalid-child",
          `constructor '${resolved.name}' does not accept child kind '${kind}'`,
          child,
        );
      }
      counts.set(role.name, counts.get(role.name)! + 1);
    }
  }

  for (const role of policy.roles) {
    const count = counts.get(role.name)!;
    if (count < role.minimum) {
      fail(
        "missing-child-role",
        `constructor '${resolved.name}' requires at least ${role.minimum} '${role.name}' child(ren), received ${count}`,
        declaration,
      );
    }
    if (role.maximum !== null && count > role.maximum) {
      fail(
        "too-many-children",
        `constructor '${resolved.name}' accepts at most ${role.maximum} '${role.name}' child(ren), received ${count}`,
        declaration,
      );
    }
  }
}

function validateTreeArrangement(
  declaration: SourceDeclaration,
  resolved: ResolvedConstructor,
  context: ValidationContext,
): void {
  const tree = declaration.statements.find(
    (statement): statement is Extract<SourceStatement, { type: "arrangement" }> => (
      statement.type === "arrangement" && statement.kind === "tree"
    ),
  );
  if (!tree) return;

  if (resolved.manifest?.name === "template") {
    fail(
      "unsupported-tree-owner",
      `tree arrangement is not supported in template '${declaration.id}'`,
      tree,
    );
  }
  const ownerKind = resolved.manifest?.lowering.semanticKind;
  if (!ownerKind || !TREE_OWNER_KINDS.has(ownerKind)) {
    fail(
      "unsupported-tree-owner",
      `tree arrangement is not supported in constructor '${resolved.name}'`,
      tree,
    );
  }

  const additionalArrangement = declaration.statements.find(
    (statement) => statement.type === "arrangement" && statement !== tree,
  );
  if (additionalArrangement) {
    fail(
      "unsupported-tree-content",
      `tree arrangement in '${declaration.id}' does not preserve additional arrangements`,
      additionalArrangement,
    );
  }

  for (const child of childStatements(declaration.statements)) {
    if (child === tree || child.type === "connection") continue;
    if (child.type === "arrangement") continue;
    if (child.type !== "declaration") {
      fail(
        "unsupported-tree-content",
        `tree arrangement in '${declaration.id}' does not preserve geometry children`,
        child,
      );
    }
    const childConstructor = resolveConstructor(child.constructor, context, child);
    if (childConstructor.template) {
      fail(
        "unsupported-tree-content",
        `tree arrangement in '${declaration.id}' requires direct node declarations, not template use '${child.id}'`,
        child,
      );
    }
    const childKind = childConstructor.manifest!.lowering.semanticKind;
    if (childKind !== "node") {
      fail(
        "unsupported-tree-content",
        `tree arrangement in '${declaration.id}' does not preserve child kind '${childKind}'`,
        child,
      );
    }
  }
}

function validateDeclaration(
  declaration: SourceDeclaration,
  context: ValidationContext,
  depth: number,
  template: DocumentTemplate | null,
): void {
  const resolved = resolveConstructor(declaration.constructor, context, declaration);
  if (resolved.manifest?.identity === "anonymous") {
    fail("named-anonymous-constructor", `constructor '${resolved.name}' must be used without an id`, declaration);
  }
  if (resolved.manifest?.name === "template" && depth !== 0) {
    fail("nested-template", `template '${declaration.id}' must be declared at document scope`, declaration);
  }
  validateArguments(declaration, resolved, context, template);
  validateProperties(declaration, resolved, context, template);
  validateTreeArrangement(declaration, resolved, context);
  validateChildren(declaration, resolved, context);

  const declaredTemplate = resolved.manifest?.name === "template"
    ? context.templates.get(declaration.id)!
    : template;
  validateStatements(declaration.statements, context, depth + 1, declaredTemplate, declaration);
}

function validateInvocation(
  invocation: SourceInvocation,
  context: ValidationContext,
  depth: number,
  template: DocumentTemplate | null,
): void {
  const resolved = resolveConstructor(invocation.constructor, context, invocation);
  if (resolved.template || resolved.manifest?.identity !== "anonymous") {
    fail("anonymous-named-constructor", `constructor '${resolved.name}' requires a declaration id`, invocation);
  }
  if (depth === 0) {
    fail("document-invocation", `anonymous constructor '${resolved.name}' is not allowed at document scope`, invocation);
  }
  validateArguments(invocation, resolved, context, template);
  validateProperties(invocation, resolved, context, template);
  validateChildren(invocation, resolved, context);
  validateStatements(invocation.statements, context, depth + 1, template, invocation);
}

function validateStatements(
  statements: readonly SourceStatement[],
  context: ValidationContext,
  depth: number,
  template: DocumentTemplate | null,
  owner: SourceConstructorCall | null,
): void {
  for (const statement of statements) {
    if (statement.type === "declaration") validateDeclaration(statement, context, depth, template);
    else if (statement.type === "invocation") validateInvocation(statement, context, depth, template);
    else if (statement.type === "connection") {
      if (template && statement.label) {
        validateParameterReferences(statement.label, "string", "string", template, statement);
      }
      validateStatementProperties("connection", statement.properties, CONNECTION_PROPERTIES, context, template);
    } else if (statement.type === "arrangement") {
      if (statement.kind === "tree" && owner === null) {
        fail("unsupported-tree-owner", "tree arrangement is not supported at diagram scope", statement);
      }
      const properties = ARRANGEMENT_PROPERTIES.get(statement.kind);
      if (!properties) {
        fail(
          "unknown-arrangement",
          `unknown arrangement '${statement.kind}'${nearestName(statement.kind, ARRANGEMENT_PROPERTIES.keys())}`,
          statement,
        );
      }
      validateStatementProperties(`arrangement '${statement.kind}'`, statement.properties, properties, context, template);
    } else if (statement.type === "property" && depth === 0) {
      fail("document-property", `document scope does not accept property '${statement.name}'`, statement);
    } else if (statement.type === "subtitle" && depth !== 0) {
      fail("nested-subtitle", "subtitle is allowed only at diagram scope", statement);
    }
  }
}

function invocationValueDescription(
  value: SourcePropertyValue,
  sourceKind: SourceValueKind,
): string {
  if (sourceKind === "tuple") return valueDescription(value);
  return sourceKind;
}

function validateTemplateInvocations(context: ValidationContext): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const invocation of context.templateInvocations) {
      invocation.declaration.arguments.forEach((value, index) => {
        if (invocation.declaration.argumentKinds[index] !== "parameter") return;
        const parameter = completeParameterName(value, invocation.declaration);
        const targetParameter = invocation.template.parameters[index];
        const targetUses = invocation.template.parameterUses.get(targetParameter)!;
        for (const kind of targetUses.keys()) {
          changed = recordParameterUse(
            invocation.ownerTemplate,
            parameter,
            kind,
            invocation.declaration,
          ) || changed;
        }
      });
    }
  }

  for (const invocation of context.templateInvocations) {
    invocation.declaration.arguments.forEach((value, index) => {
      const sourceKind = invocation.declaration.argumentKinds[index];
      if (sourceKind === "parameter") return;
      const parameter = invocation.template.parameters[index];
      const uses = invocation.template.parameterUses.get(parameter)!;
      for (const kind of uses.keys()) {
        if (matchesKind(value, sourceKind, kind)) continue;
        fail(
          "wrong-template-argument-kind",
          `template '${invocation.declaration.constructor}' argument '${parameter}' expects ${kind}, received ${invocationValueDescription(value, sourceKind)}`,
          invocation.declaration,
        );
      }
    });
  }
}

/**
 * Validates language names and signatures without mutating or lowering the source tree.
 *
 * Source values retain their lexical kind so manifest validation can distinguish
 * quoted text, identifiers, flags, endpoints, and tuples before lowering.
 */
export function validateLanguageDocument(
  document: SourceDocument,
  manifests: readonly LibraryManifest[] = BUILTIN_LIBRARY_MANIFESTS,
): SourceDocument {
  const libraries = indexManifests(manifests);
  const core = libraries.get("xdraw/core");
  if (!core) fail("missing-core-library", "library catalog is missing 'xdraw/core'");
  const imports = resolveImports(document, libraries, core);
  const templates = documentTemplates(document, core, imports);
  const context: ValidationContext = { core, libraries, imports, templates, templateInvocations: [] };

  const subtitles = document.diagram.statements.filter((statement) => statement.type === "subtitle");
  if (subtitles.length > 1) {
    fail("duplicate-subtitle", "diagram accepts at most one subtitle", subtitles[1]);
  }

  validateStatements(document.diagram.statements, context, 0, null, null);
  validateTemplateInvocations(context);
  return document;
}
