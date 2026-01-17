#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.PAIROFCLEATS_BENCH_RUN) {
  console.log('[skip] set PAIROFCLEATS_BENCH_RUN=1 to run bench scenarios');
  process.exit(0);
}

const runPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'run.test.js');
const baseArgs = [
  runPath,
  '--backend',
  'memory',
  '--limit',
  '3',
  '--top',
  '5'
];

for (const annArg of ['--ann', '--no-ann']) {
  const result = spawnSync(process.execPath, [...baseArgs, annArg], {
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('ANN on/off bench scenarios ok.');
