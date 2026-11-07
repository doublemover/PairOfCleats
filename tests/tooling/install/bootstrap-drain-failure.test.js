import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { withCheckoutMutation, retireCheckoutMutationSession } from '../../../tools/setup/checkout-mutation.js';
import { CHECKOUT_MUTATION_LOCK } from '../../../tools/setup/checkout-bootstrap-paths.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { makeTempDir } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/bootstrap-drain-failure/')[1];
assert.ok(['observer-and-drain', 'task-and-drain', 'original-observer-resources'].includes(mode));
const owner = new URL('../../../tools/setup/bootstrap-tasks.js', import.meta.url).href;
const schedulerOwner = new URL('../../../src/shared/concurrency/scheduler-core.js', import.meta.url).href;
const fixtureKey = Symbol.for('pairofcleats.bootstrap-drain-failure.fixture');
const fixture = { cleanup: undefined }; globalThis[fixtureKey] = fixture;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.split('?')[0] === owner && specifier === '../../src/shared/concurrency/scheduler-core.js'
      && mode !== 'original-observer-resources') return { url: 'bootstrap-drain-fixture:scheduler', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url !== 'bootstrap-drain-fixture:scheduler') return next(url, context);
    return { format: 'module', shortCircuit: true, source: `
      import {createBuildScheduler as actual} from ${JSON.stringify(schedulerOwner)};
      export const createBuildScheduler = options => {
        const scheduler=actual(options);
        return {...scheduler,shutdown:async options=>{
          await scheduler.shutdown(options);
          throw globalThis[Symbol.for('pairofcleats.bootstrap-drain-failure.fixture')].cleanup;
        }};
      };` };
  }
});
const budget = { jobs: 2, cpuCount: 2, memoryBytes: 1024 };
try {
  const { runBootstrapTasks } = await import(owner + '?original-drain=' + mode);
  if (mode !== 'original-observer-resources') {
    for (const original of [false, 0, '', null, undefined, Object.freeze(new Error('original task or observer failure'))]) {
      for (const cleanup of [false, null, undefined, Object.freeze(new Error('independent scheduler retirement failure'))]) {
        fixture.cleanup = cleanup;
        const failure = await runBootstrapTasks([{ id: 'compiler', run: async () => {
          if (mode === 'task-and-drain') throw original;
          return 'actual operation result';
        } }], { budget, onResult: () => { if (mode === 'observer-and-drain') throw original; } }).catch(error => error);
        assert.equal(errorGraphIncludes(failure, original), true);
        assert.equal(errorGraphIncludes(failure, cleanup), true);
        assert.equal(Object.isFrozen(failure.bootstrapResults), true);
        assert.equal(failure.bootstrapResults[0].status, mode === 'task-and-drain' ? 'failed' : 'succeeded');
        if (mode === 'task-and-drain') assert.equal(failure.bootstrapResults[0].error, original);
        else assert.equal(failure.bootstrapResults[0].result, 'actual operation result');
      }
    }
  } else {
    const root = await makeTempDir('bootstrap-observer-resource-');
    try {
      let retired = false;
      const original = Object.assign(new Error('observer callback rejected before its resource retired'), {
        cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, original); return retired; }
      });
      const failure = await withCheckoutMutation(root, () => runBootstrapTasks([
        { id: 'first', run: async () => 'one' }, { id: 'second', run: async () => 'two' }
      ], { budget, onResult: row => { throw row.id === 'first' ? original : false; } })).catch(error => error);
      assert.equal(errorGraphIncludes(failure, original), true); assert.equal(errorGraphIncludes(failure, false), true);
      const lockPath = path.join(root, CHECKOUT_MUTATION_LOCK);
      assert.equal((await fs.stat(lockPath)).isFile(), true);
      original.cacheOwnershipReleased = () => true;
      await assert.rejects(retireCheckoutMutationSession(failure.checkoutMutationSession));
      retired = true; await retireCheckoutMutationSession(failure.checkoutMutationSession);
      await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }
} finally { hook.deregister(); delete globalThis[fixtureKey]; }
console.log('Bootstrap preserves independent task, observer and scheduler retirement failures');
