import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import Database from 'better-sqlite3';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';

applyTestEnv();
const source = new URL('../../../tools/build/embeddings/text-kv-cache.js', import.meta.url).href;
const capacity = new URL('../../../tools/build/embeddings/cache/text-capacity.js', import.meta.url).href;
const fixtureUrl = 'text-cache-measurement:bounded-capacity';
const pageLimit = 2048, dims = 1024;
let observedDb;
globalThis.textTurnoverMeasurement = db => { observedDb = db; };
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(source) && specifier === './cache/text-capacity.js') return { url: fixtureUrl, shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url === fixtureUrl) return { format: 'module', shortCircuit: true, source: `
    import {createTextCacheCapacityAdmission as real,isTextCacheCapacityRejection} from ${JSON.stringify(capacity)};
    export {isTextCacheCapacityRejection};
    export const createTextCacheCapacityAdmission=input=>{
      // Stricter real native capacity, also installed by the fresh reopen
      // process. Production profile/journal reservations remain unchanged.
      const pageLimit=${pageLimit};
      if(Number(input.db.pragma('max_page_count = '+pageLimit,{simple:true}))!==pageLimit)throw Error('capacity installation failed');
      globalThis.textTurnoverMeasurement(input.db);
      return real({...input,pageLimit});
    };` };
  return next(url, context);
} });
const { createPersistentEmbeddingTextKvStore } = await import(source + '?turnover-measurement');
const createVector = index => Float32Array.from({ length: dims }, (_, column) => ((index + column) % 31 - 15) / 16);
const open = async (cacheRoot, encoding) => {
  const store = await createPersistentEmbeddingTextKvStore({ Database, cacheRoot,
    cacheIdentity: { provider: 'stub', modelId: 'measured-capacity', dims }, cacheIdentityKey: `measurement-${encoding}`,
    vectorEncoding: encoding, maxEntries: 500000 });
  assert.ok(store); assert.equal(store.stats().databasePageSize, 4096);
  assert.equal(store.stats().databasePageLimit, pageLimit); return store;
};
const reopened = process.argv[2] === '--reopen';
let store, directory;
try {
  if (reopened) {
    const [, , , cacheRoot, encoding, lastText, lastIndex] = process.argv;
    store = await open(cacheRoot, encoding);
    const started = performance.now();
    for (const [text, index] of [['hot', 0], [lastText, Number(lastIndex)]]) {
      assert.deepEqual(store.get(text), createVector(index));
    }
    assert.equal(store.get('cycle-0-item-0'), null, 'first-cycle cold row was evicted from persisted capacity');
    const sample = { phase: 'new-process-persistent-read', pid: process.pid, encoding,
      elapsedMs: performance.now() - started, inferences: 0, ...store.stats() };
    assert.equal(sample.hits, 2); assert.equal(sample.misses, 1); assert.equal(sample.writes, 0);
    await store.close(); store = null;
    console.log(JSON.stringify(sample));
  } else {
    const encoding = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
    assert.ok(['float32', 'float16'].includes(encoding));
    ({ dir: directory } = await prepareIsolatedTestCacheDir(`text-turnover-measurements-${encoding}`));
    const cacheRoot = path.join(directory, 'cache'); store = await open(cacheRoot, encoding);
    const bytesPerVector = dims * (encoding === 'float32' ? 4 : 2);
    const rowsPerCycle = pageLimit * 4096 / bytesPerVector;
    let inferences = 0, publishedPayloadBytes = 0;
    const resolve = (text, index) => {
      const existing = store.get(text);
      if (existing) return existing;
      // Recording deterministic provider, separate from real-model latency.
      inferences++; const vector = createVector(index);
      assert.equal(store.set(text, vector), true); publishedPayloadBytes += bytesPerVector;
      return vector;
    };
    resolve('hot', 0); assert.equal(store.flush(), true);
    for (let cycle = 0; cycle < 3; cycle++) {
      const started = performance.now(), before = store.stats(), beforeInference = inferences;
      for (let index = 0; index < rowsPerCycle; index++) {
        if (index % 64 === 0) assert.deepEqual(resolve('hot', 0), createVector(0));
        resolve(`cycle-${cycle}-item-${index}`, cycle * rowsPerCycle + index);
        if ((index + 1) % 64 === 0) assert.equal(store.flush(), true);
      }
      assert.equal(store.flush(), true);
      const stats = store.stats();
      assert.equal(stats.errors, 0); assert.equal(stats.capacityRejectedWrites, 0);
      assert.ok(stats.capacityEvictions > before.capacityEvictions, 'each full payload-capacity cycle performs actual native eviction');
      assert.ok(stats.capacityEvictionRounds <= stats.transactions * 16);
      assert.equal(Number(observedDb.pragma('max_page_count', { simple: true })), pageLimit);
      assert.ok(Number(observedDb.pragma('page_count', { simple: true })) <= pageLimit);
      console.log(JSON.stringify({ phase: 'capacity-turnover', pid: process.pid, encoding, dims, cycle,
        rowsPerCycle, payloadBytes: rowsPerCycle * bytesPerVector, publishedPayloadBytes,
        elapsedMs: performance.now() - started, inferences: inferences - beforeInference,
        cycleHits: stats.hits - before.hits, cycleMisses: stats.misses - before.misses,
        cycleTransactions: stats.transactions - before.transactions, ...stats }));
    }
    const lastIndex = 3 * rowsPerCycle - 1, lastText = `cycle-2-item-${rowsPerCycle - 1}`;
    const totals = store.stats(); assert.equal(totals.writes, 1 + 3 * rowsPerCycle);
    assert.equal(inferences, totals.writes); assert.ok(totals.size < totals.maxEntries);
    await store.close(); store = null;
    const child = runNode([fileURLToPath(import.meta.url), '--reopen', cacheRoot, encoding, lastText, String(lastIndex)],
      'fresh-process persistent cache qualification', process.cwd(), process.env, { stdio: 'pipe', timeoutMs: 10000 });
    const sample = JSON.parse(child.stdout.trim().split('\n').at(-1));
    assert.notEqual(sample.pid, process.pid); assert.equal(sample.phase, 'new-process-persistent-read');
    console.log(JSON.stringify(sample));
  }
} finally {
  try { await store?.close(); }
  finally { hooks.deregister(); delete globalThis.textTurnoverMeasurement;
    if (directory) await fs.rm(directory, { recursive: true, force: true }); }
}
