#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { replaceFile } from '../../src/shared/json-stream.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'atomic-replace-exdev');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const finalPath = path.join(outDir, 'target.json');
const tempPath = path.join(outDir, 'target.tmp');

await fsPromises.writeFile(finalPath, 'before', 'utf8');
await fsPromises.writeFile(tempPath, 'after', 'utf8');

const originalRename = fsPromises.rename;
fsPromises.rename = async () => {
  const err = new Error('EXDEV');
  err.code = 'EXDEV';
  throw err;
};

try {
  await replaceFile(tempPath, finalPath);
} finally {
  fsPromises.rename = originalRename;
}

const contents = await fsPromises.readFile(finalPath, 'utf8');
assert.equal(contents, 'after');
assert.ok(!fs.existsSync(tempPath), 'expected temp file cleaned up after copy fallback');
assert.ok(!fs.existsSync(`${finalPath}.bak`), 'expected .bak removed after fallback');

console.log('atomic replace cross-device fallback test passed');

