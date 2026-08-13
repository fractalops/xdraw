#!/usr/bin/env node

import { existsSync } from "node:fs";

const sourceEntry = new URL("../src/cli.ts", import.meta.url);
const runtimeEntry = existsSync(sourceEntry)
  ? sourceEntry
  : new URL("../lib/cli.js", import.meta.url);
const { run } = await import(runtimeEntry.href);

try {
  const output = await run(process.argv.slice(2));
  process.stdout.write(`${output}\n`);
} catch (error) {
  process.stderr.write(`xdraw: ${error.message}\n`);
  process.exitCode = 1;
}
