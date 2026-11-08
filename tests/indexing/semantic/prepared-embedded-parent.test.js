import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { withPreparedEmbeddedParent, readPreparedEmbeddedParent } from '../../../src/index/semantic/embedded-parent.js';
import { semanticPreparedSourceAdmissionFor } from '../../../src/index/semantic/planning.js';
import { runWithSchedulerTaskLease } from '../../../src/shared/concurrency/scheduler-task-scope.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/prepared-embedded-parent/')[1];
assert.ok(['owned-snapshot', 'source-identity', 'bounds-and-decode', 'failure-lifetime', 'cancelled-admission', 'failed-reacquisition'].includes(mode));
const text = '\uFEFF<script>const value = "é😀";\r\n</script>', bytes = Buffer.from(text);
const parentFacts = { sourceHash: createHash('sha256').update(bytes).digest('hex'), sourceUnitId: 'su1:' + '1'.repeat(64), repositoryNamespace: 'fixture' };
const account = {}, admission = semanticPreparedSourceAdmissionFor(account), metrics = {};
const options = { parentFacts, parentBytes: bytes, diskAccount: account, metrics };
const rejected = async operation => {
  let failed = false, failure;
  try { await operation(); } catch (error) { failed = true; failure = error; }
  assert.equal(failed, true); return failure;
};
if (mode === 'owned-snapshot') {
  let original;
  await withPreparedEmbeddedParent(options, async token => {
    original = token; bytes.fill(0);
    assert.equal(admission.used, Buffer.byteLength(text) * 3);
    for (let index = 0; index < 16; index++) assert.equal(readPreparedEmbeddedParent(token, parentFacts).text, text);
    assert.throws(() => readPreparedEmbeddedParent({ ...token }, parentFacts), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
    assert.equal(metrics.parentHashes, 1); assert.equal(metrics.parentDecodes, 1);
    assert.equal(metrics.parentBytesHashed, Buffer.byteLength(text));
    assert.ok(metrics.peakPreparedParentBytes <= metrics.peakPreparedParentAllowance);
  });
  assert.equal(admission.used, 0);
  assert.throws(() => readPreparedEmbeddedParent(original, parentFacts), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
  await assert.rejects(withPreparedEmbeddedParent(options, () => assert.fail('mutated original cannot be readmitted')), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
} else if (mode === 'source-identity') {
  await withPreparedEmbeddedParent(options, async token => {
    for (const changed of [{ sourceHash: '0'.repeat(64) }, { sourceUnitId: 'su1:' + '2'.repeat(64) }, { repositoryNamespace: 'other' }]) {
      assert.throws(() => readPreparedEmbeddedParent(token, { ...parentFacts, ...changed }), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
    }
  });
} else if (mode === 'bounds-and-decode') {
  let reads = 0;
  await assert.rejects(withPreparedEmbeddedParent({ ...options, parentBytes: null, parentByteLength: 64 * 1024 * 1024 + 1,
    loadBytes: async () => { reads++; throw new Error('must not read'); } }, () => assert.fail()), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
  assert.equal(reads, 0); assert.equal(admission.used, 0);
  const invalid = Buffer.from([0xff]);
  await assert.rejects(withPreparedEmbeddedParent({ ...options, parentBytes: invalid,
    parentFacts: { ...parentFacts, sourceHash: createHash('sha256').update(invalid).digest('hex') } }, () => assert.fail()), TypeError);
  assert.equal(admission.used, 0);
} else if (mode === 'failure-lifetime') {
  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen failure'))]) {
    let held;
    const failure = await rejected(() => withPreparedEmbeddedParent(options, token => { held = token; throw primary; }));
    assert.equal(failure, primary); assert.equal(admission.used, 0);
    assert.throws(() => readPreparedEmbeddedParent(held, parentFacts), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
  }
} else if (mode === 'cancelled-admission') {
  const release = await admission.acquire(256 * 1024 * 1024), controller = new AbortController();
  try {
    const waiting = assert.rejects(withPreparedEmbeddedParent({ ...options, signal: controller.signal }, () => assert.fail('cancelled source cannot prepare')), /abort/i);
    controller.abort(); await waiting; assert.equal(admission.pending, 0);
    assert.equal(admission.used, 256 * 1024 * 1024, 'cancellation cannot release another source allowance');
  } finally { release(); }
  assert.equal(admission.used, 0);
} else {
  for (const primary of [undefined, null, 0, Object.freeze(new Error('failed compute reacquisition'))]) {
    let nativeAcquire;
    const failure = await rejected(() => runWithSchedulerTaskLease({ suspendCpu: operation => {
      nativeAcquire = operation(); return Promise.reject(primary);
    } }, () => withPreparedEmbeddedParent(options, () => assert.fail('failed reacquisition cannot begin preparation'))));
    await nativeAcquire;
    assert.equal(failure, primary); assert.equal(admission.used, 0, 'the actual fulfilled original allowance is joined and returned');
  }
}
