import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createVfsColdStartCache } from '../../../src/index/tooling/vfs/cold-start.js';
import { createColdStartEntryOwner, VFS_COLD_METADATA_MAX_BYTES, VFS_COLD_MAX_ROW_BYTES } from '../../../src/index/tooling/vfs/cold-start-owner.js';
import { VFS_COLD_START_SCHEMA_VERSION, VFS_COLD_START_DIR, VFS_COLD_START_DATA, VFS_COLD_START_META } from '../../../src/index/tooling/vfs/constants.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('vfs-bound');
try {
  const cacheRoot = path.join(dir, 'live'), options = { cacheRoot, indexSignature: 'bounded-source', manifestHash: 'bounded-manifest',
    config: { enabled: true, cacheRoot, maxBytes: 800, maxAgeDays: 1 } };
  const cache = await createVfsColdStartCache(options);
  for (let index = 0; index < 32; index++) {
    const diskPath = path.join(dir, `doc-${index}`); await fs.writeFile(diskPath, 'document');
    assert.equal(cache.set({ virtualPath: `.poc-vfs/${index}`, docHash: `hash-${index}`, diskPath, sizeBytes: 250 }), true);
    assert.ok(cache.size() <= 3, 'one live instance is bounded before any flush');
    assert.ok(cache.stats().payloadBytes <= 800); assert.ok(cache.stats().metadataBytes <= cache.stats().maxMetadataBytes);
    if (index % 4 === 3) {
      await cache.flush(); assert.ok(cache.size() <= 3, 'flush cannot retain a larger hidden live set');
      assert.equal(cache.stats().persistedRevision, cache.stats().revision);
    }
  }
  assert.ok(cache.stats().evictions > 0); assert.equal(cache.stats().flushes, 8);
  const restored = await createVfsColdStartCache(options);
  assert.ok(restored.size() <= 3); assert.ok(restored.stats().loadedRows <= 3);
  assert.equal(restored.stats().loadStatus, 'loaded');
  const stable = cache.stats();
  for (const sizeBytes of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(cache.set({
    virtualPath: 'invalid', docHash: 'invalid', diskPath: path.join(dir, 'invalid'), sizeBytes
  }), false);
  assert.equal(cache.size(), stable.entries);
  assert.equal(cache.set({ virtualPath: 'oversized', docHash: 'oversized', diskPath: path.join(dir, 'oversized'), sizeBytes: 801 }), false);
  assert.ok(cache.stats().oversized > 0);
  const disabled = await createVfsColdStartCache({ ...options, config: { ...options.config, maxBytes: 0 } });
  assert.equal(disabled.size(), 0); assert.equal(disabled.stats().loadStatus, 'disabled-budget');
  assert.equal(disabled.set({ virtualPath: 'zero', docHash: 'zero', diskPath: path.join(dir, 'zero'), sizeBytes: 0 }), false);

  let clock = Date.UTC(2026, 9, 26);
  const row = (name, bytes = 0, padding = '') => Object.freeze({ schemaVersion: VFS_COLD_START_SCHEMA_VERSION,
    virtualPath: name, docHash: name + padding, diskPath: path.join(dir, name), sizeBytes: bytes, updatedAt: new Date(clock).toISOString() });
  const tiny = createColdStartEntryOwner({ maxBytes: 800, maxAgeMs: 1000, now: () => clock, maxEntries: 3, maxMetadataBytes: 1000 });
  for (let index = 0; index < 40; index++) { tiny.admit(row(`zero-${index}`)); assert.ok(tiny.size() <= 3); }
  assert.ok(tiny.stats().evictions > 0); assert.ok(tiny.stats().metadataBytes <= 1000);
  for (let index = 0; index < 500; index++) tiny.admit(row('hot'));
  assert.ok(tiny.stats().heapEntries <= tiny.size() * 2 + 128, 'updates cannot grow stale heap ownership indefinitely');
  assert.ok(tiny.stats().heapRebuilds > 0);
  assert.equal(tiny.admit(row('metadata-large', 0, 'x'.repeat(1001))), false);
  clock += 2000; assert.equal(tiny.size(), 0); assert.ok(tiny.stats().expired > 0);

  for (const scenario of ['file-bytes', 'row-bytes', 'row-count', 'late-invalid', 'wrong-shape', 'stale-source']) {
    const root = path.join(dir, scenario), base = path.join(root, VFS_COLD_START_DIR);
    await fs.mkdir(base, { recursive: true });
    const data = path.join(base, VFS_COLD_START_DATA), meta = path.join(base, VFS_COLD_START_META);
    const valid = { ...row('candidate', 1), updatedAt: new Date().toISOString() };
    let body = JSON.stringify(valid) + '\n', entries = 1, bytes = 1;
    if (scenario === 'row-bytes') body = JSON.stringify({ ...valid, padding: 'x'.repeat(VFS_COLD_MAX_ROW_BYTES) }) + '\n';
    if (scenario === 'row-count') { body = '\n'.repeat(50001); entries = 0; bytes = 0; }
    if (scenario === 'late-invalid') { body += '{broken\n'; entries = 2; }
    if (scenario === 'wrong-shape') body = JSON.stringify({ ...valid, sizeBytes: -1 }) + '\n';
    await fs.writeFile(data, body);
    if (scenario === 'file-bytes') await fs.truncate(data, VFS_COLD_METADATA_MAX_BYTES + 1);
    await fs.writeFile(meta, JSON.stringify({ schemaVersion: VFS_COLD_START_SCHEMA_VERSION,
      indexSignature: scenario === 'stale-source' ? 'different' : 'bounded-source', manifestHash: 'bounded-manifest', entries, bytes }));
    const rejected = await createVfsColdStartCache({ ...options, cacheRoot: root, config: { ...options.config, cacheRoot: root } });
    assert.equal(rejected.size(), 0, `${scenario}: rejected input cannot publish a partial live cache`);
    assert.equal(rejected.stats().loadStatus, scenario === 'stale-source' ? 'stale-source' : 'rejected-input');
    if (scenario === 'file-bytes' || scenario === 'stale-source') assert.equal(rejected.stats().loadedInputBytes, 0);
    if (scenario === 'late-invalid') assert.equal(rejected.stats().loadedRows, 1);
    if (scenario === 'row-count') assert.equal(rejected.stats().loadedRows, 0);
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('One VFS cold-cache owner bounds live payload/metadata/counts, expiry, update history and streamed input before persistence.');
