#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.PAIROFCLEATS_BENCH_RUN) {
  console.log('[skip] set PAIROFCLEATS_BENCH_RUN=1 to run bench scenarios');
  process.exit(0);
}

const runPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'run.test.js');
const scenarios = [
  {
    label: 'ann-on',
    args: ['--backend', 'memory', '--limit', '3', '--top', '5', '--ann']
  },
  {
    label: 'ann-off',
    args: ['--backend', 'memory', '--limit', '3', '--top', '5', '--no-ann']
  },
  {
    label: 'bm25-params',
    args: ['--backend', 'memory', '--limit', '5', '--top', '5', '--bm25-k1', '1.6', '--bm25-b', '0.75']
  },
  {
    label: 'memory-vs-sqlite',
    args: ['--backend', 'memory,sqlite', '--limit', '5', '--top', '5']
  },
  {
    label: 'sqlite-fts',
    args: ['--backend', 'sqlite-fts', '--limit', '5', '--top', '5']
  }
];

for (const scenario of scenarios) {
  const result = spawnSync(process.execPath, [runPath, ...scenario.args], {
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('bench scenario matrix ok.');
