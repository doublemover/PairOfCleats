#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import {
  TRUST_SURFACE_SCHEMA_VERSION,
  readTrustSurface
} from '../../../src/retrieval/output/explain.js';
import { classifyQuery } from '../../../src/retrieval/query-intent.js';

const intentInfo = classifyQuery({
  query: 'how to configure proxy headers for outbound requests',
  tokens: ['how', 'to', 'configure', 'proxy', 'headers', 'for', 'outbound', 'requests'],
  phrases: ['configure proxy', 'proxy headers']
});

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
  queryTokens: ['proxy', 'headers'],
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
  intentInfo,
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

const trust = payload?.stats?.trust || null;
assert.ok(trust, 'expected trust surface in explain stats');
assert.equal(trust.schemaVersion, TRUST_SURFACE_SCHEMA_VERSION, 'expected trust schema version');
assert.ok(
  trust.confidence.bucket === 'low' || trust.confidence.bucket === 'medium' || trust.confidence.bucket === 'high',
  'expected confidence bucket contract'
);
assert.deepEqual(
  Object.keys(trust.confidence.buckets).sort(),
  ['high', 'low', 'medium'],
  'expected confidence bucket definitions'
);
assert.equal(typeof trust.signals.intentAbstained, 'boolean', 'expected intentAbstained signal');
assert.equal(typeof trust.signals.parseFallback, 'boolean', 'expected parseFallback signal');
assert.equal(typeof trust.signals.contextExpansionTruncated, 'boolean', 'expected context expansion truncation signal');
assert.equal(typeof trust.signals.annCandidateConstrained, 'boolean', 'expected ANN constrained signal');

const parsed = readTrustSurface({
  ...trust,
  forwardCompatField: { shouldBeIgnored: true },
  confidence: {
    ...trust.confidence,
    forwardCompatConfidenceField: 123
  },
  signals: {
    ...trust.signals,
    futureSignal: true
  }
});

assert.equal(parsed.schemaVersion, TRUST_SURFACE_SCHEMA_VERSION, 'expected trust reader to parse schema version');
assert.equal(parsed.confidence.bucket, trust.confidence.bucket, 'expected trust reader to preserve known confidence fields');
assert.equal(parsed.signals.intentAbstained, trust.signals.intentAbstained, 'expected trust reader to preserve known signals');
assert.ok(!('forwardCompatField' in parsed), 'expected trust reader to ignore unknown top-level fields');
assert.ok(!('futureSignal' in parsed.signals), 'expected trust reader to ignore unknown signal fields');

console.log('confidence surface contract test passed');
