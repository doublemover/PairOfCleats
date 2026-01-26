#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeRiskRules } from '../../src/index/risk-rules.js';

const bundle = normalizeRiskRules({
  includeDefaults: false,
  rules: {
    sources: [
      {
        name: 'broken-source',
        patterns: ['(', '\\breq\\.body\\b']
      }
    ],
    sinks: [],
    sanitizers: []
  }
});

assert(bundle, 'bundle should be returned');
assert(bundle.diagnostics, 'diagnostics should be present');
assert(Array.isArray(bundle.diagnostics.warnings), 'warnings list should exist');
assert.equal(bundle.diagnostics.warnings.length, 1, 'invalid pattern should produce one warning');
const warning = bundle.diagnostics.warnings[0];
assert.equal(warning.code, 'INVALID_PATTERN');
assert.equal(warning.ruleName, 'broken-source');
assert.equal(warning.field, 'patterns');
assert.equal(warning.pattern, '(');

const compiledRule = bundle.sources[0];
assert(compiledRule, 'rule should exist');
assert.equal(compiledRule.patterns.length, 1, 'valid pattern should still compile');

console.log('risk rules diagnostics ok');
