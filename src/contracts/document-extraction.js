export const PDF_PAGE_COVERAGE_SCHEMA_VERSION = 1;
export const DOCUMENT_EXTRACTION_FIDELITY_SCHEMA_VERSION = 2;
export const DOCUMENT_EXTRACTION_RECEIPT_VERSION = 1;
export const DOCUMENT_EXTRACTION_RECEIPT_MAX_BYTES = 16 * 1024 * 1024;
export const DOCUMENT_EXTRACTION_RECEIPT_MAX_UNITS = 100000;
export const PDF_PAGE_COVERAGE_DETAIL_LIMIT = 256;
export const PDF_PAGE_COVERAGE_STATES = Object.freeze([
  'text-extracted', 'no-text-observed', 'failed', 'in-flight', 'not-attempted'
]);
