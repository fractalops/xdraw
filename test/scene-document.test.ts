import assert from "node:assert/strict";
import test from "node:test";

import { compilePrepared as compile } from "../src/compile/pipeline.ts";
import { formatSceneResource, parseSceneDocument, parseSceneResource } from "../src/io/scene-document.ts";

test("scene resource addresses round-trip with readable names", () => {
  const address = "excalidraw::default::Architecture::System overview";
  assert.equal(formatSceneResource(parseSceneResource(address)), address);
  assert.throws(() => parseSceneResource("Architecture::System overview"), /provider::workspace::collection::scene/);
  assert.throws(() => parseSceneResource("other::default::Architecture::System overview"), /unsupported scene provider/);
});

test("scene resource formatting rejects reserved separators", () => {
  assert.throws(
    () => formatSceneResource({ provider: "excalidraw", workspace: "a", collection: ":", scene: "a" }),
    /must not contain ':'/,
  );
  assert.throws(() => parseSceneResource("excalidraw::a::b:c::a"), /must not contain ':'/);
});

test("scene documents make replacement explicit", () => {
  const document = parseSceneDocument(`
    scene excalidraw::default::architecture::system_overview {
      replace {
        use "xdraw/architecture" as arch
        diagram "System overview" {
          api: arch.system "API"
          data: arch.database "Data"
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
        update api { tone = warning; title = "API v2" }
        delete obsolete
        add { review: rectangle "Requires review" { at = (80, 80) } }
      }
    }
  `);
  assert.equal(document.operation.type, "patch");
  if (document.operation.type !== "patch") throw new Error("expected patch operation");
  assert.deepEqual(document.operation.updates, [{
    target: "api", properties: { tone: "warning", title: "API v2" },
  }]);
  assert.deepEqual(document.operation.deletes, ["obsolete"]);
  const additions = document.operation.additions;
  assert.ok(additions);
  assert.equal(additions.statements[0]?.type, "node");
  assert.equal(additions.statements[0]?.type === "node" ? additions.statements[0].id : undefined, "review");
  assert.equal(additions.title, undefined);
});

test("scene additions support imported constructors without synthetic titles", () => {
  const document = parseSceneDocument(`
    scene excalidraw::default::examples::overview {
      patch {
        add {
          use "xdraw/architecture" as arch
          api: arch.system "API"
        }
      }
    }
  `);
  assert.equal(document.operation.type, "patch");
  if (document.operation.type !== "patch") throw new Error("expected patch operation");
  const additions = document.operation.additions;
  assert.ok(additions);
  const drawing = compile(additions).toJSON();
  assert.equal(additions.title, undefined);
  assert.equal(drawing.elements.some((element) => element.id === "document:title"), false);
  assert.ok(drawing.elements.some((element) => element.id === "api:frame"));
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
    () => parseSceneDocument("scene excalidraw::default::main::one { patch { update api { tone = warning } delete api } }"),
    /cannot update and delete 'api'/,
  );
});

test("scene document boundaries reject malformed external input", () => {
  assert.throws(() => parseSceneDocument(null as never), /source must be a string/);
  assert.throws(
    () => formatSceneResource({ provider: "excalidraw", workspace: "", collection: "main", scene: "one" }),
    /segments must be non-empty strings/,
  );
  assert.throws(
    () => formatSceneResource({ provider: "other", workspace: "default", collection: "main", scene: "one" } as never),
    /unsupported scene provider 'other'/,
  );
  assert.throws(
    () => parseSceneDocument("scene excalidraw::default::main::one { patch { update api { width = wide } } }"),
    /update property 'width' requires a number/,
  );
  assert.throws(
    () => parseSceneDocument("scene excalidraw::default::main::one { patch { update api { tone = urgent } } }"),
    /unsupported tone 'urgent'/,
  );
  assert.throws(
    () => parseSceneDocument("scene excalidraw::default::main::one { patch { update api { tone warning } } }"),
    /expected '=' after update property 'tone'/,
  );
});
