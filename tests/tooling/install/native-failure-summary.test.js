import assert from 'node:assert/strict';
import { nativeFailureEntry, createNativeFailureError } from '../../../tools/setup/native-failure-summary.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/native-failure-summary/')[1];
assert.ok(['original-values-and-packets', 'row-authority-and-status', 'original-resource-observations'].includes(mode));
if (mode === 'original-values-and-packets') {
  for (const original of [false, 0, '', null, undefined, Object.freeze(new Error('actual activation failure'))]) {
    const result = Object.freeze({ ok: false, message: 'native activation failed', error: original, diagnosticsPath: 'actual-attempt.json' });
    const entry = nativeFailureEntry({ pkgName: 'native-package', result, phase: 'activation' });
    const error = createNativeFailureError('Required native activation failed.', 'ERR_NATIVE_SETUP_ACTIVATION', { failures: [entry] });
    assert.equal(entry.error, original); assert.equal(entry.result, result); assert.equal(entry.diagnosticsPath, 'actual-attempt.json');
    assert.equal(Object.isFrozen(entry), true); assert.equal(error.cause, original); assert.deepEqual(error.errors, [original]);
    assert.equal(error.code, 'ERR_NATIVE_SETUP_ACTIVATION'); assert.equal(error.failures[0], entry);
    assert.equal(Object.isFrozen(error.failures), true); assert.equal(errorGraphIncludes(error, original), true);
  }
  let reads = 0;
  const packet = Object.freeze(Object.defineProperties({ ok: false }, {
    message: { get() { reads++; throw new Error('diagnostic message getter'); } },
    error: { get() { reads++; throw new Error('diagnostic error getter'); } }
  }));
  const entry = nativeFailureEntry({ pkgName: 'declared-negative', result: packet, phase: 'activation' });
  assert.equal(reads, 0); assert.equal(Object.hasOwn(entry, 'error'), false); assert.equal(entry.result, packet);
  const failure = createNativeFailureError('Declared activation failure.', 'ERR_NATIVE_SETUP_ACTIVATION', { failures: [entry] });
  assert.equal(failure.cause, packet); assert.equal(reads, 0);
} else if (mode === 'row-authority-and-status') {
  const compiler = Object.freeze(new Error('actual compiler failure')), cancelled = Object.freeze(new Error('peer cancelled'));
  const rows = Object.freeze([
    Object.freeze({ id: 'peer', required: true, status: 'cancelled', error: cancelled, result: null }),
    Object.freeze({ id: 'compiler', required: true, status: 'failed', error: compiler,
      result: Object.freeze({ ok: false, error: 'result cannot replace the original row failure', message: 'compiler result' }) }),
    Object.freeze({ id: 'dependent', required: true, status: 'blocked', error: null, result: null }),
    Object.freeze({ id: 'optional', required: false, status: 'failed', error: null, result: null })
  ]);
  const entries = rows.map(row => nativeFailureEntry({ pkgName: row.id, row, result: row.result, phase: 'build' }));
  const failure = createNativeFailureError('Required native build failed.', 'ERR_NATIVE_SETUP_BUILD', { failures: entries, results: rows });
  assert.equal(failure.cause, compiler, 'an earlier cancelled peer cannot replace the actual failed compiler');
  assert.deepEqual(failure.errors, [compiler, null, cancelled]);
  assert.equal(failure.results[2].status, 'blocked'); assert.equal(failure.failures[3].required, false);
  assert.equal(failure.failures[1].result, rows[1].result);
  const resolved = new Error('earlier repaired problem'), unresolved = new Error('actual terminal repair failure');
  const history = [nativeFailureEntry({ pkgName: 'fixed', result: { ok: false, error: resolved }, phase: 'initial-probe' })];
  const terminal = nativeFailureEntry({ pkgName: 'still-broken', result: { ok: false, error: unresolved }, phase: 'source-rebuild' });
  const repair = createNativeFailureError('Repair failed.', 'ERR_NATIVE_SETUP_REPAIR', { failures: [terminal], history });
  assert.equal(repair.cause, unresolved); assert.deepEqual(repair.errors, [unresolved]);
  assert.equal(repair.history[0], history[0]); assert.equal(Object.isFrozen(repair.history), true);
} else {
  let retired = false;
  const original = Object.assign(new Error('actual resource is still pending'), {
    cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, original); return retired; }
  });
  const entry = nativeFailureEntry({ pkgName: 'native', result: { ok: false, error: original }, phase: 'repair' });
  const failure = createNativeFailureError('Required native repair failed.', 'ERR_NATIVE_SETUP_REPAIR', { failures: [entry], repairFailures: 1 });
  assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(errorGraphIncludes(failure, original), true);
  original.cacheOwnershipReleased = () => true;
  assert.equal(failure.cacheOwnershipReleased(), false); retired = true;
  assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(failure.repairFailures, 1);
  retired = false;
  assert.equal(failure.cacheOwnershipReleased(), false, 'later original pending state is not replaced by a cached diagnostic');
}
console.log('Native terminal summaries preserve original packets, scheduler roles and resource observations');
