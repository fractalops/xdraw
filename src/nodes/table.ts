import { boundText } from "../excalidraw/components.ts";
import { rectangle } from "../excalidraw/elements.ts";
import { box } from "../geometry.ts";
import { measureTextWidth, wrapTextToWidth } from "../text/metrics.ts";
import type { Bounds } from "../foundation-contracts.ts";
import type { DrawingElement, RectangleElement, TextElement } from "../render-contracts.ts";
import type { NodeStatement, SemanticStatement, TableRowStatement } from "../semantic-contracts.ts";
import type { TableNodePlan } from "../rich-node-contracts.ts";

const BODY_FONT_SIZE = 16;
const HEADER_FONT_SIZE = 16;
const TITLE_FONT_SIZE = 20;
const FONT_NORMAL = 2;
const FONT_BOLD = 7;
const HORIZONTAL_PADDING = 14;
const VERTICAL_PADDING = 10;
const MINIMUM_COLUMN_WIDTH = 88;
const MAXIMUM_COLUMN_WIDTH = 360;
const MINIMUM_ROW_HEIGHT = 44;
const TITLE_HEIGHT = 50;

interface TableModel {
  readonly id?: string;
  readonly kind: string;
  readonly title: string;
  readonly statements?: readonly SemanticStatement[];
}

function tableRows(table: TableModel): TableRowStatement[] {
  return [
    ...(table.statements ?? []).filter((row): row is TableRowStatement => row.type === "table-header"),
    ...(table.statements ?? []).filter((row): row is TableRowStatement => row.type === "table-row"),
  ];
}

function preferredColumnWidths(rows: readonly TableRowStatement[]): number[] {
  const columnCount = rows[0]?.cells.length ?? 0;
  return Array.from({ length: columnCount }, (_, columnIndex) => {
    const contentWidth = Math.max(...rows.map((row) => measureTextWidth(
      row.cells[columnIndex] ?? "",
      row.type === "table-header" ? HEADER_FONT_SIZE : BODY_FONT_SIZE,
      row.type === "table-header" ? FONT_BOLD : FONT_NORMAL,
    )));
    return Math.min(MAXIMUM_COLUMN_WIDTH, Math.max(
      MINIMUM_COLUMN_WIDTH,
      Math.ceil(contentWidth + HORIZONTAL_PADDING * 2),
    ));
  });
}

function fitColumnWidths(preferred: readonly number[], maximumWidth: number): number[] {
  if (!(maximumWidth > 0) || !Number.isFinite(maximumWidth)) {
    throw new Error("table width must be a positive finite number");
  }
  const preferredTotal = preferred.reduce((sum, width) => sum + width, 0);
  if (preferredTotal <= maximumWidth) {
    const extra = (maximumWidth - preferredTotal) / preferred.length;
    return preferred.map((width) => width + extra);
  }

  const minimum = Math.min(MINIMUM_COLUMN_WIDTH, maximumWidth / preferred.length);
  const minimumTotal = minimum * preferred.length;
  const distributable = Math.max(0, maximumWidth - minimumTotal);
  const desiredExtras = preferred.map((width) => Math.max(0, width - minimum));
  const desiredExtraTotal = desiredExtras.reduce((sum, width) => sum + width, 0);
  if (desiredExtraTotal === 0) return preferred.map(() => maximumWidth / preferred.length);
  return preferred.map((_width, index) => (
    minimum + distributable * (desiredExtras[index] / desiredExtraTotal)
  ));
}

function wrapRow(row: TableRowStatement, columnWidths: readonly number[]): string[] {
  const fontSize = row.type === "table-header" ? HEADER_FONT_SIZE : BODY_FONT_SIZE;
  const fontFamily = row.type === "table-header" ? FONT_BOLD : FONT_NORMAL;
  return row.cells.map((cell, index) => {
    const width = Math.max(1, columnWidths[index] - HORIZONTAL_PADDING * 2);
    return wrapTextToWidth(cell, width, fontSize, fontFamily);
  });
}

function rowHeight(row: TableRowStatement, wrappedCells: readonly string[]): number {
  const fontSize = row.type === "table-header" ? HEADER_FONT_SIZE : BODY_FONT_SIZE;
  const contentHeight = Math.max(...wrappedCells.map((cell) => (
    cell.split("\n").length * fontSize * 1.25
  )));
  return Math.ceil(Math.max(MINIMUM_ROW_HEIGHT, contentHeight + VERTICAL_PADDING * 2));
}

export function planTable(table: TableModel, maximumWidth: number): TableNodePlan {
  const rows = tableRows(table);
  if (rows.length < 2 || rows[0].type !== "table-header") {
    throw new Error(`table '${table.id ?? "unknown"}' requires one header and at least one row`);
  }
  const columnWidths = fitColumnWidths(preferredColumnWidths(rows), maximumWidth);
  const wrappedRows = rows.map((row) => Object.freeze(wrapRow(row, columnWidths)));
  const rowHeights = rows.map((row, index) => rowHeight(row, wrappedRows[index]));
  const titleHeight = table.title ? TITLE_HEIGHT : 0;
  return Object.freeze({
    type: "table",
    width: columnWidths.reduce((sum, width) => sum + width, 0),
    height: titleHeight + rowHeights.reduce((sum, height) => sum + height, 0),
    columnWidths: Object.freeze(columnWidths),
    rowHeights: Object.freeze(rowHeights),
    titleHeight,
    wrappedRows: Object.freeze(wrappedRows),
  });
}

function cellElements(
  tableId: string,
  row: TableRowStatement,
  rowIndex: number,
  rowBounds: Bounds,
  columnWidths: readonly number[],
  wrappedCells: readonly string[],
  groupIds: string[],
): Array<RectangleElement | TextElement> {
  const header = row.type === "table-header";
  const fontFamily = header ? FONT_BOLD : FONT_NORMAL;
  const fontSize = header ? HEADER_FONT_SIZE : BODY_FONT_SIZE;
  const backgroundColor = header ? "#e2e8f0" : rowIndex % 2 === 0 ? "#ffffff" : "#f8fafc";
  let x = rowBounds.x;
  return row.cells.flatMap((_cell, columnIndex) => {
    const width = columnWidths[columnIndex];
    const cellBounds = box(x, rowBounds.y, width, rowBounds.height);
    const rowId = row.type === "table-header" ? "header" : `row:${rowIndex - 1}`;
    const cellId = `${tableId}:${rowId}:cell:${columnIndex}`;
    const contentBounds = box(
      x + HORIZONTAL_PADDING,
      rowBounds.y + VERTICAL_PADDING,
      Math.max(1, width - HORIZONTAL_PADDING * 2),
      Math.max(1, rowBounds.height - VERTICAL_PADDING * 2),
    );
    const label = boundText(`${cellId}:text`, `${cellId}:frame`, contentBounds, wrappedCells[columnIndex], {
      fontFamily,
      fontSize,
      lineHeight: 1.25,
      strokeColor: "#1f2937",
      textAlign: "left",
      verticalAlign: "middle",
      groupIds,
    });
    const frame = rectangle(`${cellId}:frame`, cellBounds, {
      strokeColor: "#94a3b8",
      backgroundColor,
      strokeWidth: 1,
      groupIds,
      boundElements: [{ id: label.id, type: "text" }],
    });
    x += width;
    return [frame, label];
  });
}

export function renderTable(
  table: NodeStatement,
  bounds: Bounds,
  plan: TableNodePlan,
): DrawingElement[] {
  const tableBounds = box(bounds.x, bounds.y, plan.width, plan.height);
  const groupIds = [`${table.id}:group`];
  const elements: DrawingElement[] = [];

  if (table.title) {
    const captionBounds = box(tableBounds.x, tableBounds.y, tableBounds.width, plan.titleHeight);
    const title = boundText(`${table.id}:title`, `${table.id}:caption`, {
      ...captionBounds,
      x: captionBounds.x + HORIZONTAL_PADDING,
      width: captionBounds.width - HORIZONTAL_PADDING * 2,
    }, table.title, {
      fontFamily: FONT_BOLD,
      fontSize: TITLE_FONT_SIZE,
      strokeColor: "#0f172a",
      textAlign: "left",
      verticalAlign: "middle",
      groupIds,
    });
    elements.push(rectangle(`${table.id}:caption`, captionBounds, {
      strokeColor: "#64748b",
      backgroundColor: "#f1f5f9",
      strokeWidth: 1,
      groupIds,
      boundElements: [{ id: title.id, type: "text" }],
    }), title);
  }

  let rowY = tableBounds.y + plan.titleHeight;
  tableRows(table).forEach((row, index) => {
    const rowBounds = box(tableBounds.x, rowY, plan.width, plan.rowHeights[index]);
    elements.push(...cellElements(
      table.id,
      row,
      index,
      rowBounds,
      plan.columnWidths,
      plan.wrappedRows[index],
      groupIds,
    ));
    rowY += plan.rowHeights[index];
  });
  elements.push(rectangle(`${table.id}:frame`, tableBounds, {
    strokeColor: "#475569",
    backgroundColor: "transparent",
    strokeWidth: 2,
    groupIds,
  }));
  return elements;
}

export interface TableValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly node: SemanticStatement;
}

export function validateTableNode(table: NodeStatement): TableValidationIssue[] {
  const issues: TableValidationIssue[] = [];
  const headers = table.statements.filter((item): item is TableRowStatement => item.type === "table-header");
  const rows = table.statements.filter((item): item is TableRowStatement => item.type === "table-row");
  if (headers.length !== 1 || rows.length < 1) {
    return [{ code: "XD1252", message: "table requires exactly one header and at least one row", node: table }];
  }
  const header = headers[0];
  const columnCount = header.cells.length;
  if (columnCount > 50) issues.push({ code: "XD1253", message: "table may contain at most 50 columns", node: header });
  if (rows.length > 500) issues.push({ code: "XD1254", message: "table may contain at most 500 rows", node: table });
  if (columnCount * (rows.length + 1) > 5_000) {
    issues.push({ code: "XD1257", message: "table may contain at most 5,000 cells", node: table });
  }
  if (table.statements[0]?.type !== "table-header") {
    issues.push({ code: "XD1258", message: "table header must be declared before its rows", node: header });
  }
  if (header.cells.some((cell) => cell.trim() === "")) {
    issues.push({ code: "XD1259", message: "table header cells must not be empty", node: header });
  }
  for (const row of [header, ...rows]) {
    if (row.cells.length !== columnCount) {
      issues.push({
        code: "XD1255",
        message: `table ${row.type === "table-header" ? "header" : "row"} has ${row.cells.length} cells; expected ${columnCount}`,
        node: row,
      });
    }
    if (row.cells.some((cell) => typeof cell !== "string")) {
      issues.push({ code: "XD1256", message: "table cells must be text", node: row });
    }
  }
  return issues;
}
