#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'tools', 'workspace', 'build.js');
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(
  source,
  /import\s+\{\s*exitLikeCommandResult\s*\}\s+from\s+'\.\.\/shared\/cli-utils\.js';/,
  'expected workspace build CLI to import exitLikeCommandResult'
);
assert.match(
  source,
  /\bsignal,\s*\n\s*durationMs:/,
  'expected workspace build diagnostics to include signal metadata'
);
assert.match(
  source,
  /exitLikeCommandResult\(\{\s*status:\s*null,\s*signal:\s*firstSignal\s*\}\)/,
  'expected workspace build to preserve signal-based child exits'
);

console.log('workspace build signal contract test passed');
