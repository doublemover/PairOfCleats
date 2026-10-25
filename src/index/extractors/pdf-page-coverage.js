import { PDF_PAGE_COVERAGE_SCHEMA_VERSION, PDF_PAGE_COVERAGE_DETAIL_LIMIT } from '../../contracts/document-extraction.js';

const admittedPages = new WeakMap();
const fail = () => Object.assign(new Error('Invalid PDF page observation order/count.'), { code: 'ERR_PDF_PAGE_COVERAGE' });

/** One sequential extraction's bounded observations, separate from resource
 * settlement and from unsupported visual/OCR completeness. No blank inference. */
export const createPdfPageCoverage = () => {
  let total = null, attempted = 0, completed = 0, text = 0, noText = 0, failed = 0, current = null;
  const ranges = [];
  const append = (target, pageStart, pageEnd, state) => {
    const last = target.at(-1);
    if (last?.state === state && last.pageEnd + 1 === pageStart) last.pageEnd = pageEnd;
    else if (target.length < PDF_PAGE_COVERAGE_DETAIL_LIMIT) target.push({ pageStart, pageEnd, state });
  };
  const finish = (page, state) => {
    if (current !== page) throw fail();
    append(ranges, page, page, state); current = null;
    if (state === 'failed') failed++;
    else { completed++; if (state === 'text-extracted') text++; else noText++; }
  };
  return Object.freeze({
    observeTotal(value) {
      if (total !== null || !Number.isSafeInteger(value) || value < 0) throw fail();
      total = value;
    },
    start(page) {
      if (total === null || current !== null || page !== attempted + 1 || page > total) throw fail();
      current = page; attempted++;
    },
    complete(page, pageText) { finish(page, pageText ? 'text-extracted' : 'no-text-observed'); },
    failCurrent() { if (current !== null) finish(current, 'failed'); },
    snapshot() {
      const detail = ranges.map(row => ({ ...row }));
      if (current !== null) append(detail, current, current, 'in-flight');
      if (total !== null && attempted < total) append(detail, attempted + 1, total, 'not-attempted');
      const represented = detail.reduce((sum, row) => sum + row.pageEnd - row.pageStart + 1, 0);
      const complete = total !== null && completed === total && !failed && current === null;
      return Object.freeze({ schemaVersion: PDF_PAGE_COVERAGE_SCHEMA_VERSION, basis: 'pdfjs-text-content',
        totalPages: total, attemptedPages: attempted, completedPages: completed, textPages: text,
        noTextPages: noText, failedPages: failed, inFlightPages: current === null ? 0 : 1,
        notAttemptedPages: total === null ? null : total - attempted, complete,
        textCoverage: !complete ? 'unknown' : total === 0 ? 'no-pages' : noText ? 'pages-without-observed-text' : 'all-pages-have-text',
        ocr: 'not-performed', ranges: Object.freeze(detail.map(Object.freeze)),
        omittedPageDetails: Math.max(0, (total ?? attempted) - represented),
        omissionReason: (total ?? attempted) > represented ? 'page-detail-budget' : null });
    }
  });
};

export const admitPdfPageCoverage = (pages, coverage) => { admittedPages.set(pages, coverage); return pages; };
export const getPdfPageCoverage = pages => admittedPages.get(pages) || null;
export const pdfPageCoverageWarning = coverage => coverage?.noTextPages
  ? `PDF text coverage is unknown for ${coverage.noTextPages}/${coverage.totalPages} observed page(s); no OCR was performed.` : null;
