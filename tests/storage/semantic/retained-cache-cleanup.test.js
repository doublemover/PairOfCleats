import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';
import { pruneSemanticCache } from '../../../src/index/build/incremental/semantic-cache-gc.js';
import { pruneIncrementalManifest, updateBundlesWithChunks } from '../../../src/index/build/incremental/writeback.js';
import { readFileCompletion } from '../../../src/index/build/incremental/file-completion.js';
import { reopenSemanticDiskAccount } from '../../../src/index/build/incremental/working-set.js';

const fixture = await createSemanticCacheFixture();
try {
  const old = await fixture.createFile({ text: 'old(1);' });
  const current = await fixture.createFile({ text: 'newer(2);' });
  const deleted = await fixture.createFile({ file: 'deleted.js' });
  const completionPath = path.join(fixture.bundleDir, 'completions', current.entry.completionKey + '.json');
  const descriptor = await fs.readFile(completionPath);
  const abandoned = path.join(fixture.bundleDir, 'semantic', '.pending-interrupted-worker');
  await fs.mkdir(abandoned);
  await fs.writeFile(path.join(abandoned, 'partial'), 'unfinished');
  fixture.account.reserve(10);
  const stage1 = current.entry.bundles[0];
  await updateBundlesWithChunks({ enabled: true, repoRoot: fixture.repoRoot, manifest: fixture.manifest,
    manifestPath: path.join(fixture.root, 'manifest.json'), bundleDir: fixture.bundleDir,
    chunks: current.chunks.map(chunk => ({ ...chunk, id: 1 })), fileRelations: new Map(),
    diskAccount: fixture.account, log: () => {} });
  const stage2 = fixture.manifest.files[current.file].bundles[0];
  assert.notEqual(stage2, stage1, 'Stage2 uses a separate snapshot');
  // Missing authority defers the entire sweep, including otherwise obvious garbage.
  await fs.unlink(completionPath);
  assert.equal((await pruneSemanticCache({ bundleDir: fixture.bundleDir, manifest: fixture.manifest })).deferred, 'incomplete_inventory');
  await fs.access(abandoned);
  await fs.writeFile(completionPath, descriptor);
  const linkedGarbage = path.join(fixture.bundleDir, 'semantic', '.pending-link');
  await fs.symlink(path.join(fixture.bundleDir, 'semantic', current.entry.semanticCache.cacheKey), linkedGarbage, 'junction');
  await assert.rejects(pruneSemanticCache({ bundleDir: fixture.bundleDir, manifest: fixture.manifest }), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
  await fs.access(abandoned);
  await fs.access(path.join(linkedGarbage, 'descriptor.json'));
  await fs.unlink(linkedGarbage);
  const before = fixture.account.used;
  const diskBefore = await reopenSemanticDiskAccount({ roots: [fixture.bundleDir], limit: Number.MAX_SAFE_INTEGER });
  await pruneIncrementalManifest({ enabled: true, manifest: fixture.manifest,
    manifestPath: path.join(fixture.root, 'manifest.json'), bundleDir: fixture.bundleDir,
    seenFiles: new Set([current.file]), diskAccount: fixture.account });
  const diskAfter = await reopenSemanticDiskAccount({ roots: [fixture.bundleDir], limit: Number.MAX_SAFE_INTEGER });
  assert.ok(diskAfter.retainedBytes < diskBefore.retainedBytes);
  assert.equal(before - fixture.account.used, diskBefore.retainedBytes - diskAfter.retainedBytes);
  for (const stale of [old, deleted]) {
    await assert.rejects(fs.access(path.join(fixture.bundleDir, 'completions', stale.entry.completionKey + '.json')), { code: 'ENOENT' });
    await assert.rejects(fs.access(path.join(fixture.bundleDir, 'semantic', stale.entry.semanticCache.cacheKey)), { code: 'ENOENT' });
  }
  await assert.rejects(fs.access(abandoned), { code: 'ENOENT' });
  await fs.access(path.join(fixture.bundleDir, stage2));
  assert.ok(await readFileCompletion({ bundleDir: fixture.bundleDir, relKey: current.file, sourceBytes: current.bytes,
    semanticContext: { repoRoot: fixture.repoRoot, repositoryNamespace: fixture.repoRoot, dependencySignatures: fixture.dependencies } }));
  assert.deepEqual(await fs.readFile(completionPath), descriptor);
  assert.deepEqual(await pruneSemanticCache({ bundleDir: fixture.bundleDir, manifest: fixture.manifest,
    diskAccount: fixture.account }), { removedFiles: 0, removedBytes: 0 });
  console.log('retained cache cleanup preserves Stage1/Stage2 pins and returns only deleted storage');
} finally { await fixture.cleanup(); }
