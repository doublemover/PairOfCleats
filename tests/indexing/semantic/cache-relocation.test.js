#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { persistSemanticCacheEntry, relocateSemanticCacheEntry, openSemanticCacheEntry } from '../../../src/index/build/incremental/semantic-cache.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';

const fixture = await createSemanticCacheFixture();
try {
  const file = await fixture.createFile({ text: '/* 🧭 */\r\nf(1);' });
  const locator = file.entry.semanticCache;
  const used = fixture.account.used;
  const same = await persistSemanticCacheEntry({ bundleDir: fixture.bundleDir,
    factsRef: { ...file.factsRef, storage: { ...file.factsRef.storage,
      generation: { baseBuildId: 'another-build', semanticRevision: 0 } } },
    buildRoot: fixture.buildRoot, dependencySignatures: fixture.dependencies, diskAccount: fixture.account });
  assert.deepEqual(same, locator, 'cache identity is independent of the producer generation');
  assert.equal(fixture.account.used, used, 'idempotent cache write never charges the same files twice');
  const recollected = await fixture.createFile({ text: file.bytes.toString() });
  assert.notEqual(recollected.partition.members.semantic_records[0].path, file.partition.members.semantic_records[0].path);
  assert.equal(recollected.factsRef.canonicalHash, file.factsRef.canonicalHash);
  assert.deepEqual(recollected.entry.semanticCache, locator, 'equivalent recollection preserves the first immutable physical cache layout');
  const targetBuildRoot = path.join(fixture.root, 'warm-build');
  const storage = { generation: { baseBuildId: 'warm-build', semanticRevision: 0 }, relativePath: 'index-code/semantic' };
  const account = createSemanticDiskAccount(16 * 1024 * 1024);
  const options = { bundleDir: fixture.bundleDir, locator, dependencySignatures: fixture.dependencies,
    sourceHash: file.source.byteHash, sourcePath: file.file, repositoryNamespace: fixture.repoRoot,
    targetBuildRoot, storage, diskAccount: account };
  const relocated = await relocateSemanticCacheEntry(options);
  assert.equal(relocated.canonicalHash, file.factsRef.canonicalHash);
  assert.equal(relocated.extractionHash, file.factsRef.extractionHash);
  assert.deepEqual(relocated.storage, storage);
  assert.notEqual(relocated.partitions[0].members.semantic_records[0].path,
    file.partition.members.semantic_records[0].path);
  const store = createArtifactSemanticStore({ root: path.join(targetBuildRoot, storage.relativePath),
    repoRoot: fixture.repoRoot, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: storage.generation,
    partitions: relocated.partitions });
  await validateSemanticPartitions({ store, partitions: relocated.partitions });
  const ref = { partitionId: relocated.syntaxPartitionId, localId: 0 };
  assert.equal((await store.getSourceSpans([ref]))[0].text, file.bytes.toString());
  const retry = await relocateSemanticCacheEntry(options);
  assert.equal(retry.canonicalHash, relocated.canonicalHash);
  const partCost = Object.values(retry.partitions[0].members).flat().reduce((n, piece) => n + piece.bytes + piece.count * 8, 0);
  assert.equal(account.used, partCost * 2 + file.bytes.length, 'generation-local shared source is charged once');
  await assert.rejects(relocateSemanticCacheEntry({ ...options, sourcePath: 'renamed.js' }), { code: 'ERR_SEMANTIC_CACHE_MISMATCH' });
  await assert.rejects(relocateSemanticCacheEntry({ ...options, sourceHash: 'f'.repeat(64) }), { code: 'ERR_SEMANTIC_CACHE_MISMATCH' });
  await assert.rejects(relocateSemanticCacheEntry({ ...options,
    dependencySignatures: { ...fixture.dependencies, semantic: 'e'.repeat(64) } }), { code: 'ERR_SEMANTIC_CACHE_MISMATCH' });
  await assert.rejects(openSemanticCacheEntry({ bundleDir: fixture.bundleDir,
    locator: { ...locator, artifactSurfaceVersion: 'old' }, expectedDependencySignatures: fixture.dependencies }),
  { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' });
  const insufficient = createSemanticDiskAccount(0);
  await assert.rejects(relocateSemanticCacheEntry({ ...options, targetBuildRoot: path.join(fixture.root, 'denied'),
    diskAccount: insufficient }), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  assert.equal(insufficient.used, 0);
  const originalPath = path.join(fixture.buildRoot, fixture.storage.relativePath, file.partition.members.semantic_records[0].path);
  const oldBytes = await fs.readFile(originalPath);
  const cache = await openSemanticCacheEntry({ bundleDir: fixture.bundleDir, locator, expectedDependencySignatures: fixture.dependencies });
  await fs.appendFile(path.join(cache.root, file.partition.members.semantic_records[0].path), ' ');
  await assert.rejects(relocateSemanticCacheEntry(options), { code: 'ERR_SEMANTIC_INTEGRITY' });
  assert.deepEqual(await fs.readFile(originalPath), oldBytes, 'cache copies cannot corrupt the producer generation');
  assert.equal((await store.getSourceSpans([ref]))[0].text, file.bytes.toString(), 'warm copy survives cache corruption');
  console.log('portable semantic cache relocation, identity, admission and generation isolation passed');
} finally { await fixture.cleanup(); }
