#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeRiskRules } from '../../../../src/index/risk-rules.js';
import { detectRiskSignals, normalizeRiskConfig } from '../../../../src/index/risk.js';

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

for (const role of ['sources', 'sinks', 'sanitizers']) {
  const guarded = normalizeRiskRules({
    includeDefaults: false,
    rules: { [role]: [{ id: 'invalid.guard', name: 'guarded', patterns: ['MATCH'], requires: '(' }] }
  });
  assert.equal(guarded[role].length, 0, `${role} with an invalid required condition must be disabled`);
  assert.ok(guarded.diagnostics.warnings.some((entry) => entry.field === 'requires'));
}
const config = normalizeRiskConfig({
  caps: { maxMs: 1000 },
  rules: {
    includeDefaults: false,
    rules: {
      sources: [{ name: 'source', patterns: ['SRC'] }],
      sinks: [{ name: 'sink', patterns: ['SINK'] }],
      sanitizers: [{ name: 'unsafe', patterns: ['sanitize'], requires: '(' }]
    }
  }
});
const risk = detectRiskSignals({ text: 'const value = SRC;\nsanitize(value);\nSINK(value);', config });
assert.ok(risk.flows.length, 'a broken sanitizer condition must not hide a source-to-sink flow');

console.log('risk rules diagnostics ok');
