#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  assertUnresolvedDecision,
  createUnresolvedDecision,
  IMPORT_REASON_CODES,
  IMPORT_RESOLUTION_STATES,
  validateResolutionDecision
} from '../../../src/index/build/import-resolution.js';

const missingFile = createUnresolvedDecision(IMPORT_REASON_CODES.MISSING_FILE_RELATIVE);
assert.equal(missingFile.resolutionState, IMPORT_RESOLUTION_STATES.UNRESOLVED);
assert.equal(missingFile.reasonCode, IMPORT_REASON_CODES.MISSING_FILE_RELATIVE);
assert.equal(missingFile.failureCause, 'missing_file');
assert.equal(missingFile.disposition, 'actionable');
assert.equal(missingFile.resolverStage, 'filesystem_probe');
assert.deepEqual(validateResolutionDecision(missingFile), { ok: true, errors: [] });
assert.doesNotThrow(() => assertUnresolvedDecision(missingFile));

const fallbackDecision = createUnresolvedDecision('IMP_U_NOT_REAL');
assert.equal(fallbackDecision.reasonCode, IMPORT_REASON_CODES.UNKNOWN);
assert.equal(fallbackDecision.failureCause, 'unknown');
assert.equal(fallbackDecision.disposition, 'actionable');

const invalidResolved = validateResolutionDecision({
  resolutionState: IMPORT_RESOLUTION_STATES.RESOLVED,
  reasonCode: IMPORT_REASON_CODES.UNKNOWN
});
assert.equal(invalidResolved.ok, false);
assert.equal(
  invalidResolved.errors.some((entry) => entry.includes('must not include reasonCode')),
  true
);

const invalidActionable = validateResolutionDecision({
  resolutionState: IMPORT_RESOLUTION_STATES.UNRESOLVED,
  reasonCode: IMPORT_REASON_CODES.PARSER_NOISE_SUPPRESSED,
  failureCause: 'parser_artifact',
  disposition: 'actionable',
  resolverStage: 'classify'
});
assert.equal(invalidActionable.ok, false);
assert.equal(
  invalidActionable.errors.some((entry) => entry.includes('not allowed')),
  true
);

assert.throws(
  () => assertUnresolvedDecision({
    resolutionState: IMPORT_RESOLUTION_STATES.RESOLVED,
    reasonCode: IMPORT_REASON_CODES.UNKNOWN
  }),
  /expected unresolved decision state/
);

console.log('import resolution decision model contract test passed');
