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
assert.equal(streamed.embeddings.inline, true, 'expected inline summary when all modes inline');
assert.equal(streamed.embeddings.queued, false, 'expected queued summary false when no queued modes');
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

const mixed = buildStreamedStage3Result({
  embedModes: ['code', 'prose'],
  streamedEmbeddingsByMode: [
    { mode: 'code', result: { embeddings: { queued: true, inline: false } } },
    { mode: 'prose', result: { embeddings: { queued: false, inline: true } } }
  ],
  streamedCancelled: false,
  repo: '/tmp/repo'
});
assert.equal(mixed.embeddings.mixed, true, 'expected mixed summary for queued+inline blend');
assert.equal(mixed.embeddings.queued, false, 'expected queued=false in mixed summary');
assert.equal(mixed.embeddings.inline, false, 'expected inline=false in mixed summary');
assert.equal(mixed.embeddings.queuedModeCount, 1, 'expected queued mode count');
assert.equal(mixed.embeddings.inlineModeCount, 1, 'expected inline mode count');

console.log('stage3 streamed result test passed');
