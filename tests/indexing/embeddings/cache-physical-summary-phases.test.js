import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCachePhysicalSummary, compareCachePhysicalAge } from '../../../tools/build/embeddings/cache/physical-summary.js';
import { pruneCacheIndex, resolveCacheShardPath, resolveCacheEntryPath } from '../../../tools/build/embeddings/cache.js';
import { createCacheIndex } from '../../../tools/build/embeddings/cache/index-state.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('cache-physical-summary-phases');
try {
  for (const count of [64, 128, 256]) {
    const index = createCacheIndex('summary-identity'), counters = {};
    let timestampReads = 0;
    for (let ordinal = 0; ordinal < count; ordinal++) {
      index.entries[`key-${ordinal}`] = { key: `key-${ordinal}`, shard: `shard-${String(ordinal % 8).padStart(5, '0')}.bin`,
        offset: ordinal * 16 + 4, length: 12, get lastAccessAt() { timestampReads++; return new Date(1000 + ordinal).toISOString(); } };
    }
    const summary = buildCachePhysicalSummary(dir, index, { resolveShardPath: resolveCacheShardPath, resolveEntryPath: resolveCacheEntryPath, counters });
    const physical = [...summary.paths.keys()].map(filename => ({ path: filename, mtimeMs: 0 }));
    for (let repeat = 0; repeat < 4; repeat++) physical.sort((left, right) => compareCachePhysicalAge(left, right, summary));
    assert.equal(counters.summaryEntryVisits, count);
    assert.equal(timestampReads, count, 'physical comparators read only scalar summaries');
    assert.equal([...summary.paths.values()].reduce((sum, group) => sum + group.keys.length, 0), count);
  }

  for (const refuseOldest of [false, true]) {
    const cacheDir = path.join(dir, refuseOldest ? 'failed-delete' : 'normal');
    await fs.mkdir(path.join(cacheDir, 'shards'), { recursive: true });
    const index = createCacheIndex('summary-identity');
    for (let shard = 0; shard < 3; shard++) {
      const name = `shard-${String(shard).padStart(5, '0')}.bin`;
      await fs.writeFile(resolveCacheShardPath(cacheDir, name), Buffer.alloc(100));
      index.shards[name] = { sizeBytes: 100 };
      for (let row = 0; row < 2; row++) {
        const key = `s${shard}-r${row}`;
        index.entries[key] = { key, file: `${key}.js`, shard: name, sizeBytes: 0, offset: row * 44 + 4, length: 40,
          lastAccessAt: new Date(2000 + shard * 1000).toISOString() };
        index.files[`${key}.js`] = key;
      }
    }
    const orphan = resolveCacheShardPath(cacheDir, 'shard-99999.bin');
    await fs.writeFile(orphan, Buffer.alloc(100)); await fs.utimes(orphan, new Date(1000), new Date(1000));
    const originalRemove = fs.rm;
    let result;
    try {
      if (refuseOldest) fs.rm = async function (filename, ...args) {
        if (String(filename) === resolveCacheShardPath(cacheDir, 'shard-00000.bin')) throw Object.assign(new Error('injected denied removal'), { code: 'EACCES' });
        return originalRemove.call(this, filename, ...args);
      };
      result = await pruneCacheIndex(cacheDir, index, { maxBytes: 200, maxCompactionBytes: 0 });
    } finally { fs.rm = originalRemove; }
    assert.equal(result.physicalBytes, 200);
    assert.equal(result.work.summaryEntryVisits, 6, 'one phase is enough when no compaction moved pointers');
    assert.ok(result.physicalRemoved.includes(orphan));
    const removedShard = refuseOldest ? 1 : 0;
    assert.deepEqual(result.removedKeys.sort(), [`s${removedShard}-r0`, `s${removedShard}-r1`]);
    assert.equal(Object.keys(index.entries).length, 4);
    assert.equal(Object.keys(index.files).length, 4);
    if (refuseOldest) assert.ok(index.entries['s0-r0'], 'failed deletion retains its authoritative pointers');
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Embedding physical summaries use linear phase visits and preserve deterministic orphan, shard and failed-removal retention.');
