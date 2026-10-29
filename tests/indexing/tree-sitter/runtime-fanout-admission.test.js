import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/tree-sitter/runtime-fanout-admission/')[1];
const approved = selected?.startsWith('cpu-') ? Number(selected.slice(4)) : 8;
const { dir } = await prepareIsolatedTestCacheDir('runtime-fanout-' + selected), root = path.join(dir, 'repo'); await fs.mkdir(root);
const key = Symbol.for('poc.runtime-fanout'), state = { active: 0, peak: 0, tasks: [] }; globalThis[key] = state;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/runner/task-scheduler.js') && specifier === 'node:os') return { url: 'fanout:os', shortCircuit: true };
    if (context.parentURL?.endsWith('/runner/task-scheduler.js') && specifier.endsWith('/effective-memory.js') && selected === 'memory') return { url: 'fanout:memory', shortCircuit: true };
    if (context.parentURL?.endsWith('/runner/task-execution.js') && specifier.endsWith('/subprocess/runner.js')) return { url: 'fanout:spawn', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'fanout:os') return { format: 'module', shortCircuit: true, source: 'import os from "node:os"; export default {...os, availableParallelism:()=>'+(selected === 'affinity' ? 2 : 16)+'};' };
    if (url === 'fanout:memory') return { format: 'module', shortCircuit: true, source: 'export const readEffectiveMemory=()=>({freeBytes:268435456});' };
    if (url === 'fanout:spawn') return { format: 'module', shortCircuit: true, source: `
      export async function spawnSubprocess(command,args,options) { const state=globalThis[Symbol.for('poc.runtime-fanout')];
        state.active++;state.peak=Math.max(state.peak,state.active);state.tasks.push(args[args.indexOf('--grammarKeys')+1]);
        try { await new Promise(resolve=>setImmediate(resolve));return {exitCode:0}; } finally {state.active--;} }
    ` };
    return next(url, context);
  }
});
let runtime;
try {
  applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', testConfig: createFastIndexingTestConfig({ threads: approved,
    indexing: { treeSitter: { enabled: true }, workerPool: { enabled: false, maxWorkers: 16, heapTargetMb: 128,
      ...(selected === 'fd' ? { fdPressure: { maxConcurrency: 1 } } : {}) }, scheduler: { enabled: selected !== 'scheduler-off' } } }) });
  const { createBuildRuntime } = await import('../../../src/index/build/runtime/runtime.js');
  const { prepareTreeSitterSchedulerTasks } = await import('../../../src/index/build/tree-sitter-scheduler/runner/task-preparation.js');
  const { executeTreeSitterSchedulerTasks } = await import('../../../src/index/build/tree-sitter-scheduler/runner/task-execution.js');
  runtime = await createBuildRuntime({ root, argv: { mode: 'code', stage: 'stage1', threads: approved }, rawArgv: [] });
  assert.equal(runtime.cpuConcurrency, approved, 'actual end-user runtime normalization supplies the approved CPU envelope');
  assert.equal(runtime.workerPool, null, 'inert fanout matrix starts no physical parser workers');
  const keys = Array.from({ length: 16 }, (_, index) => 'grammar-' + index), groups = keys.map(grammarKey => ({ grammarKey, jobs: [] }));
  const planResult = { groups, plan: { executionOrder: keys, groupMeta: Object.fromEntries(keys.map(key => [key, { baseGrammarKey: key }])) } };
  const prepared = prepareTreeSitterSchedulerTasks({ runtime, planResult, schedulerConfig: runtime.languageOptions.treeSitter.scheduler });
  assert.ok(prepared.execConcurrency <= approved); assert.ok(prepared.execConcurrency <= prepared.executionBudget.effective);
  if (['fd', 'memory'].includes(selected)) assert.equal(prepared.executionBudget.limitingReason, selected === 'fd' ? 'fd-budget' : 'retained-memory-budget');
  if (selected === 'affinity') assert.equal(prepared.execConcurrency, 1);
  const result = await executeTreeSitterSchedulerTasks({ ...prepared, runtime, outDir: dir, runtimeEnv: {}, schedulerExecPath: 'inert-parser',
    effectiveAbortSignal: new AbortController().signal, planResult, crashTracker: { recordFailure() { assert.fail('healthy inert task failed'); } } });
  assert.equal(state.active, 0); assert.ok(state.peak > 0 && state.peak <= prepared.execConcurrency);
  assert.equal(result.peakActiveChildren, state.peak); assert.deepEqual(state.tasks.slice().sort(), keys.slice().sort());
  for (const sparse of [[], keys.slice(0, 1)]) {
    const result = prepareTreeSitterSchedulerTasks({ runtime, planResult: { groups: groups.slice(0, sparse.length), plan: { executionOrder: sparse, grammarKeys: sparse, jobs: sparse.length, groupMeta: planResult.plan.groupMeta } } });
    assert.equal(result.execConcurrency, 1); assert.equal(result.plannedTasks.length, sparse.length);
  }
  console.log(JSON.stringify({ basis: 'real runtime normalization and task admission; inert launch receipt', selected,
    configuredCpu: approved, effectiveFanout: prepared.execConcurrency, observed: state.peak, budget: prepared.executionBudget }));
} finally {
  if (runtime) { const { teardownRuntime } = await import('../../../src/integrations/core/build-index/runtime.js'); await teardownRuntime(runtime); }
  hooks.deregister(); delete globalThis[key];
}
