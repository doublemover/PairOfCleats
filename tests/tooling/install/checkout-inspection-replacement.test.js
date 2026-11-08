import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inspectBootstrapReadiness, requireBootstrap, BOOTSTRAP_RECEIPT } from '../../../src/shared/bootstrap-readiness.js';
import { handleCheckoutInformation } from '../../../tools/setup/checkout-diagnose.js';
import { CHECKOUT_JOURNAL_STATUS } from '../../../tools/setup/checkout-stage-journal.js';
import { makeBootstrapDiagnosisFixture } from '../../helpers/bootstrap-diagnosis-fixture.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/checkout-inspection-replacement/')[1];
assert.ok(['receipt', 'journal'].includes(mode));
const fixture = await makeBootstrapDiagnosisFixture(), { root } = fixture;
try {
  const intact = await inspectBootstrapReadiness({ root });
  assert.equal(intact.ready, true, intact.reason);
  assert.equal(intact.nativeProbes, 'passed', 'the adapters exercise the actual prepared SQLite and parser bindings');
  const target = path.join(root, mode === 'receipt' ? BOOTSTRAP_RECEIPT : CHECKOUT_JOURNAL_STATUS);
  const originalBytes = fs.readFileSync(target), originalRead = fs.readFileSync;
  const replacement = mode === 'receipt' ? Buffer.concat([originalBytes, Buffer.from('\n')])
    : Buffer.from(JSON.stringify({ ...JSON.parse(originalBytes), state: 'failed' }));
  const inspectReplacement = async operation => {
    let replaced = false;
    fs.readFileSync = function (file, ...args) {
      const bytes = originalRead.call(this, file, ...args);
      // The input-hash pass follows the initial receipt and complete original
      // journal read. Replace a real file at that deterministic boundary, with
      // every original descriptor already closed and all native probes intact.
      if (!replaced && file === path.join(root, 'package.json')) {
        replaced = true;
        fs.writeFileSync(target + '.replacement', replacement);
        fs.renameSync(target + '.replacement', target);
      }
      return bytes;
    };
    try { return await operation(); }
    finally {
      fs.readFileSync = originalRead;
      fs.writeFileSync(target + '.replacement', originalBytes);
      fs.renameSync(target + '.replacement', target);
      assert.equal(replaced, true, 'the exact inspection boundary must execute');
    }
  };
  let stdout = '', stderr = '';
  await inspectReplacement(() => handleCheckoutInformation(['checkout', 'diagnose', '--json'], { root,
    stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } } }));
  assert.equal(process.exitCode, 1); process.exitCode = 0;
  assert.equal(stderr, '');
  const diagnosis = JSON.parse(stdout), expectedCode = `ERR_BOOTSTRAP_${mode.toUpperCase()}_REPLACED`;
  assert.equal(diagnosis.bootstrap.code, expectedCode);
  assert.equal(diagnosis.bootstrap.ready, false);
  assert.equal(diagnosis.bootstrap.nativeProbes, 'not-run');
  assert.equal(diagnosis.operationalReadiness, 'not-probed');
  assert.equal(diagnosis.recovery.action, 'wait');
  assert.equal(diagnosis.recovery.command, null);
  assert.deepEqual(diagnosis.nextCommands, []);
  await inspectReplacement(() => assert.rejects(requireBootstrap({ root }), error => {
    assert.equal(error.code, 'ERR_BOOTSTRAP_REQUIRED');
    for (const field of ['code', 'reason', 'mismatches', 'nextAction']) assert.deepEqual(error.bootstrap[field], diagnosis.bootstrap[field]);
    assert.deepEqual(error.runtime, diagnosis.runtime);
    assert.deepEqual(error.recovery, diagnosis.recovery);
    assert.match(error.message, /Next action: wait/);
    assert.doesNotMatch(error.message, /npm run bootstrap/);
    return true;
  }));
  assert.equal((await inspectBootstrapReadiness({ root, probeNatives: false })).ready, true);
  assert.deepEqual(fs.readFileSync(target), originalBytes, 'the original fixture is restored without running setup');
} finally { await fixture.dispose(); }
console.log('Real inspection replacement preserves ordinary and explicit diagnosis while refusing work.');
