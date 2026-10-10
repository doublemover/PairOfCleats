import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';
import { readFileCompletion, fileCompletionIdentity } from '../../../src/index/build/incremental/file-completion.js';
import { loadCachedBundleForFile } from '../../../src/index/build/file-processor/incremental.js';
import { updateBundlesWithChunks } from '../../../src/index/build/incremental/writeback.js';
import { reuseCachedBundle } from '../../../src/index/build/file-processor/cached-bundle.js';
import { reopenSemanticDiskAccount } from '../../../src/index/build/incremental/working-set.js';

const fixture = await createSemanticCacheFixture();
try {
  const completed = await fixture.createFile({ zeroChunks: true });
  const context = { repoRoot: fixture.repoRoot, repositoryNamespace: fixture.repoRoot,
    dependencySignatures: fixture.dependencies, diskAccount: fixture.account,
    buildRoot: path.join(fixture.root, 'resumed'),
    storage: { ...fixture.storage, generation: { baseBuildId: 'resumed', semanticRevision: 0 } } };
  const read = (sourceBytes = completed.bytes, semanticContext = context) => readFileCompletion({
    bundleDir: fixture.bundleDir, relKey: completed.file, sourceBytes, semanticContext });
  assert.ok(completed.entry.completionKey, 'completion is durable before apply or Stage2');
  const receipt = await read();
  assert.equal(receipt.chunkCount, 0, 'successful zero-chunk files are explicit completions');
  assert.equal(receipt.manifestEntry.semanticCache.canonicalHash, completed.factsRef.canonicalHash);
  assert.equal(await read(Buffer.from('changed source')), null);
  assert.equal(await read(completed.bytes, { ...context, dependencySignatures: { ...fixture.dependencies, semantic: 'c'.repeat(64) } }), null);
  const movedPolicy = { ...fixture.dependencies, semanticLayout: 'other-layout', semanticAnalysis: 'other-analysis', artifacts: 'other-format' };
  assert.deepEqual(fileCompletionIdentity({ repositoryNamespace: fixture.repoRoot, relKey: completed.file,
    sourceHash: completed.source.byteHash, dependencySignatures: movedPolicy }),
  fileCompletionIdentity({ repositoryNamespace: fixture.repoRoot, relKey: completed.file,
    sourceHash: completed.source.byteHash, dependencySignatures: fixture.dependencies }));
  assert.ok(await read(completed.bytes, { ...context, dependencySignatures: movedPolicy }));

  // The manifest and deferred control DB need never have been saved.
  const state = { enabled: true, bundleDir: fixture.bundleDir, bundleFormat: 'json',
    manifest: { ...fixture.manifest, files: {} }, readHashCache: new Map() };
  const sourcePath = path.join(fixture.repoRoot, completed.file);
  // The fixture has synthetic stat/hash fields; align its source stat to exercise
  // the normal cached read, which still rehashes exact semantic source bytes.
  await fs.utimes(sourcePath, new Date(), new Date(completed.entry.mtimeMs));
  const fileStat = { ...(await fs.stat(sourcePath)), mtimeMs: completed.entry.mtimeMs };
  const restored = await loadCachedBundleForFile({ repoRoot: fixture.repoRoot, runIo: fn => fn(),
    incrementalState: state, absPath: sourcePath, relKey: completed.file, fileStat, semanticContext: context });
  assert.ok(restored.semanticFactsRef);
  assert.deepEqual(restored.cachedBundle.chunks, []);
  assert.equal(restored.semanticFactsRef.storage.generation.baseBuildId, 'resumed');
  assert.equal(restored.semanticFactsRef.canonicalHash, completed.factsRef.canonicalHash);
  const applied = reuseCachedBundle({ abs: sourcePath, relKey: completed.file, fileIndex: 2,
    fileStat, cachedBundle: restored.cachedBundle, incrementalState: state, fileStart: Date.now(), mode: 'code' });
  assert.deepEqual(applied.result.chunks, [], 'normal result application accepts completed empty/disabled sibling lanes');
  assert.ok(applied.result.manifestEntry.completionKey);

  const withChunks = await fixture.createFile({ file: 'other.js' });
  const immutablePath = path.join(fixture.bundleDir, withChunks.entry.bundles[0]);
  const before = createHash('sha256').update(await fs.readFile(immutablePath)).digest('hex');
  await updateBundlesWithChunks({ enabled: true, repoRoot: fixture.repoRoot, manifest: fixture.manifest,
    log: () => {},
    manifestPath: path.join(fixture.root, 'manifest.json'), bundleDir: fixture.bundleDir,
    chunks: withChunks.chunks.map(chunk => ({ ...chunk, name: 'analysis changed' })), fileRelations: new Map() });
  assert.equal(createHash('sha256').update(await fs.readFile(immutablePath)).digest('hex'), before,
    'Stage2 rewrite and garbage collection cannot mutate a pinned Stage1 snapshot');

  const part = completed.factsRef.partitions[0].members.semantic_records[0];
  const cachedPart = path.join(fixture.bundleDir, 'semantic', completed.entry.semanticCache.cacheKey, 'parts', part.path);
  await fs.appendFile(cachedPart, 'corruption');
  assert.equal(await read(), null, 'a corrupt part makes only its own completion ineligible');
  assert.ok(await readFileCompletion({ bundleDir: fixture.bundleDir, relKey: withChunks.file,
    sourceBytes: withChunks.bytes, semanticContext: context }), 'unrelated valid completions survive');
  await fixture.createFile({ zeroChunks: true });
  assert.ok(await read(), 'recomputation repairs a corrupt cache identity without discarding siblings');
  const reopened = await reopenSemanticDiskAccount({ limit: 32 * 1024 * 1024,
    roots: [fixture.bundleDir, fixture.bundleDir, path.join(fixture.bundleDir, 'semantic')] });
  assert.ok(reopened.retainedBytes > 0);
  assert.ok(reopened.retainedFiles > 0);
  await assert.rejects(reopenSemanticDiskAccount({ limit: reopened.retainedBytes - 1,
    roots: [fixture.bundleDir] }), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  const higherCap = await reopenSemanticDiskAccount({ limit: reopened.retainedBytes + 1,
    roots: [fixture.bundleDir] });
  assert.equal(higherCap.account.used, reopened.retainedBytes, 'overlapping roots are charged once; a higher cap resumes');
  console.log('Stage1 durable completion, zero-chunk replay, isolation and immutable writeback passed');
} finally { await fixture.cleanup(); }
