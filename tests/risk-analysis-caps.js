#!/usr/bin/env node
import assert from 'node:assert/strict';
import { detectRiskSignals, normalizeRiskConfig } from '../src/index/risk.js';

const buildConfig = (caps) => normalizeRiskConfig({
  enabled: true,
  caps,
  rules: {
    includeDefaults: false,
    rules: {
      sources: [{ id: 'source.one', name: 'SRC', patterns: ['SRC'] }],
      sinks: [{ id: 'sink.one', name: 'SINK', patterns: ['SINK'] }],
      sanitizers: []
    }
  }
});

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
const longLine = detectRiskSignals({ text: longLineText, config: longLineConfig, languageId: 'javascript' });
assert.ok(longLine === null || typeof longLine === 'object', 'expected long-line run to complete');

console.log('risk analysis caps test passed');
