// Actual PDF extraction/cleanup boundaries with inert resources; UNVALIDATED.
import assert from 'node:assert/strict';
import { readPdfPages } from '../../../src/index/extractors/pdf.js';
import { createPdfExtractionLifetime, getPendingPdfExtractionOwners,
  isPendingPdfExtractionFailure } from '../../../src/index/extractors/pdf-lifetime.js';

const policy = { maxPages: 2, extractTimeoutMs: 5000 }, source = Buffer.from('inert PDF bytes');
const rejected = work => work.then(() => assert.fail('expected exact pending extraction error'), error => error);
const original = Object.freeze(Object.assign(new Error('frozen original page failure'), { code: 'EIO' }));
const documentClose = Object.freeze(new Error('frozen document close failure'));
const loadingClose = Object.freeze(new Error('frozen loading close failure'));
const baseline = new Set(getPendingPdfExtractionOwners());
let allowClose = false, completeDestroy, resolveLate;
try {
  let documentCloses = 0, loadingCloses = 0;
  const doc = { numPages: 1, getPage: async () => { throw original; }, destroy() {
    assert.equal(this, doc); documentCloses++; if (!allowClose) throw documentClose;
  } };
  const loading = { promise: Promise.resolve(doc), destroy() {
    assert.equal(this, loading); loadingCloses++; if (!allowClose) throw loadingClose;
  } };
  const failure = await rejected(readPdfPages({ pdfjs: { getDocument: () => loading }, source, policy }));
  assert.equal(failure.cause, original); assert.equal(failure.code, 'EIO');
  assert.deepEqual(new Set(failure.cleanupErrors), new Set([documentClose, loadingClose]));
  assert.equal(original.cleanupErrors, undefined, 'cleanup cannot mutate or mask a frozen primary');
  assert.equal(isPendingPdfExtractionFailure(failure), true);
  assert.equal(documentCloses, 1); assert.equal(loadingCloses, 1);
  doc.destroy = () => assert.fail('document retry keeps original method');
  loading.destroy = () => assert.fail('loading retry keeps original method');
  allowClose = true;
  const receipt = await failure.pdfExtractionSession.releaseAfterClose();
  assert.deepEqual(receipt, { resourceId: failure.pdfExtractionSession.resourceId, settled: true, pending: false });
  assert.equal(documentCloses, 2); assert.equal(loadingCloses, 2);
  assert.equal(failure.cacheOwnershipReleased(), true);
  assert.equal(isPendingPdfExtractionFailure(failure), false);
  await failure.pdfExtractionSession.releaseAfterClose();
  assert.equal(documentCloses, 2); assert.equal(loadingCloses, 2);

  // Installed PDFDocumentProxy has no destroy method; its loading task owns the
  // transport. Optional absence cannot manufacture an uncloseable document.
  let transportCloses = 0, pageCleanups = 0;
  const withoutDestroy = { numPages: 1, getPage: async () => ({
    getTextContent: async () => ({ items: [{ str: 'retained', hasEOL: true }, { str: 'text' }] }),
    cleanup: () => { pageCleanups++; }
  }) };
  assert.deepEqual(await readPdfPages({ pdfjs: { getDocument: () => ({ promise: Promise.resolve(withoutDestroy),
    destroy: () => { transportCloses++; } }) }, source, policy }), [{ pageNumber: 1, text: 'retained\ntext' }]);
  assert.equal(transportCloses, 1); assert.equal(pageCleanups, 1);

  const cleanup = Object.freeze(new Error('frozen page cleanup failure'));
  const pageFailure = await rejected(readPdfPages({ pdfjs: { getDocument: () => ({
    promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => { throw original; },
      cleanup: () => { throw cleanup; } }) }), destroy() {}
  }) }, source, policy }));
  assert.equal(pageFailure.cause, original); assert.deepEqual(pageFailure.errors, [original, cleanup]);
  assert.equal(pageFailure.cacheOwnershipReleased(), true, 'ordinary failed extraction can finish its resource cleanup');
  assert.equal(isPendingPdfExtractionFailure(pageFailure), false);

  // Preserve the actual destroy flight after the existing two-second bound.
  // The explicit retry joins it, rather than calling native destruction twice.
  const lifetime = createPdfExtractionLifetime();
  let starts = 0;
  lifetime.adopt({ destroy() { starts++; return new Promise(resolve => { completeDestroy = resolve; }); } });
  lifetime.finishOperation();
  const timedOut = await lifetime.dispose();
  assert.equal(timedOut.length, 1); assert.equal(timedOut[0].code, 'ERR_TIMEOUT');
  assert.equal(starts, 1);
  const waiting = lifetime.retain(null, timedOut);
  assert.equal(waiting.cacheOwnershipReleased(), false);
  const joining = waiting.pdfExtractionSession.releaseAfterClose();
  completeDestroy(); await joining;
  assert.equal(starts, 1); assert.equal(waiting.cacheOwnershipReleased(), true);

  // A completed loading-task destroy is not completion of accepted loading
  // work. A late document is retired without requesting pages after abort.
  let earlyCloses = 0, lateCloses = 0;
  const late = await rejected(readPdfPages({ pdfjs: { getDocument: () => ({
    promise: new Promise(resolve => { resolveLate = resolve; }), destroy: () => { earlyCloses++; }
  }) }, source, policy: { ...policy, extractTimeoutMs: 10 } }));
  assert.equal(late.code, 'EXTRACT_TIMEOUT'); assert.equal(late.cacheOwnershipReleased(), false);
  assert.equal(earlyCloses, 1);
  resolveLate({ numPages: 1, getPage: () => assert.fail('aborted extraction cannot admit another page'),
    destroy: () => { lateCloses++; } });
  await new Promise(resolve => setImmediate(resolve));
  await late.pdfExtractionSession.releaseAfterClose();
  assert.equal(earlyCloses, 1); assert.equal(lateCloses, 1); assert.equal(late.cacheOwnershipReleased(), true);

  let childClosed = false;
  const native = new Error('original independent PDF child');
  Object.assign(native, { cacheOwnershipPending: false, cacheOwnershipReleased() {
    assert.equal(this, native); return childClosed;
  } }); Object.freeze(native);
  const pendingChild = await rejected(readPdfPages({ pdfjs: { getDocument: () => ({
    promise: Promise.reject(native), destroy() {}
  }) }, source, policy }));
  await assert.rejects(pendingChild.pdfExtractionSession.releaseAfterClose(), error => isPendingPdfExtractionFailure(error));
  assert.equal(pendingChild.cacheOwnershipReleased(), false);
  childClosed = true; await pendingChild.pdfExtractionSession.releaseAfterClose();
  assert.equal(pendingChild.cacheOwnershipReleased(), true);
} finally {
  allowClose = true; completeDestroy?.(); resolveLate?.({ numPages: 0, destroy() {} });
  for (const owner of getPendingPdfExtractionOwners()) if (!baseline.has(owner)) {
    await owner.releaseAfterClose().catch(() => {});
  }
}
console.log('PDF exact resource and late-work lifetime controls authored; execution deferred.');
