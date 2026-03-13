#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();

const root = process.cwd();
const binPath = path.join(root, 'bin', 'pairofcleats.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-wrapper-exit-'));

const runCli = (args) => spawnSync(process.execPath, [binPath, ...args], {
  encoding: 'utf8',
  env: process.env
});

const graphContext = runCli([
  'graph-context',
  '--json',
  '--repo', tempRoot,
  '--seed', 'file:src/app.js'
]);
assert.equal(graphContext.status, 1, 'expected graph-context wrapper to propagate emitCliError as exit 1');
assert.match(graphContext.stdout, /"code": "ERR_GRAPH_CONTEXT"/, 'expected graph-context CLI error payload');

const impact = runCli([
  'impact',
  '--json',
  '--repo', tempRoot,
  '--seed', 'file:src/app.js'
]);
assert.equal(impact.status, 1, 'expected impact wrapper to propagate emitCliError as exit 1');
assert.match(impact.stdout, /"code": "ERR_GRAPH_IMPACT"/, 'expected impact CLI error payload');

const suggestTests = runCli([
  'suggest-tests',
  '--json',
  '--repo', tempRoot,
  '--changed', 'src/app.js'
]);
assert.equal(suggestTests.status, 1, 'expected suggest-tests wrapper to propagate non-throwing failures as exit 1');
assert.match(suggestTests.stderr, /Missing --max <n>\./, 'expected suggest-tests validation error');

console.log('analysis wrapper exit propagation test passed');
