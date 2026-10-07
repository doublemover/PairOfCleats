#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import path from 'node:path';

import { INDEX_PROFILE_VECTOR_ONLY } from '../../../src/contracts/index-profile.js';
import { resolveVectorOnlyShortcutPolicy, buildFeatureSettings } from '../../../src/index/build/indexer/pipeline.js';
import { resolveChunkProcessingFeatureFlags } from '../../../src/index/build/indexer/steps/process-files.js';
import { applyTestEnv, ensureTestingEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import {
  createVectorOnlyBuildEnv,
  createVectorOnlyBuildRoots,
  createVectorOnlyCleanupWriteContext,
  hasTokenPostingsArtifacts
} from './helpers/vector-only-cleanup-fixture.js';

applyTestEnv();

const { buildScript, fixtureRoot } = createVectorOnlyBuildRoots('postings-vector-only-policy-contract-matrix');

const cases = [
  {
    name: 'vector-only runtime policy keeps tokenization but disables sparse postings',
    async run() {
      const vectorRuntime = {
        profile: { id: INDEX_PROFILE_VECTOR_ONLY },
        indexingConfig: { profile: INDEX_PROFILE_VECTOR_ONLY },
        analysisPolicy: {}
      };
      const vectorSettings = buildFeatureSettings(vectorRuntime, 'code');
      assert.equal(vectorSettings.tokenize, true);
      assert.equal(vectorSettings.postings, false);

      const vectorFlags = resolveChunkProcessingFeatureFlags(vectorRuntime);
      assert.equal(vectorFlags.tokenizeEnabled, true);
      assert.equal(vectorFlags.sparsePostingsEnabled, false);

      const shortcutPolicy = resolveVectorOnlyShortcutPolicy({
        profile: { id: INDEX_PROFILE_VECTOR_ONLY },
        indexingConfig: { profile: INDEX_PROFILE_VECTOR_ONLY }
      });
      assert.equal(shortcutPolicy.enabled, true);
      assert.equal(shortcutPolicy.disableImportGraph, true);
      assert.equal(shortcutPolicy.disableCrossFileInference, true);
    }
  },
  {
    name: 'vector-only shortcuts honor explicit opt-out',
    async run() {
      const shortcutPolicy = resolveVectorOnlyShortcutPolicy({
        profile: { id: INDEX_PROFILE_VECTOR_ONLY },
        indexingConfig: {
          profile: INDEX_PROFILE_VECTOR_ONLY,
          vectorOnly: {
            disableImportGraph: false,
            disableCrossFileInference: false
          }
        }
      });
      assert.equal(shortcutPolicy.enabled, true);
      assert.equal(shortcutPolicy.disableImportGraph, false);
      assert.equal(shortcutPolicy.disableCrossFileInference, false);
    }
  },
  {
    name: 'vector-only writes omit sparse artifacts on a clean output root',
    async run() {
      const { outDir, runWrite } = await createVectorOnlyCleanupWriteContext('postings-vector-only-clean-write');
      await runWrite({ profileId: INDEX_PROFILE_VECTOR_ONLY });
      assert.equal(hasTokenPostingsArtifacts(outDir), false);
      assert.equal(fsSync.existsSync(path.join(outDir, 'token_postings.shards')), false);
    }
  },
  {
    name: 'vector-only builds fail closed when embeddings are disabled',
    async run() {
      const { cacheRoot } = createVectorOnlyBuildRoots('postings-vector-only-missing-embeddings');
      const testConfig = {
        indexing: {
          profile: INDEX_PROFILE_VECTOR_ONLY,
          embeddings: {
            enabled: true,
            mode: 'off',
            hnsw: { enabled: false },
            lancedb: { enabled: false }
          }
        },
        sqlite: { use: false },
        lmdb: { use: false }
      };
      const env = createVectorOnlyBuildEnv({ cacheRoot, testConfig, stage: '' });
      ensureTestingEnv(env);

      const result = runNode(
        [buildScript, '--repo', fixtureRoot, '--mode', 'code', '--stage', 'stage2'],
        'vector-only missing embeddings build index',
        fixtureRoot,
        env,
        { encoding: 'utf8', stdio: 'pipe', allowFailure: true }
      );
      assert.notEqual(result.status, 0);
      const output = `${result.stderr || ''}\n${result.stdout || ''}`;
      assert.equal(output.includes('indexing.profile=vector_only requires embeddings'), true);
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('vector-only policy contract matrix test passed');
