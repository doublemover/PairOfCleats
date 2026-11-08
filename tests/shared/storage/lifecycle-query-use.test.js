import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeQueryCacheLastUse, persistQueryCacheTouch } from '../../../src/retrieval/query-cache-touches.js';
import { observeLifecycleUse } from '../../../src/shared/storage/lifecycle-use.js';
import { inspectStorageInventory } from '../../../src/shared/storage/inventory.js';
import { createStorageInspectionAdmission } from '../../../src/shared/storage/inspection-admission.js';
import { decideStorageLifecycle } from '../../../src/shared/storage/policy.js';
import { planLifecycleCleanup } from '../../../src/shared/storage/cleanup.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planStoragePolicy, applyStoragePolicy } from '../../../src/shared/storage/probe-policy.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/lifecycle-query-use/')[1];
assert.ok(['payload-bound-recency', 'passive-and-incomplete-inputs', 'lower-bound-age-refusal', 'coalesced-original-journal',
  'read-only-original-inventory', 'changed-input-refusal', 'writer-refusal', 'lifecycle-preview-preserves-cache', 'original-close-refusal'].includes(mode));
const entry = { key: 'query-key', signature: 'generation-a', payloadId: 'payload-a', ts: 1000, payload: { code: [] } };
const cache = () => ({ version: 1, entries: [{ ...entry }] });
const touch = (ts, fields = {}) => ({ key: entry.key, signature: entry.signature, payloadId: entry.payloadId, ts, ...fields });
if (mode === 'payload-bound-recency') {
  const result = observeQueryCacheLastUse(cache(), { version: 1, entries: [touch(1200), touch(9000, { payloadId: 'retired-payload' }),
    touch(10000, { signature: 'retired-generation' })] });
  assert.equal(result.timestamp, new Date(1200).toISOString()); assert.equal(result.matchedTouches, 1);
  assert.equal(result.bound, 'lower'); assert.equal(result.complete, true);
  assert.equal(observeQueryCacheLastUse({ version: 1, entries: [{ ...entry, ts: 0 }] }).timestamp, '1970-01-01T00:00:00.000Z');
} else if (mode === 'passive-and-incomplete-inputs') {
  let reads = 0; const accessor = { version: 1, get entries() { reads++; return []; } };
  assert.equal(observeQueryCacheLastUse(accessor).complete, false); assert.equal(reads, 0);
  assert.equal(observeQueryCacheLastUse(new Proxy(cache(), { ownKeys() { reads++; return []; } })).complete, false); assert.equal(reads, 0);
  for (const data of [{ version: 0, entries: [entry] }, { version: 1, entries: [{ ...entry, payloadId: null }] },
    { version: 1, entries: [{ ...entry, ts: -1 }] }, { version: 1, entries: [] }]) assert.equal(observeQueryCacheLastUse(data).complete, false);
  const result = observeQueryCacheLastUse(cache(), { version: 1, entries: [touch(1200), touch(1500, { extra: true })] });
  assert.equal(result.complete, false); assert.equal(result.timestamp, null, 'malformed newer evidence cannot disappear behind an older known touch');
} else if (mode === 'lower-bound-age-refusal') {
  const item = { complete: true, ownerQualified: true, retention: 'derived', lease: { complete: true, protected: false },
    references: { complete: true, retained: false }, lastUse: observeQueryCacheLastUse(cache()) };
  assert.ok(decideStorageLifecycle(item, { now: 100000, maxAgeMs: 1000 }).reasons.includes('unknown-last-use'));
  assert.equal(decideStorageLifecycle(item, { now: 100000 }).eligible, true, 'an age-free decision still depends on its independently qualified owner');
} else {
  const taskRoot = fileURLToPath(new URL('../../../.tmp/tests/lifecycle-query-use/', import.meta.url));
  await fs.mkdir(taskRoot, { recursive: true }); const temporary = await fs.mkdtemp(path.join(taskRoot, 'case-'));
  try {
    const home = path.join(temporary, 'home'), projectRoot = path.join(temporary, 'project'); await fs.mkdir(projectRoot);
    const layout = resolveStorageLayout({ home, env: {} }), cacheRoot = layout.descriptors.cache.path;
    const queryFile = path.join(cacheRoot, 'metrics', 'queryCache.json'); await fs.mkdir(path.dirname(queryFile), { recursive: true });
    await fs.writeFile(queryFile, JSON.stringify(cache()));
    await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home }), async () => {
      const updates = Array.from({ length: 24 }, (_, index) => persistQueryCacheTouch({ cachePath: queryFile, ...touch(1200 + index) }));
      assert.ok((await Promise.all(updates)).every(Boolean));
      const inventory = await inspectStorageInventory({ roots: [{ id: 'cache', category: 'cache', path: cacheRoot }],
        includeFiles: true, maxEntries: 100, maxDurationMs: 5000 });
      assert.equal(inventory.complete, true);
      const control = createStorageInspectionAdmission(5000), scope = { cacheRoot };
      const observe = () => observeLifecycleUse({ inventory, scope, control });
      const sourceBytes = await fs.readFile(queryFile), journalFile = queryFile + '.touches.json', journalBytes = await fs.readFile(journalFile);
      if (mode === 'coalesced-original-journal' || mode === 'read-only-original-inventory') {
        const originalOpenDirectory = fs.opendir, originalWrite = fs.writeFile;
        let traversals = 0, writes = 0;
        fs.opendir = async (...args) => { traversals++; return originalOpenDirectory(...args); };
        fs.writeFile = async (...args) => { writes++; return originalWrite(...args); };
        let result;
        try { result = await observe(); } finally { fs.opendir = originalOpenDirectory; fs.writeFile = originalWrite; }
        assert.equal(traversals, 0); assert.equal(writes, 0);
        assert.equal(result.observations.length, 1); const row = result.observations[0];
        assert.equal(row.lastUse.timestamp, new Date(1223).toISOString()); assert.equal(row.lastUse.bound, 'lower');
        assert.equal(row.deletionAuthority, false); assert.equal(row.categoryOwnerQualified, false);
        assert.match(row.source.sha256, /^[a-f0-9]{64}$/); assert.match(row.journal.sha256, /^[a-f0-9]{64}$/);
        assert.deepEqual(await fs.readFile(queryFile), sourceBytes); assert.deepEqual(await fs.readFile(journalFile), journalBytes);
      } else if (mode === 'changed-input-refusal') {
        await fs.writeFile(queryFile, JSON.stringify({ version: 1, entries: [{ ...entry, ts: 1100 }] }));
        await assert.rejects(observe(), error => control.isStop(error)); assert.equal(control.reason, 'last-use-input-changed');
        assert.deepEqual(await fs.readFile(journalFile), journalBytes);
      } else if (mode === 'writer-refusal') {
        await fs.writeFile(queryFile + '.lock', 'original writer'); const result = await observe();
        assert.equal(result.observations[0].lastUse.reason, 'active-or-unknown-query-writer');
        assert.equal(result.observations[0].lastUse.timestamp, null); assert.deepEqual(await fs.readFile(queryFile), sourceBytes);
      } else if (mode === 'original-close-refusal') {
        const open = fs.open, closeFailure = Object.freeze(new Error('Original query-use descriptor close refused.'));
        let denyClose = true, intercepted = false, closes = 0, session;
        fs.open = async (filename, ...args) => {
          const actual = await open(filename, ...args);
          if (filename === queryFile && !intercepted) {
            intercepted = true; const close = actual.close;
            actual.close = function () { assert.equal(this, actual); closes++; if (denyClose) throw closeFailure; return close.call(actual); };
          }
          return actual;
        };
        try {
          let failure; try { await observe(); } catch (error) { failure = error; }
          assert.ok(failure && errorGraphIncludes(failure, closeFailure)); session = getContainedFileSession(failure); assert.ok(session);
          assert.equal(closes, 1, 'read-only diagnostics cannot retry or erase an original close refusal');
          denyClose = false; await session.releaseAfterClose(); assert.equal(closes, 2);
        } finally { denyClose = false; fs.open = open; if (session) await session.releaseAfterClose(); }
        assert.deepEqual(await fs.readFile(queryFile), sourceBytes); assert.deepEqual(await fs.readFile(journalFile), journalBytes);
      } else {
        await fs.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
        const policy = await planStoragePolicy({ home, repoRoot: projectRoot, category: 'lifecycle', patch: { enabled: true, global: { hardBytes: 0, maxAgeMs: 1 }, scopes: [] } });
        await applyStoragePolicy(policy, { home, repoRoot: projectRoot, category: 'lifecycle', approvedPlanId: policy.planId });
        const plan = await planLifecycleCleanup({ layout, maxEntries: 1000, maxDurationMs: 10000 });
        assert.equal(plan.observation.useObservations.length, 1); assert.equal(plan.observation.useObservations[0].lastUse.timestamp, new Date(1223).toISOString());
        assert.equal(plan.observation.quota.selected.length, 0); assert.equal(plan.applyReady, false);
        assert.ok(plan.observation.quota.blocked.some(row => row.reasons.includes('category-owner-not-qualified')));
        assert.deepEqual(await fs.readFile(queryFile), sourceBytes); assert.deepEqual(await fs.readFile(journalFile), journalBytes);
      }
    });
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
console.log('Lifecycle query-use ' + mode + ' passed');
