#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';

const profileInfo = {
  byMode: {
    code: {
      profileId: 'vector_only',
      vectorOnly: true,
      allowSparseFallback: true,
      sparseUnavailableReason: 'profile_vector_only'
    }
  },
  warnings: [
    'Sparse-only request overridden for vector_only mode(s): code. ANN fallback was used.'
  ]
};

const payload = renderSearchOutput({
  emitOutput: false,
  jsonOutput: true,
  jsonCompact: true,
  explain: true,
  color: {},
  rootDir: process.cwd(),
  backendLabel: 'memory',
  backendPolicyInfo: { backendLabel: 'memory', reason: 'test' },
  routingPolicy: { byMode: { code: { desired: 'sparse', reason: 'test' } } },
  runCode: true,
  runProse: false,
  runExtractedProse: false,
  runRecords: false,
  topN: 5,
  queryTokens: ['alpha'],
  highlightRegex: null,
  contextExpansionEnabled: false,
  expandedHits: {
    prose: { hits: [], contextHits: [] },
    extractedProse: { hits: [], contextHits: [] },
    code: { hits: [], contextHits: [] },
    records: { hits: [], contextHits: [] }
  },
  baseHits: {
    proseHits: [],
    extractedProseHits: [],
    codeHits: [],
    recordHits: []
  },
  annEnabled: true,
  annActive: true,
  annBackend: 'js',
  vectorExtension: { annMode: 'none', provider: 'none', table: null },
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
    code: { available: false, metric: null },
    prose: { available: false, metric: null },
    records: { available: false, metric: null },
    'extracted-prose': { available: false, metric: null }
  },
  modelIds: {
    code: 'test-model',
    prose: 'test-model',
    extractedProse: 'test-model',
    records: 'test-model'
  },
  embeddingProvider: 'stub',
  embeddingOnnx: {},
  cacheInfo: { enabled: false, hit: false, key: null },
  profileInfo,
  intentInfo: { type: 'keyword' },
  resolvedDenseVectorMode: 'auto',
  fieldWeights: null,
  contextExpansionStats: {
    enabled: false,
    code: { added: 0, workUnitsUsed: 0, truncation: null },
    prose: { added: 0, workUnitsUsed: 0, truncation: null },
    'extracted-prose': { added: 0, workUnitsUsed: 0, truncation: null },
    records: { added: 0, workUnitsUsed: 0, truncation: null }
  },
  idxProse: { chunkMeta: [] },
  idxExtractedProse: { chunkMeta: [] },
  idxCode: { chunkMeta: [] },
  idxRecords: { chunkMeta: [] },
  showStats: false,
  showMatched: false,
  verboseCache: false,
  elapsedMs: 5,
  stageTracker: null
});

assert.equal(payload?.stats?.profile?.byMode?.code?.profileId, 'vector_only');
assert.equal(payload?.stats?.profile?.byMode?.code?.sparseUnavailableReason, 'profile_vector_only');
assert.ok(
  payload?.stats?.profile?.warnings?.some((entry) => String(entry).includes('ANN fallback')),
  'expected profile warnings to include override guidance'
);

console.log('explain vector-only warnings test passed');
