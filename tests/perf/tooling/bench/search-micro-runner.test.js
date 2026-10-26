#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../../helpers/fast-indexing-config.js';
import { runNode } from '../../../helpers/run-node.js';
import { withMicrobenchCacheOwner } from '../../../../tools/bench/micro/cache-owner.js';
import { SEARCH_MICRO_REPORT_VERSION } from '../../../../src/contracts/search-microbenchmark.js';

const { dir } = await prepareIsolatedTestCacheDir('search-micro-runner');
const repoRoot = path.join(dir, 'repo'); await fs.mkdir(repoRoot);
await fs.writeFile(path.join(repoRoot, 'sample.js'),
  'export function microcacheprobe() { return 123; }\nexport function microcacheother() { return 456; }\n');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub',
  testConfig: createFastIndexingTestConfig({ indexing: { embeddings: { enabled: false } } }) });
runNode([path.join(process.cwd(), 'build_index.js'), '--repo', repoRoot, '--stage', 'stage2', '--mode', 'code',
  '--threads', '1', '--stub-embeddings'], 'microbench tiny index', process.cwd(), env, { stdio: 'pipe', timeoutMs: 30000 });
const { search } = await import('../../../../src/integrations/core/search.js');
const { createSqliteDbCache } = await import('../../../../src/retrieval/sqlite-cache.js');
const { runSearchBenchmark } = await import('../../../../tools/bench/micro/search.js');
const indexCache = new Map(), sqliteCache = createSqliteDbCache();
await withMicrobenchCacheOwner(sqliteCache, async () => {
  const args = { query: 'microcacheprobe', mode: 'code', backend: 'memory', ann: false, scoreMode: 'sparse',
    args: ['--stats', '--quality', 'balanced'], json: true, emitOutput: false, indexCache, sqliteCache };
  const miss = await search(repoRoot, args), hit = await search(repoRoot, args);
  assert.equal(miss.retrieval.cache.hit, false, 'fresh task-owned result cache must first execute retrieval');
  assert.equal(hit.retrieval.cache.hit, true, 'balanced repeated queries demonstrate the original cache-hit path');
  const hits = miss.code.filter(row => row.file === 'sample.js');
  assert.ok(hits.length > 0, 'independent indexed source must be retrieved before timing');
  const common = { repoRoot, query: 'microcacheprobe', mode: 'code', backend: 'memory', ann: false,
    scoreMode: 'sparse', warmRuns: 2, warmupRuns: 1, indexCache, sqliteCache, quality: 'balanced' };
  const cache = await runSearchBenchmark({ ...common, workMode: 'result-cache' });
  assert.equal(cache.work.phases.initial.cacheHits, 1,
    'clearing index/SQLite handles cannot relabel an existing result-cache hit as a cold miss');
  assert.equal(cache.coldness.resultCache, 'observed-existing-cache-state');
  assert.equal(cache.work.phases.measured.cacheHits, 2); assert.equal(cache.work.phases.measured.candidateStages, 0);
  const retrieval = await runSearchBenchmark({ ...common, workMode: 'retrieval' });
  assert.equal(retrieval.work.phases.measured.cacheHits, 0); assert.equal(retrieval.work.phases.measured.cacheMisses, 2);
  assert.equal(retrieval.work.phases.measured.candidateStages, 2);
  assert.equal(retrieval.work.phases.measured.queryEmbeddingRequests, 0);
  assert.equal(retrieval.work.phases.measured.qualified, 2);
  assert.equal(retrieval.work.phases.measured.controls[0].policyIdentity, cache.work.phases.measured.controls[0].policyIdentity);
  assert.equal(retrieval.work.phases.measured.controls[0].outputIdentity, cache.work.phases.measured.controls[0].outputIdentity);
});
const queries = path.join(dir, 'queries.txt'); await fs.writeFile(queries, 'microcacheprobe\nmicrocacheother\n');
const output = runNode([path.join(process.cwd(), 'tools', 'bench', 'micro', 'tinybench.js'), '--repo', repoRoot,
  '--no-build', '--no-compare', '--components', 'search-sparse', '--quality', 'balanced', '--work-mode', 'retrieval',
  '--queries', queries, '--iterations', '2', '--time', '0', '--warmup-iterations', '1', '--warmup-time', '0', '--json'],
'tinybench real workload receipt', process.cwd(), env, { stdio: 'pipe', timeoutMs: 30000 });
const report = JSON.parse(output.stdout);
assert.equal(report.schemaVersion, SEARCH_MICRO_REPORT_VERSION); assert.equal(report.kind, 'search-microbenchmark');
assert.deepEqual(report.querySchedule.queries, ['microcacheprobe', 'microcacheother']);
assert.equal(report.workMode, 'retrieval');
const sparse = report.components['search-sparse'];
assert.equal(sparse.samples, 2); assert.equal(sparse.work.phases.measured.samples, 2);
assert.equal(sparse.work.phases.measured.candidateStages, 2); assert.equal(sparse.work.phases.measured.cacheHits, 0);
assert.deepEqual(sparse.work.phases.measured.controls.map(row => row.queryIndex), [0, 1]);
assert.ok(sparse.work.phases.measured.controls.every(row => row.backend.effective === 'memory' && row.source.buildId));
assert.equal(sparse.work.phases.warmup.samples, 1);
assert.equal(sparse.work.timingScope, 'search-call-excludes-receipt-projection');
console.log('Real search and Tinybench distinguish balanced cache hits from actual retrieval without changing ranking policy.');
