#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCli } from '../src/shared/cli.js';

const argv = createCli({
  scriptName: 'test-all',
  options: {
    'skip-bench': { type: 'boolean', default: false },
    'skip-script-coverage': { type: 'boolean', default: false },
    retries: { type: 'number', default: 2 },
    'log-dir': { type: 'string', default: '' }
  }
}).parse();

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
if (skipBench) {
  process.env.PAIROFCLEATS_SKIP_SQLITE_INCREMENTAL = '1';
}

const root = process.cwd();
const run = (label, args) => {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

if (!skipScriptCoverage) {
  const args = [path.join(root, 'tests', 'script-coverage.js')];
  const passRetries = process.argv.some((arg) => arg === '--retries' || arg.startsWith('--retries='));
  if (passRetries) {
    args.push('--retries', String(argv.retries));
  }
  if (argv['log-dir']) {
    args.push('--log-dir', argv['log-dir']);
  }
  run('script-coverage-test', args);
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
