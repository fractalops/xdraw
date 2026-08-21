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

export interface CartesianLinePlan {
  readonly start: readonly [number, number];
  readonly end: readonly [number, number];
}

export interface CartesianTickPlan {
  readonly value: number;
  readonly label: string;
  readonly position: number;
  readonly mark: CartesianLinePlan;
  readonly labelPosition: readonly [number, number];
  readonly textAlign: "left" | "center" | "right";
  readonly verticalAlign: "top" | "middle" | "bottom";
}

export interface CartesianAxisPlan {
  readonly line: CartesianLinePlan;
  readonly ticks: readonly CartesianTickPlan[];
}

export interface CartesianScalePlan {
  readonly dataDomain: readonly [number, number];
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
}

export interface CartesianSeriesPlan {
  readonly id: string;
  readonly label?: string;
  readonly segments: readonly (readonly (readonly [number, number])[])[];
  readonly strokeColor: string;
  readonly backgroundColor: string;
  readonly fillStyle: "solid" | "hachure" | "cross-hatch";
  readonly strokeWidth: number;
  readonly strokeStyle: "solid" | "dashed" | "dotted";
  readonly roughness: number;
  readonly opacity: number;
  readonly link?: string;
  readonly locked: boolean;
}

export interface CartesianNodePlan {
  readonly type: "cartesian";
  readonly width: number;
  readonly height: number;
  readonly plotBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly xScale: CartesianScalePlan;
  readonly yScale: CartesianScalePlan;
  readonly xAxis: CartesianAxisPlan;
  readonly yAxis: CartesianAxisPlan;
  readonly verticalGrid: readonly CartesianLinePlan[];
  readonly horizontalGrid: readonly CartesianLinePlan[];
  readonly series: readonly CartesianSeriesPlan[];
  readonly xLabel?: string;
  readonly yLabel?: string;
}

export type RichNodePlan = TableNodePlan | ArchitectureNodePlan | FormulaNodePlan | CartesianNodePlan;
