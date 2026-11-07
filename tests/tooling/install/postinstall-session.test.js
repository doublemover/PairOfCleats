import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runPackagePostinstall } from '../../../tools/setup/postinstall.js';
import { withCheckoutMutation, requireCheckoutMutationSession, retireCheckoutMutationSession } from '../../../tools/setup/checkout-mutation.js';
import { CHECKOUT_MUTATION_LOCK } from '../../../tools/setup/checkout-bootstrap-paths.js';
import { createPatchFixture, patchedText } from './patch-fixture.js';
import { makeTempDir } from '../../helpers/temp.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/postinstall-session/')[1];
assert.ok(['empty-and-inert', 'one-session-and-exclusion', 'borrowed-invocation-context',
  'original-failure-and-retirement', 'terminal-results-and-cancellation'].includes(mode));
const root = await makeTempDir('postinstall-session-');
const lockPath = path.join(root, CHECKOUT_MUTATION_LOCK), log = () => {};
const exists = () => fs.stat(lockPath).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
try {
  if (mode === 'empty-and-inert') {
    assert.deepEqual(await fs.readdir(root), [], 'importing the lifecycle owner creates no checkout state');
    assert.deepEqual(await runPackagePostinstall({ root, log, rebuild: () => assert.fail('empty checkout compiled') }),
      { patchCount: 0, exitCode: 0, signal: null });
    assert.equal(await exists(), false);
  } else {
    const fixture = await createPatchFixture(root);
    if (mode === 'one-session-and-exclusion') {
      const entered = Promise.withResolvers(), release = Promise.withResolvers(); let nativeSession;
      const pending = runPackagePostinstall({ root, log, rebuild: async (args, options) => {
        assert.deepEqual(args, []); nativeSession = options.session;
        requireCheckoutMutationSession(root, nativeSession);
        assert.equal(await fs.readFile(fixture.target, 'utf8'), patchedText);
        entered.resolve(); await release.promise;
        requireCheckoutMutationSession(root, nativeSession); return { exitCode: 0 };
      } });
      await entered.promise;
      try {
        assert.equal(await exists(), true);
        await assert.rejects(withCheckoutMutation(root, () => assert.fail('intervening mutator ran')), { code: 'ERR_CHECKOUT_MUTATION_BUSY' });
      } finally { release.resolve(); }
      assert.deepEqual(await pending, { patchCount: 1, exitCode: 0, signal: null });
      assert.equal(await exists(), false);
      assert.throws(() => requireCheckoutMutationSession(root, nativeSession), { code: 'ERR_CHECKOUT_MUTATION_SESSION' });
    } else if (mode === 'borrowed-invocation-context') {
      await withCheckoutMutation(root, async parent => {
        const controller = new AbortController();
        const options = { root, log, signal: controller.signal, session: parent, rebuild: async (args, selected) => {
          assert.deepEqual(args, []); assert.equal(selected.root, parent.root);
          assert.equal(selected.signal, controller.signal); assert.equal(selected.session, parent);
          requireCheckoutMutationSession(root, selected.session); return { exitCode: 0 };
        } };
        const pending = runPackagePostinstall(options);
        options.root = 'wrong-root'; options.session = {}; options.signal = AbortSignal.abort();
        options.rebuild = () => assert.fail('mutable caller replaced original selected native owner');
        assert.equal((await pending).exitCode, 0); requireCheckoutMutationSession(root, parent);
        assert.equal(await exists(), true, 'borrowed lifecycle cannot retire its parent');
      });
      assert.equal(await exists(), false);
    } else if (mode === 'original-failure-and-retirement') {
      for (const original of [false, 0, '', null, undefined, Object.freeze(new Error('actual native failure'))]) {
        let rejected = false;
        try { await runPackagePostinstall({ root, log, rebuild: async () => { throw original; } }); }
        catch (error) { rejected = true; assert.equal(error, original); }
        assert.equal(rejected, true); assert.equal(await exists(), false);
      }
      let retired = false;
      const original = Object.assign(new Error('native operation still owns physical work'), {
        cacheOwnershipPending: true, cacheOwnershipReleased: () => retired
      });
      const failure = await runPackagePostinstall({ root, log, rebuild: async () => { throw original; } }).catch(error => error);
      assert.equal(errorGraphIncludes(failure, original), true); assert.equal(await exists(), true);
      original.cacheOwnershipReleased = () => true;
      await assert.rejects(retireCheckoutMutationSession(failure.checkoutMutationSession));
      retired = true; await retireCheckoutMutationSession(failure.checkoutMutationSession);
      assert.equal(await exists(), false);
    } else {
      for (const result of [undefined, null, false, {}, { exitCode: -1 }, { exitCode: 0, signal: 'SIGTERM' }]) {
        await assert.rejects(runPackagePostinstall({ root, log, rebuild: async () => result }), { code: 'ERR_POSTINSTALL_NATIVE_RESULT' });
        assert.equal(await exists(), false);
      }
      assert.deepEqual(await runPackagePostinstall({ root, log, rebuild: async () => ({ exitCode: 7 }) }),
        { patchCount: 1, exitCode: 7, signal: null });
      assert.deepEqual(await runPackagePostinstall({ root, log, rebuild: async () => ({ exitCode: null, signal: 'SIGTERM' }) }),
        { patchCount: 1, exitCode: null, signal: 'SIGTERM' });
      const controller = new AbortController(); let rejected = false;
      try { await runPackagePostinstall({ root, log, signal: controller.signal, rebuild: async () => {
        controller.abort(false); return { exitCode: 0 };
      } }); } catch (error) { rejected = true; assert.equal(error, false); }
      assert.equal(rejected, true); assert.equal(await exists(), false);
    }
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Postinstall shares the original checkout session across patches and native work');
