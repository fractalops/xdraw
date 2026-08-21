import type { ToneName } from "../../excalidraw/components.ts";
import type { ConstructorDefinition } from "../registry.ts";

export type ManifestValueKind =
  | "string"
  | "raw-string"
  | "identifier"
  | "number"
  | "boolean"
  | "point"
  | "points"
  | "numbers"
  | "strings"
  | "expression"
  | "endpoint";

export type LibraryValueKind = "tone";

export type ManifestSemanticKind = ConstructorDefinition["type"];

export type ManifestElementKind =
  | "architecture-component"
  | "architecture-container"
  | "architecture-container-boundary"
  | "architecture-database"
  | "architecture-deployment-node"
  | "architecture-external-system"
  | "architecture-group"
  | "architecture-person"
  | "architecture-queue"
  | "architecture-system"
  | "architecture-system-boundary"
  | "card"
  | "cartesian"
  | "code"
  | "decision"
  | "ellipse"
  | "frame"
  | "freedraw"
  | "icon"
  | "image"
  | "junction"
  | "lane"
  | "formula"
  | "note"
  | "participant"
  | "section"
  | "sequence"
  | "table"
  | "text";

export type ManifestTone = ToneName;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface ManifestDocumentation {
  readonly synopsis: string;
  readonly examples: readonly string[];
}

export interface ConstructorArgumentManifest {
  readonly name: string;
  readonly kind: ManifestValueKind;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly synopsis: string;
}

export interface ConstructorPropertyManifest {
  readonly name: string;
  readonly kind: ManifestValueKind;
  readonly required: boolean;
  readonly synopsis: string;
}

export interface ChildRoleManifest {
  readonly name: string;
  readonly accepts: readonly string[];
  readonly minimum: number;
  readonly maximum: number | null;
  readonly synopsis: string;
}

export type ChildPolicyManifest =
  | { readonly mode: "none"; readonly roles: readonly [] }
  | { readonly mode: "roles"; readonly roles: readonly ChildRoleManifest[] };

export interface ConstructorDefaultsManifest {
  readonly properties: Readonly<Record<string, JsonValue>>;
}

/**
 * The outline a connector meets for this kind.
 *
 * Excalidraw's three native shapes have three different borders, and a connector
 * aimed at a shape's centre crosses a different curve for each. Declaring it here
 * rather than in a table inside the compiler is what lets a library introduce a
 * kind whose border is not a box.
 */
export type ManifestBorder = "box" | "ellipse" | "diamond";

export interface ConstructorLoweringManifest {
  readonly semanticKind: ManifestSemanticKind;
  readonly elementKind: ManifestElementKind | null;
  readonly tone: ManifestTone | null;
  readonly border: ManifestBorder;
}

export interface ConstructorManifest {
  readonly name: string;
  readonly identity: "named" | "anonymous";
  readonly arguments: readonly ConstructorArgumentManifest[];
  readonly properties: readonly ConstructorPropertyManifest[];
  readonly children: ChildPolicyManifest;
  readonly defaults: ConstructorDefaultsManifest;
  readonly lowering: ConstructorLoweringManifest;
  readonly documentation: ManifestDocumentation;
}

export interface LibraryValueManifest {
  readonly name: string;
  readonly kind: LibraryValueKind;
  readonly synopsis: string;
}

export interface LibraryManifest {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly documentation: ManifestDocumentation;
  readonly constructors: readonly ConstructorManifest[];
  readonly values: readonly LibraryValueManifest[];
}

export interface LibraryManifestSummary {
  readonly name: string;
  readonly synopsis: string;
  readonly constructors: readonly string[];
  readonly values: readonly string[];
}

export class LibraryManifestError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "LibraryManifestError";
    this.path = path;
  }
}
