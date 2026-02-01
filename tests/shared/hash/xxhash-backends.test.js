#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getCapabilities } from '../../../src/shared/capabilities.js';
import { checksumFile, checksumString, setXxhashBackend } from '../../../src/shared/hash.js';

const baseline = '44bc2cf5ad770999';

setXxhashBackend('wasm');
const wasmHash = await checksumString('abc');
assert.equal(wasmHash.value, baseline, 'wasm checksumString should match baseline');

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-xxhash-'));
try {
  const filePath = path.join(tempRoot, 'sample.txt');
  await fs.writeFile(filePath, 'abc');
  const fileHash = await checksumFile(filePath);
  assert.equal(fileHash.value, baseline, 'checksumFile should match checksumString');

  const caps = getCapabilities();
  if (caps.hash.nodeRsXxhash) {
    setXxhashBackend('native');
    const nativeHash = await checksumString('abc');
    assert.equal(nativeHash.value, baseline, 'native checksumString should match baseline');
  }

  console.log('xxhash backend tests passed');
} finally {
  setXxhashBackend('');
  await fs.rm(tempRoot, { recursive: true, force: true });
}
