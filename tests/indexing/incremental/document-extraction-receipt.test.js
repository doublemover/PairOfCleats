import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { buildMinimalPdfPagesBuffer, buildMinimalDocxBuffer } from '../../helpers/document-fixtures.js';
import { createFileProcessorForTest, createScannedFileEntry } from '../file-processor/file-processor-fixture.js';
import { loadIncrementalState, readCachedBundle, writeIncrementalBundle, updateBundlesWithChunks } from '../../../src/index/build/incremental.js';
import { readIncrementalBundleSnapshot, writeIncrementalBundleSnapshot } from '../../../src/index/build/incremental/bundle-snapshot.js';
import { buildDependencySignatures, buildIncrementalSignature } from '../../../src/index/build/indexer/signatures.js';
import { buildDocumentExtractionAdmission, prepareDocumentExtractionAdmission } from '../../../src/index/extractors/admission.js';
import { admitDocumentExtractionReceipt } from '../../../src/index/extractors/receipt.js';
import { buildExtractionReport } from '../../../src/index/build/artifacts/reporting.js';
import { shouldReuseExistingBundle } from '../../../src/index/build/incremental/bundle-compare.js';

const { dir } = await prepareIsolatedTestCacheDir('document-extraction-receipt');
const skippedByProcessor = new WeakMap();
const policy = { enabled: true, maxPages: 3 };
const signatureFor = async config => {
  const runtime = { indexingConfig: { documentExtraction: config } };
  await prepareDocumentExtractionAdmission(runtime, 'extracted-prose');
  return { dependencies: buildDependencySignatures(runtime, 'extracted-prose', 'fixture'),
    signature: buildIncrementalSignature(runtime, 'extracted-prose', 'fixture'), runtime };
};
const identity = await signatureFor(policy);
const normalized = await signatureFor({ ...policy, maxBytesPerFile: 64 * 1024 * 1024, extractTimeoutMs: 15000,
  fidelityMode: 'permissive' });
assert.deepEqual(identity.dependencies, normalized.dependencies, 'equal effective policy has one reuse identity');
for (const changed of [{ maxPages: 1 }, { maxBytesPerFile: 1024 }, { fidelityMode: 'quality-sensitive' }, { extractTimeoutMs: 1000 }]) {
  const next = await signatureFor({ ...policy, ...changed });
  assert.notEqual(next.dependencies.documentExtraction, identity.dependencies.documentExtraction);
  for (const key of ['parse', 'lexical', 'enrichment', 'embeddings', 'artifacts']) assert.equal(next.dependencies[key], identity.dependencies[key]);
}
const scheduled = { ...identity.runtime, fileConcurrency: 7, ioConcurrency: 2 };
assert.deepEqual(buildDependencySignatures(scheduled, 'extracted-prose', 'fixture'), identity.dependencies);
assert.equal(buildDependencySignatures(identity.runtime, 'code', 'fixture').documentExtraction, undefined);

for (const format of ['json', 'msgpack']) {
  const root = path.join(dir, format); await fs.mkdir(root);
  const pdfPath = path.join(root, 'stable.pdf'), docxPath = path.join(root, 'changing.docx');
  await fs.writeFile(pdfPath, buildMinimalPdfPagesBuffer([{ text: 'First source page' }, { image: true }, { text: 'Third source page' }]));
  await fs.writeFile(docxPath, buildMinimalDocxBuffer(['Old document paragraph']));
  const incremental = await loadIncrementalState({ repoRoot: root, repoCacheRoot: path.join(root, 'cache'),
    mode: 'extracted-prose', enabled: true, bundleFormat: format, dependencySignatures: identity.dependencies,
    cacheSignature: identity.signature, tokenizationKey: 'fixture' });
  const make = (config = policy, state = incremental) => {
    const skippedFiles = [];
    const processor = createFileProcessorForTest({ root, mode: 'extracted-prose', skippedFiles,
      overrides: { relationsEnabled: true, documentExtractionConfig: config, incrementalState: state } });
    skippedByProcessor.set(processor, skippedFiles); return processor;
  };
  const process = async (processor, file) => {
    const entry = createScannedFileEntry({ abs: path.join(root, file), rel: file, stat: await fs.stat(path.join(root, file)) });
    const result = await processor.processFile(entry, 0);
    if (result?.manifestEntry) incremental.manifest.files[file] = result.manifestEntry;
    return result;
  };
  const first = make(), coldPdf = await process(first, 'stable.pdf'), coldDocx = await process(first, 'changing.docx');
  assert.ok(coldPdf?.manifestEntry); assert.ok(coldDocx?.manifestEntry);
  assert.equal(coldPdf.cached, false); assert.equal(coldPdf.fileInfo.extraction.fidelity.state, 'coverage_gap');
  const priorPdf = await readCachedBundle({ repoRoot: root, enabled: true, absPath: pdfPath, relKey: 'stable.pdf',
    fileStat: await fs.stat(pdfPath), manifest: incremental.manifest, bundleDir: incremental.bundleDir, bundleFormat: format });
  assert.ok(priorPdf.cachedBundle, 'the actual immutable document bundle remains readable before replay');
  assert.ok(admitDocumentExtractionReceipt({ receipt: priorPdf.cachedBundle.documentExtraction,
    sourceHash: priorPdf.fileHash, sourceSize: (await fs.stat(pdfPath)).size,
    admission: coldPdf.fileInfo.extraction.admission }), 'cold extraction provenance admits its own immutable replay');
  await fs.writeFile(docxPath, buildMinimalDocxBuffer(['Changed document paragraph with different bytes']));
  const restart = make(), replayed = await process(restart, 'stable.pdf'), changed = await process(restart, 'changing.docx');
  assert.equal(replayed.cached, true, 'unchanged document actually takes the early bundle-return path');
  assert.equal(changed.cached, false); assert.notEqual(changed.fileInfo.extraction.sourceBytesHash, coldDocx.fileInfo.extraction.sourceBytesHash);
  assert.deepEqual(replayed.fileInfo.extraction, coldPdf.fileInfo.extraction, 'no extractor rerun/cache record is needed to restore provenance');
  const report = rows => buildExtractionReport({ root, mode: 'extracted-prose', documentExtractionConfig: policy,
    state: { fileInfoByPath: new Map(rows.map(row => [row.relKey, row.fileInfo])), skippedFiles: [] } });
  const rebuilt = make(policy, { ...incremental, enabled: false });
  const freshPdf = await process(rebuilt, 'stable.pdf'), freshDocx = await process(rebuilt, 'changing.docx');
  assert.deepEqual(report([replayed, changed]).files, report([freshPdf, freshDocx]).files);
  assert.deepEqual(report([replayed, changed]).counts, { total: 2, ok: 2, skipped: 0, byReason: {} });

  const currentEntry = incremental.manifest.files['stable.pdf'];
  const selected = await readIncrementalBundleSnapshot({ repoRoot: root, bundleDir: incremental.bundleDir,
    relKey: 'stable.pdf', entry: currentEntry, fallbackFormat: format });
  assert.ok(selected); const bundle = selected.bundle;
  const corrupt = structuredClone(bundle.documentExtraction); corrupt.extraction.units[0].pageNumber = 2;
  assert.equal(admitDocumentExtractionReceipt({ receipt: corrupt, sourceHash: bundle.hash, sourceSize: bundle.size }), null);
  assert.equal(shouldReuseExistingBundle(bundle, { ...bundle, documentExtraction: corrupt }), false);
  await assert.rejects(writeIncrementalBundleSnapshot({ repoRoot: root, bundleDir: incremental.bundleDir,
    relKey: 'stable.pdf', bundles: [{ ...bundle, documentExtraction: corrupt }], format }), /Invalid document extraction receipt/);
  const missing = await writeIncrementalBundleSnapshot({ repoRoot: root, bundleDir: incremental.bundleDir,
    relKey: 'stable.pdf', bundles: [{ ...bundle, documentExtraction: null }], format });
  incremental.manifest.files['stable.pdf'] = { ...currentEntry, ...missing };
  assert.equal((await process(make(), 'stable.pdf')).cached, false, 'legacy missing receipt triggers scoped extraction refresh');

  const kept = await process(make(), 'stable.pdf'); assert.equal(kept.cached, true);
  const originalNames = incremental.manifest.files['stable.pdf'].bundles.slice();
  await updateBundlesWithChunks({ repoRoot: root, enabled: true, manifest: incremental.manifest,
    bundleDir: incremental.bundleDir, bundleFormat: format, chunks: kept.chunks.map(chunk => ({ ...chunk, stage2Witness: 'changed' })),
    fileRelations: new Map([['stable.pdf', kept.fileRelations]]), log() {} });
  assert.notDeepEqual(incremental.manifest.files['stable.pdf'].bundles, originalNames);
  const afterStage2 = await process(make(), 'stable.pdf'); assert.equal(afterStage2.cached, true);
  assert.deepEqual(afterStage2.fileInfo.extraction, coldPdf.fileInfo.extraction);

  const tightened = await signatureFor({ ...policy, maxPages: 2 });
  incremental.manifest.dependencySignatures = tightened.dependencies;
  const tightenedProcessor = make({ ...policy, maxPages: 2 });
  const refused = await process(tightenedProcessor, 'stable.pdf');
  assert.equal(refused, null, 'three-page source must requalify under a two-page policy, rather than return old chunks');
  const coldProcessor = make({ ...policy, maxPages: 2 }, { ...incremental, enabled: false });
  const coldRefusal = await process(coldProcessor, 'stable.pdf');
  assert.equal(coldRefusal, null);
  assert.equal(skippedByProcessor.get(tightenedProcessor)[0].reason, 'oversize');
  assert.deepEqual(skippedByProcessor.get(tightenedProcessor)[0].fidelity, skippedByProcessor.get(coldProcessor)[0].fidelity);
  assert.equal(skippedByProcessor.get(tightenedProcessor)[0].fidelity.pageCoverage.totalPages, 3);
  assert.equal(skippedByProcessor.get(tightenedProcessor)[0].fidelity.pageCoverage.attemptedPages, 0);
  incremental.manifest.dependencySignatures = identity.dependencies;
  const old = incremental.manifest.files['stable.pdf'];
  const extractorChanged = structuredClone(bundle.documentExtraction.extraction.admission);
  extractorChanged.extractor.version = 'different-producer';
  assert.equal(admitDocumentExtractionReceipt({ receipt: bundle.documentExtraction,
    sourceHash: bundle.hash, sourceSize: bundle.size, admission: extractorChanged }), null);
  const normalizationChanged = buildDocumentExtractionAdmission({ sourceType: 'pdf', policy,
    extractor: bundle.documentExtraction.extraction.extractor });
  normalizationChanged.normalizationPolicy += ':changed';
  assert.equal(admitDocumentExtractionReceipt({ receipt: bundle.documentExtraction,
    sourceHash: bundle.hash, sourceSize: bundle.size, admission: normalizationChanged }), null);
  const unavailable = report([{ relKey: 'stable.pdf', fileInfo: { hash: old.hash } }]);
  assert.equal(unavailable.counts.total, 1); assert.equal(unavailable.counts.skipped, 1);
  assert.match(unavailable.files[0].warnings[0], /receipt is unavailable/);

  await fs.writeFile(path.join(root, 'two.pdf'), buildMinimalPdfPagesBuffer([{ text: 'first' }, { text: 'second' }]));
  assert.equal((await process(make({ ...policy, maxPages: 2 }), 'two.pdf')).cached, false);
  assert.equal((await process(make({ ...policy, maxPages: 2 }), 'two.pdf')).cached, true);
  assert.equal(await process(make({ ...policy, maxPages: 1 }), 'two.pdf'), null, 'explicit two-to-one policy decrease requalifies the actual early replay path');

  // Exercise real split/reassembly with two independently sized serialized chunks.
  // Large diagnostic payloads affect the storage boundary, not the extraction text.
  const large = 'x'.repeat(10 * 1024 * 1024);
  const shardEntry = await writeIncrementalBundle({ enabled: true, bundleDir: incremental.bundleDir, relKey: 'stable.pdf',
    fileStat: await fs.stat(pdfPath), fileHash: coldPdf.fileInfo.hash, documentExtraction: coldPdf.fileInfo.extraction,
    fileChunks: [0, 1].map(index => ({ ...coldPdf.chunks[0], storageWitness: index, diagnosticPayload: large })),
    fileRelations: coldPdf.fileRelations, dependencySignatures: identity.dependencies, bundleFormat: format });
  assert.ok(shardEntry.bundles.length > 1, 'the fixture must actually split its immutable bundle');
  const read = await readCachedBundle({ repoRoot: root, enabled: true, absPath: pdfPath, relKey: 'stable.pdf',
    fileStat: await fs.stat(pdfPath), manifest: { ...incremental.manifest, files: { 'stable.pdf': shardEntry } },
    bundleDir: incremental.bundleDir, bundleFormat: format });
  assert.equal(read.cachedBundle.chunks.length, 2);
  assert.deepEqual(read.cachedBundle.documentExtraction.extraction, coldPdf.fileInfo.extraction);
}
console.log('document extraction receipts qualify actual partial incremental replay, policy, Stage2 and shard boundaries');
