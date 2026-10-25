import { PDF_PAGE_COVERAGE_SCHEMA_VERSION, PDF_PAGE_COVERAGE_DETAIL_LIMIT, PDF_PAGE_COVERAGE_STATES,
  DOCUMENT_EXTRACTION_RECEIPT_VERSION, DOCUMENT_EXTRACTION_RECEIPT_MAX_UNITS, DOCUMENT_EXTRACTION_FIDELITY_SCHEMA_VERSION } from '../document-extraction.js';

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

const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const text = { type: 'string', maxLength: 65536 };
const nullableText = { ...text, type: ['string', 'null'] };
const sourceType = { enum: ['pdf', 'docx'] };
const extractor = object({ name: nullableText, version: nullableText, target: nullableText });
const policy = object({ maxBytesPerFile: { ...count, minimum: 1 }, maxPages: { ...count, minimum: 1 },
  extractTimeoutMs: { ...count, minimum: 1 }, fidelityMode: { enum: ['permissive', 'quality-sensitive'] },
  qualitySensitive: { type: 'boolean' } });
const admission = object({ schemaVersion: { const: DOCUMENT_EXTRACTION_RECEIPT_VERSION }, sourceType,
  producerVersion: { ...count, minimum: 1 }, normalizationPolicy: text, chunkerVersion: text, policy, extractor });
const fidelity = object({ schemaVersion: { const: DOCUMENT_EXTRACTION_FIDELITY_SCHEMA_VERSION }, sourceType, state: { enum: ['complete', 'coverage_gap'] },
  status: { const: 'ok' }, reasonCode: nullableText, policyMode: { enum: ['permissive', 'quality-sensitive'] },
  qualitySensitive: { type: 'boolean' }, policyViolation: { type: 'boolean' }, warningCount: count,
  pageCoverage: PDF_PAGE_COVERAGE_SCHEMA }, ['schemaVersion', 'sourceType', 'state', 'status', 'reasonCode',
  'policyMode', 'qualitySensitive', 'policyViolation', 'warningCount']);
export const DOCUMENT_EXTRACTION_RECEIPT_SCHEMA = object({
  schemaVersion: { const: DOCUMENT_EXTRACTION_RECEIPT_VERSION },
  sourceHash: { type: 'string', pattern: '^[a-f0-9]{40}$' }, sourceSize: count,
  extraction: object({ sourceType, status: { const: 'ok' }, extractor,
    sourceBytesHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, sourceBytesHashAlgo: { const: 'sha256' },
    counts: object({ pages: count, paragraphs: count, totalUnits: count }),
    units: { type: 'array', maxItems: DOCUMENT_EXTRACTION_RECEIPT_MAX_UNITS, items: object({ type: sourceType,
      start: count, end: count, pageNumber: { ...count, minimum: 1 }, index: { ...count, minimum: 1 }, style: nullableText
    }, ['type', 'start', 'end']) }, normalizationPolicy: text,
    warnings: { type: 'array', maxItems: 100000, items: text }, policy, fidelity, admission })
});
