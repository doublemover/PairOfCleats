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
    file: 'src/app.js',
    lang: 'javascript',
    tokens: ['alpha'],
    codeRelations: {
      calls: [['run', 'fetchData']],
      usages: ['fetchData', 'result']
    }
  }]
});

const pipeline = createRelationBoostPipeline({
  query: 'fetchData result',
  queryTokens: ['fetchdata', 'result'],
  relationBoost: {
    enabled: true,
    perCall: 0.25,
    perUse: 0.1,
    maxBoost: 1.5
  },
  rankSqliteFts: () => [{ idx: 0, score: 2 }]
});

const hit = (await pipeline(idx, 'code', null))[0];
assert.ok(hit?.scoreBreakdown?.relation, 'expected relation boost explain payload');
assert.equal(hit.scoreBreakdown.relation.enabled, true, 'expected relation boost explain enabled flag');
assert.equal(hit.scoreBreakdown.relation.callMatches, 1, 'expected call match count in explain');
assert.equal(hit.scoreBreakdown.relation.usageMatches, 2, 'expected usage match count in explain');
assert.equal(hit.scoreBreakdown.relation.perCall, 0.25, 'expected perCall weight in explain');
assert.equal(hit.scoreBreakdown.relation.perUse, 0.1, 'expected perUse weight in explain');
assert.equal(hit.scoreBreakdown.relation.maxBoost, 1.5, 'expected maxBoost in explain');
assert.ok(Array.isArray(hit.scoreBreakdown.relation.signalTokens), 'expected bounded signal token list');
assert.ok(Array.isArray(hit.scoreBreakdown.relation.matchedCalls), 'expected bounded call token list');
assert.ok(Array.isArray(hit.scoreBreakdown.relation.matchedUsages), 'expected bounded usage token list');
assert.ok(
  hit.scoreBreakdown.relation.signalTokens.length <= hit.scoreBreakdown.relation.maxExplainTokens,
  'expected signal token list to respect explain cap'
);
assert.ok(
  hit.scoreBreakdown.relation.matchedCalls.length <= hit.scoreBreakdown.relation.maxExplainTokens,
  'expected call token list to respect explain cap'
);
assert.ok(
  hit.scoreBreakdown.relation.matchedUsages.length <= hit.scoreBreakdown.relation.maxExplainTokens,
  'expected usage token list to respect explain cap'
);
assert.ok(
  hit.scoreBreakdown.relation.lexicon && typeof hit.scoreBreakdown.relation.lexicon === 'object',
  'expected lexicon status in relation boost explain payload'
);
assert.equal(typeof hit.scoreBreakdown.relation.lexicon.sourceFile, 'string', 'expected lexicon source file');
assert.equal(hit.scoreBreakdown.relation.lexicon.formatVersion, 1, 'expected lexicon format version');
assert.equal(
  typeof hit.scoreBreakdown.relation.lexicon.domainTokenCounts?.relations,
  'number',
  'expected lexicon relations-domain token count'
);
assert.equal(
  typeof hit.scoreBreakdown.relation.lexicon.domainTokenCounts?.ranking,
  'number',
  'expected lexicon ranking-domain token count'
);
assert.equal(
  typeof hit.scoreBreakdown.relation.lexicon.domainTokenCounts?.chargrams,
  'number',
  'expected lexicon chargram-domain token count'
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
  routingPolicy: { byMode: { code: { desired: 'sparse', route: 'sparse' } } },
  runCode: true,
  runProse: false,
  runExtractedProse: false,
  runRecords: false,
  topN: 5,
  queryTokens: ['fetchdata', 'result'],
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
  annEnabled: false,
  annActive: false,
  annBackend: 'none',
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

assert.ok(payload?.stats?.relationBoost, 'expected stats relationBoost section');
assert.equal(payload.stats.relationBoost.callMatches, 1, 'expected stats relationBoost call matches');
assert.equal(payload.stats.relationBoost.usageMatches, 2, 'expected stats relationBoost usage matches');
assert.ok(payload?.stats?.lexicon, 'expected stats lexicon section');
assert.equal(typeof payload.stats.lexicon.sourceFile, 'string', 'expected stats lexicon source file');
assert.equal(payload.stats.lexicon.formatVersion, 1, 'expected stats lexicon format version');
assert.equal(typeof payload.stats.lexicon.domainTokenCounts?.relations, 'number', 'expected stats lexicon relations count');
assert.equal(typeof payload.stats.lexicon.domainTokenCounts?.ranking, 'number', 'expected stats lexicon ranking count');
assert.equal(typeof payload.stats.lexicon.domainTokenCounts?.chargrams, 'number', 'expected stats lexicon chargram count');

console.log('explain includes relation boost test passed');
