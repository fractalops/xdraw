#!/usr/bin/env node

import { run } from "../src/cli.js";

try {
  const output = await run(process.argv.slice(2));
  process.stdout.write(`${output}\n`);
} catch (error) {
  process.stderr.write(`xdraw: ${error.message}\n`);
  process.exitCode = 1;
}
