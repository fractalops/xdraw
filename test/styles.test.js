import assert from "node:assert/strict";
import test from "node:test";

import { compile } from "../src/compiler.js";
import { parse } from "../src/parser.js";
import { buildSemanticIR } from "../src/semantic.js";
import { createStyleResolver } from "../src/styles.js";
import { createMeasurer } from "../src/measurement.js";

function semantic(source) {
  return buildSemanticIR(parse(source));
}

test("style precedence is theme, semantic kind, named style, then local attributes", () => {
  const document = semantic(`diagram "Styles" {
    theme { stroke "#111111" font-family normal title-size 16 }
    style emphasis { stroke "#222222" title-size 20 }
    service: system "Service" [style=emphasis, stroke="#333333", title-size=24]
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
    () => semantic('diagram "Styles" { item: card "Item" [style=missing] }'),
    /XD1004: unknown style 'missing'/,
  );
});

test("ellipse nodes compile with styled, linked and locked text", () => {
  const drawing = compile(parse(`diagram "Styles" {
    style focus { background "#ecfdf5" stroke "#059669" text "#065f46" font-family normal }
    target: ellipse "Target" [style=focus, link="https://example.com", locked]
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

test("free text supports named wrapping, font and lock controls", () => {
  const drawing = compile(parse(`diagram "Text" {
    style caption { font-family normal font-size 20 wrap-width 140 auto-size false locked true }
    text caption_text "A deliberately long caption" at (20, 30) [style=caption]
  }`)).toJSON();
  const label = drawing.elements.find((item) => item.id === "caption_text");

  assert.equal(label.width, 140);
  assert.equal(label.fontFamily, 2);
  assert.equal(label.fontSize, 20);
  assert.equal(label.autoResize, false);
  assert.equal(label.locked, true);
  assert.match(label.text, /\n/);
});

test("unsupported style properties fail clearly", () => {
  const document = semantic('diagram "Styles" { style broken { glow true } item: card "Item" [style=broken] }');
  assert.throws(() => createStyleResolver(document), /unsupported style property: glow/);
});

test("styles and themes are document-scoped and themes are singular", () => {
  assert.throws(
    () => semantic('diagram "Nested" { lane l "Lane" { style inner { stroke "#111111" } item: card "Item" [style=inner] } }'),
    /XD1005: styles may only be declared at document scope/,
  );
  assert.throws(
    () => semantic('diagram "Nested" { lane l "Lane" { theme { font-family normal } item: card "Item" } }'),
    /XD1006: themes may only be declared at document scope/,
  );
  assert.throws(
    () => semantic('diagram "Themes" { theme { font-family normal } theme { font-family code } }'),
    /XD1007: a document may declare only one theme/,
  );
});

test("local free-text attributes override positional modifiers", () => {
  const document = semantic('diagram "Text" { text label "Text" at (0, 0) font 10 [font-size=30] }');
  const statement = document.statements.find((item) => item.id === "label");
  assert.equal(createStyleResolver(document).resolveText(statement).fontSize, 30);
});

test("free-text precedence covers booleans, links, line height and positional modifiers", () => {
  const document = semantic(`diagram "Text" {
    theme { font-family normal }
    style caption { font-size 20 line-height 1.4 locked false link "https://example.com/named" }
    text label "Text" at (0, 0) font 10 [style=caption, font-size=30, line-height=1.8, locked, link="https://example.com/local"]
  }`);
  const statement = document.statements.find((item) => item.id === "label");
  const style = createStyleResolver(document).resolveText(statement);
  assert.deepEqual(
    { fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight, locked: style.locked, link: style.link },
    { fontFamily: 2, fontSize: 30, lineHeight: 1.8, locked: true, link: "https://example.com/local" },
  );
});

test("styles reject properties that do not apply to their target", () => {
  const nodeDocument = semantic('diagram "Node" { item: card "Item" [font-size=30] }');
  const node = nodeDocument.statements.find((item) => item.id === "item");
  assert.throws(() => createStyleResolver(nodeDocument).resolveNode(node), /do not apply to nodes: fontSize/);

  const textDocument = semantic('diagram "Text" { text label "Text" at (0, 0) [stroke="#111111"] }');
  const label = textDocument.statements.find((item) => item.id === "label");
  assert.throws(() => createStyleResolver(textDocument).resolveText(label), /do not apply to free text: strokeColor/);
});

test("theme properties apply only to compatible targets", () => {
  const document = semantic('diagram "Theme" { theme { font-size 24 } item: card "Item"; text caption "Caption" at (0,0) }');
  const resolver = createStyleResolver(document);
  assert.equal(resolver.resolveNode(document.statements.find((item) => item.id === "item")).titleSize, 19);
  assert.equal(resolver.resolveText(document.statements.find((item) => item.id === "caption")).fontSize, 24);
});

test("explicit neutral tone overrides typed node defaults", () => {
  const result = compile(parse('implicit: person "Implicit"; explicit: person "Explicit" neutral')).toJSON();
  assert.equal(result.elements.find((item) => item.id === "implicit:frame").strokeColor, "#7c3aed");
  assert.equal(result.elements.find((item) => item.id === "explicit:frame").strokeColor, "#94a3b8");
});

test("links require a safe portable protocol", () => {
  for (const link of ["javascript:alert(1)", "file:///tmp/private", "relative/path"]) {
    const document = semantic(`diagram "Link" { item: card "Item" [link="${link}"] }`);
    const node = document.statements.find((item) => item.id === "item");
    assert.throws(() => createStyleResolver(document).resolveNode(node), /unsupported link protocol|invalid link/);
  }
});

test("node line height is shared by measurement and every rendered text mode", () => {
  const source = `diagram "Lines" {
    style spacious { line-height 1.8 }
    simple: ellipse "Two line title" [style=spacious]
    rich: card "Two line title" [style=spacious] { body "Two line body" }
    choice: decision "Two line title" [style=spacious]
  }`;
  const document = semantic(source);
  const styles = createStyleResolver(document);
  const measurer = createMeasurer(styles);
  const rich = document.statements.find((item) => item.id === "rich");
  assert.ok(measurer.measureNode(rich, 180) > createMeasurer().measureNode(rich, 180));

  const elements = compile(parse(source)).toJSON().elements;
  for (const id of ["simple:title", "rich:title", "rich:body", "choice:title"]) {
    assert.equal(elements.find((item) => item.id === id).lineHeight, 1.8);
  }
});
