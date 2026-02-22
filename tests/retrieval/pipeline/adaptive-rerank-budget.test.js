#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveAdaptiveRerankBudget } from '../../../src/retrieval/pipeline.js';

const lowEntropyHighConfidence = resolveAdaptiveRerankBudget({
  searchTopN: 20,
  baseTopkSlack: 16,
  queryTokens: ['router'],
  sparseHits: [
    { idx: 1, score: 10 },
    { idx: 2, score: 4 },
    { idx: 3, score: 3 }
  ].concat(Array.from({ length: 40 }, (_, i) => ({ idx: i + 4, score: 1 }))),
  annHits: []
});
assert.equal(
  lowEntropyHighConfidence.reason,
  'high_confidence_low_entropy',
  'expected low-entropy/high-confidence rerank policy'
);
assert.ok(lowEntropyHighConfidence.topkSlack < 16, 'expected reduced rerank slack for confident short query');

const highEntropyLowConfidence = resolveAdaptiveRerankBudget({
  searchTopN: 20,
  baseTopkSlack: 10,
  queryTokens: ['foo::bar', 'client-side', 'adapter', 'routing', 'fallback', 'latency', 'throughput', 'cache'],
  sparseHits: [{ idx: 1, score: 1.05 }, { idx: 2, score: 1.0 }],
  annHits: Array.from({ length: 60 }, (_, i) => ({ idx: i, sim: 0.1 }))
});
assert.equal(
  highEntropyLowConfidence.reason,
  'high_entropy_or_low_confidence',
  'expected expanded rerank budget for high-entropy/weak sparse confidence'
);
assert.ok(highEntropyLowConfidence.topkSlack >= 18, 'expected expanded rerank slack');
assert.equal(
  highEntropyLowConfidence.rerankCap,
  20 + highEntropyLowConfidence.topkSlack,
  'expected rerank cap to match topN+slack'
);

console.log('adaptive rerank budget test passed');
