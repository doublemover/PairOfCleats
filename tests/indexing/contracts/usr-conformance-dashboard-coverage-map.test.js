#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildConformanceCoverageMapByLevel,
  CONFORMANCE_DASHBOARD_LEVELS
} from '../../../src/contracts/validators/usr-matrix/conformance-dashboard-coverage-map.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const result = buildConformanceCoverageMapByLevel({
  languageProfilesPayload: {},
  conformanceLevelsPayload: {},
  knownLanes: [],
  levels: ['C0', 'C1'],
  validateConformanceLevelCoverage({ targetLevel }) {
    if (targetLevel === 'C1') {
      return {
        ok: false,
        errors: Object.freeze(['missing coverage']),
        warnings: Object.freeze(['partial coverage']),
        rows: Object.freeze([{ profileId: 'typescript', pass: false }])
      };
    }
    return {
      ok: true,
      errors: Object.freeze([]),
      warnings: Object.freeze([]),
      rows: Object.freeze([{ profileId: 'typescript', pass: true }])
    };
  }
});

assert.equal(Array.isArray(CONFORMANCE_DASHBOARD_LEVELS), true);
assert.equal(result.coverageByLevel.size, 2);
assert.equal(result.coverageByLevel.get('C0').rowsByProfileId.get('typescript').pass, true);
assert.equal(result.coverageByLevel.get('C1').rowsByProfileId.get('typescript').pass, false);
assert.deepEqual(result.errors, ['C1 missing coverage']);
assert.deepEqual(result.warnings, ['C1 partial coverage']);

console.log('usr conformance dashboard coverage map test passed');
