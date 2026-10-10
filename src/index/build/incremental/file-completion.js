import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { atomicWriteText } from '../../../shared/io/atomic-write.js';
import { syncParentDirectory } from '../../../shared/io/persistence-helpers.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { resolveBundleJsonChecksumPath, resolveManifestBundleNames } from '../../../shared/bundle-io-paths.js';
import { canonicalSemanticJson, semanticHash } from '../../semantic/identity.js';
import { resolveSemanticPartPath } from '../../../semantic/artifact-store.js';
import { openSemanticCacheEntry } from './semantic-cache.js';
import { validateSemanticPartitions } from '../../semantic/reconcile.js';
import { validateEmbeddedCacheSource } from '../../semantic/embedded-cache.js';
import { withSemanticDiskWriter } from './accounted-bundle.js';

const MAX_DESCRIPTOR_BYTES = 16 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const fail = message => Object.assign(new Error(message), { code: 'ERR_STAGE1_COMPLETION' });
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');

/** The scheduler's sequence, shard and owner are deliberately not identities. */
export const fileCompletionIdentity = ({ repositoryNamespace, relKey, sourceHash, dependencySignatures }) => {
  if (!repositoryNamespace || !relKey || !HASH.test(sourceHash) || !dependencySignatures?.semantic) {
    throw new TypeError('Completion requires exact repository, source and extractor identity.');
  }
  return {
    schemaVersion: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    resultLaneSchema: 1, repositoryNamespace, path: relKey.split('\\').join('/'), sourceHash,
    extraction: {
      parse: dependencySignatures.parse || null,
      lexical: dependencySignatures.lexical || null,
      enrichment: dependencySignatures.enrichment || null,
      semantic: dependencySignatures.semantic
    }
  };
};
const keyFor = identity => semanticHash('pairofcleats.stage1.completion.v1', identity);

/** Immutable snapshot names cannot be overwritten by Stage2 bundle writeback. */
export const completionBundleName = (bundle, format) => 'resume-'
  + hashBytes(Buffer.from(JSON.stringify(bundle))) + (format === 'msgpack' ? '.mpk' : '.json');
export const isCompletionBundle = name => /^resume-[a-f0-9]{64}\.(json|mpk)(\.checksum\.json)?$/.test(name);

const inventoryFile = async (filename, name, { flush = false } = {}) => {
  const handle = await fs.open(filename, flush ? 'r+' : 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw fail('Completion part is not a regular file.');
    const hash = createHash('sha256');
    for await (const bytes of handle.createReadStream({ autoClose: false })) hash.update(bytes);
    if (flush) await handle.sync();
    return { path: name, bytes: stat.size, hash: hash.digest('hex') };
  } finally { await handle.close(); }
};

/** Publish only after every bundle and semantic part is complete and durable.
 * This is a per-file locator for the existing cache, not a second work queue.
 */
export const commitFileCompletion = async ({ bundleDir, relKey, manifestEntry, semanticFactsRef,
  semanticContext, chunkCount, lexiconFilterStats = null }) => {
  const { signal, diskAccount } = semanticContext;
  throwIfAborted(signal);
  const identity = fileCompletionIdentity({ repositoryNamespace: semanticFactsRef.repositoryNamespace,
    relKey, sourceHash: semanticFactsRef.sourceHash, dependencySignatures: semanticContext.dependencySignatures });
  const bundles = resolveManifestBundleNames(manifestEntry);
  if (!bundles.length || bundles.some(name => !isCompletionBundle(name))) throw fail('Completion needs immutable bundle snapshots.');
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 0) throw fail('Completion needs an explicit chunk count.');
  const parts = [];
  for (const name of bundles) {
    const filename = await resolveSemanticPartPath(bundleDir, name);
    parts.push(await inventoryFile(filename, name, { flush: true }));
    if (manifestEntry.bundleFormat === 'json') {
      const checksumPath = resolveBundleJsonChecksumPath(filename);
      parts.push(await inventoryFile(checksumPath, path.basename(checksumPath), { flush: true }));
    }
  }
  await syncParentDirectory(path.join(bundleDir, bundles[0]));
  const descriptor = { identity, requiredLanes: ['chunks', 'relations', 'vfs', 'semantic'],
    chunkCount, parts, manifestEntry, lexiconFilterStats };
  const payload = canonicalSemanticJson(descriptor);
  const bytes = Buffer.from(canonicalSemanticJson({ schemaVersion: 1, hash: hashBytes(Buffer.from(payload)), descriptor }) + '\n');
  if (bytes.length > MAX_DESCRIPTOR_BYTES) throw fail('Completion descriptor exceeds allowance.');
  const filename = path.join(bundleDir, 'completions', keyFor(identity) + '.json');
  return withSemanticDiskWriter(diskAccount, filename, async () => {
    let previousBytes = 0;
    try {
      const stat = await fs.stat(filename);
      if (stat.size === bytes.length && (await fs.readFile(filename)).equals(bytes)) return keyFor(identity);
      previousBytes = stat.nlink > 1 ? 0 : stat.size;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // The complete temporary replacement coexists with the old descriptor.
    // Uncertain failures keep credits until a physical inventory reconciliation.
    throwIfAborted(signal);
    diskAccount.reserve(bytes.length);
    await atomicWriteText(filename, bytes, { newline: false });
    await syncParentDirectory(path.dirname(filename));
    diskAccount.release(previousBytes);
    return keyFor(identity);
  });
};

/** Validate all bytes before admitting replay through normal file-result processing.
 * A corrupt/missing completion is a cache miss; cancellation and resource limits
 * remain errors. No valid sibling file is discarded.
 */
export const readFileCompletion = async ({ bundleDir, relKey, sourceBytes, semanticContext }) => {
  const { signal, dependencySignatures, repositoryNamespace, repoRoot } = semanticContext;
  throwIfAborted(signal);
  const identity = fileCompletionIdentity({ repositoryNamespace, relKey,
    sourceHash: hashBytes(sourceBytes), dependencySignatures });
  try {
    const filename = await resolveSemanticPartPath(bundleDir, 'completions/' + keyFor(identity) + '.json');
    if ((await fs.stat(filename)).size > MAX_DESCRIPTOR_BYTES) throw fail('Completion descriptor exceeds allowance.');
    const envelope = JSON.parse(await fs.readFile(filename, 'utf8'));
    const descriptor = envelope.descriptor;
    if (envelope.schemaVersion !== 1 || Object.keys(envelope).sort().join(',') !== 'descriptor,hash,schemaVersion'
      || envelope.hash !== hashBytes(Buffer.from(canonicalSemanticJson(descriptor)))
      || canonicalSemanticJson(descriptor.identity) !== canonicalSemanticJson(identity)
      || canonicalSemanticJson(descriptor.requiredLanes) !== '["chunks","relations","vfs","semantic"]'
      || !Number.isSafeInteger(descriptor.chunkCount) || descriptor.chunkCount < 0
      || !Array.isArray(descriptor.parts) || !descriptor.parts.length) throw fail('Invalid completion descriptor.');
    const entry = descriptor.manifestEntry;
    const bundles = resolveManifestBundleNames(entry);
    if (!bundles.length || bundles.some(name => !isCompletionBundle(name))) throw fail('Invalid completion bundle inventory.');
    const expectedPaths = bundles.flatMap(name => entry.bundleFormat === 'json'
      ? [name, path.basename(resolveBundleJsonChecksumPath(name))] : [name]);
    if (canonicalSemanticJson(expectedPaths) !== canonicalSemanticJson(descriptor.parts.map(part => part.path))) throw fail('Incomplete completion bundle inventory.');
    for (const part of descriptor.parts) {
      throwIfAborted(signal);
      const actual = await inventoryFile(await resolveSemanticPartPath(bundleDir, part.path), part.path);
      if (canonicalSemanticJson(actual) !== canonicalSemanticJson(part)) throw fail('Completion part checksum mismatch.');
    }
    const opened = await openSemanticCacheEntry({ repoRoot, bundleDir, locator: entry.semanticCache,
      expectedDependencySignatures: dependencySignatures, expectedSourceHash: identity.sourceHash,
      expectedSourcePath: identity.path, expectedRepositoryNamespace: repositoryNamespace, signal });
    await validateSemanticPartitions({ store: opened.store, partitions: opened.factsRef.partitions, signal });
    for (const segment of entry.semanticSegmentCaches || []) {
      const embedded = await openSemanticCacheEntry({ repoRoot, bundleDir, locator: segment.locator,
        expectedDependencySignatures: dependencySignatures, expectedRepositoryNamespace: repositoryNamespace, signal });
      await validateEmbeddedCacheSource({ opened: embedded, parentFacts: opened.factsRef,
        parentBytes: sourceBytes, segmentUid: segment.segmentUid, signal });
      await validateSemanticPartitions({ store: embedded.store, partitions: embedded.factsRef.partitions, signal });
    }
    return { manifestEntry: { ...entry, completionKey: keyFor(identity) },
      chunkCount: descriptor.chunkCount, lexiconFilterStats: descriptor.lexiconFilterStats };
  } catch (error) {
    throwIfAborted(signal);
    if (error.code === 'ERR_SEMANTIC_DISK_LIMIT' || error.code === 'EACCES' || error.code === 'EPERM') throw error;
    return null;
  }
};

/** Restore the durable locator inventory before global parser scheduling. Only
 * compact manifest entries survive the streaming pass; source bytes and semantic
 * rows are validated per file, not retained for the entire repository.
 */
export const preloadFileCompletions = async ({ entries, incrementalState, semanticContext, log = null }) => {
  const completed = new Set();
  if (!incrementalState?.enabled) return completed;
  try { await fs.access(path.join(incrementalState.bundleDir, 'completions')); }
  catch (error) { if (error.code === 'ENOENT') return completed; throw error; }
  for (const entry of entries) {
    throwIfAborted(semanticContext.signal);
    let sourceBytes;
    try { sourceBytes = await fs.readFile(entry.abs); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const receipt = await readFileCompletion({ bundleDir: incrementalState.bundleDir,
      relKey: entry.rel, sourceBytes, semanticContext });
    if (!receipt) continue;
    // Prefer an already saved same-source Stage2 entry; the descriptor remains
    // the independent fallback if that richer ordinary bundle is unusable.
    const prior = incrementalState.manifest.files[entry.rel];
    if (!prior || prior.semanticCache?.sourceUnitId !== receipt.manifestEntry.semanticCache.sourceUnitId) {
      incrementalState.manifest.files[entry.rel] = receipt.manifestEntry;
    } else {
      // Keep the richer Stage2 locator, but pin the currently verified Stage1
      // identity too. Policy changes can leave a same-source older completion
      // key in the saved manifest; cleanup must not sweep the new fallback.
      prior.completionKey = receipt.manifestEntry.completionKey;
    }
    completed.add(entry.abs);
  }
  if (completed.size && typeof log === 'function') log(`[incremental] restored ${completed.size} durable Stage1 completions before parser scheduling.`);
  return completed;
};
