#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeRiskInterproceduralConfig } from '../../../../src/index/risk-interprocedural/config.js';

const defaults = normalizeRiskInterproceduralConfig({}, { mode: 'code' });
assert.equal(defaults.enabled, false, 'default enabled should be false');
assert.equal(defaults.summaryOnly, false, 'default summaryOnly should be false');
assert.equal(defaults.strictness, 'conservative');
assert.equal(defaults.sanitizerPolicy, 'terminate');
assert.equal(defaults.emitArtifacts, 'jsonl');
assert.deepEqual(defaults.semantics, [], 'default semantics registry should be empty');
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

const semanticsConfig = normalizeRiskInterproceduralConfig({
  enabled: true,
  semantics: [
    {
      id: 'sem.callback.register-handler-payload',
      kind: 'callback',
      name: 'register handler payload handoff',
      frameworks: ['express'],
      languages: ['javascript'],
      patterns: ['\\bregisterHandler\\b'],
      fromArgs: [1],
      taintHints: ['payload']
    },
    {
      id: 'sem.invalid',
      kind: 'unsupported',
      patterns: ['\\bnope\\b']
    }
  ]
}, { mode: 'code' });
assert.equal(semanticsConfig.semantics.length, 1, 'expected supported semantics entry to be kept');
assert.equal(semanticsConfig.semantics[0]?.kind, 'callback');
assert.deepEqual(semanticsConfig.semantics[0]?.frameworks, ['express']);
assert.deepEqual(semanticsConfig.semantics[0]?.fromArgs, [1]);
assert.deepEqual(semanticsConfig.semantics[0]?.taintHints, ['payload']);
assert.deepEqual(
  semanticsConfig.semantics[0]?.patterns,
  ['\\bregisterHandler\\b'],
  'expected normalized config to retain plain semantics patterns for stable signatures'
);
assert.ok(
  semanticsConfig.diagnostics?.warnings?.some((entry) => entry?.code === 'UNSUPPORTED_SEMANTICS_KIND'),
  'expected unsupported semantics kinds to emit diagnostics'
);

const proseMode = normalizeRiskInterproceduralConfig({ enabled: true }, { mode: 'prose' });
assert.equal(proseMode.enabled, false, 'non-code modes should disable interprocedural');

console.log('risk interprocedural config normalization test passed');
