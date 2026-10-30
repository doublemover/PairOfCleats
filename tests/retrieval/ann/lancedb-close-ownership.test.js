import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createLanceDbResourceOwner } from '../../../src/retrieval/ann/lancedb-lifetime.js';

// Authored source controls only. No real native handle or model is loaded.
const key = Symbol.for('poc.tests.lancedb-close-ownership'), states = new Map();
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier === '@lancedb/lancedb' ? { url: 'poc:lancedb-close-ownership', shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url === 'poc:lancedb-close-ownership' ? { format: 'module', shortCircuit: true,
      source: `export const connect = dir => globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})](dir);` } : next(url, context);
  }
});
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const { dir: root } = await prepareIsolatedTestCacheDir('lancedb-close-ownership');
const warnings = [], originalWarn = console.warn;
console.warn = value => warnings.push(String(value));
globalThis[key] = async dir => {
  const state = states.get(dir); state.connects++;
  state.nativeDb = {
    async close() {
      state.closeAttempts++;
      assert.equal([...state.tables.values()].every(table => table.closed), true, 'connection closes after every table');
      if (state.closeErrors.length) throw state.closeErrors.shift();
      assert.equal(state.closed, false); state.closed = true;
    },
    async openTable(name) {
      if (state.openGate) { state.openEntered.resolve(); await state.openGate.promise; }
      if (state.openError) throw state.openError;
      const table = { closeAttempts: 0, closed: false, closeErrors: [], closeGate: null, closeEntered: null };
      state.tables.set(name, table);
      table.native = {
        async close() {
          table.closeAttempts++; table.closeEntered?.resolve();
          if (table.closeGate) await table.closeGate.promise;
          if (table.closeErrors.length) throw table.closeErrors.shift();
          assert.equal(table.closed, false); table.closed = true;
        },
        search() {
          return {
            column() { return this; }, metricType() { return this; }, limit() { return this; }, select() { return this; },
            async toArray() {
              state.queryEntered?.resolve();
              if (state.queryGate) await state.queryGate.promise;
              if (state.queryError) throw state.queryError;
              return [{ id: 1, _distance: 0 }];
            }
          };
        }
      };
      return table.native;
    }
  };
  return state.nativeDb;
};
const { rankLanceDb, clearLanceDbConnectionCache } = await import('../../../src/retrieval/lancedb.js');
const fixture = async name => {
  const dir = path.join(root, name); await fs.mkdir(dir);
  const state = { connects: 0, closeAttempts: 0, closed: false, closeErrors: [], tables: new Map() };
  states.set(dir, state);
  return { state, query: (table = 'vectors', signal = null) => rankLanceDb({
    lancedbInfo: { available: true, dir, meta: { table, dims: 2, metric: 'l2', idColumn: 'id' } },
    queryEmbedding: [0, 0], topN: 1, config: {}, signal
  }) };
};
const captureFailure = async promise => {
  try { await promise; assert.fail('expected pending native cleanup'); }
  catch (error) { assert.equal(error.cacheOwnershipPending, true); return error; }
};
try {
  const tables = await fixture('two-tables');
  await tables.query('bad'); await tables.query('good');
  const bad = tables.state.tables.get('bad'), good = tables.state.tables.get('good');
  const originalCloseFailure = Object.freeze(new Error('original table close rejected'));
  bad.closeErrors.push(originalCloseFailure);
  const failed = await captureFailure(clearLanceDbConnectionCache());
  assert.equal(failed.errors[0], originalCloseFailure); assert.equal(good.closed, true);
  assert.equal(tables.state.closeAttempts, 0, 'failed table retains its parent connection');
  assert.equal(failed.cacheOwnershipReleased(), false);
  let replacementCalls = 0;
  bad.native.close = () => { replacementCalls++; throw new Error('replacement must not be called'); };
  const sibling = await fixture('new-sibling'); await sibling.query();
  const [settled] = await Promise.all([failed.lanceDbOwner.close(), failed.lanceDbOwner.close()]);
  assert.deepEqual(settled, { settled: true, pending: false });
  assert.equal(bad.closeAttempts, 2, 'concurrent reconciliation coalesces the exact original close');
  assert.equal(good.closeAttempts, 1); assert.equal(replacementCalls, 0);
  assert.equal(tables.state.closeAttempts, 1); assert.equal(failed.cacheOwnershipReleased(), true);
  assert.equal(sibling.state.closed, false, 'one failure capability cannot close a newly admitted sibling');
  await clearLanceDbConnectionCache();

  const connection = await fixture('connection-close'); await connection.query();
  const connectionFailure = Object.freeze(new Error('connection close rejected'));
  connection.state.closeErrors.push(connectionFailure);
  const failedConnection = await captureFailure(clearLanceDbConnectionCache());
  assert.equal(connection.state.tables.get('vectors').closed, true);
  assert.equal(failedConnection.errors[0], connectionFailure);
  await clearLanceDbConnectionCache();
  assert.equal(connection.state.closeAttempts, 2);
  assert.equal(connection.state.tables.get('vectors').closeAttempts, 1, 'successful child closes are never repeated');
  assert.equal(failedConnection.cacheOwnershipPending, false);

  const failures = await Promise.all(['clear-a', 'clear-b', 'clear-healthy'].map(fixture));
  for (const item of failures) await item.query();
  failures[0].state.closeErrors.push(new Error('a')); failures[1].state.closeErrors.push(new Error('b'));
  const combined = await captureFailure(clearLanceDbConnectionCache());
  assert.equal(combined.cleanupErrors.length, 2);
  assert.equal(failures[2].state.closed, true, 'a rejected close cannot strand later entries in the same global clear');
  await combined.lanceDbOwner.close(); assert.equal(combined.cacheOwnershipReleased(), true);

  const ordinary = await fixture('ordinary-query-and-close');
  ordinary.state.queryEntered = deferred(); ordinary.state.queryGate = deferred();
  const ordinaryCause = Object.freeze(new Error('ordinary frozen query failed'));
  ordinary.state.queryError = ordinaryCause;
  const ordinaryQuery = ordinary.query(); await ordinary.state.queryEntered.promise;
  ordinary.state.tables.get('vectors').closeErrors.push(new Error('ordinary query cleanup failed'));
  await clearLanceDbConnectionCache(); ordinary.state.queryGate.resolve();
  const ordinaryCombined = await captureFailure(ordinaryQuery);
  assert.equal(ordinaryCombined.primaryError, ordinaryCause, 'a fallback-bound query error is retained if final cleanup also fails');
  assert.deepEqual(warnings, [], 'native failure and cleanup evidence propagate without claiming a fallback decision');
  await ordinaryCombined.lanceDbOwner.close(); assert.equal(ordinaryCombined.cacheOwnershipReleased(), true);

  const primary = await fixture('query-and-close'), primaryState = primary.state;
  let nestedReleased = false;
  const nestedCapability = Object.freeze({ close: () => { nestedReleased = true; } });
  const queryFailure = new Error('frozen primary query failure');
  Object.defineProperties(queryFailure, {
    code: { value: 'CONTROLLED_QUERY' }, nestedCapability: { value: nestedCapability },
    cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => nestedReleased }
  });
  Object.freeze(queryFailure);
  primaryState.queryEntered = deferred(); primaryState.queryGate = deferred(); primaryState.queryError = queryFailure;
  const active = primary.query(); await primaryState.queryEntered.promise;
  const tableFailure = Object.freeze(new Error('cleanup after failed query'));
  primaryState.tables.get('vectors').closeErrors.push(tableFailure);
  await clearLanceDbConnectionCache(); primaryState.queryGate.resolve();
  const primaryCombined = await captureFailure(active);
  assert.equal(primaryCombined.cause, queryFailure); assert.equal(primaryCombined.primaryError, queryFailure);
  assert.equal(primaryCombined.code, 'CONTROLLED_QUERY'); assert.equal(primaryCombined.nestedCapability, nestedCapability);
  assert.equal(primaryCombined.cleanupErrors[0].errors[0], tableFailure);
  await primaryCombined.lanceDbOwner.close();
  assert.equal(primaryCombined.cacheOwnershipReleased(), false, 'an unrelated original pending observer stays authoritative');
  nestedCapability.close(); assert.equal(primaryCombined.cacheOwnershipReleased(), true);
  assert.equal(Object.isFrozen(queryFailure), true);

  for (const rejectClose of [false, true]) {
    const cancelled = await fixture(`cancel-during-close-${rejectClose}`), controller = new AbortController();
    cancelled.state.queryEntered = deferred(); cancelled.state.queryGate = deferred();
    const pending = cancelled.query('vectors', controller.signal);
    await cancelled.state.queryEntered.promise;
    const table = cancelled.state.tables.get('vectors'); table.closeGate = deferred(); table.closeEntered = deferred();
    if (rejectClose) table.closeErrors.push(new Error('close rejected while cancelled'));
    await clearLanceDbConnectionCache(); cancelled.state.queryGate.resolve(); await table.closeEntered.promise;
    controller.abort(); table.closeGate.resolve();
    if (rejectClose) {
      const cancelledFailure = await captureFailure(pending);
      assert.equal(cancelledFailure.name, 'AbortError'); assert.equal(cancelledFailure.primaryError.code, 'ABORT_ERR');
      await cancelledFailure.lanceDbOwner.close(); assert.equal(cancelledFailure.cacheOwnershipReleased(), true);
    } else await assert.rejects(pending, { name: 'AbortError' });
  }

  const opening = await fixture('open-and-close');
  opening.state.openGate = deferred(); opening.state.openEntered = deferred();
  const openFailure = Object.freeze(new Error('open refused')), closeFailure = Object.freeze(new Error('close refused'));
  opening.state.openError = openFailure; opening.state.closeErrors.push(closeFailure);
  const openRequest = opening.query(); await opening.state.openEntered.promise;
  await clearLanceDbConnectionCache(); opening.state.openGate.resolve();
  const openCombined = await captureFailure(openRequest);
  assert.equal(openCombined.primaryError, openFailure); assert.equal(openCombined.cleanupErrors[0].errors[0], closeFailure);
  await openCombined.lanceDbOwner.close(); assert.equal(openCombined.cacheOwnershipReleased(), true);

  const missing = createLanceDbResourceOwner({}, 'controlled-missing-close');
  await assert.rejects(missing.close(), /no close method/); assert.equal(missing.pending, true);
  const captureError = Object.freeze(new Error('close getter rejected'));
  const inaccessible = createLanceDbResourceOwner(Object.defineProperty({}, 'close', { get() { throw captureError; } }), 'controlled-getter');
  await assert.rejects(inaccessible.close(), error => error === captureError); assert.equal(inaccessible.pending, true);
  let syncCloses = 0;
  const sync = createLanceDbResourceOwner({ closeSync() { syncCloses++; } }, 'controlled-sync');
  assert.deepEqual(await sync.close(), { settled: true, pending: false }); await sync.close(); assert.equal(syncCloses, 1);
  assert.deepEqual(warnings, [], 'ownership failures reach callers without a backend fallback warning');
} finally {
  for (const state of states.values()) {
    state.closeErrors.length = 0; state.openGate?.resolve(); state.queryGate?.resolve();
    for (const table of state.tables.values()) { table.closeErrors.length = 0; table.closeGate?.resolve(); }
  }
  await clearLanceDbConnectionCache(); hooks.deregister(); delete globalThis[key]; console.warn = originalWarn;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('LanceDB exact close ownership and primary-failure controls authored; native qualification remains separate.');
