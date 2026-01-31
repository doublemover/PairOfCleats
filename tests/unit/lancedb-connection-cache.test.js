#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { rankLanceDb } from '../../src/retrieval/lancedb.js';
import { requireLanceDb } from '../helpers/optional-deps.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'lancedb-connection-cache');

await requireLanceDb({ reason: 'lancedb not available; skipping lancedb connection cache test.' });

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const module = await import('@lancedb/lancedb');
const lancedb = module?.default || module;
const db = await lancedb.connect(tempRoot);
const rows = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  vector: [i, 0, 0]
}));
await db.createTable('vectors', rows, { mode: 'overwrite' });

const lancedbInfo = {
  available: true,
  dir: tempRoot,
  meta: {
    table: 'vectors',
    idColumn: 'id',
    embeddingColumn: 'vector',
    metric: 'l2',
    dims: 3
  }
};

const tasks = Array.from({ length: 4 }, () => rankLanceDb({
  lancedbInfo,
  queryEmbedding: [0, 0, 0],
  topN: 3,
  candidateSet: null,
  config: {}
}));

const results = await Promise.all(tasks);
for (const hits of results) {
  assert.ok(Array.isArray(hits));
  assert.ok(hits.length > 0);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
console.log('lancedb connection cache test passed');
