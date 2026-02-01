#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { readTextFileWithHash } from '../../../src/shared/encoding.js';
import { sha1 } from '../../../src/shared/hash.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'encoding-hash');
const filePath = path.join(tempRoot, 'latin1.txt');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const buffer = Buffer.from([0xff, 0xfe, 0xfd, 0x41]);
await fsPromises.writeFile(filePath, buffer);

const info = await readTextFileWithHash(filePath);
const expectedHash = sha1(buffer);

if (info.hash !== expectedHash) {
  console.error('encoding hash test failed: hash did not match raw bytes.');
  process.exit(1);
}
if (!info.usedFallback) {
  console.error('encoding hash test failed: expected fallback decoding for invalid UTF-8.');
  process.exit(1);
}

console.log('encoding hash tests passed');

