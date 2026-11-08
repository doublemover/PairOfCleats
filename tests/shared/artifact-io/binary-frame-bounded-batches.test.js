#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { writeBinaryRowFrames, encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
applyTestEnv();
const root = resolveTestCachePath(process.cwd(), 'binary-frame-bounded-batches');
await fs.mkdir(root, { recursive: true });
const paths = { dataPath: path.join(root, 'data.bin'), offsetsPath: path.join(root, 'offsets.bin'), lengthsPath: path.join(root, 'lengths.bin') };
const open = fs.open;
let produced = 0, firstWriteAt = null, writes = 0;
const rows = Array.from({ length: 600 }, (_, id) => Buffer.from(`${id}:😀`));
try {
  fs.open = async (...args) => {
    const handle = await open(...args);
    if (args[1] === 'wx') {
      const write = handle.write.bind(handle);
      handle.write = async (buffer, offset, length, position) => {
        firstWriteAt ??= produced; writes += 1;
        return write(buffer, offset, Math.min(13, length), position);
      };
    }
    return handle;
  };
  await writeBinaryRowFrames({ ...paths, rowBuffers: (function* () { for (const row of rows) { produced += 1; yield row; } })() });
} finally { fs.open = open; }
assert.ok(firstWriteAt <= 257, 'the first batch writes before the sync iterable is exhausted');
assert.ok(writes > 3, 'positive short writes are completed');
const expected = encodeBinaryRowFrames(rows);
assert.deepEqual(await fs.readFile(paths.dataPath), expected.dataBuffer);
assert.deepEqual(await fs.readFile(paths.offsetsPath), expected.offsetsBuffer);
assert.deepEqual(await fs.readFile(paths.lengthsPath), expected.lengthsBuffer);
const controller = new AbortController(); controller.abort();
await assert.rejects(writeBinaryRowFrames({ ...paths, rowBuffers: rows, signal: controller.signal }), { name: 'AbortError' });
assert.deepEqual(await fs.readFile(paths.dataPath), expected.dataBuffer);
