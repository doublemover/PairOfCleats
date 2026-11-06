import assert from 'node:assert/strict';
import { runBootstrapTasks } from '../../../tools/setup/bootstrap-tasks.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/bootstrap-failure-observation/')[1];
assert.ok(['falsy-task-failures', 'accessor-errors', 'observer-settlement', 'observer-errors'].includes(mode));
const budget = { jobs: 2, cpuCount: 2, memoryBytes: 1024 };
const rejectSame = async (pending, expected) => {
  let rejected = false;
  try { await pending; } catch (error) { rejected = true; assert.equal(error, expected); }
  assert.equal(rejected, true);
};
if (mode === 'falsy-task-failures') {
  for (const original of [false, 0, '', null, undefined]) {
    let dependent = false;
    const result = await runBootstrapTasks([
      { id: 'compiler', run: async () => { throw original; } },
      { id: 'consumer', dependsOn: ['compiler'], run: async () => { dependent = true; } }
    ], { budget });
    assert.equal(result.ok, false); assert.equal(result.results[0].status, 'failed');
    assert.equal(result.results[0].error, original); assert.equal(result.results[0].result, null);
    assert.equal(result.results[1].status, 'blocked'); assert.equal(dependent, false);
  }
} else if (mode === 'accessor-errors') {
  let reads = 0;
  const original = Object.freeze(Object.defineProperties({}, {
    result: { get() { reads++; throw new Error('result getter must not run'); } },
    name: { get() { reads++; throw new Error('name getter must not classify'); } }
  }));
  const controller = new AbortController();
  const result = await runBootstrapTasks([{ id: 'compiler', run: async () => {
    controller.abort('coincident caller cancellation'); throw original;
  } }], { budget, signal: controller.signal });
  assert.equal(reads, 0); assert.equal(result.ok, false); assert.equal(result.results[0].error, original);
  assert.equal(result.results[0].status, 'failed', 'coincident cancellation cannot replace an unrelated compiler failure');
  const data = Object.freeze({ result: Object.freeze({ ok: false, message: 'original compiler receipt' }) });
  const projected = await runBootstrapTasks([{ id: 'compiler', run: async () => { throw data; } }], { budget });
  assert.equal(projected.results[0].result, data.result); assert.equal(projected.results[0].error, data);
} else if (mode === 'observer-settlement') {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let finished = false;
  const run = runBootstrapTasks([{ id: 'compiler', run: async () => 'compiled' }], { budget,
    onResult: async row => {
      assert.equal(Object.isFrozen(row), true); assert.throws(() => { row.status = 'failed'; }, TypeError);
      entered.resolve(); await release.promise; finished = true;
    } });
  await entered.promise;
  let returned = false; run.then(() => { returned = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(returned, false, 'the original observer is still outstanding');
  release.resolve(); const result = await run;
  assert.equal(finished, true); assert.equal(result.ok, true); assert.equal(result.results[0].status, 'succeeded');
} else {
  for (const original of [false, 0, '', null, undefined]) {
    await rejectSame(runBootstrapTasks([{ id: 'compiler', run: async () => 'compiled' }], {
      budget, onResult: () => { throw original; }
    }), original);
    await rejectSame(runBootstrapTasks([{ id: 'compiler', run: async () => 'compiled' }], {
      budget, onResult: async () => { throw original; }
    }), original);
  }
  const started = Promise.withResolvers(), release = Promise.withResolvers(), observed = [];
  let drained = false;
  const pending = runBootstrapTasks([
    { id: 'peer', run: async ({ signal }) => {
      started.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      await release.promise; drained = true;
    } },
    { id: 'compiler', run: async () => { await started.promise; return 'compiled'; } }
  ], { budget, onResult: row => { observed.push(row.id); throw row.id === 'compiler' ? false : null; } });
  let returned = false; const outcome = pending.then(() => { returned = true; assert.fail('Expected observer failures'); }, error => { returned = true; return error; });
  while (!observed.includes('compiler')) await new Promise(resolve => setImmediate(resolve));
  assert.equal(returned, false); assert.equal(drained, false);
  release.resolve(); const error = await outcome;
  assert.equal(drained, true); assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [false, null]);
  assert.equal(error.cause, false); assert.equal(observed.length, 2);
}
console.log('Bootstrap preserves original task/observer failures and awaits actual observation settlement');
