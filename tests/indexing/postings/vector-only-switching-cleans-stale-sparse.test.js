#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  createVectorOnlyCleanupWriteContext,
  hasTokenPostingsArtifacts,
  readArtifactCleanupActions
} from './helpers/vector-only-cleanup-fixture.js';

const { outDir, runWrite } = await createVectorOnlyCleanupWriteContext('phase18-vector-only-switch-cleanup');

await runWrite({ profileId: 'default' });
assert.equal(
  hasTokenPostingsArtifacts(outDir),
  true,
  'expected default profile write to emit token_postings artifact'
);

await runWrite({ profileId: 'vector_only' });
assert.equal(
  hasTokenPostingsArtifacts(outDir),
  false,
  'expected vector_only profile write to clean stale token_postings artifact'
);

const actions = await readArtifactCleanupActions(outDir);
assert.equal(
  actions.some((entry) => String(entry?.path || '').includes('token_postings')),
  true,
  'expected cleanup report to include token_postings removal actions'
);

console.log('vector-only stale sparse cleanup test passed');
