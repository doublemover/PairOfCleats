import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createPreparedJsonlRows, readPreparedJsonlRow } from '../../../src/shared/json-stream/prepared-row.js';
import { writeJsonArrayFile } from '../../../src/shared/json-stream/json-writers.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-prepared-json-array-'));
const text = 'prepared 雪😀 \n'.repeat(10000);
const owner = createPreparedJsonlRows(), prepared = owner.prepare({ id: 1, text });
const expected = '[' + readPreparedJsonlRow(prepared.row).line + ']\n';
const stringify = JSON.stringify;
let repeated = 0;
JSON.stringify = function (input, ...rest) { if (input === text) repeated++; return stringify.call(this, input, ...rest); };
try {
  for (const compression of [null, 'gzip']) {
    const filename = path.join(root, compression || 'plain');
    await writeJsonArrayFile(filename, [prepared.row], { compression });
    const bytes = await fs.readFile(filename);
    assert.equal((compression ? gunzipSync(bytes) : bytes).toString('utf8'), expected);
  }
  assert.equal(repeated, 0, 'array output copies exact prepared bytes instead of re-escaping the same admitted row');
} finally { JSON.stringify = stringify; await fs.rm(root, { recursive: true, force: true }); }
console.log('Prepared array output retains canonical bytes without repeated escaping.');
