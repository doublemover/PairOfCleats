#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseBenchLanguageArgs } from '../../../tools/bench/language/cli.js';
import { buildBenchChildArgs } from '../../../tools/bench/language-repos/run-loop.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cacheParent = resolveTestCachePath(root, 'language-no-ann-forwarding');
await fs.mkdir(cacheParent, { recursive: true });
const fixture = await fs.mkdtemp(path.join(cacheParent, 'run-'));
const repo = path.join(fixture, 'repos', 'javascript', 'test__no-ann');
const dictionary = path.join(fixture, 'dictionary');
const results = path.join(fixture, 'results');
await Promise.all([repo, dictionary, results].map(dir => fs.mkdir(dir, { recursive: true })));
const queries = path.join(fixture, 'queries.txt');
const configPath = path.join(fixture, 'catalog.json');
const config = {
  quality: 'fast', threads: 1,
  runtime: { maxOldSpaceMb: 512, uvThreadpoolSize: 1, ioOversubscribe: false },
  tooling: { autoInstallOnDetect: false, autoEnableOnDetect: false, allowGlobalFallback: false, lsp: { enabled: false } },
  indexing: {
    concurrency: 1, importConcurrency: 1, ioConcurrencyCap: 1,
    treeSitter: { enabled: false },
    scm: { provider: 'none' }, workerPool: { enabled: false, maxWorkers: 1 },
    embeddings: { enabled: false, mode: 'off', concurrency: 1, hnsw: { enabled: false }, lancedb: { enabled: false } },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false
  }
};
await Promise.all([
  fs.writeFile(path.join(repo, 'source.js'), 'export function cacheRefresh(value) { return value; }\n'),
  fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify(config)),
  fs.writeFile(path.join(dictionary, 'en.txt'), 'cache\nclear\nentry\nrefresh\nrecord\nvalue\n'),
  fs.writeFile(queries, 'cacheRefresh\n'),
  fs.writeFile(configPath, JSON.stringify({ javascript: { label: 'JavaScript', queries, repos: { small: ['test/no-ann'] } } }))
]);
const args = [
  '--config', configPath, '--root', path.join(fixture, 'repos'),
  '--results', results, '--cache-root', path.join(fixture, 'cache'),
  '--resource-root', path.join(fixture, 'home'), '--no-clone', '--no-provision',
  // Exercise the real sparse build and query without an unrelated SQLite build.
  '--build-index', '--stub-embeddings', '--no-ann', '--backend', 'memory',
  '--threads', '1', '--heap-mb', '512', '--limit', '1', '--quiet', '--progress', 'off',
  '--out', path.join(results, 'receipt.json')
];
const { argv } = parseBenchLanguageArgs(args);
assert.equal(argv.ann, false);
// Exercise the same parser-to-child command owner as the campaign. The fixture
// owns its tiny repository and needs no campaign provisioning or six unrelated
// guardrail snapshots inside the sparse build/query's unchanged 25-second limit.
const childReport = path.join(results, 'child.json');
const childArgs = buildBenchChildArgs({
  benchScript: path.join(root, 'tests/perf/bench/run.test.js'),
  repoPath: repo, queriesPath: queries, outFile: childReport,
  autoBuildIndex: false, autoBuildSqlite: false,
  buildRequested: Boolean(argv.build), buildIndexFlag: Boolean(argv['build-index']),
  buildSqliteFlag: Boolean(argv['build-sqlite']), argv, effectiveThreads: Number(argv.threads)
});
// Keep the memory-only child from eagerly loading the unrelated SQLite builder.
const importGuard = path.join(fixture, 'memory-import-guard.mjs');
const sqliteBuilderUrl = pathToFileURL(path.join(root, 'tests/helpers/sqlite-builder.js')).href;
await fs.writeFile(importGuard, `
  import { registerHooks } from 'node:module';
  registerHooks({ load(url, context, nextLoad) {
    if (url === ${JSON.stringify(sqliteBuilderUrl)}) {
      throw new Error('Memory-only bench must not load the SQLite build pipeline');
    }
    return nextLoad(url, context);
  } });
`);
const result = runNode(childArgs, 'real no-ANN language child', root, applyTestEnv({
  cacheRoot: path.join(fixture, 'cache'),
  syncProcess: false,
  testConfig: { indexing: { artifacts: { binaryColumnar: false } }, sqlite: { use: false } },
  extraEnv: {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(importGuard).href}`.trim(),
    PAIROFCLEATS_HOME: path.join(fixture, 'home'),
    PAIROFCLEATS_DICT_DIR: dictionary,
    PAIROFCLEATS_WORKER_POOL: 'off', PAIROFCLEATS_EMBEDDINGS: 'off',
    UV_THREADPOOL_SIZE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1'
  }
}), { timeoutMs: 25000, stdio: 'pipe' });
const child = JSON.parse(await fs.readFile(childReport, 'utf8'));
assert.equal(result.status, 0, 'the real forwarded child must succeed');
assert.equal(child.artifacts.corruption.ok, true, 'the real sparse artifacts must pass validation');
assert.ok(child.summary.buildMs.index > 0, 'the fixture must run the real sparse index build');
assert.equal(child.summary.buildMs.sqlite, undefined, 'memory-only coverage must not build SQLite');
assert.equal(child.summary.queryCoverage.executedSearchesByBackend.memory, 1);
assert.equal(child.summary.resultCountAvg.memory, 1);
assert.equal(child.summary.annEnabled, false);
assert.equal(child.summary.queryCapabilities.annRequested, false);
const capability = child.summary.queryCapabilities.byBackend.memory;
assert.ok(capability.annStages > 0, 'actual stage diagnostics must be present');
assert.equal(capability.annSources.none, capability.annStages);
assert.equal(capability.vectorEligibleStages, 0);
assert.equal(capability.vectorResultStages, 0);
assert.equal(capability.minhashResultStages, 0);
console.log('language parser-to-child no-ANN forwarding passed with a real nonempty sparse query');
