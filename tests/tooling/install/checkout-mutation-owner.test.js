import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withCheckoutMutation, requireCheckoutMutationSession, retireCheckoutMutationSession } from '../../../tools/setup/checkout-mutation.js';
import { CHECKOUT_MUTATION_LOCK } from '../../../tools/setup/checkout-bootstrap-paths.js';
import { inspectBootstrapReadiness, requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { makeBootstrapVerificationFixture } from '../../helpers/bootstrap-verification.js';
import { makeTempDir } from '../../helpers/temp.js';
import { errorGraphIncludes, errorGraphMatches } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/checkout-mutation-owner/')[1];
assert.ok(['original-session-and-isolation', 'concurrent-and-orphan-protection', 'original-error-and-retirement', 'outstanding-borrowed-work', 'readiness-boundary', 'late-borrowed-retirement-fence'].includes(mode));
const fixture = mode === 'readiness-boundary' ? await makeBootstrapVerificationFixture() : { root: await makeTempDir('checkout-mutation-') };
const { root } = fixture, lockPath = path.join(root, CHECKOUT_MUTATION_LOCK);
const exists = async () => fs.stat(lockPath).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
try {
  if (mode === 'original-session-and-isolation') {
    let original;
    const result = await withCheckoutMutation(root, async session => {
      original = session; assert.equal(Object.isFrozen(session), true);
      assert.equal(requireCheckoutMutationSession(root, session), session);
      assert.equal(await withCheckoutMutation(root, child => { assert.equal(child, session); return 'same owner'; }, { session }), 'same owner');
      await assert.rejects(withCheckoutMutation(root, () => assert.fail('forged session ran'), { session: { ...session } }), { code: 'ERR_CHECKOUT_MUTATION_SESSION' });
      const other = await makeTempDir('checkout-mutation-other-');
      try {
        await assert.rejects(withCheckoutMutation(other, () => assert.fail('cross-root session ran'), { session }), { code: 'ERR_CHECKOUT_MUTATION_SESSION' });
        assert.equal(await withCheckoutMutation(other, () => 'independent root'), 'independent root');
      } finally { await fs.rm(other, { recursive: true, force: true }); }
      return 'completed';
    });
    assert.equal(result, 'completed'); assert.equal(await exists(), false);
    assert.equal(await retireCheckoutMutationSession(original), true, 'original retirement is idempotent');
    await assert.rejects(withCheckoutMutation(root, () => assert.fail('retired session ran'), { session: original }), { code: 'ERR_CHECKOUT_MUTATION_SESSION' });
    let successorRan = false;
    const replaced = await withCheckoutMutation(root, async session => {
      const bytes = await fs.readFile(lockPath);
      await fs.rename(lockPath, lockPath + '.original-fixture');
      await fs.writeFile(lockPath, bytes);
      assert.throws(() => requireCheckoutMutationSession(root, session), { code: 'ERR_PERSISTENCE_FILE_CHANGED' },
        'a copied nonce/PID record cannot replace the publisher-attested original file');
      await assert.rejects(withCheckoutMutation(root, () => { successorRan = true; }, { session }), { code: 'ERR_PERSISTENCE_FILE_CHANGED' });
    }).catch(error => error);
    assert.equal(successorRan, false); assert.equal(errorGraphMatches(replaced, /sealed original file/), true);
    assert.equal(await exists(), true, 'failed original release never deletes replacement metadata');
  } else if (mode === 'concurrent-and-orphan-protection') {
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const active = withCheckoutMutation(root, async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    try { await assert.rejects(withCheckoutMutation(root, () => assert.fail('second mutator ran')), { code: 'ERR_CHECKOUT_MUTATION_BUSY' }); }
    finally { release.resolve(); await active; }
    const orphan = JSON.stringify({ pid: 2147483647, lockId: randomUUID(), startedAt: '2000-01-01T00:00:00.000Z', resourceSettlementVersion: 1 });
    await fs.writeFile(lockPath, orphan); await fs.utimes(lockPath, new Date(0), new Date(0));
    await assert.rejects(withCheckoutMutation(root, () => assert.fail('orphaned original work was stolen')), { code: 'ERR_CHECKOUT_MUTATION_BUSY' });
    assert.equal(await fs.readFile(lockPath, 'utf8'), orphan, 'neither PID death nor age authorizes mutation or removal');
    await fs.unlink(lockPath); // Disposable negative fixture, never a live owner.
  } else if (mode === 'original-error-and-retirement') {
    for (const original of [false, 0, '', null, undefined, Object.freeze(new Error('original setup failure'))]) {
      let rejected = false;
      try { await withCheckoutMutation(root, async () => { throw original; }); }
      catch (error) { rejected = true; assert.equal(error, original); }
      assert.equal(rejected, true); assert.equal(await exists(), false);
    }
    let retired = false;
    const original = Object.assign(new Error('actual child still owns dependency-tree writes'), {
      cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, original); return retired; }
    });
    const failure = await withCheckoutMutation(root, async () => { throw original; }).catch(error => error);
    assert.equal(errorGraphIncludes(failure, original), true); assert.equal(await exists(), true);
    const session = failure.checkoutMutationSession; assert.ok(session);
    original.cacheOwnershipPending = false; original.cacheOwnershipReleased = () => true;
    await assert.rejects(retireCheckoutMutationSession(session)); assert.equal(await exists(), true);
    await assert.rejects(withCheckoutMutation(root, () => assert.fail('pending child was bypassed')), { code: 'ERR_CHECKOUT_MUTATION_BUSY' });
    retired = true; assert.equal(await retireCheckoutMutationSession(session), true); assert.equal(await exists(), false);
  } else if (mode === 'outstanding-borrowed-work') {
    const entered = Promise.withResolvers(), release = Promise.withResolvers(); let returned = false;
    const operation = withCheckoutMutation(root, async session => {
      void withCheckoutMutation(root, async () => { entered.resolve(); await release.promise; throw false; }, { session });
      await entered.promise; return 'cannot publish';
    });
    const outcome = operation.then(() => { returned = true; assert.fail('Unawaited mutation cannot publish success'); }, error => { returned = true; return error; });
    await entered.promise; await new Promise(resolve => setImmediate(resolve));
    assert.equal(returned, false); assert.equal(await exists(), true);
    release.resolve(); const failure = await outcome;
    assert.equal(errorGraphMatches(failure, /outstanding owned operations/), true); assert.equal(errorGraphIncludes(failure, false), true);
    assert.equal(await exists(), false);
    let retired = false;
    const pending = Object.assign(new Error('handled rejection still owns physical work'), { cacheOwnershipPending: true, cacheOwnershipReleased: () => retired });
    const retained = await withCheckoutMutation(root, async session => {
      await withCheckoutMutation(root, async () => { throw pending; }, { session }).catch(() => {});
      return 'handled logical error';
    }).catch(error => error);
    assert.equal(errorGraphIncludes(retained, pending), true); assert.equal(await exists(), true);
    retired = true; await retireCheckoutMutationSession(retained.checkoutMutationSession); assert.equal(await exists(), false);
  } else if (mode === 'late-borrowed-retirement-fence') {
    const open = fs.open; let retired = true, armed = false, reads = 0, operations = 0;
    const original = Object.assign(new Error('handled borrowed work becomes pending during actual metadata retirement'), {
      cacheOwnershipPending: true, cacheOwnershipReleased: () => retired
    });
    let failure;
    try {
      fs.open = async function (file, flags, ...args) {
        if (armed && file === lockPath && flags === 'r') { armed = false; reads++; retired = false; }
        return open.call(this, file, flags, ...args);
      };
      failure = await withCheckoutMutation(root, async session => {
        operations++;
        await withCheckoutMutation(root, async () => { throw original; }, { session }).catch(() => {});
        armed = true; return 'logically handled';
      }).catch(error => error);
    } finally { fs.open = open; }
    assert.equal(reads, 1); assert.equal(await exists(), true, 'the producer rechecks original borrowed work inside metadata retirement');
    assert.equal(errorGraphIncludes(failure, original), true); assert.equal(failure.cacheOwnershipReleased(), false);
    original.cacheOwnershipReleased = () => true;
    await assert.rejects(retireCheckoutMutationSession(failure.checkoutMutationSession));
    retired = true; await retireCheckoutMutationSession(failure.checkoutMutationSession);
    assert.equal(await exists(), false); assert.equal(operations, 1, 'retirement never replays the mutation');
  } else {
    fixture.record(fixture.capture());
    assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).ready, true);
    await withCheckoutMutation(root, async () => {
      const blocked = await inspectBootstrapReadiness({ root, probeNatives: false });
      assert.equal(blocked.ready, false); assert.equal(blocked.code, 'ERR_BOOTSTRAP_MUTATION_ACTIVE');
      await assert.rejects(requireBootstrap({ root }), error => error.code === 'ERR_BOOTSTRAP_REQUIRED' && /mutation|retained original work/.test(error.message));
    });
    assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).ready, true,
      'metadata-only fixture readiness is unchanged after actual mutation-session retirement');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Checkout mutation uses original root-qualified sessions and preserves pending-resource protection');
