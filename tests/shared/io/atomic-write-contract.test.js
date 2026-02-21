#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson, atomicWriteText } from '../../../src/shared/io/atomic-write.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'atomic-write-contract');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const textPath = path.join(tempRoot, 'state.txt');
await atomicWriteText(textPath, 'alpha');
assert.equal(fs.readFileSync(textPath, 'utf8'), 'alpha');

await atomicWriteText(textPath, 'beta', { newline: true });
assert.equal(fs.readFileSync(textPath, 'utf8'), 'beta\n');

const bufferPath = path.join(tempRoot, 'buffer.txt');
await atomicWriteText(bufferPath, Buffer.from('gamma', 'utf8'), { newline: true });
assert.equal(fs.readFileSync(bufferPath, 'utf8'), 'gamma\n');

const jsonPath = path.join(tempRoot, 'state.json');
await atomicWriteJson(jsonPath, { ok: true, values: [1, 2, 3] }, { spaces: 2 });
const jsonRaw = fs.readFileSync(jsonPath, 'utf8');
assert.equal(jsonRaw.endsWith('\n'), true);
assert.deepEqual(JSON.parse(jsonRaw), { ok: true, values: [1, 2, 3] });

const retryPath = path.join(tempRoot, 'retry.txt');
const originalOpen = fsPromises.open;
let emfileAttempts = 0;
fsPromises.open = async (...args) => {
  const [filePath, flags] = args;
  if (String(filePath).includes('retry.txt.tmp-') && flags === 'wx' && emfileAttempts < 2) {
    emfileAttempts += 1;
    const err = new Error('too many open files');
    err.code = 'EMFILE';
    throw err;
  }
  return originalOpen(...args);
};
try {
  await atomicWriteText(retryPath, 'retry-ok');
} finally {
  fsPromises.open = originalOpen;
}
assert.equal(fs.readFileSync(retryPath, 'utf8'), 'retry-ok');
assert.equal(emfileAttempts, 2, 'expected EMFILE retry path to be exercised');

let mkdirError = null;
try {
  await atomicWriteText(path.join(tempRoot, 'nested', 'missing.txt'), 'x', { mkdir: false });
} catch (err) {
  mkdirError = err;
}
assert.ok(mkdirError, 'expected mkdir=false write to fail for missing directory');
assert.equal(mkdirError.code, 'ERR_ATOMIC_WRITE');

const circular = {};
circular.self = circular;
let serializeError = null;
try {
  await atomicWriteJson(path.join(tempRoot, 'bad.json'), circular);
} catch (err) {
  serializeError = err;
}
assert.ok(serializeError, 'expected circular json to fail');
assert.equal(serializeError.code, 'ERR_ATOMIC_WRITE');

console.log('atomic write contract ok.');

