#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { detectRiskSignals, normalizeRiskConfig } from '../../../src/index/risk.js';
import {
  containsIdentifier,
  matchRulePatterns,
  SEVERITY_RANK
} from '../../../src/index/risk/shared.js';

applyTestEnv();

const buildConfig = (caps) => normalizeRiskConfig({
  enabled: true,
  caps,
  rules: {
    includeDefaults: false,
    rules: {
      sources: [{ id: 'source.one', name: 'SRC', patterns: ['SRC'], confidence: 0.9 }],
      sinks: [{ id: 'sink.one', name: 'SINK', patterns: ['SINK'], confidence: 0.6 }],
      sanitizers: [{ id: 'san.one', name: 'SAN', patterns: ['sanitize'] }]
    }
  }
});

{
  assert.equal(SEVERITY_RANK.low, 1);
  assert.equal(SEVERITY_RANK.critical, 4);

  assert.equal(containsIdentifier('foo bar', 'foo'), true);
  assert.equal(containsIdentifier('foobar', 'foo'), false);
  assert.equal(containsIdentifier('foo_bar', 'foo'), false);
  assert.equal(containsIdentifier('foo + bar', 'bar'), true);
  assert.equal(containsIdentifier('x foo y', 'foo', { start: 2, end: 5 }), true);
  assert.equal(containsIdentifier('x foo y', 'foo', { start: 0, end: 2 }), false);

  const pattern = /danger\(/i;
  pattern.prefilter = 'danger';
  pattern.prefilterLower = 'danger';

  const rule = { patterns: [pattern] };
  const lineLowerRef = { value: null };
  const match = matchRulePatterns('if (danger(input)) {}', rule, {
    returnMatch: true,
    lineLowerRef
  });
  assert.equal(typeof lineLowerRef.value, 'string');
  assert.equal(match.index, 4);
  assert.equal(match.match, 'danger(');
  assert.equal(matchRulePatterns('safe(input)', rule, { returnMatch: true, lineLowerRef: { value: null } }), null);
  assert.equal(matchRulePatterns('safe(input)', rule), false);
  assert.equal(matchRulePatterns('danger(input)', rule), true);
}

{
  const cappedConfig = buildConfig({ maxBytes: 8, maxLines: 10 });
  const cappedText = 'SRC and SINK in a long line.';
  const capped = detectRiskSignals({ text: cappedText, config: cappedConfig, languageId: 'javascript' });
  assert.ok(capped, 'expected capped risk result');
  assert.equal(capped.analysisStatus?.status, 'capped');
  assert.ok(capped.analysisStatus?.reason?.includes('maxBytes'));

  const okConfig = buildConfig({ maxBytes: 1024, maxLines: 10, maxMs: 1000 });
  const okText = 'SRC value\nconst x = 1;\nSINK(value)';
  const runA = detectRiskSignals({ text: okText, config: okConfig, languageId: 'javascript' });
  const runB = detectRiskSignals({ text: okText, config: okConfig, languageId: 'javascript' });
  assert.ok(runA, 'expected risk signals in non-capped run');
  assert.equal(JSON.stringify(runA), JSON.stringify(runB), 'expected deterministic risk output');

  const longLineConfig = buildConfig({ maxBytes: 200000, maxLines: 5, maxMs: 1000 });
  const longLineText = `SRC ${'x'.repeat(10000)} SINK`;
  const longLine = detectRiskSignals({
    text: longLineText,
    config: longLineConfig,
    languageId: 'javascript'
  });
  assert.ok(longLine === null || typeof longLine === 'object', 'expected long-line run to complete');
}

{
  const taintConfig = buildConfig({ maxBytes: 1024, maxLines: 50, maxMs: 1000 });

  const sanitizerText = [
    'const user = SRC;',
    'const admin = SRC;',
    'sanitize(user); SINK(admin);'
  ].join('\n');
  const sanitizerRisk = detectRiskSignals({
    text: sanitizerText,
    config: taintConfig,
    languageId: 'javascript'
  });
  assert.ok(sanitizerRisk?.flows?.length, 'expected flow to remain after unrelated sanitizer call');

  const destructuringText = [
    'const { token } = SRC;',
    'SINK(token);'
  ].join('\n');
  const destructuringRisk = detectRiskSignals({
    text: destructuringText,
    config: taintConfig,
    languageId: 'javascript'
  });
  assert.ok(destructuringRisk?.flows?.length, 'expected destructured assignment to propagate taint');
}

console.log('risk contract matrix test passed');
