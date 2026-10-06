#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseBenchLanguageArgs } from '../../../tools/bench/language/cli.js';
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
  '--build', '--stub-embeddings', '--no-ann', '--backend', 'memory',
  '--threads', '1', '--heap-mb', '512', '--limit', '1', '--json',
  '--out', path.join(results, 'receipt.json')
];
assert.equal(parseBenchLanguageArgs(args).argv.ann, false);
runNode(['tools/bench/language-repos.js', ...args], 'real no-ANN language child', root, applyTestEnv({
  syncProcess: false,
  extraEnv: {
    PAIROFCLEATS_HOME: path.join(fixture, 'home'),
    PAIROFCLEATS_DICT_DIR: dictionary,
    PAIROFCLEATS_WORKER_POOL: 'off', PAIROFCLEATS_EMBEDDINGS: 'off',
    UV_THREADPOOL_SIZE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1'
  }
}), { timeoutMs: 25000, stdio: 'pipe' });
const receipt = JSON.parse(await fs.readFile(path.join(results, 'receipt.json'), 'utf8'));
const child = JSON.parse(await fs.readFile(path.join(results, 'javascript', 'test__no-ann.json'), 'utf8'));
assert.equal(receipt.run.aggregateResultClass, 'passed');
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
