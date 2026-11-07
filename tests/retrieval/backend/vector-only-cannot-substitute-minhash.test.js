import assert from 'node:assert/strict';
import { createAlphaSearchIndex, createSearchPipelineFixture } from '../helpers/search-pipeline-fixture.js';
const pipeline = createSearchPipelineFixture({ annEnabled: true, profilePolicyByMode: {
  prose: { profileId: 'vector_only', vectorOnly: true, allowSparseFallback: false }
} });
const idx = createAlphaSearchIndex({ tokenIndex: null });
Object.defineProperty(idx, 'minhash', { get() { throw new Error('vector-only must not enter MinHash fallback'); } });
await assert.rejects(pipeline(idx, 'prose', null), error => error.code === 'CAPABILITY_MISSING'
  && error.reasonCode === 'retrieval_vector_required');
console.log('Vector-only capability failure cannot be hidden by MinHash results.');
