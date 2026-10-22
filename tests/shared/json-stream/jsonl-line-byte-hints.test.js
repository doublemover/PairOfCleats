#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createJsonlBatchWriter } from '../../../src/shared/json-stream/jsonl-batch.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-jsonl-hints-'));
try {
  for (const compression of [null, 'gzip']) {
    const output = path.join(root, compression || 'plain');
    const writer = createJsonlBatchWriter(output, { compression });
    const rows = ['{"unicode":"É😀"}', '{"ok":true}', '[]'];
    await writer.writeLine(rows[0]);
    await writer.writeLine(rows[1], null);
    for (const hint of [0, 1, 999, NaN, -1, '2']) await writer.writeLine(rows[2], hint);
    await writer.close();
    const bytes = await fs.readFile(output);
    const decoded = compression ? gunzipSync(bytes) : bytes;
    assert.equal(decoded.toString('utf8'), [rows[0], rows[1], ...Array(6).fill(rows[2])].join('\n') + '\n');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
