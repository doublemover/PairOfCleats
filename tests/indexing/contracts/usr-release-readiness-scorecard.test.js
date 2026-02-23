#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildUsrReleaseReadinessScorecard } from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const operationalReadinessPolicyPayload = readMatrix('usr-operational-readiness-policy.json');
const qualityGatesPayload = readMatrix('usr-quality-gates.json');
const languageProfilesPayload = readMatrix('usr-language-profiles.json');
const conformanceLevelsPayload = readMatrix('usr-conformance-levels.json');

const scorecard = buildUsrReleaseReadinessScorecard({
  operationalReadinessPolicyPayload,
  qualityGatesPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes: []
});

assert.equal(scorecard.payload.artifactId, 'usr-release-readiness-scorecard');
assert.equal(scorecard.payload.status, 'pass');
assert.equal(scorecard.blocked, false);
assert.equal(
  scorecard.rows.filter((row) => row.rowType === 'readiness-dimension').length,
  3,
  'expected three readiness dimensions in scorecard rows'
);
assert.equal(
  scorecard.rows.some((row) => row.rowType === 'conformance-level'),
  true,
  'expected conformance summary rows in scorecard output'
);

const blockingGateId = qualityGatesPayload.rows.find((row) => row.blocking === true)?.id;
assert.equal(typeof blockingGateId, 'string');

const blockedScorecard = buildUsrReleaseReadinessScorecard({
  operationalReadinessPolicyPayload,
  qualityGatesPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes: [],
  missingArtifactSchemas: ['usr-release-readiness-scorecard'],
  failingBlockingGateIds: [blockingGateId]
});

assert.equal(blockedScorecard.blocked, true);
assert.equal(blockedScorecard.payload.status, 'fail');
assert(
  blockedScorecard.payload.blockingFindings.some(
    (finding) => finding.class === 'release-readiness' && finding.message.includes('missing-artifact:usr-release-readiness-scorecard')
  ),
  'expected missing artifact blocker to be surfaced in blocking findings'
);
assert.equal(
  blockedScorecard.payload.blockingFindings.length > 0,
  true,
  'expected blocked scorecard to emit at least one blocking finding'
);

console.log('usr release readiness scorecard test passed');
