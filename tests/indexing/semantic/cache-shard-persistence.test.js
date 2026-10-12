#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readBundleFile } from '../../../src/shared/bundle-io.js';
import { updateBundlesWithChunks } from '../../../src/index/build/incremental/writeback.js';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';

const fixture = await createSemanticCacheFixture();
try {
  const payload = 'x'.repeat(9 * 1024 * 1024);
  const chunks = [0, 1].map(id => ({ id, file: 'large.js', start: 0, end: 5, text: payload, tokens: ['fixture'] }));
  const file = await fixture.createFile({ file: 'large.js', chunks });
  assert.equal(file.entry.bundles.length, 2, 'fixture must exercise multiple physical chunk shards');
  const descriptorDirectories = await fs.readdir(path.join(fixture.bundleDir, 'semantic'));
  assert.equal(descriptorDirectories.length, 1, 'all chunk shards share one immutable file object');
  for (const name of file.entry.bundles) {
    const { bundle } = await readBundleFile(path.join(fixture.bundleDir, name));
    assert.equal(Object.hasOwn(bundle, 'semanticFactsRef'), false);
    assert.equal(Object.hasOwn(bundle, 'semanticCache'), false);
    assert.equal(bundle.chunks.length, 1);
  }
  const locator = structuredClone(file.entry.semanticCache);
  const relations = { calls: ['f'], callDetails: [{ callee: 'f', args: [1, 2, 3, 4, 5, 6] }] };
  await updateBundlesWithChunks({ enabled: true, manifest: fixture.manifest, bundleDir: fixture.bundleDir,
    chunks: file.chunks, fileRelations: new Map([[file.file, relations]]), log: () => {} });
  assert.deepEqual(fixture.manifest.files[file.file].semanticCache, locator,
    'stage2 relation rewrites preserve the independent complete file-facts object');
  const zero = await fixture.createFile({ file: 'empty.js', text: '', zeroChunks: true, nodeCount: 0 });
  assert.ok(zero.entry.semanticCache);
  assert.equal(zero.factsRef.counts.semantic_records, 0);
  const { bundle } = await readBundleFile(path.join(fixture.bundleDir, zero.entry.bundles[0]));
  assert.deepEqual(bundle.chunks, []);
  console.log('semantic facts persist once per file across chunk sharding and zero-chunk bundles');
} finally { await fixture.cleanup(); }
