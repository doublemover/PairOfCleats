import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { buildAnnPipelineFixture } from '../pipeline/helpers/ann-scenarios.js';
import { runSearchSession } from '../../../src/retrieval/cli/run-search-session.js';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { createLanceDbAnnProvider } from '../../../src/retrieval/ann/providers/lancedb.js';
import { getGenerationProviderRuntime } from '../../../src/retrieval/pipeline/provider-runtime.js';
import { loadQueryCache } from '../../../src/retrieval/query-cache.js';
import { INDEX_PROFILE_VECTOR_ONLY } from '../../../src/contracts/index-profile.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('retrieval/ann/lancedb-outcome-consumers/')[1];
assert.ok(['native-outcomes', 'session-cache', 'missing-package', 'unsupported-api', 'count-aware'].includes(selected));
const key = Symbol.for('poc.tests.lancedb-outcome-consumers'), states = new Map();
const absent = Object.freeze(Object.assign(new Error('controlled absent optional LanceDB package'), { code: 'ERR_MODULE_NOT_FOUND' }));
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier !== '@lancedb/lancedb') return next(specifier, context);
    if (selected === 'missing-package') throw absent;
    return { url: 'poc:lancedb-outcome-consumers', shortCircuit: true };
  },
  load(url, context, next) {
    if (url !== 'poc:lancedb-outcome-consumers') return next(url, context);
    return { format: 'module', shortCircuit: true, source: selected === 'unsupported-api' ? 'export const unsupported=true;'
      : 'export const connect=dir=>globalThis[Symbol.for("poc.tests.lancedb-outcome-consumers")](dir);' };
  }
});
const { dir } = await prepareIsolatedTestCacheDir('lancedb-outcome-consumers-' + selected);
const originalNow = Date.now, originalWarn = console.warn, warnings = [], observations = [];
let now = originalNow(), clear;
Date.now = () => now; console.warn = message => warnings.push(String(message));
globalThis[key] = async directory => {
  const state = states.get(directory); state.connects++;
  if (state.fault === 'connect') throw state.primary;
  const db = {
    async close() { state.connectionCloses++; assert.equal(state.tableAcquired ? state.tableClosed : true, true); state.connectionClosed = true; },
    async openTable() {
      state.opens++; if (state.fault === 'open') throw state.primary;
      state.tableAcquired = true;
      const table = {
        async close() { state.tableCloses++; if (state.denyClose) throw state.secondary; state.tableClosed = true; },
        async countRows() { return 2; },
        search() {
          state.builders++; if (state.fault === 'builder') throw state.primary;
          if (state.fault === 'unsupported-query') return {};
          return {
            column() { return this; }, metricType() { return this; }, limit(value) { state.topNs.push(value); return this; },
            select() { return this; }, where() { return this; },
            async toArray() {
              state.queries++;
              if (state.retireDuringQuery) await clear();
              if (state.fault === 'query' || state.fault === 'abort') throw state.primary;
              state.controller?.abort();
              const rows = state.fault === 'empty' ? [] : [{ id: 1, _distance: 0 }];
              if (state.fault === 'iterate') return { *[Symbol.iterator]() {
                state.iterations++; state.rowBytes += Buffer.byteLength(JSON.stringify(rows[0])); yield rows[0]; throw state.primary;
              } };
              state.iterations += rows.length; state.rowBytes += Buffer.byteLength(JSON.stringify(rows));
              return rows;
            }
          };
        }
      };
      if (state.fault === 'unsupported-table') delete table.search;
      return table;
    }
  };
  return db;
};
const fixture = async fault => {
  const root = path.join(dir, String(states.size)); await fs.mkdir(root);
  const state = { fault, connects: 0, opens: 0, builders: 0, queries: 0, iterations: 0, rowBytes: 0,
    connectionCloses: 0, tableCloses: 0, topNs: [], primary: Object.freeze(new Error('original native ' + fault)),
    secondary: Object.freeze(new Error('original native close failure')) };
  states.set(root, state);
  const info = { available: true, dir: root, meta: { dims: 2, table: 'vectors', idColumn: 'id', embeddingColumn: 'vector', metric: 'cosine' } };
  return { root, state, info };
};
const contains = (error, expected) => {
  const seen = new Set(), pending = [error];
  while (pending.length) { const value = pending.pop(); if (value === expected) return true;
    if (!value || seen.has(value)) continue; seen.add(value);
    if (value.cause) pending.push(value.cause); if (value.errors) pending.push(...value.errors); }
  return false;
};
const sessionFor = async f => {
  const { context, idx, stageTracker } = buildAnnPipelineFixture();
  idx.chunkMeta[1].tokens = ['beta']; idx.tokenIndex.postings[0] = [[0, 1]]; idx.lancedb = f.info;
  context.lanceAnnState.code = { available: true, dims: 2 };
  const cacheDir = path.join(f.root, 'cache'); await fs.mkdir(cacheDir);
  const base = { ...context, rootDir: dir, metricsDir: cacheDir, queryCacheDir: cacheDir,
    userConfig: { retrieval: { ann: { adaptiveProviders: false } } }, query: 'alpha', embeddingQueryText: 'alpha',
    searchMode: 'code', runCode: true, runProse: false, runExtractedProse: false, runRecords: false,
    idxCode: idx, annActive: true, annBackend: 'lancedb', lancedbConfig: {}, vectorAnnEnabled: false,
    modelConfig: { dir, dims: 2 }, modelIds: { code: 'fixture-stub' }, embeddingProvider: 'xenova', embeddingOnnx: {},
    contextExpansionEnabled: false, contextExpansionOptions: {}, contextExpansionRespectFilters: true,
    useStubEmbeddings: true, backendLabel: 'memory', cacheFilters: {},
    queryCacheEnabled: true, queryCacheTtlMs: 120000, queryCacheMaxEntries: 16,
    queryCacheStrategy: 'memory-first', queryCacheMemoryFreshMs: 0,
    indexSignaturePayload: { backend: 'memory', modes: { code: 'unchanged-' + f.state.fault } }
  };
  return { base, idx, context, stageTracker, cacheDir };
};
try {
  const { rankLanceDb, clearLanceDbConnectionCache } = await import('../../../src/retrieval/lancedb.js');
  clear = clearLanceDbConnectionCache;
  const rank = (f, extra = {}) => rankLanceDb({ lancedbInfo: f.info, queryEmbedding: [1, 0], topN: 2, config: {}, ...extra });
  if (['missing-package', 'unsupported-api'].includes(selected)) {
    const f = await fixture('positive');
    await assert.rejects(rank(f), error => error.code === 'ERR_LANCEDB_UNAVAILABLE'
      && (selected !== 'missing-package' || contains(error, absent)));
    const ann = createLanceDbAnnProvider({ lancedbConfig: {}, lanceAnnState: { code: { available: true } } });
    assert.equal(ann.isAvailable({ idx: { lancedb: f.info }, mode: 'code', embedding: [1, 0] }), true);
    await assert.rejects(ann.query({ idx: { lancedb: f.info }, mode: 'code', embedding: [1, 0], topN: 2 }),
      { code: 'ERR_LANCEDB_UNAVAILABLE' });
    assert.equal(f.state.connects, 0, 'unsupported/absent package is explicit unavailable before native dispatch');
  } else if (selected === 'native-outcomes') {
    for (const fault of ['positive', 'empty', 'connect', 'open', 'builder', 'query', 'iterate', 'unsupported-query', 'unsupported-table', 'abort']) {
      const f = await fixture(fault);
      if (fault === 'abort') f.state.primary = Object.freeze(Object.assign(new Error('independent original native abort'), { name: 'AbortError', code: 'ABORT_ERR' }));
      if (fault === 'positive') assert.deepEqual((await rank(f)).map(hit => hit.idx), [1]);
      else if (fault === 'empty') assert.deepEqual(await rank(f), []);
      else await assert.rejects(rank(f), error => fault.startsWith('unsupported') ? Boolean(error.code || /column/.test(error.message)) : error === f.state.primary);
      if (fault === 'iterate') assert.equal(f.state.iterations, 1, 'partial native rows never become a successful partial result');
      const connects = f.state.connects;
      assert.deepEqual(await rank(f, { candidateSet: new Set() }), []); assert.equal(f.state.connects, connects);
      await clear();
      assert.equal(f.state.connectionCloses, fault === 'connect' ? 0 : 1);
      assert.equal(f.state.tableCloses, ['connect', 'open'].includes(fault) ? 0 : 1);
      observations.push({ fault, ...f.state });
    }
    const cancelled = await fixture('positive'), controller = new AbortController(); cancelled.state.controller = controller;
    await assert.rejects(rank(cancelled, { signal: controller.signal }), { name: 'AbortError' }); await clear();
    const pending = await fixture('query'); pending.state.retireDuringQuery = true; pending.state.denyClose = true;
    let failure; try { await rank(pending); assert.fail('unconfirmed original close must remain pending'); } catch (error) { failure = error; }
    assert.ok(contains(failure, pending.state.primary) && contains(failure, pending.state.secondary));
    assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(pending.state.connectionCloses, 0);
    const healthy = await fixture('positive'); assert.equal((await rank(healthy))[0].idx, 1);
    pending.state.denyClose = false; await failure.lanceDbOwner.close();
    assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(pending.state.tableCloses, 2);
    assert.equal(healthy.state.connectionCloses, 0, 'a failed original owner cannot close a newly admitted sibling'); await clear();
  } else if (selected === 'session-cache') {
    for (const fault of ['connect', 'open', 'builder', 'query', 'iterate']) {
      const f = await fixture(fault), { base, idx, stageTracker, cacheDir } = await sessionFor(f);
      const first = await runSearchSession(base);
      assert.deepEqual(first.codeHits.map(hit => hit.id), [0]); assert.equal(first.cache.hit, false);
      assert.equal(first.executionOutcomes.code.cacheable, false);
      assert.ok(first.executionOutcomes.code.reasons.includes('ann-provider-failure'));
      assert.equal(loadQueryCache(path.join(cacheDir, 'queryCache.json')).entries.length, 0);
      const metrics = stageTracker.stages.filter(row => row.stage === 'ann').at(-1);
      assert.equal(metrics.failedAttempts, 1);
      const runtime = getGenerationProviderRuntime(idx), provider = { id: 'lancedb' };
      assert.equal(runtime.getProviderModeState(provider, 'code').latencySamples, 0);
      assert.equal(runtime.getProviderModeState(provider, 'code').failures, 1);
      const failedCalls = f.state.connects + f.state.opens + f.state.builders + f.state.queries;
      now += 2000; f.state.fault = 'positive';
      const recovered = await runSearchSession(base);
      assert.equal(recovered.cache.hit, false); assert.equal(recovered.executionOutcomes.code.cacheable, true);
      assert.deepEqual(recovered.codeHits.map(hit => hit.id).sort(), [0, 1]);
      assert.equal(runtime.getProviderModeState(provider, 'code').failures, 0);
      assert.equal(runtime.getProviderModeState(provider, 'code').latencySamples, 1);
      const healthyCalls = f.state.connects + f.state.opens + f.state.builders + f.state.queries;
      const warm = await runSearchSession(base); assert.equal(warm.cache.hit, true);
      assert.deepEqual(warm.codeHits.map(hit => hit.id).sort(), [0, 1]);
      assert.equal(f.state.connects + f.state.opens + f.state.builders + f.state.queries, healthyCalls);
      observations.push({ fault, failedCalls, healthyCalls, recoveryDelayMs: 2000, rowBytes: f.state.rowBytes });
      await clear();
    }
    const empty = await fixture('empty'), healthy = await sessionFor(empty);
    const result = await runSearchSession(healthy.base);
    assert.equal(result.executionOutcomes.code.cacheable, true, 'a healthy empty native result remains successful');
    const calls = empty.state.queries;
    assert.equal((await runSearchSession(healthy.base)).cache.hit, true); assert.equal(empty.state.queries, calls);
    await clear();
    const pending = await fixture('query'), retained = await sessionFor(pending);
    pending.state.retireDuringQuery = true; pending.state.denyClose = true;
    let failure;
    await assert.rejects(runSearchSession(retained.base), error => {
      failure = error; return error.cacheOwnershipReleased() === false && contains(error, pending.state.primary)
        && contains(error, pending.state.secondary);
    });
    assert.equal(pending.state.queries, 1);
    assert.equal(getGenerationProviderRuntime(retained.idx).getProviderModeState({ id: 'lancedb' }, 'code').latencySamples, 0);
    assert.equal(loadQueryCache(path.join(retained.cacheDir, 'queryCache.json')).entries.length, 0);
    pending.state.denyClose = false; await failure.lanceDbOwner.close(); assert.equal(failure.cacheOwnershipReleased(), true);
    await clear();
    const aborted = await fixture('abort'), independent = await sessionFor(aborted);
    aborted.state.primary = Object.freeze(Object.assign(new Error('original independent provider abort'), { name: 'AbortError', code: 'ABORT_ERR' }));
    await assert.rejects(runSearchSession(independent.base), error => error === aborted.state.primary);
    assert.equal(loadQueryCache(path.join(independent.cacheDir, 'queryCache.json')).entries.length, 0);
    await clear();
    const cancelled = await fixture('positive'), caller = await sessionFor(cancelled), controller = new AbortController();
    cancelled.state.controller = controller;
    await assert.rejects(runSearchSession({ ...caller.base, signal: controller.signal }),
      error => error.code === 'CANCELLED' || error.code === 'ABORT_ERR' || error.name === 'AbortError');
    assert.equal(loadQueryCache(path.join(caller.cacheDir, 'queryCache.json')).entries.length, 0);
    await clear();
  } else {
    const f = await fixture('query'), { context, idx, stageTracker } = buildAnnPipelineFixture();
    idx.lancedb = f.info; idx.denseVec = null; context.lanceAnnState.code.available = true;
    context.annBackend = 'lancedb'; context.createAnnProviders = undefined;
    context.countAwareAnnPolicy = { enabled: true, exactRows: 0, coordinateWork: 0,
      maxAttempts: 3, requestedHitWork: 64, maxTopN: 32, maxMs: 1000 };
    const result = await createSearchPipeline(context)(idx, 'code', [1, 0]);
    const metrics = stageTracker.stages.filter(row => row.stage === 'ann').at(-1);
    assert.equal(f.state.queries, 1, 'ordinary first native failure cannot restart with a larger requested topN');
    assert.equal(metrics.failedAttempts, 1); assert.equal(result.executionOutcome.cacheable, false);
    assert.equal(getGenerationProviderRuntime(idx).getProviderModeState({ id: 'lancedb' }, 'code').latencySamples, 0);
    observations.push({ attempts: metrics.countAware?.attempts, topNs: f.state.topNs }); await clear();
    const vector = await fixture('query'), only = buildAnnPipelineFixture();
    only.idx.lancedb = vector.info; only.idx.denseVec = null; only.idx.state = { profile: { id: INDEX_PROFILE_VECTOR_ONLY } };
    only.context.annBackend = 'lancedb'; only.context.createAnnProviders = undefined; only.context.lanceAnnState.code.available = true;
    await assert.rejects(createSearchPipeline(only.context)(only.idx, 'code', [1, 0]), { code: 'CAPABILITY_MISSING' });
    assert.equal(vector.state.queries, 1, 'a failed native result cannot satisfy the actual vector-only capability guard'); await clear();
  }
  console.log(JSON.stringify({ selected, observations, warnings,
    scope: 'recording native module; actual rank/provider/ANN/session/cache owners; no real native throughput claim' }));
} finally {
  for (const state of states.values()) state.denyClose = false;
  if (clear) await clear(); hook.deregister(); delete globalThis[key]; Date.now = originalNow; console.warn = originalWarn;
  await fs.rm(dir, { recursive: true, force: true });
}
