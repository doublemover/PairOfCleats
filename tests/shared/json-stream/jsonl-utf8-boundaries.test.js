import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import { scanJsonlBuffer, scanJsonlStream, parseJsonlStreamEntries } from '../../../src/shared/artifact-io/json/line-scan.js';
import { readJsonLinesIterator } from '../../../src/shared/artifact-io.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('jsonl-utf8-boundaries');
const entry = { text: 'café 水 😀', file: 'src/日本語.js' };
const raw = Buffer.from(`${JSON.stringify(entry)}\r\n${JSON.stringify({ text: 'last 😀' })}`);
const expected = [];
scanJsonlBuffer(raw, 'buffer-control', { maxBytes: raw.length, collect: expected });
const scanners = [
  (chunks, collect, maxBytes = raw.length) => scanJsonlStream(Readable.from(chunks), {
    targetPath: 'stream-control', maxBytes, collect
  }),
  (chunks, collect, maxBytes = raw.length) => parseJsonlStreamEntries(Readable.from(chunks), {
    targetPath: 'stream-control', maxBytes, onEntry: async row => { collect.push(row); }
  })
];
try {
  for (const scan of scanners) {
    for (let split = 1; split < raw.length; split++) {
      const actual = [];
      const stats = await scan([raw.subarray(0, split), Buffer.alloc(0), raw.subarray(split)], actual);
      assert.deepEqual(actual, expected, `UTF-8 split at byte ${split}`);
      assert.equal(stats.bytes, raw.length);
      assert.equal(stats.rows, 2);
    }
    const actual = [];
    await scan([...raw].map(byte => Buffer.from([byte])), actual);
    assert.deepEqual(actual, expected, 'one-byte chunks retain all character widths and CRLF');
    await assert.rejects(scan([raw], [], raw.length - 1), { code: 'ERR_JSON_TOO_LARGE' });
    const malformed = Buffer.concat([Buffer.from('{"text":"'), Buffer.from([0xc3]), Buffer.from('"}\n')]);
    const buffered = [];
    scanJsonlBuffer(malformed, 'buffer-control', { maxBytes: 100, collect: buffered });
    const decoded = [];
    await scan([...malformed].map(byte => Buffer.from([byte])), decoded, 100);
    assert.deepEqual(decoded, buffered, 'malformed UTF-8 retains buffered replacement policy');
    await assert.rejects(scan([Buffer.from('{"ok":1}\r\n'), Buffer.from('{broken}')], [], 100), /line 2|:2/);
  }

  // Cross the public iterator's 128-KiB buffering cutoff. Place a two-byte
  // character across a real 64-KiB read/decompression boundary, then include
  // incompressible text so gzip itself also exceeds that cutoff.
  const prefix = '{"text":"';
  const noise = Array.from({ length: 6000 }, (_, i) => crypto.createHash('sha256').update(String(i)).digest('base64')).join('');
  const big = Buffer.from(prefix + 'x'.repeat(65535 - prefix.length) + 'é水😀' + noise + '"}\r\n{"text":"second"}\n');
  const control = [];
  scanJsonlBuffer(big, 'large-buffer-control', { maxBytes: big.length, collect: control });
  for (const [suffix, bytes] of [['jsonl', big], ['jsonl.gz', gzipSync(big)], ['jsonl.zst', zstdCompressSync(big)]]) {
    assert.ok(bytes.length > 128 * 1024, `${suffix} must exceed the normal small-file cutoff`);
    const file = path.join(dir, `large.${suffix}`);
    await fs.writeFile(file, bytes);
    const rows = [];
    let backpressure = 0;
    for await (const row of readJsonLinesIterator(file, { maxBytes: big.length + 10000,
      maxInFlight: 1, onBackpressure: () => { backpressure++; } })) rows.push(row);
    assert.deepEqual(rows, control, `${suffix} public iterator preserves Unicode`);
    assert.ok(backpressure > 0, 'bounded row delivery retains backpressure');
    let visited = 0;
    for await (const row of readJsonLinesIterator(file, { maxInFlight: 1 })) {
      assert.equal(row.text, control[0].text);
      visited++;
      break;
    }
    assert.equal(visited, 1, 'early consumer return drains cancellation');
  }
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('UTF-8 stream boundaries, raw byte limits, codecs, backpressure and early return match buffered controls');
