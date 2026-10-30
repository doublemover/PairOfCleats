import assert from 'node:assert/strict';
import { detectRiskSignals, normalizeRiskConfig } from '../../../src/index/risk.js';
const config = normalizeRiskConfig({ enabled: true, rules: { includeDefaults: false, rules: {
  sources: [{ id: 'src', name: 'SOURCE', patterns: ['SOURCE'], confidence: 1 }],
  sinks: [{ id: 'sink', name: 'SINK', patterns: ['SINK'], confidence: 1 }],
  sanitizers: [{ id: 'clean', name: 'clean', patterns: ['clean'] }]
} } });
const flows = text => detectRiskSignals({ text, config, languageId: 'javascript' })?.flows || [];
assert.equal(flows('const value = SOURCE();\nSINK(value); clean(value);').length, 1);
assert.equal(flows('const value = SOURCE();\nclean(value); SINK(value);').length, 0);
assert.equal(flows('const value = SOURCE();\nSINK(clean(value));').length, 0);
assert.equal(flows('const value = SOURCE();\nconsole.log(value); SINK("safe");').length, 0);
assert.equal(flows('const value = SOURCE();\nvalue = "safe"; SINK(value);').length, 0);
assert.equal(flows('const value = SOURCE() === other;\nSINK(value);').length, 1,
  'an equality expression on the RHS does not turn a real assignment into a comparison');
console.log('local risk statement ordering passed');

for (const rhs of ['value + "a==b"', 'value + "a!=b"', 'value === other', 'value <= other'])
  assert.equal(flows('const value = SOURCE();\nconst alias = ' + rhs + ';\nSINK(alias);').length, 1,
    'RHS operators or quoted comparison text do not erase the LHS assignment');
assert.equal(flows('const value = "safe";\nconst alias = value + "a==b";\nSINK(alias);').length, 0);
