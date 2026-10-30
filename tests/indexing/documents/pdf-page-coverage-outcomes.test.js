import assert from 'node:assert/strict';
import { readPdfPages } from '../../../src/index/extractors/pdf.js';
import { createPdfPageCoverage, getPdfPageCoverage } from '../../../src/index/extractors/pdf-page-coverage.js';
import { buildDocumentExtractionFidelity } from '../../../src/index/extractors/common.js';
import { PDF_PAGE_COVERAGE_SCHEMA } from '../../../src/contracts/schemas/document-extraction.js';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';
import { getPendingPdfExtractionOwners, isPendingPdfExtractionFailure } from '../../../src/index/extractors/pdf-lifetime.js';

const validate = compileSchema(createAjv({ strict: true, allErrors: true }), PDF_PAGE_COVERAGE_SCHEMA);
const source = Buffer.from('controlled PDF provider input'), policy = { maxPages: 10, extractTimeoutMs: 100 };
const baseline = new Set(getPendingPdfExtractionOwners());
const contains = (root, expected) => {
  const queue = [root], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); if (value === expected) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); queue.push(value.cause, ...(value.errors || []));
  }
  return false;
};
const rejected = async action => { let failed = false, error; try { await action; } catch (value) { failed = true; error = value; } assert.ok(failed); return error; };
let releasePage;
try {
  let cleanup = 0, destroy = 0;
  const provider = texts => ({ getDocument: () => ({ destroy() { destroy++; }, promise: Promise.resolve({
    numPages: texts.length, destroy() { destroy++; }, async getPage(pageNumber) { return {
      async getTextContent() { return { items: texts[pageNumber - 1] ? [{ str: texts[pageNumber - 1] }] : [] }; },
      cleanup() { cleanup++; }
    }; }
  }) }) });
  const pages = await readPdfPages({ pdfjs: provider(['first', '', 'third']), source, policy });
  const coverage = getPdfPageCoverage(pages);
  assert.ok(validate(coverage), JSON.stringify(validate.errors));
  assert.deepEqual(pages.map(row => row.pageNumber), [1, 2, 3]); assert.equal(coverage.totalPages, 3);
  assert.equal(coverage.completedPages, 3); assert.equal(coverage.textPages, 2); assert.equal(coverage.noTextPages, 1);
  assert.equal(coverage.complete, true); assert.equal(coverage.textCoverage, 'pages-without-observed-text');
  assert.equal(coverage.ocr, 'not-performed'); assert.equal(cleanup, 3); assert.equal(destroy, 2);
  assert.deepEqual(coverage.ranges.map(row => row.state), ['text-extracted', 'no-text-observed', 'text-extracted']);
  for (const fidelityMode of ['permissive', 'quality-sensitive']) {
    const fidelity = buildDocumentExtractionFidelity({ sourceType: 'pdf', pageCoverage: coverage, policy: { fidelityMode } });
    assert.equal(fidelity.status, 'ok'); assert.equal(fidelity.state, 'coverage_gap');
    assert.equal(fidelity.policyViolation, fidelityMode === 'quality-sensitive');
  }
  const complete = getPdfPageCoverage(await readPdfPages({ pdfjs: provider(['first', 'second']), source, policy }));
  assert.equal(buildDocumentExtractionFidelity({ sourceType: 'pdf', pageCoverage: complete }).state, 'complete');
  assert.equal(buildDocumentExtractionFidelity({ sourceType: 'pdf' }).state, 'coverage_gap', 'missing observations cannot imply complete coverage');
  const capped = await rejected(readPdfPages({ pdfjs: provider(['one', '', 'three']), source, policy: { ...policy, maxPages: 2 } }));
  assert.equal(capped.code, 'ERR_PDF_PAGE_LIMIT'); assert.equal(capped.pdfPageCoverage.totalPages, 3);
  assert.equal(capped.pdfPageCoverage.attemptedPages, 0); assert.equal(capped.pdfPageCoverage.notAttemptedPages, 3);

  const original = Object.freeze(Object.assign(new Error('controlled page failure'), { code: 'EIO' }));
  const failed = await rejected(readPdfPages({ source, policy, pdfjs: { getDocument: () => ({ destroy() {}, promise: Promise.resolve({
    numPages: 3, destroy() {}, async getPage(page) {
      if (page === 2) throw original;
      return { async getTextContent() { return { items: [{ str: 'one' }] }; }, cleanup() {} };
    }
  }) }) } }));
  assert.ok(contains(failed, original)); assert.equal(failed.pdfPageCoverage.attemptedPages, 2);
  assert.equal(failed.pdfPageCoverage.completedPages, 1); assert.equal(failed.pdfPageCoverage.failedPages, 1);
  assert.equal(failed.pdfPageCoverage.notAttemptedPages, 1); assert.equal(failed.pdfPageCoverage.complete, false);
  let closes = 0;
  const timed = await rejected(readPdfPages({ source, policy: { ...policy, extractTimeoutMs: 10 }, pdfjs: {
    getDocument: () => ({ destroy() {}, promise: Promise.resolve({ numPages: 2, destroy() {},
      getPage: () => new Promise(resolve => { releasePage = resolve; }) }) })
  } }));
  assert.ok(isPendingPdfExtractionFailure(timed)); assert.equal(timed.pdfPageCoverage.inFlightPages, 1);
  assert.equal(timed.pdfPageCoverage.completedPages, 0); assert.equal(timed.pdfPageCoverage.notAttemptedPages, 1);
  releasePage({ cleanup() { closes++; }, getTextContent() { throw new Error('aborted page must not read text'); } });
  await new Promise(resolve => setImmediate(resolve));
  await timed.pdfExtractionSession.releaseAfterClose(); assert.equal(closes, 1);
  assert.equal(timed.pdfPageCoverage.inFlightPages, 1, 'failure receipt preserves the original observed boundary after close-only recovery');

  const ledger = createPdfPageCoverage(); ledger.observeTotal(1000);
  for (let page = 1; page <= 1000; page++) { ledger.start(page); ledger.complete(page, page % 2 ? 'text' : ''); }
  const bounded = ledger.snapshot(); assert.equal(bounded.ranges.length, 256);
  assert.equal(bounded.textPages, 500); assert.equal(bounded.noTextPages, 500);
  assert.equal(bounded.omittedPageDetails, 744); assert.equal(bounded.omissionReason, 'page-detail-budget');
  assert.ok(validate(bounded)); assert.ok(Object.isFrozen(bounded.ranges[0]));
  assert.equal(validate({ ...bounded, inventedPageClassification: 'blank' }), false, 'coverage schema stays closed');
} finally {
  releasePage?.({ cleanup() {} });
  for (const owner of getPendingPdfExtractionOwners()) if (!baseline.has(owner)) await owner.releaseAfterClose();
}
console.log('PDF page observations distinguish text, uncertainty, failure and unattempted work');
