import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { writeJsonArrayFile } from '../../../src/shared/json-stream/json-writers.js';
import { writeJsonLinesFile, writeJsonLinesFileAsync } from '../../../src/shared/json-stream/jsonl-write.js';
import { writeJsonLinesSharded, writeJsonLinesShardedAsync } from '../../../src/shared/json-stream/jsonl-sharded.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-gzip-all-writers-'));
const rows = [0, 1, 2].map(id => ({ id, text: '雪😀-alpha-beta'.repeat(40) }));
const mtime = 1600000000000;
try {
  await Promise.all([0, 1, 9].map(async level => {
    const gzipOptions = { level, mem: 4, mtime };
    const arrayFile = path.join(root, `array-${level}.gz`);
    await writeJsonArrayFile(arrayFile, rows, { compression: 'gzip', gzipOptions });
    const arrayBytes = await fs.readFile(arrayFile);
    assert.equal(arrayBytes.readUInt32LE(4), mtime / 1000);
    assert.equal(gunzipSync(arrayBytes).toString('utf8'), JSON.stringify(rows) + '\n');
    for (const asynchronous of [false, true]) {
      const file = path.join(root, `${level}-${asynchronous}.jsonl.gz`);
      const items = () => asynchronous ? (async function* () { yield* rows; })() : rows;
      await (asynchronous ? writeJsonLinesFileAsync : writeJsonLinesFile)(file, items(), { compression: 'gzip', gzipOptions });
      const bytes = await fs.readFile(file);
      assert.equal(bytes.readUInt32LE(4), mtime / 1000);
      assert.equal(gunzipSync(bytes).toString('utf8'), rows.map(row => JSON.stringify(row) + '\n').join(''));
      const result = await (asynchronous ? writeJsonLinesShardedAsync : writeJsonLinesSharded)({ dir: root,
        partsDirName: `parts-${level}-${asynchronous}`, partPrefix: 'part-', items: items(), maxItems: 1,
        maxBytes: 8192, compression: 'gzip', gzipOptions });
      const decoded = [];
      for (const part of result.parts) {
        const bytes = await fs.readFile(path.join(root, part));
        assert.equal(bytes.readUInt32LE(4), mtime / 1000); decoded.push(gunzipSync(bytes));
      }
      assert.equal(Buffer.concat(decoded).toString('utf8'), rows.map(row => JSON.stringify(row) + '\n').join(''));
    }
  }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Gzip level/memory/mtime options reach array, sync/async JSONL and sharded owners without cross-writer leakage.');
