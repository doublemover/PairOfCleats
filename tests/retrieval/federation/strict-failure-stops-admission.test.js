import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { writeFederationRepoFixture } from './repo-fixture.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const emptyResult = () => ({ backend: 'memory', code: [], prose: [], extractedProse: [], records: [] });
const root = toRealPathSync(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-terminal-admission-')));
const cacheRoot = path.join(root, 'cache');
applyTestEnv({ cacheRoot });

try {
  const descriptors = new Map();
  for (const leaf of ['a', 'b', 'c', 'd']) {
    descriptors.set(path.join(root, leaf), await writeFederationRepoFixture({
      repoRoot: path.join(root, leaf), cacheRoot, modes: ['code', 'prose', 'extracted-prose', 'records']
    }));
  }
  const workspacePath = path.join(root, 'workspace.json');
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache',
    repos: ['a', 'b', 'c', 'd'].map(leaf => ({ root: `./${leaf}` })) }));
  const orderedRepos = loadWorkspaceConfig(workspacePath).repos.slice().sort((a, b) => a.repoId.localeCompare(b.repoId));
  const [first, sibling] = orderedRepos.map(repo => repo.repoRootCanonical);
  const request = { workspacePath, search: { mode: 'code' }, strict: true, limits: { concurrency: 2 } };

  // Both resolver and search boundaries use real coordinator admission and tiny
  // per-repository manifests. Promise gates fix the interleaving without timers.
  for (const boundary of ['resolver', 'search', 'missing-index']) {
    for (const ownership of ['local', 'host']) {
      const started = deferred();
      const release = deferred();
      const original = createError(boundary === 'missing-index' ? ERROR_CODES.NO_INDEX : ERROR_CODES.INTERNAL, `${boundary} primary`);
      const resolved = [];
      const searched = [];
      const clears = { index: 0, sqlite: 0 };
      const hostIndex = new Map();
      const hostSqlite = createSqliteDbCache();
      let indexCache;
      let sqliteCache;
      const observeCaches = params => {
        if (indexCache) return;
        indexCache = params.indexCache;
        sqliteCache = params.sqliteCache;
        const clearIndex = indexCache.clear.bind(indexCache);
        const disposeSqlite = sqliteCache.dispose.bind(sqliteCache);
        indexCache.clear = () => { clears.index++; clearIndex(); throw new Error('secondary index cleanup'); };
        sqliteCache.dispose = () => { clears.sqlite++; disposeSqlite(); throw new Error('secondary sqlite cleanup'); };
        indexCache.set('live', {});
      };
      const pending = runFederatedSearch({ ...request, query: `${boundary}-${ownership}` }, {
        ...(ownership === 'host' ? { indexCache: hostIndex, sqliteCache: hostSqlite } : {}),
        resolveRepoCaches: async repo => {
          resolved.push(repo);
          if (boundary === 'resolver') {
            if (repo === first) { await started.promise; throw original; }
            if (repo === sibling) { started.resolve(); await release.promise; }
          }
          return null;
        },
        searchPolicyId: 'fixture-query-policy@1', searchFn: async (repo, params) => {
          searched.push(repo);
          observeCaches(params);
          if (repo === first) { await started.promise; throw original; }
          if (repo === sibling) {
            started.resolve();
            await release.promise;
            assert.equal(clears.index, 0, 'request caches stay live until the started search drains');
            throw new Error('late sibling rejection');
          }
          return emptyResult();
        }
      });
      // Attach rejection observation before either gate can trigger it.
      const rejected = assert.rejects(pending, error => {
        assert.equal(error.code, original.code);
        assert.equal(error.cause, original, 'the originating error survives secondary rejection and cleanup');
        assert.match(error.message, new RegExp(`${boundary} primary`));
        return true;
      });
      try {
        await started.promise;
        await rejected;
        assert.deepEqual(resolved, [first, sibling]);
        assert.deepEqual(searched, boundary === 'resolver' ? [] : [first, sibling]);
        assert.deepEqual(clears, { index: 0, sqlite: 0 });
      } finally {
        release.resolve();
        await tick();
      }
      assert.deepEqual(resolved, [first, sibling], 'no previously unclaimed repositories may resolve after failure');
      assert.deepEqual(searched, boundary === 'resolver' ? [] : [first, sibling],
        'a claimed repository may not start searching after its resolver drains');
      assert.deepEqual(clears, indexCache && ownership === 'local' ? { index: 1, sqlite: 1 } : { index: 0, sqlite: 0 });
      // The host owns retirement even when request cleanup would fail.
      if (ownership === 'host' && indexCache) {
        assert.equal(hostIndex.size, 1);
        assert.throws(() => hostIndex.clear(), /secondary index cleanup/);
        assert.throws(() => hostSqlite.dispose(), /secondary sqlite cleanup/);
      } else hostSqlite.dispose();
    }
  }

  for (const strict of [false, true]) {
    const controller = new AbortController();
    const gates = [deferred(), deferred()];
    const started = deferred();
    const resolved = [];
    const searched = [];
    const pending = runFederatedSearch({ ...request, query: `external-abort-${strict}`, strict }, {
      signal: controller.signal,
      resolveRepoCaches: async repo => { resolved.push(repo); return null; },
      searchPolicyId: 'fixture-query-policy@1', searchFn: async repo => {
        const index = searched.push(repo) - 1;
        if (searched.length === 2) started.resolve();
        await gates[index].promise;
        return emptyResult();
      }
    });
    const rejected = assert.rejects(pending, { code: ERROR_CODES.CANCELLED });
    try {
      await started.promise;
      controller.abort();
      await rejected; // Abort rejects while both started operations still drain.
    } finally {
      gates.forEach(gate => gate.resolve());
      await tick();
    }
    assert.deepEqual(resolved, [first, sibling]);
    assert.deepEqual(searched, [first, sibling]);
  }

  const sequential = [];
  await assert.rejects(runFederatedSearch({ ...request, query: 'concurrency-one', limits: { concurrency: 1 } }, {
    searchPolicyId: 'fixture-query-policy@1', searchFn: async repo => { sequential.push(repo); throw createError(ERROR_CODES.INTERNAL, 'first'); }
  }), { code: ERROR_CODES.INTERNAL });
  assert.deepEqual(sequential, [first]);

  const bestEffort = [];
  const partial = await runFederatedSearch({ ...request, query: 'non-strict-control', strict: false }, {
    searchPolicyId: 'fixture-query-policy@1', searchFn: async repo => {
      bestEffort.push(repo);
      if (repo === first) throw createError(ERROR_CODES.INTERNAL, 'repo fault');
      return emptyResult();
    }
  });
  assert.equal(partial.status, 'partial');
  assert.deepEqual(bestEffort.slice().sort(), orderedRepos.map(repo => repo.repoRootCanonical).sort());

  for (const strict of [false, true]) {
    let calls = 0;
    const cachedRequest = { ...request, query: `cancelled-cache-hit-${strict}`, strict };
    const context = { searchPolicyId: 'fixture-query-policy@1', searchFn: async () => { calls++; return emptyResult(); } };
    await runFederatedSearch(cachedRequest, context);
    assert.equal(calls, 4);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(runFederatedSearch(cachedRequest, { ...context, signal: controller.signal }), { code: ERROR_CODES.CANCELLED });
    assert.equal(calls, 4, 'pre-aborted requests cannot return a cached success or start another child');
  }

  // Exclude only this sibling's extracted-prose cohort so it needs separate
  // code/prose/records calls. Strict failure must stop its second mode admission.
  await fs.writeFile(path.join(descriptors.get(sibling).indexes['extracted-prose'].indexDir, 'index_state.json'),
    JSON.stringify({ ...JSON.parse(await fs.readFile(path.join(descriptors.get(sibling).indexes['extracted-prose'].indexDir,
      'index_state.json'), 'utf8')), compatibilityKey: 'different-extracted-cohort' }));
  const modeStarted = deferred();
  const modeRelease = deferred();
  const modeCalls = [];
  const pending = runFederatedSearch({ ...request, query: 'stop-second-mode', search: { mode: 'all' } }, {
    searchPolicyId: 'fixture-query-policy@1', searchFn: async (repo, { args }) => {
      modeCalls.push([repo, args[args.indexOf('--mode') + 1]]);
      if (repo === first) { await modeStarted.promise; throw createError(ERROR_CODES.INVALID_REQUEST, 'mode failure'); }
      modeStarted.resolve();
      await modeRelease.promise;
      return emptyResult();
    }
  });
  const rejected = assert.rejects(pending, { code: ERROR_CODES.INVALID_REQUEST });
  try { await modeStarted.promise; await rejected; } finally { modeRelease.resolve(); await tick(); }
  assert.deepEqual(modeCalls, [[first, 'all'], [sibling, 'code']]);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Federated terminal failures stop repository/mode admissions and drain started cache owners.');
