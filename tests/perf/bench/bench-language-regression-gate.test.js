#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-perf-budget-'));
const budgetPath = path.join(tempRoot, 'budget.json');

await fs.writeFile(budgetPath, JSON.stringify({
  schemaVersion: 1,
  toleranceFraction: 0,
  tests: {
    'runner/harness/copy-fixture': 5
  }
}, null, 2));

const runPath = path.join(root, 'tests', 'run.js');
const result = spawnSync(
  process.execPath,
  [runPath, '--lane', 'all', '--match', 'runner/harness/copy-fixture', '--json', '--perf-budget-file', budgetPath],
  {
    cwd: root,
    env: { ...process.env, PAIROFCLEATS_TESTING: '1' },
    encoding: 'utf8'
  }
);

assert.equal(result.status, 1, 'expected perf budget regression to fail run.js with exit code 1');
assert.equal(
  (result.stderr || '').includes('[perf] regression budget violations='),
  true,
  'expected perf budget regression diagnostics in stderr'
);

console.log('perf regression gate test passed');
