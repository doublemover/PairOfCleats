#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  USR_CANONICAL_DIAGNOSTIC_CODES,
  USR_DIAGNOSTIC_REMEDIATION_CLASS_BY_CODE,
  resolveUsrDiagnosticRemediationClass
} from '../../../src/contracts/validators/usr.js';

const canonicalCodes = [...USR_CANONICAL_DIAGNOSTIC_CODES].sort();
const mappedCodes = Object.keys(USR_DIAGNOSTIC_REMEDIATION_CLASS_BY_CODE).sort();

assert.deepEqual(
  mappedCodes,
  canonicalCodes,
  'diagnostic remediation routing map must cover every canonical diagnostic code and no extra codes'
);

for (const code of canonicalCodes) {
  const resolved = resolveUsrDiagnosticRemediationClass(code, { strictEnum: true });
  assert.equal(resolved.ok, true, `remediation routing must resolve canonical diagnostic: ${code}`);
  assert.equal(typeof resolved.remediationClass, 'string', `remediation routing class must be string: ${code}`);
  assert.equal(resolved.remediationClass.length > 0, true, `remediation routing class must be non-empty: ${code}`);
}

const expectedClassByCode = {
  'USR-E-PARSER-UNAVAILABLE': 'parser-runtime',
  'USR-E-SCHEMA-VIOLATION': 'schema-contract',
  'USR-E-EDGE-ENDPOINT-INVALID': 'graph-integrity',
  'USR-E-PROFILE-CONFLICT': 'framework-overlay',
  'USR-E-CAPABILITY-LOST': 'capability-state',
  'USR-E-SECURITY-GATE-FAILED': 'ops-security-gates',
  'USR-W-TRUNCATED-FLOW': 'analysis-caps'
};

for (const [code, expectedClass] of Object.entries(expectedClassByCode)) {
  const resolved = resolveUsrDiagnosticRemediationClass(code, { strictEnum: true });
  assert.equal(resolved.ok, true, `diagnostic remediation routing should resolve ${code}`);
  assert.equal(
    resolved.remediationClass,
    expectedClass,
    `diagnostic remediation class mismatch for ${code}`
  );
}

const unknownDiagnostic = resolveUsrDiagnosticRemediationClass('USR-E-NOT-IN-TAXONOMY', { strictEnum: true });
assert.equal(unknownDiagnostic.ok, false, 'unknown diagnostic code must fail strict remediation-class routing');

console.log('usr diagnostic remediation routing validation checks passed');
