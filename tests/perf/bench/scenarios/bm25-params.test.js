#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.PAIROFCLEATS_BENCH_RUN) {
  console.log('[skip] set PAIROFCLEATS_BENCH_RUN=1 to run bench scenarios');
  process.exit(0);
}

const runPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'run.test.js');
const args = [
  runPath,
  '--backend',
  'memory',
  '--limit',
  '5',
  '--top',
  '5',
  '--bm25-k1',
  '1.6',
  '--bm25-b',
  '0.75'
];
const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
