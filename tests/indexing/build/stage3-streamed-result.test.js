#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildStreamedStage3Result } from '../../../src/integrations/core/build-index/index.js';

const streamed = buildStreamedStage3Result({
  embedModes: ['code', 'prose'],
  streamedEmbeddingsByMode: [
    { mode: 'code', result: { embeddings: { queued: false, inline: true } } },
    { mode: 'prose', result: { embeddings: { queued: false, inline: true, cancelled: false } } }
  ],
  streamedCancelled: false,
  repo: '/tmp/repo'
});

assert.equal(streamed.stage, 'stage3', 'expected stage label to remain stage3');
assert.equal(streamed.embeddings.streamedFromStage2, true, 'expected streamed marker');
assert.equal(streamed.embeddings.cancelled, false, 'expected cancellation state');
assert.deepEqual(
  streamed.embeddings.perMode.map((entry) => entry.mode),
  ['code', 'prose'],
  'expected per-mode embedding summaries'
);

const cancelled = buildStreamedStage3Result({
  embedModes: ['code'],
  streamedEmbeddingsByMode: [{ mode: 'code', result: { embeddings: { cancelled: true } } }],
  streamedCancelled: true,
  repo: '/tmp/repo'
});
assert.equal(cancelled.embeddings.cancelled, true, 'expected cancelled stream result');

console.log('stage3 streamed result test passed');
