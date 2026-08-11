import assert from "node:assert/strict";
import test from "node:test";

import { formatSceneResource, parseSceneDocument } from "../src/scene-document.js";

test("scene documents make replacement explicit", () => {
  const document = parseSceneDocument(`
    scene excalidraw::default::architecture::system_overview {
      replace {
        diagram "System overview" {
          api: system "API"
          data: database "Data"
          api -> data
        }
      }
    }
  `);
  assert.equal(formatSceneResource(document.resource), "excalidraw::default::architecture::system_overview");
  assert.equal(document.operation.type, "replace");
  assert.equal(document.operation.diagram.title, "System overview");
  assert.equal(document.operation.diagram.statements.length, 3);
});

test("scene documents express selective updates without JSON", () => {
  const document = parseSceneDocument(`
    scene excalidraw::default::architecture::system_overview {
      patch {
        update api { tone warning title "API v2" }
        delete obsolete
        add { note review "Requires review" at (80, 80) }
      }
    }
  `);
  assert.deepEqual(document.operation.updates, [{
    target: "api", properties: { tone: "warning", title: "API v2" },
  }]);
  assert.deepEqual(document.operation.deletes, ["obsolete"]);
  assert.equal(document.operation.additions.statements[0].id, "review");
});

test("scene documents reject ambiguous or empty operations", () => {
  assert.throws(
    () => parseSceneDocument("scene excalidraw::default::one { patch { delete old } }"),
    /provider::workspace::collection::scene/,
  );
  assert.throws(
    () => parseSceneDocument("scene excalidraw::default::main::one { patch {} }"),
    /must add, update, or delete/,
  );
  assert.throws(
    () => parseSceneDocument("scene excalidraw::default::main::one { patch { update api { tone warning } delete api } }"),
    /cannot update and delete 'api'/,
  );
});
