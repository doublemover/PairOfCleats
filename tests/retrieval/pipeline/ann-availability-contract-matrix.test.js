#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { loadSearchIndexes } from '../../../src/retrieval/cli/load-indexes.js';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { buildAnnPipelineFixture, runAnnFallbackScenario } from './helpers/ann-scenarios.js';

applyTestEnv({ testing: '1' });

const cases = [
  {
    name: 'missing ann providers fall back to sparse retrieval while marking stage warnings',
    async run() {
      const { outputs, stageTracker } = await runAnnFallbackScenario({
        createAnnProviders: () => new Map(),
        runs: 1
      });
      assert.ok(Array.isArray(outputs[0]) && outputs[0].length > 0);

      const annStage = stageTracker.stages.find((entry) => entry.stage === 'ann');
      assert.ok(annStage);
      assert.equal(annStage.warned, true);
      assert.equal(annStage.providerAvailable, false);
    }
  },
  {
    name: 'failed provider preflight is cached and suppresses ann queries during cooldown',
    async run() {
      let preflightCalls = 0;
      let queryCalls = 0;
      const provider = {
        id: ANN_PROVIDER_IDS.DENSE,
        isAvailable: () => true,
        preflight: async () => {
          preflightCalls += 1;
          return false;
        },
        query: async () => {
          queryCalls += 1;
          return [{ idx: 0, sim: 0.9 }];
        }
      };

      const { stageTracker, context, idx } = buildAnnPipelineFixture({
        createAnnProviders: () => new Map([[ANN_PROVIDER_IDS.DENSE, provider]])
      });
      const pipeline = createSearchPipeline(context);

      const realDateNow = Date.now;
      let nowMs = realDateNow();
      Date.now = () => nowMs;
      try {
        const first = await pipeline(idx, 'code', [0.1, 0.2]);
        nowMs += 500;
        const second = await pipeline(idx, 'code', [0.1, 0.2]);
        assert.ok(first.length > 0);
        assert.ok(second.length > 0);
      } finally {
        Date.now = realDateNow;
      }

      assert.equal(preflightCalls, 1);
      assert.equal(queryCalls, 0);
      const lastAnnStage = stageTracker.stages.filter((entry) => entry.stage === 'ann').at(-1);
      assert.ok(lastAnnStage);
      assert.equal(lastAnnStage.warned, true);
      assert.equal(lastAnnStage.providerAvailable, false);
    }
  },
  {
    name: 'non-strict lancedb loads fall back to legacy metadata and directory paths',
    async run() {
      const root = process.cwd();
      const fixtureRoot = resolveTestCachePath(root, 'ann-availability-contract-matrix-lancedb-fallback');
      const indexDir = path.join(fixtureRoot, 'index-code');
      await fs.rm(fixtureRoot, { recursive: true, force: true });
      await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
      await fs.mkdir(path.join(indexDir, 'dense_vectors.lancedb'), { recursive: true });

      const compatibilityKey = 'compat-lancedb-nonstrict-fallback';
      const dims = 4;
      const manifest = {
        version: 2,
        artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
        compatibilityKey,
        pieces: [
          { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
          { type: 'chunks', name: 'file_meta', format: 'json', path: 'file_meta.json' },
          { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
          { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
          { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' },
          { type: 'embeddings', name: 'dense_vectors', format: 'json', path: 'dense_vectors_uint8.json', count: 1, dims }
        ]
      };

      await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([{ id: 0, file: 'src/a.js', start: 0, end: 1 }], null, 2));
      await fs.writeFile(path.join(indexDir, 'file_meta.json'), JSON.stringify([{ id: 0, file: 'src/a.js', ext: '.js' }], null, 2));
      await fs.writeFile(path.join(indexDir, 'token_postings.json'), JSON.stringify({
        vocab: ['alpha'],
        postings: [[[0, 1]]],
        docLengths: [1],
        avgDocLen: 1,
        totalDocs: 1
      }, null, 2));
      await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
        generatedAt: new Date().toISOString(),
        mode: 'code',
        artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
        compatibilityKey,
        embeddings: {
          ready: true,
          pending: false,
          embeddingIdentity: {
            dims,
            model: 'stub-model',
            scale: 1,
            minVal: -1,
            maxVal: 1,
            levels: 255
          }
        }
      }, null, 2));
      await fs.writeFile(path.join(indexDir, '.filelists.json'), JSON.stringify({
        generatedAt: new Date().toISOString(),
        scanned: { count: 1, sample: [] },
        skipped: { count: 0, sample: [] }
      }, null, 2));
      await fs.writeFile(path.join(indexDir, 'dense_vectors_uint8.json'), JSON.stringify({
        dims,
        model: 'stub-model',
        scale: 1,
        minVal: -1,
        maxVal: 1,
        levels: 255,
        vectors: [new Array(dims).fill(0)]
      }, null, 2));
      await fs.writeFile(path.join(indexDir, 'dense_vectors.lancedb.meta.json'), JSON.stringify({
        version: 1,
        generatedAt: new Date().toISOString(),
        model: 'stub-model',
        dims,
        count: 1,
        metric: 'cosine',
        table: 'vectors',
        embeddingColumn: 'vector',
        idColumn: 'id',
        scale: 1,
        minVal: -1,
        maxVal: 1,
        levels: 255
      }, null, 2));
      await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest, null, 2));

      const loaded = await loadSearchIndexes({
        rootDir: fixtureRoot,
        userConfig: {},
        searchMode: 'code',
        runProse: false,
        runExtractedProse: false,
        loadExtractedProse: false,
        runCode: true,
        runRecords: false,
        useSqlite: false,
        useLmdb: false,
        emitOutput: false,
        exitOnError: false,
        annActive: true,
        filtersActive: false,
        contextExpansionEnabled: false,
        graphRankingEnabled: false,
        sqliteFtsRequested: false,
        backendLabel: 'memory',
        backendForcedTantivy: false,
        indexCache: null,
        modelIdDefault: null,
        fileChargramN: null,
        hnswConfig: { enabled: false },
        lancedbConfig: { enabled: true },
        tantivyConfig: { enabled: false },
        strict: false,
        loadIndexFromSqlite: () => ({}),
        loadIndexFromLmdb: () => ({}),
        resolvedDenseVectorMode: 'merged',
        requiredArtifacts: new Set(['ann'])
      });

      assert.ok(loaded?.idxCode?.lancedb);
      assert.equal(loaded.idxCode.lancedb.available, true);
      assert.equal(loaded.idxCode.lancedb.meta?.dims, dims);
      assert.equal(path.basename(loaded.idxCode.lancedb.dir || ''), 'dense_vectors.lancedb');
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('ann availability contract matrix test passed');
