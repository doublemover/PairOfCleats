#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { rankLanceDb } from '../../../src/retrieval/lancedb.js';
import { requireLanceDb } from '../../helpers/optional-deps.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'lancedb-candidate-filtering');

await requireLanceDb({ reason: 'lancedb not available; skipping lancedb candidate filtering test.' });

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const module = await import('@lancedb/lancedb');
const lancedb = module?.default || module;
const db = await lancedb.connect(tempRoot);
const rows = Array.from({ length: 50 }, (_, i) => ({
  id: i,
  vector: [i, 0, 0]
}));
await db.createTable('vectors', rows, { mode: 'overwrite' });

const candidateSet = new Set([25]);
for (let i = 1000; i < 1600; i += 1) {
  candidateSet.add(i);
}

const hits = await rankLanceDb({
  lancedbInfo: {
    available: true,
    dir: tempRoot,
    meta: {
      table: 'vectors',
      idColumn: 'id',
      embeddingColumn: 'vector',
      metric: 'l2',
      dims: 3
    }
  },
  queryEmbedding: [0, 0, 0],
  topN: 1,
  candidateSet,
  config: {}
});

assert.equal(hits.length, 1);
assert.equal(hits[0].idx, 25);

await fsPromises.rm(tempRoot, { recursive: true, force: true });
console.log('lancedb candidate filtering test passed');
