#!/usr/bin/env node
import assert from 'node:assert/strict';
import { classifyQuery } from '../../../src/retrieval/query-intent.js';

const fixtures = [
  {
    id: 'path_medium',
    query: 'src/server/index.js',
    tokens: ['src/server/index.js'],
    phrases: [],
    truth: 'path',
    bucket: 'medium'
  },
  {
    id: 'url_high',
    query: 'https://example.com/docs/api',
    tokens: ['https://example.com/docs/api'],
    phrases: [],
    truth: 'url',
    bucket: 'high'
  },
  {
    id: 'code_high',
    query: 'cacheHit && key',
    tokens: ['cacheHit', 'key'],
    phrases: [],
    truth: 'code',
    bucket: 'high'
  },
  {
    id: 'prose_high',
    query: 'how to configure proxy headers for outbound requests',
    tokens: ['how', 'to', 'configure', 'proxy', 'headers', 'for', 'outbound', 'requests'],
    phrases: ['configure proxy', 'proxy headers'],
    truth: 'prose',
    bucket: 'high'
  },
  {
    id: 'mixed_low',
    query: 'alpha',
    tokens: ['alpha'],
    phrases: [],
    truth: 'mixed',
    bucket: 'low'
  }
];

for (const fixture of fixtures) {
  const result = classifyQuery({
    query: fixture.query,
    tokens: fixture.tokens,
    phrases: fixture.phrases
  });
  assert.equal(result.type, fixture.truth, `${fixture.id}: expected truth label match`);
  assert.equal(result.confidenceBucket, fixture.bucket, `${fixture.id}: expected calibrated confidence bucket`);
  assert.equal(typeof result.confidence, 'number', `${fixture.id}: expected numeric confidence`);
  assert.equal(typeof result.confidenceMargin, 'number', `${fixture.id}: expected numeric confidence margin`);
  assert.equal(result.confidence, result.confidenceByType[result.type], `${fixture.id}: expected top confidence to match selected type`);
  assert.deepEqual(
    Object.keys(result.confidenceByType).sort(),
    ['code', 'mixed', 'path', 'prose', 'url'],
    `${fixture.id}: expected per-class confidence outputs`
  );
  const confidenceTotal = Object.values(result.confidenceByType).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(confidenceTotal - 1) < 1e-9, `${fixture.id}: expected per-class confidence values to normalize`);
}

const lowConfidenceFirst = classifyQuery({
  query: 'alpha',
  tokens: ['alpha'],
  phrases: []
});
const lowConfidenceSecond = classifyQuery({
  query: 'alpha',
  tokens: ['alpha'],
  phrases: []
});

assert.equal(lowConfidenceFirst.abstain, true, 'expected low-confidence query to trigger abstain');
assert.equal(lowConfidenceFirst.state, 'uncertain', 'expected low-confidence query to be marked uncertain');
assert.equal(lowConfidenceFirst.abstainReason, 'low_confidence', 'expected deterministic abstain reason code');
assert.equal(lowConfidenceFirst.effectiveType, 'mixed', 'expected abstain to force mixed effective type');
assert.deepEqual(
  {
    type: lowConfidenceFirst.type,
    effectiveType: lowConfidenceFirst.effectiveType,
    confidence: lowConfidenceFirst.confidence,
    confidenceBucket: lowConfidenceFirst.confidenceBucket,
    confidenceMargin: lowConfidenceFirst.confidenceMargin,
    abstain: lowConfidenceFirst.abstain,
    state: lowConfidenceFirst.state
  },
  {
    type: lowConfidenceSecond.type,
    effectiveType: lowConfidenceSecond.effectiveType,
    confidence: lowConfidenceSecond.confidence,
    confidenceBucket: lowConfidenceSecond.confidenceBucket,
    confidenceMargin: lowConfidenceSecond.confidenceMargin,
    abstain: lowConfidenceSecond.abstain,
    state: lowConfidenceSecond.state
  },
  'expected deterministic low-confidence abstain path'
);

console.log('intent confidence calibration test passed');
