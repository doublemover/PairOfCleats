#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUsrObservabilityRollupReport,
  evaluateUsrObservabilityRollup
} from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const sloBudgetsPayload = readMatrix('usr-slo-budgets.json');
const alertPoliciesPayload = readMatrix('usr-alert-policies.json');

const ciSloRow = structuredClone(sloBudgetsPayload.rows.find((row) => row.laneId === 'ci') || sloBudgetsPayload.rows[0]);
const downgradeAlert = structuredClone(
  alertPoliciesPayload.rows.find((row) => row.id === 'alert-capability-downgrade-rate') || alertPoliciesPayload.rows[0]
);

const evaluation = evaluateUsrObservabilityRollup({
  sloBudgetsPayload: {
    ...sloBudgetsPayload,
    rows: [ciSloRow]
  },
  alertPoliciesPayload: {
    ...alertPoliciesPayload,
    rows: [downgradeAlert]
  },
  observedLaneMetrics: {
    ci: {
      laneId: 'ci',
      durationMs: 1000,
      peakMemoryMb: 256,
      parserTimePerSegmentMs: 10,
      unknownKindRate: 0.001,
      unresolvedRate: 0.001,
      capabilityDowngradeRate: 0.02,
      criticalDiagnosticCount: 0,
      redactionFailureCount: 0
    }
  }
});

assert.equal(evaluation.ok, true, 'non-blocking alert trigger should not fail evaluation');
assert.equal(evaluation.errors.length, 0);
assert(
  evaluation.warnings.some((message) => message.includes('alert triggered capability_downgrade_rate')),
  'expected downgrade-rate alert trigger warning'
);
assert.equal(
  evaluation.rows.filter((row) => row.rowType === 'slo-budget').length,
  1,
  'expected one slo-budget row for narrowed payload'
);

const report = buildUsrObservabilityRollupReport({
  sloBudgetsPayload: {
    ...sloBudgetsPayload,
    rows: [ciSloRow]
  },
  alertPoliciesPayload: {
    ...alertPoliciesPayload,
    rows: [downgradeAlert]
  },
  observedLaneMetrics: {
    ci: {
      laneId: 'ci',
      durationMs: 1000,
      peakMemoryMb: 256,
      parserTimePerSegmentMs: 10,
      unknownKindRate: 0.001,
      unresolvedRate: 0.001,
      capabilityDowngradeRate: 0.02,
      criticalDiagnosticCount: 0,
      redactionFailureCount: 0
    }
  },
  scope: null
});

assert.equal(report.payload.artifactId, 'usr-observability-rollup');
assert.equal(report.payload.status, 'warn');
assert.equal(report.payload.scope.scopeType, 'global');
assert.equal(report.payload.scope.scopeId, 'global');
assert.equal(report.payload.summary.sloBudgetRowCount, 1);
assert.equal(report.payload.summary.alertEvaluationRowCount, 1);
assert.equal(report.payload.summary.errorCount, 0);
assert.equal(report.payload.summary.warningCount, 1);

console.log('usr observability rollup test passed');
