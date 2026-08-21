import assert from "node:assert/strict";
import test from "node:test";

import { run } from "../src/cli.ts";
import { formatDiagnostic, renderDiagnostics } from "../src/io/diagnostics.ts";
import type { Diagnostic } from "../src/contracts/foundation.ts";

const RAISED_GAP = `diagram "gap" {
  lane: frame "Lane" {
    arrange column { gap = 10 }
    one: rectangle "One" { size = (300, 90) }
    two: rectangle "Two" { size = (300, 90) }
    one@south -> two@north "waits for the first to finish"
  }
}`;

const SAMPLE: readonly Diagnostic[] = [
  {
    code: "XD2001",
    severity: "warning",
    message: "layout gap 10 was raised to 66 so connector labels fit",
    location: { line: 3, column: 5 },
    measures: { requested: 10, resolved: 66 },
  },
  {
    code: "XD2006",
    severity: "warning",
    message: "'a' and 'b' share a row but differ in height",
    location: null,
    subjects: ["a", "b"],
    suggestion: "match-size (a, b) height",
  },
];

function stderrOf(): { sink: NodeJS.WritableStream; text: () => string } {
  const chunks: string[] = [];
  return {
    sink: { write: (chunk: string) => { chunks.push(String(chunk)); return true; } } as unknown as NodeJS.WritableStream,
    text: () => chunks.join(""),
  };
}

test("nothing is written when there is nothing to report", () => {
  assert.equal(renderDiagnostics([], "text"), "");
  assert.equal(renderDiagnostics([], "json"), "");
});

test("the text rendering is the one every call site printed by hand", () => {
  assert.equal(renderDiagnostics(SAMPLE, "text"), `${SAMPLE.map(formatDiagnostic).join("\n")}\n`);
});

test("the json rendering is one object per line", () => {
  const lines = renderDiagnostics(SAMPLE, "json").trimEnd().split("\n");
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.code, "XD2001");
  assert.equal(first.severity, "warning");
  assert.deepEqual(first.measures, { requested: 10, resolved: 66 });
  assert.deepEqual(first.location, { line: 3, column: 5 });
});

test("json carries the rendered text so a consumer need not reimplement it", () => {
  const lines = renderDiagnostics(SAMPLE, "json").trimEnd().split("\n");
  assert.equal(JSON.parse(lines[0]).rendered, formatDiagnostic(SAMPLE[0]));
  assert.equal(JSON.parse(lines[1]).rendered, formatDiagnostic(SAMPLE[1]));
});

test("json carries subjects and a suggestion when a diagnostic has them", () => {
  const second = JSON.parse(renderDiagnostics(SAMPLE, "json").trimEnd().split("\n")[1]);
  assert.deepEqual(second.subjects, ["a", "b"]);
  assert.equal(second.suggestion, "match-size (a, b) height");
  assert.equal(second.location, null);
});

test("the CLI emits machine-readable diagnostics on request", async () => {
  const captured = stderrOf();
  await run(["check", "-e", RAISED_GAP, "--diagnostics", "json"], { stderr: captured.sink });
  const lines = captured.text().trimEnd().split("\n");
  assert.equal(lines.length, 1);
  const item = JSON.parse(lines[0]);
  assert.equal(item.code, "XD2001");
  assert.deepEqual(item.measures, { requested: 10, resolved: 66 });
});

test("the CLI still prints prose by default", async () => {
  const captured = stderrOf();
  await run(["check", "-e", RAISED_GAP], { stderr: captured.sink });
  assert.match(captured.text(), /^XD2001: layout gap 10 was raised to 66/u);
});

test("machine-readable diagnostics do not contaminate the scene on stdout", async () => {
  const captured = stderrOf();
  const stdout = await run(["build", "-e", RAISED_GAP, "-o", "-", "--diagnostics", "json"], { stderr: captured.sink });
  assert.equal(JSON.parse(stdout).type, "excalidraw");
  assert.equal(JSON.parse(captured.text().trimEnd()).code, "XD2001");
});

test("an unknown diagnostic format is refused by name", async () => {
  await assert.rejects(
    run(["check", "-e", RAISED_GAP, "--diagnostics", "yaml"]),
    /--diagnostics expects text or json/u,
  );
});
