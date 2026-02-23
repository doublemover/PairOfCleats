#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { readJsonLinesArray } from '../../../src/shared/artifact-io.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'jsonl-gzip');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const okJsonl = '{"id":1}\n{"id":2}\n';
const okPath = path.join(cacheRoot, 'ok.jsonl.gz');
await fs.writeFile(okPath, gzipSync(Buffer.from(okJsonl, 'utf8')));
const okParsed = await readJsonLinesArray(okPath);
assert.equal(okParsed.length, 2);

const largeJsonl = `${'{"id":1}\n'.repeat(200)}`;
const largePath = path.join(cacheRoot, 'large.jsonl.gz');
await fs.writeFile(largePath, gzipSync(Buffer.from(largeJsonl, 'utf8')));
let tooLargeErr = null;
try {
  await readJsonLinesArray(largePath, { maxBytes: 50 });
} catch (err) {
  tooLargeErr = err;
}
assert.ok(tooLargeErr, 'expected gzip JSONL to enforce maxBytes');
assert.equal(tooLargeErr.code, 'ERR_JSON_TOO_LARGE');

console.log('jsonl gzip streaming test passed');
