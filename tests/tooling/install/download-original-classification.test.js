import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { downloadToBuffer, isInstallDownloadSession } from '../../../tools/tooling/install-shared.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/download-original-classification/')[1];
assert.ok(['original-before-classification', 'function-before-classification', 'independent-inspection-stops-fields',
  'callback-inspection-remains-required', 'closed-positive-and-negative'].includes(mode));
const input = { url: 'https://fixture.invalid/original-download', label: 'explicit inert download', timeoutMs: 1000, maxBytes: 64 };
if (mode === 'closed-positive-and-negative') {
  const body = Buffer.from('explicit bounded response bytes');
  const result = await downloadToBuffer({ ...input, fetchImpl: async () => new Response(body, { status: 200 }) });
  assert.deepEqual(result.body, body); assert.equal(result.body.byteLength, body.length);
  assert.equal(result.sha256, createHash('sha256').update(body).digest('hex')); assert.equal(result.sourceUrl, input.url);
  await assert.rejects(downloadToBuffer({ ...input, fetchImpl: async () => new Response('denied', { status: 403 }) }), error => {
    assert.equal(error.reason, 'download_http_error'); assert.equal(error.statusCode, 403); assert.equal(error.retryable, false);
    assert.equal(Object.hasOwn(error, 'downloadSession'), false); return true;
  });
} else if (mode === 'callback-inspection-remains-required') {
  let phase = 0, independentReady = false;
  const independent = Object.defineProperties(new Error('original callback inspection work'), {
    cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => independentReady, writable: true }
  });
  const original = Object.freeze(Object.defineProperties(new Error('original fetch callback'), {
    cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value() {
      assert.equal(this, original); if (phase === 0) return false; if (phase === 1) throw independent; return true;
    } }
  }));
  let failure;
  try { await downloadToBuffer({ ...input, fetchImpl: async () => { throw original; } }); } catch (error) { failure = error; }
  const session = failure.downloadSession; assert.equal(session.isSettled(), false);
  phase = 1;
  await assert.rejects(session.releaseAfterClosure(), error => {
    assert.ok(error.downloadInspectionErrors.includes(independent)); return true;
  });
  phase = 2; independent.cacheOwnershipReleased = () => true;
  assert.equal(session.isSettled(), false, 'the first original becoming true and replacement callbacks cannot erase the captured independent inspection');
  independentReady = true; assert.equal((await session.releaseAfterClosure()).settled, true);
  assert.equal(failure.cacheOwnershipReleased(), true);
} else {
  let ready = false, reads = 0, laterReads = 0, coercions = 0;
  const independent = Object.freeze(Object.defineProperties(new Error('independent transport diagnostic work'), {
    cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => ready }
  }));
  const original = mode === 'function-before-classification' ? function originalPendingFetch() {} : new Error('original fetch work');
  Object.defineProperties(original, {
    ...(mode !== 'independent-inspection-stops-fields' ? { cacheOwnershipPending: { value: true },
      cacheOwnershipReleased: { value() { assert.equal(this, original); return ready; } } } : {}),
    reason: { get() { reads++; if (mode === 'independent-inspection-stops-fields') throw independent; ready = true; return 'later reason'; } },
    message: { configurable: true, get() { laterReads++; ready = true; return 'later message'; } },
    [Symbol.toPrimitive]: { value: () => { coercions++; return 'coerced original'; } }
  }); Object.freeze(original);
  let failure;
  try { await downloadToBuffer({ ...input, fetchImpl: async () => { throw original; } }); } catch (error) { failure = error; }
  assert.ok(failure); assert.equal(errorGraphIncludes(failure, original), true);
  assert.equal(reads, mode === 'independent-inspection-stops-fields' ? 1 : 0); assert.equal(laterReads, 0); assert.equal(coercions, 0);
  if (mode === 'independent-inspection-stops-fields') assert.equal(failure.downloadInspectionErrors[0], independent);
  const session = failure.downloadSession; assert.equal(isInstallDownloadSession(session), true);
  assert.equal(session.isSettled(), false); assert.equal(failure.cacheOwnershipReleased(), false);
  await assert.rejects(session.releaseAfterClosure()); assert.equal(session.isSettled(), false);
  ready = true;
  const receipt = await session.releaseAfterClosure();
  assert.deepEqual(receipt, { resourceId: session.resourceId, settled: true, pending: false });
  assert.equal(session.isSettled(), true); assert.equal(failure.cacheOwnershipReleased(), true);
  assert.equal(reads, mode === 'independent-inspection-stops-fields' ? 1 : 0); assert.equal(laterReads, 0); assert.equal(coercions, 0);
}
console.log('Actual bounded download owner retains original work before classification and error composition.');
