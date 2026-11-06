import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { withCheckoutMutation } from '../../../tools/setup/checkout-mutation.js';
import { withCheckoutStageJournal, getCheckoutStageJournal, CHECKOUT_JOURNAL_STATUS, CHECKOUT_JOURNAL_LIMITS } from '../../../tools/setup/checkout-stage-journal.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { CHECKOUT_MUTATION_LOCK, BOOTSTRAP_RECEIPT } from '../../../tools/setup/checkout-bootstrap-paths.js';
import { makeTempDir } from '../../helpers/temp.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/checkout-stage-journal/')[1];
assert.ok(['ordered-original-stage-evidence', 'strict-and-borrowed-plan', 'original-failures-and-incomplete-plan',
  'independent-log-failures', 'unknown-close-retains-owner', 'original-outstanding-stage-drain', 'unknown-write-retains-owner',
  'prior-readiness-preserved-before-mutation', 'prior-readiness-byte-bound'].includes(mode));
const root = await makeTempDir('checkout-stage-journal-');
const retainedFixtureFds = new Set();
const status = () => JSON.parse(fs.readFileSync(path.join(root, CHECKOUT_JOURNAL_STATUS), 'utf8'));
const plan = { root, inputId: '1'.repeat(64), stages: [{ id: 'dependencies' }, { id: 'verification' }] };
const owned = (operation, options) => withCheckoutMutation(root, session => withCheckoutStageJournal(root, session, plan, operation, options));
try {
  if (mode === 'prior-readiness-preserved-before-mutation') {
    const previous = Buffer.from([0x7b, 0x22, 0xff, 0x00, 0x7d]);
    fs.mkdirSync(path.join(root, 'node_modules')); fs.writeFileSync(path.join(root, BOOTSTRAP_RECEIPT), previous);
    let preserved;
    await assert.rejects(owned(async journal => {
      preserved = journal.snapshot().priorReadiness;
      assert.equal(preserved.state, 'historical-only-not-current-readiness');
      assert.equal(preserved.bytes, previous.length);
      assert.equal(preserved.sha256, createHash('sha256').update(previous).digest('hex'));
      assert.deepEqual(fs.readFileSync(path.join(root, preserved.path)), previous, 'invalid UTF-8 is preserved as original bytes');
      await journal.runStage('dependencies', async () => {
        fs.rmSync(path.join(root, 'node_modules'), { recursive: true });
        throw new Error('late dependency failure after removal');
      });
    }), /late dependency failure/);
    assert.equal(status().state, 'failed'); assert.deepEqual(status().priorReadiness, preserved);
    assert.deepEqual(fs.readFileSync(path.join(root, preserved.path)), previous, 'failed install cannot destroy its prior receipt');
    assert.equal(fs.existsSync(path.join(root, BOOTSTRAP_RECEIPT)), false);
  } else if (mode === 'prior-readiness-byte-bound') {
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, BOOTSTRAP_RECEIPT), Buffer.alloc(CHECKOUT_JOURNAL_LIMITS.priorReceiptBytes + 1));
    let ran = false;
    await assert.rejects(owned(journal => journal.runStage('dependencies', () => { ran = true; })), /preservation byte bound/);
    assert.equal(ran, false); assert.equal(status().state, 'failed');
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), false);
    assert.equal(fs.statSync(path.join(root, BOOTSTRAP_RECEIPT)).size, CHECKOUT_JOURNAL_LIMITS.priorReceiptBytes + 1);
  } else if (mode === 'ordered-original-stage-evidence') {
    let original;
    const returned = { source: 'actual completion' };
    assert.equal(await owned(async (journal, isOwner) => {
      original = journal; assert.equal(isOwner, true); assert.equal(Object.isFrozen(journal), true);
      assert.equal(status().state, 'running');
      await journal.runStage('dependencies', async () => ({ ok: true, status: 0, signal: null }));
      const snapshot = journal.snapshot();
      assert.equal(Object.isFrozen(snapshot.stages), true); assert.equal(Object.isFrozen(snapshot.stages[0].result), true);
      assert.throws(() => { snapshot.selectedPlan.stages[1].id = 'rewritten'; }, TypeError);
      journal.bindVerifiedGeneration('2'.repeat(64));
      await journal.runStage('verification', async () => ({ ok: true, status: 0, signal: null }));
      return returned;
    }), returned);
    const final = status(); assert.equal(final.state, 'completed'); assert.equal(final.generationId, '2'.repeat(64));
    assert.equal(final.file.complete, true); assert.equal(final.stages.length, 2);
    const bytes = fs.readFileSync(original.file), events = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(final.file.bytes, bytes.length); assert.equal(final.file.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(events.map(event => event.sequence), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(events.map(event => event.state), ['run-started', 'stage-started', 'stage-finished', 'stage-started', 'stage-finished', 'run-completed']);
    assert.equal(new Set(events.map(event => event.planId)).size, 1);
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), false);
  } else if (mode === 'strict-and-borrowed-plan') {
    await withCheckoutMutation(root, session => withCheckoutStageJournal(root, session, plan, async journal => {
      assert.equal(getCheckoutStageJournal(session), journal); assert.equal(getCheckoutStageJournal({ ...session }), null);
      let ran = false;
      await assert.rejects(journal.runStage('verification', () => { ran = true; }), /admitted order/); assert.equal(ran, false);
      assert.equal(await withCheckoutStageJournal(root, session, { stages: 'cannot replace admitted plan' }, async (borrowed, isOwner) => {
        assert.equal(borrowed, journal); assert.equal(isOwner, false); return 'borrowed';
      }), 'borrowed');
      const entered = Promise.withResolvers(), release = Promise.withResolvers();
      const first = journal.runStage('dependencies', async () => { entered.resolve(); await release.promise; return { ok: true }; });
      await entered.promise;
      try { await assert.rejects(journal.runStage('verification', () => assert.fail('parallel stage admitted')), /admitted order/); }
      finally { release.resolve(); await first; }
      await assert.rejects(journal.runStage('dependencies', () => assert.fail('stage replayed')), /admitted order/);
      await journal.runStage('verification', async () => ({ ok: true }));
    }));
    assert.equal(status().state, 'completed');
  } else if (mode === 'original-failures-and-incomplete-plan') {
    for (const original of [false, 0, '', null, undefined, Object.freeze(new Error('original stage failure'))]) {
      let rejected = false;
      try { await owned(journal => journal.runStage('dependencies', async () => { throw original; })); }
      catch (error) { rejected = true; assert.equal(error, original); }
      assert.equal(rejected, true); assert.equal(status().state, 'failed'); assert.equal(status().file.complete, true);
      assert.equal(status().stages[0].state, 'failed'); assert.equal(status().stages[0].originalResources, 'retired');
    }
    await assert.rejects(owned(async journal => {
      await journal.runStage('dependencies', async () => ({ ok: false, status: 7 }));
      await assert.rejects(journal.runStage('verification', () => assert.fail('unsuccessful predecessor ignored')));
    }), /unsuccessful plan/);
    assert.equal(status().state, 'failed'); assert.equal(status().stages[0].result.status, 7);
  } else if (mode === 'independent-log-failures') {
    const original = Object.freeze(new Error('actual operation failure')); let calls = 0;
    const failure = await owned(journal => journal.runStage('dependencies', async () => { throw original; }), {
      publish: async (...args) => { if (++calls === 2) throw false; return atomicWriteJson(...args); }
    }).catch(error => error);
    assert.equal(errorGraphIncludes(failure, original), true); assert.equal(errorGraphIncludes(failure, false), true);
    assert.equal(status().state, 'failed'); assert.equal(status().file.complete, true);
    let writes = 0, ran = false;
    const unknown = await owned(journal => journal.runStage('dependencies', () => { ran = true; }), {
      io: { ...fs, writeSync(fd, buffer, offset, length, position) {
        writes++; fs.writeSync(fd, buffer, offset, Math.min(5, length), position); throw null;
      } }
    }).catch(error => error);
    assert.equal(errorGraphIncludes(unknown, null), true); assert.equal(ran, false); assert.equal(writes, 1, 'unconfirmed partial writes are not replayed');
    assert.equal(status().state, 'failed'); assert.equal(status().file.complete, false);
  } else if (mode === 'original-outstanding-stage-drain') {
    const entered = Promise.withResolvers(), release = Promise.withResolvers(); let returned = false;
    const pending = owned(journal => {
      void journal.runStage('dependencies', async () => { entered.resolve(); await release.promise; return { ok: true }; });
    });
    const outcome = pending.then(() => { returned = true; assert.fail('An unawaited stage cannot qualify completion'); }, error => { returned = true; return error; });
    await entered.promise;
    try {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(returned, false); assert.equal(status().state, 'running');
      assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), true);
    } finally { release.resolve(); }
    const failure = await outcome;
    assert.match(failure.message, /outstanding original stage/); assert.equal(status().state, 'failed');
    assert.equal(status().stages[0].state, 'succeeded'); assert.equal(status().file.complete, true);
  } else if (mode === 'unknown-write-retains-owner') {
    let writes = 0, ran = false;
    const failure = await owned(journal => journal.runStage('dependencies', () => { ran = true; }), { io: { ...fs,
      openSync(...args) { const fd = fs.openSync(...args); retainedFixtureFds.add(fd); return fd; },
      writeSync() { writes++; return false; },
      closeSync(fd) { retainedFixtureFds.delete(fd); return fs.closeSync(fd); }
    } }).catch(error => error);
    assert.equal(ran, false); assert.equal(writes, 1); assert.equal(retainedFixtureFds.size, 1);
    assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(status().file.complete, false);
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), true);
  } else {
    const original = Object.freeze(new Error('journal close unconfirmed'));
    const failure = await owned(async journal => {
      await journal.runStage('dependencies', async () => ({ ok: true }));
      await journal.runStage('verification', async () => ({ ok: true }));
    }, { io: { ...fs, closeSync(fd) { fs.closeSync(fd); throw original; } } }).catch(error => error);
    assert.equal(errorGraphIncludes(failure, original), true); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(status().state, 'failed'); assert.equal(status().file.complete, false);
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), true);
    // Intercepted closes did close the actual fixture descriptors. Production
    // must retain uncertainty, and never replay synchronous close by fd number.
  }
} finally {
  // This injected write performed no native work and never closed/reused these
  // exact fixture descriptors. Production cannot infer that from a false result.
  for (const fd of retainedFixtureFds) fs.closeSync(fd);
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Checkout stage journals preserve original ordered work, bounded evidence and independent I/O failures');
