#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

import { rankHnswIndex, loadHnswIndex, normalizeHnswConfig } from '../../../src/shared/hnsw.js';
import { requireHnswLib } from '../../helpers/optional-deps.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

requireHnswLib({ reason: 'hnswlib-node not available; skipping HNSW runtime matrix.' });

const require = createRequire(import.meta.url);
const hnswlib = require('hnswlib-node');
const HNSW = hnswlib?.HierarchicalNSW || hnswlib?.default?.HierarchicalNSW || hnswlib?.default;
if (!HNSW) {
  console.log('hnsw runtime contract matrix skipped: HNSW constructor missing');
  process.exit(0);
}

const root = process.cwd();

const cases = [
  {
    name: 'candidate sets constrain hits without breaking ordering',
    run() {
      const index = new HNSW('l2', 2);
      index.initIndex({
        maxElements: 3,
        m: 16,
        efConstruction: 200,
        randomSeed: 42,
        allowReplaceDeleted: false
      });
      index.addPoint([0, 0], 0);
      index.addPoint([1, 0], 1);
      index.addPoint([0, 1], 2);

      const query = new Float32Array([0, 0]);
      assert.deepEqual(rankHnswIndex({ index, space: 'l2' }, query, 2, new Set()), []);

      const candidates = new Set([1, 2]);
      const hits = rankHnswIndex({ index, space: 'l2' }, query, 2, candidates);
      assert.ok(hits.length > 0);
      assert.equal(hits.every((hit) => candidates.has(hit.idx)), true);
      if (hits.length > 1) {
        assert.ok(hits[0].sim >= hits[1].sim);
        if (hits[0].sim === hits[1].sim) {
          assert.ok(hits[0].idx <= hits[1].idx);
        }
      }
      assert.ok(hits[0].sim <= 0);

      const largeCandidates = new Set(Array.from({ length: 1000 }, (_, i) => i));
      const largeHits = rankHnswIndex({ index, space: 'l2' }, query, 2, largeCandidates);
      assert.ok(largeHits.length > 0);
      assert.equal(largeHits.every((hit) => largeCandidates.has(hit.idx)), true);
    }
  },
  {
    name: 'distance spaces produce the expected nearest neighbors',
    run() {
      const runCase = ({ space, vectors, query, expectedTop }) => {
        const index = new HNSW(space, 2);
        index.initIndex({
          maxElements: vectors.length,
          m: 16,
          efConstruction: 200,
          randomSeed: 42,
          allowReplaceDeleted: false
        });
        vectors.forEach((vec, idx) => index.addPoint(vec, idx));
        const hits = rankHnswIndex({ index, space }, new Float32Array(query), 2, null);
        assert.ok(hits.length > 0);
        assert.equal(hits[0].idx, expectedTop);
        if (hits.length > 1) assert.ok(hits[0].sim >= hits[1].sim);
      };

      runCase({ space: 'l2', vectors: [[0, 0], [1, 0]], query: [0, 0], expectedTop: 0 });
      runCase({ space: 'cosine', vectors: [[1, 0], [0, 1]], query: [1, 0], expectedTop: 0 });
      runCase({ space: 'ip', vectors: [[1, 0], [0.5, 0.5]], query: [1, 0], expectedTop: 0 });
    }
  },
  {
    name: 'insert failures write failure reports during index build',
    async run() {
      const tempRoot = resolveTestCachePath(root, 'hnsw-runtime-matrix-insert-failures');
      const indexPath = path.join(tempRoot, 'dense_vectors_hnsw.bin');
      const metaPath = path.join(tempRoot, 'dense_vectors_hnsw.meta.json');

      await fsPromises.rm(tempRoot, { recursive: true, force: true });
      await fsPromises.mkdir(tempRoot, { recursive: true });

      const modulePath = require.resolve('hnswlib-node');
      const originalExports = require(modulePath);

      class FakeHNSW {
        initIndex() {}
        addPoint(_vec, label) {
          if (label === 1) throw new Error('simulated insert failure');
        }
        writeIndexSync() {}
      }

      try {
        const cached = require.cache[modulePath];
        if (cached) cached.exports = { HierarchicalNSW: FakeHNSW, default: FakeHNSW };
        const { createHnswBuilder } = await import('../../../tools/build/embeddings/hnsw.js');
        const builder = createHnswBuilder({
          enabled: true,
          config: normalizeHnswConfig({}),
          totalChunks: 2,
          mode: 'code',
          logger: null
        });
        builder.addVector(0, [0, 0]);
        builder.addVector(1, [1, 1]);

        let threw = false;
        try {
          await builder.writeIndex({
            indexPath,
            metaPath,
            modelId: 'test-model',
            dims: 2,
            quantization: { minVal: -1, maxVal: 1, levels: 256 },
            scale: 1
          });
        } catch {
          threw = true;
        }
        assert.equal(threw, true);

        const reportPath = metaPath.replace(/\.meta\.json$/i, '.failures.json');
        assert.equal(fs.existsSync(reportPath), true);
        const report = JSON.parse(await fsPromises.readFile(reportPath, 'utf8'));
        assert.equal(report.failed, 1);
        assert.ok(Array.isArray(report.failedChunks));
      } finally {
        const cached = require.cache[modulePath];
        if (cached) cached.exports = originalExports;
        await fsPromises.rm(tempRoot, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'load signatures keep the patched single-argument readIndexSync contract',
    async run() {
      const tempRoot = resolveTestCachePath(root, 'hnsw-runtime-matrix-load-signature');
      const indexPath = path.join(tempRoot, 'dense_vectors_hnsw.bin');

      await fsPromises.rm(tempRoot, { recursive: true, force: true });
      await fsPromises.mkdir(tempRoot, { recursive: true });
      await fsPromises.writeFile(indexPath, 'stub-index');

      const modulePath = require.resolve('hnswlib-node');
      const originalExports = require(modulePath);

      class FakeHNSWLoad {
        constructor(space, dims) {
          this.space = space;
          this.dims = dims;
        }
        readIndexSync(filePath) {
          FakeHNSWLoad.lastArgs = [filePath];
        }
        setEf() {}
      }
      FakeHNSWLoad.lastArgs = null;

      try {
        const cached = require.cache[modulePath];
        if (cached) cached.exports = { HierarchicalNSW: FakeHNSWLoad, default: FakeHNSWLoad };
        const index = loadHnswIndex({
          indexPath,
          dims: 2,
          config: normalizeHnswConfig({}),
          meta: { dims: 2, space: 'cosine' }
        });
        assert.ok(index);
        assert.ok(FakeHNSWLoad.lastArgs);
        assert.equal(FakeHNSWLoad.lastArgs.length, 1);
      } finally {
        const cached = require.cache[modulePath];
        if (cached) cached.exports = originalExports;
        await fsPromises.rm(tempRoot, { recursive: true, force: true });
      }
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('hnsw runtime contract matrix test passed');
