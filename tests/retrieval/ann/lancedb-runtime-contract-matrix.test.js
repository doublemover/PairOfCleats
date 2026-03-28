#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { rankLanceDb } from '../../../src/retrieval/lancedb.js';
import { requireLanceDb } from '../../helpers/optional-deps.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const buildDb = async (suffix, count) => {
  const tempRoot = resolveTestCachePath(root, suffix);
  await requireLanceDb({ reason: 'lancedb not available; skipping LanceDB runtime matrix.' });
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(tempRoot, { recursive: true });

  const module = await import('@lancedb/lancedb');
  const lancedb = module?.default || module;
  const db = await lancedb.connect(tempRoot);
  const rows = Array.from({ length: count }, (_, i) => ({
    id: i,
    vector: [i, 0, 0]
  }));
  await db.createTable('vectors', rows, { mode: 'overwrite' });
  return {
    tempRoot,
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
    }
  };
};

const cases = [
  {
    name: 'candidate filtering preserves only allowed ids',
    async run() {
      const fixture = await buildDb('lancedb-runtime-matrix-candidate-filtering', 50);
      try {
        const candidateSet = new Set([25]);
        for (let i = 1000; i < 1600; i += 1) candidateSet.add(i);

        const hits = await rankLanceDb({
          lancedbInfo: fixture.lancedbInfo,
          queryEmbedding: [0, 0, 0],
          topN: 1,
          candidateSet,
          config: {}
        });

        assert.equal(hits.length, 1);
        assert.equal(hits[0].idx, 25);
      } finally {
        await fsPromises.rm(fixture.tempRoot, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'connection cache tolerates concurrent query reuse',
    async run() {
      const fixture = await buildDb('lancedb-runtime-matrix-connection-cache', 10);
      try {
        const tasks = Array.from({ length: 4 }, () => rankLanceDb({
          lancedbInfo: fixture.lancedbInfo,
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
      } finally {
        await fsPromises.rm(fixture.tempRoot, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'filter pushdown respects ordered candidate sets',
    async run() {
      const fixture = await buildDb('lancedb-runtime-matrix-filter-pushdown', 15);
      try {
        const hits = await rankLanceDb({
          lancedbInfo: fixture.lancedbInfo,
          queryEmbedding: [0, 0, 0],
          topN: 3,
          candidateSet: new Set([2, 4, 6]),
          config: {}
        });
        assert.deepEqual(hits.map((hit) => hit.idx), [2, 4, 6]);
      } finally {
        await fsPromises.rm(fixture.tempRoot, { recursive: true, force: true });
      }
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('lancedb runtime contract matrix test passed');
