import assert from "node:assert/strict";
import test from "node:test";

import { compile } from "../src/pipeline.ts";
import { parseSource } from "../src/source-language.ts";

const TABLE_SOURCE = `
use "xdraw/table" as table

diagram "Orders" {
  orders: table.table "Orders" {
    table.header "Order" "Customer" "Total"
    table.row "1001" "A. Ndlovu" "R450"
    table.row "1002" "A customer with an intentionally long display name that must wrap inside the available column" "R980"
  }
}`;

test("table constructors lower exact anonymous row syntax", () => {
  const document = parseSource(TABLE_SOURCE);
  const table = document.statements.find((statement) => statement.type === "node");
  assert.ok(table);
  assert.equal(table.kind, "table");
  assert.equal(table.title, "Orders");
  assert.deepEqual(table.statements, [
    { type: "table-header", cells: ["Order", "Customer", "Total"] },
    { type: "table-row", cells: ["1001", "A. Ndlovu", "R450"] },
    {
      type: "table-row",
      cells: [
        "1002",
        "A customer with an intentionally long display name that must wrap inside the available column",
        "R980",
      ],
    },
  ]);
});

test("table rendering emits one grouped native Excalidraw composite", () => {
  const elements = compile(parseSource(TABLE_SOURCE)).toJSON().elements;
  const tableElements = elements.filter((element) => element.id.startsWith("orders:"));
  assert.ok(tableElements.length > 0);
  assert.ok(tableElements.every((element) => element.type === "rectangle" || element.type === "text"));
  assert.ok(tableElements.every((element) => element.groupIds.includes("orders:group")));
  assert.equal(tableElements.find((element) => element.id === "orders:frame")?.type, "rectangle");
  assert.equal(tableElements.find((element) => element.id === "orders:title")?.type, "text");
  const header = tableElements.find((element) => element.id === "orders:header:cell:0:text");
  const total = tableElements.find((element) => element.id === "orders:row:1:cell:2:text");
  assert.equal(header?.type === "text" ? header.text : undefined, "Order");
  assert.equal(total?.type === "text" ? total.text : undefined, "R980");
});

test("table measurement assigns wider columns to wider content and wraps cells", () => {
  const elements = compile(parseSource(TABLE_SOURCE)).toJSON().elements;
  const order = elements.find((element) => element.id === "orders:header:cell:0:frame");
  const customer = elements.find((element) => element.id === "orders:header:cell:1:frame");
  const total = elements.find((element) => element.id === "orders:header:cell:2:frame");
  assert.ok(order && customer && total);
  assert.ok(customer.width > order.width);
  assert.ok(customer.width > total.width);
  const wrapped = elements.find((element) => element.id === "orders:row:1:cell:1:text");
  assert.ok(wrapped?.type === "text");
  assert.match(wrapped.text, /\n/u);
  const row = elements.find((element) => element.id === "orders:row:1:cell:0:frame");
  assert.ok(row && row.height > 44);
});

test("tables retain node placement, connector binding, and frame ownership", () => {
  const source = `
    use "xdraw/table" as table
    diagram "Nested" {
      area: frame "Area" {
        locked true
        arrange row {}
        orders: table.table "Orders" {
          table.header "Order" "Total"
          table.row "1001" "R450"
        }
        archive: rectangle "Archive"
        orders -> archive
      }
    }
  `;
  const elements = compile(parseSource(source)).toJSON().elements;
  const tableElements = elements.filter((element) => element.id.startsWith("area.orders:"));
  assert.ok(tableElements.length > 0);
  assert.ok(tableElements.every((element) => element.frameId === "area" && element.locked));
  const connector = elements.find((element) => element.type === "arrow");
  assert.equal(connector?.startBinding?.elementId, "area.orders:frame");
});

test("table validation rejects malformed structure and inconsistent rows", () => {
  assert.throws(() => parseSource(`
    use "xdraw/table" as table
    diagram "Missing row" {
      orders: table.table "Orders" { table.header "Order" }
    }
  `), /requires at least 1 'rows'/u);

  assert.throws(() => parseSource(`
    use "xdraw/table" as table
    diagram "Named header" {
      orders: table.table "Orders" {
        columns: table.header "Order"
        table.row "1001"
      }
    }
  `), /must be used without an id/u);

  assert.throws(() => compile(parseSource(`
    use "xdraw/table" as table
    diagram "Mismatch" {
      orders: table.table "Orders" {
        table.header "Order" "Total"
        table.row "1001"
      }
    }
  `)), /has 1 cells; expected 2/u);

  assert.throws(() => compile(parseSource(`
    use "xdraw/table" as table
    diagram "Ordering" {
      orders: table.table "Orders" {
        table.row "1001"
        table.header "Order"
      }
    }
  `)), /header must be declared before its rows/u);
});
