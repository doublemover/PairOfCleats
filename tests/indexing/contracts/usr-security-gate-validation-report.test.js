#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUsrSecurityGateValidationReport,
  validateUsrSecurityGateControls
} from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const securityGatesPayload = readMatrix('usr-security-gates.json');
const redactionRulesPayload = readMatrix('usr-redaction-rules.json');

const minimalSecurityPayload = {
  ...securityGatesPayload,
  rows: [structuredClone(securityGatesPayload.rows[0])]
};
const minimalRedactionPayload = {
  ...redactionRulesPayload,
  rows: [structuredClone(redactionRulesPayload.rows[0])]
};

const passEvaluation = validateUsrSecurityGateControls({
  securityGatesPayload: minimalSecurityPayload,
  redactionRulesPayload: minimalRedactionPayload,
  gateResults: {
    [minimalSecurityPayload.rows[0].id]: { pass: true }
  },
  redactionResults: {
    [minimalRedactionPayload.rows[0].id]: { pass: true, misses: 0 }
  }
});
assert.equal(passEvaluation.ok, true, 'expected minimal security gate payload to pass');
assert.equal(passEvaluation.errors.length, 0);

const failEvaluation = validateUsrSecurityGateControls({
  securityGatesPayload: minimalSecurityPayload,
  redactionRulesPayload: minimalRedactionPayload,
  gateResults: {
    [minimalSecurityPayload.rows[0].id]: { pass: false }
  },
  redactionResults: {
    [minimalRedactionPayload.rows[0].id]: { misses: 2 }
  }
});
assert.equal(failEvaluation.ok, false, 'expected blocking failures to fail validation');
assert(
  failEvaluation.errors.some((message) => message.includes('security-gate failed')),
  'expected security-gate failure error'
);
assert(
  failEvaluation.errors.some((message) => message.includes('redaction rule failed')),
  'expected redaction-rule failure error'
);

const report = buildUsrSecurityGateValidationReport({
  securityGatesPayload: minimalSecurityPayload,
  redactionRulesPayload: minimalRedactionPayload,
  gateResults: {
    [minimalSecurityPayload.rows[0].id]: false
  },
  redactionResults: {
    [minimalRedactionPayload.rows[0].id]: { pass: false, misses: 3 }
  },
  lane: 'nightly',
  scope: { scopeType: 'lane', scopeId: 'nightly' }
});
assert.equal(report.payload.artifactId, 'usr-validation-report');
assert.equal(report.payload.status, 'fail');
assert.equal(report.payload.summary.rowCount, 2);
assert.equal(report.payload.summary.blockingFailureCount, 2);
assert.equal(report.payload.scope.scopeType, 'lane');
assert.equal(report.payload.scope.scopeId, 'nightly');

console.log('usr security gate validation report test passed');
