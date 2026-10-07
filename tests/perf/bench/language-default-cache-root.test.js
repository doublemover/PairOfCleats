#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { BENCH_REPO_TIMEOUT_DEFAULT_MS, parseBenchLanguageArgs } from '../../../tools/bench/language/cli.js';
import { getCacheRoot } from '../../../tools/shared/dict-utils.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const expectedDefault = path.resolve(path.join(getCacheRoot(), 'bench-language'));
const parsedDefault = parseBenchLanguageArgs([]);
assert.equal(
  parsedDefault.cacheRoot,
  expectedDefault,
  `expected bench-language default cache root to use shared cache helper (${expectedDefault})`
);
assert.equal(
  parsedDefault.benchTimeoutMs,
  BENCH_REPO_TIMEOUT_DEFAULT_MS,
  'expected bench-language default timeout to use bounded repo runtime cap'
);

const explicitRoot = resolveTestCachePath(process.cwd(), 'bench-language-explicit-cache-root');
const parsedExplicit = parseBenchLanguageArgs([
  '--cache-root',
  explicitRoot,
  '--timeout-ms',
  '42000'
]);
assert.equal(
  parsedExplicit.cacheRoot,
  path.resolve(explicitRoot),
  'expected explicit --cache-root to override shared default'
);
assert.equal(
  parsedExplicit.benchTimeoutMs,
  42000,
  'expected explicit --timeout-ms to override default bench repo timeout'
);

const parsedCold = parseBenchLanguageArgs([
  '--cache-root',
  explicitRoot,
  '--mode',
  'cold'
]);
assert.match(
  parsedCold.cacheRoot,
  /bench-language-explicit-cache-root[\\/]cold[\\/]/,
  'expected cold mode to use an isolated cold-cache namespace'
);

const parsedTooling = parseBenchLanguageArgs([
  '--cache-root',
  explicitRoot,
  '--mode',
  'tooling'
]);
assert.equal(
  parsedTooling.cacheRoot,
  path.resolve(explicitRoot, 'tooling'),
  'expected tooling mode to use a dedicated tooling cache namespace'
);

// Help exits after real CLI initialization, so this probes launch authority
// without cloning repositories, building indexes, or loading embedding models.
const launchEnv = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: explicitRoot,
  PAIROFCLEATS_MODELS_DIR: path.join(explicitRoot, 'models'),
  PAIROFCLEATS_THREADS: '8'
};
delete launchEnv.PAIROFCLEATS_TESTING;
delete launchEnv.PAIROFCLEATS_TEST_CONFIG;
delete launchEnv.PAIROFCLEATS_EMBEDDINGS;
const probe = "process.on('exit',()=>console.log('ENV_PROBE:'+JSON.stringify({cacheRoot:process.env.PAIROFCLEATS_CACHE_ROOT,modelsDir:process.env.PAIROFCLEATS_MODELS_DIR,threads:process.env.PAIROFCLEATS_THREADS,testing:process.env.PAIROFCLEATS_TESTING,testConfig:process.env.PAIROFCLEATS_TEST_CONFIG})));";
const probeImport = `data:text/javascript,${encodeURIComponent(probe)}`;
const runLaunchProbe = (script, args) => {
  const result = spawnSync(process.execPath, ['--import', probeImport, script, ...args], {
    cwd: process.cwd(),
    env: launchEnv,
    encoding: 'utf8',
    timeout: 20000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const line = result.stdout.split(/\r?\n/).find((entry) => entry.startsWith('ENV_PROBE:'));
  assert.ok(line, 'launch environment probe must finish');
  return JSON.parse(line.slice('ENV_PROBE:'.length));
};
const benchmarkLaunch = runLaunchProbe('tests/perf/bench/run.test.js', ['--help']);
assert.deepEqual(benchmarkLaunch, {
  cacheRoot: explicitRoot,
  modelsDir: launchEnv.PAIROFCLEATS_MODELS_DIR,
  threads: '8'
}, 'normal benchmarks must preserve launch settings without injecting fast fixture config');
const cliSelectedRoot = path.join(explicitRoot, 'cli-selected');
const languageLaunch = runLaunchProbe('tools/bench/language-repos.js', [
  '--tier', 'small', '--list', '--json', '--cache-root', cliSelectedRoot
]);
assert.equal(languageLaunch.cacheRoot, cliSelectedRoot, 'explicit CLI cache root must reach runtime config and children');
assert.equal(languageLaunch.modelsDir, launchEnv.PAIROFCLEATS_MODELS_DIR);
console.log('bench-language default cache root test passed');
