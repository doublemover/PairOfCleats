import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';
import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { writeFederationRepoFixture } from './repo-fixture.js';

const { dir } = await prepareIsolatedTestCacheDir('federated-cache-retirement');
const cacheRoot = path.join(dir, 'cache'); applyTestEnv({ cacheRoot });
for (const name of ['a', 'b']) await writeFederationRepoFixture({ repoRoot: path.join(dir, name), cacheRoot });
const workspacePath = path.join(dir, 'workspace.json');
await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache',
  repos: ['a', 'b'].map(name => ({ root: './' + name })) }));
const request = { workspacePath, search: { mode: 'code' }, strict: true, limits: { concurrency: 2 } };
const result = () => ({ backend: 'memory', code: [], prose: [], extractedProse: [], records: [] });
const contains = (value, expected, seen = new Set()) => {
  if (value === expected) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return contains(value.cause, expected, seen) || (Array.isArray(value.errors) && value.errors.some(row => contains(row, expected, seen)));
};
for (const terminal of ['success', 'strict-failure']) {
  let nativeAllowed = false, failedCloses = 0, healthyCloses = 0, indexClears = 0, calls = 0, cache = null;
  const nativeFailure = Object.freeze(new Error('inert original SQLite close failure'));
  const indexFailure = Object.freeze(new Error('independent index clear failure'));
  const primary = Object.freeze(createError(ERROR_CODES.INTERNAL, 'strict sibling primary'));
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const search = runFederatedSearch({ ...request, query: terminal }, {
    searchPolicyId: 'fixture-query-policy@1', searchFn: async (repo, params) => {
      const index = calls++;
      if (!cache) {
        cache = params.sqliteCache;
        const clear = params.indexCache.clear.bind(params.indexCache);
        params.indexCache.clear = () => { indexClears++; clear(); throw indexFailure; };
      }
      const db = index === 0 ? { close() { failedCloses++; if (!nativeAllowed) throw nativeFailure; } }
        : { close() { healthyCloses++; } };
      const target = path.join(repo, terminal + '.db'); await fs.writeFile(target, 'inert identity');
      const lease = params.sqliteCache.setAndAcquire(target, db);
      try {
        if (terminal === 'strict-failure') {
          if (index === 0) { await started.promise; throw primary; }
          started.resolve(); await release.promise;
          assert.equal(indexClears, 0); assert.equal(healthyCloses + failedCloses, 0,
            'the original started worker retains cache lifetime until it settles');
        }
        return result();
      } finally { lease.release(); }
    }
  });
  let early, retirement;
  const rejected = assert.rejects(search, error => {
    early = error; retirement = error.federationCacheRetirement;
    assert.ok(retirement); assert.equal(Object.keys(error).includes('federationCacheRetirement'), false);
    assert.equal(error.cacheOwnershipReleased(), false);
    if (terminal === 'strict-failure') {
      assert.equal(error.cause, primary);
      assert.equal(retirement.getReceipt().status, 'draining');
    } else {
      assert.equal(contains(error, nativeFailure), true); assert.equal(contains(error, indexFailure), true);
      assert.equal(retirement.getReceipt().status, 'failed');
    }
    return true;
  });
  try {
    if (terminal === 'strict-failure') await started.promise;
    await rejected;
    if (terminal === 'strict-failure') assert.equal(failedCloses + healthyCloses, 0);
    release.resolve();
    await assert.rejects(retirement.drain(), error => contains(error, nativeFailure) && contains(error, indexFailure));
    assert.equal(indexClears, 1); assert.equal(failedCloses, 1); assert.equal(healthyCloses, 1);
    assert.equal(early.cacheOwnershipReleased(), false);
    await assert.rejects(retirement.drain());
    assert.equal(failedCloses, 1, 'observing retirement again must not retry native close');
    assert.equal(retirement.getReceipt().failedCloseOwners, 1);
    const owner = cache.pendingOwners()[0]; assert.ok(owner);
    nativeAllowed = true; owner.release();
    assert.equal(failedCloses, 2); assert.equal(early.cacheOwnershipReleased(), true);
    assert.equal(retirement.getReceipt().resourcesSettled, true);
    assert.equal(retirement.getReceipt().status, 'failed', 'eventual settlement cannot rewrite the original cleanup outcome');
  } finally {
    release.resolve(); nativeAllowed = true;
    if (retirement) await retirement.drain().catch(() => {});
    for (const owner of cache?.pendingOwners() || []) owner.release();
  }
}

let activeLease = null, activeCloses = 0, activeFailure, activeAssigned = false;
try {
  await assert.rejects(runFederatedSearch({ ...request, query: 'outstanding-owned-lease' }, {
    searchPolicyId: 'fixture-query-policy@1', searchFn: async (repo, params) => {
      if (!activeAssigned) {
        activeAssigned = true;
        const target = path.join(repo, 'active.db'); await fs.writeFile(target, 'inert identity');
        activeLease = params.sqliteCache.setAndAcquire(target, { close() { activeCloses++; } });
      }
      return result();
    }
  }), error => {
    activeFailure = error;
    const receipt = error.federationCacheRetirement.getReceipt();
    assert.equal(receipt.resourceStatus, 'retiring'); assert.equal(receipt.activeLeaseOwners, 1);
    assert.equal(receipt.failedCloseOwners, 0); assert.equal(receipt.resourcesSettled, false);
    assert.equal(error.cacheOwnershipReleased(), false); assert.equal(activeCloses, 0);
    return true;
  });
  activeLease.release();
  assert.equal(activeCloses, 1); assert.equal(activeFailure.cacheOwnershipReleased(), true);
  assert.equal(activeFailure.federationCacheRetirement.getReceipt().status, 'failed');
} finally { activeLease?.release(); }

const borrowed = createSqliteDbCache(), borrowedIndex = new Map();
let borrowedCloses = 0;
await runFederatedSearch({ ...request, query: 'borrowed-owners' }, {
  indexCache: borrowedIndex, sqliteCache: borrowed, searchPolicyId: 'fixture-query-policy@1',
  searchFn: async (repo, params) => {
    const target = path.join(repo, 'borrowed.db'); await fs.writeFile(target, 'inert identity');
    params.sqliteCache.set(target, { close() { borrowedCloses++; } });
    params.indexCache.set(repo, {}); return result();
  }
});
assert.equal(borrowedCloses, 0); assert.equal(borrowedIndex.size, 2);
borrowed.dispose(); assert.equal(borrowedCloses, 2); borrowedIndex.clear();
console.log('Federation surfaces actual SQLite/index retirement failures after success and fail-fast drain, without native retries or borrowed-cache disposal.');
