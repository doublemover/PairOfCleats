import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import v8 from 'node:v8';
import { syncBuiltinESMExports } from 'node:module';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import { readJsonFile, readJsonLinesArraySync } from '../../../src/shared/artifact-io/json.js';
import { decompressBuffer } from '../../../src/shared/artifact-io/compression.js';
import { loadOptionalSyncWithFallback } from '../../../src/shared/artifact-io/optional-fallback.js';
import { createArtifactPresenceHelpers } from '../../../src/index/validate/presence.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('zstd-sync-capacity-classification');
const limit = 512, originalHeap = v8.getHeapStatistics;
try {
  for (const kind of ['json', 'jsonl']) for (const size of [limit - 1, limit, limit + 1, limit + 1024, limit + 1025]) {
    const suffix = kind === 'jsonl' ? '\n' : '', base = Buffer.byteLength(JSON.stringify({ text: '' }) + suffix);
    const row = { text: 'x'.repeat(size - base) }, raw = Buffer.from(JSON.stringify(row) + suffix), encoded = zstdCompressSync(raw);
    assert.equal(raw.length, size); assert.ok(encoded.length < limit);
    const nominal = path.join(dir, `${kind}-${size}.${kind}`), source = nominal + '.zst'; await fs.writeFile(source, encoded);
    const read = file => kind === 'json' ? readJsonFile(file, { maxBytes: limit }) : readJsonLinesArraySync(file, { maxBytes: limit });
    for (const file of [source, nominal]) {
      if (size <= limit) assert.deepEqual(read(file), kind === 'json' ? row : [row]);
      else {
        assert.throws(() => read(file), { code: 'ERR_JSON_TOO_LARGE' });
        const observed = [];
        assert.equal(loadOptionalSyncWithFallback(() => read(file), { name: kind, onTooLarge: (name, error) => observed.push([name, error.code]) }), null);
        assert.deepEqual(observed, [[kind, 'ERR_JSON_TOO_LARGE']], 'public optional fallback sees the typed boundary error');
      }
    }
  }
  for (const compression of ['plain', 'gzip']) {
    const row = { text: 'x'.repeat(600) }, raw = Buffer.from(JSON.stringify(row));
    const file = path.join(dir, `parity-${compression}.json${compression === 'gzip' ? '.gz' : ''}`);
    await fs.writeFile(file, compression === 'gzip' ? gzipSync(raw) : raw);
    assert.throws(() => readJsonFile(file, { maxBytes: limit }), { code: 'ERR_JSON_TOO_LARGE' });
  }
  assert.throws(() => decompressBuffer(Buffer.from('not a zstd frame'), 'zstd', limit, 'corrupt.json.zst'),
    error => error.code !== 'ERR_JSON_TOO_LARGE' && error.message.startsWith('zstd decompress failed:'), 'corruption is not a capacity refusal');

  const raw = Buffer.from(JSON.stringify({ text: 'x'.repeat(600) })), encoded = zstdCompressSync(raw);
  assert.ok(encoded.length * 3 < 256 && raw.length * 3 > 256);
  v8.getHeapStatistics = () => ({ heap_size_limit: 1024, used_heap_size: 768 }); syncBuiltinESMExports();
  assert.throws(() => decompressBuffer(encoded, 'zstd', 4096, 'heap.json.zst'), { code: 'ERR_JSON_TOO_LARGE' },
    'post-decode heap admission keeps its own typed refusal');
  const heapPath = path.join(dir, 'heap.json.zst'); await fs.writeFile(heapPath, encoded);
  assert.throws(() => readJsonFile(heapPath, { maxBytes: 4096 }), { code: 'ERR_JSON_TOO_LARGE' });
  const report = { issues: [], warnings: [], modes: {} }, modeReport = { issues: [], warnings: [] };
  const presence = createArtifactPresenceHelpers({ dir, manifest: null, strict: false, mode: 'code', report, modeReport });
  assert.equal(presence.readJsonArtifact('heap', { allowOversize: true }), null);
  assert.equal(modeReport.warnings.length, 1);
  assert.match(modeReport.warnings[0], /heap load skipped/);
  assert.deepEqual(modeReport.issues, [], 'allowOversize does not turn an admitted capacity refusal into corruption');
} finally {
  v8.getHeapStatistics = originalHeap; syncBuiltinESMExports();
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Synchronous zstd public boundaries retain capacity errors across output headroom and heap admission');
