import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createXxhash64Hasher } from '../../../src/shared/hash/xxhash-backend.js';
import { writeJsonLinesFileAsync } from '../../../src/shared/json-stream/jsonl-write.js';
import { openJsonlRowReader } from '../../../src/shared/artifact-io/offsets.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), 'registered-jsonl-digest-algorithms');
await fs.rm(root, { recursive: true, force: true }); await fs.mkdir(root, { recursive: true });
const data = path.join(root, 'rows.jsonl'), offsets = data + '.offsets.bin';
const rows = Array.from({ length: 2000 }, (_, i) => ({ id: i, text: 'λ repeated across block boundaries ' + i }));
const digest = async (bytes, algorithm) => {
  if (algorithm !== 'xxh64') return createHash(algorithm).update(bytes).digest('hex');
  const hasher = await createXxhash64Hasher(); hasher.update(bytes); return hasher.digest();
};
try {
  await writeJsonLinesFileAsync(data, rows, { atomic: true, offsets: { path: offsets, atomic: true } });
  const body = await fs.readFile(data), table = await fs.readFile(offsets);
  assert.ok(body.length > 65536, 'large-file branch keeps strong per-block witnesses');
  for (const algorithm of ['sha1', 'sha256', 'xxh64']) {
    const reader = await openJsonlRowReader(data, offsets, { containedRoot: root });
    try {
      await reader.verify({ jsonlBytes: body.length, offsetsBytes: table.length,
        jsonlHash: await digest(body, algorithm), offsetsHash: await digest(table, algorithm),
        jsonlHashAlgorithm: algorithm, offsetsHashAlgorithm: algorithm });
      await reader.validateOffsets();
      assert.deepEqual(await reader.readRows([0, 1000, 1999], { maxBytes: 4096 }), [rows[0], rows[1000], rows[1999]]);
    } finally { await reader.close(); }
  }
  const reader = await openJsonlRowReader(data, offsets, { containedRoot: root });
  try {
    await reader.verify({ jsonlBytes: body.length, offsetsBytes: table.length,
      jsonlHash: await digest(body, 'xxh64'), offsetsHash: await digest(table, 'xxh64'),
      jsonlHashAlgorithm: 'xxh64', offsetsHashAlgorithm: 'xxh64' });
    const before = await fs.stat(data), changed = Buffer.from(body);
    changed[changed.indexOf('repeated')] = 'R'.charCodeAt(0);
    await fs.writeFile(data, changed); await fs.utimes(data, before.atime, before.mtime);
    await assert.rejects(reader.readRows([0], { maxBytes: 4096 }), { code: 'ERR_JSONL_CONTENT_INTEGRITY' });
  } finally { await reader.close(); }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('registered JSONL digest algorithm controls passed');
