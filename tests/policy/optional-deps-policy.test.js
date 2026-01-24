#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const runSnippet = (envOverrides) => spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    "import('./tests/helpers/require-or-skip.js').then(({ requireOrSkip }) => { requireOrSkip({ capability: 'missing-cap', reason: 'missing-capability', requiredInCi: true }); });"
  ],
  {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...envOverrides }
  }
);

const optionalResult = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    "import('./tests/helpers/require-or-skip.js').then(({ requireOrSkip }) => { requireOrSkip({ capability: 'missing-cap', reason: 'missing-capability' }); });"
  ],
  {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env }
  }
);

if (optionalResult.status !== 77) {
  console.error('optional deps policy failed: expected skip exit code');
  process.exit(1);
}

const requiredResult = runSnippet({ CI: 'true' });
if (requiredResult.status === 0 || requiredResult.status === 77) {
  console.error('optional deps policy failed: required capability should fail in CI');
  process.exit(1);
}

console.log('optional deps policy test passed');
