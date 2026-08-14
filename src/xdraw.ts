#!/usr/bin/env node

import { run } from "./cli.ts";

try {
  const output = await run(process.argv.slice(2));
  process.stdout.write(`${output}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`xdraw: ${message}\n`);
  process.exitCode = 1;
}
