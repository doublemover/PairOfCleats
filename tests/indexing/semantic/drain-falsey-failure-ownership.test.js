import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import NativeDatabase from 'better-sqlite3';
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

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/drain-falsey-failure-ownership/')[1];
const values = new Map([['null', null], ['undefined', undefined], ['false', false], ['zero', 0], ['empty', ''], ['nan', NaN]]);
values.set('unicode', Object.freeze(new Error('x'.repeat(4095) + '😀')));
const [boundary, label] = (selected || '').split('-');
assert.ok(['builder', 'release'].includes(boundary) && values.has(label));
const original = values.get(label);
const builderFailure = boundary === 'builder' ? original : Object.freeze(Object.assign(new Error('original builder failure'), { code: 'ERR_ORIGINAL_BUILDER' }));
const { dir } = await prepareIsolatedTestCacheDir('semantic-falsey-' + selected);
const directoryIdentity = await fs.lstat(dir, { bigint: true });
const repoRoot = path.join(dir, 'repo'); await fs.mkdir(repoRoot);
const trusted = path.join(dir, 'trusted.json');
await fs.writeFile(trusted, JSON.stringify({ indexing: { semantic: { enabled: true, profile: 'rich',
  enrichment: { bindings: 'off', localFlow: 'deferred', crossFileFlow: 'off' } } } }));
await fs.writeFile(path.join(repoRoot, 'module.wasm'), wasmModule({ functions: [{ code: [0x20, 0] }], exports: [{ name: 'run', index: 0 }] }));
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub', testConfig: createFastIndexingTestConfig({ threads: 1,
  indexing: { workerPool: { enabled: false }, embeddings: { enabled: false } } }) });
const contains = (value, target, seen = new Set()) => {
  if (Object.is(value, target)) return true;
  if (!value || !['object', 'function'].includes(typeof value) || seen.has(value)) return false;
  seen.add(value);
  return Object.hasOwn(value, 'cause') && contains(value.cause, target, seen)
    || Array.isArray(value.errors) && value.errors.some(error => contains(error, target, seen));
};
const nativeHandles = [], releaseCalls = [];
function ObservedDatabase(...args) {
  const db = new NativeDatabase(...args), prepare = db.prepare;
  nativeHandles.push(db);
  db.prepare = function(sql) {
    const statement = Reflect.apply(prepare, db, [sql]);
    if (boundary === 'release' && sql === 'UPDATE tasks SET state=?,leaseOwner=NULL,leaseUntil=NULL,lastError=? WHERE taskId=?') {
      statement.run = function(...bindings) { releaseCalls.push(bindings); throw original; };
    }
    return statement;
  };
  return db;
}
let primary, failed = false;
try {
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_CONFIG: trusted }, async () => {
    await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', threads: 1, incremental: true, 'stub-embeddings': true, 'scm-provider': 'none' });
    const config = loadUserConfig(repoRoot), cacheRoot = getRepoCacheRoot(repoRoot, config), builds = path.join(cacheRoot, 'builds');
    const pointer = path.join(builds, 'current.json'), pointerBefore = await fs.readFile(pointer), buildsBefore = (await fs.readdir(builds)).sort();
    const initial = await openPublishedSemanticStore({ repoRoot, indexDir: getIndexDir(repoRoot, 'code', config) });
    const request = { schemaVersion: 1, repoRoot, generation: initial.manifest.generation,
      limits: { maxTasks: 4, maxBytes: 65536, maxMs: 5000, drainMaxMs: 15000 } };
    const plan = await runSemanticEnrichmentService({ request });
    assert.equal(plan.tasks.length, 1); assert.equal(plan.tasks[0].kind, 'localFlow'); assert.equal(plan.tasks[0].executable, true);
    const taskId = plan.tasks[0].taskId;
    let dispatches = 0, caught = false, failure;
    try {
      await runSemanticEnrichmentService({ request: { ...request, action: 'drain', taskIds: [taskId] }, Database: ObservedDatabase,
        build: async (_root, options) => {
          dispatches++; assert.ok(options.abortSignal instanceof AbortSignal); assert.equal(options.abortSignal.aborted, false);
          throw builderFailure;
        } });
    } catch (error) { failure = error; caught = true; }
    assert.equal(caught, true); assert.equal(dispatches, 1);
    observeStorageResource(failure).requireSettled();
    assert.ok(nativeHandles.length > 0); assert.ok(nativeHandles.every(db => !db.open), 'every original native control handle closes');
    if (boundary === 'builder') assert.ok(Object.is(failure, original), 'journal projection preserves the exact primitive failure');
    else {
      assert.equal(releaseCalls.length, 1); assert.ok(contains(failure, builderFailure)); assert.ok(contains(failure, original));
    }
    assert.deepEqual(await fs.readFile(pointer), pointerBefore); assert.deepEqual((await fs.readdir(builds)).sort(), buildsBefore);
    const journal = JSON.parse(await fs.readFile(path.join(cacheRoot, 'semantic-frontier/drains', plan.requestId + '.json'), 'utf8'));
    assert.equal(journal.status, 'failed');
    assert.equal(journal.failure, boundary === 'builder'
      ? label === 'unicode' ? 'x'.repeat(4095) : String(original) || 'Semantic enrichment failed.'
      : 'ERR_ORIGINAL_BUILDER');
    if (label === 'unicode') assert.ok(original.message.endsWith('😀'), 'the full frozen original remains available beyond the bounded journal field');
    assert.deepEqual(journal.taskIds, [taskId]); assert.deepEqual(journal.sourceGeneration, initial.manifest.generation);
    const control = await openRepositorySemanticControl({ root: repoRoot, userConfig: config });
    try {
      const row = control.getTask(taskId); assert.equal(control.getOutput(taskId), null);
      if (boundary === 'release') {
        assert.equal(row.state, 'leased', 'failed native transaction does not fabricate successful lease release');
        assert.equal(row.taskId, releaseCalls[0][2]);
        control.release({ taskId, owner: row.leaseOwner, attempt: row.attempt, reason: 'explicit-original-failed-release-recovery', cancelled: true });
      } else { assert.notEqual(row.state, 'leased'); assert.equal(row.leaseOwner, null); }
    } finally { control.close(); }
    assert.ok(!(await fs.readdir(path.join(cacheRoot, 'semantic-frontier'))).some(name => name.startsWith('.client-')));
    console.log(JSON.stringify({ selected, originalFailurePreserved: true, dispatches, nativeHandles: nativeHandles.length,
      failedReleaseTransactions: releaseCalls.length, pointer: 'unchanged', journal: 'same-original-request-failed' }));
  });
} catch (error) { primary = error; failed = true; }
finally {
  try {
    if (failed) observeStorageResource(primary, { phase: 'falsey-drain-fixture-cleanup' }).requireSettled();
    assert.ok(nativeHandles.every(db => !db.open));
    const current = await fs.lstat(dir, { bigint: true });
    assert.ok(current.isDirectory() && !current.isSymbolicLink() && current.dev === directoryIdentity.dev && current.ino === directoryIdentity.ino);
    assert.ok(path.relative(process.cwd(), dir).startsWith('.tmp' + path.sep));
    await fs.rm(dir, { recursive: true, force: false });
  } catch (cleanup) { primary = failed ? addStorageFailureContext(primary, {}, cleanup, { secondaryPresent: true }) : cleanup; failed = true; }
}
if (failed) throw primary;
