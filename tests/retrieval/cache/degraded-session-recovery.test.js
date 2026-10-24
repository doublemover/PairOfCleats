import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runSearchSession } from '../../../src/retrieval/cli/run-search-session.js';
import { buildAnnPipelineFixture } from '../pipeline/helpers/ann-scenarios.js';
import { FTS_UNAVAILABLE_CODE } from '../../../src/retrieval/pipeline/constants.js';
import { buildRetrievalMetadata } from '../../../src/retrieval/output/retrieval-metadata.js';
import { buildSearchDiagnostics } from '../../../src/retrieval/output/search-diagnostics.js';
import { loadQueryCache } from '../../../src/retrieval/query-cache.js';
import { areRetrievalExecutionsReusable } from '../../../src/contracts/retrieval-execution.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('degraded-session-recovery');
const nowMethod = Date.now, warn = console.warn;
let now = nowMethod(), failed = true, calls = 0;
const warnings = [];
Date.now = () => now; console.warn = message => warnings.push(String(message));
try {
  const fixture = buildAnnPipelineFixture();
  fixture.idx.chunkMeta[1].tokens = ['beta'];
  fixture.idx.tokenIndex.postings[0] = [[0, 1]];
  fixture.context.vectorAnnState.code.available = true;
  const base = { ...fixture.context, rootDir: dir, metricsDir: dir, queryCacheDir: dir,
    userConfig: { retrieval: { ann: { adaptiveProviders: false } } },
    query: 'alpha', embeddingQueryText: 'alpha', searchMode: 'code', runCode: true,
    runProse: false, runExtractedProse: false, runRecords: false,
    idxCode: fixture.idx, annActive: true, annBackend: 'sqlite-vector',
    vectorExtension: { provider: 'recording-native-boundary', annMode: 'flat' }, vectorAnnEnabled: true,
    modelConfig: { dir }, modelIds: { code: 'fixture-stub' }, embeddingProvider: 'xenova', embeddingOnnx: {},
    contextExpansionEnabled: false, contextExpansionOptions: {}, contextExpansionRespectFilters: true,
    useStubEmbeddings: true, backendLabel: 'memory', cacheFilters: {},
    queryCacheEnabled: true, queryCacheTtlMs: 120000, queryCacheMaxEntries: 16,
    queryCacheStrategy: 'memory-first', queryCacheMemoryFreshMs: 0,
    indexSignaturePayload: { backend: 'memory', modes: { code: 'unchanged-generation' } },
    rankVectorAnnSqlite: () => { calls += 1; if (failed) throw new Error('controlled transient ANN failure'); return [{ idx: 1, sim: 0.9 }]; }
  };
  const first = await runSearchSession(base);
  assert.deepEqual(first.codeHits.map(hit => hit.id), [0], 'sparse result survives the failed ANN member');
  assert.equal(first.cache.hit, false); assert.equal(first.executionOutcomes.code.cacheable, false);
  assert.ok(first.executionOutcomes.code.reasons.includes('ann-provider-failure'));
  assert.equal(loadQueryCache(path.join(dir, 'queryCache.json')).entries.length, 0);
  assert.equal(calls, 1);
  assert.equal(warnings.length, 1); assert.match(warnings[0], /Vector ANN unavailable.+Falling back to sparse/);
  const metadata = buildRetrievalMetadata({ backendLabel: 'memory', executionOutcomes: first.executionOutcomes });
  assert.equal(metadata.fidelity.status, 'fallback-derived');
  assert.equal(buildSearchDiagnostics(metadata).reasons[0].code, 'retrieval-provider-fallback');
  failed = false; now += 2000; // Past provider backoff, within the result-cache TTL.
  const recovered = await runSearchSession(base);
  assert.equal(recovered.cache.hit, false); assert.equal(calls, 2);
  assert.deepEqual(recovered.codeHits.map(hit => hit.id).sort((a, b) => a - b), [0, 1]);
  assert.equal(areRetrievalExecutionsReusable(recovered.executionOutcomes, ['code']), true);
  for (const delta of [100, 500, 5000]) {
    now += delta;
    const cached = await runSearchSession(base);
    assert.equal(cached.cache.hit, true); assert.equal(calls, 2);
    assert.deepEqual(cached.executionOutcomes, recovered.executionOutcomes, 'healthy hit retains original route facts');
    assert.deepEqual(cached.codeHits.map(hit => hit.id).sort((a, b) => a - b), [0, 1]);
  }
  assert.equal(warnings.length, 1, 'recovered execution/cache hits emit no unexpected warnings');

  let ftsCalls = 0, ftsFailed = true;
  const ftsDir = path.join(dir, 'fts'); await fs.mkdir(ftsDir);
  const fts = { ...base, queryCacheDir: ftsDir, metricsDir: ftsDir, useSqlite: true,
    annActive: false, vectorAnnEnabled: false, sqliteFtsRequested: true, backendLabel: 'sqlite-fts',
    indexSignaturePayload: { backend: 'sqlite-fts', modes: { code: 'unchanged-fts-generation' } },
    sqliteHasFts: () => true, sqliteHasTable: () => true, sqliteHasDb: () => true,
    getTokenIndexForQuery: () => fixture.idx.tokenIndex,
    rankSqliteFts: (_idx, _tokens, mode, _top, _normalized, _allowed, options) => {
      ftsCalls += 1;
      if (ftsFailed) { options.onDiagnostic({ code: FTS_UNAVAILABLE_CODE, reason: 'query_failed', mode }); return []; }
      return [{ idx: 0, score: 3 }];
    }
  };
  const degradedFts = await runSearchSession(fts);
  assert.deepEqual(degradedFts.codeHits.map(hit => hit.id), [0]);
  assert.equal(degradedFts.executionOutcomes.code.cacheable, false);
  ftsFailed = false;
  const healthyFts = await runSearchSession(fts);
  assert.equal(healthyFts.cache.hit, false); assert.equal(ftsCalls, 2);
  assert.equal(healthyFts.executionOutcomes.code.cacheable, true);
  assert.equal((await runSearchSession(fts)).cache.hit, true); assert.equal(ftsCalls, 2);
  const empty = { ...fts, query: 'missing', embeddingQueryText: 'missing', queryTokens: ['missing'],
    rankSqliteFts: () => { ftsCalls += 1; return []; } };
  const emptyResult = await runSearchSession(empty);
  assert.deepEqual(emptyResult.codeHits, []); assert.equal(emptyResult.executionOutcomes.code.cacheable, true);
  const emptyCalls = ftsCalls;
  assert.equal((await runSearchSession(empty)).cache.hit, true); assert.equal(ftsCalls, emptyCalls);
  const cancelled = AbortSignal.abort();
  await assert.rejects(runSearchSession({ ...base, signal: cancelled }), { code: 'CANCELLED' });
  assert.equal(calls, 2, 'cancelled requests do not dispatch or publish an execution');
} finally { Date.now = nowMethod; console.warn = warn; await fs.rm(dir, { recursive: true, force: true }); }
console.log('Actual session/cache recovery reexecutes transient failures, reuses healthy/empty outcomes and retains route diagnostics.');
