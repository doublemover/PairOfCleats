#!/usr/bin/env node
import assert from 'node:assert/strict';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { registerHooks } from 'node:module';
import { EventEmitter } from 'node:events';
import { assertSubprocessTerminationReceipt } from '../../../src/shared/subprocess/termination-receipt.js';
import { trackedSubprocesses } from '../../../src/shared/subprocess/tracking-runtime.js';
import { releaseCacheWriterOwnership } from '../../../src/index/build/cache-writer-drain.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const state = { error: null, launches: [], confirmed: false, failures: 0, snapshots: 0 };
const key = Symbol.for('poc.test.subprocess-cache-barrier'); globalThis[key] = state;
const access = 'const state = globalThis[Symbol.for("poc.test.subprocess-cache-barrier")];';
const hooks = registerHooks({ load(url, context, next) {
  const source = url.endsWith('/src/shared/subprocess/runner.js')
    ? access + 'export const spawnSubprocess = async (command,args,options) => { state.launches.push(options); throw state.error; };'
    : url.endsWith('/src/shared/subprocess/tracking-terminate.js')
      ? access + `export const terminateTrackedSubprocesses = async options => ({
        ...options, tracked: 1, failures: state.failures,
        killAudit: [{ ownershipId: options.ownershipPrefix + ':child', terminated: state.confirmed,
          closeObserved: state.confirmed }] });`
      : url.endsWith('/src/lang/tree-sitter.js') ? 'export const shutdownTreeSitterWorkerPool = async () => {};'
        : url.endsWith('/src/lang/python.js') ? 'export const shutdownPythonAstPool = async () => {};'
          : url.endsWith('/src/shared/progress-runtime.js') ? 'export const log = () => {};'
            : url.endsWith('/src/integrations/tooling/providers/lsp/session-pool.js')
              ? 'export const drainLspSessionPool = async () => ({rejected:0,timedOut:false});' : null;
  return source == null ? next(url, context) : { format: 'module', source, shortCircuit: true };
} });
try {
  const { executeTreeSitterSchedulerTasks } = await import('../../../src/index/build/tree-sitter-scheduler/runner/task-execution.js');
  const { teardownRuntime } = await import('../../../src/integrations/core/build-index/runtime.js');
  const runtime = { root: process.cwd(), log: () => {}, subprocessOwnership: { stage1FilePrefix: 'stage1:fixture-run:' } };
  const execute = () => executeTreeSitterSchedulerTasks({
    plannedTasks: [{ taskId: 'grammar-1', grammarKeys: ['native:javascript'], timeoutMs: 1 }],
    execConcurrency: 1, effectiveAbortSignal: new AbortController().signal,
    runtime, outDir: process.cwd(), runtimeEnv: {}, schedulerExecPath: 'inert-subprocess.js',
    crashTracker: { recordFailure: async () => {}, summarize: () => ({}) }, planResult: { plan: {}, groups: [] },
    onWritePlannerFailureSnapshot: async () => { state.snapshots++; }
  });
  for (const termination of [
    { closeObserved: false, treeCleanupSettled: true, treeCleanupFailed: false },
    { closeObserved: true, treeCleanupSettled: true, treeCleanupFailed: true },
    null
  ]) {
    state.error = Object.assign(new Error('original parser timeout'), { code: 'SUBPROCESS_TIMEOUT', result: { termination } });
    await assert.rejects(execute(), error => errorGraphIncludes(error, state.error) && error.cacheOwnershipPending === true);
    assert.equal(state.snapshots, 0, 'unknown lifetime cannot be converted to completed parser degradation');
    assert.match(state.launches.at(-1).ownershipId, /^stage1:fixture-run::tree-sitter:grammar-1$/);
  }
  state.error = Object.assign(new Error('confirmed timeout'), { code: 'SUBPROCESS_TIMEOUT', result: {
    termination: { closeObserved: true, treeCleanupSettled: true, treeCleanupFailed: false }
  } });
  await execute();
  assert.equal(state.snapshots, 1, 'confirmed cleanup retains meaningful parser-degradation behavior');

  let invalidations = 0, releases = 0;
  const release = drained => releaseCacheWriterOwnership({ drained,
    lease: { invalidate: () => { invalidations++; } }, release: () => { releases++; } });
  for (const failures of [0, 1]) {
    state.failures = failures; state.confirmed = false;
    await assert.rejects(teardownRuntime(runtime), error => error.cacheOwnershipPending === true);
    await assert.rejects(release(false), /ownership retained/i);
  }
  assert.equal(invalidations, 0); assert.equal(releases, 0);
  state.failures = 0; state.confirmed = true;
  await teardownRuntime(runtime); await teardownRuntime(runtime);
  await release(true);
  assert.equal(invalidations, 1); assert.equal(releases, 1);
  assert.throws(() => assertSubprocessTerminationReceipt({ tracked: 1, failures: 0, killAudit: [] }), /unconfirmed/);
  for (const closeObserved of [undefined, false]) {
    assert.throws(() => assertSubprocessTerminationReceipt({ tracked: 1, failures: 0,
      killAudit: [{ terminated: true, closeObserved }] }), /unconfirmed/,
    'a fulfilled termination claim requires independent exact-child close evidence');
  }
  assert.throws(() => assertSubprocessTerminationReceipt({ tracked: 1, failures: 0,
    ownershipPrefix: 'foreign:', killAudit: [{ terminated: true, closeObserved: true, ownershipId: 'foreign:child' }] },
  { ownershipPrefix: 'stage1:fixture-run:' }), /unconfirmed/);
  const entryKey = Symbol('in-flight-cleanup');
  trackedSubprocesses.set(entryKey, { child: new EventEmitter(), terminating: true, ownershipId: 'stage1:fixture-run:pending' });
  try {
    assert.throws(() => assertSubprocessTerminationReceipt({ tracked: 0, failures: 0, killAudit: [],
      ownershipPrefix: 'stage1:fixture-run:' }, { ownershipPrefix: 'stage1:fixture-run:' }),
    error => error.cacheOwnershipPending && error.remaining === 1,
    'another in-flight cleanup cannot turn an empty kill attempt into a release receipt');
  } finally { trackedSubprocesses.delete(entryKey); }
} finally { hooks.deregister(); delete globalThis[key]; }
console.log('subprocess cleanup preserves the cache-writer barrier');
