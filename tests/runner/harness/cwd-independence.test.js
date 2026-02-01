#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { repoRoot } from '../../helpers/root.js';

const ROOT = repoRoot();
const testsDir = path.join(ROOT, 'tests');
const target = path.join(ROOT, 'tests', 'tooling', 'config', 'config-validate.test.js');

const result = spawnSync(process.execPath, [target], {
  cwd: testsDir,
  encoding: 'utf8'
});

if (result.status !== 0) {
  console.error('cwd independence test failed');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

console.log('cwd independence test passed');
