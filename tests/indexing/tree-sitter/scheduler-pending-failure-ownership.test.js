import assert from 'node:assert/strict';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { releaseCacheWriterOwnership } from '../../../src/index/build/cache-writer-drain.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('tree-sitter-pending-failure');
const key = Symbol.for('test.tree-sitter-original-subprocess-owner');
let failure, launches = 0, snapshots = 0, records = 0;
globalThis[key] = async (_command, _args, options) => {
  launches++;
  assert.equal(options.ownershipId, 'build-A:stage1:tree-sitter:task-A');
  options.onStderr?.(Buffer.from('unterminated diagnostic'));
  throw failure;
};
const hook = registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    return resolved.url.endsWith('/shared/subprocess/runner.js') ? { ...resolved, url: resolved.url + '?scheduler-ownership-fixture' } : resolved;
  },
  load(url, context, next) {
    if (url.endsWith('/shared/subprocess/runner.js?scheduler-ownership-fixture')) return { format: 'module', shortCircuit: true,
      source: `export const spawnSubprocess = (...args) => globalThis[Symbol.for('test.tree-sitter-original-subprocess-owner')](...args);` };
    return next(url, context);
  }
});
try {
  const { executeTreeSitterSchedulerTasks } = await import('../../../src/index/build/tree-sitter-scheduler/runner/task-execution.js');
  const run = (log = null) => executeTreeSitterSchedulerTasks({
    plannedTasks: [{ taskId: 'task-A', grammarKeys: ['native:javascript'], timeoutMs: 10, planPath: path.join(dir, 'unused-plan.json') }],
    execConcurrency: 1, effectiveAbortSignal: new AbortController().signal,
    runtime: { argv: { verbose: Boolean(log) }, subprocessOwnership: { stage1FilePrefix: 'build-A:stage1' } },
    outDir: dir, runtimeEnv: {}, schedulerExecPath: 'unused-executor.js', log,
    crashTracker: { async recordFailure() { records++; }, summarize() { return {}; } }, planResult: { plan: {}, groups: [] },
    async onWritePlannerFailureSnapshot() { snapshots++; }
  });
  const contains = (root, expected) => {
    const queue = [root], seen = new Set();
    while (queue.length) {
      const value = queue.pop(); if (value === expected) return true;
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value); queue.push(value.cause, ...(value.errors || []));
    }
    return false;
  };
  const timeout = termination => Object.assign(new Error('controlled timeout'), { code: 'SUBPROCESS_TIMEOUT',
    result: { exitCode: null, stdout: '', stderr: '', termination } });
  const confirmed = { closeObserved: true, treeCleanupSettled: true, treeCleanupFailed: false };
  for (const receipt of [undefined, { ...confirmed, closeObserved: false }, { ...confirmed, treeCleanupSettled: false },
    { ...confirmed, treeCleanupFailed: true }]) {
    failure = Object.freeze(timeout(receipt)); launches = snapshots = records = 0;
    let rejected; try { await run(); } catch (error) { rejected = error; }
    assert.ok(contains(rejected, failure), 'frozen original timeout survives pending classification');
    assert.equal(rejected.cacheOwnershipPending, true);
    assert.equal(launches, 1); assert.equal(records, 0); assert.equal(snapshots, 0);
    const calls = [];
    await assert.rejects(releaseCacheWriterOwnership({ operationError: rejected, drained: true,
      lease: { assertOwned() { calls.push('assert'); }, invalidate() { calls.push('invalidate'); } },
      release() { calls.push('release'); } }));
    assert.deepEqual(calls, [], 'unconfirmed child lifetime cannot release the actual writer owner');
  }
  let closed = false;
  failure = Object.freeze(Object.assign(timeout(confirmed), { cacheOwnershipPending: true, cacheOwnershipReleased: () => closed }));
  let pending; try { await run(); } catch (error) { pending = error; }
  assert.ok(contains(pending, failure)); assert.equal(pending.cacheOwnershipReleased(), false);
  const calls = [], owner = { operationError: pending, drained: true,
    lease: { assertOwned() { calls.push('assert'); }, invalidate() { calls.push('invalidate'); } },
    release() { calls.push('release'); return 'released'; } };
  await assert.rejects(releaseCacheWriterOwnership(owner)); assert.deepEqual(calls, []);
  closed = true;
  assert.equal(await releaseCacheWriterOwnership(owner), 'released'); assert.deepEqual(calls, ['assert', 'invalidate', 'release']);
  const inspection = Object.freeze(new Error('controlled termination inspection'));
  failure = timeout(null); Object.defineProperty(failure.result, 'termination', { get() { throw inspection; } }); Object.freeze(failure);
  await assert.rejects(run(), error => error.cacheOwnershipPending === true && contains(error, failure) && contains(error, inspection));
  const flushError = Object.freeze(new Error('controlled diagnostic flush failure'));
  failure = Object.freeze(Object.assign(timeout(confirmed), { cacheOwnershipPending: true }));
  await assert.rejects(run(message => { if (message.includes('unterminated diagnostic')) throw flushError; }),
    error => error.cacheOwnershipPending === true && contains(error, failure) && contains(error, flushError),
    'a secondary log flush error cannot erase the pending original child owner');
  failure = Object.freeze(timeout(confirmed)); launches = snapshots = records = 0;
  await run(); assert.equal(launches, 1); assert.equal(records, 1); assert.equal(snapshots, 1,
    'confirmed original child cleanup still permits ordinary timeout degradation');
} finally { hook.deregister(); delete globalThis[key]; }
console.log('scheduler original subprocess failures preserve the writer-release barrier');
