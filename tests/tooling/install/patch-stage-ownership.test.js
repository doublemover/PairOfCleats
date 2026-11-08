import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withPackagePatchStage, getPackagePatchStageSession } from '../../../tools/setup/patch-stage.js';
import { withCheckoutMutation, retireCheckoutMutationSession } from '../../../tools/setup/checkout-mutation.js';
import { CHECKOUT_MUTATION_LOCK } from '../../../tools/setup/checkout-bootstrap-paths.js';
import { makeTempDir } from '../../helpers/temp.js';
import { errorGraphIncludes, errorGraphMatches } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/patch-stage-ownership/')[1];
assert.ok(['exact-success-and-failure', 'original-resource-retirement', 'cleanup-failure-and-identity',
  'unknown-cleanup-and-nested-enoent'].includes(mode));
const root = await makeTempDir('patch-stage-ownership-');
const lockPath = path.join(root, CHECKOUT_MUTATION_LOCK);
try {
  if (mode === 'exact-success-and-failure') {
    await withCheckoutMutation(root, async session => {
      let stage;
      assert.equal(await withPackagePatchStage(root, session, directory => {
        stage = directory; fs.writeFileSync(path.join(stage, 'target'), 'prepared bytes'); return 'prepared';
      }), 'prepared');
      assert.equal(fs.existsSync(stage), false);
      assert.equal(path.dirname(stage), path.join(session.root, '.tmp', 'checkout-bootstrap', 'patches'));
      for (const original of [false, 0, '', null, undefined, Object.freeze(new Error('actual Git failure'))]) {
        let rejected = false;
        try { await withPackagePatchStage(root, session, directory => { stage = directory; throw original; }); }
        catch (error) { rejected = true; assert.equal(error, original); }
        assert.equal(rejected, true); assert.equal(fs.existsSync(stage), false);
      }
      await assert.rejects(withPackagePatchStage(root, { ...session }, () => assert.fail('forged stage owner ran')),
        { code: 'ERR_CHECKOUT_MUTATION_SESSION' });
    });
    assert.equal(fs.existsSync(lockPath), false);
  } else if (mode === 'original-resource-retirement') {
    let retired = false, operations = 0, stage;
    const original = Object.assign(new Error('Git still owns its exact original work'), {
      cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, original); return retired; }
    });
    const failure = await withCheckoutMutation(root, session => withPackagePatchStage(root, session, directory => {
      stage = directory; operations++; throw original;
    })).catch(error => error);
    const owner = getPackagePatchStageSession(failure), checkout = failure.checkoutMutationSession;
    assert.ok(owner); assert.ok(checkout); assert.equal(Object.isFrozen(owner), true);
    assert.equal(errorGraphIncludes(failure, original), true);
    assert.equal(fs.existsSync(stage), true); assert.equal(fs.existsSync(lockPath), true);
    assert.equal(getPackagePatchStageSession({ patchStageSession: { ...owner } }), null);
    original.cacheOwnershipPending = false; original.cacheOwnershipReleased = () => true;
    assert.throws(() => owner.cleanup());
    await assert.rejects(retireCheckoutMutationSession(checkout));
    retired = true;
    // Physical retirement permits root-lock retirement independently of the
    // retained artifact. The original stage owner still removes only its inode.
    await retireCheckoutMutationSession(checkout);
    assert.equal(fs.existsSync(lockPath), false); assert.equal(fs.existsSync(stage), true);
    assert.equal(owner.cleanup(), true); assert.equal(owner.cleanup(), true);
    assert.equal(owner.isDisposed(), true); assert.equal(fs.existsSync(stage), false); assert.equal(operations, 1);
  } else if (mode === 'cleanup-failure-and-identity') {
    await withCheckoutMutation(root, async session => {
      for (const cleanupFailure of [false, 0, '', null, undefined]) {
        const original = Object.freeze(new Error('original preparation failure'));
        let removeCalls = 0, stage;
        const failure = await withPackagePatchStage(root, session, directory => {
          stage = directory; throw original;
        }, { remove: (...args) => { if (++removeCalls === 1) throw cleanupFailure; return fs.rmSync(...args); } }).catch(error => error);
        assert.equal(errorGraphIncludes(failure, original), true);
        assert.equal(errorGraphIncludes(failure, cleanupFailure), true);
        const owner = getPackagePatchStageSession(failure); assert.ok(owner);
        assert.equal(fs.existsSync(stage), true); assert.equal(owner.resourcesSettled(), true);
        const displaced = stage + '-original'; fs.renameSync(stage, displaced); fs.mkdirSync(stage);
        fs.writeFileSync(path.join(stage, 'replacement'), 'must remain');
        Object.defineProperty(failure, 'recoveryPath', { value: root });
        assert.throws(() => owner.cleanup(), { code: 'ERR_ATOMIC_PARENT_CHANGED' });
        assert.equal(removeCalls, 1); assert.equal(fs.existsSync(path.join(stage, 'replacement')), true);
        fs.rmSync(stage, { recursive: true }); fs.renameSync(displaced, stage);
        assert.equal(owner.cleanup(), true); assert.equal(removeCalls, 2);
        assert.equal(owner.cleanupErrors().includes(cleanupFailure), true);
      }
    });
  } else {
    await withCheckoutMutation(root, async session => {
      let stage, removals = 0;
      const failure = await withPackagePatchStage(root, session, directory => { stage = directory; }, {
        remove: () => { removals++; return false; }
      }).catch(error => error);
      const owner = getPackagePatchStageSession(failure); assert.ok(owner);
      assert.equal(errorGraphMatches(failure, /standard void result/), true);
      assert.equal(owner.resourcesSettled(), false); assert.equal(fs.existsSync(stage), true);
      assert.throws(() => owner.cleanup()); assert.equal(removals, 1, 'unknown cleanup cannot be replayed');
      let childStage, attempts = 0;
      const absentChild = Object.assign(new Error('inner recursive target vanished'), { code: 'ENOENT' });
      const nested = await withPackagePatchStage(root, session, directory => { childStage = directory; }, {
        remove: (...args) => { if (++attempts === 1) throw absentChild; return fs.rmSync(...args); }
      }).catch(error => error);
      const childOwner = getPackagePatchStageSession(nested); assert.ok(childOwner);
      assert.equal(errorGraphIncludes(nested, absentChild), true); assert.equal(childOwner.isDisposed(), false);
      assert.equal(fs.existsSync(childStage), true); assert.equal(childOwner.cleanup(), true); assert.equal(attempts, 2);
    });
    // Unknown fake removal owns no real native work, but its caller must not
    // silently turn that injected result into successful cleanup evidence.
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('Package patch staging preserves original resources and exact cleanup identity');
