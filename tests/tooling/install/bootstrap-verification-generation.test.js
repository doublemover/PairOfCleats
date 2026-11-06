import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BOOTSTRAP_RECEIPT, BOOTSTRAP_RECEIPT_VERSION, inspectBootstrapReadiness } from '../../../src/shared/bootstrap-readiness.js';
import { makeBootstrapVerificationFixture } from '../../helpers/bootstrap-verification.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/bootstrap-verification-generation/')[1];
assert.ok(['setup-input-drift', 'dependency-artifact-drift', 'original-single-use-capture', 'receipt-evidence-and-cutover'].includes(mode));
const fixture = await makeBootstrapVerificationFixture(), { root, capture, record, write } = fixture;
const target = path.join(root, BOOTSTRAP_RECEIPT), contents = () => fs.readFile(target, 'utf8');
try {
  const initial = record(capture()), previous = await contents();
  assert.equal(initial.schemaVersion, BOOTSTRAP_RECEIPT_VERSION);
  assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).ready, true);
  if (mode === 'setup-input-drift') {
    for (const relative of ['package-lock.json', 'tools/setup/preflight.js', 'tools/setup/checkout-bootstrap-arguments.js']) {
      const original = await fs.readFile(path.join(root, relative)), seal = capture();
      await write(relative, Buffer.concat([original, Buffer.from('\nchanged setup identity\n')]));
      assert.throws(() => record(seal), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' });
      assert.equal(await contents(), previous, 'drift never replaces the prior readiness receipt');
      await write(relative, original);
    }
  } else if (mode === 'dependency-artifact-drift') {
    const relative = 'node_modules/tree-sitter/fixture.node', original = await fs.readFile(path.join(root, relative));
    let seal = capture(); await write(relative, 'changed dependency bytes and metadata');
    assert.throws(() => record(seal), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' }); assert.equal(await contents(), previous);
    await write(relative, original);
    seal = capture(); await write('node_modules/tree-sitter/new-native.node', 'new unprobed native');
    assert.throws(() => record(seal), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' }); assert.equal(await contents(), previous);
    await fs.unlink(path.join(root, 'node_modules/tree-sitter/new-native.node'));
    seal = capture(); await fs.unlink(path.join(root, relative));
    assert.throws(() => record(seal), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' }); assert.equal(await contents(), previous);
  } else if (mode === 'original-single-use-capture') {
    const seal = capture(); assert.equal(Object.isFrozen(seal), true);
    assert.throws(() => record({ ...seal }), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' });
    assert.throws(() => record(), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' });
    assert.equal(await contents(), previous);
    const receipt = record(seal); assert.equal(receipt.verification.generationId, seal.generationId);
    const admitted = await contents();
    assert.throws(() => record(seal), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' }); assert.equal(await contents(), admitted);
  } else {
    const receipt = JSON.parse(previous);
    for (const verification of [null, { ...receipt.verification, generationId: '0'.repeat(64) }, { ...receipt.verification, policy: 'invented-completion-policy' }]) {
      await write(BOOTSTRAP_RECEIPT, JSON.stringify({ ...receipt, verification }));
      const rejected = await inspectBootstrapReadiness({ root, probeNatives: false });
      assert.equal(rejected.ready, false); assert.equal(rejected.code, 'ERR_BOOTSTRAP_VERIFICATION_INVALID');
    }
    await write(BOOTSTRAP_RECEIPT, JSON.stringify({ ...receipt, schemaVersion: BOOTSTRAP_RECEIPT_VERSION - 1 }));
    const legacy = await inspectBootstrapReadiness({ root, probeNatives: false });
    assert.equal(legacy.ready, false); assert.ok(legacy.mismatches.some(row => row.field === 'schemaVersion'));
    record(capture()); assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).ready, true);
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Bootstrap generation admission binds original pre-probe metadata and rejects changed or obsolete readiness evidence');
