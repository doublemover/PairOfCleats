#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import {
  readTextFileWithStreamingCap,
  truncateByBytes
} from '../../../src/index/build/file-processor/read.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'streaming-truncation-byte-cap');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const absPath = path.join(tempRoot, 'oversized.txt');
const prefix = 'alpha beta gamma delta\n';
const utf8Tail = 'Ωmega 東京 café ✓\n';
const content = `${prefix.repeat(12000)}${utf8Tail.repeat(2048)}`;
await fs.writeFile(absPath, content, 'utf8');
const stat = await fs.stat(absPath);

const maxBytes = 32 * 1024 + 3;
const baseline = truncateByBytes(content, maxBytes);

const originalReadFile = fsPromises.readFile;
let readFileCalls = 0;
fsPromises.readFile = async (...args) => {
  if (String(args[0]) === absPath) readFileCalls += 1;
  return originalReadFile(...args);
};

let streamed = null;
try {
  streamed = await readTextFileWithStreamingCap({
    absPath,
    maxBytes,
    stat
  });
} finally {
  fsPromises.readFile = originalReadFile;
}

assert.equal(streamed.truncated, true, 'expected streaming read to report truncation');
assert.equal(streamed.text, baseline.text, 'expected streaming cap text to match non-streaming truncation');
assert.equal(streamed.bytes, baseline.bytes, 'expected byte accounting parity for truncation');
assert.ok(streamed.bytes <= maxBytes, 'expected streamed byte count to respect cap');
assert.equal(readFileCalls, 0, 'expected streaming cap path to avoid full fs.readFile materialization');

console.log('streaming truncation byte-cap test passed');
