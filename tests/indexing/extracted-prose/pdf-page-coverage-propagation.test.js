import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractPdf, loadPdfExtractorRuntime } from '../../../src/index/extractors/pdf.js';
import { buildPdfExtractionText } from '../../../src/index/build/file-processor/extraction.js';
import { createFileProcessorForTest, createScannedFileEntry } from '../file-processor/file-processor-fixture.js';
import { buildMinimalPdfPagesBuffer } from '../../helpers/document-fixtures.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { buildExtractionReport } from '../../../src/index/build/artifacts/reporting.js';
import { summarizeDocumentExtractionForMode } from '../../../src/index/build/indexer/pipeline/summaries.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';

const { dir } = await prepareIsolatedTestCacheDir('pdf-page-coverage-propagation');
const runtime = await loadPdfExtractorRuntime({ refresh: true }); assert.equal(runtime.ok, true);
const bytes = buildMinimalPdfPagesBuffer([{ text: 'First source page' }, { image: true }, { text: 'Third source page' }]);
const result = await extractPdf({ buffer: bytes }); assert.equal(result.ok, true);
assert.equal(result.fidelity.state, 'coverage_gap'); assert.equal(result.fidelity.pageCoverage.totalPages, 3);
assert.equal(result.fidelity.pageCoverage.noTextPages, 1); assert.equal(result.fidelity.pageCoverage.ocr, 'not-performed');
assert.deepEqual(result.warnings, ['PDF text coverage is unknown for 1/3 observed page(s); no OCR was performed.']);
const joined = buildPdfExtractionText(result.pages);
assert.equal(joined.counts.pages, 3); assert.equal(joined.counts.totalUnits, 2);
assert.deepEqual(joined.units.map(row => row.pageNumber), [1, 3]);
for (const page of [{}, { image: true }]) {
  const noText = await extractPdf({ buffer: buildMinimalPdfPagesBuffer([page]) });
  assert.equal(noText.ok, false); assert.equal(noText.reason, 'no_text_observed');
  assert.equal(noText.fidelity.pageCoverage.noTextPages, 1);
  assert.equal(noText.fidelity.pageCoverage.textCoverage, 'pages-without-observed-text',
    'blank and image-only pages remain unclassified when only text extraction was observed');
}
const allText = await extractPdf({ buffer: buildMinimalPdfPagesBuffer([{ text: 'one' }, { text: 'two' }]) });
assert.equal(allText.fidelity.state, 'complete'); assert.equal(allText.fidelity.pageCoverage.textPages, 2);
const file = path.join(dir, 'mixed.pdf'); await fs.writeFile(file, bytes);
const cache = new Map(), skippedFiles = [];
const processor = createFileProcessorForTest({ root: dir, mode: 'extracted-prose', skippedFiles,
  overrides: { documentExtractionConfig: { enabled: true }, documentExtractionCache: cache } });
const input = createScannedFileEntry({ abs: file, rel: 'mixed.pdf', stat: await fs.stat(file) });
const cold = await processor.processFile(input, 0); assert.ok(cold?.fileInfo?.extraction);
assert.equal(cache.size, 1); const warm = await processor.processFile(input, 0);
assert.deepEqual(warm.fileInfo.extraction.fidelity.pageCoverage, cold.fileInfo.extraction.fidelity.pageCoverage);
assert.ok(warm.fileInfo.extraction.warnings.includes('document-extraction-cache-hit'));
assert.equal(warm.fileInfo.extraction.fidelity.state, 'coverage_gap');
const reportFor = (extraction, fidelityMode) => buildExtractionReport({ root: dir, mode: 'extracted-prose',
  documentExtractionConfig: { enabled: true, fidelityMode },
  state: { fileInfoByPath: new Map([['mixed.pdf', { extraction }]]), skippedFiles: [] } });
const coldReport = reportFor(cold.fileInfo.extraction, 'permissive'), warmReport = reportFor(warm.fileInfo.extraction, 'permissive');
assert.equal(coldReport.coverage.state, 'partial'); assert.equal(coldReport.coverage.coverageLossCount, 1);
assert.equal(coldReport.coverage.qualitySensitiveFailures, 0);
assert.equal(warmReport.files[0].extractionIdentityHash, coldReport.files[0].extractionIdentityHash);
assert.deepEqual(warmReport.files[0].fidelity.pageCoverage, coldReport.files[0].fidelity.pageCoverage);
const strict = reportFor(cold.fileInfo.extraction, 'quality-sensitive');
assert.equal(strict.coverage.qualitySensitiveFailures, 1); assert.equal(strict.files[0].fidelity.policyViolation, true);
const summary = summarizeDocumentExtractionForMode({ fileInfoByPath: new Map([['mixed.pdf', cold.fileInfo]]),
  skippedFiles: [] }, { fidelityMode: 'quality-sensitive' });
assert.deepEqual(summary.coverage, strict.coverage);
assert.deepEqual(summary.files[0].fidelity, strict.files[0].fidelity);
const valid = validateArtifact('extraction_report', strict); assert.ok(valid.ok, JSON.stringify(valid.errors));
const stale = structuredClone(cold.fileInfo.extraction); delete stale.fidelity.pageCoverage;
assert.equal(reportFor(stale, 'quality-sensitive').files[0].fidelity.reasonCode, 'pdf_page_coverage_unrecorded');

const noText = await extractPdf({ buffer: buildMinimalPdfPagesBuffer([{ image: true }]) });
const skippedReport = buildExtractionReport({ root: dir, mode: 'extracted-prose',
  documentExtractionConfig: { enabled: true, fidelityMode: 'quality-sensitive' },
  state: { fileInfoByPath: new Map(), skippedFiles: [{ file: 'image.pdf', sourceType: 'pdf',
    reason: noText.reason, warnings: noText.warnings, fidelity: noText.fidelity }] } });
assert.equal(skippedReport.counts.total, 1); assert.equal(skippedReport.coverage.qualitySensitiveFailures, 1);
assert.deepEqual(skippedReport.files[0].fidelity.pageCoverage, noText.fidelity.pageCoverage);
assert.ok(validateArtifact('extraction_report', skippedReport).ok);

const changed = await extractPdf({ buffer: buildMinimalPdfPagesBuffer([{ text: 'First source page' }, { text: 'Now searchable' }, { text: 'Third source page' }]) });
assert.equal(changed.fidelity.pageCoverage.noTextPages, 0); assert.equal(changed.fidelity.state, 'complete');
assert.deepEqual(changed.pages[0], result.pages[0], 'changing another page does not renumber or rewrite this page evidence');
assert.equal(skippedFiles.length, 0);
console.log('real PDF page evidence survives source units, extraction-cache hits and report policy');
