import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';
import { isGeneratedArtifactCandidatePath } from '../../../src/shared/generated-artifact.js';
import { buildDependencySignatures, buildIncrementalSignature } from '../../../src/index/build/indexer/signatures.js';
import { loadIncrementalState } from '../../../src/index/build/incremental/planning.js';
import { persistIncrementalManifest } from '../../../src/index/build/incremental/manifest-codec.js';
import { writeIncrementalBundle } from '../../../src/index/build/incremental/writeback.js';
import { resolveStageRefresh } from '../../../src/index/build/incremental/stage-reuse.js';
import { sha1 } from '../../../src/shared/hash.js';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { createFileProcessorForTest, createScannedFileEntry, createCachedBundleFixturePayload } from './file-processor-fixture.js';

const parent = resolveTestCachePath(process.cwd(), 'generated-policy-requalification');
await fs.mkdir(parent, { recursive: true });
const owned = await fs.mkdtemp(path.join(parent, 'owned-')), root = path.join(owned, 'repo');
await fs.mkdir(root);
try {
  const runtime = { root, lintEnabled: false, complexityEnabled: false, languageOptions: {}, indexingConfig: {} };
  const currentDependencies = buildDependencySignatures(runtime, 'code', 'fixture');
  const priorDependencies = { ...currentDependencies }; delete priorDependencies.sourceAdmission;
  const { artifacts: _artifacts, ...priorContent } = priorDependencies;
  const priorSignature = sha1(stableStringifyForSignature(priorContent));
  const currentSignature = buildIncrementalSignature(runtime, 'code', 'fixture');
  assert.notEqual(currentSignature, priorSignature);
  assert.equal(currentDependencies.parse, priorDependencies.parse); assert.equal(currentDependencies.lexical, priorDependencies.lexical);
  assert.equal(currentDependencies.enrichment, priorDependencies.enrichment);
  assert.equal(buildDependencySignatures(runtime, 'records', 'fixture').sourceAdmission, undefined);
  const oldState = await loadIncrementalState({ repoCacheRoot: path.join(owned, 'cache'), mode: 'code', enabled: true,
    cacheSignature: priorSignature, tokenizationKey: 'fixture', dependencySignatures: priorDependencies });
  const files = new Map([
    ['notes.json', JSON.stringify(withGeneratedCacheMetadata({ version: 1, entries: [] }, 'lsp-requests'))],
    ['authored.js', 'export const authored = 1;\n']
  ]);
  assert.equal(isGeneratedArtifactCandidatePath('notes.json'), false, 'early path discovery cannot supply this qualification');
  const sourceEntries = new Map();
  for (const [relative, text] of files) {
    const abs = path.join(root, relative); await fs.writeFile(abs, text);
    const stat = await fs.stat(abs), hash = sha1(Buffer.from(text));
    const fixture = createCachedBundleFixturePayload({ chunk: { file: relative, virtualPath: relative,
      chunkUid: 'ck:policy-' + relative, name: 'retained-parse-witness', tokens: ['retained'], seq: ['retained'] } });
    const entry = await writeIncrementalBundle({ enabled: true, bundleDir: oldState.bundleDir, manifest: oldState.manifest,
      relKey: relative, fileStat: stat, fileHash: hash, fileChunks: fixture.chunks, fileRelations: fixture.fileRelations,
      vfsManifestRows: [], dependencySignatures: priorDependencies, bundleFormat: 'json' });
    assert.ok(entry); oldState.manifest.files[relative] = entry;
    sourceEntries.set(relative, createScannedFileEntry({ abs, rel: relative, stat, ext: path.extname(relative) }));
  }
  await persistIncrementalManifest(oldState.manifestPath, oldState.manifest);
  const state = await loadIncrementalState({ repoCacheRoot: path.join(owned, 'cache'), mode: 'code', enabled: true,
    cacheSignature: currentSignature, tokenizationKey: 'fixture', dependencySignatures: currentDependencies });
  assert.deepEqual(Object.keys(state.manifest.files).sort(), ['authored.js', 'notes.json']);
  assert.equal(resolveStageRefresh(currentDependencies, priorDependencies).parse, false);
  assert.equal(resolveStageRefresh(currentDependencies, priorDependencies).sourceAdmission, true);
  const skips = [], stale = sourceEntries.get('notes.json');
  const staleText = new Map([[stale.rel, { buffer: Buffer.alloc(stale.stat.size, 0x78), hash: state.manifest.files[stale.rel].hash,
    size: stale.stat.size, mtimeMs: stale.stat.mtimeMs }]]);
  const { processFile } = createFileProcessorForTest({ root, skippedFiles: skips,
    overrides: { incrementalState: state, fileTextCache: staleText } });
  assert.equal(await processFile(stale, 0), null, 'old compatible chunks cannot bypass fresh physical source admission');
  assert.ok(skips.some(row => row.reason === 'generated-artifact' && row.recognition === 'incremental-policy-requalification'));
  const sibling = await processFile(sourceEntries.get('authored.js'), 1);
  assert.ok(sibling); assert.equal(sibling.cached, true, 'ordinary source keeps its compatible parse/lexical bundle');
  assert.deepEqual(sibling.chunks[0].tokens, ['retained']);
  assert.equal(sibling.chunks[0].name, 'retained-parse-witness');
  assert.equal(sibling.manifestEntry.dependencySignatures.sourceAdmission, currentDependencies.sourceAdmission);
  state.manifest.files['authored.js'] = sibling.manifestEntry;
  assert.equal(resolveStageRefresh(currentDependencies, sibling.manifestEntry.dependencySignatures).sourceAdmission, false);
  const next = createFileProcessorForTest({ root, overrides: { incrementalState: state } });
  const warm = await next.processFile(sourceEntries.get('authored.js'), 0);
  assert.equal(warm.cached, true); assert.deepEqual(warm.chunks[0].tokens, ['retained']);
  console.log('generated admission migration rechecks renamed source while preserving ordinary warm bundles');
} finally {
  const relative = path.relative(path.resolve(parent), path.resolve(owned));
  assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
  await fs.rm(owned, { recursive: true, force: true });
}
