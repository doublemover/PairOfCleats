import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Module from 'node:module';
import { createTantivyProvider } from '../../../src/retrieval/sparse/providers/tantivy.js';
import { createIndexBackendLoader } from '../../../src/retrieval/cli/load-indexes/backend.js';
import { resolveQueryCacheLookup } from '../../../src/retrieval/cli/run-search-session/cache-policy.js';
import { persistSearchSession } from '../../../src/retrieval/cli/run-search-session/persist.js';
import { createQueryCacheLookupInput, createQueryCachePersistInput } from '../cache/query-cache-fixture.js';
import { createRetrievalStageTracker } from '../../../src/retrieval/pipeline/stage-checkpoints.js';
import { createInMemorySearchPipeline, createAvailableDenseAnnProvider } from '../pipeline/helpers/in-memory-search-pipeline-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('tantivy-outcome-cache-consumers');
applyTestEnv({ cacheRoot: path.join(dir, 'runtime-cache'), embeddings: 'off' });
const originalLoad = Module._load;
const sentinel = Object.freeze(Object.assign(new Error('original native query failure'), { code: 'ERR_NATIVE_SENTINEL' }));
let state = 'empty', opens = 0, searches = 0, closes = 0, annCalls = 0;
const adapter = { openIndex() {
  opens++; if (state === 'open-failure') throw sentinel;
  return { close() { closes++; } };
}, search() { searches++; if (state === 'query-failure') throw sentinel; return state === 'positive' ? [{ idx: 0, score: 1 }] : []; } };
Module._load = function (name, ...args) {
  return name === 'tantivy' ? (state === 'unsupported' ? { openIndex: true, search: () => [] } : adapter) : originalLoad.call(this, name, ...args);
};
const index = () => ({ chunkMeta: [{ id: 0, file: 'alpha.txt', tokens: ['alpha'] }],
  tantivy: { available: true, dir: 'canonical-selected-generation' },
  denseVec: { dims: 1, minVal: 0, maxVal: 1, levels: 256, scale: 1 / 255, vectors: [[0]] } });
const run = async (options = {}) => {
  const tracker = createRetrievalStageTracker({ enabled: true });
  const pipeline = createInMemorySearchPipeline({ query: 'alpha', queryTokens: ['alpha'], stageTracker: tracker,
    provider: createAvailableDenseAnnProvider(async () => { annCalls++; return [{ idx: 0, sim: 0.9 }]; }),
    overrides: { annEnabled: false, sparseBackend: 'tantivy', ...options } });
  try { return { hits: await pipeline(index(), 'code', [1]), tracker }; }
  finally { await pipeline.dispose(); }
};
try {
  state = 'unsupported';
  const unavailable = createTantivyProvider();
  try {
    assert.equal(unavailable.available, false);
    assert.throws(() => unavailable.search({ idx: index(), queryTokens: ['alpha'], mode: 'code', topN: 5 }), { code: 'ERR_TANTIVY_UNAVAILABLE' });
    assert.throws(() => createIndexBackendLoader({ rootDir: dir, userConfig: {}, backendLabel: 'tantivy',
      backendForcedTantivy: true, annActive: false, requiredArtifacts: new Set() }), /no compatible synchronous open\/search adapter/);
    await assert.rejects(run(), { code: 'CAPABILITY_MISSING' });
  } finally { await unavailable.dispose(); }
  assert.equal(opens, 0); assert.equal(searches, 0); assert.equal(annCalls, 0);
  state = 'empty';
  const empty = await run();
  assert.deepEqual([...empty.hits], []);
  assert.equal(empty.hits.executionOutcome.cacheable, true);
  assert.equal(empty.hits.executionOutcome.effective.sparse, 'tantivy');
  assert.equal(annCalls, 0, 'healthy zero hits never admit an unrelated ANN fallback');
  const cacheDir = path.join(dir, 'query-cache');
  const input = createQueryCacheLookupInput(cacheDir, { backendLabel: 'tantivy', sparseBackend: 'tantivy',
    indexSignaturePayload: { backend: 'tantivy', modes: { code: 'canonical-selected-generation' } }, cacheMemoryFreshMs: 0 });
  // Use one actual query/cache identity throughout failed attempts and its
  // eventual healthy execution. Failure is not a healthy-empty cache entry.
  for (const failure of ['open-failure', 'query-failure']) {
    state = failure;
    const direct = createTantivyProvider();
    try { assert.throws(() => direct.search({ idx: index(), queryTokens: ['alpha'], mode: 'code', topN: 5 }), error => error === sentinel); }
    finally { await direct.dispose(); }
    for (let attempt = 0; attempt < 2; attempt++) {
      const lookup = await resolveQueryCacheLookup(input);
      assert.equal(lookup.cacheHit, false);
      const degraded = await run({ profilePolicyByMode: { code: { allowSparseFallback: true } } });
      assert.equal(degraded.hits.executionOutcome.cacheable, false);
      assert.ok(degraded.hits.executionOutcome.reasons.includes('sparse-provider-failure'));
      const diagnostic = degraded.tracker.stages.find(row => row.stage === 'candidates').fts.diagnostics
        .find(row => row.provider === 'tantivy');
      assert.equal(diagnostic.failureCode, sentinel.code);
      await persistSearchSession(createQueryCachePersistInput(lookup, { backendLabel: 'tantivy', codeHits: degraded.hits,
        executionOutcomes: { code: degraded.hits.executionOutcome } }));
      assert.equal((await resolveQueryCacheLookup(input)).cacheHit, false);
      await assert.rejects(fs.stat(lookup.queryCachePath), { code: 'ENOENT' });
    }
  }
  state = 'empty';
  const lookup = await resolveQueryCacheLookup(input);
  const healthy = await run();
  await persistSearchSession(createQueryCachePersistInput(lookup, { backendLabel: 'tantivy', codeHits: healthy.hits,
    executionOutcomes: { code: healthy.hits.executionOutcome } }));
  const callsBeforeHit = { opens, searches, annCalls };
  const warm = await resolveQueryCacheLookup(input);
  assert.equal(warm.cacheHit, true); assert.deepEqual(warm.cachedPayload.code, []);
  assert.deepEqual({ opens, searches, annCalls }, callsBeforeHit, 'a qualified warm empty result requires no second native/ANN call');
  state = 'positive';
  const positive = await run(); assert.deepEqual(positive.hits.map(row => row.id), [0]);
  assert.equal(positive.hits.executionOutcome.cacheable, true);
  assert.equal(annCalls, 4, 'only the four explicitly policy-admitted failures invoke ANN');
  assert.equal(closes, opens - 3, 'three failed native opens returned no physical handle');
} finally { Module._load = originalLoad; await fs.rm(dir, { recursive: true, force: true }); }
console.log('Actual Tantivy availability, empty/failure pipeline outcomes and repeated query-cache admission remain distinct.');
