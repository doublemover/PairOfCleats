#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createZstdCompress } from 'node:zlib';
import { readJsonLinesArray } from '../../../src/shared/artifact-io.js';

const root = process.cwd();
const cacheRoot = path.join(root, '.testCache', 'jsonl-zstd');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

let zstdAvailable = true;
try {
  createZstdCompress();
} catch {
  zstdAvailable = false;
}

if (!zstdAvailable) {
  console.log('jsonl zstd streaming test skipped (zstd unavailable)');
  process.exit(0);
}

const okJsonl = '{"id":1}\n{"id":2}\n';
const okPath = path.join(cacheRoot, 'ok.jsonl');
await fs.writeFile(okPath, okJsonl);
const zstPath = path.join(cacheRoot, 'ok.jsonl.zst');
await pipeline(createReadStream(okPath), createZstdCompress(), createWriteStream(zstPath));
const okParsed = await readJsonLinesArray(zstPath);
assert.equal(okParsed.length, 2);

const largeJsonl = `${'{"id":1}\n'.repeat(200)}`;
const largePath = path.join(cacheRoot, 'large.jsonl');
await fs.writeFile(largePath, largeJsonl);
const largeZstPath = path.join(cacheRoot, 'large.jsonl.zst');
await pipeline(createReadStream(largePath), createZstdCompress(), createWriteStream(largeZstPath));
let tooLargeErr = null;
try {
  await readJsonLinesArray(largeZstPath, { maxBytes: 50 });
} catch (err) {
  tooLargeErr = err;
}
assert.ok(tooLargeErr, 'expected zstd JSONL to enforce maxBytes');
assert.equal(tooLargeErr.code, 'ERR_JSON_TOO_LARGE');

console.log('jsonl zstd streaming test passed');
