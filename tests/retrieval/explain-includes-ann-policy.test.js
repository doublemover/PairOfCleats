#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createRelationBoostIndex,
  createRelationBoostPipeline
} from './helpers/relation-boost-fixture.js';
import { renderSearchOutput } from '../../src/retrieval/cli/render.js';

const idx = createRelationBoostIndex({
  chunks: [{
    id: 0,
    file: 'src/a.js',
    lang: 'javascript',
    tokens: ['alpha'],
    codeRelations: { usages: ['alpha'] }
  }]
});

const pipeline = createRelationBoostPipeline({
  query: 'alpha',
  queryTokens: ['alpha'],
  annEnabled: true,
  annBackend: 'sqlite',
  vectorAnnAvailable: true,
  annCandidateCap: 20000,
  annCandidateMinDocCount: 100,
  annCandidateMaxDocCount: 20000,
  rankSqliteFts: () => [{ idx: 0, score: 1 }],
  rankVectorAnnSqlite: () => [{ idx: 0, sim: 0.9 }]
});

const hit = (await pipeline(idx, 'code', [0.1, 0.2, 0.3]))[0];
const annPolicy = hit?.scoreBreakdown?.ann?.candidatePolicy || null;

assert.ok(annPolicy, 'expected ann candidate policy explain section');
assert.equal(typeof annPolicy.reason, 'string', 'expected policy reason code');
assert.equal(typeof annPolicy.inputSize, 'number', 'expected input size in policy explain');
assert.equal(typeof annPolicy.outputMode, 'string', 'expected output mode in policy explain');
assert.equal(typeof annPolicy.minDocCount, 'number', 'expected minDocCount in policy explain');
assert.equal(typeof annPolicy.maxDocCount, 'number', 'expected maxDocCount in policy explain');
assert.ok(
  annPolicy.outputMode === 'constrained' || annPolicy.outputMode === 'full',
  'expected policy output mode contract'
);
assert.ok(
  annPolicy.reason === 'tooSmallNoFilters'
  || annPolicy.reason === 'ok'
  || annPolicy.reason === 'filtersActiveAllowedIdx'
  || annPolicy.reason === 'tooLarge'
  || annPolicy.reason === 'noCandidates',
  'unexpected policy reason code'
);

const payload = renderSearchOutput({
  emitOutput: false,
  jsonOutput: true,
  jsonCompact: true,
  explain: true,
  color: {},
  rootDir: process.cwd(),
  backendLabel: 'memory',
  backendPolicyInfo: { backendLabel: 'memory', reason: 'test' },
  routingPolicy: { byMode: { code: { desired: 'ann', route: 'ann' } } },
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
    code: { hits: [hit], contextHits: [] },
    records: { hits: [], contextHits: [] }
  },
  baseHits: {
    proseHits: [],
    extractedProseHits: [],
    codeHits: [hit],
    recordHits: []
  },
  annEnabled: true,
  annActive: true,
  annBackend: 'sqlite',
  vectorExtension: { annMode: 'sqlite', provider: 'sqlite', table: 'vec_chunks' },
  vectorAnnEnabled: true,
  vectorAnnState: {
    code: { available: true },
    prose: { available: false },
    records: { available: false },
    'extracted-prose': { available: false }
  },
  vectorAnnUsed: {
    code: true,
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
  profileInfo: null,
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
  idxCode: { chunkMeta: [hit] },
  idxRecords: { chunkMeta: [] },
  showStats: false,
  showMatched: false,
  verboseCache: false,
  elapsedMs: 5,
  stageTracker: null
});

assert.ok(payload?.stats?.annCandidatePolicy, 'expected stats annCandidatePolicy section');
assert.equal(typeof payload.stats.annCandidatePolicy.reason, 'string', 'expected stats policy reason code');
assert.equal(typeof payload.stats.annCandidatePolicy.inputSize, 'number', 'expected stats policy input size');
assert.equal(typeof payload.stats.annCandidatePolicy.outputMode, 'string', 'expected stats policy output mode');

console.log('explain includes ann policy test passed');
