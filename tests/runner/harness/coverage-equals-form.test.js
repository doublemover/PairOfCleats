#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { repoRoot } from '../../helpers/root.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const ROOT = repoRoot();
const runnerPath = path.join(ROOT, 'tests', 'run.js');
const env = applyTestEnv({ syncProcess: false });

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-coverage-equals-'));
const coveragePath = path.join(tmpDir, 'coverage.json');

runNode([
  runnerPath,
  '--lane',
  'all',
  '--match',
  'harness/pass-target',
  `--coverage=${coveragePath}`,
  '--json'
], 'runner coverage equals-form', ROOT, env, { stdio: 'pipe' });

let artifact;
try {
  artifact = JSON.parse(await fsPromises.readFile(coveragePath, 'utf8'));
} catch {
  console.error('coverage equals-form test failed: missing or invalid coverage artifact');
  process.exit(1);
}

if (artifact.schemaVersion !== 1 || artifact.kind !== 'v8-range-summary') {
  console.error('coverage equals-form test failed: artifact schema mismatch');
  process.exit(1);
}
if (!artifact.summary || artifact.summary.files < 1) {
  console.error('coverage equals-form test failed: expected non-empty coverage summary');
  process.exit(1);
}

await fsPromises.rm(tmpDir, { recursive: true, force: true });

console.log('coverage equals-form test passed');
