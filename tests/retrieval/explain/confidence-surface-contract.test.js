#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutputForTest } from '../helpers/search-output-fixture.js';
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

const payload = renderSearchOutputForTest({
  queryTokens: ['proxy', 'headers'],
  intentInfo
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
