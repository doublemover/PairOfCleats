#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { readJsonlRowAt } from '../../../src/shared/artifact-io/offsets.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-jsonl-read-row-max-bytes-'));
applyTestEnv({ cacheRoot: tempRoot });

const jsonlPath = path.join(tempRoot, 'rows.jsonl');
const offsetsPath = path.join(tempRoot, 'rows.offsets');
const row = `${JSON.stringify({ id: 'row-1', payload: 'x'.repeat(200) })}\n`;
await fs.writeFile(jsonlPath, row, 'utf8');

const offsets = Buffer.alloc(8);
offsets.writeBigUInt64LE(0n, 0);
await fs.writeFile(offsetsPath, offsets);

await assert.rejects(
  () => readJsonlRowAt(jsonlPath, offsetsPath, 0, { maxBytes: 32 }),
  (err) => err?.code === 'ERR_JSON_TOO_LARGE'
);

await assert.rejects(
  () => readJsonlRowAt(jsonlPath, offsetsPath, 0, { maxBytes: '32' }),
  (err) => err?.code === 'ERR_INVALID_MAX_BYTES'
);

const parsed = await readJsonlRowAt(jsonlPath, offsetsPath, 0, { maxBytes: 4096 });
assert.equal(parsed?.id, 'row-1');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('read row max-bytes enforcement test passed');
