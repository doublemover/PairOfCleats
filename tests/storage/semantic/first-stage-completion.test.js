import { persistSemanticCacheEntry } from '../../../src/index/build/incremental/semantic-cache.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';
import { readFileCompletion, fileCompletionIdentity, preloadFileCompletions, commitFileCompletion } from '../../../src/index/build/incremental/file-completion.js';
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
  const fullManifestEntry = { ...completed.entry }; delete fullManifestEntry.completionKey;
  const completionPath = path.join(fixture.bundleDir, 'completions', completed.entry.completionKey + '.json');
  const envelope = JSON.parse(await fs.readFile(completionPath, 'utf8'));
  const reservedBefore = fixture.account.used;
  await commitFileCompletion({ bundleDir: fixture.bundleDir, relKey: completed.file,
    manifestEntry: envelope.descriptor.manifestEntry, semanticFactsRef: completed.factsRef,
    semanticContext: context, chunkCount: 0, lexiconFilterStats: envelope.descriptor.lexiconFilterStats });
  assert.equal(fixture.account.used, reservedBefore, 'identical descriptor replay does not reserve another copy');
  const constrained = createSemanticDiskAccount(1);
  await assert.rejects(commitFileCompletion({ bundleDir: fixture.bundleDir, relKey: completed.file,
    manifestEntry: fullManifestEntry, semanticFactsRef: completed.factsRef,
    semanticContext: { ...context, diskAccount: constrained }, chunkCount: 0,
    lexiconFilterStats: { changed: true } }), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  assert.deepEqual(JSON.parse(await fs.readFile(completionPath, 'utf8')), envelope, 'replacement credit failure preserves the completed descriptor');
  const replacement = () => commitFileCompletion({ bundleDir: fixture.bundleDir, relKey: completed.file,
    manifestEntry: envelope.descriptor.manifestEntry, semanticFactsRef: completed.factsRef,
    semanticContext: context, chunkCount: 0, lexiconFilterStats: { replacement: true } });
  const oldDescriptorSize = (await fs.stat(completionPath)).size;
  await Promise.all([replacement(), replacement()]);
  assert.equal(fixture.account.used - reservedBefore, (await fs.stat(completionPath)).size - oldDescriptorSize,
    'concurrent completion replacements charge only the final durable descriptor');
  const firstCopyPiece = Object.values(completed.factsRef.partitions[0].members).flat()[0];
  const copyBudget = createSemanticDiskAccount(firstCopyPiece.bytes + firstCopyPiece.count * 8 + 1);
  let acceptedCopyReservations = 0;
  const reserveCopy = copyBudget.reserve.bind(copyBudget);
  copyBudget.reserve = bytes => { reserveCopy(bytes); acceptedCopyReservations++; };
  await assert.rejects(persistSemanticCacheEntry({ repoRoot: fixture.repoRoot,
    bundleDir: path.join(fixture.root, 'bounded-copy'), factsRef: completed.factsRef,
    buildRoot: fixture.buildRoot, dependencySignatures: fixture.dependencies, diskAccount: copyBudget }), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  assert.ok(acceptedCopyReservations >= 2, 'failure occurs after part data and offsets were copied');
  assert.equal(copyBudget.used, 0, 'failed cache copy returns credits only after owned staging cleanup');
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
  const pendingPath = path.join(fixture.repoRoot, 'pending.js');
  await fs.writeFile(pendingPath, 'unfinished();');
  const richerPrior = { ...receipt.manifestEntry, completionKey: 'f'.repeat(64) };
  state.manifest.files[completed.file] = richerPrior;
  const admitted = await preloadFileCompletions({
    entries: [{ rel: 'pending.js', abs: pendingPath }, { rel: completed.file, abs: sourcePath }],
    incrementalState: state, semanticContext: context });
  assert.deepEqual([...admitted], [sourcePath], 'only validated completions bypass global parser scheduling');
  assert.equal(state.manifest.files[completed.file], richerPrior, 'keep the same-source Stage2 entry');
  assert.equal(richerPrior.completionKey, completed.entry.completionKey, 'pin the verified fallback before retained-cache cleanup');
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
    chunks: withChunks.chunks.map(chunk => ({ ...chunk, id: 1 })), fileRelations: new Map(), diskAccount: fixture.account });
  assert.notEqual(fixture.manifest.files[withChunks.file].bundles[0], path.basename(immutablePath));
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
