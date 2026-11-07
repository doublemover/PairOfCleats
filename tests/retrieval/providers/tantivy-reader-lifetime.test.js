import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Module from 'node:module';
import { createTantivyProvider } from '../../../src/retrieval/sparse/providers/tantivy.js';
import { runSearchByMode } from '../../../src/retrieval/cli/search-runner.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../../src/shared/storage/access.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tantivy-reader-lifetime/')[1];
assert.ok(['original-close', 'module-close', 'pending-close', 'failed-close', 'pending-query',
  'async-query', 'missing-close', 'ordinal', 'search-finalizer'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`tantivy-reader-${selected}`);
const repoRoot = path.join(dir, 'repo'), cacheRoot = path.join(dir, 'cache'), home = path.join(dir, 'home');
await fs.mkdir(repoRoot);
applyTestEnv({ cacheRoot, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cacheRoot } }, context = { repoRoot, userConfig };
const target = path.join(resolveRepoCacheRootPath(repoRoot, userConfig), 'tantivy', 'code', 'generations', 'immutable');
await fs.mkdir(target, { recursive: true });
const coordinationRoot = path.join(home, 'state', 'storage-access');
const protectedPayload = async expected => assert.equal((await inspectStorageAccess(target, { coordinationRoot })).protected, expected);
const sentinel = Object.freeze(new Error('original native failure'));
let closeCalls = 0, replacedCalls = 0, release, querySettled = false;
const gate = new Promise(resolve => { release = resolve; });
const physicalClose = function () {
  assert.equal(this, handle); closeCalls++;
  if (selected === 'failed-close') throw sentinel;
  if (selected === 'pending-close') return gate;
};
const handle = selected === 'missing-close' || selected === 'module-close' ? {} : { close: physicalClose };
const pendingError = Object.freeze(Object.assign(new Error('native query remains active'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => querySettled
}));
const api = { openIndex(opened) { assert.equal(opened, target); return handle; }, search() {
  if (selected === 'pending-query') throw pendingError;
  if (selected === 'async-query') return gate.then(() => { querySettled = true; return []; });
  return [{ idx: selected === 'ordinal' ? 1 : 0, score: 1 }];
} };
if (selected === 'module-close') api.closeIndex = function (resource) { assert.equal(this, api); assert.equal(resource, handle); closeCalls++; };
const original = Module._load;
Module._load = function (name, ...args) { return name === 'tantivy' ? api : original.call(this, name, ...args); };
const input = { idx: { chunkMeta: [{ id: 0 }], tantivy: { available: true, dir: target, storageContext: context } },
  queryTokens: ['needle'], mode: 'code', topN: 1 };
const contains = (error, expected, seen = new Set()) => {
  if (error === expected) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return contains(error.cause, expected, seen) || error instanceof AggregateError && error.errors.some(value => contains(value, expected, seen));
};
try {
  const provider = createTantivyProvider();
  if (['pending-query', 'async-query', 'missing-close', 'ordinal'].includes(selected)) {
    assert.throws(() => provider.search(input), error => selected === 'pending-query' ? error === pendingError
      : error.code === (selected === 'missing-close' ? 'ERR_TANTIVY_UNAVAILABLE' : 'ERR_TANTIVY_RESPONSE'));
  } else assert.deepEqual(provider.search(input).hits, [{ idx: 0, score: 1 }]);
  await protectedPayload(true);
  if (selected === 'original-close') {
    handle.close = () => { replacedCalls++; };
    assert.deepEqual(provider.search(input).hits, [{ idx: 0, score: 1 }]);
  }
  if (selected === 'pending-query') {
    await assert.rejects(provider.dispose(), error => contains(error, pendingError));
    assert.equal(closeCalls, 0, 'outstanding native work must block the original close');
    await protectedPayload(true); querySettled = true;
    await provider.dispose(); await protectedPayload(false);
    assert.equal(closeCalls, 1, 'explicit reconciliation can close only after the original query actually settles');
  } else if (selected === 'failed-close' || selected === 'missing-close') {
    await assert.rejects(provider.dispose(), error => selected === 'failed-close' ? contains(error, sentinel) : true);
    await protectedPayload(true);
    if (selected === 'failed-close') {
      await assert.rejects(provider.dispose(), error => contains(error, sentinel));
      assert.equal(closeCalls, 1, 'a failed physical close cannot be replayed as metadata recovery');
    }
  } else if (selected === 'pending-close' || selected === 'async-query') {
    const first = provider.dispose(); assert.equal(provider.dispose(), first);
    let ended = false; const drained = first.then(() => { ended = true; }, () => { ended = true; });
    try {
      await new Promise(resolve => setImmediate(resolve)); assert.equal(ended, false); await protectedPayload(true);
      const busy = await withExclusiveStorageAccess(target, () => assert.fail('a live native reader cannot be deleted'), { coordinationRoot });
      assert.equal(busy.protected, true);
    } finally { release(); await drained; }
    await first; await protectedPayload(false); assert.equal(closeCalls, 1);
    if (selected === 'async-query') assert.equal(querySettled, true);
  } else if (selected === 'search-finalizer') {
    const search = async () => { throw sentinel; };
    const cleanup = Object.freeze(new Error('controlled reader cleanup failure'));
    search.dispose = async () => { await provider.dispose(); throw cleanup; };
    await assert.rejects(runSearchByMode({ searchPipeline: search, runCode: true }), error => contains(error, sentinel) && contains(error, cleanup));
    await protectedPayload(false); assert.equal(closeCalls, 1);
  } else {
    await provider.dispose(); await protectedPayload(false);
    assert.equal(closeCalls, 1); assert.equal(replacedCalls, 0);
    await provider.dispose(); assert.equal(closeCalls, 1);
  }
} finally { release(); Module._load = original; }
console.log(`Tantivy reader lifetime ${selected}: explicit protocol adapter, no native qualification.`);
