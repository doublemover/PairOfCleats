import { PDF_PAGE_COVERAGE_SCHEMA_VERSION, PDF_PAGE_COVERAGE_DETAIL_LIMIT, PDF_PAGE_COVERAGE_STATES } from '../document-extraction.js';

const count = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
export const PDF_PAGE_COVERAGE_SCHEMA = {
  type: ['object', 'null'],
  required: ['schemaVersion', 'basis', 'totalPages', 'attemptedPages', 'completedPages', 'textPages', 'noTextPages',
    'failedPages', 'inFlightPages', 'notAttemptedPages', 'complete', 'textCoverage', 'ocr', 'ranges', 'omittedPageDetails', 'omissionReason'],
  properties: {
    schemaVersion: { type: 'integer', const: PDF_PAGE_COVERAGE_SCHEMA_VERSION }, basis: { const: 'pdfjs-text-content' },
    totalPages: { ...count, type: ['integer', 'null'] }, attemptedPages: count, completedPages: count, textPages: count,
    noTextPages: count, failedPages: count, inFlightPages: { type: 'integer', minimum: 0, maximum: 1 },
    notAttemptedPages: { ...count, type: ['integer', 'null'] }, complete: { type: 'boolean' },
    textCoverage: { enum: ['unknown', 'no-pages', 'pages-without-observed-text', 'all-pages-have-text'] },
    ocr: { const: 'not-performed' }, ranges: { type: 'array', maxItems: PDF_PAGE_COVERAGE_DETAIL_LIMIT, items: {
      type: 'object', required: ['pageStart', 'pageEnd', 'state'], properties: {
        pageStart: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        pageEnd: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, state: { enum: PDF_PAGE_COVERAGE_STATES }
      }, additionalProperties: false
    } }, omittedPageDetails: count, omissionReason: { enum: ['page-detail-budget', null] }
  }, additionalProperties: false
};
