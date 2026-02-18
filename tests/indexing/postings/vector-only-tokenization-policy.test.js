#!/usr/bin/env node
import assert from 'node:assert/strict';
import { INDEX_PROFILE_VECTOR_ONLY } from '../../../src/contracts/index-profile.js';
import { buildFeatureSettings } from '../../../src/index/build/indexer/pipeline.js';
import { resolveChunkProcessingFeatureFlags } from '../../../src/index/build/indexer/steps/process-files.js';

const vectorRuntime = {
  profile: { id: INDEX_PROFILE_VECTOR_ONLY },
  indexingConfig: { profile: INDEX_PROFILE_VECTOR_ONLY },
  analysisPolicy: {}
};

const vectorSettings = buildFeatureSettings(vectorRuntime, 'code');
assert.equal(vectorSettings.tokenize, true, 'vector_only feature settings should keep tokenization enabled');
assert.equal(vectorSettings.postings, false, 'vector_only feature settings should disable sparse postings');

const vectorFlags = resolveChunkProcessingFeatureFlags(vectorRuntime);
assert.equal(vectorFlags.tokenizeEnabled, true, 'vector_only processing should keep chunk tokenization enabled');
assert.equal(vectorFlags.sparsePostingsEnabled, false, 'vector_only processing should disable sparse postings');

const defaultFlags = resolveChunkProcessingFeatureFlags({
  profile: { id: 'default' },
  indexingConfig: { profile: 'default' }
});
assert.equal(defaultFlags.tokenizeEnabled, true, 'default processing should keep chunk tokenization enabled');
assert.equal(defaultFlags.sparsePostingsEnabled, true, 'default processing should keep sparse postings enabled');

console.log('vector-only tokenization policy test passed');
