#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'tools', 'reports', 'combined-summary.js');
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(
  source,
  /const stdio = argv\.json \? \['ignore', 'ignore', 'inherit'\] : 'inherit';/,
  'expected combined-summary JSON mode to reserve stdout for final JSON output'
);
assert.match(
  source,
  /runSubprocessOrExit\(\{[\s\S]*stdio,[\s\S]*env: baseEnv[\s\S]*\}\);/,
  'expected combined-summary to route child process stdio through json-aware policy'
);

console.log('summary-report json stdio contract test passed');
