#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validateAnalysisPolicy } from '../src/contracts/validators/analysis.js';

const valid = {
  metadata: { enabled: true },
  risk: { enabled: true, crossFile: false },
  git: { enabled: true, blame: true, churn: false },
  typeInference: {
    local: { enabled: true },
    crossFile: { enabled: false },
    tooling: { enabled: false }
  }
};

const validResult = validateAnalysisPolicy(valid);
assert.equal(validResult.ok, true, 'expected valid policy to pass');

const invalid = {
  risk: { enabled: 'yes' },
  typeInference: { tooling: { enabled: 'no' } }
};

const invalidResult = validateAnalysisPolicy(invalid);
assert.equal(invalidResult.ok, false, 'expected invalid policy to fail');
assert.ok(invalidResult.errors.length > 0, 'expected schema errors for invalid policy');

console.log('analysis policy schema test passed');
