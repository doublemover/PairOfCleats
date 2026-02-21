#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../helpers/root.js';

const ROOT = repoRoot();
const runnerPath = path.join(ROOT, 'tests', 'run.js');

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-coverage-equals-'));
const coveragePath = path.join(tmpDir, 'coverage.json');

const result = spawnSync(process.execPath, [
  runnerPath,
  '--lane',
  'all',
  '--match',
  'harness/pass-target',
  `--coverage=${coveragePath}`,
  '--json'
], {
  encoding: 'utf8'
});

if (result.status !== 0) {
  console.error('coverage equals-form test failed: runner exited non-zero');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

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
