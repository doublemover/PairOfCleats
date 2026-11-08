import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { getLastTopKStats } from '../../../src/retrieval/pipeline/topk.js';

const key = Symbol.for('poc.tests.lancedb-partition-topk'), states = new Map();
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier === '@lancedb/lancedb' ? { url: 'poc:lancedb-partition-topk', shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url === 'poc:lancedb-partition-topk' ? { format: 'module', shortCircuit: true,
      source: `export const connect = dir => globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})](dir);` } : next(url, context);
  }
});
const { dir: root } = await prepareIsolatedTestCacheDir('lancedb-partition-topk');
const warnings = [], originalWarn = console.warn;
console.warn = message => warnings.push(message);
globalThis[key] = async dir => {
  const state = states.get(dir); state.connections++;
  return {
    async close() { state.closed++; },
    async openTable() {
      return {
        async close() { state.tablesClosed++; },
        async countRows() { state.counts++; return state.rows.length; },
        search() {
          state.builders++; let ids = null, limit = null;
          const query = {
            column(name) { assert.equal(name, 'vector'); return this; }, metricType() { return this; },
            limit(value) { limit = value; return this; }, select() { return this; },
            async toArray() {
              state.queries.push({ ids, limit }); state.onQuery?.(state.queries.length);
              const rows = state.rows.filter(row => !ids || ids.includes(row.id)).sort((a, b) => a._distance - b._distance || a.id - b.id).slice(0, limit);
              return state.leak ? [{ id: 0, _distance: 0 }, ...rows] : rows;
            }
          };
          if (state.pushdown) query.where = function(expression) { ids = expression.match(/\(([^)]+)\)/)[1].split(',').map(Number); return this; };
          return query;
        }
      };
    }
  };
};
const { rankLanceDb, clearLanceDbConnectionCache } = await import('../../../src/retrieval/lancedb.js');
const { createLanceDbAnnProvider } = await import('../../../src/retrieval/ann/providers/lancedb.js');
const fixture = async (name, { count = 2500, pushdown = true } = {}) => {
  const dir = path.join(root, name); await fs.mkdir(dir);
  const state = { connections: 0, closed: 0, tablesClosed: 0, builders: 0, counts: 0, queries: [], pushdown,
    rows: Array.from({ length: count }, (_, id) => ({ id, _distance: id % 17 })) };
  states.set(dir, state);
  const lancedbInfo = { available: true, dir, meta: { table: 'vectors', dims: 2, metric: 'l2', idColumn: 'id', embeddingColumn: 'vector' } };
  return { state, lancedbInfo, query: (candidateSet, signal = null, topN = 7) => rankLanceDb({
    lancedbInfo, candidateSet, signal, topN, queryEmbedding: [0, 0], config: {} }) };
};
try {
  const partitioned = await fixture('partitioned'), allowed = new Set(Array.from({ length: 1001 }, (_, index) => index + 1000));
  const expected = partitioned.state.rows.filter(row => allowed.has(row.id)).sort((a, b) => a._distance - b._distance || a.id - b.id).slice(0, 7);
  const result = await partitioned.query(allowed);
  assert.deepEqual(result.map(hit => hit.idx), expected.map(row => row.id), 'independent full allowed-domain ordering agrees across all candidate partitions and score ties');
  assert.equal(partitioned.state.queries.length, 3); assert.equal(partitioned.state.builders, 3, 'the capability probe query is reused for actual execution');
  assert.deepEqual(partitioned.state.queries.map(row => row.ids.length), [500, 500, 1]);
  assert(partitioned.state.queries.every(row => row.limit === 7));
  assert.equal(getLastTopKStats().seen, 15); assert.ok(getLastTopKStats().maxSize <= 7, 'retained projected results never accumulate partition count times N');
  partitioned.state.leak = true;
  assert.deepEqual((await partitioned.query(allowed)).map(hit => hit.idx), expected.map(row => row.id),
    'backend predicate claims cannot authorize returned rows outside the original eligible membership');
  const unfiltered = await fixture('no-pushdown', { pushdown: false });
  const deep = new Set([2499]);
  assert.deepEqual((await unfiltered.query(deep)).map(hit => hit.idx), [2499]);
  assert.equal(unfiltered.state.counts, 1); assert.equal(unfiltered.state.queries[0].limit, 2500,
    'bounded retained top-k cannot replace the complete no-pushdown source scan with unsafe overfetch');

  const pre = await fixture('pre-abort'), preAbort = new AbortController(); preAbort.abort();
  await assert.rejects(pre.query(allowed, preAbort.signal), { name: 'AbortError' }); assert.equal(pre.state.connections, 0);
  const cancelled = await fixture('cancel-first'), controller = new AbortController();
  cancelled.state.onQuery = () => controller.abort();
  await assert.rejects(cancelled.query(allowed, controller.signal), { name: 'AbortError' });
  assert.equal(cancelled.state.queries.length, 1, 'cancelled partition results cannot trigger the next native query or a partial result');
  const empty = await fixture('empty-partitions', { count: 0 }), emptyAbort = new AbortController();
  empty.state.onQuery = count => { if (count === 1) setImmediate(() => emptyAbort.abort()); };
  await assert.rejects(empty.query(new Set(Array.from({ length: 15000 }, (_, id) => id)), emptyAbort.signal), { name: 'AbortError' });
  assert.ok(empty.state.queries.length <= 16, 'zero-row partitions still yield to cancellation');
  const scan = await fixture('cancel-row-scan', { pushdown: false }), scanAbort = new AbortController();
  scan.state.onQuery = () => setImmediate(() => scanAbort.abort());
  await assert.rejects(scan.query(deep, scanAbort.signal), { name: 'AbortError' });
  assert.equal(scan.state.queries.length, 1, 'excluded materialized rows retain cooperative checkpoints');

  const throughProvider = await fixture('provider-signal'), providerAbort = new AbortController();
  throughProvider.state.onQuery = () => providerAbort.abort();
  const used = { code: false }, provider = createLanceDbAnnProvider({ lancedbConfig: {}, lanceAnnUsed: used });
  await assert.rejects(provider.query({ idx: { lancedb: throughProvider.lancedbInfo }, mode: 'code', embedding: [0, 0],
    topN: 7, candidateSet: allowed, signal: providerAbort.signal }), { name: 'AbortError' });
  assert.equal(throughProvider.state.queries.length, 1); assert.equal(used.code, false);
  await clearLanceDbConnectionCache();
  for (const state of states.values()) { assert.equal(state.closed, state.connections); assert.equal(state.tablesClosed, state.connections); }
  assert.deepEqual(warnings, [], 'caller cancellation does not emit backend-failure warnings');
} finally {
  await clearLanceDbConnectionCache(); hooks.deregister(); delete globalThis[key]; console.warn = originalWarn;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Actual LanceDB partition/top-k, provider signal, row-loop cancellation and settled lease assertions complete; native acceptance deferred');
