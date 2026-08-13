import assert from "node:assert/strict";
import test from "node:test";

import { compile } from "../src/compiler.ts";
import { createMeasurer } from "../src/measurement.ts";
import { buildSemanticIR } from "../src/semantic.ts";
import { parseSource } from "../src/source-language.ts";
import { createStyleResolver } from "../src/styles.ts";

function semantic(source) {
  return buildSemanticIR(parseSource(source));
}

test("style precedence is theme, semantic kind, named style, then local properties", () => {
  const document = semantic(`use "xdraw/architecture" as arch
    diagram "Styles" {
      base: theme { stroke "#111111"; font-family normal; title-size 16 }
      emphasis: style { stroke "#222222"; title-size 20 }
      service: arch.system "Service" { style emphasis; stroke "#333333"; title-size 24 }
    }`);
  const node = document.statements.find((item) => item.id === "service");
  const style = createStyleResolver(document).resolveNode(node);
  assert.equal(style.strokeColor, "#333333");
  assert.equal(style.titleSize, 24);
  assert.equal(style.fontFamily, 2);
  assert.equal(style.backgroundColor, "#dbeafe");
});

test("unknown named styles are rejected during semantic validation", () => {
  assert.throws(
    () => semantic('diagram "Styles" { item: rectangle "Item" { style missing } }'),
    /XD1004: unknown style 'missing'/,
  );
});

test("ellipse nodes compile with styled, linked, and locked text", () => {
  const drawing = compile(parseSource(`diagram "Styles" {
    focus: style { background "#ecfdf5"; stroke "#059669"; text-color "#065f46"; font-family normal }
    target: ellipse "Target" { style focus; link "https://example.com"; locked true }
  }`)).toJSON();
  const frame = drawing.elements.find((item) => item.id === "target:frame");
  const label = drawing.elements.find((item) => item.id === "target:title");
  assert.equal(frame.type, "ellipse");
  assert.equal(frame.backgroundColor, "#ecfdf5");
  assert.equal(frame.link, "https://example.com");
  assert.equal(frame.locked, true);
  assert.equal(label.fontFamily, 2);
  assert.equal(label.locked, true);
});

test("free text supports named wrapping, font, and lock controls", () => {
  const drawing = compile(parseSource(`diagram "Text" {
    caption: style { font-family normal; font-size 20; wrap-width 140; auto-size false; locked true }
    caption_text: text "A deliberately long caption" { at (20, 30); style caption }
  }`)).toJSON();
  const label = drawing.elements.find((item) => item.id === "caption_text");
  assert.equal(label.width, 140);
  assert.equal(label.fontFamily, 2);
  assert.equal(label.fontSize, 20);
  assert.equal(label.autoResize, false);
  assert.equal(label.locked, true);
  assert.match(label.text, /\n/);
});

test("styles and themes are document-scoped and themes are singular", () => {
  assert.throws(
    () => semantic('diagram "Nested" { box: frame "Box" { inner: style { stroke "#111111" }; item: rectangle "Item" { style inner } } }'),
    /XD1005: styles may only be declared at document scope/,
  );
  assert.throws(
    () => semantic('diagram "Nested" { box: frame "Box" { base: theme { font-family normal }; item: rectangle "Item" } }'),
    /XD1006: themes may only be declared at document scope/,
  );
  assert.throws(
    () => semantic('diagram "Themes" { first: theme { font-family normal }; second: theme { font-family code } }'),
    /XD1007: a document may declare only one theme/,
  );
});

test("local free-text properties override named styles and themes", () => {
  const document = semantic(`diagram "Text" {
    base: theme { font-family normal }
    caption: style { font-size 20; line-height 1.4; locked false; link "https://example.com/named" }
    label: text "Text" {
      at (0, 0); style caption; font-size 30; line-height 1.8; locked true; link "https://example.com/local"
    }
  }`);
  const statement = document.statements.find((item) => item.id === "label");
  const style = createStyleResolver(document).resolveText(statement);
  assert.deepEqual(
    { fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight, locked: style.locked, link: style.link },
    { fontFamily: 2, fontSize: 30, lineHeight: 1.8, locked: true, link: "https://example.com/local" },
  );
});

test("style properties apply only to compatible targets", () => {
  const nodeDocument = semantic('diagram "Node" { item: rectangle "Item" { font-size 30 } }');
  const node = nodeDocument.statements.find((item) => item.id === "item");
  assert.throws(() => createStyleResolver(nodeDocument).resolveNode(node), /do not apply to nodes: fontSize/);

  const textDocument = semantic('diagram "Text" { label: text "Text" { at (0, 0); stroke "#111111" } }');
  const label = textDocument.statements.find((item) => item.id === "label");
  assert.throws(() => createStyleResolver(textDocument).resolveText(label), /do not apply to free text: strokeColor/);
});

test("theme properties apply only to compatible targets", () => {
  const document = semantic('diagram "Theme" { base: theme { font-size 24 }; item: rectangle "Item"; caption: text "Caption" { at (0,0) } }');
  const resolver = createStyleResolver(document);
  assert.equal(resolver.resolveNode(document.statements.find((item) => item.id === "item")).titleSize, 19);
  assert.equal(resolver.resolveText(document.statements.find((item) => item.id === "caption")).fontSize, 24);
});

test("explicit neutral palette overrides semantic node defaults", () => {
  const result = compile(parseSource(`use "xdraw/architecture" as arch
    use "xdraw/palette" as palette
    diagram "Palette" {
      implicit: arch.person "Implicit"
      explicit: arch.person "Explicit" { style palette.neutral }
    }`)).toJSON();
  assert.equal(result.elements.find((item) => item.id === "implicit:frame").strokeColor, "#7c3aed");
  assert.equal(result.elements.find((item) => item.id === "explicit:frame").strokeColor, "#94a3b8");
});

test("extension-defined node kinds use the neutral palette by default", () => {
  const document = semantic('diagram "Extension" { item: rectangle "Item" }');
  const style = createStyleResolver(document).resolveNode({
    kind: "extension-shape",
    title: "Extension shape",
  });
  assert.equal(style.strokeColor, "#94a3b8");
  assert.equal(style.backgroundColor, "#f8fafc");
});

test("links require a safe portable protocol", () => {
  for (const link of ["javascript:alert(1)", "file:///tmp/private", "relative/path"]) {
    const document = semantic(`diagram "Link" { item: rectangle "Item" { link "${link}" } }`);
    const node = document.statements.find((item) => item.id === "item");
    assert.throws(() => createStyleResolver(document).resolveNode(node), /unsupported link protocol|invalid link/);
  }
});

test("style values reject invalid colors and non-finite numbers", () => {
  const invalidColor = semantic('diagram "Color" { item: rectangle "Item" }');
  const colorNode = invalidColor.statements.find((item) => item.id === "item");
  colorNode.attributes.stroke = 12;
  assert.throws(() => createStyleResolver(invalidColor).resolveNode(colorNode), /stroke must be a string/);

  const document = semantic('diagram "Numbers" { item: rectangle "Item" }');
  const node = document.statements.find((item) => item.id === "item");
  node.attributes.roughness = Number.POSITIVE_INFINITY;
  assert.throws(() => createStyleResolver(document).resolveNode(node), /roughness must not be negative/);
});

test("line height is shared by measurement and rendered text", () => {
  const source = `diagram "Lines" {
    spacious: style { line-height 1.8 }
    simple: ellipse "Two line title" { style spacious }
    rich: rectangle "Two line title" { style spacious; body "Two line body" }
    choice: diamond "Two line title" { style spacious }
  }`;
  const document = semantic(source);
  const styles = createStyleResolver(document);
  const rich = document.statements.find((item) => item.id === "rich");
  assert.ok(createMeasurer(styles).measureNode(rich, 180) > createMeasurer().measureNode(rich, 180));
  const elements = compile(parseSource(source)).toJSON().elements;
  for (const id of ["simple:title", "rich:title", "rich:body", "choice:title"]) {
    assert.equal(elements.find((item) => item.id === id).lineHeight, 1.8);
  }
});
