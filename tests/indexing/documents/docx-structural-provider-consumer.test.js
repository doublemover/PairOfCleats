import assert from 'node:assert/strict';
import mammoth from 'mammoth';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractDocx, loadDocxExtractorRuntime } from '../../../src/index/extractors/docx.js';
import { buildMinimalDocxBuffer, buildStoredZip } from '../../helpers/document-fixtures.js';
import { resolvePreCpuFileContent } from '../../../src/index/build/file-processor/pre-cpu-content.js';
import { chunkDocxDocument } from '../../../src/index/chunking/formats/docx.js';
import { createDocumentExtractionReceipt, admitDocumentExtractionReceipt } from '../../../src/index/extractors/receipt.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createFileProcessorForTest, createScannedFileEntry } from '../file-processor/file-processor-fixture.js';
applyTestEnv();
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = `<w:document xmlns:w="${ns}"><w:body><w:p/>
  <w:p><w:pPr><w:pStyle w:val="Chapter"/></w:pPr><w:r><w:t>Overview</w:t></w:r></w:p>
  <w:p><w:r><w:t>alpha 😀</w:t><w:br/><w:t>line</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="Details"/></w:pPr><w:r><w:t>Details</w:t></w:r></w:p>
  <w:tbl><w:tr><w:tc><w:p><w:r><w:t>beta É</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`;
const stylesXml = `<a:styles xmlns:a="${ns}">
  <a:style a:type="paragraph" a:styleId="Base"><a:pPr><a:outlineLvl a:val="0"/></a:pPr></a:style>
  <a:style a:type="paragraph" a:styleId="Chapter"><a:basedOn a:val="Base"/></a:style>
  <a:style a:type="paragraph" a:styleId="Details"><a:basedOn a:val="Heading2"/></a:style>
  </a:styles>`;
const bytes = buildMinimalDocxBuffer([], { xml, stylesXml });
const expected = [{ index: 2, style: 'Chapter', headingLevel: 1, text: 'Overview' },
  { index: 3, text: 'alpha 😀\nline' }, { index: 4, style: 'Details', headingLevel: 2, text: 'Details' },
  { index: 5, text: 'beta É' }];
const realOracle = await mammoth.extractRawText({ buffer: bytes });
assert.deepEqual(realOracle.value.trim().split(/\n\s*\n/).filter(Boolean), ['Overview', 'alpha 😀line', 'Details', 'beta É'],
  'installed Mammoth remains an independent meaningful text oracle, rather than a discarded production pass');
assert.equal(expected[1].text, 'alpha 😀\nline', 'the structural product additionally preserves the authored Word break lost by raw-text conversion');
const result = await extractDocx({ buffer: bytes });
assert.equal(result.ok, true); assert.deepEqual(result.paragraphs, expected);
assert.deepEqual(result.extractor, { name: 'docx-xml', version: '4', target: 'sax' });
const artifacts = { fileBuffer: bytes };
await resolvePreCpuFileContent({ abs: 'fixture.docx', repoRoot: process.cwd(), relKey: 'fixture.docx',
  mode: 'extracted-prose', ext: '.docx', fileStat: { size: bytes.length }, runIo: action => action(),
  throwIfAborted() {}, updateCrashStage() {}, warnEncodingFallback() {}, formatCrashErrorMeta: error => error,
  documentSourceType: 'docx', documentExtractionPolicy: {}, artifacts });
assert.deepEqual(artifacts.documentExtraction.units.map(unit => [unit.index, unit.style ?? null, unit.headingLevel ?? null]),
  [[2, 'Chapter', 1], [3, null, null], [4, 'Details', 2], [5, null, null]]);
const chunk = () => chunkDocxDocument(artifacts.text, { documentExtraction: artifacts.documentExtraction,
  documentChunking: { maxCharsPerChunk: 10000 } });
const chunks = chunk();
assert.deepEqual(chunks.map(row => [row.segment.paragraphStart, row.segment.paragraphEnd, row.segment.headingPath]),
  [[2, 3, ['Overview']], [4, 5, ['Overview', 'Details']]]);
assert.deepEqual(chunk(), chunks, 'anchors and complete original paragraph ranges are deterministic');
assert.ok(chunks.every(row => row.start >= 0 && row.end <= artifacts.text.length));
const { dir: cacheRoot } = await prepareIsolatedTestCacheDir('docx-structural-cache-consumer');
const cachePath = path.join(cacheRoot, 'fixture.docx'); await fs.writeFile(cachePath, bytes);
const extractionCache = new Map();
const processDocument = async () => {
  const processor = createFileProcessorForTest({ root: cacheRoot, mode: 'extracted-prose',
    overrides: { documentExtractionConfig: { enabled: true }, documentExtractionCache: extractionCache } });
  return processor.processFile(createScannedFileEntry({ abs: cachePath, rel: 'fixture.docx', stat: await fs.stat(cachePath) }), 0);
};
const cold = await processDocument(), warm = await processDocument();
assert.ok(cold); assert.ok(warm);
assert.equal(cold.fileInfo.extraction.warnings.includes('document-extraction-cache-hit'), false);
assert.equal(warm.fileInfo.extraction.warnings.includes('document-extraction-cache-hit'), true);
assert.deepEqual(warm.fileInfo.extraction.units, cold.fileInfo.extraction.units,
  'the real cache store and load clones retain both raw style and resolved inherited heading level');
assert.deepEqual(warm.fileInfo.extraction.units.filter(unit => unit.headingLevel).map(unit => [unit.style, unit.headingLevel]),
  [['Chapter', 1], ['Details', 2]]);
assert.deepEqual(warm.chunks.map(row => row.segment?.headingPath), cold.chunks.map(row => row.segment?.headingPath));
const receipt = createDocumentExtractionReceipt({ extraction: artifacts.documentExtraction,
  sourceHash: artifacts.fileHash, sourceSize: bytes.length });
const admit = value => admitDocumentExtractionReceipt({ receipt: value, sourceHash: artifacts.fileHash, sourceSize: bytes.length });
assert.ok(admit(receipt));
for (const level of [0, 10, '1']) { const bad = structuredClone(receipt); bad.extraction.units[0].headingLevel = level; assert.equal(admit(bad), null); }
const old = structuredClone(receipt); old.extraction.admission.producerVersion = 3;
old.extraction.normalizationPolicy = old.extraction.admission.normalizationPolicy = 'v1:docx-xml:3';
assert.equal(admit(old), null, 'old flattened/custom-style products cannot cross the extractor identity fence');
const runtime = await loadDocxExtractorRuntime(), saved = { ...runtime }; let providerCalls = 0;
try {
  runtime.backend = 'mammoth'; runtime.mod = { extractRawText() { providerCalls++; throw new Error('Unconsumed provider must never start'); } };
  assert.deepEqual((await extractDocx({ buffer: bytes })).paragraphs, expected);
  for (const declaredSize of [undefined, 1]) {
    const compressed = buildStoredZip([{ name: 'word/document.xml', compression: 8, declaredSize,
      data: `<w:document xmlns:w="${ns}"><w:p><w:r><w:t>${'A'.repeat(8192)}</w:t></w:r></w:p></w:document>` }]);
    assert.ok(compressed.length < 1024);
    const refused = await extractDocx({ buffer: compressed, policy: { maxBytesPerFile: 1024 } });
    assert.equal(refused.ok, false); assert.equal(refused.reason, 'oversize');
  }
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(extractDocx({ buffer: bytes, signal: aborted.signal }), { name: 'AbortError' });
  const clock = Object.getOwnPropertyDescriptor(performance, 'now'); let ticks = 0;
  try {
    Object.defineProperty(performance, 'now', { configurable: true, value: () => ticks++ * 1000 });
    assert.equal((await extractDocx({ buffer: bytes, policy: { extractTimeoutMs: 1 } })).reason, 'extract_timeout');
  } finally { if (clock) Object.defineProperty(performance, 'now', clock); else delete performance.now; }
  const combined = buildStoredZip([{ name: 'word/document.xml', compression: 8,
    data: `<w:document xmlns:w="${ns}"><w:p><w:r><w:t>${'A'.repeat(1300)}</w:t></w:r></w:p></w:document>` },
  { name: 'word/styles.xml', compression: 8, data: `<w:styles xmlns:w="${ns}">${' '.repeat(1300)}</w:styles>` }]);
  assert.ok(combined.length < 2000);
  assert.equal((await extractDocx({ buffer: combined, policy: { maxBytesPerFile: 2000 } })).reason, 'oversize', 'document and styles share one expanded-byte allowance');
  const malformed = Buffer.from(bytes); malformed.writeUInt16LE(999, malformed.length - 12);
  assert.equal((await extractDocx({ buffer: malformed })).reason, 'extract_failed');
  assert.equal(providerCalls, 0, 'accepted, malformed, oversized and canceled inputs launch no optional/deferred provider task');
} finally { Object.assign(runtime, saved); }
const cyclic = stylesXml.replace('a:val="Base"', 'a:val="Chapter"');
const partial = await extractDocx({ buffer: buildMinimalDocxBuffer([], { xml, stylesXml: cyclic }) });
assert.equal(partial.paragraphs[0].style, 'Chapter'); assert.equal(partial.paragraphs[0].headingLevel, null);
assert.ok(partial.warnings.some(warning => warning.includes('cyclic')));
console.log('One bounded DOCX structural/style product survives real unit, chunk and receipt consumers, independently compared with installed Mammoth.');
