#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateUsrConformancePromotionReadiness } from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const languageProfilesPayload = readMatrix('usr-language-profiles.json');
const conformanceLevelsPayload = readMatrix('usr-conformance-levels.json');

const baseline = evaluateUsrConformancePromotionReadiness({
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes: []
});
assert.equal(typeof baseline.blocked, 'boolean');
assert.equal(Array.isArray(baseline.blockers), true);
assert.equal(typeof baseline.conformanceByLevel.C4, 'object');

const blocked = evaluateUsrConformancePromotionReadiness({
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes: [],
  missingArtifacts: ['usr-operational-readiness-validation-report'],
  failingBlockingGateIds: ['quality-gate-framework-binding']
});
assert.equal(blocked.blocked, true);
assert(
  blocked.blockers.includes('missing-artifact:usr-operational-readiness-validation-report'),
  'expected missing artifact blocker'
);
assert(
  blocked.blockers.includes('failing-gate:quality-gate-framework-binding'),
  'expected failing gate blocker'
);

console.log('usr conformance promotion readiness test passed');
