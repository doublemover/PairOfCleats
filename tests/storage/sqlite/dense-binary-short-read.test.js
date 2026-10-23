#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadSqliteIndexOptionalArtifacts } from '../../../src/storage/sqlite/utils.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

applyTestEnv();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-dense-short-read-'));
const file = path.join(root, 'dense_vectors_uint8.bin');
await fs.writeFile(file, Buffer.from([1, 2, 3, 4, 5, 6]));
await fs.writeFile(`${file}.meta.json`, JSON.stringify({ format: 'uint8-row-major', path: path.basename(file), count: 2, dims: 3 }));
try {
  await withTemporaryEnv({ PAIROFCLEATS_DENSE_BINARY_MAX_INLINE_MB: '0.000001' }, async () => {
    for (const cap of [1, 4, 0]) {
      const artifact = loadSqliteIndexOptionalArtifacts(root).denseVec;
      assert.equal(artifact.streamed, true);
      const open = fs.open;
      let closed = 0;
      fs.open = async (target, ...args) => {
        const handle = await open(target, ...args);
        if (target === file) {
          const read = handle.read.bind(handle), close = handle.close.bind(handle);
          handle.read = (buffer, offset, length, position) => cap === 0
            ? Promise.resolve({ bytesRead: 0, buffer }) : read(buffer, offset, Math.min(length, cap), position);
          handle.close = async () => { await close(); closed++; };
        }
        return handle;
      };
      try {
        const collect = async () => { const rows = []; for await (const row of artifact.rows) rows.push(Array.from(row.vector)); return rows; };
        if (cap) assert.deepEqual(await collect(), [[1, 2, 3], [4, 5, 6]]);
        else await assert.rejects(collect(), { code: 'ERR_DENSE_VECTOR_STREAM' });
      } finally { fs.open = open; }
      assert.equal(closed, 1);
    }
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('dense binary ingestion fills positive short reads and rejects premature EOF');
