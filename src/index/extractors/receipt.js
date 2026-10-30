import { canonicalSemanticJson } from '../semantic/identity.js';
import { buildDocumentExtractionAdmission } from './admission.js';
import { buildDocumentExtractionFidelity } from './common.js';
import { DOCUMENT_EXTRACTION_RECEIPT_VERSION, DOCUMENT_EXTRACTION_RECEIPT_MAX_BYTES,
  DOCUMENT_EXTRACTION_RECEIPT_MAX_UNITS } from '../../contracts/document-extraction.js';
import { DOCUMENT_EXTRACTION_RECEIPT_SCHEMA } from '../../contracts/schemas/document-extraction.js';
import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';

const validate = compileSchema(createAjv({ strict: true, allErrors: false }), DOCUMENT_EXTRACTION_RECEIPT_SCHEMA, { lazy: true });
const encode = value => canonicalSemanticJson(value, { maxBytes: DOCUMENT_EXTRACTION_RECEIPT_MAX_BYTES });
const same = (left, right) => encode(left) === encode(right);
const invalid = () => Object.assign(new Error('Document extraction receipt does not match its admitted source/policy.'),
  { code: 'ERR_DOCUMENT_EXTRACTION_RECEIPT' });

/** Capture one bounded passive receipt. The enclosing immutable bundle binds
 * this source hash/size and all metadata bytes to its manifest checksum. */
export const createDocumentExtractionReceipt = ({ extraction, sourceHash, sourceSize }) => {
  if (!extraction) return null;
  const owned = JSON.parse(encode({ schemaVersion: DOCUMENT_EXTRACTION_RECEIPT_VERSION,
    sourceHash, sourceSize, extraction }));
  if (Array.isArray(owned.extraction.warnings)) owned.extraction.warnings = owned.extraction.warnings
    .filter(warning => warning !== 'document-extraction-cache-hit');
  if (!admitDocumentExtractionReceipt({ receipt: owned, sourceHash, sourceSize })) throw invalid();
  return owned;
};

/** Return owned metadata only after shape, source identity, unit extents,
 * producer/policy and coverage agree. Legacy/malformed inputs request refresh. */
export const admitDocumentExtractionReceipt = ({ receipt, sourceHash, sourceSize, admission = null }) => {
  if (!receipt) return null;
  let owned;
  try { owned = JSON.parse(encode(receipt)); }
  catch (error) { observeStorageResource(error, { phase: 'document-extraction-receipt-admission' }).requireSettled(); return null; }
  if (!validate(owned) || owned.sourceHash !== sourceHash || owned.sourceSize !== sourceSize) return null;
  const extraction = owned.extraction, identity = extraction.admission;
  if (!same(identity, buildDocumentExtractionAdmission({ sourceType: extraction.sourceType,
    policy: extraction.policy, extractor: extraction.extractor })) || admission && !same(identity, admission)
    || extraction.normalizationPolicy !== identity.normalizationPolicy) return null;
  const units = extraction.units;
  if (units.length > DOCUMENT_EXTRACTION_RECEIPT_MAX_UNITS || extraction.counts.totalUnits !== units.length) return null;
  let end = -1, ordinal = 0;
  for (const unit of units) {
    const number = extraction.sourceType === 'pdf' ? unit.pageNumber : unit.index;
    if (unit.type !== extraction.sourceType || !Number.isSafeInteger(number) || number <= ordinal
      || unit.start < end || unit.end <= unit.start) return null;
    if (extraction.sourceType === 'pdf' && number > extraction.counts.pages) return null;
    ordinal = number; end = unit.end;
  }
  const coverage = extraction.fidelity.pageCoverage;
  if (extraction.sourceType === 'pdf' && (!coverage || coverage.totalPages !== extraction.counts.pages
    || !coverage.complete || coverage.attemptedPages !== coverage.totalPages || coverage.completedPages !== coverage.totalPages
    || coverage.textPages !== units.length || coverage.noTextPages + coverage.textPages !== coverage.totalPages
    || coverage.failedPages || coverage.inFlightPages || coverage.notAttemptedPages)) return null;
  if (coverage) {
    if (coverage.textCoverage !== (coverage.noTextPages ? 'pages-without-observed-text' : 'all-pages-have-text')) return null;
    let represented = 0, observedText = 0, observedNoText = 0, unitIndex = 0;
    for (const range of coverage.ranges) {
      if (range.pageStart !== represented + 1 || range.pageEnd < range.pageStart
        || range.pageEnd > coverage.totalPages || !['text-extracted', 'no-text-observed'].includes(range.state)) return null;
      const length = range.pageEnd - range.pageStart + 1;
      let extracted = 0;
      while (unitIndex < units.length && units[unitIndex].pageNumber <= range.pageEnd) { extracted++; unitIndex++; }
      if (extracted !== (range.state === 'text-extracted' ? length : 0)) return null;
      if (range.state === 'text-extracted') observedText += length; else observedNoText += length;
      represented = range.pageEnd;
    }
    const omitted = coverage.totalPages - represented;
    if (coverage.omittedPageDetails !== omitted || coverage.omissionReason !== (omitted ? 'page-detail-budget' : null)
      || omitted && coverage.ranges.length !== 256 || observedText > coverage.textPages || observedNoText > coverage.noTextPages) return null;
  }
  const fidelity = buildDocumentExtractionFidelity({ sourceType: extraction.sourceType, policy: extraction.policy,
    warnings: extraction.warnings, pageCoverage: coverage || null });
  if (!same(fidelity, extraction.fidelity)) return null;
  return extraction;
};
