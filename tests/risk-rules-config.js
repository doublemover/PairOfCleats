#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeRiskConfig } from '../src/index/risk.js';

const config = normalizeRiskConfig({
  enabled: true,
  caps: {
    maxBytes: 0,
    maxLines: 0
  },
  rules: {
    includeDefaults: false,
    rules: {
      sources: [
        {
          id: 'source.bad',
          name: 'BadSource',
          patterns: ['(']
        }
      ],
      sinks: [],
      sanitizers: []
    }
  }
}, { rootDir: process.cwd() });

assert.equal(config.caps.maxBytes, null);
assert.equal(config.caps.maxLines, null);
assert.ok(config.rules);
const badSource = config.rules.sources.find((rule) => rule.id === 'source.bad');
assert.ok(badSource, 'expected bad source rule to be present');
assert.equal(badSource.patterns.length, 0, 'expected invalid patterns to be filtered out');

console.log('risk rules config test passed');
