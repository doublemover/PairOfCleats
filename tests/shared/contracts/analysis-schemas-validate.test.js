#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  validateMetadataV2,
  validateRiskRulesBundle,
  validateAnalysisPolicy,
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

const graphContextPackWithEnvelopeSeed = {
  ...graphContextPack,
  seed: {
    v: 1,
    status: 'unresolved',
    candidates: [],
    resolved: null
  }
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

const metadataV2 = {
  chunkId: 'chunk-1',
  file: 'src/app.js'
};

const riskRulesBundle = {
  version: '1.0.0',
  sources: [],
  sinks: [],
  sanitizers: []
};

const analysisPolicy = {
  metadata: { enabled: true },
  risk: { enabled: true, crossFile: false },
  git: { enabled: true, blame: false, churn: true },
  typeInference: {
    local: { enabled: true },
    crossFile: { enabled: false },
    tooling: { enabled: true }
  }
};

const validators = [
  ['metadata v2', validateMetadataV2, metadataV2],
  ['risk rules bundle', validateRiskRulesBundle, riskRulesBundle],
  ['analysis policy', validateAnalysisPolicy, analysisPolicy],
  ['graph context pack', validateGraphContextPack, graphContextPack],
  ['graph context pack with envelope seed', validateGraphContextPack, graphContextPackWithEnvelopeSeed],
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

const invalidEnvelopeSeed = {
  ...graphContextPackWithEnvelopeSeed,
  seed: {
    v: 1,
    status: 'unresolved',
    candidates: []
  }
};

const invalidEnvelopeResult = validateGraphContextPack(invalidEnvelopeSeed);
assert.equal(invalidEnvelopeResult.ok, false, 'expected envelope seed without resolved to fail');
assert.ok(invalidEnvelopeResult.errors.length > 0, 'expected schema errors for invalid envelope seed');

console.log('analysis schema validation tests passed');
