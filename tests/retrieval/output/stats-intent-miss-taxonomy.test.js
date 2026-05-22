#!/usr/bin/env node
import assert from 'node:assert/strict';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { renderSearchOutputForTest } from '../helpers/search-output-fixture.js';

applyTestEnv();

const payload = renderSearchOutputForTest({
  explain: false,
  color,
  backendPolicyInfo: null,
  topN: 1,
  highlightRegex: /alpha/g,
  annBackend: 'js',
  vectorExtension: { annMode: 'dense', provider: null, table: null },
  modelIds: { code: null, prose: null, extractedProse: null, records: null },
  embeddingProvider: null,
  embeddingOnnx: { modelPath: null, tokenizerId: null },
  intentInfo: {
    type: 'code',
    effectiveType: 'code',
    confidence: 0.63,
    confidenceBucket: 'medium',
    parseStrategy: 'heuristic-fallback',
    parseFallbackReason: 'query_parser_failed',
    missTaxonomy: {
      labels: ['lexical_language_segmentation', 'rank_symbol_heavy_query'],
      primaryLabel: 'lexical_language_segmentation'
    }
  },
  resolvedDenseVectorMode: 'merged',
  contextExpansionStats: { enabled: false },
  idxProse: null,
  idxExtractedProse: null,
  idxCode: null,
  idxRecords: null,
  showStats: true,
  elapsedMs: 2
});

assert.ok(payload?.stats?.intent, 'expected stats.intent payload');
assert.equal(payload.stats.intent.type, 'code');
assert.equal(payload.stats.intent.parseStrategy, 'heuristic-fallback');
assert.deepEqual(
  payload.stats.intent.missTaxonomy?.labels,
  ['lexical_language_segmentation', 'rank_symbol_heavy_query'],
  'expected miss taxonomy labels in non-explain stats payload'
);

console.log('search stats intent miss-taxonomy output test passed');
