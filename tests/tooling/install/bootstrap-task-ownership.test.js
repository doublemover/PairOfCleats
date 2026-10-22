#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveBootstrapBudget, runBootstrapTasks } from '../../../tools/setup/bootstrap-tasks.js';
import { createNativeBuildTasks } from '../../../tools/setup/native-build-plan.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const MIB = 1024 * 1024;
const budget = resolveBootstrapBudget({ env: {}, cpu: { cpuCount: 8 }, memory: { freeBytes: 8 * 1024 * MIB } });
assert.equal(budget.jobs, 4);
assert.equal(budget.compilerJobs, 2);
const serial = resolveBootstrapBudget({ env: { npm_config_jobs: '1' }, cpu: { cpuCount: 32 },
  memory: { freeBytes: 8 * 1024 * MIB } });
assert.equal(serial.jobs, 1);
assert.equal(serial.cpuCount, 1, 'jobs=1 also bounds nested compiler workers');
assert.throws(() => resolveBootstrapBudget({ env: { npm_config_jobs: '0' } }), /positive integer/);
assert.throws(() => resolveBootstrapBudget({ env: {}, cpu: { cpuCount: 8 },
  memory: { freeBytes: MIB } }), /Insufficient/);

const events = [], adapters = new Map(['tree-sitter', 'grammar-a', 'grammar-b'].map(packageName => [packageName, { packageName }]));
let running = 0, maximum = 0, localRunning = 0;
let releaseLocal;
const bothStarted = new Promise(resolve => { releaseLocal = resolve; });
const tasks = createNativeBuildTasks({
  packages: ['tree-sitter', 'grammar-a', 'grammar-b', 'sqlite', 'unknown'].map(packageName => ({ packageName, required: true })),
  adapters, budget,
  prepareHeaders: async () => { events.push('headers'); },
  buildLocal: async (adapter, { compilerJobs }) => {
    assert.ok(events.includes('headers'));
    assert.equal(compilerJobs, budget.compilerJobs);
    if (adapter.packageName === 'tree-sitter') { events.push('runtime'); return; }
    assert.ok(events.includes('runtime'));
    running++; localRunning++; maximum = Math.max(maximum, running);
    events.push(adapter.packageName + ':start');
    if (localRunning === 2) releaseLocal();
    await bothStarted;
    running--; events.push(adapter.packageName + ':end');
  },
  buildFallback: async (entry, { compilerJobs }) => {
    assert.equal(running, 0, 'exclusive npm must wait for all local builds');
    assert.equal(compilerJobs, budget.cpuCount);
    if (entry.packageName === 'unknown') assert.ok(events.includes('sqlite'));
    events.push(entry.packageName);
  }
});
const deadline = setTimeout(() => { throw new Error('Dependency tasks failed to make bounded progress'); }, 2000);
try {
  const outcome = await runBootstrapTasks(tasks, { budget });
  assert.equal(outcome.ok, true);
  assert.equal(maximum, 2, 'independent admitted local builds actually overlap');
} finally { clearTimeout(deadline); }

let dependentRan = false, cancelledAndDrained = false;
const started = Promise.withResolvers();
const failure = await runBootstrapTasks([
  { id: 'peer', run: async ({ signal }) => {
    started.resolve();
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    cancelledAndDrained = true;
  } },
  { id: 'failure', run: async () => { await started.promise; throw new Error('compiler failed'); } },
  { id: 'dependent', dependsOn: ['failure'], run: async () => { dependentRan = true; } }
], { budget });
assert.equal(failure.ok, false);
assert.equal(dependentRan, false);
assert.equal(cancelledAndDrained, true, 'required failure drains already running owners before returning');
const optional = await runBootstrapTasks([
  { id: 'optional', required: false, run: async () => ({ ok: false, message: 'optional unavailable' }) },
  { id: 'required', dependsOn: [{ id: 'optional', settled: true }], run: async () => ({ ok: true }) }
], { budget: serial });
assert.equal(optional.ok, true);
assert.equal(optional.results[1].status, 'succeeded');
await assert.rejects(runBootstrapTasks([{ id: 'cycle', dependsOn: ['cycle'], run: async () => {} }], { budget }), /cycle/);
await assert.rejects(runBootstrapTasks([{ id: 'oversize', bytes: budget.memoryBytes + 1, run: async () => {} }], { budget }), /budget/);
console.log('bootstrap task ownership test passed');
