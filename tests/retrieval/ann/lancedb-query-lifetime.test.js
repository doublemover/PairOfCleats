#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const key = Symbol.for('poc.tests.lancedb-query-lifetime');
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@lancedb/lancedb') return { url: 'poc:lancedb-query-lifetime', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'poc:lancedb-query-lifetime') return { format: 'module', shortCircuit: true,
      source: `export const connect = dir => globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})](dir);` };
    return nextLoad(url, context);
  }
});
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const { dir: root } = await prepareIsolatedTestCacheDir('lancedb-query-lifetime');
const states = new Map(), warnings = [];
let connections = 0, closes = 0, tableCreates = 0, tableCloses = 0;
const originalWarn = console.warn, originalNow = Date.now;
console.warn = message => warnings.push(String(message));
globalThis[key] = async dir => {
  connections++;
  const state = states.get(dir), connection = { closed: false };
  state.connection = connection;
  state.connectEntered?.resolve();
  if (state.connectGate) await state.connectGate.promise;
  return {
    async close() { assert.equal(connection.closed, false); connection.closed = true; closes++; },
    async openTable() {
      state.opens = (state.opens || 0) + 1;
      if (state.openGate) await state.openGate.promise;
      if (state.failOpen) { state.failOpen = false; throw new Error('controlled open failure'); }
      const table = { closed: false };
      state.table = table; tableCreates++;
      return {
        async close() { assert.equal(table.closed, false); table.closed = true; tableCloses++; },
        async countRows() { return 2; },
        search() {
          let ids = null, limit = 2;
          return {
            column(name) { assert.equal(name, 'vector'); return this; },
            metricType() { return this; },
            where(expression) { ids = expression.match(/\(([^)]+)\)/)[1].split(',').map(Number); return this; },
            limit(value) { limit = value; return this; },
            select() { return this; },
            async toArray() {
              state.entered?.resolve();
              if (state.queryGate) await state.queryGate.promise;
              assert.equal(table.closed, false, 'active query table remains alive');
              assert.equal(connection.closed, false, 'active query connection remains alive');
              return [0, 1].filter(id => !ids || ids.includes(id)).slice(0, limit)
                .map(id => ({ id, _distance: id }));
            }
          };
        }
      };
    }
  };
};
const { rankLanceDb, clearLanceDbConnectionCache } = await import('../../../src/retrieval/lancedb.js');
const fixture = async name => {
  const dir = path.join(root, name);
  await fs.mkdir(dir);
  states.set(dir, {});
  return dir;
};
const query = (dir, candidateSet = null) => rankLanceDb({ lancedbInfo: { available: true, dir,
  meta: { table: 'vectors', dims: 2, metric: 'l2', idColumn: 'id' } }, queryEmbedding: [0, 0],
candidateSet, topN: 1, config: {} });
try {
  const late = await fixture('late-connect');
  const lateState = states.get(late);
  lateState.connectEntered = deferred(); lateState.connectGate = deferred();
  const lateQuery = query(late);
  await lateState.connectEntered.promise;
  const retiredConnection = lateState.connection;
  await clearLanceDbConnectionCache();
  assert.equal(retiredConnection.closed, false, 'a pending connect remains owned by the active query lease');
  lateState.connectGate.resolve();
  assert.equal((await lateQuery)[0].idx, 0);
  assert.equal(retiredConnection.closed, true, 'a late connection is closed when its retired lease drains');
  assert.equal(lateState.table.closed, true);
  const afterLate = connections;
  await query(late);
  assert.equal(connections, afterLate + 1, 'clear prevents a late retired connection from re-entering lookup ownership');
  await clearLanceDbConnectionCache();
  const shared = await fixture('shared');
  const openGate = deferred(); states.get(shared).openGate = openGate;
  const pending = Array.from({ length: 4 }, () => query(shared));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(states.get(shared).opens, 1, 'simultaneous first queries share one native table-open flight');
  openGate.resolve();
  // The existing L2 ranking contract uses negative distance, including -0.
  assert.deepEqual(await Promise.all(pending), Array.from({ length: 4 }, () => [{ idx: 0, sim: -0 }]));
  const beforeEmpty = connections;
  assert.deepEqual(await query(shared, new Set()), []);
  assert.deepEqual(await query(shared, []), []);
  assert.equal(connections, beforeEmpty, 'explicit empty candidates avoid backend admission');
  assert.equal((await query(shared, new Set([1])))[0].idx, 1);
  await clearLanceDbConnectionCache();
  for (const cause of ['capacity', 'ttl', 'clear']) {
    const dir = await fixture(`held-${cause}`), state = states.get(dir);
    state.queryGate = deferred(); state.entered = deferred();
    const active = query(dir);
    await state.entered.promise;
    if (cause === 'capacity') {
      for (let i = 0; i < 9; i++) await query(await fixture(`other-${i}`));
    } else if (cause === 'ttl') {
      Date.now = () => originalNow() + 11 * 60 * 1000;
      await query(await fixture('ttl-new'));
      Date.now = originalNow;
    } else await clearLanceDbConnectionCache();
    assert.equal(state.table.closed, false, `${cause} retirement must preserve its active lease`);
    assert.equal(state.connection.closed, false);
    state.queryGate.resolve();
    assert.equal((await active)[0].idx, 0);
    assert.equal(state.table.closed, true, 'last lease deterministically closes a retired table');
    assert.equal(state.connection.closed, true);
    await clearLanceDbConnectionCache();
  }
  const retry = await fixture('retry'); states.get(retry).failOpen = true;
  assert.deepEqual(await query(retry), []);
  assert.equal((await query(retry))[0].idx, 0, 'failed table opens can be retried');
  assert.equal(states.get(retry).opens, 2);
  await clearLanceDbConnectionCache();
  assert.equal(closes, connections, 'all acquired connection handles close exactly once');
  assert.equal(tableCloses, tableCreates, 'all successful table handles remain tracked until close');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /controlled open failure/);
} finally {
  Date.now = originalNow; console.warn = originalWarn;
  for (const state of states.values()) { state.openGate?.resolve(); state.queryGate?.resolve(); }
  await clearLanceDbConnectionCache();
  hooks.deregister(); delete globalThis[key];
  await fs.rm(root, { recursive: true, force: true });
}
console.log('LanceDB coalesces native opens and preserves active queries across eviction, TTL and clear.');
