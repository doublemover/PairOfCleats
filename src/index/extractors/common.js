import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createTimeoutError, runWithTimeout } from '../../shared/promise-timeout.js';
import { PDF_PAGE_COVERAGE_SCHEMA_VERSION } from '../../contracts/document-extraction.js';

const require = createRequire(import.meta.url);

export const DOCUMENT_EXTRACTION_REASON_CODES = Object.freeze([
  'unsupported_encrypted',
  'unsupported_scanned',
  'no_text_observed',
  'oversize',
  'extract_timeout',
  'missing_dependency',
  'extract_failed'
]);

export const DOCUMENT_EXTRACTION_FIDELITY_SCHEMA_VERSION = 2;
// Structural DOCX paragraph meaning changes invalidate extraction and bundle reuse.
export const DOCX_STRUCTURAL_EXTRACTION_VERSION = 3;
export const PDF_TEXT_EXTRACTION_VERSION = 2;
export const DOCUMENT_EXTRACTION_POLICY_MODES = Object.freeze([
  'permissive',
  'quality-sensitive'
]);

const REASON_CODE_SET = new Set(DOCUMENT_EXTRACTION_REASON_CODES);
const POLICY_MODE_SET = new Set(DOCUMENT_EXTRACTION_POLICY_MODES);

export const DEFAULT_DOCUMENT_EXTRACTION_POLICY = Object.freeze({
  maxBytesPerFile: 64 * 1024 * 1024,
  maxPages: 5000,
  extractTimeoutMs: 15000,
  fidelityMode: 'permissive'
});

export const EXTRACTION_NORMALIZATION_POLICY = 'v1';

// Persist the format-specific source transformation beside the package version.
// XML structure changes affect DOCX provenance without invalidating PDF meaning.
export const resolveExtractionNormalizationPolicy = sourceType => sourceType === 'docx'
  ? `${EXTRACTION_NORMALIZATION_POLICY}:docx-xml:${DOCX_STRUCTURAL_EXTRACTION_VERSION}`
  : sourceType === 'pdf' ? `${EXTRACTION_NORMALIZATION_POLICY}:pdf-text:${PDF_TEXT_EXTRACTION_VERSION}`
    : EXTRACTION_NORMALIZATION_POLICY;
export const resolveDocumentExtractionProducerVersion = sourceType => sourceType === 'docx'
  ? DOCX_STRUCTURAL_EXTRACTION_VERSION : sourceType === 'pdf' ? PDF_TEXT_EXTRACTION_VERSION : null;

const normalizePositiveInt = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
};

export const normalizeDocumentExtractionPolicy = (input = null) => {
  const raw = input && typeof input === 'object' ? input : {};
  const fidelityMode = (() => {
    if (typeof raw.fidelityMode === 'string' && POLICY_MODE_SET.has(raw.fidelityMode)) {
      return raw.fidelityMode;
    }
    if (raw.qualitySensitive === true) return 'quality-sensitive';
    return DEFAULT_DOCUMENT_EXTRACTION_POLICY.fidelityMode;
  })();
  return {
    maxBytesPerFile: normalizePositiveInt(
      raw.maxBytesPerFile,
      DEFAULT_DOCUMENT_EXTRACTION_POLICY.maxBytesPerFile
    ),
    maxPages: normalizePositiveInt(
      raw.maxPages,
      DEFAULT_DOCUMENT_EXTRACTION_POLICY.maxPages
    ),
    extractTimeoutMs: normalizePositiveInt(
      raw.extractTimeoutMs,
      DEFAULT_DOCUMENT_EXTRACTION_POLICY.extractTimeoutMs
    ),
    fidelityMode
  };
};

export const normalizeExtractedText = (value) => {
  if (value == null) return '';
  let text = String(value);
  text = text.replace(/\r\n?/g, '\n');
  text = text.replace(/\u00a0/g, ' ');
  text = text.replace(/[ \t\f\v]+/g, ' ');
  text = text.replace(/ *\n */g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
};

export const normalizeWarning = (entry) => {
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object') {
    const message = entry.message || entry.reason || entry.type || null;
    return message ? String(message) : null;
  }
  return String(entry);
};

export const normalizeWarnings = (entries) => (
  Array.isArray(entries)
    ? entries.map((entry) => normalizeWarning(entry)).filter(Boolean)
    : []
);

export const resolveFailureReason = (reason, fallback = 'extract_failed') => (
  REASON_CODE_SET.has(reason) ? reason : fallback
);

export const buildDocumentExtractionPolicySummary = (policy = null) => {
  const normalized = normalizeDocumentExtractionPolicy(policy);
  return {
    maxBytesPerFile: normalized.maxBytesPerFile,
    maxPages: normalized.maxPages,
    extractTimeoutMs: normalized.extractTimeoutMs,
    fidelityMode: normalized.fidelityMode,
    qualitySensitive: normalized.fidelityMode === 'quality-sensitive'
  };
};

export const buildDocumentExtractionFidelity = ({
  sourceType = null,
  status = 'ok',
  reason = null,
  warnings = [],
  policy = null,
  pageCoverage = null
} = {}) => {
  const policySummary = buildDocumentExtractionPolicySummary(policy);
  const warningList = normalizeWarnings(warnings);
  const normalizedStatus = status === 'ok' ? 'ok' : 'skipped';
  const qualifiedPageText = pageCoverage?.schemaVersion === PDF_PAGE_COVERAGE_SCHEMA_VERSION
    && Number.isSafeInteger(pageCoverage.totalPages) && pageCoverage.totalPages > 0
    && ['attemptedPages', 'completedPages', 'textPages'].every(key => pageCoverage[key] === pageCoverage.totalPages)
    && ['noTextPages', 'failedPages', 'inFlightPages', 'notAttemptedPages'].every(key => pageCoverage[key] === 0)
    && pageCoverage.complete === true && pageCoverage.textCoverage === 'all-pages-have-text';
  const pageGap = sourceType === 'pdf' && !qualifiedPageText;
  const normalizedReason = normalizedStatus === 'ok'
    ? pageGap ? pageCoverage ? 'pdf_page_text_coverage_unknown' : 'pdf_page_coverage_unrecorded' : null
    : resolveFailureReason(reason);
  return {
    schemaVersion: DOCUMENT_EXTRACTION_FIDELITY_SCHEMA_VERSION,
    sourceType: sourceType === 'docx' ? 'docx' : 'pdf',
    state: normalizedStatus === 'ok' && !pageGap ? 'complete' : 'coverage_gap',
    status: normalizedStatus,
    reasonCode: normalizedReason,
    policyMode: policySummary.fidelityMode,
    qualitySensitive: policySummary.qualitySensitive,
    policyViolation: policySummary.qualitySensitive && (normalizedStatus !== 'ok' || pageGap),
    warningCount: warningList.length,
    ...(sourceType === 'pdf' ? { pageCoverage } : {})
  };
};

export const withTimeout = async (operation, timeoutMs) => {
  const timeout = normalizePositiveInt(timeoutMs, DEFAULT_DOCUMENT_EXTRACTION_POLICY.extractTimeoutMs);
  return runWithTimeout(operation, {
    timeoutMs: timeout,
    errorFactory: () => createTimeoutError({
      message: 'Document extraction timed out',
      code: 'EXTRACT_TIMEOUT'
    })
  });
};

export const sha256Hex = (buffer) => createHash('sha256').update(buffer).digest('hex');

export const resolvePackageVersion = (name) => {
  try {
    const pkg = require(`${name}/package.json`);
    if (pkg && typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim();
  } catch {}
  return null;
};

export const buildFailedResult = (reason, warnings = [], options = {}) => ({
  ok: false,
  reason: resolveFailureReason(reason),
  warnings: normalizeWarnings(warnings),
  fidelity: buildDocumentExtractionFidelity({
    sourceType: options?.sourceType || null,
    status: 'skipped',
    reason,
    warnings,
    policy: options?.policy || null,
    pageCoverage: options?.pageCoverage || null
  })
});

