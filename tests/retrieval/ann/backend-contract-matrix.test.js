#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveLanceDbTarget } from '../../../src/shared/lancedb.js';
import { resolveHnswTarget } from '../../../src/shared/hnsw.js';
import {
  ANN_BACKEND_CHOICES,
  normalizeAnnBackend,
  resolveAnnOrder
} from '../../../src/retrieval/ann/normalize-backend.js';
import { createDenseAnnProvider } from '../../../src/retrieval/ann/providers/dense.js';
import { createHnswAnnProvider } from '../../../src/retrieval/ann/providers/hnsw.js';
import { createLanceDbAnnProvider } from '../../../src/retrieval/ann/providers/lancedb.js';
import { createSqliteVectorAnnProvider } from '../../../src/retrieval/ann/providers/sqlite-vec.js';

assert.equal(resolveLanceDbTarget('code', 'auto'), 'code');
assert.equal(resolveLanceDbTarget('prose', 'auto'), 'doc');
assert.equal(resolveLanceDbTarget('extracted-prose', 'auto'), 'doc');
assert.equal(resolveLanceDbTarget('records', 'auto'), 'merged');
assert.equal(resolveLanceDbTarget('code', 'doc'), 'doc');
assert.equal(resolveLanceDbTarget('prose', 'code'), 'code');
assert.equal(resolveLanceDbTarget('code', 'merged'), 'merged');

assert.equal(resolveHnswTarget('code', 'auto'), 'code');
assert.equal(resolveHnswTarget('prose', 'auto'), 'doc');
assert.equal(resolveHnswTarget('extracted-prose', 'auto'), 'doc');
assert.equal(resolveHnswTarget('records', 'auto'), 'merged');
assert.equal(resolveHnswTarget('code', 'doc'), 'doc');
assert.equal(resolveHnswTarget('prose', 'code'), 'code');
assert.equal(resolveHnswTarget('code', 'merged'), 'merged');
assert.equal(resolveHnswTarget('code', ''), 'merged');

assert.deepEqual(ANN_BACKEND_CHOICES, ['auto', 'lancedb', 'sqlite-vector', 'hnsw', 'js']);
assert.equal(normalizeAnnBackend('sqlite'), 'sqlite-vector');
assert.equal(normalizeAnnBackend('sqlite-extension'), 'sqlite-vector');
assert.equal(normalizeAnnBackend('vector-extension'), 'sqlite-vector');
assert.equal(normalizeAnnBackend('dense'), 'js');
assert.equal(normalizeAnnBackend('js'), 'js');
assert.equal(normalizeAnnBackend('auto'), 'auto');
assert.equal(normalizeAnnBackend('unknown'), 'lancedb');
assert.equal(normalizeAnnBackend('unknown', { strict: true, defaultBackend: null }), null);

assert.deepEqual(resolveAnnOrder('lancedb'), ['lancedb']);
assert.deepEqual(resolveAnnOrder('sqlite-vector'), ['sqlite-vector']);
assert.deepEqual(resolveAnnOrder('hnsw'), ['hnsw']);
assert.deepEqual(resolveAnnOrder('dense'), ['js']);
assert.deepEqual(resolveAnnOrder('auto'), ['lancedb', 'sqlite-vector', 'hnsw', 'js']);

{
  const embedding = [0.42, 0.13];
  const abortedSignal = { aborted: true };

  const dense = createDenseAnnProvider();
  assert.equal(dense.isAvailable({ idx: { denseVec: { vectors: [[0.1, 0.2]] } }, embedding }), true);
  assert.equal(dense.isAvailable({ idx: { denseVec: { vectors: [[0.1, 0.2]] } }, embedding: [] }), false);
  assert.deepEqual(
    dense.query({
      idx: { denseVec: { vectors: [[0.1, 0.2]] } },
      embedding,
      topN: 5,
      candidateSet: null,
      signal: abortedSignal
    }),
    []
  );
  assert.deepEqual(
    dense.query({
      idx: { denseVec: { vectors: [[0.1, 0.2]] } },
      embedding,
      topN: 5,
      candidateSet: new Set(),
      signal: null
    }),
    []
  );

  const hnsw = createHnswAnnProvider({
    hnswAnnState: { code: { available: true } },
    hnswAnnUsed: { code: false }
  });
  assert.equal(hnsw.isAvailable({ idx: { hnsw: { available: true } }, mode: 'code', embedding }), true);
  assert.equal(hnsw.isAvailable({ idx: { hnsw: { available: true } }, mode: 'code', embedding: null }), false);
  assert.deepEqual(
    hnsw.query({
      idx: { hnsw: { available: true } },
      mode: 'code',
      embedding,
      topN: 5,
      candidateSet: new Set(),
      signal: null
    }),
    []
  );
  const hnswEfCalls = [];
  const hnswHits = hnsw.query({
    idx: {
      hnsw: {
        available: true,
        space: 'cosine',
        index: {
          setEf: (value) => hnswEfCalls.push(value),
          getCurrentCount: () => 2,
          searchKnn: () => ({
            neighbors: [1],
            distances: [0.1]
          })
        }
      }
    },
    mode: 'code',
    embedding,
    topN: 2,
    candidateSet: null,
    signal: null,
    budget: {
      hnswEfSearch: 77
    }
  });
  assert.equal(hnswEfCalls[0], 77);
  assert.equal(hnswHits.length, 1);
  assert.equal(hnswHits[0].idx, 1);

  const lancedb = createLanceDbAnnProvider({
    lancedbConfig: { enabled: true },
    lanceAnnState: { code: { available: true } },
    lanceAnnUsed: { code: false }
  });
  assert.equal(lancedb.isAvailable({ idx: { lancedb: { available: true } }, mode: 'code', embedding }), true);
  assert.equal(
    lancedb.isAvailable({
      idx: { lancedb: { available: true } },
      mode: 'code',
      embedding: new Float32Array([])
    }),
    false
  );
  assert.deepEqual(
    await lancedb.query({
      idx: { lancedb: { available: true } },
      mode: 'code',
      embedding,
      topN: 5,
      candidateSet: new Set(),
      signal: null
    }),
    []
  );

  let sqliteCalls = 0;
  const sqlite = createSqliteVectorAnnProvider({
    rankVectorAnnSqlite: (mode, queryEmbedding, topN, candidateSet) => {
      sqliteCalls += 1;
      return [
        {
          idx: 1,
          sim: 0.9,
          mode,
          size: queryEmbedding.length,
          topN,
          candidateSetSize: candidateSet?.size || 0
        }
      ];
    },
    vectorAnnState: { code: { available: true } },
    vectorAnnUsed: { code: false }
  });
  assert.equal(sqlite.isAvailable({ mode: 'code', embedding }), true);
  assert.equal(sqlite.isAvailable({ mode: 'code', embedding: null }), false);
  assert.deepEqual(
    sqlite.query({ mode: 'code', embedding, topN: 5, candidateSet: new Set(), signal: null }),
    []
  );
  const sqliteHits = sqlite.query({ mode: 'code', embedding, topN: 3, candidateSet: null, signal: null });
  assert.equal(sqliteCalls, 1);
  assert.equal(sqliteHits.length, 1);
  assert.equal(sqliteHits[0].topN, 3);
}

console.log('ann backend contract matrix test passed');
