#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const payload = renderSearchOutput({
  emitOutput: false,
  jsonOutput: true,
  jsonCompact: true,
  explain: false,
  color,
  rootDir: process.cwd(),
  backendLabel: 'memory',
  backendPolicyInfo: null,
  runCode: true,
  runProse: false,
  runExtractedProse: false,
  runRecords: false,
  topN: 1,
  queryTokens: ['alpha'],
  highlightRegex: /alpha/g,
  contextExpansionEnabled: false,
  expandedHits: {
    prose: { hits: [] },
    extractedProse: { hits: [] },
    code: { hits: [] },
    records: { hits: [] }
  },
  baseHits: {
    proseHits: [],
    extractedProseHits: [],
    codeHits: [],
    recordHits: []
  },
  annEnabled: false,
  annActive: false,
  annBackend: 'js',
  vectorExtension: { annMode: 'dense', provider: null, table: null },
  vectorAnnEnabled: false,
  vectorAnnState: {
    code: { available: false },
    prose: { available: false },
    records: { available: false },
    'extracted-prose': { available: false }
  },
  vectorAnnUsed: {
    code: false,
    prose: false,
    records: false,
    'extracted-prose': false
  },
  hnswConfig: { enabled: false },
  hnswAnnState: {
    code: { available: false },
    prose: { available: false },
    records: { available: false },
    'extracted-prose': { available: false }
  },
  lanceAnnState: {
    code: { available: false },
    prose: { available: false },
    records: { available: false },
    'extracted-prose': { available: false }
  },
  modelIds: { code: null, prose: null, extractedProse: null, records: null },
  embeddingProvider: null,
  embeddingOnnx: { modelPath: null, tokenizerId: null },
  cacheInfo: { enabled: false, hit: false, key: null },
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
  fieldWeights: null,
  contextExpansionStats: { enabled: false },
  idxProse: null,
  idxExtractedProse: null,
  idxCode: null,
  idxRecords: null,
  showStats: true,
  showMatched: false,
  verboseCache: false,
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
