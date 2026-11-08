import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

// Install the termination fault before test-env loads the tracking owner. The
// child, scheduler, runStage, lock and closeout registry remain real.
if (!process.argv.includes('--isolated-stage-closeout')) {
  const { runNode } = await import('../../helpers/run-node.js');
  const preload = `--import ${new URL('../../helpers/test-env.js', import.meta.url).href}`;
  const env = { ...process.env, NODE_OPTIONS: String(process.env.NODE_OPTIONS || '').replaceAll(preload, '').trim() };
  const result = runNode([fileURLToPath(import.meta.url), '--isolated-stage-closeout'],
    'actual stage delayed-child closeout', process.cwd(), env, { stdio: 'pipe', timeoutMs: 20000, allowFailure: true });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status === 0) {
    assert.match(result.stderr, /Subprocess termination remains failed or unconfirmed/u);
    assert.match(result.stderr, /lock\.release failed/u, 'the controlled pending-child closeout explicitly reports withheld lock release');
    assert.doesNotMatch(result.stderr, /(?:Deprecation|Experimental|Syntax)Warning/u);
  }
  process.exit(result.status ?? 1);
}

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1) || 'timeout';
assert.ok(['timeout', 'cancelled'].includes(selected));
const state = { runtime: null, script: null, execute: null, withheld: 0, holdTermination: true, original: null };
globalThis.__stageCloseoutDelayedChild = state;
const actualKill = new URL('../../../src/shared/kill-tree.js', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('/kill-tree.js') && /\/subprocess\/(?:runner-async|tracking-terminate)\.js$/u.test(context.parentURL || '')) {
      return { url: 'stage-closeout:termination-fault', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'stage-closeout:termination-fault') return { format: 'module', shortCircuit: true, source: `
      import * as actual from ${JSON.stringify(actualKill)};
      export * from ${JSON.stringify(actualKill)};
      export const killChildProcessTree = async (child, options) => {
        const state = globalThis.__stageCloseoutDelayedChild;
        if(state.holdTermination && child.spawnargs?.includes(state.script)) {
          state.withheld++; return {terminated:false,forced:false};
        }
        return actual.killChildProcessTree(child,options);
      };` };
    if (url.endsWith('/src/index/build/indexer.js')) return { format: 'module', shortCircuit: true,
      source: `export * from ${JSON.stringify(url + '?actual')};
        export const buildIndexForMode = input => globalThis.__stageCloseoutDelayedChild.execute(input);` };
    return next(url, context);
  }
});
const { applyTestEnv } = await import('../../helpers/test-env.js');
const { prepareIsolatedTestCacheDir } = await import('../../helpers/test-cache.js');
const { errorGraphIncludes } = await import('../../helpers/error-graph.js');
const { runStage } = await import('../../../src/integrations/core/build-index/stages.js');
const { teardownRuntime } = await import('../../../src/integrations/core/build-index/runtime.js');
const { executeTreeSitterSchedulerTasks } = await import('../../../src/index/build/tree-sitter-scheduler/runner/task-execution.js');
const { acquireIndexLock } = await import('../../../src/index/build/lock.js');
const { releaseCacheWriterOwnership } = await import('../../../src/index/build/cache-writer-drain.js');
const { trackedSubprocesses } = await import('../../../src/shared/subprocess/tracking.js');
const { killChildProcessTree } = await import('../../../src/shared/kill-tree.js');
const { dir } = await prepareIsolatedTestCacheDir('stage-closeout-delayed-' + selected);
const repo = path.join(dir, 'repo'), releasePath = path.join(dir, 'release-child');
await fs.mkdir(repo);
await fs.writeFile(path.join(repo, 'fixture.js'), 'export const fixture = 1;\n');
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({ quality: 'fast', threads: 1,
  indexing: { scm: { provider: 'none' }, embeddings: { enabled: false, mode: 'off' },
    treeSitter: { enabled: false }, stage1: { watchdog: { cleanupTimeoutMs: 1000 } },
    platformPresets: { startupCalibration: false } } }));
state.script = path.join(dir, 'delayed-child.cjs');
await fs.writeFile(state.script, `const fs=require('node:fs');
  process.stdout.write('fixture-ready\\n');
  setInterval(()=>{if(fs.existsSync(process.env.POC_CLOSEOUT_RELEASE)){process.exit(0);}
    process.stdout.write('fixture-heartbeat\\n');},10);`);
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), extraEnv: {
  PAIROFCLEATS_HOME: path.join(dir, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null,
  POC_CLOSEOUT_RELEASE: releasePath
} });
const controller = new AbortController(), logs = [];
state.execute = async ({ runtime }) => {
  state.runtime = runtime;
  try {
    await executeTreeSitterSchedulerTasks({ plannedTasks: [{ taskId: 'actual-delayed-child',
      grammarKeys: ['native:javascript'], timeoutMs: selected === 'timeout' ? 1000 : 5000 }],
    execConcurrency: 1, effectiveAbortSignal: controller.signal, runtime, outDir: runtime.buildRoot,
    runtimeEnv: env, schedulerExecPath: state.script, crashTracker: {
      recordFailure: () => assert.fail('pending child lifetime must not become parser degradation'), summarize: () => ({})
    }, planResult: { plan: {}, groups: [] },
    log: line => {
      logs.push(line);
      if (selected === 'cancelled' && line.includes('fixture-ready')) controller.abort();
    }, onWritePlannerFailureSnapshot: () => assert.fail('pending child cannot publish a degradation snapshot') });
    assert.fail('The controlled child must fail before close.');
  } catch (error) { state.original = error; throw error; }
};
let child = null, closed = null, oldLock = null, primary = null;
try {
  let failure;
  try {
    await runStage('stage1', { root: repo, argv: { stage: 'stage1', threads: 1, verbose: true }, rawArgv: [],
      modes: ['code'], options: { emitOutput: false }, abortSignal: controller.signal,
      log: line => logs.push(line), recordIndexMetric() {}, explicitStage: 'stage1', twoStageEnabled: false });
  } catch (error) { failure = error; }
  assert.ok(failure); assert.ok(state.runtime, 'the actual stage reaches its scoped scheduler child');
  assert.ok(errorGraphIncludes(failure, state.original), 'stage failure retains the exact scheduler timeout/cancellation');
  assert.equal(failure.cacheOwnershipPending, true);
  assert.equal(state.original.code, selected === 'timeout' ? 'SUBPROCESS_TIMEOUT' : 'ABORT_ERR');
  assert.ok(state.withheld >= 2, 'both original termination and runtime scoped cleanup observe the controlled failed attempt');
  const entry = [...trackedSubprocesses.values()].find(item => item.child.spawnargs?.includes(state.script));
  assert.ok(entry, 'the original live child stays tracked');
  child = entry.child; closed = entry.closed;
  assert.ok(entry.ownershipId.startsWith(state.runtime.subprocessOwnership.stage1FilePrefix));
  assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
  const [heartbeat] = await once(child.stdout, 'data');
  assert.ok(String(heartbeat).includes('fixture-heartbeat'), 'the actual child remains usable behind the held cache-writer lock');
  const lease = state.runtime.cacheWriterLease;
  oldLock = lease.assertOwned(state.runtime.repoCacheRoot);
  assert.equal(await acquireIndexLock({ repoCacheRoot: state.runtime.repoCacheRoot }), null);
  assert.equal(state.original.cacheOwnershipReleased(), false);
  await assert.rejects(releaseCacheWriterOwnership({ lease, release: () => oldLock.release(),
    operationError: state.original, drained: false }));
  lease.assertOwned();
  await fs.writeFile(releasePath, 'release'); await closed;
  assert.equal(state.original.cacheOwnershipReleased(), true, 'only exact delayed child close reconciles its original observer');
  lease.assertOwned();
  assert.equal(await acquireIndexLock({ repoCacheRoot: state.runtime.repoCacheRoot }), null,
    'late completion alone cannot invalidate or release the old lease');
  await teardownRuntime(state.runtime);
  await releaseCacheWriterOwnership({ lease, release: () => oldLock.release(), operationError: state.original, drained: true });
  const nextLock = await acquireIndexLock({ repoCacheRoot: state.runtime.repoCacheRoot, requireSettlement: true });
  assert.ok(nextLock, 'new work enters only after explicit original-owner reconciliation');
  try {
    await teardownRuntime(state.runtime);
    assert.equal(await acquireIndexLock({ repoCacheRoot: state.runtime.repoCacheRoot }), null,
      'repeated old cleanup cannot release a newer run lock');
    assert.throws(() => lease.assertOwned());
  } finally { await nextLock.release(); }
  assert.ok(logs.some(line => /runtime\.teardown.*start/u.test(line)));
} catch (error) { primary = error; }
finally {
  const failures = primary ? [primary] : [];
  let stopped = !state.runtime;
  state.holdTermination = false;
  try {
    if (!child) {
      const entry = [...trackedSubprocesses.values()].find(item => item.child.spawnargs?.includes(state.script));
      child = entry?.child; closed = entry?.closed;
    }
    if (child && child.exitCode === null && child.signalCode === null) {
      const close = once(child, 'close'); await killChildProcessTree(child, { killTree: true, detached: false, graceMs: 0 }); await close;
    }
    await closed;
    if (state.runtime) {
      await teardownRuntime(state.runtime); stopped = true;
      const lease = state.runtime.cacheWriterLease;
      try { oldLock ||= lease.assertOwned(); } catch {}
      if (oldLock) { lease.invalidate(); await oldLock.release(); }
    }
  } catch (error) { failures.push(error); }
  hooks.deregister(); delete globalThis.__stageCloseoutDelayedChild;
  if (stopped) await fs.rm(dir, { recursive: true, force: true });
  if (failures.length) throw failures.length === 1 ? failures[0]
    : new AggregateError(failures, 'Stage-closeout proof or original resource reconciliation failed.', { cause: failures[0] });
}
console.log(`Actual Stage1 closeout retains exact delayed child and cache-writer ownership: ${selected}.`);
