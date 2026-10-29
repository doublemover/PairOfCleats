import { buildDocumentExtractionPolicySummary, resolveDocumentExtractionProducerVersion,
  resolveExtractionNormalizationPolicy } from './common.js';
import { DOCUMENT_EXTRACTION_RECEIPT_VERSION } from '../../contracts/document-extraction.js';
import { DOCUMENT_CHUNKER_VERSION } from '../chunking/formats/document-common.js';
import { getDocumentExtractorTestConfig } from '../../shared/env/testing.js';

/** Identity resolution performs no extraction. Actual provider selection is
 * shared by mode reuse and per-file bundle admission, including fixture routes. */
export const resolveDocumentExtractorIdentity = async sourceType => {
  const fixture = getDocumentExtractorTestConfig();
  if (fixture.testing && (sourceType === 'pdf' ? fixture.stubPdfExtract : fixture.stubDocxExtract)) {
    return { name: `${sourceType}-test-stub`, version: 'test', target: 'stub' };
  }
  const runtime = sourceType === 'pdf'
    ? await (await import('./pdf.js')).loadPdfExtractorRuntime()
    : await (await import('./docx.js')).loadDocxExtractorRuntime();
  return { name: runtime.name || (sourceType === 'pdf' ? 'pdfjs-dist' : 'docx-xml'),
    version: runtime.version || null, target: runtime.target || null };
};

export const buildDocumentExtractionAdmission = ({ sourceType, policy, extractor }) => ({
  schemaVersion: DOCUMENT_EXTRACTION_RECEIPT_VERSION, sourceType,
  producerVersion: resolveDocumentExtractionProducerVersion(sourceType),
  normalizationPolicy: resolveExtractionNormalizationPolicy(sourceType), chunkerVersion: DOCUMENT_CHUNKER_VERSION,
  policy: buildDocumentExtractionPolicySummary(policy),
  extractor: { name: extractor?.name || null, version: extractor?.version || null, target: extractor?.target || null }
});

export const prepareDocumentExtractionAdmission = async (runtime, mode) => {
  if (mode !== 'extracted-prose') return;
  const policy = runtime.indexingConfig?.documentExtraction;
  runtime.documentExtractionAdmission = policy?.enabled === true ? {
    enabled: true,
    pdf: buildDocumentExtractionAdmission({ sourceType: 'pdf', policy, extractor: await resolveDocumentExtractorIdentity('pdf') }),
    docx: buildDocumentExtractionAdmission({ sourceType: 'docx', policy, extractor: await resolveDocumentExtractorIdentity('docx') })
  } : { enabled: false };
};
