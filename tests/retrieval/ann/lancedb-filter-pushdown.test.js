#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { rankLanceDb } from '../../../src/retrieval/lancedb.js';
import { requireLanceDb } from '../../helpers/optional-deps.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'lancedb-filter-pushdown');

await requireLanceDb({ reason: 'lancedb not available; skipping lancedb filter pushdown test.' });

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const module = await import('@lancedb/lancedb');
const lancedb = module?.default || module;
const db = await lancedb.connect(tempRoot);
const rows = Array.from({ length: 15 }, (_, i) => ({
  id: i,
  vector: [i, 0, 0]
}));
await db.createTable('vectors', rows, { mode: 'overwrite' });

const candidateSet = new Set([2, 4, 6]);
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
  topN: 3,
  candidateSet,
  config: {}
});

assert.deepEqual(hits.map((hit) => hit.idx), [2, 4, 6]);

await fsPromises.rm(tempRoot, { recursive: true, force: true });
console.log('lancedb filter pushdown test passed');
