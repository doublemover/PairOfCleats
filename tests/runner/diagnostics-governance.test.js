#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  normalizeDiagnosticsGovernance,
  validateDiagnosticsGovernance
} from './diagnostics-governance.js';

const payload = normalizeDiagnosticsGovernance({
  schemaVersion: 1,
  instabilityClasses: ['stable', 'flaky', 'slow'],
  diagnosticsClasses: ['clean', 'expected-negative-stderr', 'unexpected-stderr'],
  expectedNegativeStderrIds: ['cli/error-contract', 'cli/error-contract'],
  retryPolicyBySuiteCategory: {
    hero: { maxRetries: 0, quarantine: 'manual', note: 'hero' },
    matrix: { maxRetries: 1, quarantine: 'owner', note: 'matrix' },
    meta: { maxRetries: 0, quarantine: 'none', note: 'meta' },
    soak: { maxRetries: 0, quarantine: 'manual', note: 'soak' },
    'heavy-runtime': { maxRetries: 1, quarantine: 'owner', note: 'heavy' }
  }
});

assert.equal(payload.expectedNegativeStderrIds.size, 1);
assert.deepEqual(validateDiagnosticsGovernance(payload), { valid: true, errors: [] });

const invalid = validateDiagnosticsGovernance(normalizeDiagnosticsGovernance({
  schemaVersion: 1,
  retryPolicyBySuiteCategory: {
    hero: { maxRetries: 0, quarantine: 'manual', note: 'hero' }
  }
}));
assert.equal(invalid.valid, false);
assert.ok(invalid.errors.some((entry) => entry.includes('matrix')));

console.log('diagnostics governance test passed');
