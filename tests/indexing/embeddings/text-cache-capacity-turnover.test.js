import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import Database from 'better-sqlite3';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('text-cache-capacity-turnover');
const source = new URL('../../../tools/build/embeddings/text-kv-cache.js', import.meta.url).href;
const capacity = new URL('../../../tools/build/embeddings/cache/text-capacity.js', import.meta.url).href;
const fixtureUrl = 'text-cache-capacity-fixture:small-database';
const state = { db: null, fault: null, upsertCalls: 0 };
globalThis.textCapacityFixture = state;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(source) && specifier === './cache/text-capacity.js') return { url: fixtureUrl, shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url === fixtureUrl) return { format: 'module', shortCircuit: true, source: `
    import {createTextCacheCapacityAdmission as real,isTextCacheCapacityRejection} from ${JSON.stringify(capacity)};
    export {isTextCacheCapacityRejection};
    export const createTextCacheCapacityAdmission=input=>{
      // A stricter real SQLite limit keeps this fixture small. No forged page
      // receipt, public option, native substitute or production cap relaxation.
      const pageLimit=128;
      if(Number(input.db.pragma('max_page_count = '+pageLimit,{simple:true}))!==pageLimit)throw Error('fixture capacity not installed');
      globalThis.textCapacityFixture.db=input.db;
      return real({...input,pageLimit});
    };` };
  return next(url, context);
} });
const stores = new Set();
try {
  const { createPersistentEmbeddingTextKvStore } = await import(source + '?capacity-turnover');
  const ObservedDatabase = function (...args) {
    const db = new Database(...args), prepare = db.prepare.bind(db);
    db.pragma('page_size = 4096');
    db.prepare = sql => {
      const statement = prepare(sql);
      if (sql.includes('INSERT INTO text_vectors')) {
        const run = statement.run.bind(statement);
        statement.run = (...values) => { state.upsertCalls++; if (state.fault) throw state.fault; return run(...values); };
      }
      return statement;
    };
    return db;
  };
  const open = async options => {
    const store = await createPersistentEmbeddingTextKvStore(options); assert.ok(store); stores.add(store); return store;
  };
  const close = async store => { await store.close(); stores.delete(store); };
  for (const encoding of ['float32', 'float16']) {
    const options = { Database: ObservedDatabase, cacheRoot: path.join(dir, encoding),
      cacheIdentity: { key: encoding, provider: 'stub', modelId: 'capacity-fixture', dims: 1024 },
      cacheIdentityKey: `capacity-${encoding}`, vectorEncoding: encoding, maxEntries: 500000 };
    const vector = value => new Float32Array(1024).fill(value / 16);
    const store = await open(options);
    store.set('hot', vector(1)); assert.equal(store.flush(), true);
    for (let batch = 0; batch < 80; batch++) {
      assert.deepEqual(store.get('hot'), vector(1), 'coalesced hot touches precede oldest-row admission eviction');
      for (let item = 0; item < 4; item++) assert.equal(store.set(`batch-${batch}-${item}`, vector(batch * 4 + item)), true);
      assert.equal(store.flush(), true, `${encoding}: bounded incoming working set should persist through turnover`);
    }
    const stats = store.stats();
    assert.ok(stats.capacityEvictions > 0); assert.ok(stats.capacityEvictionRounds > 0);
    assert.equal(stats.capacityRejectedWrites, 0); assert.equal(stats.capacityAdmissionFailures, 0);
    assert.equal(stats.errors, 0); assert.equal(stats.writes, 321);
    assert.ok(stats.size < stats.maxEntries, 'byte saturation occurs below the old count-only prune threshold');
    assert.equal(stats.prunes, 0, 'capacity turnover is distinct from count overflow');
    assert.equal(stats.databasePageLimit, 128); assert.ok(stats.capacityEvictionRounds <= stats.transactions * 16);
    const db = state.db;
    assert.equal(Number(db.pragma('max_page_count', { simple: true })), 128);
    assert.ok(Number(db.pragma('page_count', { simple: true })) <= 128);
    const rows = () => db.prepare('SELECT cache_key, hex(vector_blob) AS vector FROM text_vectors ORDER BY cache_key').all();
    for (const code of ['SQLITE_FULL', 'ERR_EMBEDDING_TEXT_CACHE_CAPACITY']) {
      const before = rows(), counters = store.stats(), calls = state.upsertCalls;
      state.fault = Object.assign(new Error('explicit unrelated write-pressure fixture'), { code });
      store.set(`pressure-${code}`, vector(2)); assert.equal(store.flush(), false); state.fault = null;
      assert.equal(state.upsertCalls, calls + 1, 'generic pressure does not trigger native write retries');
      assert.deepEqual(rows(), before, 'all touches/evictions/writes roll back with a failed transaction');
      assert.equal(store.stats().capacityEvictions, counters.capacityEvictions);
      assert.equal(store.stats().capacityAdmissionFailures, counters.capacityAdmissionFailures);
      assert.equal(store.stats().errors, counters.errors + 1, 'copied capacity codes are not owner-proved admission rejection');
      assert.equal(store.stats().pendingWrites, 0);
    }
    await close(store);
    const reopened = await open(options);
    for (let item = 0; item < 4; item++) assert.deepEqual(reopened.get(`batch-79-${item}`), vector(316 + item));
    assert.deepEqual(reopened.get('hot'), vector(1));
    assert.equal(reopened.get('batch-0-0'), null, 'bounded older rows can leave the persistent working set');
    await close(reopened);
  }
  const oversized = await open({ Database: ObservedDatabase, cacheRoot: path.join(dir, 'oversized'),
    cacheIdentity: { key: 'oversized', provider: 'stub', modelId: 'capacity-fixture', dims: 32768 },
    cacheIdentityKey: 'oversized', maxEntries: 500000 });
  for (let index = 0; index < 4; index++) assert.equal(oversized.set(`too-large-${index}`, new Float32Array(32768).fill(0.5)), true);
  const upserts = state.upsertCalls;
  assert.equal(oversized.flush(), false); assert.equal(state.upsertCalls, upserts, 'inadmissible batches never reach native upserts');
  assert.equal(oversized.size(), 0); assert.equal(oversized.stats().capacityRejectedWrites, 4);
  assert.equal(oversized.stats().capacityAdmissionFailures, 1); assert.equal(oversized.stats().errors, 0);
  assert.equal(oversized.stats().pendingWrites, 0); await close(oversized);
} finally {
  state.fault = null;
  try { for (const store of stores) await store.close(); }
  finally { hooks.deregister(); delete globalThis.textCapacityFixture; await fs.rm(dir, { recursive: true, force: true }); }
}
console.log('Persistent text-vector capacity admission turns over real bounded SQLite pages, preserves newer exact vectors and distinguishes pressure from capacity policy.');
