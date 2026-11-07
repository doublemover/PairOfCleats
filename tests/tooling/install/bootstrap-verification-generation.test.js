import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BOOTSTRAP_RECEIPT, BOOTSTRAP_RECEIPT_VERSION, captureBootstrapVerification, inspectBootstrapReadiness, recordBootstrapReadiness } from '../../../src/shared/bootstrap-readiness.js';
import { CHECKOUT_JOURNAL_STATUS } from '../../../tools/setup/checkout-stage-journal.js';
import { makeBootstrapVerificationFixture } from '../../helpers/bootstrap-verification.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/bootstrap-verification-generation/')[1];
assert.ok(['setup-input-drift', 'dependency-artifact-drift', 'original-single-use-capture', 'receipt-evidence-and-cutover',
  'original-session-and-active-publication', 'journal-identity-and-completion', 'journal-frame-integrity'].includes(mode));
const fixture = await makeBootstrapVerificationFixture(), { root, write, verify } = fixture;
const target = path.join(root, BOOTSTRAP_RECEIPT), contents = () => fs.readFile(target, 'utf8');
try {
  const initial = await verify(), previous = await contents();
  assert.equal(initial.schemaVersion, BOOTSTRAP_RECEIPT_VERSION);
  assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).ready, true);
  if (mode === 'setup-input-drift') {
    for (const relative of ['package-lock.json', 'tools/setup/preflight.js', 'tools/setup/checkout-bootstrap-arguments.js']) {
      const original = await fs.readFile(path.join(root, relative));
      await assert.rejects(verify(async ({ capture, record }) => {
        const seal = capture(); await write(relative, Buffer.concat([original, Buffer.from('\nchanged setup identity\n')]));
        return record(seal);
      }), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' });
      assert.equal(await contents(), previous, 'drift never replaces the prior readiness receipt');
      await write(relative, original);
    }
  } else if (mode === 'dependency-artifact-drift') {
    const relative = 'node_modules/tree-sitter/fixture.node', original = await fs.readFile(path.join(root, relative));
    await assert.rejects(verify(async ({ capture, record }) => {
      const seal = capture(); await write(relative, 'changed dependency bytes and metadata'); return record(seal);
    }), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' }); assert.equal(await contents(), previous);
    await write(relative, original);
    await assert.rejects(verify(async ({ capture, record }) => {
      const seal = capture(); await write('node_modules/tree-sitter/new-native.node', 'new unprobed native'); return record(seal);
    }), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' }); assert.equal(await contents(), previous);
    await fs.unlink(path.join(root, 'node_modules/tree-sitter/new-native.node'));
    await assert.rejects(verify(async ({ capture, record }) => {
      const seal = capture(); await fs.unlink(path.join(root, relative)); return record(seal);
    }), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' }); assert.equal(await contents(), previous);
  } else if (mode === 'original-single-use-capture') {
    await verify(async ({ capture, record }) => {
      const seal = capture(); assert.equal(Object.isFrozen(seal), true);
      await assert.rejects(record({ ...seal }), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' });
      await assert.rejects(record(), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' });
      assert.equal(await contents(), previous);
      const receipt = await record(seal); assert.equal(receipt.verification.generationId, seal.generationId);
      const admitted = await contents();
      await assert.rejects(record(seal), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' }); assert.equal(await contents(), admitted);
    });
  } else if (mode === 'receipt-evidence-and-cutover') {
    const receipt = JSON.parse(previous);
    for (const verification of [null, { ...receipt.verification, generationId: '0'.repeat(64) }, { ...receipt.verification, policy: 'invented-completion-policy' }]) {
      await write(BOOTSTRAP_RECEIPT, JSON.stringify({ ...receipt, verification }));
      const rejected = await inspectBootstrapReadiness({ root, probeNatives: false });
      assert.equal(rejected.ready, false); assert.equal(rejected.code, 'ERR_BOOTSTRAP_VERIFICATION_INVALID');
    }
    await write(BOOTSTRAP_RECEIPT, JSON.stringify({ ...receipt, schemaVersion: BOOTSTRAP_RECEIPT_VERSION - 1 }));
    const legacy = await inspectBootstrapReadiness({ root, probeNatives: false });
    assert.equal(legacy.ready, false); assert.ok(legacy.mismatches.some(row => row.field === 'schemaVersion'));
    await verify(); assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).ready, true);
  } else if (mode === 'original-session-and-active-publication') {
    assert.throws(() => captureBootstrapVerification(root), { code: 'ERR_CHECKOUT_MUTATION_SESSION' });
    let escaped;
    await verify(async ({ capture, record, session, journal }) => {
      assert.throws(() => captureBootstrapVerification(root, { session: { ...session } }), { code: 'ERR_CHECKOUT_MUTATION_SESSION' });
      escaped = capture();
      const receipt = await record(capture());
      assert.equal(receipt.verification.checkoutRunId, session.runId);
      assert.equal(receipt.verification.journalPlanId, journal.planId);
      assert.equal(journal.snapshot().state, 'running');
      assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).code, 'ERR_BOOTSTRAP_MUTATION_ACTIVE');
    });
    await assert.rejects(recordBootstrapReadiness(root, fixture.packages, { verification: escaped }), { code: 'ERR_CHECKOUT_MUTATION_SESSION' });
    assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).ready, true);
  } else if (mode === 'journal-identity-and-completion') {
    const original = await fs.readFile(path.join(root, CHECKOUT_JOURNAL_STATUS), 'utf8'), status = JSON.parse(original);
    for (const changed of [{ ...status, state: 'running' }, { ...status, state: 'failed' }, { ...status, runId: 'copied-other-run' },
      { ...status, generationId: '0'.repeat(64) }, { ...status, originalResources: 'pending' },
      { ...status, file: { ...status.file, complete: false } }]) {
      await write(CHECKOUT_JOURNAL_STATUS, JSON.stringify(changed));
      assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).code, 'ERR_BOOTSTRAP_JOURNAL_INCOMPLETE');
    }
    await fs.unlink(path.join(root, CHECKOUT_JOURNAL_STATUS));
    assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).code, 'ERR_BOOTSTRAP_JOURNAL_INCOMPLETE');
    await write(CHECKOUT_JOURNAL_STATUS, original);
    assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).ready, true);
  } else {
    const status = JSON.parse(await fs.readFile(path.join(root, CHECKOUT_JOURNAL_STATUS), 'utf8'));
    const original = await fs.readFile(path.join(root, status.file.path), 'utf8');
    await write(status.file.path, original.replace('stage-started', 'stage-altered'));
    assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).code, 'ERR_BOOTSTRAP_JOURNAL_INCOMPLETE');
    // Even a self-consistent edited checksum cannot invent the ordered stage
    // frames required by this current receipt's completed journal.
    const { createHash } = await import('node:crypto');
    const altered = original.replace('stage-started', 'stage-altered');
    await write(CHECKOUT_JOURNAL_STATUS, JSON.stringify({ ...status, file: { ...status.file,
      bytes: Buffer.byteLength(altered), sha256: createHash('sha256').update(altered).digest('hex') } }));
    assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).code, 'ERR_BOOTSTRAP_JOURNAL_INCOMPLETE');
    await write(status.file.path, original); await write(CHECKOUT_JOURNAL_STATUS, JSON.stringify(status));
    assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).ready, true);
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Bootstrap generation admission binds original pre-probe metadata and rejects changed or obsolete readiness evidence');
