#!/usr/bin/env node
// The `oracular` bin. All the work is in run.ts, which tests drive directly.
import { readFileSync } from 'node:fs';
import { run } from './run';

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readFile: (path) => readFileSync(path, 'utf8'),
  cwd: process.cwd(),
});
