#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readCachedBundle } from '../../../src/index/build/incremental/state-reconciliation.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { createSemanticCacheDependencySignatures } from '../../../src/index/build/incremental/semantic-cache-dependencies.js';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';

const fixture = await createSemanticCacheFixture();
try {
  const file = await fixture.createFile();
  const generation = { baseBuildId: 'reader-warm', semanticRevision: 0 };
  const options = { enabled: true, absPath: path.join(fixture.repoRoot, file.file), relKey: file.file,
    fileStat: { size: file.bytes.length, mtimeMs: file.entry.mtimeMs }, manifest: fixture.manifest,
    bundleDir: fixture.bundleDir, semanticContext: {
      buildRoot: path.join(fixture.root, 'reader-warm'), storage: { generation, relativePath: 'index-code/semantic' },
      dependencySignatures: fixture.dependencies, repositoryNamespace: fixture.repoRoot,
      diskAccount: createSemanticDiskAccount(16 * 1024 * 1024)
    } };
  const cached = await readCachedBundle(options);
  assert.ok(cached.cachedBundle);
  assert.equal(cached.semanticFactsRef.canonicalHash, file.factsRef.canonicalHash);
  assert.deepEqual(cached.semanticFactsRef.storage.generation, generation);
  for (const partition of cached.semanticFactsRef.partitions) {
    for (const member of Object.values(partition.members)) {
      for (const piece of member) assert.ok(piece.path.startsWith('semantic-cache-'), 'warm facts come from cache relocation');
    }
  }
  assert.deepEqual(fixture.manifest.semanticGeneration, generation);
  assert.ok(cached.buffer.equals(file.bytes));
  const noFacts = { ...fixture.manifest, files: { [file.file]: { ...file.entry, semanticCache: undefined } } };
  assert.equal((await readCachedBundle({ ...options, manifest: noFacts })).cachedBundle, null,
    'missing descriptor cannot authorize reuse of clipped legacy relation bundles');
  const changedDependencies = createSemanticCacheDependencySignatures({
    dependencySignatures: fixture.dependencySignatures, root: fixture.repoRoot,
    policy: { ...fixture.policy, enrichment: { ...fixture.policy.enrichment, fieldPathDepth: 5 } }
  });
  assert.equal(changedDependencies.semantic, fixture.dependencies.semantic,
    'flow policy does not invalidate exact syntax extraction');
  assert.notEqual(changedDependencies.semanticAnalysis, fixture.dependencies.semanticAnalysis);
  const syntaxReuse = await readCachedBundle({ ...options, semanticContext: {
    ...options.semanticContext, dependencySignatures: changedDependencies
  } });
  assert.ok(syntaxReuse.cachedBundle, 'syntax-only snapshots survive analysis policy changes');
  assert.equal(syntaxReuse.semanticFactsRef.extractionHash, file.factsRef.extractionHash);
  const changedParser = createSemanticCacheDependencySignatures({
    dependencySignatures: fixture.dependencySignatures, root: fixture.repoRoot, policy: fixture.policy,
    languageOptions: { javascript: { sourceType: 'script' } }
  });
  assert.notEqual(changedParser.semantic, fixture.dependencies.semantic);
  assert.equal((await readCachedBundle({ ...options, semanticContext: {
    ...options.semanticContext, dependencySignatures: changedParser
  } })).cachedBundle, null, 'parser policy changes invalidate syntax reuse');
  await fs.writeFile(options.absPath, 'g(1);');
  assert.equal((await readCachedBundle(options)).cachedBundle, null,
    'same-size current source tamper cannot pass via an unchanged stat signature');
  assert.deepEqual(await fs.readFile(path.join(fixture.buildRoot, fixture.storage.relativePath,
    'semantic-sources', file.source.byteHash + '.utf8')), file.bytes);
  console.log('semantic warm reader requires exact source, extraction policy and complete descriptors');
} finally { await fixture.cleanup(); }
