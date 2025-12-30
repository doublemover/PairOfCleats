#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import minimist from 'minimist';

const argv = minimist(process.argv.slice(2), {
  boolean: ['skip-bench', 'skip-script-coverage'],
  default: { 'skip-bench': false, 'skip-script-coverage': false }
});

const envSkipBench = process.env.PAIROFCLEATS_SKIP_BENCH === 'true'
  || process.env.PAIROFCLEATS_SKIP_BENCH === '1'
  || process.env.npm_config_skip_bench === 'true'
  || process.env.npm_config_skip_bench === '1';
const envSkipScript = process.env.PAIROFCLEATS_SKIP_SCRIPT_COVERAGE === 'true'
  || process.env.PAIROFCLEATS_SKIP_SCRIPT_COVERAGE === '1'
  || process.env.npm_config_skip_script_coverage === 'true'
  || process.env.npm_config_skip_script_coverage === '1';
const skipBench = argv['skip-bench'] || envSkipBench;
const skipScriptCoverage = argv['skip-script-coverage'] || envSkipScript;

const root = process.cwd();
const run = (label, args) => {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

if (!skipScriptCoverage) {
  run('script-coverage-test', [path.join(root, 'tests', 'script-coverage.js')]);
}

if (!skipBench) {
  run('bench', [
    path.join(root, 'tests', 'bench.js'),
    '--build',
    '--stub-embeddings',
    '--backend',
    'all'
  ]);
}

console.log('All tests completed.');
