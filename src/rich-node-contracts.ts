export interface TableNodePlan {
  readonly type: "table";
  readonly width: number;
  readonly height: number;
  readonly columnWidths: readonly number[];
  readonly rowHeights: readonly number[];
  readonly titleHeight: number;
  readonly wrappedRows: readonly (readonly string[])[];
}

export interface ArchitectureNodePlan {
  readonly type: "architecture";
  readonly width: number;
  readonly height: number;
}

export interface FormulaNodePlan {
  readonly type: "formula";
  readonly width: number;
  readonly height: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly fileId: string;
  readonly source: string;
  readonly digest: string;
  readonly renderer: "mathjax-svg";
  readonly rendererVersion: string;
}

export type RichNodePlan = TableNodePlan | ArchitectureNodePlan | FormulaNodePlan;
