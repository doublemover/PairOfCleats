import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { readJsonLinesIterator } from '../../../src/shared/artifact-io/json/read-jsonl-stream.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('zstd-decoded-admission');
const maxBytes = 4096, nativeLoad = Module._load, createReadStream = fsSync.createReadStream;
let wholeDecodes = 0, decodedBytes = 0, decoders = [];
const emptyRowBytes = Buffer.byteLength(JSON.stringify({ text: '' }) + '\n');
try {
  for (const addonPresent of [true, false]) {
    Module._load = function (name, ...args) {
      if (name === '@mongodb-js/zstd') {
        if (!addonPresent) throw Object.assign(new Error('controlled absent optional addon'), { code: 'MODULE_NOT_FOUND' });
        return { decompress: async input => { wholeDecodes++; return zstdDecompressSync(input); } };
      }
      return nativeLoad.call(this, name, ...args);
    };
    fsSync.createReadStream = function (...args) {
      const source = createReadStream.apply(this, args), pipe = source.pipe;
      source.pipe = function (decoder, ...options) {
        decoders.push(decoder);
        const push = decoder.push;
        decoder.push = function (chunk, ...args) { if (chunk) decodedBytes += chunk.length; return push.call(this, chunk, ...args); };
        return pipe.call(this, decoder, ...options);
      };
      return source;
    };
    for (const size of [maxBytes - 1, maxBytes, maxBytes + 1, 512 * 1024]) {
      const row = { text: 'x'.repeat(size - emptyRowBytes) };
      const raw = Buffer.from(JSON.stringify(row) + '\n'), encoded = zstdCompressSync(raw);
      assert.equal(raw.length, size); assert.ok(encoded.length < maxBytes);
      const file = path.join(dir, `${addonPresent}-${size}.jsonl.zst`);
      await fs.writeFile(file, encoded); decodedBytes = 0; decoders = [];
      const consume = async () => { const rows = []; for await (const entry of readJsonLinesIterator(file, { maxBytes })) rows.push(entry); return rows; };
      if (size <= maxBytes) assert.deepEqual(await consume(), [row]);
      else {
        await assert.rejects(consume, { code: 'ERR_JSON_TOO_LARGE' });
        assert.ok(decodedBytes <= maxBytes + 2 * 16384, `decoded only bounded output windows: ${decodedBytes}`);
      }
      assert.equal(wholeDecodes, 0, 'optional addon cannot allocate the whole decoded artifact');
      assert.equal(decoders.length, 1); assert.ok(decoders.every(decoder => decoder.closed));
    }
  }
} finally { Module._load = nativeLoad; fsSync.createReadStream = createReadStream; }
console.log('zstd decoded-byte admission passed');
