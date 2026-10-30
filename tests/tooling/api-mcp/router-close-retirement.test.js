import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createRepoCacheManager } from '../../../src/shared/repo-cache-config.js';
import { closeApiRouterResources } from '../../../tools/api/router/close.js';

const contains = (error, expected) => {
  if (error === expected) return true;
  if (!error || typeof error !== 'object') return false;
  return Object.hasOwn(error, 'cause') && contains(error.cause, expected) || (Array.isArray(error.errors) && error.errors.some(value => contains(value, expected)));
};
for (const primary of [null, undefined, false, 0, '', Object.freeze(new Error('artifact close failed'))]) {
  const secondary = Object.freeze(new Error('embedding close failed')), calls = [];
  let caught, failed = false;
  try {
    await closeApiRouterResources({ closeArtifacts: () => { calls.push('artifacts'); throw primary; },
      closeRepoCaches: () => { calls.push('repo'); return { status: 'settled' }; },
      closeEmbeddings: () => { calls.push('embedding'); throw secondary; } });
  } catch (error) { failed = true; caught = error; }
  assert.equal(failed, true); assert.equal(contains(caught, primary), true); assert.equal(contains(caught, secondary), true);
  assert.deepEqual(calls, ['artifacts', 'repo', 'embedding']);
}

const manager = createRepoCacheManager({ defaultRepo: process.cwd(), namespace: 'authored-router-close' });
let allow = false, nativeCloses = 0, embeddings = 0;
const sentinel = Object.freeze(new Error('real manager retained native close'));
const entry = manager.getRepoCaches(process.cwd());
entry.sqliteCache.set('inert-router-close.db', { close() { nativeCloses++; if (!allow) throw sentinel; } });
globalThis.__routerRetirementManager = manager;
globalThis.__routerRetirementEmbeddings = () => { embeddings++; };
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/tools/api/router/cache.js')) return { format: 'module', shortCircuit: true,
    source: 'export const createRepoCacheManager = () => globalThis.__routerRetirementManager;' };
  if (url.endsWith('/src/shared/embedding-adapter.js')) return { format: 'module', shortCircuit: true,
    source: 'export const disposeEmbeddingAdapterCaches = () => globalThis.__routerRetirementEmbeddings();' };
  return next(url, context);
} });
try {
  const { createApiRouter } = await import('../../../tools/api/router.js');
  const router = createApiRouter({ host: '127.0.0.1', defaultRepo: process.cwd(), defaultOutput: '', metricsRegistry: null });
  const closing = router.close(); assert.equal(router.close(), closing, 'router cleanup has one memoized owner');
  let failure;
  try { await closing; } catch (error) { failure = error; }
  assert.ok(failure); assert.equal(contains(failure, sentinel), true);
  assert.equal(nativeCloses, 1); assert.equal(embeddings, 1); assert.equal(failure.cacheOwnershipReleased(), false);
  allow = true; entry.sqliteCache.pendingOwners()[0].release();
  assert.equal(nativeCloses, 2); assert.equal(failure.cacheOwnershipReleased(), true);
  assert.equal(manager.closeRepoCaches().status, 'settled');

  const secondEntry = manager.getRepoCaches(process.cwd());
  const nativeFailure = Object.freeze(new Error('second native failure'));
  const embeddingFailure = Object.freeze(new Error('simultaneous embedding failure'));
  let secondAllowed = false;
  secondEntry.sqliteCache.set('inert-router-second.db', { close() { if (!secondAllowed) throw nativeFailure; } });
  globalThis.__routerRetirementEmbeddings = () => { embeddings++; throw embeddingFailure; };
  const secondRouter = createApiRouter({ host: '127.0.0.1', defaultRepo: process.cwd(), defaultOutput: '', metricsRegistry: null });
  try {
    await assert.rejects(secondRouter.close(), error => contains(error, nativeFailure) && contains(error, embeddingFailure)
      && error.cacheOwnershipReleased() === false);
    assert.equal(embeddings, 2);
  } finally {
    secondAllowed = true;
    for (const owner of secondEntry.sqliteCache.pendingOwners()) owner.release();
    manager.closeRepoCaches();
  }
} finally {
  allow = true;
  for (const owner of entry.sqliteCache.pendingOwners()) owner.release();
  manager.closeRepoCaches(); hook.deregister(); delete globalThis.__routerRetirementManager; delete globalThis.__routerRetirementEmbeddings;
}
console.log('Actual API router close retains repository failure while independent embedding cleanup completes.');
