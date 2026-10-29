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
const entropy = Buffer.allocUnsafe(9 * 1024 * 1024);
let seed = 0x12345678;
for (let index = 0; index < entropy.length; index++) {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; entropy[index] = seed & 255;
}
const randomText = entropy.toString('base64');
const samples = [];
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
    for (const shape of ['repetitive', 'incompressible']) for (const size of [maxBytes - 1, maxBytes, maxBytes + 1, 512 * 1024]) {
      const row = { text: shape === 'repetitive' ? 'x'.repeat(size - emptyRowBytes) : randomText.slice(0, size - emptyRowBytes) };
      const raw = Buffer.from(JSON.stringify(row) + '\n'), encoded = zstdCompressSync(raw);
      assert.equal(raw.length, size);
      const file = path.join(dir, `${addonPresent}-${shape}-${size}.jsonl.zst`);
      await fs.writeFile(file, encoded); decodedBytes = 0; decoders = [];
      const consume = async () => { const rows = []; for await (const entry of readJsonLinesIterator(file, { maxBytes })) rows.push(entry); return rows; };
      if (size <= maxBytes) assert.deepEqual(await consume(), [row]);
      else {
        await assert.rejects(consume, { code: 'ERR_JSON_TOO_LARGE' });
        assert.ok(decodedBytes <= maxBytes + 2 * 16384, `decoded only bounded output windows: ${decodedBytes}`);
      }
      assert.equal(wholeDecodes, 0, 'optional addon cannot allocate the whole decoded artifact');
      assert.equal(decoders.length, encoded.length > maxBytes ? 0 : 1);
      assert.ok(decoders.every(decoder => decoder.closed));
      samples.push({ addonPresent, shape, encodedBytes: encoded.length, logicalBytes: raw.length, decodedBytes, allowance: maxBytes });
    }
    for (const large of [false, true]) {
      const rows = [{ text: '雪😀\r\n' }, { text: large ? randomText : randomText.slice(0, 8192) }];
      const raw = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n'), encoded = zstdCompressSync(raw);
      assert.equal(encoded.length > 8 * 1024 * 1024, large, 'encoded inputs straddle the former optional-buffer threshold');
      const file = path.join(dir, `${addonPresent}-threshold-${large}.jsonl.zst`);
      await fs.writeFile(file, encoded); decodedBytes = 0; decoders = [];
      const actual = []; for await (const row of readJsonLinesIterator(file, { maxBytes: raw.length })) actual.push(row);
      assert.deepEqual(actual, rows); assert.equal(wholeDecodes, 0); assert.ok(decoders.every(decoder => decoder.closed));
      samples.push({ addonPresent, shape: 'threshold', encodedBytes: encoded.length, logicalBytes: raw.length, decodedBytes, allowance: raw.length });
    }
  }
} finally { Module._load = nativeLoad; fsSync.createReadStream = createReadStream; }
console.log('zstd decoded-byte admission passed');
console.log(JSON.stringify({ samples }));
