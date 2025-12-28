#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import minimist from 'minimist';

const argv = minimist(process.argv.slice(2), {
  boolean: ['skip-bench', 'skip-script-coverage'],
  default: { 'skip-bench': false, 'skip-script-coverage': false }
});

const root = process.cwd();
const run = (label, args) => {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

if (!argv['skip-script-coverage']) {
  run('script-coverage-test', [path.join(root, 'tests', 'script-coverage.js')]);
}

if (!argv['skip-bench']) {
  run('bench', [
    path.join(root, 'tests', 'bench.js'),
    '--build',
    '--stub-embeddings',
    '--backend',
    'all'
  ]);
}

console.log('All tests completed.');
