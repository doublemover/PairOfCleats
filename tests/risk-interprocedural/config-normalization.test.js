#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeRiskInterproceduralConfig } from '../../src/index/risk-interprocedural/config.js';

const defaults = normalizeRiskInterproceduralConfig({}, { mode: 'code' });
assert.equal(defaults.enabled, false, 'default enabled should be false');
assert.equal(defaults.summaryOnly, false, 'default summaryOnly should be false');
assert.equal(defaults.strictness, 'conservative');
assert.equal(defaults.sanitizerPolicy, 'terminate');
assert.equal(defaults.emitArtifacts, 'jsonl');
assert.equal(defaults.caps.maxDepth, 4);
assert.equal(defaults.caps.maxPathsPerPair, 3);

const normalized = normalizeRiskInterproceduralConfig({
  enabled: true,
  summaryOnly: true,
  strictness: 'argAware',
  sanitizerPolicy: 'weaken',
  emitArtifacts: 'off',
  caps: {
    maxDepth: 0,
    maxPathsPerPair: 99,
    maxTotalFlows: -5,
    maxCallSitesPerEdge: 999,
    maxEdgeExpansions: 1,
    maxMs: null
  }
}, { mode: 'code' });

assert.equal(normalized.enabled, true);
assert.equal(normalized.summaryOnly, true);
assert.equal(normalized.strictness, 'argAware');
assert.equal(normalized.sanitizerPolicy, 'weaken');
assert.equal(normalized.emitArtifacts, 'none');
assert.equal(normalized.caps.maxDepth, 1, 'maxDepth should clamp to min');
assert.equal(normalized.caps.maxPathsPerPair, 50, 'maxPathsPerPair should clamp to max');
assert.equal(normalized.caps.maxTotalFlows, 0, 'maxTotalFlows should clamp to min');
assert.equal(normalized.caps.maxCallSitesPerEdge, 50, 'maxCallSitesPerEdge should clamp to max');
assert.equal(normalized.caps.maxEdgeExpansions, 10000, 'maxEdgeExpansions should clamp to min');
assert.equal(normalized.caps.maxMs, null, 'maxMs should allow null');

const proseMode = normalizeRiskInterproceduralConfig({ enabled: true }, { mode: 'prose' });
assert.equal(proseMode.enabled, false, 'non-code modes should disable interprocedural');

console.log('risk interprocedural config normalization test passed');
