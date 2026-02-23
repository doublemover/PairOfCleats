#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUsrFailureInjectionReport,
  evaluateUsrFailureInjectionScenarios
} from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const failureInjectionPayload = readMatrix('usr-failure-injection-matrix.json');
const scenarioRow = structuredClone(failureInjectionPayload.rows[0]);
const minimalMatrixPayload = {
  ...failureInjectionPayload,
  rows: [scenarioRow]
};

const strictScenarioResults = {
  [scenarioRow.id]: {
    outcome: scenarioRow.strictExpectedOutcome,
    diagnostics: [...scenarioRow.requiredDiagnostics],
    reasonCodes: [...scenarioRow.requiredReasonCodes],
    recoveryEvidence: [...scenarioRow.requiredRecoveryArtifacts]
  }
};

const nonStrictScenarioResults = {
  [scenarioRow.id]: {
    outcome: scenarioRow.nonStrictExpectedOutcome,
    diagnostics: [...scenarioRow.requiredDiagnostics],
    reasonCodes: [...scenarioRow.requiredReasonCodes],
    recoveryEvidence: [...scenarioRow.requiredRecoveryArtifacts]
  }
};

const passEvaluation = evaluateUsrFailureInjectionScenarios({
  matrixPayload: minimalMatrixPayload,
  strictScenarioResults,
  nonStrictScenarioResults,
  strictEnum: true
});
assert.equal(passEvaluation.ok, true, 'expected canonical failure-injection row to pass');
assert.equal(passEvaluation.errors.length, 0);
assert.equal(passEvaluation.rows.length, 1);

const failEvaluation = evaluateUsrFailureInjectionScenarios({
  matrixPayload: minimalMatrixPayload,
  strictScenarioResults,
  nonStrictScenarioResults: {
    [scenarioRow.id]: {
      ...nonStrictScenarioResults[scenarioRow.id],
      outcome: 'warn-only'
    }
  },
  strictEnum: true
});
assert.equal(failEvaluation.ok, false, 'expected non-strict outcome mismatch to fail evaluation');
assert(
  failEvaluation.errors.some((message) => message.includes('non-strict outcome mismatch')),
  'expected non-strict outcome mismatch error'
);

const report = buildUsrFailureInjectionReport({
  matrixPayload: minimalMatrixPayload,
  strictScenarioResults,
  nonStrictScenarioResults: {
    [scenarioRow.id]: {
      ...nonStrictScenarioResults[scenarioRow.id],
      outcome: 'warn-only'
    }
  },
  strictEnum: true,
  scope: { scopeType: 'lane', scopeId: 'nightly' }
});
assert.equal(report.payload.artifactId, 'usr-failure-injection-report');
assert.equal(report.payload.status, 'fail');
assert.equal(report.payload.summary.scenarioCount, 1);
assert.equal(report.payload.scope.scopeType, 'lane');
assert.equal(report.payload.scope.scopeId, 'nightly');

console.log('usr failure injection report test passed');
