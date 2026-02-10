#!/usr/bin/env node
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { zstdCompress, zstdDecompress } from 'node:zlib';
import { decodeEmbeddingsCache, encodeEmbeddingsCache } from '../../../src/shared/embeddings-cache/format.js';

const zstdCompressAsync = promisify(zstdCompress);
const zstdDecompressAsync = promisify(zstdDecompress);

const payload = {
  key: 'bounds',
  file: 'src/file.js',
  hash: 'abc',
  chunkSignature: 'sig',
  codeVectors: [Uint8Array.from([1, 2, 3])],
  docVectors: [Uint8Array.from([4, 5, 6])],
  mergedVectors: [Uint8Array.from([7, 8, 9])]
};

const encoded = await encodeEmbeddingsCache(payload, { level: 1 });
const raw = await zstdDecompressAsync(encoded);
const headerLength = raw.readUInt32LE(8);
const headerStart = 12;
const headerEnd = headerStart + headerLength;
const header = JSON.parse(raw.subarray(headerStart, headerEnd).toString('utf8'));
const codeLengthEncoding = header?.vectors?.lengths?.code === 'u32' ? 'u32' : 'u16';

const tamperedRaw = Buffer.from(raw);
const codeLengthsOffset = headerEnd;
if (codeLengthEncoding === 'u32') {
  tamperedRaw.writeUInt32LE(0x7fffffff, codeLengthsOffset);
} else {
  tamperedRaw.writeUInt16LE(0xffff, codeLengthsOffset);
}
const tampered = await zstdCompressAsync(tamperedRaw, { level: 1 });

let error = null;
try {
  await decodeEmbeddingsCache(tampered);
} catch (err) {
  error = err;
}

assert.ok(error, 'expected decodeEmbeddingsCache to reject out-of-bounds vector payload');
assert.match(String(error?.message || error), /truncated|bounds|length/i);

console.log('embeddings cache decode vector bounds test passed');
