#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  validateGraphContextPack,
  validateGraphImpact,
  validateCompositeContextPack,
  validateApiContracts,
  validateArchitectureReport,
  validateSuggestTests
} from '../../../src/contracts/validators/analysis.js';

const provenance = {
  generatedAt: '2026-02-01T00:00:00Z',
  indexSignature: 'sig-0001',
  capsUsed: {}
};

const seed = { type: 'chunk', chunkUid: 'chunk-1' };

const graphContextPack = {
  version: '1.0.0',
  seed,
  provenance,
  nodes: [],
  edges: []
};

const graphImpact = {
  version: '1.0.0',
  seed,
  direction: 'upstream',
  depth: 0,
  impacted: [],
  provenance
};

const compositeContextPack = {
  version: '1.0.0',
  seed,
  provenance,
  primary: {
    ref: seed,
    file: 'src/app.js',
    excerpt: 'const alpha = 1;'
  }
};

const apiContracts = {
  version: '1.0.0',
  provenance,
  options: {
    onlyExports: true,
    failOnWarn: false,
    caps: {
      maxSymbols: 10,
      maxCallsPerSymbol: 5,
      maxWarnings: 5
    }
  },
  symbols: []
};

const architectureReport = {
  version: '1.0.0',
  provenance,
  rules: [],
  violations: []
};

const suggestTests = {
  version: '1.0.0',
  provenance,
  changed: [],
  suggestions: []
};

const validators = [
  ['graph context pack', validateGraphContextPack, graphContextPack],
  ['graph impact', validateGraphImpact, graphImpact],
  ['composite context pack', validateCompositeContextPack, compositeContextPack],
  ['api contracts', validateApiContracts, apiContracts],
  ['architecture report', validateArchitectureReport, architectureReport],
  ['suggest tests', validateSuggestTests, suggestTests]
];

for (const [label, validator, payload] of validators) {
  const result = validator(payload);
  assert.equal(result.ok, true, `expected ${label} to validate: ${result.errors.join(', ')}`);
}

console.log('phase11 schema validation tests passed');
