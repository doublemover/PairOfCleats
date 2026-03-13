#!/usr/bin/env node
import assert from 'node:assert/strict';
import { detectRiskSignals, normalizeRiskConfig } from '../../../src/index/risk.js';

const config = normalizeRiskConfig({
  enabled: true,
  rules: {
    includeDefaults: false,
    rules: {
      sources: [{ id: 'source.one', name: 'SRC', patterns: ['SRC'], confidence: 0.9 }],
      sinks: [{ id: 'sink.one', name: 'SINK', patterns: ['SINK'], confidence: 0.6 }],
      sanitizers: [{ id: 'san.one', name: 'SAN', patterns: ['sanitize'] }]
    }
  }
});

const sanitizerText = [
  'const user = SRC;',
  'const admin = SRC;',
  'sanitize(user); SINK(admin);'
].join('\n');
const sanitizerRisk = detectRiskSignals({ text: sanitizerText, config, languageId: 'javascript' });
assert.ok(sanitizerRisk?.flows?.length, 'expected flow to remain after unrelated sanitizer call');

const destructuringText = [
  'const { token } = SRC;',
  'SINK(token);'
].join('\n');
const destructuringRisk = detectRiskSignals({ text: destructuringText, config, languageId: 'javascript' });
assert.ok(destructuringRisk?.flows?.length, 'expected destructured assignment to propagate taint');

console.log('risk analysis taint test passed');
