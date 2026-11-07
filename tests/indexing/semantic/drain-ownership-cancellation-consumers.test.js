import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, getRepoCacheRoot, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { runSemanticEnrichmentService } from '../../../src/semantic/enrichment.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { openRepositorySemanticControl } from '../../../src/index/semantic/build-frontier.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { wasmModule } from '../../helpers/wasm-fixture.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/drain-ownership-cancellation-consumers/')[1];
assert.ok(['revoked-loaded', 'revoked-supplied', 'pre-abort', 'mid-abort', 'lost-lease'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir('drain-ownership-' + selected), repoRoot = path.join(dir, 'repo');
await fs.mkdir(repoRoot);
const directoryIdentity = await fs.lstat(dir, { bigint: true });
const trusted = path.join(dir, 'trusted.json');
const admittedConfig = { indexing: { semantic: { enabled: true, profile: 'rich',
  enrichment: { bindings: 'off', localFlow: 'deferred', crossFileFlow: 'off' } } } };
await fs.writeFile(trusted, JSON.stringify(admittedConfig));
await fs.writeFile(path.join(repoRoot, 'module.wasm'), wasmModule({ functions: [{ code: [0x20, 0] }], exports: [{ name: 'run', index: 0 }] }));
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub', testConfig: createFastIndexingTestConfig({ threads: 1,
  indexing: { workerPool: { enabled: false }, embeddings: { enabled: false } } }) });
const contains = (error, target, seen = new Set()) => {
  if (error === target) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false; seen.add(error);
  return contains(error.cause, target, seen) || (error.errors || []).some(value => contains(value, target, seen));
};
let primary;
try {
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_CONFIG: trusted }, async () => {
    await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', threads: 1, incremental: true, 'stub-embeddings': true, 'scm-provider': 'none' });
    const configA = loadUserConfig(repoRoot), repoCache = getRepoCacheRoot(repoRoot, configA), builds = path.join(repoCache, 'builds');
    const pointer = path.join(builds, 'current.json'), pointerBefore = await fs.readFile(pointer), buildsBefore = (await fs.readdir(builds)).sort();
    const initial = await openPublishedSemanticStore({ repoRoot, indexDir: getIndexDir(repoRoot, 'code', configA) });
    assert.equal(initial.manifest.completedTasks.length, 0);
    const request = { schemaVersion: 1, repoRoot, generation: initial.manifest.generation,
      limits: { maxTasks: 4, maxBytes: 65536, maxMs: 5000, drainMaxMs: 15000 } };
    const plan = await runSemanticEnrichmentService({ request });
    assert.equal(plan.tasks.length, 1); assert.equal(plan.tasks[0].kind, 'localFlow'); assert.equal(plan.tasks[0].executable, true);
    const taskId = plan.tasks[0].taskId, journalPath = path.join(repoCache, 'semantic-frontier', 'drains', plan.requestId + '.json');
    const inspect = async action => {
      const control = await openRepositorySemanticControl({ root: repoRoot, userConfig: configA });
      assert.equal(control.available, true);
      try { return action(control); } finally { control.close(); }
    };
    const rowBefore = await inspect(control => control.getTask(taskId));
    const cancellation = new AbortController(), reason = Object.freeze(new Error('original drain consumer cancellation'));
    let builderCalls = 0, boundaryObserved = false, originalBuilderSignal;
    if (selected === 'pre-abort') cancellation.abort(reason);
    const build = async (root, options) => {
      builderCalls++; originalBuilderSignal = options.abortSignal;
      assert.ok(originalBuilderSignal instanceof AbortSignal, 'use the original service child signal');
      if (selected.startsWith('revoked-')) {
        await fs.writeFile(trusted, JSON.stringify({ indexing: { semantic: { ...admittedConfig.indexing.semantic, enabled: false } } }));
        assert.equal(loadUserConfig(repoRoot).indexing.semantic.enabled, false, 'actual trusted policy revocation must survive fixture overlays');
        boundaryObserved = true;
      }
      if (selected === 'lost-lease') {
        await inspect(control => {
          const row = control.getTask(taskId); assert.equal(row.state, 'leased'); assert.ok(row.leaseOwner);
          control.release({ taskId, owner: row.leaseOwner, attempt: row.attempt, reason: 'original-consumer-revoked-lease', cancelled: true });
        });
        boundaryObserved = true;
      }
      // Always invoke the actual normal builder; no fabricated grant runtime.
      return buildIndex(root, { ...options, threads: 1, 'scm-provider': 'none', log: line => {
        if (selected === 'mid-abort' && !boundaryObserved && line.includes('auto policy resolved')) {
          boundaryObserved = true; cancellation.abort(reason);
          assert.equal(originalBuilderSignal.aborted, true);
        }
      } });
    };
    let failure;
    try {
      await runSemanticEnrichmentService({ request: { ...request, action: 'drain', taskIds: [taskId] }, build,
        ...(selected === 'revoked-supplied' ? { userConfig: structuredClone(configA) } : {}),
        ...(['pre-abort', 'mid-abort'].includes(selected) ? { signal: cancellation.signal } : {}) });
      assert.fail('revoked, cancelled or unleased work cannot publish');
    } catch (error) { failure = error; }
    observeStorageResource(failure).requireSettled();
    if (selected.startsWith('revoked-')) {
      assert.equal(failure.code, 'ERR_SEMANTIC_ENRICHMENT_STALE'); assert.equal(failure.reason, 'enrichment-authority-changed');
      assert.equal(builderCalls, 1); assert.equal(boundaryObserved, true);
      assert.deepEqual((await fs.readdir(builds)).sort(), buildsBefore, 'revocation rejects before any fresh build-root mutation');
    } else if (selected === 'lost-lease') {
      assert.equal(failure.code, 'ERR_SEMANTIC_LEASE_LOST'); assert.equal(builderCalls, 1); assert.equal(boundaryObserved, true);
    } else {
      assert.equal(failure.name, 'AbortError'); assert.equal(contains(failure, reason), true, 'original cancellation survives normal service/builder boundaries');
      assert.equal(builderCalls, selected === 'pre-abort' ? 0 : 1);
      if (selected === 'mid-abort') assert.equal(boundaryObserved, true);
    }
    assert.deepEqual(await fs.readFile(pointer), pointerBefore, 'the admitted current generation remains unchanged');
    const fresh = await openPublishedSemanticStore({ repoRoot, indexDir: getIndexDir(repoRoot, 'code', configA), generation: initial.manifest.generation });
    assert.deepEqual(fresh.manifest.completedTasks, initial.manifest.completedTasks);
    assert.deepEqual(fresh.manifest.partitions, initial.manifest.partitions, 'all immutable source/derived partition authority remains unchanged');
    await inspect(control => {
      const row = control.getTask(taskId); assert.equal(control.getOutput(taskId), null);
      if (selected === 'pre-abort') assert.deepEqual(row, rowBefore, 'pre-abort consumes no task or lease attempt');
      else { assert.ok(row); assert.notEqual(row.state, 'leased'); assert.notEqual(row.state, 'completed'); assert.equal(row.leaseOwner, null);
        if (selected === 'lost-lease') assert.equal(row.state, 'cancelled'); }
    });
    if (selected === 'pre-abort') await assert.rejects(fs.stat(journalPath), { code: 'ENOENT' });
    else {
      const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'));
      assert.equal(journal.status, 'failed'); assert.equal(journal.failure, failure.code || failure.message);
      assert.deepEqual(journal.sourceGeneration, initial.manifest.generation); assert.deepEqual(journal.taskIds, [taskId]);
      assert.equal(journal.requestId, plan.requestId);
      if (selected.startsWith('revoked-')) assert.equal(journal.newBuildRoot, null);
    }
    await fs.writeFile(trusted, JSON.stringify(admittedConfig));
    console.log(JSON.stringify({ scenario: selected, originalBuilderCalls: builderCalls, actualBoundaryObserved: boundaryObserved,
      pointer: 'unchanged', output: 'not-acknowledged', lease: 'settled', journal: selected === 'pre-abort' ? 'not-created' : 'failed-same-owner' }));
  });
} catch (error) { primary = error; throw error; }
finally {
  try {
    if (primary) observeStorageResource(primary, { phase: 'drain-consumer-cleanup' }).requireSettled();
    const after = await fs.lstat(dir, { bigint: true });
    assert.ok(after.isDirectory() && !after.isSymbolicLink() && after.dev === directoryIdentity.dev && after.ino === directoryIdentity.ino);
    assert.ok(path.relative(process.cwd(), dir).startsWith('.tmp' + path.sep));
    await fs.rm(dir, { recursive: true, force: false });
  } catch (cleanup) { if (primary) throw addStorageFailureContext(primary, {}, cleanup, { secondaryPresent: true }); throw cleanup; }
}
