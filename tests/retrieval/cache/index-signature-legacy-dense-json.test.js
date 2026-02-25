#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndexSignature } from '../../../src/retrieval/index-cache.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-index-signature-legacy-dense-'));

try {
  await fs.writeFile(path.join(root, 'chunk_meta.json'), JSON.stringify([]), 'utf8');
  await fs.writeFile(
    path.join(root, 'dense_vectors_uint8.json'),
    JSON.stringify({ vectors: [[1, 2, 3]], dims: 3, model: 'stub' }),
    'utf8'
  );

  const first = await buildIndexSignature(root);
  assert.equal(typeof first, 'string', 'expected first signature string');

  await fs.writeFile(
    path.join(root, 'dense_vectors_uint8.json'),
    JSON.stringify({ vectors: [[9, 8, 7]], dims: 3, model: 'stub' }),
    'utf8'
  );

  const second = await buildIndexSignature(root);
  assert.equal(typeof second, 'string', 'expected second signature string');
  assert.notEqual(
    first,
    second,
    'expected legacy dense_vectors_uint8.json changes to invalidate index signature'
  );

  console.log('index signature legacy dense json test passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
