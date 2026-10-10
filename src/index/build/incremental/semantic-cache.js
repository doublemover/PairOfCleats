import fs from 'node:fs/promises';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { assertCurrentIndexFormat } from '../../../contracts/index-format.js';
import { assertSemanticEnvelope } from '../../../contracts/validators/semantic-envelopes.js';
import { canonicalSemanticJson, semanticHash } from '../../semantic/identity.js';
import { validateSemanticPartitions } from '../../semantic/reconcile.js';
import { createArtifactSemanticStore, resolveSemanticPartPath } from '../../../semantic/artifact-store.js';
import { throwIfAborted } from '../../../shared/abort.js';

const fail = (message, code = 'ERR_SEMANTIC_CACHE_INTEGRITY') => Object.assign(new Error(message), { code });
const MAX_DESCRIPTOR_BYTES = 32 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const dependencyHash = (signatures) => {
  if (!signatures || typeof signatures !== 'object' || Array.isArray(signatures)
    || !HASH.test(signatures.semantic)) {
    throw new TypeError('Semantic cache dependency signatures are required.');
  }
  return semanticHash('pairofcleats.semantic.cache-dependencies.v1', signatures);
};
const cacheKeyFor = (factsRef, signatures) => semanticHash('pairofcleats.semantic.cache-entry.v1', {
  canonicalHash: factsRef.canonicalHash, dependencyHash: dependencyHash(signatures)
});
const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assertLocator = (locator, bundleDir, repoRoot) => {
  assertCurrentIndexFormat({ operation: 'resume', component: 'semantic cache locator',
    foundVersion: locator?.artifactSurfaceVersion, repoRoot, indexPath: bundleDir });
  if (locator?.schemaVersion !== 1 || !HASH.test(locator.cacheKey) || !HASH.test(locator.descriptorHash)
    || !HASH.test(locator.canonicalHash) || !HASH.test(locator.extractionHash)
    || !/^su1:[a-f0-9]{64}$/.test(locator.sourceUnitId)
    || Object.keys(locator).some(key => !['schemaVersion', 'artifactSurfaceVersion', 'cacheKey',
      'descriptorHash', 'canonicalHash', 'extractionHash', 'sourceUnitId'].includes(key))) {
    throw fail('Invalid semantic cache locator.');
  }
};

/** Open one immutable per-file cache object; callers validate dependencies before reuse. */
export const openSemanticCacheEntry = async ({ repoRoot = process.cwd(), bundleDir, locator, expectedDependencySignatures,
  expectedSourceHash = null, expectedSourceUnitId = null, expectedSourcePath = null,
  expectedRepositoryNamespace = null, signal = null }) => {
  assertLocator(locator, bundleDir, repoRoot);
  throwIfAborted(signal);
  const relative = 'semantic/' + locator.cacheKey;
  const descriptorPath = await resolveSemanticPartPath(bundleDir, relative + '/descriptor.json');
  if ((await fs.stat(descriptorPath)).size > MAX_DESCRIPTOR_BYTES) throw fail('Semantic cache descriptor exceeds allowance.');
  const bytes = await fs.readFile(descriptorPath);
  if (hashBytes(bytes) !== locator.descriptorHash) throw fail('Semantic cache descriptor checksum mismatch.');
  const envelope = JSON.parse(bytes.toString('utf8'));
  assertCurrentIndexFormat({ operation: 'resume', component: 'semantic cache object',
    foundVersion: envelope.artifactSurfaceVersion, repoRoot, indexPath: descriptorPath });
  assertCurrentIndexFormat({ operation: 'resume', component: 'semantic cache schema', expectedVersion: 1,
    foundVersion: envelope.schemaVersion, repoRoot, indexPath: descriptorPath });
  if (Object.keys(envelope).some(key => !['schemaVersion', 'artifactSurfaceVersion', 'dependencySignatures', 'factsRef'].includes(key))) {
    throw fail('Unknown semantic cache object fields.');
  }
  const factsRef = assertSemanticEnvelope('fileFactsRef', envelope.factsRef);
  if (cacheKeyFor(factsRef, envelope.dependencySignatures) !== locator.cacheKey
    || factsRef.canonicalHash !== locator.canonicalHash || factsRef.extractionHash !== locator.extractionHash
    || factsRef.sourceUnitId !== locator.sourceUnitId) throw fail('Semantic cache locator/content identity mismatch.');
  if (dependencyHash(envelope.dependencySignatures) !== dependencyHash(expectedDependencySignatures)) {
    throw fail('Semantic cache dependency identity changed.', 'ERR_SEMANTIC_CACHE_MISMATCH');
  }
  for (const [expected, actual] of [[expectedSourceHash, factsRef.sourceHash],
    [expectedSourceUnitId, factsRef.sourceUnitId], [expectedRepositoryNamespace, factsRef.repositoryNamespace]]) {
    if (expected !== null && expected !== actual) throw fail('Semantic cache source identity changed.', 'ERR_SEMANTIC_CACHE_MISMATCH');
  }
  if (factsRef.storage.relativePath !== 'parts') throw fail('Invalid semantic cache object storage.');
  const root = await resolveSemanticPartPath(bundleDir, relative + '/parts');
  const store = createArtifactSemanticStore({ root, repoRoot,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: factsRef.storage.generation,
    partitions: factsRef.partitions });
  if (expectedSourcePath !== null) {
    for await (const source of store.iterateRows(factsRef.syntaxPartitionId, 'semantic_sources', { signal })) {
      if (source.path !== expectedSourcePath) throw fail('Semantic cache source path changed.', 'ERR_SEMANTIC_CACHE_MISMATCH');
    }
  }
  return { factsRef, store, root, dependencySignatures: envelope.dependencySignatures };
};

/** Copy exact files into an owned directory, never hard-linking a published generation. */
const copyFactsFiles = async ({ factsRef, store, sourceRoot, targetRoot, diskAccount, signal }) => {
  if (!diskAccount || typeof diskAccount.reserve !== 'function') throw new TypeError('Shared semantic disk account required.');
  let reserved = 0;
  const copied = new Set();
  const copy = async (relative, size) => {
    if (copied.has(relative)) return;
    throwIfAborted(signal);
    const source = await resolveSemanticPartPath(sourceRoot, relative);
    const destination = path.join(targetRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    diskAccount.reserve(size); reserved += size;
    await fs.copyFile(source, destination, fsConstants.COPYFILE_EXCL);
    const handle = await fs.open(destination, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    throwIfAborted(signal);
    copied.add(relative);
  };
  try {
    for (const partition of factsRef.partitions) {
      for (const pieces of Object.values(partition.members)) for (const piece of pieces) {
        await copy(piece.path, piece.bytes);
        await copy(piece.offsetsPath, piece.count * 8);
      }
      for await (const source of store.iterateRows(partition.partitionId, 'semantic_sources', { signal })) {
        if (source.sourceUnitId !== factsRef.sourceUnitId || source.byteHash !== factsRef.sourceHash
          || source.repositoryNamespace !== factsRef.repositoryNamespace) throw fail('Semantic cache source manifest differs from descriptor.');
        await copy('semantic-sources/' + source.byteHash + '.utf8', source.byteLength);
        if (source.mapping) {
          const relative = source.mapping.mapRef;
          if (!/^semantic-evidence\/[a-f0-9]{64}\.json$/.test(relative)) throw fail('Invalid source mapping evidence path.');
          const mapBytes = await fs.readFile(await resolveSemanticPartPath(sourceRoot, relative));
          if (hashBytes(mapBytes) !== path.basename(relative, '.json')) throw fail('Source mapping evidence checksum mismatch.');
          const mapping = JSON.parse(mapBytes.toString('utf8'));
          if (semanticHash('semantic.embedded-map.v1', mapping) !== source.mapping.identity) throw fail('Source mapping evidence identity mismatch.');
          await copy(relative, mapBytes.length);
        }
      }
    }
    return reserved;
  } catch (error) { diskAccount.release(reserved); throw error; }
};

/** Persist descriptor and parts once per file; bundle shards contain no semantic payload. */
export const persistSemanticCacheEntry = async ({ repoRoot = process.cwd(), bundleDir, factsRef, buildRoot,
  dependencySignatures, diskAccount, signal = null }) => {
  assertSemanticEnvelope('fileFactsRef', factsRef);
  const cacheKey = cacheKeyFor(factsRef, dependencySignatures);
  const cacheRoot = path.join(bundleDir, 'semantic');
  await fs.mkdir(cacheRoot, { recursive: true });
  const finalRoot = path.join(cacheRoot, cacheKey);
  const portable = { ...structuredClone(factsRef), storage: {
    generation: { baseBuildId: 'semantic-cache-' + cacheKey, semanticRevision: 0 }, relativePath: 'parts' } };
  const envelope = { schemaVersion: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    dependencySignatures, factsRef: portable };
  const bytes = Buffer.from(canonicalSemanticJson(envelope) + '\n');
  if (bytes.length > MAX_DESCRIPTOR_BYTES) throw fail('Semantic cache descriptor exceeds allowance.');
  const locator = { schemaVersion: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, cacheKey,
    descriptorHash: hashBytes(bytes), canonicalHash: factsRef.canonicalHash,
    extractionHash: factsRef.extractionHash, sourceUnitId: factsRef.sourceUnitId };
  try {
    await fs.access(finalRoot);
    // Physical part paths may differ after an equivalent recollection. Reuse the
    // first validated layout for this canonical identity rather than replacing it.
    const existingDescriptor = await resolveSemanticPartPath(bundleDir, 'semantic/' + cacheKey + '/descriptor.json');
    if ((await fs.stat(existingDescriptor)).size > MAX_DESCRIPTOR_BYTES) throw fail('Semantic cache descriptor exceeds allowance.');
    const existingLocator = { ...locator, descriptorHash: hashBytes(await fs.readFile(existingDescriptor)) };
    const existing = await openSemanticCacheEntry({ repoRoot, bundleDir, locator: existingLocator, expectedDependencySignatures: dependencySignatures, signal });
    await validateSemanticPartitions({ store: existing.store, partitions: existing.factsRef.partitions, signal });
    return existingLocator;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sourceRoot = await resolveSemanticPartPath(buildRoot, factsRef.storage.relativePath);
  const store = createArtifactSemanticStore({ root: sourceRoot, repoRoot,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: factsRef.storage.generation, partitions: factsRef.partitions });
  await validateSemanticPartitions({ store, partitions: factsRef.partitions, signal });
  const temporary = await fs.mkdtemp(path.join(cacheRoot, '.pending-'));
  const targetRoot = path.join(temporary, 'parts');
  let reserved = 0;
  try {
    reserved = await copyFactsFiles({ factsRef, store, sourceRoot, targetRoot, diskAccount, signal });
    const copiedStore = createArtifactSemanticStore({ root: targetRoot, repoRoot,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: portable.storage.generation, partitions: portable.partitions });
    await validateSemanticPartitions({ store: copiedStore, partitions: portable.partitions, signal });
    diskAccount.reserve(bytes.length); reserved += bytes.length;
    const handle = await fs.open(path.join(temporary, 'descriptor.json'), 'wx');
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    throwIfAborted(signal);
    await fs.rename(temporary, finalRoot);
    return locator;
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    diskAccount.release(reserved);
    throw error;
  }
};

/** Return a verified descriptor rebased to the new immutable whole-build generation. */
export const relocateSemanticCacheEntry = async ({ repoRoot = process.cwd(), bundleDir, locator, dependencySignatures,
  sourceHash, sourcePath, repositoryNamespace, targetBuildRoot, storage, diskAccount, evidenceArtifacts = [], signal = null }) => {
  if (!HASH.test(sourceHash) || typeof sourcePath !== 'string' || !sourcePath
    || typeof repositoryNamespace !== 'string' || !repositoryNamespace) {
    throw new TypeError('Current semantic source hash and repository namespace are required.');
  }
  const opened = await openSemanticCacheEntry({ repoRoot, bundleDir, locator,
    expectedDependencySignatures: dependencySignatures, expectedSourceHash: sourceHash,
    expectedSourcePath: sourcePath, expectedRepositoryNamespace: repositoryNamespace, signal });
  assertSemanticEnvelope('fileFactsRef', { ...opened.factsRef, storage });
  if (opened.factsRef.partitions.some(partition => partition.members.semantic_frontier.some(piece => piece.count > 0))) {
    throw fail('Generation-pinned deferred work cannot be relocated through the per-file syntax cache; rebuild its task from current source facts.', 'ERR_SEMANTIC_CACHE_MISMATCH');
  }
  await validateSemanticPartitions({ store: opened.store, partitions: opened.factsRef.partitions, signal });
  await fs.mkdir(targetBuildRoot, { recursive: true });
  // Validate the destination directory through the same containment boundary as parts.
  await fs.mkdir(path.join(targetBuildRoot, storage.relativePath), { recursive: true });
  const parent = await resolveSemanticPartPath(targetBuildRoot, storage.relativePath);
  const temporary = await fs.mkdtemp(path.join(parent, 'semantic-cache-'));
  let reserved = 0;
  let retainedSourceBytes = 0, retainedEvidenceBytes = 0;
  try {
    reserved = await copyFactsFiles({ factsRef: opened.factsRef, store: opened.store,
      sourceRoot: opened.root, targetRoot: temporary, diskAccount, signal });
    const partitions = structuredClone(opened.factsRef.partitions);
    const prefix = path.basename(temporary);
    for (const partition of partitions) for (const pieces of Object.values(partition.members)) for (const piece of pieces) {
      piece.path = prefix + '/' + piece.path;
      piece.offsetsPath = prefix + '/' + piece.offsetsPath;
    }
    // Source retention uses one generation-local content-addressed directory.
    const sourceDirectory = path.join(parent, 'semantic-sources');
    await fs.mkdir(sourceDirectory, { recursive: true });
    const copiedSource = path.join(temporary, 'semantic-sources', opened.factsRef.sourceHash + '.utf8');
    const sourceTarget = path.join(sourceDirectory, opened.factsRef.sourceHash + '.utf8');
    const sourceBytes = (await fs.stat(copiedSource)).size;
    try { await fs.link(copiedSource, sourceTarget); retainedSourceBytes = sourceBytes; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const check = createArtifactSemanticStore({ root: parent, repoRoot,
        artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: storage.generation, partitions });
      const sources = opened.store.iterateRows(opened.factsRef.syntaxPartitionId, 'semantic_sources', { signal });
      for await (const source of sources) await check.verifySource(source, { signal });
      diskAccount.release(sourceBytes); reserved -= sourceBytes;
    }
    await fs.rm(path.join(temporary, 'semantic-sources'), { recursive: true, force: true });
    for await (const source of opened.store.iterateRows(opened.factsRef.syntaxPartitionId, 'semantic_sources', { signal })) if (source.mapping) {
      const relative = source.mapping.mapRef, from = await resolveSemanticPartPath(temporary, relative), bytes = await fs.readFile(from), target = path.join(parent, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      try { await fs.link(from, target); retainedEvidenceBytes += bytes.length; }
      catch (error) { if (error.code !== 'EEXIST') throw error; if (!(await fs.readFile(target)).equals(bytes)) throw fail('Retained source mapping collision.'); diskAccount.release(bytes.length); reserved -= bytes.length; }
      const record = { path: relative, hash: hashBytes(bytes), bytes: bytes.length };
      if (!evidenceArtifacts.some(entry => entry.path === relative)) evidenceArtifacts.push(record);
    }
    const result = { ...opened.factsRef, storage: structuredClone(storage), partitions };
    assertSemanticEnvelope('fileFactsRef', result);
    const store = createArtifactSemanticStore({ root: parent, repoRoot,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: storage.generation, partitions });
    await validateSemanticPartitions({ store, partitions, signal });
    throwIfAborted(signal);
    return result;
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    diskAccount.release(reserved - retainedSourceBytes - retainedEvidenceBytes);
    throw error;
  }
};
