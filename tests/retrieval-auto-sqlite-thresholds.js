#!/usr/bin/env node
import assert from 'node:assert/strict';
import { evaluateAutoSqliteThresholds } from '../src/retrieval/cli/auto-sqlite.js';

const disabled = evaluateAutoSqliteThresholds({
  stats: [{ chunkCount: null, artifactBytes: null }],
  chunkThreshold: 0,
  artifactThreshold: 0
});
assert.equal(disabled.allowed, true, 'expected disabled thresholds to allow sqlite');

const missingChunks = evaluateAutoSqliteThresholds({
  stats: [{ chunkCount: null, artifactBytes: 1200 }],
  chunkThreshold: 10,
  artifactThreshold: 0
});
assert.equal(missingChunks.allowed, false, 'expected missing chunk stats to reject sqlite');
assert.ok(
  missingChunks.reason && missingChunks.reason.includes('chunk stats are unavailable'),
  'expected missing chunk stats reason'
);

const missingBytes = evaluateAutoSqliteThresholds({
  stats: [{ chunkCount: 12, artifactBytes: null }],
  chunkThreshold: 0,
  artifactThreshold: 5000
});
assert.equal(missingBytes.allowed, false, 'expected missing bytes stats to reject sqlite');
assert.ok(
  missingBytes.reason && missingBytes.reason.includes('artifact bytes are unavailable'),
  'expected missing artifact bytes reason'
);

const tooSmall = evaluateAutoSqliteThresholds({
  stats: [{ chunkCount: 5, artifactBytes: 100 }],
  chunkThreshold: 10,
  artifactThreshold: 1000
});
assert.equal(tooSmall.allowed, false, 'expected thresholds not met to reject sqlite');
assert.ok(
  tooSmall.reason && tooSmall.reason.includes('auto sqlite thresholds not met'),
  'expected thresholds not met reason'
);

const meetsBytes = evaluateAutoSqliteThresholds({
  stats: [{ chunkCount: 5, artifactBytes: 1500 }],
  chunkThreshold: 0,
  artifactThreshold: 1000
});
assert.equal(meetsBytes.allowed, true, 'expected bytes threshold to allow sqlite');

console.log('retrieval auto sqlite thresholds test passed');
